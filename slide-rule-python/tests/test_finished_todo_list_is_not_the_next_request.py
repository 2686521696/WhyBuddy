# -*- coding: utf-8 -*-
"""上一轮做完的活儿清单，不许被当成下一句话的计划。

⚠ 2026-09-27 隔离真机第 40–65 轮：追问轮的第一发 todo_write 几乎每一轮都是**首轮那张**，
  状态翻回 ◐/○。第 65 轮 sr-20260927190013-AJ2QM1WR1Y：首轮 Markdown 笔记做完，清单
  4/4；用户追问「加一个按标签筛选笔记的功能，并支持给笔记置顶」，左栏写
  「活儿清单 0/4 · 正在做：检查现有 React/Vite 工程结构与依赖」，第二条是
  「实现笔记工作台、Markdown 预览与 localStorage 自动保存」——那是上一件事。
  首轮没列过清单的追问（第 45、58、59 轮）列的都是这一轮自己的步骤：病在回喂。

判据走真 HTTP（ControlHarness），会话里摆第 65 轮那张做完的清单原样，
追问也是那一轮原话。把 rehearsal_control 里 `state.controlTodo = []` 那支删掉，前两条变红。
"""

from __future__ import annotations

import copy

import pytest

from control_turn_support import (
    ControlHarness,
    llm_text,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.plan_todo import finished, normalize
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

# 第 65 轮首轮收尾时落库的 controlTodo，原样。
ROUND65_DONE = [
    {"id": "inspect", "content": "检查现有 React/Vite 工程结构与依赖", "status": "completed"},
    {"id": "implement", "content": "实现笔记工作台、Markdown 预览与 localStorage 自动保存", "status": "completed"},
    {"id": "style", "content": "完成响应式布局与空状态、搜索状态", "status": "completed"},
    {"id": "verify", "content": "运行检查、构建、测试并启动预览验证", "status": "completed"},
]
ROUND65_FOLLOWUP = "加一个按标签筛选笔记的功能，并支持给笔记置顶"


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _turn(harness, todo, text=ROUND65_FOLLOWUP):
    sid = new_sid("todo-next")
    seed_session(sid, goal={"text": "Markdown 笔记网页", "status": "clear"},
                 modelVersions=[{"id": "v1", "model": {"pages": []}}],
                 controlTodo=copy.deepcopy(todo))
    shots: list = []
    harness.llm_impl = lambda messages, **kw: shots.append(copy.deepcopy(messages)) or llm_text("好的")
    harness.post(six_fields(sid, text))
    return sid, str(shots[0][0].get("content") or "")


def test_the_finished_list_is_not_fed_as_this_turns_plan(harness):
    _, system = _turn(harness, ROUND65_DONE)
    assert "实现笔记工作台" not in system
    assert "你列的活儿清单" not in system


def test_the_finished_list_does_not_linger_in_the_session(harness):
    sid, _ = _turn(harness, ROUND65_DONE)
    assert normalize(getattr(load_session(sid), "controlTodo", None)) == []


def test_an_unfinished_list_is_still_fed_back(harness):
    """反向：没做完的照旧回喂——「继续」要接着那张做（也是被清掉的那半不许扩大）。"""
    unfinished = copy.deepcopy(ROUND65_DONE)
    unfinished[3]["status"] = "in_progress"
    sid, system = _turn(harness, unfinished, "继续")
    assert "你列的活儿清单" in system and "verify: 运行检查" in system
    assert [r["id"] for r in normalize(load_session(sid).controlTodo)] == [r["id"] for r in ROUND65_DONE]


def test_finished_means_every_row_is_done_or_cancelled():
    assert finished(ROUND65_DONE)
    assert finished([{**ROUND65_DONE[0], "status": "cancelled"}, ROUND65_DONE[1]])
    assert not finished([])
    assert not finished([{**ROUND65_DONE[0], "status": "pending"}, ROUND65_DONE[1]])
