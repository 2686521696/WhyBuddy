"""廉价跟进不是产品。真机载荷，不许自己拼一个让护栏成立的输入。

⚠ 2026-09-08 会话标题「继续」：

  1. 问候 ask_user 芯片「继续」→ NeedUserAnswer
     `_stamp_user_answer` 把「继续」写成 goal
     模型空回复 empty_text=CANNED_FAILURE
     左栏：「我是面团的推演引擎。说一个要做的应用…」
  2. 用户问「你能做啥」（能力问答，不是产品）
     `_has_product_topic` 只排除问候表，继续 / 你能做啥都算产品
     `_can_auto_grant_scope` 只数「去标点 ≥4 字」
     你能做啥(4) + goal 继续 → 自动授予 → 点着 SPEC，六步钟亮起

变异：把空回复改回 CANNED_FAILURE、把「继续」再写进 goal、
把 auto-grant 改回纯字数 → 本文件红。
反向：真需求「街边早餐摊收银台」「请假」仍是产品。
"""
from __future__ import annotations

import pytest

from control_turn_support import (
    PY_ROOT,
    ControlHarness,
    event_types,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from services.rehearsal_control import (
    CANNED_FAILURE,
    CHEAP_TURN_FALLBACK,
    _can_auto_grant_scope,
    _has_product_topic,
    _system_prompt,
    list_control_tools,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

LIVE_CONTINUE = "继续"
LIVE_META = "你能做啥"
REAL_TOPIC = "街边早餐摊收银台"


def _names(state) -> set:
    return {t["function"]["name"] for t in list_control_tools(state)}


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_empty_goal_is_not_a_product_even_if_user_said_hello():
    """不看当前这句话。goal 空 = 没产品，hello / 你能做啥 都一样。"""
    st = V5SessionState(
        sessionId="cheap-hello",
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[
            {"role": "user", "kind": "turn", "text": "hello"},
        ],
    )
    assert _has_product_topic(st) is False
    st.controlTranscript = [{"role": "user", "kind": "turn", "text": LIVE_META}]
    assert _has_product_topic(st) is False
    st.goal = {"text": LIVE_CONTINUE, "status": "needs_refinement"}
    assert _has_product_topic(st) is False
    st.goal = {"text": REAL_TOPIC, "status": "clear"}
    assert _has_product_topic(st) is True


def test_auto_grant_rejects_the_live_pair():
    """真机：user_text=你能做啥 original_goal=继续。字数够了也不许授予。"""
    assert _can_auto_grant_scope(LIVE_META, LIVE_CONTINUE) is False
    assert _can_auto_grant_scope(LIVE_META, "") is False
    assert _can_auto_grant_scope(LIVE_CONTINUE, "") is False
    assert _can_auto_grant_scope("hello", "") is False
    assert _can_auto_grant_scope(REAL_TOPIC, "") is False
    # 已有真产品时，「继续」是跟进，不是新话题——授予仍成立。
    assert _can_auto_grant_scope(LIVE_CONTINUE, "请假系统") is True
    assert _can_auto_grant_scope("hello", REAL_TOPIC) is True


def test_continue_and_meta_do_not_list_write_tools():
    """没写入 goal 就不列问卷 / 范围卡。当前这句话随便说。"""
    for text in (LIVE_CONTINUE, LIVE_META, "hello", "早上好"):
        st = V5SessionState(
            sessionId=f"cheap-list-{text}",
            goal={"text": "", "status": "needs_refinement"},
            controlTranscript=[{"role": "user", "kind": "turn", "text": text}],
        )
        names = _names(st)
        assert "clarify" not in names, text
        assert "scope_card" not in names, text
        assert "spec" not in names, text
        assert "rehearse" not in names, text
        assert "ask_user" in names, text
    clinic = V5SessionState(
        sessionId="cheap-list-clinic",
        goal={"text": "诊所系统", "status": "needs_refinement"},
    )
    assert "scope_card" in _names(clinic)
    assert "clarify" not in _names(clinic)


def test_prompt_does_not_report_missing_dims_on_meta():
    for text in ("", LIVE_CONTINUE):
        hi = _system_prompt(
            V5SessionState(
                sessionId=f"cheap-prompt-{text or 'empty'}",
                goal={"text": text, "status": "needs_refinement"},
            )
        )
        assert "还没读到" not in hi, text


def test_need_answer_continue_does_not_stamp_goal_or_dump_canned(harness):
    """真机路径 1：芯片「继续」是纸条回执，不是产品名，空回复不许套开场罐头。"""
    sid = new_sid("cheap-continue")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_ask",
        awaitDetail="请问有什么需要帮助的？",
        runtimePhase="awaiting",
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "ask_user",
                "text": "请问有什么需要帮助的？",
                "options": ["继续", "退出"],
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("")
    _, events = harness.post(
        six_fields(
            sid,
            LIVE_CONTINUE,
            toolAnswer={"kind": "ask_user", "text": LIVE_CONTINUE},
        )
    )
    loaded = load_session(sid)
    assert loaded is not None
    goal = (loaded.goal or {}).get("text") if isinstance(loaded.goal, dict) else ""
    assert goal != LIVE_CONTINUE, f"芯片「继续」被写成了目标：{goal!r}"
    texts = [
        str(e.get("text") or "")
        for e in events
        if e.get("type") == "control_text"
    ]
    blob = "\n".join(texts)
    assert CANNED_FAILURE not in blob
    assert "说一个要做的应用" not in blob
    assert "请调 pages" not in blob
    assert CHEAP_TURN_FALLBACK in blob or any(texts)
    assert harness.helper_calls == []
    assert "control_handoff_factory" not in event_types(events)


def test_neng_zuo_sha_does_not_ignite_spec(harness):
    """真机路径 2：goal 已被芯片写成继续，用户问你能做啥，夹具硬挑 spec。

    旧尺子字数够 → 自动授予 → helper≥1。删掉产品话题判定本条必红。
    """
    sid = new_sid("cheap-meta")
    seed_session(
        sid,
        goal={"text": LIVE_CONTINUE, "status": "needs_refinement"},
    )
    harness.llm_impl = lambda messages, **kw: llm_tool("spec", {})
    _, events = harness.post(six_fields(sid, LIVE_META))
    types = event_types(events)
    assert harness.helper_calls == [], (
        "「你能做啥」点着了工厂。"
        f"事件：{types}"
    )
    assert "control_handoff_factory" not in types
    listed = []
    for call in harness.llm_calls:
        tools = (call.get("kwargs") or {}).get("tools") or []
        listed.extend(
            (t.get("function") or {}).get("name")
            for t in tools
            if isinstance(t, dict)
        )
    assert "spec" not in listed, f"能力问答还把 spec 列给模型：{listed}"


def test_composer_nihao_does_not_answer_a_stuck_clarify_card(harness):
    """卡还摊着时，作曲家打「你好」是新话，不是答谁用。"""
    sid = new_sid("cheap-dismiss-clarify")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        awaitReason="control_clarify",
        awaitDetail="请问这款产品主要面向哪类用户？",
        runtimePhase="awaiting",
        coverageGaps=[
            {
                "id": "gap-q-stuck",
                "kind": "open_question",
                "label": "请问这款产品主要面向哪类用户？",
                "status": "open",
                "reason": "control_plane_clarify",
                "createdAt": "2026-09-08T00:00:00Z",
            }
        ],
        controlTranscript=[
            {
                "role": "assistant",
                "kind": "clarify",
                "text": "请问这款产品主要面向哪类用户？",
            }
        ],
    )
    harness.llm_impl = lambda messages, **kw: llm_text("请问有什么需要帮助的？")
    _, events = harness.post(six_fields(sid, "你好"))
    loaded = load_session(sid)
    assert loaded is not None
    goal = (loaded.goal or {}).get("text") if isinstance(loaded.goal, dict) else ""
    assert goal != "你好", f"「你好」被写成了目标：{goal!r}"
    assert loaded.awaitReason != "control_clarify"
    gaps = [
        g
        for g in (loaded.coverageGaps or [])
        if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None))
        == "open"
    ]
    assert gaps == [], "澄清缺口还开着，卡会粘在下一轮"
    assert "control_clarify" not in event_types(events)
    assert harness.helper_calls == []


def test_hello_does_not_list_clarify_or_ignite(harness):
    """真机：发 hello 弹出「哪类用户」澄清卡。清单不许有 clarify/spec。"""
    sid = new_sid("cheap-hello")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    listed: list = []

    def impl(messages, **kw):
        tools = kw.get("tools") or []
        listed.extend(
            (t.get("function") or {}).get("name")
            for t in tools
            if isinstance(t, dict)
        )
        return llm_text("请问有什么需要帮助的？")

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, "hello"))
    assert "clarify" not in listed, listed
    assert "spec" not in listed, listed
    assert "scope_card" not in listed, listed
    assert harness.helper_calls == []
    types = event_types(events)
    assert "control_handoff_factory" not in types
    assert "control_clarify" not in types


def test_need_answer_path_does_not_pass_canned_as_empty_text():
    """变异：把 NeedUserAnswer 的 empty_text 改回 CANNED_FAILURE → 红。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "empty_text=CANNED_FAILURE" not in src
    assert "CHEAP_TURN_FALLBACK" in src


def test_product_gate_does_not_enumerate_what_people_say():
    """用户会说任意话。把 hello/你能做啥 写进问候表不是办法。"""
    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    at = src.find("def _has_product_topic")
    chunk = src[at : src.find("def should_list_tool", at)]
    assert "hello" not in chunk
    assert "你能做啥" not in chunk
    assert "_goal_text" in src[at : at + 400]
