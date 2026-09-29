"""工具参数没过校验：回执要说清哪个参数、要求是什么，模型才改得对。

⚠ 2026-09-27 隔离真机 sr-20260927070207-AQFP20YTVE（网页第 26 轮）：模型读
  `src/main.tsx` 给了 `"limit": 10000`（上限 8000），回执只有
  `project_tool_arguments_invalid`。它同样形状再撞一次 `src/style.css`，然后改用
  file_read 绕开——同一个工具再没用对。

第一条走真 ProjectTools.execute，参数是那一轮原样的形状（只换成本夹具的版本号）。
把 execute 里的 arguments_invalid 换回裸错误码，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）


def test_the_receipt_names_the_argument_and_its_limit(setup):
    # 2026-09-29 第 111 轮起 project_read 的 limit 超上限改为按上限读（见下一条）；
    # 这条仍钉「参数错了要说清是哪个、约束是什么」，换一个仍然会拒的参数。
    project = create(setup)
    result = execute(setup, "project_read", {
        "path": "src/main.tsx", "revision": project["revision"], "offset": -1, "limit": 8000})
    assert result["ok"] is False and result["error"] == "project_tool_arguments_invalid"
    assert "offset=-1" in result["hint"] and "0" in result["hint"]


def test_an_oversized_window_is_read_up_to_the_limit(setup):
    """⚠ 第 26 轮 limit=10000、第 111 轮 sr-20260929083948-EGWA0HBPM3 同一批两发 limit=12000，全被拒。
    现在按上限读：拿到的就是 8000 以内的一窗，照旧能接着读。"""
    project = create(setup)
    result = execute(setup, "project_read", {
        "path": "src/App.tsx", "revision": project["revision"], "offset": 0, "limit": 12000})
    assert result["ok"] is True, result
    assert len(result["content"]) <= 8000


def test_the_same_call_within_the_limit_just_works(setup):
    """反向：改成上限以内就读得到——回执说的是真的约束。"""
    project = create(setup)
    result = execute(setup, "project_read", {
        "path": "src/App.tsx", "revision": project["revision"], "offset": 0, "limit": 8000})
    assert result["ok"] is True, result


def test_a_long_value_is_not_echoed_back_whole(setup):
    create(setup)
    huge = "x" * 5000
    result = execute(setup, "project_read", {"path": huge})
    assert result["ok"] is False
    assert len(result["hint"]) < 400 and huge not in result["hint"]
