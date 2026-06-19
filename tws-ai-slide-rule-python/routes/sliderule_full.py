"""
SlideRule V5 API (full baseline surface).

Mounted as the primary /api/sliderule in app.py.
Uses execute_mapped_capability for execute-capability (core + structure, instruction, handoff, visual etc.).
RAG-backed. Matches the Node delegation contract for V5 paths.

See audit / FINAL_MIGRATION_STATUS.md for exact coverage vs. "all historical caps".
"""

import asyncio
import os

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from typing import Dict, Any, List, Optional
from models.v5_state import CapabilityRun, V5SessionState
from services.slide_rule_session import create_session, load_session, save_session, drive_reasoning_turn
from services.slide_rule_orchestrator import orchestrate_plan
from services.v5_capability_executor import execute_v5_capability
from services.slide_rule_coverage import author_coverage_contract, evaluate_coverage_gate, reconcile_coverage
from services.capability_maps import execute_mapped_capability
from services.v5_session_driver import drive_v5_full_path
from config.settings import settings
from sliderule_llm.capabilities import execute_capability, is_python_native_capability
from sliderule_llm.client import LlmError

router = APIRouter(tags=["SlideRule V5 (Full Migration to Python)"])  # prefix handled at include time to avoid double /api/sliderule/api/sliderule/...

_sessions: Dict[str, V5SessionState] = {}  # In prod, use DB like Python knowledge
ORCHESTRATE_PLAN_TIMEOUT_MS_ENV = "SLIDERULE_ORCHESTRATE_PLAN_TIMEOUT_MS"
DEFAULT_ORCHESTRATE_PLAN_TIMEOUT_MS = 120_000

def _auth(key: Optional[str]):
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

def _degraded_plan(error_code: str, reason: str, message: str) -> Dict[str, Any]:
    return {
        "selected": [],
        "rationale": "Python orchestrate.plan could not produce a planner result.",
        "source": "python-rag",
        "converged": False,
        "degraded": True,
        "error": error_code,
        "reason": reason,
        "message": message[:300],
        "fallbackAvailable": False,
    }

async def _run_orchestrate_plan(payload: Any):
    if not isinstance(payload, dict):
        return _bad_plan_request("request body must be an object")
    if "state" not in payload:
        return _bad_plan_request("state is required")
    if not str(payload.get("turnId") or "").strip():
        return _bad_plan_request("turnId is required")

    try:
        state = V5SessionState(**payload["state"])
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
    return {"sessionId": state.sessionId, "state": state.model_dump()}

@router.get("/sessions/{sid}")
async def get_sess(sid: str, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = load_session(sid) or _sessions.get(sid)
    if not state:
        raise HTTPException(404, "Not found")
    return {"state": state.model_dump()}

@router.put("/sessions/{sid}")
async def save_sess(sid: str, state: V5SessionState, x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    save_session(state)
    _sessions[sid] = state
    return {"ok": True}

@router.post("/orchestrate-plan")
async def plan(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return await _run_orchestrate_plan(payload)

@router.post("/execute-capability")
async def exec_cap(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    cap = payload["capabilityId"]
    if is_python_native_capability(cap):
        try:
            result = execute_capability(payload)
        except LlmError as e:
            raise HTTPException(502, f"python LLM failed for {cap}: {e}")
        run_id = f"run-{payload['turnId']}-{cap}"
        state.capabilityRuns.append(CapabilityRun(id=run_id, capabilityId=cap, turnId=payload["turnId"], outputs=[]))
        save_session(state)
        return result
    # Use mapped for all V5 caps - stable RAG
    result = execute_mapped_capability(cap, state, payload.get("inputArtifactIds", []), payload.get("roleId", "agent"), payload["turnId"])
    # For tools/evidence, always "introduce" via RAG
    if cap in ["mcp.call", "skill.invoke", "evidence.search"]:
        result["summary"] = "检索了外部证据"
        result["provenance"] = "python-rag"
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
    return {"state": new_state.model_dump()}

# GCOV endpoint
@router.post("/coverage")
async def cov(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    state = V5SessionState(**payload["state"])
    gate = evaluate_coverage_gate(state)
    return gate
