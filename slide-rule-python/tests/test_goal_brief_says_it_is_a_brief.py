"""系统提示里的「当前目标」可以摘，但不能装成全文。

⚠ 2026-10-04 真机 @office-skills 门店销售 Excel（sr-20261004022542-B36BSG2G90）：用户贴了 10 行 CSV（261 字），
  系统提示原来是 `goal[:200]`，硬切在第 6 行中间、不说切了。执行回合的对话里其实有全文，模型却说
  「原始消息在末尾截断，我按计划里的核对值补齐最后 4 条明细」——计划里没核对值时就是在编用户的数据。

喂的是那一场执行回合开始时的原样 goal / controlTranscript（fixtures/goal_brief_csv_session.json），不自己拼（§一之二）。
"""

import json
from pathlib import Path

from models.v5_state import V5SessionState
from services import rehearsal_control as rc

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "goal_brief_csv_session.json").read_text("utf-8"))


def _state() -> V5SessionState:
    return V5SessionState(sessionId=FIXTURE["sessionId"], ownerId=FIXTURE["ownerId"],
                          goal=FIXTURE["goal"], controlTranscript=FIXTURE["controlTranscript"])


def _target_line(prompt: str) -> str:
    start = prompt.index("当前目标：") + len("当前目标：")
    return prompt[start:prompt.index("。停泊：", start)]


def test_the_brief_says_it_is_a_brief_and_where_the_full_text_is():
    original = FIXTURE["goal"]["text"]
    assert len(original) == 261  # 前提：真机那句确实超过摘要长度
    target = _target_line(rc._system_prompt(_state()))
    assert f"共 {len(original)} 字" in target
    assert "全文在对话里" in target


def test_the_brief_never_ends_in_the_middle_of_a_data_row():
    """反向：不许再出现真机那种「9/3,浦东店,轻食,1800\\n9/」半行。摘下来的每一行都是原文里的整行。"""
    original_lines = set(FIXTURE["goal"]["text"].split("\n"))
    head = _target_line(rc._system_prompt(_state())).split("……（只摘了开头")[0]
    for line in head.split("\n"):
        assert line in original_lines, f"半行：{line!r}"


def test_what_the_brief_points_to_is_really_there():
    """说「全文在对话里」就得真在：执行回合的对话历史里有用户原话一字不差。"""
    history = rc._conversation_history(_state(), include_current=True)
    assert any(m["role"] == "user" and m["content"] == FIXTURE["goal"]["text"] for m in history)


def test_a_short_goal_is_left_alone():
    assert rc._goal_brief("做一个待办清单") == "做一个待办清单"
    assert "只摘了开头" not in rc._goal_brief("x" * rc.GOAL_BRIEF_MAX_CHARS)
