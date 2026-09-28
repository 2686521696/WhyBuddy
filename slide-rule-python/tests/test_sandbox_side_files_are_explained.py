"""file_read 一个命令在沙盒里写出的文件：说清它不在工程源码里、该怎么看。

⚠ 2026-09-28 隔离真机第 103 轮 sr-20260928122121-2XPBK8TS8R（小学三年级家长会 PPT）：生成脚本顺手写了
  output/小学三年级家长会_温暖植物花园版_qa.json，模型接着 file_read 它——project_file_not_found，没有提示。
  路径照真机原样。判据走真 `_dispatch_tool`。把 missing_file 里 elif parent 那支删掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

ROUND103 = "output/小学三年级家长会_温暖植物花园版_qa.json"


def test_a_sandbox_side_file_is_explained(setup):
    create(setup)
    result = _dispatch(setup, "file_read", {"file": ROUND103})
    assert result["ok"] is False and result["error"] == "project_file_not_found"   # 照旧拒
    assert "不进工程源码" in result["hint"] and "shell_exec" in result["hint"] and ROUND103 in result["hint"]


def test_a_typo_next_to_real_files_still_lists_them(setup):
    """反向：同目录真有文件时，照旧列出来，不说成沙盒文件。"""
    create(setup)
    _dispatch(setup, "file_write", {"file": "scripts/build_deck.py", "content": "print(1)\n"})
    result = _dispatch(setup, "file_read", {"file": "scripts/build_dek.py"})
    assert "build_deck.py" in result["hint"] and "不进工程源码" not in result["hint"]
