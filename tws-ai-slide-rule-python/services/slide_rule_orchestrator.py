"""
Dynamic SlideRule V5 orchestrator.

This is still heuristic/RAG-backed, but it is no longer a fixed capability list:
it skips already-produced capabilities, expands delivery/prompt-pack paths for
handoff/report goals, and converges when the current state already has the
required outputs.
"""

from typing import List

from models.v5_state import V5SessionState, OrchestratePlanResult
from .rag_service import generate_with_rag, retrieve_evidence


def _goal_text(state: V5SessionState) -> str:
    return state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)


def _has_capability_output(state: V5SessionState, capability_id: str) -> bool:
    for run in state.capabilityRuns:
        if run.capabilityId == capability_id and run.outputs:
            return True
    for artifact in state.artifacts:
        produced_by = artifact.producedBy or {}
        if produced_by.get("capabilityId") == capability_id and artifact.provenance.startswith("python-rag"):
            return True
    return False


def _goal_requires_delivery(goal: str, user_text: str) -> bool:
    text = f"{goal} {user_text}".lower()
    return any(
        keyword in text
        for keyword in [
            "handoff",
            "deliver",
            "report",
            "final",
            "spec",
            "prompt",
            "工程",
            "交付",
            "报告",
            "最终",
            "提示",
            "文档",
        ]
    )


def _goal_requires_structure(goal: str, user_text: str) -> bool:
    text = f"{goal} {user_text}".lower()
    return any(keyword in text for keyword in ["structure", "decompose", "tree", "spec", "结构", "拆解", "需求树"])


def orchestrate_plan(state: V5SessionState, turn_id: str, user_text: str) -> OrchestratePlanResult:
    goal = _goal_text(state)
    evidence = retrieve_evidence(goal, top_k=4)

    candidates: List[dict] = [
        {"capabilityId": "evidence.search", "roleId": "grounding", "why": "Need external evidence for G-GROUND"},
        {"capabilityId": "risk.analyze", "roleId": "safety", "why": "Risk-bearing goal requires risk scan"},
        {"capabilityId": "mcp.call", "roleId": "engineering", "why": "Use tool-style external evidence"},
        {"capabilityId": "skill.invoke", "roleId": "engineering", "why": "Use skill-style synthesis evidence"},
    ]

    if _goal_requires_structure(goal, user_text):
        candidates.append(
            {"capabilityId": "structure.decompose", "roleId": "architecture", "why": "Goal asks for structure/spec decomposition"}
        )

    if _goal_requires_delivery(goal, user_text):
        candidates.extend(
            [
                {"capabilityId": "document.draft", "roleId": "engineering", "why": "Draft delivery document"},
                {"capabilityId": "traceability.matrix", "roleId": "synthesis", "why": "Map requirements to evidence and risks"},
                {"capabilityId": "task.write", "roleId": "product", "why": "Break report into executable tasks"},
                {"capabilityId": "instruction.package", "roleId": "engineering", "why": "Package executable prompts"},
                {"capabilityId": "outcome.visualize", "roleId": "architecture", "why": "Preview expected outcome and architecture"},
                {"capabilityId": "handoff.package", "roleId": "engineering", "why": "Bundle handoff materials"},
            ]
        )

    candidates.append({"capabilityId": "report.write", "roleId": "synthesis", "why": "Deliver structured final report"})
    selected = [item for item in candidates if not _has_capability_output(state, item["capabilityId"])][:8]
    converged = len(selected) == 0

    rationale = generate_with_rag(
        f"Next SlideRule V5 steps for goal: {goal}. Selected capabilities: {[s['capabilityId'] for s in selected]}",
        evidence,
    )

    return OrchestratePlanResult(
        selected=selected,
        rationale=rationale,
        source="python-rag",
        converged=converged,
    )
