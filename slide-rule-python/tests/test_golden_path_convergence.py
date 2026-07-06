"""Golden path convergence: coverage gaps resolve after trusted commits and
the full driver converges instead of stalling on max_repeat_guard.

Regression for the live stall found on 2026-07-06: capabilities executed and
committed with producedBy + trust ledger, but nothing resolved the coverage
gaps (resolveCoverageGapsFromState was never ported) and the picker never
selected contract-required critique.generate — the loop then died on
max_repeat_guard with all blocking gaps still open.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import ProducedBy, V5SessionState  # noqa: E402
from services.slide_rule_coverage import (  # noqa: E402
    author_coverage_contract,
    evaluate_coverage_gate,
    resolve_coverage_gaps_from_state,
)
from services.slide_rule_session import commit_artifact, pick_next_capabilities  # noqa: E402

COMPLEX_GOAL = "做一个宠物医院预约管理系统，包含预约排班、宠物档案和医生工作台"


def _state_with_contract() -> V5SessionState:
    state = V5SessionState(
        sessionId="golden-conv-test",
        goal={"text": COMPLEX_GOAL},
        artifacts=[],
    )
    authored = author_coverage_contract(COMPLEX_GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


def _commit(state: V5SessionState, cap: str, loop: int = 0) -> None:
    commit_artifact(
        state,
        id=f"art-{loop}-{cap}",
        kind="evidence" if "evidence" in cap else "risk",
        content=f"executed {cap} with real output",
        summary=f"{cap} done",
        provenance="python-rag",
        producedBy=ProducedBy(capabilityRunId=f"run-{loop}-{cap}", capabilityId=cap),
        turnId=f"loop-{loop}",
        sources=[{"content": "evidence", "source": "internal-policy-v1", "id": "rbac1"}],
    )


def test_resolve_closes_capability_gap_after_trusted_commit():
    state = _state_with_contract()
    _commit(state, "risk.analyze")

    state = resolve_coverage_gaps_from_state(state)

    by_cap = {g.get("requiredCapabilityId") or g.get("kind"): g.get("status") for g in state.coverageGaps}
    assert by_cap["risk.analyze"] == "resolved"
    assert by_cap["critique.generate"] == "open"  # not committed → stays open


def test_resolve_closes_evidence_gap_when_grounded_count_met():
    state = _state_with_contract()
    _commit(state, "evidence.search")

    state = resolve_coverage_gaps_from_state(state)

    ev = [g for g in state.coverageGaps if g.get("kind") == "missing_evidence"]
    assert ev and ev[0].get("status") == "resolved"


def test_gate_passes_after_all_required_caps_committed_and_resolved():
    state = _state_with_contract()
    for cap in ["critique.generate", "risk.analyze", "synthesis.merge", "evidence.search"]:
        _commit(state, cap)

    state = resolve_coverage_gaps_from_state(state)
    gate = evaluate_coverage_gate(state)

    assert gate["passed"] is True, gate["reason"]
    assert gate["missingCapabilities"] == []
    assert gate["unresolvedGaps"] == []


def test_picker_fills_contract_required_capability_missed_by_heuristics():
    state = _state_with_contract()
    # 已提交除 critique.generate 外的所有前置能力（复刻线上死锁前的状态）
    for cap in ["risk.analyze", "synthesis.merge", "evidence.search"]:
        _commit(state, cap)
    state = resolve_coverage_gaps_from_state(state)

    picks = pick_next_capabilities(state, "继续")

    assert any(p["capabilityId"] == "critique.generate" for p in picks), picks


def test_full_driver_converges_instead_of_max_repeat_guard_stall(tmp_path, monkeypatch):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    from services.v5_full_driver import drive_full_v5_session

    state = V5SessionState(
        sessionId="golden-conv-drive",
        goal={"text": COMPLEX_GOAL},
        artifacts=[],
    )
    out = drive_full_v5_session(state, user_instruction=COMPLEX_GOAL, max_loops=8)
    final = out["finalState"] if isinstance(out, dict) and "finalState" in out else out
    if isinstance(final, dict):
        phase = final.get("runtimePhase")
        await_reason = final.get("awaitReason")
        goal_status = (final.get("goal") or {}).get("status")
    else:
        phase = getattr(final, "runtimePhase", None)
        await_reason = getattr(final, "awaitReason", None)
        goal = getattr(final, "goal", {}) or {}
        goal_status = goal.get("status") if isinstance(goal, dict) else None

    assert await_reason != "max_repeat_guard", f"stalled: {await_reason}"
    assert phase == "done" or goal_status == "clear", (
        f"golden path must converge, got phase={phase} await={await_reason} goal={goal_status}"
    )
