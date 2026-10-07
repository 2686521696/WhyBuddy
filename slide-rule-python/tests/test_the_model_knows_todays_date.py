"""控制面模型知道今天是哪天（北京时间）。

⚠ 2026-10-07 真机 r89 sr-20261007172019-AE820JF286（@postmortem-writing「昨天（10月6日）订单服务挂了」）：复盘正文很好，
  交付文件名是 …-2024-10-06.md——系统提示里没有日期，模型拿训练数据里的年份补（rehearsal_control._today_fact 头注）。
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone

from control_turn_support import ControlHarness, llm_text, new_sid, seed_session, six_fields
from services import rehearsal_control as control

TOPIC = "@postmortem-writing 帮我写一份事故复盘：昨天（10月6日）订单服务挂了"


def test_the_real_turn_tells_the_model_the_date(monkeypatch):
    harness = ControlHarness(monkeypatch)
    seen = []

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return llm_text("好。")
    harness.llm_impl = impl
    sid = new_sid("today")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    harness.post(six_fields(sid, TOPIC))
    system = seen[0][0]["content"]
    today = datetime.now(timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo("Asia/Shanghai"))
    assert f"今天是 {today:%Y-%m-%d}" in system


def test_beijing_date_not_utc_date():
    """UTC 10-06 17:30 在北京已经是 10-07（星期三）——用户说「昨天」指的是 10-06，不是 10-05。"""
    fact = control._today_fact(datetime(2026, 10, 6, 17, 30, tzinfo=timezone.utc))
    assert fact.startswith("今天是 2026-10-07（星期三")
