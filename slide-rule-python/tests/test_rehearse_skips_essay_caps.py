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
from services.slide_rule_session import pick_next_capabilities  # noqa: E402

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

    monkeypatch.setattr(driver_mod, "persist_state", lambda s: s)
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
        "删掉生成器里 profile == 'app' 的跳过，或短清单之后仍走 agentic pick，这条必须红。"
    )
    assert agentic_calls == [], (
        "app 短清单之后仍调用了 agentic_pick_next_capabilities——"
        "只跳过规则 pick 等于一半没改。"
    )
    assert orch_calls == [], "app 路径不应再跑 orchestrate_plan"
    joined = " ".join(str(x) for x in started)
    assert "appbundle.runtime" in joined.lower(), (
        "短清单赋值被删掉的话，循环里不会启动 runtimeclosure。"
        "只断言没作文、不断言有收口，删掉赋值会假绿。"
    )


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
    assert agentic_calls == [], "勾选加回作文能力，仍不得把选材交给 agentic pick"
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
    app_at = code.index('profile == "app"')
    short_at = code.index("_app_profile_short_picks")
    assert short_at > app_at, "短清单赋值不在 app 分支里"


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
