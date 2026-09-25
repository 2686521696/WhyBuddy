"""模型拿到的页面地址只有路径，没有预览主机。

⚠ 2026-09-25 隔离真机 sr-20260925075204-ZNC56623QH：browser_view 把
  runtime.previewUrl（internal 模式下工人记下的 E2B 公开主机，中继拨不通时的后备）
  原样交给模型，模型写给用户「私有预览服务已启动：[打开记账网页](https://5173-….e2b.app/)」
  ——绕开了服务器配置的预览网关；线上 allowlist 下同一链接是死链。

走真的分发与真的后备路径：supervisor 上没有 preview_page，地址来自 runtime.previewUrl。
把 _strip_preview_host / model_page_path 的调用删掉，前两条变红。
"""

from __future__ import annotations

import json

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime
from services import rehearsal_control as rc

E2B = "https://5173-ih703c5q7ee29rxdsnga9.e2b.app/"


def _published(setup, holder):
    op = setup.store.get_operation(holder, owner_id="alice")
    updated = op.model_copy(update={"runtime": op.runtime.model_copy(update={"previewUrl": E2B})})
    setup.store._q("update wb_project_operation set payload=$1 where id=$2", [updated.model_dump_json(), holder])


def test_browser_view_gives_the_model_a_path_not_the_sandbox_host(setup, monkeypatch):
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    holder = _hold_runtime(setup, project)
    _published(setup, holder)
    assert not hasattr(setup.supervisor, "preview_page")  # 真机就是这条后备路径
    setup.supervisor.browser_interactor = lambda action, page: {"ok": True, "url": page["url"] + "stats",
        "title": "记账本", "snapshot": []}
    viewed = _dispatch(setup, "browser_view", {})
    assert viewed["ok"] is True, viewed
    assert "e2b.app" not in json.dumps(viewed, ensure_ascii=False)
    assert viewed["url"] == "/stats"
    assert "右侧的预览面板" in viewed["previewNote"]


def test_browser_navigate_does_not_echo_a_host_back(setup, monkeypatch):
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    _hold_runtime(setup, project)
    moved = _dispatch(setup, "browser_navigate", {"url": E2B + "month/2026-09"})
    assert moved["ok"] is True, moved
    assert "e2b.app" not in json.dumps(moved, ensure_ascii=False)
    assert moved["url"] == "/month/2026-09"


def test_a_relative_path_passes_through_unchanged(setup, monkeypatch):
    """反向：模型自己给的相对路径原样保留，不改写成别的。"""
    monkeypatch.setattr(rc, "_project_tool_wait_seconds", lambda *a: 0.0)
    project = create(setup)
    _hold_runtime(setup, project)
    moved = _dispatch(setup, "browser_navigate", {"url": "/"})
    assert moved["url"] == "/"
