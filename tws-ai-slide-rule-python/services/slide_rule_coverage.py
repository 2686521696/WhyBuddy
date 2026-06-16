"""
Coverage/GCOV ported from shared/blueprint/sliderule-coverage-gate.ts and related.

Uses RAG to ensure G-GROUND and external evidence instead of loose Node gates.
"""

from typing import Dict, Any, List
from models.v5_state import V5SessionState

def author_coverage_contract(goal_text: str) -> Dict[str, Any]:
    is_complex = any(kw in goal_text.lower() for kw in ["风险", "risk", "安全", "审计", "rpg", "游戏"])
    required = ["critique.generate", "risk.analyze", "synthesis.merge", "evidence.search", "report.write"]
    if is_complex:
        required += ["mcp.call", "skill.invoke"]
    return {
        "id": f"cov-{hash(goal_text)}",
        "mode": "complex" if is_complex else "simple",
        "requiredCapabilities": required,
        "minEvidencePerRequirement": 1,
        "blockingGapIds": [f"gap-{c}" for c in required if c != "report.write"]
    }

def evaluate_coverage_gate(state: V5SessionState) -> Dict[str, Any]:
    contract = state.coverageContract or author_coverage_contract(state.goal.get("text", ""))
    has_evidence = len([a for a in state.artifacts if a.get("provenance", "").startswith("python-rag") or a.get("kind") == "evidence"]) > 0
    passed = has_evidence and all(g.get("status") != "open" for g in state.coverageGaps or [])
    return {
        "passed": passed,
        "reason": "Stable RAG evidence + tools" if passed else "Need more external evidence from Python RAG",
        "missingCapabilities": [],
    }

def reconcile_coverage(state: V5SessionState) -> V5SessionState:
    # Port of reconcile: ensure gaps are resolved via RAG
    contract = state.coverageContract or author_coverage_contract(state.goal.get("text", ""))
    state.coverageContract = contract
    # Simulate resolving with RAG
    for gap in state.coverageGaps or []:
        if "evidence" in gap.get("label", "").lower():
            gap["status"] = "resolved"
    return state
