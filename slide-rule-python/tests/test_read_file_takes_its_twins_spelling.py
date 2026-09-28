"""read_file 收孪生工具 file_read 的参数写法，读出来的跟 file_read 一字不差。

⚠ 2026-09-28 隔离真机第 94 轮 sr-20260928081512-PXESY6QGRA（单词卡片网页，追问「配色换蓝、圆角 12px」）：
  `read_file {"file": "src/style.css", "start_line": 0, "end_line": 40}` → project_tool_arguments_invalid，
  全库最常见的参数错（5 次）。载荷照真机原样。

判据走真 `_dispatch_tool`。把 GithubReadArguments._twin_spelling 删掉，前两条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

CSS = "".join(f".rule-{i} {{ color: #1f4e79; border-radius: 12px; }}\n" for i in range(120))
ROUND94 = {"file": "src/style.css", "start_line": 0, "end_line": 40}


def _saved(setup):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": "src/style.css", "content": CSS})["ok"] is True


def test_the_round94_payload_reads_the_same_window_as_file_read(setup):
    _saved(setup)
    twin = _dispatch(setup, "read_file", dict(ROUND94))
    assert twin["ok"] is True, twin
    own = _dispatch(setup, "file_read", dict(ROUND94))
    assert twin["content"] == own["content"] and twin["content"]
    assert twin["content"].count("\n") == 40            # end_line 是不含的终点


def test_a_window_not_starting_at_zero_keeps_its_end(setup):
    _saved(setup)
    args = {"file": "src/style.css", "start_line": 30, "end_line": 35}
    twin = _dispatch(setup, "read_file", dict(args))
    own = _dispatch(setup, "file_read", dict(args))
    assert twin["content"] == own["content"] == "".join(CSS.splitlines(True)[30:35])


def test_mixing_both_spellings_is_still_rejected(setup):
    """反向：两套名字同时给是真矛盾，不猜哪个算数。"""
    _saved(setup)
    result = _dispatch(setup, "read_file", {"path": "src/style.css", "file": "src/main.tsx"})
    assert result["ok"] is False and result["error"] == "project_tool_arguments_invalid"
    result = _dispatch(setup, "read_file", {"path": "src/style.css", "offset": 0, "end_line": 10})
    assert result["ok"] is False and result["error"] == "project_tool_arguments_invalid"


def test_its_own_spelling_is_unchanged(setup):
    _saved(setup)
    result = _dispatch(setup, "read_file", {"path": "src/style.css", "offset": 30, "limit": 5})
    assert result["content"] == "".join(CSS.splitlines(True)[30:35])
