"""新的一句用户话要看得见之前几轮说过什么（rehearsal_control._conversation_history 头注）。

⚠ 2026-10-02 隔离真机第 187 轮 sr-20261002073509-V62QMVEWQF：先让它给读书会想 5 个名字，追问
  「第 3 个不错，帮我配一句 15 字以内的口号」——它回「把第 3 个名字发我一下」。新回合的 messages
  只有 system + 这一句。下面的话是那一轮原文。走真 HTTP（ControlHarness），看模型那一发实际收到什么。

变异：新回合 messages 里去掉 *_conversation_history(state) → 第一条红。
"""

from __future__ import annotations

import copy

import pytest

from control_turn_support import ControlHarness, llm_text, new_sid, seed_session, six_fields
from services import rehearsal_control as control

ASK = "帮我给公司的读书会想 5 个名字，要有点书卷气但别太老气，每个名字后面一句话解释"
NAMES = ("1. **字里相逢**  \n   既有“在文字中相遇”的书卷气，也体现同事因阅读而交流、连接。\n\n"
         "2. **半卷清谈**  \n   取“半卷书，几席清谈”之意。\n\n3. **阅见同行**  \n   将“阅读”与“遇见”结合。")
FOLLOW = "第 3 个不错，帮我配一句 15 字以内的口号"


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _turn(harness, sid, text, reply):
    seen = []

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return llm_text(reply)

    harness.llm_impl = impl
    harness.post(six_fields(sid, text))
    return seen


def test_the_follow_up_sees_the_names_it_refers_to(harness):
    sid = new_sid("history")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    first = _turn(harness, sid, ASK, NAMES)
    assert [m["role"] for m in first[0]] == ["system", "user"]          # 第一句前面没有历史
    second = _turn(harness, sid, FOLLOW, "「字里遇见，彼此同行」")
    roles = [m["role"] for m in second[0]]
    assert roles == ["system", "user", "assistant", "user"]
    assert second[0][1]["content"] == ASK
    assert "阅见同行" in second[0][2]["content"]                       # 第 3 个是什么，模型看得见
    assert second[0][-1]["content"] == FOLLOW                          # 这一句仍在最后


def test_only_what_was_said_to_the_user_is_carried():
    """工具开始/回执、计划、问卷这些行不进对话历史（它们要么在系统提示里，要么在磁盘上）。"""
    state = control.V5SessionState(sessionId="s", goal={"text": "", "status": "needs_refinement"}, controlTranscript=[
        {"role": "user", "kind": "turn", "text": "做一份PPT"},
        {"role": "assistant", "kind": "tool_start", "tool": "skill", "summary": "office-skills"},
        {"role": "assistant", "kind": "tool_result", "tool": "skill", "ok": True},
        {"role": "assistant", "kind": "control_text", "text": "已生成 6 页。"},
        {"role": "user", "kind": "turn", "text": "第 4 页改一下"},
    ])
    history = control._conversation_history(state)
    assert history == [{"role": "user", "content": "做一份PPT"}, {"role": "assistant", "content": "已生成 6 页。"}]


def test_long_sessions_keep_the_most_recent_rounds_within_the_cap():
    """反向：不是整段会话原样塞进去——超了丢更早的整轮，最近的留着，角色仍交替。"""
    rows = []
    for i in range(20):
        rows += [{"role": "user", "kind": "turn", "text": f"第{i}问"},
                 {"role": "assistant", "kind": "control_text", "text": f"第{i}答" + "字" * 2500}]
    rows.append({"role": "user", "kind": "turn", "text": "现在这一问"})
    history = control._conversation_history(control.V5SessionState(sessionId="s", goal={"text": "", "status": "needs_refinement"}, controlTranscript=rows))
    assert sum(len(m["content"]) for m in history) <= control.HISTORY_MAX_CHARS
    assert history[-2]["content"] == "第19问" and history[-1]["content"].startswith("第19答")
    assert all(a["role"] != b["role"] for a, b in zip(history, history[1:]))
    assert history[0]["role"] == "user"
