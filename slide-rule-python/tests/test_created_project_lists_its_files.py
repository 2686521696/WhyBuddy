"""建完工程，回执列出模板里真有的文件。

⚠ 2026-09-27 隔离真机第 33/36/37 轮（番茄钟 / 习惯打卡 / 读书清单）：project_create
  回执只有 fileCount=9。模型建完第一件事是并行猜读 src/App.tsx、src/index.css、
  src/main.jsx……每轮 2～3 次 project_file_not_found，再 file_find_by_name 一次才读对。

判据走真的 ProjectTools.execute + SQL 存储，再过一遍真的回喂夹子 bound_tool_result
——列表进了回执但被回喂砍掉，模型照样看不见。
把回执里 files 那段删掉，第一条变红。
"""

from __future__ import annotations

import json

from project_actor_support import project_actor  # noqa: F401
from services.rehearsal_control import bound_tool_result
from test_project_tools import create, setup  # noqa: F401


def test_the_creation_receipt_names_every_template_file(setup):
    created = create(setup)
    fed = json.loads(bound_tool_result({"tool": "project_create", **created}, "project_create"))
    assert sorted(fed["files"]) == sorted(setup.files)
    assert len(fed["files"]) == fed["fileCount"]


def test_the_list_is_only_what_exists(setup):
    """反向：列出来的每一个都读得到；真机猜的那几个不在里面。"""
    created = create(setup)
    for guessed in ("src/index.css", "src/main.jsx", "src/App.jsx"):
        if guessed not in setup.files:
            assert guessed not in created["files"]
    assert "filesTruncated" not in created
