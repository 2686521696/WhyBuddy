"""读窗口越过文件末尾：错误码照旧，回执说文件有多长。

⚠ 2026-09-28 隔离真机第 101 轮 sr-20260928112521-2KQWFPNSG7（保温杯推广方案 Word，追问「每一章末尾加一个带底色的小结框」）：
  `file_read {"file": "generate_plan.py", "start_line": 260, "end_line": 430}`，文件不到 260 行，
  回执只有 invalid_project_offset。载荷照真机原样。判据走真 `_dispatch_tool`。
把 _file_read 里挂 hint 的那两行删掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

SCRIPT = "".join(f"p(doc, '第 {i} 段')\n" for i in range(200))
ROUND101 = {"file": "generate_plan.py", "start_line": 260, "end_line": 430}


def _saved(setup):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": "generate_plan.py", "content": SCRIPT})["ok"] is True


def test_the_round101_window_past_the_end_names_the_length(setup):
    _saved(setup)
    result = _dispatch(setup, "file_read", dict(ROUND101))
    assert result["ok"] is False and result["error"] == "invalid_project_offset"   # 照旧拒
    assert "一共 200 行" in result["hint"]


def test_a_window_inside_the_file_is_unaffected(setup):
    _saved(setup)
    result = _dispatch(setup, "file_read", {"file": "generate_plan.py", "start_line": 190, "end_line": 430})
    assert result["ok"] is True and result["end_line"] == 200 and "hint" not in result
