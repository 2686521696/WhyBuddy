"""
Focused pytest for Python-owned G_READY + G_CONFIRM/route selection/reject.

Covers: G_READY (prior), G_CONFIRM park, userPicksRoute, userRejectsRouteSelection, expresses,
apply_route stales/clears, evaluate_confirm uses expresses, drive resume for pick after confirm.
Proves Python owns the named route select/reject behaviors directly (no Node). Part of gconfirm-route task.

Run: $env:PYTHONPATH="slide-rule-python"; python -m pytest slide-rule-python/tests/test_sliderule_interactive_gates.py -q --tb=line
"""

import pytest
from datetime import datetime

from services.slide_rule_interactive_gates import (
    open_human_question_gap_count,
    user_clears_readiness,
    evaluate_readiness_gate_after_commit,
    evaluate_interactive_gate_after_commit,
    evaluate_confirm_gate_after_commit,
    resolve_readiness_gaps_from_user_text,
    resolve_readiness_gaps_by_ids,
    gaps_from_gap_ask_content,
    merge_gap_ask_into_state,
    apply_resolve_and_clear_readiness,
    apply_route_selection_resolution,
    user_picks_route,
    user_rejects_route_selection,
    user_expresses_route_selection,
    is_vague_goal,
)
from models.v5_state import V5SessionState, Artifact, ProducedBy


def _mk_state(**overrides):
    now = datetime.now().isoformat()
    base = {
        "sessionId": "sr-test",
        "goal": {"text": "Build a system", "status": "needs_refinement"},
        "artifacts": [],
        "capabilityRuns": [],
        "coverageGaps": [],
        "coverageContract": {"id": "c1", "version": 1, "mode": "simple", "requiredCapabilities": [], "blockingGapIds": []},
        "conversation": [],
        "openQuestions": [],
        "graph": {"nodes": [], "edges": []},
        "staleArtifactIds": [],
    }
    base.update(overrides)
    # ensure contract always valid (overrides may provide partial)
    c = base.get("coverageContract") or {}
    if isinstance(c, dict):
        base["coverageContract"] = {
            "id": c.get("id", "c1"),
            "version": c.get("version", 1),
            "mode": c.get("mode", "simple"),
            "requiredCapabilities": c.get("requiredCapabilities", []),
            "blockingGapIds": c.get("blockingGapIds", []),
        }
    # ensure gaps have required fields for model (createdAt, label)
    if "coverageGaps" in base and base["coverageGaps"]:
        fixed = []
        for g in base["coverageGaps"]:
            if isinstance(g, dict):
                gg = {"createdAt": now, "label": g.get("label") or g.get("id") or "q", **g}
                fixed.append(gg)
            else:
                fixed.append(g)
        base["coverageGaps"] = fixed
    return V5SessionState(**base)


def test_open_human_question_gap_count_counts_only_open_questions():
    gaps = [
        {"id": "g1", "kind": "open_question", "label": "Who are users?", "status": "open"},
        {"id": "g2", "kind": "missing_capability", "label": "need cap", "status": "open"},
        {"id": "g3", "kind": "open_question", "label": "Scope?", "status": "resolved"},
    ]
    st = _mk_state(coverageGaps=gaps)
    assert open_human_question_gap_count(st) == 1


def test_open_human_question_gap_count_respects_blocking():
    gaps = [
        {"id": "g1", "kind": "open_question", "label": "Q1", "status": "open"},
        {"id": "g2", "kind": "open_question", "label": "Q2", "status": "open"},
    ]
    st = _mk_state(coverageGaps=gaps, coverageContract={"blockingGapIds": ["g1"]})
    assert open_human_question_gap_count(st) == 1


def test_user_clears_readiness_requires_substance_or_no_gaps():
    st = _mk_state()
    assert user_clears_readiness("short", st) is False
    assert user_clears_readiness("面向企业内部RBAC权限控制场景", st) is True
    st2 = _mk_state(coverageGaps=[{"id": "g1", "kind": "open_question", "status": "open"}])
    assert user_clears_readiness("面向企业内部使用，补充详细RBAC权限约束范围", st2) is True
    # when gaps remain, short answer does not clear
    assert user_clears_readiness("ok", st2) is False


def test_evaluate_readiness_gate_parks_after_gap_ask_with_open_questions():
    st = _mk_state(coverageGaps=[{"id": "q-1", "kind": "open_question", "label": "Users?", "status": "open"}])
    v = evaluate_readiness_gate_after_commit(st, {"capabilityId": "gap.ask", "turnUserText": "初始目标", "committed": True})
    assert v["park"] is True
    assert v["gate"] == "ready"


def test_evaluate_readiness_gate_does_not_park_if_cleared_by_user_text():
    st = _mk_state(coverageGaps=[{"id": "q-1", "kind": "open_question", "label": "Users?", "status": "open"}])
    v = evaluate_readiness_gate_after_commit(st, {"capabilityId": "gap.ask", "turnUserText": "面向企业内部，RBAC，范围仅MVP", "committed": True})
    assert v["park"] is False


def test_evaluate_interactive_does_not_park_non_clarify_cap():
    st = _mk_state(coverageGaps=[{"id": "q-1", "kind": "open_question", "status": "open"}])
    v = evaluate_interactive_gate_after_commit(st, {"capabilityId": "risk.analyze", "turnUserText": "", "committed": True})
    assert v["park"] is False


def test_resolve_from_user_text_marks_open_questions_resolved():
    st = _mk_state(coverageGaps=[
        {"id": "q1", "kind": "open_question", "label": "?", "status": "open"},
        {"id": "q2", "kind": "open_question", "label": "??", "status": "open"},
    ])
    resolved = resolve_readiness_gaps_from_user_text(st, "面向企业团队，使用web平台，验收标准是能用")
    gg = [g if isinstance(g, dict) else g.model_dump() for g in resolved.coverageGaps]
    assert all(g["status"] == "resolved" for g in gg if g["kind"] == "open_question")


def test_resolve_by_ids_only_targets_specified():
    st = _mk_state(coverageGaps=[
        {"id": "q1", "kind": "open_question", "status": "open"},
        {"id": "q2", "kind": "open_question", "status": "open"},
    ])
    resolved = resolve_readiness_gaps_by_ids(st, ["q1"])
    gg = [g if isinstance(g, dict) else g.model_dump() for g in resolved.coverageGaps]
    statuses = {g["id"]: g["status"] for g in gg}
    assert statuses["q1"] == "resolved"
    assert statuses["q2"] == "open"


def test_gaps_from_gap_ask_and_merge_populates_open_questions():
    st = _mk_state()
    content = "Gap: - Who is the user?\n- What is success?"
    gfs = gaps_from_gap_ask_content(content, "t-1", "art-1")
    assert len(gfs) >= 1
    assert all(g["kind"] == "open_question" for g in gfs)
    merge_gap_ask_into_state(st, gfs)
    assert open_human_question_gap_count(st) >= 1


def test_apply_resolve_and_clear_clears_await_when_resolved():
    st = _mk_state(awaitReason="ready", awaitDetail="waiting", coverageGaps=[
        {"id": "q1", "kind": "open_question", "status": "open"},
    ])
    st2 = apply_resolve_and_clear_readiness(st, "企业内部 RBAC 边界MVP")
    # after clear should have no await
    assert getattr(st2, "awaitReason", None) is None or open_human_question_gap_count(st2) == 0


def test_is_vague_goal_detects_thin():
    assert is_vague_goal("做一个系统") is True
    assert is_vague_goal("Build RBAC permission system for enterprise team on web with audit logs") is False


def test_drive_reasoning_turn_after_clarify_cap_keeps_awaitReason_ready():
    """Driver-level focused pytest: simulate clarification cap (gap.ask) that materializes open_question,
    then G_READY park sets runtimePhase=awaiting + awaitReason=ready.
    Asserts final state keeps "ready" (not overwritten to "user_input" by phase decision).
    Directly proves Python-owned G_READY parking / no self-answer past gate (addresses review finding 2).
    Uses monkeypatch only to isolate drive integration; asserts real state mutations from Python helpers.
    """
    state = _mk_state(coverageGaps=[])  # start clean; cap will add open_question gaps

    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "readiness chain plan for G_READY test"

    class DummyExec:
        content = "- Who are the target users?\n- What is the RBAC permission scope?"
        def model_dump(self):
            return {"content": self.content, "title": "gap", "summary": "", "sources": []}

    def fake_pick(state, user_text):
        # force a clarify cap to hit materialization + evaluate park path
        return [{"capabilityId": "gap.ask", "roleId": "产品"}]

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = fake_pick
    sess_mod.__dict__["execute_capability"] = lambda cap_id, st, ctx, role, tid: DummyExec()
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        out = _reloaded_drive(state, "t-gap-ready-1", "初始目标陈述不够明确")
        # core assertion: Python drive must end parked with ready, not user_input
        assert out.runtimePhase == "awaiting", f"expected awaiting after G_READY park, got {out.runtimePhase}"
        assert out.awaitReason == "ready", f"expected awaitReason=ready (G_READY), got {out.awaitReason}"
        # ensure not clobbered by the previous else:user_input path
        assert out.awaitReason != "user_input"
        assert open_human_question_gap_count(out) >= 1, "clarify cap should have materialized open_question gap"
    finally:
        if orig_orch is not None:
            sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None:
            sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None:
            sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None:
            sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None:
            sess_mod.__dict__["save_session"] = orig_save


# --- G_CONFIRM / route selection / reject route focused tests (this task) ---
# Directly prove Python-owned named behavior per review: userPicks, userRejects, evaluate confirm
# uses expresses (no park on pick/reject), apply does state writes (clear await, stale on reject),
# drive uses it. Acceptance: focused pytest proves Python not just partial park.

def _mk_route_state(has_route_art=True, await_reason=None):
    st = _mk_state(awaitReason=await_reason, awaitDetail=("waiting confirm" if await_reason=="confirm" else None))
    if has_route_art:
        pb = ProducedBy(capabilityRunId="r1", capabilityId="route.compare", roleId="工程")
        art = Artifact.server_construct(
            id="route-cmp-1",
            kind="route_options",
            provenance="test",
            trustLevel="gated_pass",
            title="routes",
            summary="",
            content="A B C",
            producedBy=pb,
            passedGates=["ground"],
        )
        st.artifacts = [art]
    return st


def test_user_picks_route_and_rejects_and_expresses_match_ts_semantics():
    assert user_picks_route("选方案 B") is True
    assert user_picks_route("就用方案A") is True
    assert user_picks_route("倾向路线2") is True
    assert user_picks_route("采用这个") is True
    assert user_picks_route("short") is False
    assert user_rejects_route_selection("都不行，重新生成") is True
    assert user_rejects_route_selection("重新对比路线") is True
    assert user_rejects_route_selection("退回换一条") is True
    assert user_rejects_route_selection("不满意") is True
    assert user_rejects_route_selection("选方案 B") is False
    assert user_expresses_route_selection("选方案 C") is True
    assert user_expresses_route_selection("都不行，重新出") is True


def test_evaluate_confirm_gate_parks_only_without_express_and_with_route_art():
    st = _mk_route_state(has_route_art=True)
    v = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "继续", "committed": True})
    assert v["park"] is True
    assert v["gate"] == "confirm"


def test_evaluate_confirm_gate_does_not_park_on_pick_or_reject_text():
    st = _mk_route_state(has_route_art=True)
    v_pick = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "选方案 B，先交付", "committed": True})
    v_rej = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "都不行，重新对比路线", "committed": True})
    assert v_pick["park"] is False
    assert v_rej["park"] is False


def test_evaluate_confirm_no_park_if_no_route_art():
    st = _mk_route_state(has_route_art=False)
    v = evaluate_confirm_gate_after_commit(st, {"capabilityId": "route.compare", "turnUserText": "foo", "committed": True})
    assert v["park"] is False


def test_apply_route_selection_on_pick_clears_confirm_await():
    st = _mk_route_state(has_route_art=True, await_reason="confirm")
    st2 = apply_route_selection_resolution(st, "选方案 B")
    assert getattr(st2, "awaitReason", None) is None
    assert getattr(st2, "awaitDetail", None) is None


def test_apply_route_selection_on_reject_stales_route_arts_and_clears_await():
    st = _mk_route_state(has_route_art=True, await_reason="confirm")
    assert "route-cmp-1" not in (getattr(st, "staleArtifactIds", []) or [])
    st2 = apply_route_selection_resolution(st, "都不行，重新生成")
    stales = getattr(st2, "staleArtifactIds", []) or []
    assert "route-cmp-1" in stales
    assert getattr(st2, "awaitReason", None) is None
    assert getattr(st2, "awaitDetail", None) is None


def test_drive_confirm_park_and_user_pick_resume_clears_await_and_no_repark():
    """Driver focused: after route.compare, confirm parks; on pick reply text, resolve clears awaitReason,
    proceeds without re-park on same text; proves full route selection behavior in Python drive.
    """
    import services.slide_rule_session as sess_mod
    import importlib
    importlib.reload(sess_mod)
    from services.slide_rule_session import drive_reasoning_turn as _reloaded_drive

    orig_orch = sess_mod.__dict__.get("orchestrate_plan")
    orig_pick = sess_mod.__dict__.get("pick_next_capabilities")
    orig_exec = sess_mod.__dict__.get("execute_capability")
    orig_gate = sess_mod.__dict__.get("evaluate_coverage_gate")
    orig_save = sess_mod.__dict__.get("save_session")

    class DummyPlan:
        rationale = "route plan"

    class DummyExec:
        content = "route A vs B vs C"
        def model_dump(self):
            return {"content": self.content, "title": "cmp", "summary": "", "sources": []}

    picks_called = {"count": 0}
    def fake_pick(state, user_text):
        picks_called["count"] += 1
        # after pick reply, should not pick route again (just clear)
        if user_picks_route(user_text):
            return []
        return [{"capabilityId": "route.compare", "roleId": "工程"}]

    exec_count = {"n": 0}
    def fake_exec(cap_id, st, ctx, role, tid):
        exec_count["n"] += 1
        return DummyExec()

    sess_mod.__dict__["orchestrate_plan"] = lambda s, t, u: DummyPlan()
    sess_mod.__dict__["pick_next_capabilities"] = fake_pick
    sess_mod.__dict__["execute_capability"] = fake_exec
    sess_mod.__dict__["evaluate_coverage_gate"] = lambda s: {"passed": False}
    sess_mod.__dict__["save_session"] = lambda st: st

    try:
        # first turn: keyword forces route.compare, after commit -> park confirm
        state = _mk_state()
        out1 = _reloaded_drive(state, "t-c1", "路线对比一下")
        assert out1.runtimePhase == "awaiting"
        assert out1.awaitReason == "confirm"

        # reply pick: should resolve clear, not re-park on confirm (may land on convergence since no more picks this turn)
        out2 = _reloaded_drive(out1, "t-c2", "选方案 B")
        assert out2.awaitReason != "confirm"
        # drive should not leave it parked on confirm
        assert getattr(out2, "awaitReason", None) in (None, "convergence", "user_input")
    finally:
        if orig_orch is not None: sess_mod.__dict__["orchestrate_plan"] = orig_orch
        if orig_pick is not None: sess_mod.__dict__["pick_next_capabilities"] = orig_pick
        if orig_exec is not None: sess_mod.__dict__["execute_capability"] = orig_exec
        if orig_gate is not None: sess_mod.__dict__["evaluate_coverage_gate"] = orig_gate
        if orig_save is not None: sess_mod.__dict__["save_session"] = orig_save
