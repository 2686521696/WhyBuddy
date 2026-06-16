"""
SlideRule V5 routes (baseline surface).

Exposes sessions, orchestrate-plan, execute-capability.

The execute-capability now delegates to execute_mapped_capability (capability_maps) for expanded caps
(structure.*, instruction.package, handoff.package, visual, etc.) in addition to core mcp/skill/evidence/report/risk.

Primary mounted surface in app.py is sliderule_full.py which also uses the mapped executor.
This is the thin Python V5 baseline; full historical Node cap parity + real vector RAG still in progress.
"""

from fastapi import APIRouter, HTTPException, Header
from typing import Dict, Any, Optional
from models.v5_state import V5SessionState, ExecuteCapabilityResult, OrchestratePlanResult
from services.slide_rule_orchestrator import orchestrate_plan
from services.capability_maps import execute_mapped_capability
from config.settings import settings

router = APIRouter()

# In-memory session store (migrate to DB like original Python project)
_sessions: Dict[str, V5SessionState] = {}

def _check_internal_key(key: Optional[str]):
    if settings.is_development:
        return
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid internal key for SlideRule calls")

@router.post("/sessions")
async def create_or_update_session(state: V5SessionState, x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    _sessions[state.sessionId] = state
    return {"ok": True, "sessionId": state.sessionId}

@router.get("/sessions/{session_id}")
async def get_session(session_id: str, x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    if session_id not in _sessions:
        raise HTTPException(404, "Session not found")
    return {"state": _sessions[session_id].model_dump()}

@router.post("/orchestrate-plan")
async def do_orchestrate(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    state = V5SessionState(**payload["state"])
    result = orchestrate_plan(state, payload["turnId"], payload.get("userText", ""))
    return result.model_dump()

@router.post("/execute-capability")
async def do_execute(payload: Dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _check_internal_key(x_internal_key)
    state = V5SessionState(**payload["state"])
    cap_id = payload["capabilityId"]
    # Use the mapped executor (capability_maps) so structure.decompose, instruction.package,
    # handoff.package, visual, dialogue, delivery etc. get their dedicated RAG paths
    # instead of only the three special cases in the basic slide_rule_executor.
    result = execute_mapped_capability(
        cap_id,
        state,
        payload.get("inputArtifactIds", []),
        payload.get("roleId", "agent"),
        payload["turnId"],
    )
    return result

# Add more endpoints (list sessions, etc.) as full migration progresses.
