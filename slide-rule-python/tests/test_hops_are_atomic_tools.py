"""第 4 格：工厂 hop 是原子工具，不是焊死的课表。

抄 grok-build `Tool::execute`：点哪件跑哪件。日历是另一件工具
（`workflow`）。待办是交回 host 的 reminder，闭环 fail-closed。

⚠ 真机形态（2026-09-07 / 漫画第 4 格）：
  你叫了 pages，goal.tools=['pages']，待办 structure/bind，
  流水线把待办焊回来 → capabilityPlan=pages,structure,bind。
  主 Agent 不能决定路径，只能按工序来。

变异：live_spec_first_tools 再并待办、rehearse 再展开 first_pass、
假设确认再 stamp 剩余链 → 本文件红。
反向：workflow 日历仍一次跑完配方；真产品仍能点 spec。
"""
from __future__ import annotations

import pytest

from control_turn_support import (
    PY_ROOT,
    ControlHarness,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from models.v5_state import V5SessionState
from services.capability_plan import live_spec_first_tools
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_pipeline_runs_the_stamped_hop_not_the_todo():
    """真机载荷：stamp=pages，待办 structure/bind。流水线只许 pages。"""
    assert live_spec_first_tools(
        ["pages"], ["structure", "bind"], has_spec=True
    ) == ("pages",)
    assert live_spec_first_tools(["bind"], [], has_spec=True) == ("bind",)
    assert live_spec_first_tools(
        ["spec", "pages"], None, has_spec=True
    ) == ("pages",)


def test_live_spec_first_tools_does_not_read_todo():
    """变异：再把 factory_todo_open 并进菜单 → 红。"""
    src = strip_python(PY_ROOT / "services" / "capability_plan.py")
    at = src.find("def live_spec_first_tools")
    assert at > 0
    chunk = src[at : src.find("def is_first_pass_chain", at)]
    assert "factory_todo_open" not in chunk
    assert "FIRST_PASS_TOOLS" not in chunk


def test_rehearse_ignites_spec_and_parks_the_rest_on_todo(harness):
    """开始推演 = 第一件 spec。其余进待办，不许一口气跑课表。"""
    sid = new_sid("p4-rehearse")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    harness.llm_impl = lambda messages, **kw: llm_text("规格已经记下。")
    harness.post(six_fields(sid, "将做成：请假系统", forcedTool="rehearse"))
    loaded = load_session(sid)
    assert loaded is not None
    tools = (loaded.goal or {}).get("tools") if isinstance(loaded.goal, dict) else None
    assert list(tools or []) == ["spec"], tools
    todo = list(getattr(loaded, "factoryTodo", None) or [])
    assert "pages" in todo and "structure" in todo and "bind" in todo, todo
    assert "spec" not in todo
    assert harness.helper_calls[-1].get("goal_tools") == ["spec"]


def test_confirm_pages_is_one_hop(harness):
    """假设确认 forcedTool=pages：只 stamp pages。structure/bind 留待办。"""
    sid = new_sid("p4-confirm")
    seed_session(
        sid,
        goal={"text": "社区图书馆借还书系统", "status": "clear"},
        controlTranscript=[
            {
                "id": "ct-1",
                "kind": "scope_card",
                "text": "社区图书馆借还书系统",
                "tools": ["spec", "pages", "structure", "bind", "closure"],
            },
            {"id": "ct-2", "kind": "scope_confirmed", "text": "社区图书馆借还书系统"},
        ],
        specFirstPages={
            "spec": {
                "appName": "社区图书馆",
                "pages": [{"id": "p1", "name": "借还台"}],
                "nodes": [{"id": "n0", "title": "借还"}],
            },
            "pages": {},
        },
    )
    harness.llm_impl = lambda messages, **kw: llm_text("页面已经出来。")
    harness.post(
        six_fields(
            sid,
            "假设已确认。继续画页面。",
            forcedTool="pages",
            tools=["pages"],
        )
    )
    loaded = load_session(sid)
    tools = (loaded.goal or {}).get("tools") if loaded and isinstance(loaded.goal, dict) else None
    assert tools == ["pages"], tools
    todo = list(getattr(loaded, "factoryTodo", None) or [])
    assert "structure" in todo and "bind" in todo, todo
    assert harness.helper_calls[-1].get("goal_tools") == ["pages"]


def test_workflow_calendar_still_runs_the_recipe(harness):
    """反向：workflow 是日历，一次跑完配方，不是一跳一件。"""
    sid = new_sid("p4-wf")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        controlTranscript=[
            {"id": "ct-1", "kind": "scope_confirmed", "text": "请假系统"}
        ],
    )
    rounds = {"n": 0}

    def impl(messages, **kw):
        rounds["n"] += 1
        if rounds["n"] == 1:
            return llm_tool("workflow", {"name": "pages-preview"}, call_id="w1")
        return llm_text("先看页面。")

    harness.llm_impl = impl
    harness.post(six_fields(sid, "先只出管理员看板"))
    loaded = load_session(sid)
    goal = loaded.goal if loaded and isinstance(loaded.goal, dict) else {}
    assert goal.get("workflow") == "pages-preview"
    assert list(goal.get("tools") or []) == ["spec", "pages", "closure"]


def test_factory_legal_set_is_the_stamp_not_the_todo():
    """厂内合法集不许并待办——并了就又把课表焊回来。"""
    from services.v5_full_driver import _factory_tools_from_state

    state = V5SessionState(
        sessionId="p4-legal",
        goal={"text": "便利店进销存", "tools": ["pages"]},
        factoryTodo=["structure", "bind"],
        specFirstPages={"spec": {"appName": "店", "pages": [{"id": "p1"}]}},
    )
    legal = _factory_tools_from_state(state)
    assert legal == ("pages",), legal
    src = strip_python(PY_ROOT / "services" / "v5_full_driver.py")
    fn = src[src.find("def _factory_tools_from_state") : src.find("def _stamp_factory_tools_onto_goal")]
    assert "factory_todo_open" not in fn
