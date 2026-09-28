"""operationId 抄错一个字符：回执说是抄错，给出原样那串。

⚠ 2026-09-27 隔离真机第 65 轮 sr-20260927190013-AJ2QM1WR1Y（Markdown 笔记 + 追问
  「按标签筛选、置顶」）：`npm run build` 排在开发服务器后面，queueHint 叫它用
  shell_kill_process 带 pop-50d9ba7c184e4ec8a45032d6e985cf8d 取消。模型发的是
  `pop-50d9ba7c184e4ec8a45032d6e985cf8`——漏了最后一个 d，回执只有
  project_operation_not_found。它没再试就收尾，那条 build 留在队里等服务器过期。

跟 test_mistyped_approval_ref_is_explained.py 同一个病。查不到照旧报错（错误码不变）。
判据走真的 `_dispatch_tool` + SQL 存储，排队形状照 test_queued_command_names_its_blocker；
抄错的形状照真机：漏掉末位一个字符。
把 execute 里挂 _mistyped_operation_id 的那支删掉，第一条变红。
"""

from __future__ import annotations

import uuid

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime


def _queued_build(setup):
    project = create(setup)
    _hold_runtime(setup, project)
    # ⚠ 2026-09-28 第 92 轮起，排在服务器后面的构建检查会被宿主当场撤回（见
    #   test_build_behind_the_dev_server_is_withdrawn），不会再留在队里等人来取消；
    #   仍会排队的是验收替不了的命令，第 49 轮真机就有这条 npm test。
    queued = _dispatch(setup, "shell_exec", {"command": "npm test -- --run"})
    assert queued["status"] == "queued", queued
    return queued["operationId"]


def test_a_dropped_last_character_is_named_as_a_typo(setup):
    build = _queued_build(setup)
    result = _dispatch(setup, "shell_kill_process", {"id": build[:-1]})
    assert result["ok"] is False and result["error"] == "project_operation_not_found"  # 照旧拒
    assert "抄错" in result["hint"] and build in result["hint"]


def test_the_named_id_really_cancels_it(setup):
    """递出去的那串拿来就能用（不是随便挑一条）。"""
    build = _queued_build(setup)
    hint = _dispatch(setup, "shell_kill_process", {"id": build[:-1]})["hint"]
    named = hint.rsplit("原样用这个：", 1)[1].strip()
    assert named == build
    assert _dispatch(setup, "shell_kill_process", {"id": named})["ok"] is True


def test_an_unrelated_id_gets_no_guess(setup):
    """反向：跟哪条都不像的，不许猜一条递出去。"""
    build = _queued_build(setup)
    result = _dispatch(setup, "shell_kill_process", {"id": "pop-" + uuid.uuid4().hex})
    assert result["ok"] is False and result["error"] == "project_operation_not_found"
    assert build not in result.get("hint", "")
    assert "抄错" not in result.get("hint", "")
