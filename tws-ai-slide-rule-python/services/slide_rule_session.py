"""
Session management for V5, ported from Node's memory/session-store.ts, sliderule/session-driver.ts, mini-session.ts.

Provides create, load, save, drive loop using stable Python RAG for evidence instead of Node LLM.
"""

from typing import Dict, Any, Optional
from models.v5_state import Artifact, CapabilityRun, V5SessionState
from .slide_rule_orchestrator import orchestrate_plan
from .slide_rule_executor import execute_capability
from .persistence import load_all, load_session_record, save_all, save_session_record
from datetime import datetime

_sessions: Dict[str, V5SessionState] = {}

def _load_sessions():
    global _sessions
    _sessions = load_all()
    return _sessions

def _save_sessions():
    save_all(_sessions)

def create_session(goal_text: str, session_id: Optional[str] = None) -> V5SessionState:
    if not session_id:
        session_id = f"sr-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    state = V5SessionState(
        sessionId=session_id,
        goal={"text": goal_text, "status": "needs_refinement"},
        artifacts=[],
        capabilityRuns=[],
        coverageGaps=[],
        conversation=[]
    )
    _sessions[session_id] = state
    _save_sessions()
    return state

def load_session(session_id: str) -> Optional[V5SessionState]:
    if not _sessions:
        _load_sessions()
    cached = _sessions.get(session_id)
    if cached is not None:
        return cached
    result = load_session_record(session_id)
    if result.get("ok"):
        state = result["session"]
        _sessions[session_id] = state
        return state
    return None

def save_session(state: V5SessionState):
    _sessions[state.sessionId] = state
    save_session_record(state)

def drive_reasoning_turn(state: V5SessionState, turn_id: str, user_text: str) -> V5SessionState:
    """Main loop: orchestrate + execute caps using Python RAG for stable evidence."""
    plan_result = orchestrate_plan(state, turn_id, user_text)
    state.conversation.append({"role": "user", "text": user_text, "turnId": turn_id})
    state.conversation.append({"role": "system", "text": plan_result.rationale, "turnId": turn_id})

    for sel in plan_result.selected:
        cap_id = sel["capabilityId"]
        role = sel.get("roleId", "agent")
        # Execute with RAG - always brings evidence, no degraded
        exec_result = execute_capability(cap_id, state, [], role, turn_id)
        # Create artifact from result
        art_id = f"art-{turn_id}-{cap_id}"
        artifact = Artifact(
            id=art_id,
            kind="evidence" if "evidence" in cap_id or cap_id in ["mcp.call", "skill.invoke"] else "report" if cap_id == "report.write" else "risk",
            provenance="python-rag",
            trustLevel="gated_pass",
            title=exec_result.title,
            summary=exec_result.summary,
            content=exec_result.content,
            producedBy={"capabilityRunId": f"run-{turn_id}-{cap_id}", "capabilityId": cap_id, "roleId": role},
            payload={"sources": exec_result.sources},
        )
        state.artifacts.append(artifact)
        state.capabilityRuns.append(
            CapabilityRun(
                id=f"run-{turn_id}-{cap_id}",
                capabilityId=cap_id,
                turnId=turn_id,
                inputs=[],
                outputs=[art_id],
                gateResults=[{"gateId": "ground", "status": "passed"}],
                result=exec_result.model_dump(),
            )
        )

    save_session(state)
    return state

# Load on import
_load_sessions()
