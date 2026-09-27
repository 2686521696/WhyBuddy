"""首轮产品话题、模型用一段话提问：不许被换成「想做什么应用，说一句就行。」

⚠ 2026-09-27 隔离真机第 49 轮 sr-20260927150004-B5NQ360S0J：用户第一句「做一个小公司
  员工信息登记 Excel：工号、姓名、部门、岗位、入职日期、手机号，部门用下拉选择，手机号
  要有格式校验」。模型没调 ask_user_question，用一段话列出要确认的两项（部门下拉、
  手机号规则）。收尾分发处只看 _has_product_topic（goal 还没 stamp → 假），于是在那段话
  后面挂了一张「想做什么应用，说一句就行。」——用户刚说完要做什么，卡片反问做什么。
  同一轮的提示词事实也写着「还没有应用目标」。两处都改用 _ask_is_cheap_intake（§四）。

走真的控制面 harness，用户那句是第 49 轮原样。
把分发处改回 not _has_product_topic(state)，第一条变红。
"""

from __future__ import annotations

import pytest

from control_turn_support import ControlHarness, event_types, llm_text, new_sid, seed_session, six_fields
from services.rehearsal_control import CHEAP_TURN_FALLBACK

pytest.importorskip("fastapi")

ROUND49_TURN = "做一个小公司员工信息登记 Excel：工号、姓名、部门、岗位、入职日期、手机号，部门用下拉选择，手机号要有格式校验"
ROUND49_REPLY = ("我会制作一个可直接使用的员工信息登记 Excel，包含工号、姓名、部门、岗位、入职日期、手机号。\n\n"
                 "还需要确认两项设置：\n\n1. 部门下拉选项使用哪种方式？\n2. 手机号格式校验采用哪种规则？")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _run(harness, turn, reply):
    sid = new_sid("first-text")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    seen: list = []

    def llm(messages, **kw):
        seen.append(messages)
        return llm_text(reply)

    harness.llm_impl = llm
    _, events = harness.post(six_fields(sid, turn))
    return events, seen


def test_a_product_request_keeps_the_models_own_questions(harness):
    events, _ = _run(harness, ROUND49_TURN, ROUND49_REPLY)
    texts = [e.get("text") for e in events if e.get("type") == "control_text"]
    assert any("手机号格式校验" in (t or "") for t in texts), event_types(events)
    asks = [e for e in events if e.get("type") == "control_ask_user"]
    assert all(CHEAP_TURN_FALLBACK not in str(a.get("question")) for a in asks), asks


def test_the_model_is_not_told_there_is_no_goal(harness):
    """提示词侧（同一条判据的另一处）：用户已经说了要做什么，别告诉模型「还没有应用目标」。"""
    _, seen = _run(harness, ROUND49_TURN, ROUND49_REPLY)
    system = str(seen[0][0].get("content") or "")
    assert "还没有应用目标" not in system


def test_a_greeting_still_gets_the_open_question(harness):
    """反向：只打了个招呼，照旧问一句想做什么。"""
    events, seen = _run(harness, "你好", "你好！")
    asks = [e for e in events if e.get("type") == "control_ask_user"]
    assert asks and CHEAP_TURN_FALLBACK in str(asks[0].get("question"))
    assert "还没有应用目标" in str(seen[0][0].get("content") or "")
