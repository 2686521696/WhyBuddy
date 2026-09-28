"""写了计划没提交批准就收尾：提醒一次，让它把批准卡片出出来。

⚠ 2026-09-28 隔离真机第 88 轮 sr-20260928051506-DCA1VEMN9M（每日习惯打卡网页，装了
  systematic-debugging）：write_plan 之后说「计划已保存，等待批准后开始创建网页。」就收尾——
  没调 exit_plan_mode。用户那边没有批准卡片、看不到计划，只有这句话；驱动等了 45 分钟。

判据走真 HTTP（ControlHarness）。计划正文与那句话是第 88 轮原样（fixtures/round88_habit_plan.md）。
把 _control_llm_loop 里 _plan_written_unsubmitted 那支删掉，第一条变红。
"""

from __future__ import annotations

import copy
from pathlib import Path

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services.rehearsal_control import PLAN_NOT_SUBMITTED_REMINDER
from services.slide_rule_session import load_session

PLAN = (Path(__file__).parent / "fixtures" / "round88_habit_plan.md").read_text("utf-8")
ROUND88_TOPIC = "做一个每日习惯打卡网页：添加习惯，每天勾选完成，显示连续天数和本周完成率，数据存在浏览器"
ROUND88_CLOSING = "计划已保存，等待批准后开始创建网页。"


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _run(harness, script):
    sid = new_sid("plan-unsubmitted")
    seed_session(sid, goal={"text": "每日习惯打卡网页", "status": "clear"})
    shots = []
    steps = iter(script)

    def impl(messages, **kw):
        shots.append(copy.deepcopy(messages))
        return next(steps)

    harness.llm_impl = impl
    _, events = harness.post(six_fields(sid, ROUND88_TOPIC))
    return sid, events, shots


def test_the_model_is_reminded_and_the_approval_card_appears(harness):
    sid, events, shots = _run(harness, [
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_text(ROUND88_CLOSING),
        llm_tool("exit_plan_mode", {}),
    ])
    assert any(e["type"] == "control_plan_approval" for e in events), [e["type"] for e in events]
    assert load_session(sid).awaitReason == "control_plan_approval"
    # 它那句话照样到了界面上
    assert any(e["type"] == "control_text" and e["text"] == ROUND88_CLOSING for e in events)
    assert PLAN_NOT_SUBMITTED_REMINDER in str(shots[2])


def test_only_one_reminder_per_turn(harness):
    """反向：提醒一次它还是只说话，就照常收尾，不许绕圈。"""
    _, events, shots = _run(harness, [
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_text(ROUND88_CLOSING),
        llm_text(ROUND88_CLOSING),
    ])
    assert len(shots) == 3
    assert events[-1]["type"] == "complete"
    assert not any(e["type"] == "control_plan_approval" for e in events)


def test_a_submitted_plan_gets_no_reminder(harness):
    """反向：已经出过批准卡片的，收尾时不再提醒。"""
    _, events, shots = _run(harness, [
        llm_tool("write_plan", {"planContent": PLAN}),
        llm_tool("exit_plan_mode", {}),
    ])
    assert any(e["type"] == "control_plan_approval" for e in events)
    assert all(PLAN_NOT_SUBMITTED_REMINDER not in str(shot) for shot in shots)
