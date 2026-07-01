"""
SlideRule V5 API (full baseline surface).

Mounted as the primary /api/sliderule in app.py.
Uses execute_mapped_capability for execute-capability (core + structure, instruction, handoff, visual etc.).
RAG-backed. Matches the Node delegation contract for V5 paths.

See audit / FINAL_MIGRATION_STATUS.md for exact coverage vs. "all historical caps".
"""

import asyncio
import os
import re

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from typing import Dict, Any, List, Optional
from models.v5_state import CapabilityRun, V5SessionState
from services.slide_rule_session import create_session, delete_session, load_session, save_session, drive_reasoning_turn
from services.slide_rule_orchestrator import orchestrate_plan
from services.v5_capability_executor import execute_v5_capability
from services.slide_rule_coverage import author_coverage_contract, evaluate_coverage_gate, reconcile_coverage
from services.capability_maps import execute_mapped_capability
from services.v5_session_driver import drive_v5_full_path
from config.settings import settings
from sliderule_llm.capabilities import execute_capability, is_python_native_capability
from sliderule_llm.client import LlmError
from sliderule_llm.evidence import execute_evidence_runtime

# Standardized Python provenance fields (values + attachment) for browser smokes
# and contract tests (e.g. test_v5_smoke.py). Python is source of truth.
# See foundation task 07. Node thin proxies must forward these verbatim.
PROVENANCE_PYTHON_RAG = "python-rag"
PROVENANCE_PYTHON_FULLPATH = "python-fullpath"
PROVENANCE_PYTHON_LLM = "python-llm"
PYTHON_BACKEND = "python"
STATE_AUTHORITY_PYTHON = "python"

# Delivery capability execution contract (task 14: Move delivery capability execution contracts to Python).
# These delivery caps execute via Python (native LLM when is_python_native_capability true, else mapped).
# Python FastAPI /execute-capability is now the backend API source of truth.
# Node delivery-exec-map.ts + isDeliveryCapability path only for SLIDERULE_V5_BACKEND=legacy thin compat.
DELIVERY_CAP_IDS: set[str] = {
    "document.draft",
    "traceability.matrix",
    "task.write",
    "instruction.package",
    "handoff.package",
}

# Visual capability execution contract (task 15: Move visual capability execution contracts to Python).
# ux.preview / outcome.visualize execute via Python (mapped or native paths in sliderule_full).
# Python FastAPI /execute-capability is the backend API source of truth for visual contract.
# Node visual-exec-map.ts + isVisualCapability only for SLIDERULE_V5_BACKEND=legacy thin compat.
VISUAL_CAP_IDS: set[str] = {
    "ux.preview",
    "outcome.visualize",
}

router = APIRouter(tags=["SlideRule V5 (Full Migration to Python)"])  # prefix handled at include time to avoid double /api/sliderule/api/sliderule/...

_sessions: Dict[str, V5SessionState] = {}  # In prod, use DB like Python knowledge
ORCHESTRATE_PLAN_TIMEOUT_MS_ENV = "SLIDERULE_ORCHESTRATE_PLAN_TIMEOUT_MS"
DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS = 120_000

def _auth(key: Optional[str]):
    # Allow missing key in non-prod for direct frontend dev proxy to Python (vite /api/sliderule -> 9700)
    # Node proxy always injects X-Internal-Key for prod/compat paths. This enables smoke E2E from product UI.
    if key is None or key == "":
        if os.getenv("NODE_ENV", "development") != "production":
            return
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key - Python now owns V5")

def _planner_timeout_seconds() -> float:
    raw = os.getenv(ORCHESTRATE_PLAN_TIMEOUT_MS_ENV, str(DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS))
    try:
        timeout_ms = int(raw)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS
    return max(timeout_ms, 1) / 1000

def _bad_plan_request(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "error": "invalid_request",
            "reason": "bad_input",
            "message": message,
            "backend": PYTHON_BACKEND,
            "source": "python",
            "provenance": PROVENANCE_PYTHON_RAG,
            "degraded": True,
        },
    )

def _is_config_missing_error(error: Exception) -> bool:
    message = str(error).lower()
    return isinstance(error, LlmError) and (
        "not configured" in message
        or "no api_key" in message
        or "no api key" in message
        or "no provider chain" in message
    )


def _evidence_query(payload: Dict[str, Any]) -> str:
    state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
    goal = state.get("goal") if isinstance(state.get("goal"), dict) else {}
    return "\n".join(
        part
        for part in (
            str(goal.get("text", "")),
            str(payload.get("userText", "")),
        )
        if part and str(part).strip()
    )

def _degraded_plan(error_code: str, reason: str, message: str) -> Dict[str, Any]:
    return {
        "selected": [],
        "rationale": "Python orchestrate.plan could not produce a planner result.",
        "source": PROVENANCE_PYTHON_RAG,
        "converged": False,
        "degraded": True,
        "error": error_code,
        "reason": reason,
        "message": message[:300],
        "fallbackAvailable": False,
    }

def _coerce_state_payload(raw_state: Any) -> Dict[str, Any]:
    if not isinstance(raw_state, dict):
        raise ValueError("state must be an object")

    # Frontend session GET returns { state, stateAuthority, provenance, backend }. During local
    # Python-first dev the client can keep that wrapper and merge fresh runtime
    # fields beside it before POST /orchestrate-plan. Python owns the endpoint,
    # so accept the wrapper instead of forcing the browser to special-case it.
    inner = raw_state.get("state")
    if isinstance(inner, dict):
        merged = dict(inner)
        for key, value in raw_state.items():
            if key in {"state", "provenance", "backend"}:
                continue
            merged[key] = value
        return merged

    return raw_state

async def _run_orchestrate_plan(payload: Any):
    if not isinstance(payload, dict):
        return _bad_plan_request("request body must be an object")
    if "state" not in payload:
        return _bad_plan_request("state is required")
    if not str(payload.get("turnId") or "").strip():
        return _bad_plan_request("turnId is required")

    try:
        state = V5SessionState(**_coerce_state_payload(payload["state"]))
    except (TypeError, ValidationError, ValueError) as error:
        return _bad_plan_request(f"state is invalid: {str(error).splitlines()[0]}")

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                orchestrate_plan,
                state,
                str(payload["turnId"]),
                str(payload.get("userText", "")),
            ),
            timeout=_planner_timeout_seconds(),
        )
    except asyncio.TimeoutError:
        return _degraded_plan(
            "planner_timeout",
            "timeout",
            "Python orchestrate.plan timed out before producing a plan.",
        )
    except Exception as error:
        if _is_config_missing_error(error):
            return _degraded_plan("planner_config_missing", "config_missing", str(error))
        return _degraded_plan("planner_error", "runtime_error", str(error))

    return result.model_dump()

@router.post("/sessions")
async def create_sess(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = create_session(payload.get("goal", {}).get("text", "default"), payload.get("sessionId"))
    _sessions[state.sessionId] = state
    return {"sessionId": state.sessionId, "state": state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.get("/sessions/{sid}")
async def get_sess(sid: str, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = load_session(sid) or _sessions.get(sid)
    if not state:
        raise HTTPException(404, "Not found")
    return {"state": state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.put("/sessions/{sid}")
async def save_sess(sid: str, state: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    # Sanitize client PUT body to prevent forging server-owned fields per V5.2 authority.
    # coverageGate, capabilityRuns, artifacts trust and ledgers + sessionReplayLog/reasoningEvents (server append-only) are server-owned only.
    # Load existing (may be server_trusted via load path) and retain/merge those; client updates only safe fields.
    # Normal V5SessionState parse on unsanitized client body would reject elevated artifacts; we sanitize first
    # so full GET state roundtrips are accepted at transport, but server values win.
    # sessionReplayLog / reasoningEvents are append-only server fields (see persistence merge).
    client_input: Dict[str, Any] = dict(state) if isinstance(state, dict) else {}
    client_input.pop("coverageGate", None)
    client_input.pop("capabilityRuns", None)
    client_input.pop("decisionLedger", None)
    client_input.pop("costLedger", None)
    client_input.pop("flowBoundaryLedger", None)
    client_input.pop("structureGateLedger", None)
    # Protect server-owned append-only replay from client/stale overwrite (task requirement)
    client_input.pop("sessionReplayLog", None)
    client_input.pop("reasoningEvents", None)
    # Sanitize artifacts from client: strip server-owned trust fields so parse succeeds; we will not apply client's artifacts list
    if "artifacts" in client_input and isinstance(client_input.get("artifacts"), list):
        safe_arts = []
        for art in client_input["artifacts"]:
            if isinstance(art, dict):
                safe = {k: v for k, v in art.items() if k not in ("trustLevel", "producedBy", "passedGates")}
                safe["trustLevel"] = "untrusted"
                safe["passedGates"] = []
                safe_arts.append(safe)
            else:
                safe_arts.append(art)
        client_input["artifacts"] = safe_arts
    try:
        client_contrib = V5SessionState(**client_input) if client_input else None
    except (ValidationError, TypeError, ValueError) as e:
        raise HTTPException(400, f"invalid session state from client: {str(e).splitlines()[0]}")
    # load existing server state (trusted)
    existing = load_session(sid) or _sessions.get(sid)
    if existing:
        # Concurrency guard for PUT: reject if client claims older lastTurnId than server (stale request must not overwrite newer authoritative state).
        # Returns conflict so caller can reload. Persistence-level guard also protects on save even for direct calls.
        # (Finding 2 resolution)
        if client_contrib:
            def _turn_seq(lt: Optional[str]) -> int:
                if not lt:
                    return 0
                m = re.search(r"(\d+)", str(lt))
                return int(m.group(1)) if m else 0
            inc_seq = _turn_seq(getattr(client_contrib, "lastTurnId", None))
            ex_seq = _turn_seq(getattr(existing, "lastTurnId", None))
            if inc_seq > 0 and ex_seq > 0 and inc_seq < ex_seq:
                raise HTTPException(409, "stale write rejected: incoming lastTurnId older than current server state (concurrent save guard)")
        merged = existing.model_copy(deep=True)
        if client_contrib:
            # apply client-safe updates, exclude server-owned; never take client's artifacts/runs/gate/ledgers/replay
            updates = client_contrib.model_dump(exclude={"sessionId", "coverageGate", "capabilityRuns", "artifacts", "decisionLedger", "costLedger", "flowBoundaryLedger", "structureGateLedger", "sessionReplayLog", "reasoningEvents"})
            for k, v in updates.items():
                if hasattr(merged, k):
                    setattr(merged, k, v)
            merged.sessionId = sid
        state = merged
    else:
        if client_contrib:
            client_contrib.sessionId = sid
            state = client_contrib
        else:
            state = V5SessionState(sessionId=sid, goal={"text": "", "status": "needs_refinement"})
    # Use authoritative result from save_session (which delegates to persistence guard + cache reload)
    # instead of the pre-save input state. Ensures route _sessions reflects service-forced authoritative
    # (consistent with "service forces reload authoritative into cache" and load_session behavior).
    # Fixes review finding 2.
    authoritative = save_session(state)
    _sessions[sid] = authoritative
    return {"ok": True, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.delete("/sessions/{sid}")
async def delete_sess(sid: str, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    result = delete_session(sid)
    _sessions.pop(sid, None)
    if not result.get("ok"):
        if result.get("error") == "not_found":
            return {"ok": True, "sessionId": sid, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}
        return JSONResponse(
            status_code=500,
            content={**result, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND},
        )
    return {**result, "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.post("/orchestrate-plan")
async def plan(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    res = await _run_orchestrate_plan(payload)
    if isinstance(res, dict):
        res["provenance"] = res.get("provenance") or PROVENANCE_PYTHON_RAG
        res["backend"] = PYTHON_BACKEND
    return res

@router.post("/execute-capability")
async def exec_cap(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    cap = payload["capabilityId"]
    if is_python_native_capability(cap):
        try:
            if cap == "evidence.search":
                q = _evidence_query(payload)
                ev = execute_evidence_runtime(q)
                result = execute_capability(payload, evidence_retriever=lambda _q: ev)
                result = result if isinstance(result, dict) else dict(result)
                result.update(ev.to_payload_fields())
            else:
                result = execute_capability(payload)
        except LlmError as e:
            raise HTTPException(502, f"python LLM failed for {cap}: {e}")
        run_id = f"run-{payload['turnId']}-{cap}"
        state.capabilityRuns.append(CapabilityRun(id=run_id, capabilityId=cap, turnId=payload["turnId"], outputs=[]))
        save_session(state)
        result = result if isinstance(result, dict) else dict(result)
        result.setdefault("provenance", PROVENANCE_PYTHON_RAG)
        result["backend"] = PYTHON_BACKEND
        if cap in DELIVERY_CAP_IDS:
            result.setdefault("deliveryContract", "python-native-llm")
        if cap in VISUAL_CAP_IDS:
            result.setdefault("visualContract", "python-native-llm")
        return result
    # Use mapped for all V5 caps - stable RAG (execute-capability semantics owned by Python)
    result = execute_mapped_capability(cap, state, payload.get("inputArtifactIds", []), payload.get("roleId", "agent"), payload["turnId"])
    # For tools/evidence, always "introduce" via RAG (covers evidence.search + report.write etc)
    if cap in ["mcp.call", "skill.invoke", "evidence.search", "report.write", "risk.analyze"]:
        result["summary"] = result.get("summary") or "检索了外部证据"
        result["provenance"] = PROVENANCE_PYTHON_RAG
    result = result if isinstance(result, dict) else dict(result)
    result.setdefault("provenance", PROVENANCE_PYTHON_RAG)
    result["backend"] = PYTHON_BACKEND
    if cap in DELIVERY_CAP_IDS:
        result.setdefault("deliveryContract", "python-mapped")
    if cap in VISUAL_CAP_IDS:
        result.setdefault("visualContract", "python-mapped")
    # Update state with run (like Node)
    run_id = f"run-{payload['turnId']}-{cap}"
    state.capabilityRuns.append(CapabilityRun(id=run_id, capabilityId=cap, turnId=payload["turnId"], outputs=[]))
    save_session(state)
    return result

@router.post("/drive-turn")
async def drive(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Full drive like Node's session-driver for full-path."""
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    new_state = drive_reasoning_turn(state, payload["turnId"], payload.get("userText", ""))
    # python provenance for turn/drive (covers turn + downstream evidence/report)
    return {"state": new_state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_RAG, "backend": PYTHON_BACKEND}

# GCOV endpoint
@router.post("/coverage")
async def cov(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    gate = evaluate_coverage_gate(state)
    return gate
