"""算数原语（calculate）：规划期就能算，别心算。

⚠ 2026-10-06 真机 r33 sr-20261006045715-M51333CGA5（@data-storytelling @pptx-deck-context 奶茶店投资人汇报）：规划期
  心算 `12×(1-32%)-2-2.4` 得 4.16（实为 3.76），据此对用户说数字自相矛盾，又编出「开业爬坡、平台/支付、税费…」去圆
  用户本来自洽的 136.6 万（services/calculator 头注）。下面的算式就是那一场模型写进计划的原式。
走真 HTTP 规划回合（ControlHarness），看模型实际拿到的工具和回执。
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services.calculator import calculate
from services.closed_tools import CLOSED_TOOLS
from services.control_goal_continuation import READ_ONLY_TOOLS

TOPIC = ("@data-storytelling @pptx-deck-context 帮我做一份 5 页的投资人汇报 PPT：奶茶店初始投资 45 万，第一年月营收 12 万、"
         "年增长 15%，原料成本 32%，房租 2 万/月，人工 2.4 万/月，第 12 个月回本，三年末累计现金流约 136.6 万。")
R33 = ["月贡献 = 12*(1-32%)-2-2.4", "回本月 = 45/月贡献",
       "三年 = 月贡献*12 + (12*1.15*(1-32%)-4.4)*12 + (12*1.15*1.15*(1-32%)-4.4)*12", "三年 - 45"]


def _planning_turn(monkeypatch, steps):
    harness = ControlHarness(monkeypatch)
    seen, it = [], iter(steps)

    def impl(messages, **kw):
        seen.append({"messages": copy.deepcopy(messages), "tools": [t["function"]["name"] for t in kw.get("tools") or []]})
        return next(it)
    harness.llm_impl = impl
    sid = new_sid("calc")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    _, events = harness.post(six_fields(sid, TOPIC))
    return seen, events


def test_offered_while_planning_and_the_answer_reaches_the_model(monkeypatch):
    seen, events = _planning_turn(monkeypatch, [
        llm_tool("calculate", {"lines": R33}, call_id="calc-1"),
        llm_text("用户给的数字是自洽的：月贡献 3.76 万，第 12 个月回本。"),
    ])
    assert "calculate" in seen[0]["tools"]                              # 规划期（还没批准计划）就摆着
    assert "write_plan" in seen[0]["tools"] and "project_create" not in seen[0]["tools"]  # 前提：确实是规划期
    back = next(m for m in seen[1]["messages"] if m.get("role") == "tool" and m.get("tool_call_id") == "calc-1")
    body = json.loads(back["content"]) if back["content"].startswith("{") else back["content"]
    text = json.dumps(body, ensure_ascii=False)
    assert '"value": 3.76' in text and "136.6272" in text                # 真算出来的数回到模型手里
    result = next(e for e in events if e.get("type") == "control_tool_result" and e.get("tool") == "calculate")
    assert result["ok"] is True


def test_the_r33_numbers_were_consistent_all_along():
    out = calculate(R33)
    values = [row["value"] for row in out["results"]]
    assert values[0] == 3.76 and 11 < values[1] <= 12 and round(values[3], 1) == 136.6


def test_only_arithmetic_is_accepted():
    """反向：不是 Python——导入、属性、任意调用一律拒，照实说哪一行。"""
    for line in ['__import__("os").system("id")', "().__class__", "open('/etc/passwd')", "x"]:
        out = calculate([line])
        assert out["ok"] is False and line in out["error"]
    assert calculate(["1/0"])["error"].endswith("除以 0")
    assert calculate(["2**100000"])["ok"] is False


def test_known_on_both_sides_and_safe_to_retry():
    assert "calculate" in CLOSED_TOOLS and "calculate" in READ_ONLY_TOOLS
    ts = (Path(__file__).resolve().parents[2] / "client/src/lib/factory-hops.ts").read_text("utf-8")
    assert ts.count('"calculate"') >= 2                                  # 封闭名单 + 轨迹白名单


def test_a_label_that_is_not_a_name_still_gets_computed():
    """⚠ r34 原样：左边带中文括号，不是合法名字——照样算右边，只是后面不能引用它。"""
    out = calculate(["三年累计现金流（扣初始投资） = 1816272-450000", "月贡献 = 3.76", "月贡献*12"])
    assert out["ok"] and [r["value"] for r in out["results"]] == [1366272, 3.76, 45.12]
    assert out["results"][0]["name"] == "三年累计现金流（扣初始投资）"
    assert calculate(["a == 1"])["ok"] is False                      # 比较不是赋值
