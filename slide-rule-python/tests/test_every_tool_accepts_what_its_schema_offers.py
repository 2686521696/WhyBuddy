"""每个工程工具：schema 放行的参数，处理函数不许读到 schema 里没有的字段而崩掉。

⚠ 2026-09-30 隔离真机第 133 轮 sr-20260930004940-9GDY1QZGS4（月度预算网页）：browser_console_view 的 schema 是
  BrowserEmptyArguments（只有 sudo），处理函数读 parsed.id → AttributeError，整轮 run 挂掉。
  回执可以是错误（没有工程、没有操作……），但必须是工具回执，不是 Python 异常。

判据走真 _dispatch_tool，把所有「空参数就能过 schema」的工程工具各调一次。把 _leaked_observe 里
getattr(parsed, "id", None) 改回 parsed.id，browser_console_view 那一组变红。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import rehearsal_control as rc
from services.project_tool_contracts import PROJECT_ARGUMENTS
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch


def _accepts_empty(name):
    try:
        PROJECT_ARGUMENTS[name].model_validate({})
        return True
    except ValidationError:
        return False


EMPTY_OK = sorted(name for name in PROJECT_ARGUMENTS if _accepts_empty(name))


def test_the_round133_tool_is_in_the_sweep():
    assert "browser_console_view" in EMPTY_OK and len(EMPTY_OK) >= 8


@pytest.mark.parametrize("name", EMPTY_OK)
def test_an_empty_call_answers_with_a_receipt_not_a_crash(setup, name, monkeypatch):
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)   # 夹具里没有工人跑，不等
    project = create(setup)
    setup.store.create_operation(project["projectId"], owner_id="alice", kind="runtime.exec",   # 「最近一条操作」存在
        idempotency_key="sweep-check", expected_revision=project["revision"], approval_ref=setup.approval,
        input={"command": "check"})
    result = _dispatch(setup, name, {})
    assert isinstance(result, dict) and result.get("type") == "control_tool_result", result
    assert "AttributeError" not in str(result) and "TypeError" not in str(result), result
