"""读窗口被字数上限截断时，回执说真话：停在第几行、从哪接着读，而且只截在整行上。

⚠ 2026-09-28 隔离真机第 95 轮 sr-20260928090643-EN9AKT1A92（信息安全培训 PPT，追问「第 3 页内容太多了，拆成两页」）：
  `file_read build_deck.py 0..256` 被上限截在 ~170 行，回执写 end_line=256 + truncated=true，
  没说停在哪。模型接着要 0..180、180..256（中间漏一截），再换 project_read 整份读三遍——改第一处
  之前同一个文件读了 11 次。夹具 round95_build_deck.py.txt 是库里那份原样（14280 字、256 行）。

判据走真 `_dispatch_tool`。把 _file_read 里截断那支删掉，前两条变红。
"""

from __future__ import annotations

from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

SOURCE = (Path(__file__).parent / "fixtures" / "round95_build_deck.py.txt").read_text("utf-8")
LINES = SOURCE.splitlines(True)
ROUND95 = {"file": "build_deck.py", "start_line": 0, "end_line": 256}


def _saved(setup):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": "build_deck.py", "content": SOURCE})["ok"] is True


def test_the_round95_window_reports_where_it_really_stopped(setup):
    _saved(setup)
    result = _dispatch(setup, "file_read", dict(ROUND95))
    assert result["ok"] is True and result["truncated"] is True, result
    stop = result["end_line"]
    assert 0 < stop < 256
    assert result["content"] == "".join(LINES[:stop])       # 真的就是 0..stop，整行
    assert result["nextStartLine"] == stop
    assert f"start_line={stop}" in result["hint"] and "256" in result["hint"]


def test_following_next_start_line_reads_the_whole_file_without_a_gap(setup):
    """§五：按回执接着读，拼起来就是原文——第 95 轮那种 0..180 / 180..256 的漏洞不会出现。"""
    _saved(setup)
    got, start, rounds = "", 0, 0
    while start < len(LINES):
        result = _dispatch(setup, "file_read", {"file": "build_deck.py", "start_line": start, "end_line": 256})
        got += result["content"]
        start = result.get("nextStartLine", result["end_line"])
        rounds += 1
        assert rounds < 5
    assert got == SOURCE and rounds == 2


def test_the_twin_read_file_gets_the_same_cut(setup):
    """§四：read_file 走同一个 _file_read。"""
    _saved(setup)
    twin = _dispatch(setup, "read_file", {"path": "build_deck.py", "offset": 0, "limit": 256})
    own = _dispatch(setup, "file_read", dict(ROUND95))
    assert twin["content"] == own["content"] and twin["nextStartLine"] == own["nextStartLine"]


def test_a_window_that_fits_is_not_marked_or_hinted(setup):
    """反向：没截断就不挂提示、不给 nextStartLine。"""
    _saved(setup)
    result = _dispatch(setup, "file_read", {"file": "build_deck.py", "start_line": 180, "end_line": 256})
    assert result["truncated"] is False and "nextStartLine" not in result and "hint" not in result
    assert result["content"] == "".join(LINES[180:256]) and result["end_line"] == 256
