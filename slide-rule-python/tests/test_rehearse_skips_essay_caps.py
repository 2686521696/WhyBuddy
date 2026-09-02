"""产品 rehearse / profile=app 跳过作文能力工厂前段（M18）。

判据必须打在活生成器 drive_full_v5_session_stream 上：只单测短清单 helper
会让「删掉循环里的 profile==app 分支」照样绿。

反向：剥注释后删掉 `profile == "app"` 跳过或短清单赋值，本文件必须红。
只关规则 pick 不关 agentic pick = 一半不生效（Claude.md §4）——本文件把
agentic 打开并设成作文陷阱，漏跳就会冒出 critique/risk/report。
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402
from services.engine_scheduling import pick_next_capabilities  # noqa: E402

ESSAY_CAPS = ("critique.generate", "risk.analyze", "report.write")
GOAL = "做一个请假审批系统，含申请、审批和余额"


def _code(fn) -> str:
    """源码去注释去 docstring —— 头注里写着 profile==app，不剥必然假绿。"""
    src = inspect.getsource(fn)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def _seeded(session_id: str, **goal_extra) -> V5SessionState:
    goal = {"text": GOAL, "status": "needs_refinement", **goal_extra}
    state = V5SessionState(sessionId=session_id, goal=goal, artifacts=[])
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


def _essay_in(values) -> set:
    found = set()
    for raw in values:
        text = str(raw or "")
        for cap in ESSAY_CAPS:
            if cap in text:
                found.add(cap)
    return found


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "on")
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "false")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import services.v5_agentic_pick as agentic_mod
    import services.v5_full_driver as driver_mod

    # ⚠ 2026-08-27：PR-8(M14) 之后 persist_state 必须返回 {"ok": True} 的 dict，
    #   否则能力结束落 pendingRuns 时判为写失败并 fail-closed 中止本轮
    #   （见 v5_full_driver 的 pending_write_failed）。`lambda s: s` 会让驱动器
    #   跑完第一个能力就退出——判据看到的"只执行了一个能力"是夹具造成的。
    monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
    monkeypatch.setattr(
        driver_mod, "_ensure_runtime_closure_evidence", lambda state, *a, **k: state
    )
    return driver_mod, agentic_mod


def _install_traps(driver_mod, agentic_mod, monkeypatch):
    """规则 pick 若被调用会走真函数；agentic 若被调用，换成作文陷阱。"""
    executed: list = []
    agentic_calls: list = []
    orch_calls: list = []

    def fake_exec(cap, state, input_ids, role, turn_id):
        executed.append(cap)
        return {
            "title": cap,
            "summary": "stub",
            "content": "stub",
            "provenance": "python-rag",
            "sources": [],
        }

    def fake_agentic(state, user_text, **kwargs):
        agentic_calls.append({"user_text": user_text, **kwargs})
        return {
            "picks": [
                {"capabilityId": "critique.generate", "roleId": "挑刺"},
                {"capabilityId": "risk.analyze", "roleId": "安全"},
                {"capabilityId": "report.write", "roleId": "综合"},
            ],
            "rationale": "trap: essay caps must not leak onto app profile",
        }

    def fake_orch(state, turn_id, user_text):
        orch_calls.append(turn_id)
        return type("P", (), {"selected": [], "rationale": "trap"})()

    monkeypatch.setattr(driver_mod, "execute_v5_capability", fake_exec)
    monkeypatch.setattr(agentic_mod, "agentic_pick_next_capabilities", fake_agentic)
    monkeypatch.setattr(agentic_mod, "agentic_pick_enabled", lambda: True)
    monkeypatch.setattr(driver_mod, "orchestrate_plan", fake_orch)
    return executed, agentic_calls, orch_calls


def _collect(driver_mod, state, **kwargs):
    async def _run():
        events = []
        async for ev in driver_mod.drive_full_v5_session_stream(state, **kwargs):
            events.append(ev)
        return events

    return asyncio.run(_run())


def _started_caps(events, executed):
    labels = [
        e.get("label")
        for e in events
        if e.get("type") in ("reasoning_step", "skill_start")
    ]
    skills = [e.get("skill") for e in events if e.get("type") == "skill_start"]
    return labels + skills + list(executed)


def test_app_profile_stream_skips_essay_caps_and_uses_short_list(driver, monkeypatch):
    driver_mod, agentic_mod = driver
    executed, agentic_calls, orch_calls = _install_traps(
        driver_mod, agentic_mod, monkeypatch
    )
    events = _collect(
        driver_mod,
        _seeded("app-skip-essay"),
        max_loops=1,
        user_instruction=GOAL,
        profile="app",
    )
    started = _started_caps(events, executed)
    leaked = _essay_in(started)
    assert not leaked, (
        f"profile=app 仍启动了作文能力 {leaked}。"
        "短清单必须 clip agentic 提案；删掉 _clip_agentic_picks_to_legal 这条红。"
    )
    assert agentic_calls, (
        "app 路径必须跑节点内 agentic pick。should_run_agentic_pick 若仍对 app 返回 False，这条红。"
    )
    assert orch_calls == [], "app 路径不应再跑 orchestrate_plan"
    joined = " ".join(str(x) for x in started)
    assert "appbundle.runtime" in joined.lower(), (
        "短清单赋值被删掉的话，循环里不会启动 runtimeclosure。"
        "只断言没作文、不断言有收口，删掉赋值会假绿。"
    )


def test_app_agentic_pick_stamps_factory_tools_and_can_omit_bind(driver, monkeypatch):
    """工厂节点里开 agentic pick：提案 stamp 到 goal.tools，钟才能跟着减。

    反向：删掉 _stamp_factory_tools_onto_goal / clip_factory_tools，
    这条必红——只跑 agentic 但不动 tools，钟仍是六步。
    """
    driver_mod, agentic_mod = driver
    executed, agentic_calls, orch_calls = _install_traps(
        driver_mod, agentic_mod, monkeypatch
    )

    def fake_factory_pick(state, user_text, **kwargs):
        agentic_calls.append({"user_text": user_text, **kwargs})
        return {
            "picks": [
                {"capabilityId": "spec", "roleId": "产品"},
                {"capabilityId": "pages", "roleId": "工程"},
                {"capabilityId": "closure", "roleId": "综合"},
            ],
            "rationale": "先只出页面，先不 bind",
        }

    monkeypatch.setattr(agentic_mod, "agentic_pick_next_capabilities", fake_factory_pick)
    state = _seeded("app-omit-bind")
    events = _collect(
        driver_mod,
        state,
        max_loops=1,
        user_instruction=GOAL,
        profile="app",
    )
    started = _started_caps(events, executed)
    assert not _essay_in(started)
    assert orch_calls == []
    assert agentic_calls, "app 路径没跑工厂节点 agentic pick"
    vocab = agentic_calls[0].get("vocab") or {}
    assert "spec" in vocab and "bind" in vocab, (
        "工厂词表没传进 agentic pick。删掉 vocab=factory_tool_vocab 这条红。"
    )
    assert "critique.generate" not in vocab
    tools = list((state.goal or {}).get("tools") or [])
    assert tools == ["spec", "pages", "closure"], (
        f"goal.tools 没被减菜：{tools}。钟仍会画 bind。"
    )
    assert "bind" not in tools
    assert (state.goal or {}).get("workflow") == "pages-preview"
    joined = " ".join(str(x) for x in started)
    assert "appbundle.runtime" in joined.lower()
    assert any(e.get("type") == "factory_plan" for e in events), (
        "活路径没发出 factory_plan。删掉 yield 钟不会跟着变。"
    )
    plan = next(e for e in events if e.get("type") == "factory_plan")
    assert plan.get("tools") == ["spec", "pages", "closure"]


def test_factory_pick_prompt_composes_instead_of_defaulting_all_five():
    """死流程的那句「没说减就全开」不许再写进工厂词表。"""
    from services.v5_agentic_pick import agentic_pick_next_capabilities

    src = _code(agentic_pick_next_capabilities)
    factory = src[src.index("_is_factory_vocab") : src.index("else:")]
    assert "没说减就全开" not in factory
    assert "看板" in factory
    assert "组合" in factory
    assert "死流程" in factory


def test_full_profile_and_rule_pick_still_can_select_essay_caps(driver, monkeypatch):
    driver_mod, agentic_mod = driver
    executed, agentic_calls, orch_calls = _install_traps(
        driver_mod, agentic_mod, monkeypatch
    )
    state = _seeded("full-keeps-essay")
    rule_picks = pick_next_capabilities(state, GOAL)
    rule_ids = {p["capabilityId"] for p in rule_picks}
    assert rule_ids & set(ESSAY_CAPS), (
        "规则 pick 词表被改掉了？/drive-turn 应仍能选到作文能力。"
        f" got {rule_ids}"
    )

    events = _collect(
        driver_mod,
        state,
        max_loops=1,
        user_instruction=GOAL,
        profile="full",
    )
    started = _started_caps(events, executed)
    assert _essay_in(started), (
        "profile=full 也应仍能选作文能力。默认 full 被误短路到短清单了。"
    )
    assert orch_calls, "full 路径必须仍走 orchestrate_plan"
    assert agentic_calls, "full 路径必须仍走 agentic pick（本测试开了陷阱）"


def test_repair_with_app_profile_still_uses_repair_picks_not_short_list(
    driver, monkeypatch
):
    driver_mod, agentic_mod = driver
    executed, agentic_calls, _orch = _install_traps(
        driver_mod, agentic_mod, monkeypatch
    )
    events = _collect(
        driver_mod,
        _seeded("app-repair-not-short"),
        max_loops=1,
        user_instruction=GOAL,
        profile="app",
        repair=True,
    )
    started = _started_caps(events, executed)
    assert "evidence.search" in {str(x) for x in executed}, (
        "repair=True 被短路到 app 短清单了——修什么必须以门说了算。"
        f" executed={executed}"
    )
    assert agentic_calls == []
    assert not _essay_in(started) or "evidence.search" in executed
    _ = events


def test_repair_picks_come_from_the_gate_not_the_short_list(driver, monkeypatch):
    """repair 的选材源必须是门标红项，不是 app 短清单——盯**调用了谁**。

    ⚠ 2026-08-27：上面那条同题判据点名 `evidence.search` 必须出现在 executed
      里。那是盯字面：真正要钉的是"选材走 pick_repair_capabilities"，而具体
      跑到第几项取决于 max_loops / 夹具中止时机。夹具一变（PR-8 把
      persist_state 契约改成必须返回 {"ok": True}，旧 stub 让驱动器跑完第一个
      能力就 fail-closed 中止），那条就报"repair 被短路到短清单了"——而 repair
      分支根本没被短路。

    本条盯语义：repair=True 时 pick_repair_capabilities 被调用、
    _app_profile_short_picks 一次都不被调用。反向：把 v5_full_driver 里
    `if repair:` 那一支删掉让它落到 `elif profile == "app"`，本条必须红。
    """
    driver_mod, agentic_mod = driver
    _install_traps(driver_mod, agentic_mod, monkeypatch)

    repair_calls: list = []
    short_calls: list = []
    real_repair = driver_mod.pick_repair_capabilities
    real_short = driver_mod._app_profile_short_picks

    def spy_repair(state, *a, **k):
        repair_calls.append(state)
        return real_repair(state, *a, **k)

    def spy_short(state, *a, **k):
        short_calls.append(state)
        return real_short(state, *a, **k)

    monkeypatch.setattr(driver_mod, "pick_repair_capabilities", spy_repair)
    monkeypatch.setattr(driver_mod, "_app_profile_short_picks", spy_short)

    _collect(
        driver_mod,
        _seeded("app-repair-source"),
        max_loops=1,
        user_instruction=GOAL,
        profile="app",
        repair=True,
    )

    assert repair_calls, (
        "repair=True 没有走 pick_repair_capabilities——修什么必须以门说了算"
    )
    assert short_calls == [], (
        "repair=True 落到了 app 短清单分支：门标红的缺口会被短清单顶掉，"
        "E26 补救等于失效"
    )


def test_scope_opt_in_feasibility_report_brings_essay_caps_back(driver, monkeypatch):
    driver_mod, agentic_mod = driver
    executed, agentic_calls, orch_calls = _install_traps(
        driver_mod, agentic_mod, monkeypatch
    )
    state = _seeded("app-opt-in-report", wantFeasibilityReport=True)
    events = _collect(
        driver_mod,
        state,
        max_loops=1,
        user_instruction=GOAL,
        profile="app",
    )
    started = _started_caps(events, executed)
    assert _essay_in(started), (
        "范围卡勾了可行性报告，短清单应把 risk/critique/report 加回来。"
    )
    assert agentic_calls, "勾选报告后仍应跑节点内 agentic pick（提案 clip 在短清单内）"
    assert orch_calls == []


def test_live_stream_body_has_app_skip_and_not_discarded_profile():
    from services.v5_full_driver import drive_full_v5_session_stream

    code = _code(drive_full_v5_session_stream)
    assert "_ = profile" not in code, "profile 入参又被丢掉了——短清单没通电"
    assert 'profile == "app"' in code, (
        "剥注释后生成器函数体里没有 profile == 'app'。"
        "删掉这条跳过，上面的行为测试必须一起红。"
    )
    assert "_app_profile_short_picks" in code
    assert "should_run_agentic_pick" in code
    assert "pick_next_capabilities" in code
    assert "agentic_pick_next_capabilities" in code
    assert "factory_tool_vocab" in code
    assert "_stamp_factory_tools_onto_goal" in code
    assert "clip_factory_tools" in code
    assert '"factory_plan"' in code, (
        "编排结果必须 yield factory_plan，否则钟拿不到本轮 tools。"
    )
    app_at = code.index('profile == "app"')
    short_at = code.index("_app_profile_short_picks")
    assert short_at > app_at, "短清单赋值不在 app 分支里"
    vocab_at = code.index("factory_tool_vocab")
    assert vocab_at > app_at, "工厂词表没传进 app 分支的 agentic pick"


def test_drive_turn_path_still_calls_rule_pick():
    from services.slide_rule_session import drive_reasoning_turn

    code = _code(drive_reasoning_turn)
    assert "pick_next_capabilities" in code


def test_http_routes_must_not_grow_factory_profile_flag():
    from pathlib import Path

    routes = (Path(__file__).resolve().parents[1] / "routes" / "sliderule_full.py").read_text(
        encoding="utf-8"
    )
    stream = routes.split("async def drive_full_stream", 1)[1].split(
        "async def control_turn_stream", 1
    )[0]
    control = routes.split("async def control_turn_stream", 1)[1].split(
        "def _run_sse_response", 1
    )[0]
    assert "factoryProfile" not in stream
    assert "factoryProfile" not in control
    assert 'profile="full"' in stream


def _parked_scope_card(**flags):
    row = {
        "role": "assistant",
        "kind": "scope_card",
        "text": "请假系统",
        "device": "desktop",
        "variant": "full",
    }
    row.update(flags)
    return row


def test_rehearse_persist_copies_scope_opt_in_onto_loaded_goal(monkeypatch):
    """persist-as-authority：范围卡勾选必须写进 load_session 后的 goal。

    只 seed goal 再直调生成器，删掉 copy 调用点照样绿。
    """
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: E402
        ControlHarness,
        new_sid,
        seed_session,
        six_fields,
    )
    from services.slide_rule_session import load_session  # noqa: E402
    from services.v5_full_driver import (  # noqa: E402
        _app_profile_short_picks,
        _truthy_scope_flag,
    )

    harness = ControlHarness(monkeypatch)
    sid = new_sid("opt-in-persist")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
        controlTranscript=[_parked_scope_card(wantFeasibilityReport=True)],
    )
    _, _events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert harness.helper_calls, "rehearse 没打到信封，copy 之后的 persist 没通电"
    loaded = load_session(sid)
    assert loaded is not None
    goal = loaded.goal if isinstance(loaded.goal, dict) else {}
    assert _truthy_scope_flag(goal.get("wantFeasibilityReport")), (
        "删掉 _confirm_rehearse_and_handoff 里的 _copy_scope_opt_in_into_goal，"
        "工厂 load_session 看到的 goal 就没有勾选。"
    )
    ids = {p["capabilityId"] for p in _app_profile_short_picks(loaded)}
    assert ids & set(ESSAY_CAPS), "勾选写进 goal 之后短清单仍没有作文能力"


def test_rehearse_persist_clears_leftover_opt_in_when_card_omits_flags(monkeypatch):
    """新卡没勾必须清掉 goal 残留 True，否则下一轮 rehearse fail-open。"""
    pytest.importorskip("fastapi")
    from control_turn_support import (  # noqa: E402
        ControlHarness,
        new_sid,
        seed_session,
        six_fields,
    )
    from services.slide_rule_session import load_session  # noqa: E402
    from services.v5_full_driver import (  # noqa: E402
        _app_profile_short_picks,
        _truthy_scope_flag,
    )

    harness = ControlHarness(monkeypatch)
    sid = new_sid("opt-in-clear")
    seed_session(
        sid,
        goal={
            "text": "请假系统",
            "status": "clear",
            "wantFeasibilityReport": True,
            "wantEvidence": True,
            "includeFeasibilityReport": True,
        },
        awaitReason="control_scope",
        awaitDetail="请假系统",
        controlTranscript=[_parked_scope_card()],
    )
    _, _events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert harness.helper_calls, "rehearse 没打到信封"
    loaded = load_session(sid)
    assert loaded is not None
    goal = loaded.goal if isinstance(loaded.goal, dict) else {}
    assert not _truthy_scope_flag(goal.get("wantFeasibilityReport")), (
        "copy 在两旗都假时 return，goal 残留 True 会在没勾的卡上 fail-open。"
    )
    assert not _truthy_scope_flag(goal.get("wantEvidence"))
    assert not _truthy_scope_flag(goal.get("includeFeasibilityReport"))
    ids = {p["capabilityId"] for p in _app_profile_short_picks(loaded)}
    assert not (ids & set(ESSAY_CAPS)), (
        "新卡没勾，短清单仍注入了作文能力。"
        "scope_confirmed 被当成旗标行、或残留 True 压过新卡，都会红在这里。"
    )


def test_copy_scope_opt_in_call_sites_live_and_always_sync():
    from services.rehearsal_control import (
        _confirm_rehearse_and_handoff,
        _copy_scope_opt_in_into_goal,
        _dispatch_tool,
    )

    confirm = _code(_confirm_rehearse_and_handoff)
    dispatch = _code(_dispatch_tool)
    helper = _code(_copy_scope_opt_in_into_goal)
    assert "_copy_scope_opt_in_into_goal" in confirm, (
        "删掉确认路径的 copy 调用点，persist-as-authority 测试必须一起红。"
    )
    assert "_copy_scope_opt_in_into_goal" in dispatch
    assert "if not want_evidence and not want_report" not in helper
    assert "_truthy_scope_flag" in helper
    assert 'pop("wantFeasibilityReport"' in helper
    assert "bool(" not in helper.replace("_truthy_scope_flag", "")


def test_scope_opted_in_reads_last_scope_card_not_scope_confirmed():
    from models.v5_state import V5SessionState
    from services.v5_full_driver import _scope_opted_in

    code = _code(_scope_opted_in)
    assert "scope_confirmed" not in code, (
        "scope_confirmed 不带勾选。当成旗标行会 break，transcript 回落全死。"
    )
    assert "scope_card" in code

    leftover = V5SessionState(
        sessionId="card-beats-goal",
        goal={"text": GOAL, "wantFeasibilityReport": True},
        artifacts=[],
        controlTranscript=[
            {"kind": "scope_card", "text": "请假系统"},
            {"kind": "scope_confirmed", "text": "请假系统"},
        ],
    )
    assert not _scope_opted_in(leftover, "wantFeasibilityReport"), (
        "新卡没勾，goal 残留 True 仍压过了最后一张 scope_card。"
    )
    opted = V5SessionState(
        sessionId="card-opt-in",
        goal={"text": GOAL},
        artifacts=[],
        controlTranscript=[
            {"kind": "scope_card", "text": "请假系统", "wantFeasibilityReport": True},
            {"kind": "scope_confirmed", "text": "请假系统"},
        ],
    )
    assert _scope_opted_in(opted, "wantFeasibilityReport")


def test_truthy_scope_flag_rejects_false_strings():
    from services.v5_full_driver import _truthy_scope_flag

    assert _truthy_scope_flag(True) is True
    assert _truthy_scope_flag("true") is True
    assert _truthy_scope_flag("false") is False
    assert _truthy_scope_flag("False") is False
    assert bool("false") is True


def test_product_rehearse_ignores_http_factory_profile(monkeypatch):
    pytest.importorskip("fastapi")
    from control_turn_support import ControlHarness, new_sid, seed_session, six_fields

    harness = ControlHarness(monkeypatch)
    sid = new_sid("fp-ignore")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    _, _events = harness.post(
        six_fields(
            sid,
            "将做成：请假系统",
            forcedTool="rehearse",
            factoryProfile="full",
        )
    )
    assert harness.helper_calls, "rehearse 没打到信封"
    assert harness.helper_calls[0].get("profile") == "app"
    assert "factoryProfile" not in harness.helper_calls[0]
