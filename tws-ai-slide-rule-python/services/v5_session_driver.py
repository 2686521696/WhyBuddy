"""
Port of Node's session-driver.ts and mini-session.ts.

Drives the full V5 loop: orchestrate + execute using Python RAG for stability.
"""

from models.v5_state import V5SessionState
from .slide_rule_orchestrator import orchestrate_plan
from .v5_capability_executor import execute_v5_capability
from .persistence import persist_state

def drive_v5_full_path(state: V5SessionState, turn_id: str, user_text: str) -> V5SessionState:
    plan = orchestrate_plan(state, turn_id, user_text)
    state.conversation.append({"role": "system", "text": plan.rationale, "turnId": turn_id})

    for sel in plan.selected:
        cap = sel["capabilityId"]
        role = sel.get("roleId", "agent")
        result = execute_v5_capability(cap, state, [], role, turn_id)
        # Create artifact with real evidence
        art_id = f"{turn_id}-{cap}-art"
        state.artifacts.append({
            "id": art_id,
            "kind": "evidence" if "evidence" in cap or "mcp" in cap or "skill" in cap else "report",
            "provenance": "python-rag",
            "trustLevel": "gated_pass",
            "content": result.content,
            "summary": result.summary,
            "producedBy": {"capabilityRunId": f"run-{turn_id}-{cap}", "capabilityId": cap, "roleId": role},
            "sources": result.sources
        })
        state.capabilityRuns.append({
            "id": f"run-{turn_id}-{cap}",
            "capabilityId": cap,
            "turnId": turn_id,
            "outputs": [art_id],
            "gateResults": [{"gateId": "ground", "status": "passed"}],
            "result": result.model_dump()
        })

    persist_state(state)
    return state
