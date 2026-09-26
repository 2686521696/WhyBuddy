"""选了「其他（自己写）」却没写字，不是答案——服务端这一半。

⚠ 2026-09-26 隔离真机 sr-20260926021240-CW3R92STR7（PPT 话题）：第三问「请补全
  下面模板中的真实内容」没给预设选项，卡片自动选中 Other，「确认继续」空着就交了。
  落进 transcript 的 user_answer 是原样这一条：

      answers={"q1": ["其他（自己写）"]}  outcome="accepted"  notes={}

  模型收到 `= 「其他（自己写）」`——标签原文，零信息——只好在对话里再要一遍，
  然后停住等人，一轮 45 分钟就耗在这儿。前端已置灰确认键
  （`questionnaire-other-needs-text.test.tsx`），这里挡老前端和脚本手打的回执
  （本仓 §四）。

载荷照前端 `submitQuestionnaire` 送的形状原样拼（kind=ask_user、text 是左栏那句
人话、reqId 取自问卡事件），题目取自那条会话。把 `_stamp_user_answer` 里那道
拦截删掉，第一条变红；把 `_model_text_for_answer` 的过滤删掉，「别再问了」那条变红。
"""

from __future__ import annotations

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services.user_questions import (
    OTHER_LABEL,
    empty_other_answers,
    format_accepted,
    without_empty_other,
)

pytest.importorskip("fastapi")

FILL_TEMPLATE = (
    "请补全下面模板中的真实内容后发我，我再整理成约 10 页 PPT 计划：\n"
    "指标1：新客转化率｜Q3 数值｜目标/对比值｜变化说明\n做成1：\n下季度重点1："
)


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _parked_on_the_fill_in(harness):
    sid = new_sid("other-empty")
    seed_session(sid, goal={"text": "2026 年第三季度产品复盘 PPT", "status": "clear"})
    harness.llm_impl = lambda m, **k: (
        llm_tool("ask_user_question", {"questions": [{"question": FILL_TEMPLATE, "options": []}]}, call_id="ask")
        if len(harness.llm_calls) == 1
        else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "帮我做一份季度复盘 PPT"))
    ask = [e for e in events if e.get("type") == "control_ask_user"][-1]
    assert ask["questions"][0]["options"] == []
    return sid, ask["reqId"]


def _answer(sid, req_id, *, outcome="accepted", answers=None, notes=None, text=None):
    answers = {"q1": [OTHER_LABEL]} if answers is None else answers
    payload = six_fields(sid, text or f"{FILL_TEMPLATE}：{OTHER_LABEL}")
    payload["toolAnswer"] = {
        "kind": "ask_user", "text": text or f"{FILL_TEMPLATE}：{OTHER_LABEL}",
        "reqId": req_id, "outcome": outcome, "answers": answers, "notes": notes or {},
    }
    return payload


def _session(sid):
    from services.slide_rule_session import load_session
    return load_session(sid)


def test_an_empty_other_is_sent_back_and_the_card_stays(harness):
    sid, req_id = _parked_on_the_fill_in(harness)
    sampled = len(harness.llm_calls)
    _, events = harness.post(_answer(sid, req_id))

    rejected = [e for e in events if e.get("type") == "control_tool_result" and e.get("tool") == "ask_user_question"]
    assert rejected and rejected[-1]["ok"] is False and rejected[-1]["error"] == "question_other_empty", events
    assert "写上你的答案" in rejected[-1]["human"]
    assert len(harness.llm_calls) == sampled, "模型不许拿着标签原文再采样一次"
    state = _session(sid)
    assert state.awaitReason == "control_ask", "卡片要原样摊着，用户写完还能交"
    assert not [r for r in state.controlTranscript if r.get("kind") == "user_answer"]


def test_what_the_user_wrote_reaches_the_model(harness):
    """反向（§三）：写了字的 Other 照常收，模型看见的是那段字。"""
    sid, req_id = _parked_on_the_fill_in(harness)
    seen: list = []
    harness.llm_impl = lambda m, **k: (seen.append(m), llm_text("收到"))[1]
    _, events = harness.post(_answer(sid, req_id, notes={"q1": "指标1：新客转化率｜8.6%｜目标 8.0%"}))

    assert not [e for e in events if e.get("error") == "question_other_empty"]
    blob = "\n".join(str(msg.get("content") or "") for turn in seen for msg in turn)
    assert "新客转化率｜8.6%" in blob, blob[-600:]
    assert _session(sid).awaitReason != "control_ask"


def test_skip_does_not_hand_the_label_to_the_model(harness):
    """「别再问了」照样放行，但空着的 Other 不算选了——标签原文不进模型的话。"""
    sid, req_id = _parked_on_the_fill_in(harness)
    seen: list = []
    harness.llm_impl = lambda m, **k: (seen.append(m), llm_text("那我直接开始"))[1]
    harness.post(_answer(sid, req_id, outcome="skip_interview", text="别再问了，直接开始"))

    blob = "\n".join(str(msg.get("content") or "") for turn in seen for msg in turn)
    assert "别再问了" in blob, blob[-600:]
    assert OTHER_LABEL not in blob, blob[-600:]
    stamped = [r for r in _session(sid).controlTranscript if r.get("kind") == "user_answer"]
    assert stamped and stamped[-1]["answers"] == {}


def test_the_pure_rule_both_ways():
    assert empty_other_answers({"q1": [OTHER_LABEL]}, {}) == ["q1"]
    assert empty_other_answers({"q1": [OTHER_LABEL]}, {"q1": "  "}) == ["q1"]
    assert empty_other_answers({"q1": [OTHER_LABEL, "浅色商务风"]}, None) == ["q1"]
    assert empty_other_answers({"q1": [OTHER_LABEL]}, {"q1": "我自己的"}) == []
    assert empty_other_answers({"q1": ["浅色商务风"]}, {}) == []
    assert without_empty_other({"q1": [OTHER_LABEL], "q2": [OTHER_LABEL, "A"]}, {}) == {"q2": ["A"]}
    # 写了字的 Other 回喂时带着用户那段话
    text = format_accepted([{"id": "q1", "question": "填模板"}], {"q1": [OTHER_LABEL]}, {"q1": "8.6%"})
    assert "用户补充：8.6%" in text
