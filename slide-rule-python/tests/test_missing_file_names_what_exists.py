"""读不到的文件，回执带上旁边真有的东西。

⚠ 2026-09-27 隔离真机网页第 23 / 26 / 30 轮（sr-20260927063454、…070207、…091152）：
  模型建完工程，跟 project_list 同一批就读 Vite 默认的 `src/index.css`、`src/App.tsx`；
  读 `src` 这个目录也是 project_file_not_found。回执不说旁边有什么，每轮两发白读。

走真 ProjectTools.execute，实参是那几轮的原样形状（只换本夹具的版本号）。
把 _read 里的 missing_file 换回裸 ProjectNotFound，第一、二条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）


def _read(setup, project, path, tool="project_read"):
    args = {"path": path, "revision": project["revision"], "offset": 0, "limit": 4000}
    if tool == "file_read":
        args = {"file": path}
    return execute(setup, tool, args)


def test_a_missing_file_names_its_real_neighbours(setup):
    project = create(setup)
    result = _read(setup, project, "src/index.css")
    assert result["ok"] is False and result["error"] == "project_file_not_found"
    assert "src 下现有" in result["hint"] and "App.tsx" in result["hint"]


def test_a_directory_is_named_as_a_directory(setup):
    project = create(setup)
    result = _read(setup, project, "src")
    assert "src 是目录" in result["hint"] and "App.tsx" in result["hint"]


def test_file_read_carries_the_same_hint(setup):
    project = create(setup)
    result = _read(setup, project, "src/index.css", tool="file_read")
    assert result["error"] == "project_file_not_found" and "src 下现有" in result["hint"]


def test_a_file_that_exists_is_read_as_before(setup):
    """反向：真有的文件照读，不挂 hint。"""
    project = create(setup)
    result = _read(setup, project, "src/App.tsx")
    assert result["ok"] is True and "hint" not in result
