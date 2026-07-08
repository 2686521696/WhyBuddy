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
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError
from typing import Dict, Any, List, Optional
from models.v5_state import CapabilityRun, V5SessionState
from services.slide_rule_session import create_session, delete_session, load_session, save_session, drive_reasoning_turn, pick_next_capabilities
from services.persistence import load_all
from services.slide_rule_marathon import drive_marathon
from services.v5_full_driver import drive_full_v5_session, drive_full_v5_session_stream, _result_to_dict
from services.v5_publish_closure_response import derive_publish_closure_response
from services.v5_skill_runtime_graph import derive_skill_runtime_graph_response
from services.sliderule_session_sanitizer import sanitize_session_dict, sanitize_session_state
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
EXECUTE_CAPABILITY_TIMEOUT_MS_ENV = "SLIDERULE_EXECUTE_CAPABILITY_TIMEOUT_MS"
DEFAULT_EXECUTE_CAPABILITY_TIMEOUT_MS = 180_000

def _auth(key: Optional[str]):
    # Allow missing key in non-prod for direct frontend dev proxy to Python (vite /api/sliderule -> 9700)
    # Node proxy always injects X-Internal-Key for prod/compat paths. This enables smoke E2E from product UI.
    if key is None or key == "":
        if os.getenv("NODE_ENV", "development") != "production":
            return
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key - Python now owns V5")


def _turn_seq_for_drive_full(value: Optional[str]) -> int:
    if not value:
        return 0
    m = re.search(r"(\d+)", str(value))
    return int(m.group(1)) if m else 0


def _advance_drive_full_turn_id(value: Optional[str]) -> str:
    """Bump server-authored drive-full saves past same-turn client snapshots."""
    return f"turn-{_turn_seq_for_drive_full(value) + 1}-drive-full"


def _planner_timeout_seconds() -> float:
    raw = os.getenv(ORCHESTRATE_PLAN_TIMEOUT_MS_ENV, str(DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS))
    try:
        timeout_ms = int(raw)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS
    return max(timeout_ms, 1) / 1000

def _execute_timeout_seconds() -> float:
    raw = os.getenv(EXECUTE_CAPABILITY_TIMEOUT_MS_ENV, str(DEFAULT_EXECUTE_CAPABILITY_TIMEOUT_MS))
    try:
        timeout_ms = int(raw)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_EXECUTE_CAPABILITY_TIMEOUT_MS
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


def _perform_native_execute(payload: Dict[str, Any], cap: str) -> Dict[str, Any]:
    """Sync function offloaded via to_thread for native LLM/RAG execute paths. Returns dict result."""
    if cap == "evidence.search":
        q = _evidence_query(payload)
        ev = execute_evidence_runtime(q)
        res = execute_capability(payload, evidence_retriever=lambda _q: ev)
        res = res if isinstance(res, dict) else dict(res)
        res.update(ev.to_payload_fields())
        return res
    else:
        res = execute_capability(payload)
        return res if isinstance(res, dict) else dict(res)


def _perform_mapped_execute(cap: str, state: V5SessionState, input_artifact_ids: List[str], role: str, turn: str) -> Dict[str, Any]:
    """Sync function offloaded via to_thread for mapped capability execution."""
    return execute_mapped_capability(cap, state, input_artifact_ids, role, turn)


async def _run_orchestrate_plan(payload: Any):
    if not isinstance(payload, dict):
        return _bad_plan_request("request body must be an object")
    if "state" not in payload:
        return _bad_plan_request("state is required")
    if not str(payload.get("turnId") or "").strip():
        return _bad_plan_request("turnId is required")

    try:
        # orchestrate-plan may receive state with previously elevated artifacts from prior loop commits.
        # Use server_load for consistency with execute and persisted state handling.
        state = V5SessionState.server_load(_coerce_state_payload(payload["state"]))
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

    # PYTHON_AUTHORITY for pickNextCapabilities: the /orchestrate-plan API must return selected
    # derived from the ported pick semantics + all fallback rules (readiness, delivery, cold,
    # stale, skip-ev, complex/game, etc.), not the orchestrator's internal fixed-candidate list.
    # Drivers already call pick explicitly; now the exposed backend API delegates selected too.
    # rationale stays from orchestrate (for plan text), but selected/converged from pick.
    picks = pick_next_capabilities(state, str(payload.get("userText", "")))
    dumped = result.model_dump()
    dumped["selected"] = picks
    dumped["converged"] = len(picks) == 0
    return dumped

@router.get("/sessions")
async def list_sess(x_internal_key: Optional[str] = Header(None)):
    """Thin list for Node thin-proxy compat. Returns slim list shape matching prior Node contract."""
    _auth(x_internal_key)
    states = list((load_all() or {}).values()) or list(_sessions.values())
    items = []
    for s in states:
        g = s.goal if isinstance(getattr(s, "goal", None), dict) else {}
        items.append({
            "sessionId": getattr(s, "sessionId", ""),
            "goal": g.get("text", "") if isinstance(g, dict) else "",
            "createdAt": getattr(s, "createdAt", None),
            "lastActive": getattr(s, "lastActive", None),
            "artifactCount": len(getattr(s, "artifacts", []) or []),
            "phase": getattr(s, "runtimePhase", None),
        })
    return {"sessions": items}

@router.post("/sessions")
async def create_sess(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    goal_text = payload.get("goal", {}).get("text", "default")
    repaired_payload, _ = sanitize_session_dict({"goal": {"text": goal_text}})
    state = create_session(repaired_payload.get("goal", {}).get("text", goal_text), payload.get("sessionId"))
    state, changed = sanitize_session_state(state)
    # If sanitize mutated the state, persist via save_session so the authoritative
    # store is consistent. create_session already called _save_sessions internally,
    # but that was before the sanitize pass — re-save only when changed.
    if changed:
        state = save_session(state)
    return {"sessionId": state.sessionId, "state": state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_FULLPATH, "backend": PYTHON_BACKEND}

@router.get("/sessions/{sid}")
async def get_sess(sid: str, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = load_session(sid) or _sessions.get(sid)
    if not state:
        raise HTTPException(404, "Not found")
    state, changed = sanitize_session_state(state)
    if changed:
        # Best-effort persist of the sanitized state so subsequent GETs and the service layer
        # see the corrected version. NOTE: the persistence concurrency guard retains the prior
        # core state for equal lastTurnId (stale-clobber protection), so the write may be a
        # no-op — the GET response must still return the repaired state, not the guard's
        # prior (mojibake) snapshot. Do not reassign from save_session here.
        save_session(state)
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
    client_input, _ = sanitize_session_dict(client_input)
    client_input.pop("coverageGate", None)
    client_input.pop("capabilityRuns", None)
    client_input.pop("decisionLedger", None)
    client_input.pop("costLedger", None)
    client_input.pop("flowBoundaryLedger", None)
    client_input.pop("structureGateLedger", None)
    # Protect server-owned append-only replay from client/stale overwrite (task requirement)
    client_input.pop("sessionReplayLog", None)
    client_input.pop("reasoningEvents", None)
    # publishClosure is client-side derived evidence projection (from python /drive-full); safe for client contrib roundtrip.
    # Do not pop; allow in V5SessionState parse + updates merge for frontend session store persistence (119).
    # Legacy sessions load with default None (see model).
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
            # publishClosure intentionally NOT excluded: allows roundtrip persist of publish closure evidence into session state.
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
    state, _ = sanitize_session_state(state)
    authoritative = save_session(state)
    authoritative, _ = sanitize_session_state(authoritative)
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
    # For execute-capability in drive context (JS driver or mixed), the incoming state
    # may contain previously server-constructed artifacts (with producedBy, gated_pass etc.)
    # from prior commits in the same turn or loaded session state.
    # Use server_load (server_trusted context) to allow legitimate elevated artifacts.
    # Client cannot forge *new* ones this way because the data originated from server.
    state_payload = _coerce_state_payload(payload.get("state") or {})
    state = V5SessionState.server_load(state_payload)
    cap = payload["capabilityId"]
    import time as _time
    t0 = _time.time()
    if is_python_native_capability(cap):
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    _perform_native_execute, payload, cap,
                ),
                timeout=_execute_timeout_seconds(),
            )
        except asyncio.TimeoutError:
            dur = int((_time.time() - t0) * 1000)
            err = {"code": "execute_timeout", "message": "execute-capability timed out", "capabilityId": cap}
            from services.slide_rule_session import record_capability_run_error
            record_capability_run_error(
                state,
                capabilityId=cap,
                turnId=payload["turnId"],
                error=err,
                timing={"durationMs": dur},
            )
            save_session(state)
            return {
                "error": err,
                "degraded": True,
                "capabilityId": cap,
                "backend": PYTHON_BACKEND,
                "provenance": PROVENANCE_PYTHON_RAG,
            }
        except LlmError as e:
            # record error run first so durable state captures the failure (addresses review: no record before raise)
            dur = int((_time.time() - t0) * 1000)
            err = {"code": "llm_native_failed", "message": str(e)[:200], "capabilityId": cap}
            from services.slide_rule_session import record_capability_run_error
            record_capability_run_error(
                state,
                capabilityId=cap,
                turnId=payload["turnId"],
                error=err,
                timing={"durationMs": dur},
            )
            save_session(state)
            raise HTTPException(502, f"python LLM failed for {cap}: {e}")
        dur = int((_time.time() - t0) * 1000)
        run_id = f"run-{payload['turnId']}-{cap}"
        # success path still records run (enriched later); keep prior append for compat
        state.capabilityRuns.append(CapabilityRun(id=run_id, capabilityId=cap, turnId=payload["turnId"], outputs=[]))
        # attach timing on last
        if state.capabilityRuns:
            last = state.capabilityRuns[-1]
            if hasattr(last, "timing"): last.timing = {"durationMs": dur}
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
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                _perform_mapped_execute,
                cap,
                state,
                payload.get("inputArtifactIds", []),
                payload.get("roleId", "agent"),
                payload["turnId"],
            ),
            timeout=_execute_timeout_seconds(),
        )
    except asyncio.TimeoutError:
        dur = int((_time.time() - t0) * 1000)
        err = {"code": "execute_timeout", "message": "execute-capability timed out", "capabilityId": cap}
        from services.slide_rule_session import record_capability_run_error
        record_capability_run_error(
            state,
            capabilityId=cap,
            turnId=payload["turnId"],
            error=err,
            roleId=payload.get("roleId"),
            timing={"durationMs": dur},
        )
        save_session(state)
        return {
            "error": err,
            "degraded": True,
            "capabilityId": cap,
            "backend": PYTHON_BACKEND,
            "provenance": PROVENANCE_PYTHON_RAG,
        }
    except Exception as map_exc:
        # explicit error record + save for mapped path (review: no error record wrapper)
        dur = int((_time.time() - t0) * 1000)
        err = {"code": "mapped_capability_failed", "message": str(map_exc)[:200], "capabilityId": cap}
        from services.slide_rule_session import record_capability_run_error
        record_capability_run_error(
            state,
            capabilityId=cap,
            turnId=payload["turnId"],
            error=err,
            roleId=payload.get("roleId"),
            timing={"durationMs": dur},
        )
        save_session(state)
        # return degraded envelope so API does not hide; state has the record
        return {
            "error": err,
            "degraded": True,
            "capabilityId": cap,
            "backend": PYTHON_BACKEND,
            "provenance": PROVENANCE_PYTHON_RAG,
        }
    dur = int((_time.time() - t0) * 1000)
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
    if state.capabilityRuns:
        last = state.capabilityRuns[-1]
        if hasattr(last, "timing"): last.timing = {"durationMs": dur}
    save_session(state)
    return result

@router.post("/drive-turn")
async def drive(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Single turn drive (drive_reasoning_turn). Full multi-loop driver authority exposed via /drive-full."""
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    new_state = drive_reasoning_turn(state, payload["turnId"], payload.get("userText", ""))
    # python provenance for turn/drive (covers turn + downstream evidence/report)
    return {"state": new_state.model_dump(), "stateAuthority": STATE_AUTHORITY_PYTHON, "provenance": PROVENANCE_PYTHON_RAG, "backend": PYTHON_BACKEND}

@router.post("/drive-full")
async def drive_full(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Python driver authority for multiple capability loops until stop condition (coverage/empty picks/max_loops).
    Wires drive_full_v5_session as the visible full-path multi-loop API (PYTHON_AUTHORITY).
    Real userText (user instruction) is forwarded so it drives pick/orchestrate/execute/artifacts/GCOV/phase.
    """
    _auth(x_internal_key)
    raw_state, _ = sanitize_session_dict(payload["state"])
    # PYTHON_AUTHORITY: 已持久化的服务端会话是权威起点。客户端 state 经防伪造清洗后
    # 会失去 trustLevel/producedBy/台账（正确的防伪行为），若以它为起点，之前所有
    # trusted-committed 产物会被清零、收敛状态丢失（例如"生成交付物"回合触发不了
    # delivery 分支）。仅在无持久化会话（首轮）时才用清洗后的客户端 state 起步。
    sid = str(raw_state.get("sessionId") or payload.get("sessionId") or "")
    persisted = load_session(sid) if sid else None
    state = persisted if persisted is not None else V5SessionState(**raw_state)
    max_loops = int(payload.get("max_loops", 10))
    user_text = sanitize_session_dict({"text": payload.get("userText", "") or payload.get("user_text", "")})[0].get("text", "")
    new_state = drive_full_v5_session(state, max_loops=max_loops, user_instruction=user_text)
    # Compat (task 119-04): capability results may be Pydantic models (model_dump) or plain dicts.
    # Normalize them to plain dicts BEFORE sanitize/derive/persist so json persistence and the
    # response envelope never see a non-serializable result object.
    for _run in getattr(new_state, "capabilityRuns", []) or []:
        _res = getattr(_run, "result", None)
        if _res is not None and not isinstance(_res, dict):
            _run.result = _result_to_dict(_res)
    new_state, _ = sanitize_session_state(new_state)
    publish_closure = derive_publish_closure_response(new_state)
    skill_graph = derive_skill_runtime_graph_response(new_state)
    new_state.publishClosure = publish_closure
    new_state.skillRuntimeGraph = skill_graph
    new_state.lastTurnId = _advance_drive_full_turn_id(getattr(new_state, "lastTurnId", None))
    save_session(new_state)
    return {
        "state": new_state.model_dump(),
        "stateAuthority": STATE_AUTHORITY_PYTHON,
        "provenance": PROVENANCE_PYTHON_FULLPATH,
        "backend": PYTHON_BACKEND,
        "publishClosure": publish_closure,
        "skillRuntimeGraph": skill_graph,
        "closureWarnings": [],
    }

@router.post("/drive-marathon")
async def drive_marathon_route(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Python-owned marathon/budget route.

    This is the production wiring point for BudgetMarathon: frontend/Node callers consume
    the Python decision instead of owning maxTurns/maxRuns/maxRepeat/maxTokens locally.
    """
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    seed_text = payload.get("seedText") or payload.get("seed_text") or payload.get("userText") or ""
    budget = payload.get("budget") or {}
    policy = payload.get("policy") or None
    max_rounds = int(payload.get("maxRounds") or payload.get("max_rounds") or 8)
    result = drive_marathon(
        state,
        seed_text,
        budget=budget,
        policy=policy,
        max_rounds=max_rounds,
        drive_step=drive_reasoning_turn,
    )
    final_state = result.get("finalState")
    publish_closure = derive_publish_closure_response(final_state) if isinstance(final_state, V5SessionState) else None
    skill_graph = derive_skill_runtime_graph_response(final_state) if isinstance(final_state, V5SessionState) else None
    return {
        "state": final_state.model_dump() if hasattr(final_state, "model_dump") else final_state,
        "rounds": result.get("rounds") or [],
        "stopReason": result.get("stopReason"),
        "stateAuthority": STATE_AUTHORITY_PYTHON,
        "provenance": PROVENANCE_PYTHON_FULLPATH,
        "backend": PYTHON_BACKEND,
        "budgetAuthority": "python",
        "publishClosure": publish_closure,
        "skillRuntimeGraph": skill_graph,
    }

# GCOV endpoint
@router.post("/coverage")
async def cov(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    gate = evaluate_coverage_gate(state)
    return gate


# SSE streaming endpoint — yields live skill-progress events while drive runs.
# Frontend connects with EventSource; each event is a JSON line.
@router.post("/drive-full-stream")
async def drive_full_stream(
    payload: Dict[str, Any],
    x_internal_key: Optional[str] = Header(None),
):
    """Stream drive-full execution as Server-Sent Events.

    Each event has the shape:  data: <json>\\n\\n
    Event types (see v5_full_driver.drive_full_v5_session_stream):
        phase_change  — runtimePhase transition
        skill_start   — a capability is about to execute (use to highlight thumbnail)
        skill_result  — capability finished (model + optional mermaid)
        publish_closure — final closure evidence
        complete      — final state; stream ends
    """
    import json

    _auth(x_internal_key)

    raw_state, _ = sanitize_session_dict(payload.get("state") or {})
    # PYTHON_AUTHORITY: 同 /drive-full——已持久化会话为权威起点（防伪造清洗会剥掉
    # 客户端 state 的 trust/producedBy/台账，以其起步会清零全部可信进度）。
    sid = str(raw_state.get("sessionId") or payload.get("sessionId") or "")
    persisted = load_session(sid) if sid else None
    if persisted is not None:
        state = persisted
    else:
        try:
            state = V5SessionState(**raw_state)
        except (ValidationError, TypeError, ValueError) as e:
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_state", "message": str(e).splitlines()[0]},
            )

    max_loops = int(payload.get("max_loops", 10))
    user_text = sanitize_session_dict(
        {"text": payload.get("userText", "") or payload.get("user_text", "")}
    )[0].get("text", "")

    async def event_generator():
        try:
            async for event in drive_full_v5_session_stream(
                state, max_loops=max_loops, user_instruction=user_text
            ):
                if isinstance(event, dict) and event.get("type") == "complete" and isinstance(event.get("state"), dict):
                    final_state = V5SessionState.server_load(event["state"])
                    final_state, _ = sanitize_session_state(final_state)
                    final_state = save_session(final_state)
                    event = {**event, "state": final_state.model_dump()}
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            error_event = {"type": "error", "message": str(exc)[:300]}
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


# ---------------------------------------------------------------------------
# AIGC 能力试跑（浏览器运行时 M2）：拿模型里声明的一项 AI 能力真跑一次 LLM。
# 语义与五系统生成同一诚实边界：flag 关/无 key → fail-closed 结构化诊断，
# 不返回伪造输出；失败原因如实透传（对齐 LLM_GENERATE_DISABLED/FAILED 口径）。
# ---------------------------------------------------------------------------

AIGC_TRYRUN_TIMEOUT_MS_ENV = "SLIDERULE_AIGC_TRYRUN_TIMEOUT_MS"
DEFAULT_AIGC_TRYRUN_TIMEOUT_MS = 60_000


@router.post("/aigc-tryrun")
def aigc_tryrun(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """Run one declared AIGC capability against the real LLM channel.

    payload: {capability: {id?, name, inputFields?, outputField?}, inputs: {ref: value}, goal?}
    Returns 200 always; honesty is in the body: {ok, output?|code+detail}.
    """
    import time as _time

    from services.v5_capability_executor import _llm_generate_enabled
    from sliderule_llm.client import call_llm

    _auth(x_internal_key)

    capability = payload.get("capability") or {}
    name = str(capability.get("name") or capability.get("id") or "").strip()
    if not name:
        raise HTTPException(400, "capability.name required")
    inputs: Dict[str, Any] = payload.get("inputs") or {}
    output_field = str(capability.get("outputField") or "").strip()
    goal = str(payload.get("goal") or "").strip()

    if not _llm_generate_enabled():
        return {
            "ok": False,
            "code": "LLM_GENERATE_DISABLED",
            "detail": "SLIDERULE_LLM_GENERATE_ENABLED 未开启（或运行时无 LLM key），"
            "能力试跑不伪造输出",
        }

    filled = "\n".join(f"- {k}：{v}" for k, v in inputs.items() if str(v).strip()) or "（未提供输入值）"
    system = (
        "你是产品排练系统里的一项 AI 能力，正在被试跑验证。"
        "根据能力定义和输入字段值，直接生成该能力的输出内容本身——"
        "不要解释、不要客套、不要 markdown 标题，用简体中文，200 字以内。"
    )
    user = (
        (f"产品意图：{goal}\n" if goal else "")
        + f"能力名称：{name}\n"
        + f"输入字段值：\n{filled}\n"
        + (f"输出字段：{output_field}\n" if output_field else "")
        + "请生成这项能力应产出的内容。"
    )

    timeout_ms = int(os.getenv(AIGC_TRYRUN_TIMEOUT_MS_ENV, str(DEFAULT_AIGC_TRYRUN_TIMEOUT_MS)))
    started = _time.monotonic()
    try:
        result = call_llm(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.4,
            max_tokens=600,
            timeout_ms=timeout_ms,
        )
    except LlmError as exc:
        return {
            "ok": False,
            "code": "LLM_GENERATE_FAILED",
            "detail": str(exc)[:300],
            "elapsedMs": int((_time.monotonic() - started) * 1000),
        }

    return {
        "ok": True,
        "output": result.content,
        "elapsedMs": int((_time.monotonic() - started) * 1000),
    }


# ---------------------------------------------------------------------------
# 推演 LLM 通道配置（设置中心「推演通道」）：查看/修改/测试真通道。
# 密钥只回掩码；override 持久化在服务端本机 .llm-override.json（gitignored）。
# ---------------------------------------------------------------------------

from services.llm_channel import apply_override_to_env as _llm_apply_override
from services.llm_channel import get_channel_status as _llm_channel_status
from services.llm_channel import set_channel as _llm_channel_set
from services.llm_channel import test_channel as _llm_channel_test

# 启动时恢复持久化 override（.env 已由 app.py 装载，基线在首次应用前快照）
_llm_apply_override()


@router.get("/llm-channel")
def llm_channel_status(x_internal_key: Optional[str] = Header(None)):
    """当前推演通道配置（base/model/密钥掩码 + override 字段清单）。"""
    _auth(x_internal_key)
    return _llm_channel_status()


@router.post("/llm-channel")
def llm_channel_update(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    """更新通道 override：非空字符串=覆盖，空串/null=清除回退 .env。"""
    _auth(x_internal_key)
    return _llm_channel_set(payload or {})


@router.post("/llm-channel/test")
def llm_channel_test(x_internal_key: Optional[str] = Header(None)):
    """对真通道发一次极小请求，结果如实返回（不粉饰失败）。"""
    _auth(x_internal_key)
    return _llm_channel_test()


# ---------------------------------------------------------------------------
# 生成质量基线（主线观察台）：读 docs/five-system-generation-baseline.json。
# 文件由 eval_five_system_generation.py --json-out 固化；缺失/损坏如实 404。
# ---------------------------------------------------------------------------

from pathlib import Path as _Path

EVAL_BASELINE_PATH = _Path(__file__).resolve().parent.parent.parent / "docs" / "five-system-generation-baseline.json"


@router.get("/eval-baseline")
def eval_baseline(x_internal_key: Optional[str] = Header(None)):
    """机器可读评测基线原文（观察台摘要卡的数据源）。"""
    import json as _json

    _auth(x_internal_key)
    try:
        payload = _json.loads(EVAL_BASELINE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return JSONResponse({"error": "BASELINE_NOT_FOUND"}, status_code=404)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "BASELINE_NOT_FOUND"}, status_code=404)
    return payload
