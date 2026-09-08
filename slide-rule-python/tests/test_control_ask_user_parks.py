"""ask_user 发出 control_ask_user 后本请求结束。

persist awaitReason=control_ask；reload 仍能看到问题；不是 G_READY ready。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_ask_user_parks_and_ends_this_request(harness):
    sid = new_sid("ask")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    question = "你想做什么应用？"
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user", {"question": question, "options": ["请假", "报销"]}
    )
    _, events = harness.post(six_fields(sid, "你好"))
    assert harness.helper_calls == []
    types = event_types(events)
    assert "control_ask_user" in types
    assert "complete" in types
    # 本请求在提问之后结束，不得再转一轮等用户。
    ask_at = types.index("control_ask_user")
    assert "control_ask_user" not in types[ask_at + 1 :]
    assert types[ask_at:].count("complete") == 1
    assert harness.llm_calls == [harness.llm_calls[0]], "不得空转等用户再调一轮模型"
    ask_events = [e for e in events if e.get("type") == "control_ask_user"]
    assert ask_events[0]["question"] == question

    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_ask"
    assert loaded.awaitReason != "ready"
    assert loaded.runtimePhase == "awaiting"
    assert question in str(loaded.awaitDetail or "")
    transcript = loaded.controlTranscript or []
    texts = [row.get("text") for row in transcript if isinstance(row, dict)]
    assert question in texts

    reloaded = load_session(sid)
    assert reloaded is not None
    assert reloaded.awaitReason == "control_ask"
    assert question in str(reloaded.awaitDetail or "")


def test_answer_to_ask_is_tool_result_not_new_user_turn(harness):
    """第 3 格：点选项是纸条回执，不是新开一单。

    真机水果店：点「精修（refine）」左栏画成用户原话，控制面当新话题。
    变异：仍 append kind=turn → 本条红。
    """
    sid = new_sid("ask-answer")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    question = "你想做什么应用？"
    harness.llm_impl = lambda messages, **kw: llm_tool(
        "ask_user", {"question": question, "options": ["请假", "报销"]}
    )
    harness.post(six_fields(sid, "你好"))

    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        roles = [m.get("role") for m in messages]
        assert "tool" in roles, f"回执没进 messages：{roles}"
        users = [m for m in messages if m.get("role") == "user"]
        assert not any(
            "请假" == str(m.get("content") or "").strip() for m in users
        ), "答案被当成新的 user 原话"
        return llm_text("好，按请假系统做。")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "请假"))
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason != "control_ask"
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
        and row.get("role") == "user"
        and row.get("kind") == "turn"
    ]
    assert "请假" not in turns, f"回执写进了 user turn：{turns}"
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert answers and answers[-1].get("text") == "请假"
    assert any(
        e.get("type") == "control_text" and "请假" in str(e.get("text") or "")
        for e in events
    ) or any(e.get("type") == "control_text" for e in events)
    assert rounds["n"] >= 1


def test_ask_answer_empty_llm_does_not_dump_operator_speak(harness):
    """回执后模型空回复：端给人话，不许「请调 pages」。"""
    sid = new_sid("ask-empty")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail="你想做什么应用？",
        runtimePhase="awaiting",
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": "你想做什么应用？",
                "options": ["请假", "报销"],
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("")
    _, events = harness.post(six_fields(sid, "请假"))
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    blob = "\n".join(texts)
    assert "请调 pages" not in blob
    assert "告诉用户为什么先停" not in blob
    assert "SPEC 已经起草" not in blob
    from services.rehearsal_control import CANNED_FAILURE

    assert CANNED_FAILURE not in blob
    assert "说一个要做的应用" not in blob


def test_explicit_tool_answer_payload_is_the_live_path(harness):
    """客户端带 toolAnswer 时同样走回执，不靠猜停泊态。"""
    sid = new_sid("ask-payload")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail="下一跳做什么？",
        runtimePhase="awaiting",
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": "下一跳做什么？",
                "options": ["精修（refine）", "画页面（pages）"],
            }
        ],
        specFirstPages={
            "spec": {"appName": "店", "pages": [{"id": "p1"}]},
            "pages": {"p1": "<html></html>"},
        },
        modelVersions=[{"id": "v1", "model": {"pages": {}}}],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("精修这一轮做完了。")
    _, events = harness.post(
        six_fields(
            sid,
            "精修（refine）",
            toolAnswer={"kind": "ask_user", "text": "精修（refine）", "reqId": "need-live1"},
        )
    )
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "turn"
    ]
    assert "精修（refine）" not in turns
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert answers and answers[-1].get("text") == "精修（refine）"
    # 已有 SPEC/页面：括号名是 typed 答案 → 直接 refine，不重猜。
    assert harness.helper_calls, f"回执没把 refine 交工厂：{event_types(events)}"
    # 反向：第一版 _settled(_dispatch_tool) 直接 return，工厂 complete 被
    # nest 掉，host 零 LLM、客户端报推演中断。
    assert harness.llm_calls, "refine 回执没有交回 host"
    assert event_types(events)[-1] == "complete", event_types(events)


def test_assumptions_confirm_is_tool_result_not_new_user_turn(harness):
    """假设卡确认是纸条。必须带假设行，否则 _assumptions_awaiting 假绿。

    变异：仍 append kind=turn → 本条红。
    变异：确认后 _settled 收工不交 host → llm_calls 空，本条红。
    """
    sid = new_sid("ask-assumptions")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {
                "appName": "请假",
                "pages": [{"id": "p1", "name": "申请"}],
                "nodes": [],
                "assumptions": [{"id": "a1", "topic": "登录"}],
            },
            "pages": {},
            "assumptionsConfirmed": False,
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面已经出来。")
    _, events = harness.post(
        six_fields(sid, "假设已确认。继续画页面。", forcedTool="pages")
    )
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
        and row.get("role") == "user"
        and row.get("kind") == "turn"
    ]
    assert "假设已确认。继续画页面。" not in turns, f"确认写进了 user turn：{turns}"
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert answers and "假设已确认" in str(answers[-1].get("text") or "")
    assert harness.helper_calls, f"确认继续没有 handoff 工厂：{event_types(events)}"
    assert harness.llm_calls, "确认继续没有交回 host"
    assert event_types(events)[-1] == "complete"
    sfp = loaded.specFirstPages or {}
    assert sfp.get("assumptionsConfirmed") is True
    tools = loaded.goal.get("tools") if isinstance(loaded.goal, dict) else None
    assert tools == ["pages"], tools
    todo = list(getattr(loaded, "factoryTodo", None) or [])
    assert "structure" in todo and "bind" in todo, todo


def test_fresh_utterance_is_still_a_user_turn(harness):
    """反向：没有停泊提问时，人话仍是 HumanIntent，不许一律当成纸条。"""
    sid = new_sid("fresh-turn")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    harness.llm_impl = lambda messages, **kw: llm_text("收到。")
    harness.post(six_fields(sid, "把提交按钮改成红色"))
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict)
        and row.get("role") == "user"
        and row.get("kind") == "turn"
    ]
    assert "把提交按钮改成红色" in turns
    answers = [
        row
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "user_answer"
    ]
    assert not answers, f"普通原话被当成了纸条：{answers}"


def test_unconfirmed_assumptions_plain_text_does_not_steal_pages(harness):
    """反向：假设卡摊着但用户没点确认，不许当纸条、不许偷画页。"""
    sid = new_sid("ask-no-confirm")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        specFirstPages={
            "spec": {
                "appName": "请假",
                "pages": [{"id": "p1"}],
                "assumptions": [{"id": "a1", "topic": "登录"}],
            },
            "pages": {},
            "assumptionsConfirmed": False,
        },
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("还在等你确认假设。")
    _, events = harness.post(six_fields(sid, "再想想"))
    loaded = load_session(sid)
    assert loaded is not None
    turns = [
        row.get("text")
        for row in (loaded.controlTranscript or [])
        if isinstance(row, dict) and row.get("kind") == "turn"
    ]
    assert "再想想" in turns
    assert not any(
        isinstance(row, dict) and row.get("kind") == "user_answer"
        for row in (loaded.controlTranscript or [])
    )
    assert not harness.helper_calls, f"没确认就画页了：{event_types(events)}"
