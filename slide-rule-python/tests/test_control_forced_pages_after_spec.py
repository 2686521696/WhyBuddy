"""假设卡「确认继续」= forcedTool pages。点火前跳过控制面 LLM。

真机（2026-09-02）：确认只发一句话，控制面去 planning，钟又回到起草 SPEC，
页面框一直 0。选完再继续的下一跳必须是 pages，不是再问一遍控制模型。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_text,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_forced_pages_skips_llm_and_sets_goal_tools_pages(harness):
    sid = new_sid("pages-after-spec")
    seed_session(
        sid,
        goal={"text": "社区图书馆借还书系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "社区图书馆借还书系统"}
        ],
        specFirstPages={
            "spec": {
                "appName": "社区图书馆",
                "pages": [{"id": "p1", "name": "借还台"}],
                "nodes": [{"id": "n0", "title": "借还"}],
            },
            "pages": {},
        },
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "pages 点火前不得问控制面模型"
        return llm_text("页面已经出来，要改哪一页说一声。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    assert harness.helper_calls, "确认继续没有 handoff 工厂"
    assert harness.llm_calls, "工厂之后没有 LLM——确认继续没有交回控制面"
    types = event_types(events)
    assert "control_ask_user" not in types
    assert "control_handoff_factory" in types
    assert "factory_complete" in types
    assert types[-1] == "complete", (
        f"pages 跳没有 host complete → 客户端报推演中断，实际 {types}"
    )
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert tools == ["pages"], f"下一跳 tools 必须是 pages，实际 {tools}"


def test_forced_pages_survives_stale_session_reload(monkeypatch):
    """同一 lastTurnId 改 goal.tools 会被落盘守卫挡住。工厂 reload 后仍必须是 pages。

    变异：把 start_drive_full 里 stamp goal_tools 删掉 → 本条红。
    """
    from services import drive_full_factory as factory
    from services.slide_rule_session import load_session as real_load

    harness = ControlHarness(monkeypatch, live_factory=True)

    def stale_load(sid):
        st = real_load(sid)
        if st is None:
            return None
        goal = dict(st.goal) if isinstance(st.goal, dict) else {}
        goal["tools"] = ["spec"]
        st.goal = goal
        return st

    monkeypatch.setattr(factory, "load_session", stale_load)

    sid = new_sid("pages-stale-reload")
    seed_session(
        sid,
        lastTurnId="turn-2",
        goal={
            "text": "社区图书馆借还书系统",
            "status": "clear",
            "tools": ["spec"],
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "社区图书馆借还书系统"}
        ],
        specFirstPages={
            "spec": {
                "appName": "社区图书馆",
                "pages": [{"id": "p1", "name": "借还台"}],
                "nodes": [{"id": "n0", "title": "借还"}],
            },
            "pages": {},
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面出来了。")
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    assert harness.helper_calls, "确认继续没有 handoff 工厂"
    assert harness.helper_calls[-1].get("goal_tools") == ["pages"]
    seen = [row.get("tools") for row in harness.generator_calls]
    assert ["pages"] in seen, f"工厂 reload 后 tools 不是 pages：{seen}"
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert types[-1] == "complete"


def test_structure_card_label_without_forced_tool_skips_llm(harness):
    """收尾卡「进入数据模型反推（Structure）」不带 forcedTool 也必须当 structure。

    2026-09-03 真机：onAnswerAsk 把标签当聊天发出去，控制面去 planning，
    伴随式卡又弹。抄 grok：选项点下去是 typed 答案。
    """
    from services.factory_plan_steps import product_steps_for_tools

    sid = new_sid("structure-from-card")
    seed_session(
        sid,
        goal={"text": "萌芽成长树", "status": "clear", "tools": ["pages"]},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "萌芽成长树"}
        ],
        specFirstPages={
            "spec": {
                "appName": "萌芽成长树",
                "pages": [{"id": "p1", "name": "打卡"}],
                "nodes": [{"id": "n0", "title": "打卡"}],
            },
            "pages": {"p1": "<html>打卡</html>"},
        },
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "structure 点火前不得问控制面模型"
        return llm_text("数据模型已经出来。")

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "进入数据模型反推（Structure）")
    )
    assert harness.helper_calls, "收尾卡没有 handoff 工厂"
    types = event_types(events)
    assert "control_ask_user" not in types
    assert "control_handoff_factory" in types
    assert types[-1] == "complete"
    saved = load_session(sid)
    tools = (saved.goal or {}).get("tools") if saved and isinstance(saved.goal, dict) else None
    assert tools == ["structure"], f"下一跳 tools 必须是 structure，实际 {tools}"
    steps = (saved.goal or {}).get("productSteps") if saved and isinstance(saved.goal, dict) else None
    assert steps == product_steps_for_tools(["structure"], refine=False), (
        f"钟没跟本跳 tools：{steps}"
    )


def test_structure_hop_factory_stamp_writes_clock_steps(monkeypatch):
    """活路径：工厂信封 reload 之后 productSteps 必须是 structure 的 [4,5,6]。

    假工厂不跑 spec-first，但 start_drive_full 盖章必须在进生成器之前完成。
    变异：信封只写 tools → generator_calls 里 productSteps 仍是上一跳的 [2]。
    """
    from services.factory_plan_steps import product_steps_for_tools

    harness = ControlHarness(monkeypatch, live_factory=True)
    sid = new_sid("structure-clock")
    seed_session(
        sid,
        lastTurnId="turn-2",
        goal={
            "text": "萌芽成长树",
            "status": "clear",
            "tools": ["pages"],
            "productSteps": [2],
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "萌芽成长树"}
        ],
        specFirstPages={
            "spec": {
                "appName": "萌芽成长树",
                "pages": [{"id": "p1", "name": "打卡"}],
                "nodes": [{"id": "n0", "title": "打卡"}],
            },
            "pages": {"p1": "<html>打卡</html>"},
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("数据模型已经出来。")
    _, events = harness.post(
        six_fields(sid, "进入数据模型反推（Structure）")
    )
    assert harness.helper_calls, "没有 handoff 工厂"
    assert harness.helper_calls[-1].get("goal_tools") == ["structure"]
    stamped = [row.get("productSteps") for row in harness.generator_calls]
    want = product_steps_for_tools(["structure"], refine=False)
    assert want in stamped, f"工厂入场钟没跟 structure：{stamped}"
    types = event_types(events)
    assert "control_handoff_factory" in types


def test_handoff_passes_goal_tools():
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(Path("slide-rule-python/services/rehearsal_control.py"))
    at = src.find("async def _handoff_factory")
    assert at > 0
    body = src[at : at + 2200]
    assert "goal_tools=" in body, "handoff 没把本跳 tools 传进工厂信封"


def test_forced_closed_tools_bind_write_scope():
    """LLM 分发有 tool_scope_scope(name)；forced 那条必须有 tool_scope_scope(forced)。

    变异：把 with tool_scope_scope(forced) 删掉 → pages 点火抛 ToolScopeViolation。
    """
    from control_turn_support import strip_python
    from pathlib import Path

    src = strip_python(Path("slide-rule-python/services/rehearsal_control.py"))
    hop = src.find("if forced in FACTORY_HOPS")
    assert hop > 0
    hop_body = src[hop : hop + 1600]
    assert "tool_scope_scope(forced)" in hop_body, "pages 分发没绑 WRITE 闸"
    assert "_resume_control_llm_after_write" in hop_body, (
        "pages 工厂后没交回控制面——客户端会报推演中断"
    )
    at = src.find("if forced in CLOSED_TOOLS")
    assert at > hop
    body = src[at : at + 900]
    assert "tool_scope_scope(forced)" in body, "forced 分发没绑 WRITE 闸"


def test_spec_hop_resume_cannot_park_scope_card(harness):
    """选完再继续：SPEC 跳交回后模型想开范围卡，不许把假设面板冲掉。

    变异：把 tools=[] 那道闸删掉 → 本条红（流里出现 control_scope_card）。
    """
    from control_turn_support import llm_tool

    sid = new_sid("spec-no-scope")
    seed_session(
        sid,
        goal={"text": "社区图书馆借还书系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="社区图书馆借还书系统",
    )

    def impl(messages, **kw):
        assert harness.helper_calls, "点火前不得问控制面模型"
        return llm_tool("scope_card", {"restatement": "社区图书馆借还书系统"})

    harness.llm_impl = impl
    _, events = harness.post(
        six_fields(sid, "将做成：社区图书馆借还书系统", forcedTool="rehearse")
    )
    types = event_types(events)
    assert "control_handoff_factory" in types
    assert "control_scope_card" not in types, (
        f"SPEC 跳完又弹出范围卡，假设面板被 pendingScope 藏起来：{types}"
    )
    assert types[-1] == "complete"


def test_forced_pages_without_spec_does_not_invent_pages(harness):
    """反向：没有 SPEC 不许空转画页。变异：把 blocker 删掉 → 本条红。"""
    sid = new_sid("pages-no-spec")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("不该走到这里")
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    assert not harness.helper_calls, "没有 SPEC 还 handoff 了工厂"
    assert not harness.llm_calls, "没有 SPEC 还去问了控制面模型"
    types = event_types(events)
    assert "control_handoff_factory" not in types
    assert types[-1] == "complete"


def test_forced_bind_without_pages_says_so(harness):
    """建设单 O-4：空会话单跳 bind 闸说人话，不许抛、不许静默跑零页。"""
    sid = new_sid("bind-no-pages")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("不该走到这里")
    _, events = harness.post(
        six_fields(sid, "去绑权限", forcedTool="bind")
    )
    assert not harness.helper_calls, "没有页面还 handoff 了工厂"
    types = event_types(events)
    assert "control_handoff_factory" not in types
    texts = "\n".join(str(e.get("text") or "") for e in events)
    assert "还没有页面" in texts
    assert types[-1] == "complete"
