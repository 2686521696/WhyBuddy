"""改完的 .py 缩进坏了，编辑回执当场说；不用跑一趟沙盒才知道。

⚠ 2026-09-28 隔离真机第 86 轮 sr-20260928043335-9AKXXGY0WB（电商月度经营 Excel，追问「加一个 KPI 仪表盘工作表」）：
  04:45:56 那次 file_str_replace 之后生成脚本第 260 行 IndentationError，后面两次改动还在；模型每次都
  跑一趟才知道，9 次失败里 8 次是 IndentationError，8 分钟。夹具是库里那两个版本原样：
  round86_kpi_script_broken.py.txt（04:45:56）与 round86_kpi_script_fixed.py.txt（04:54:21）。

判据走真 ProjectTools.execute。把 _kernel_edit 里挂 _indentation_error_note 的那支删掉，第一条变红。
"""

from __future__ import annotations

from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）

FIX = Path(__file__).parent / "fixtures"
BROKEN = (FIX / "round86_kpi_script_broken.py.txt").read_text("utf-8")
FIXED = (FIX / "round86_kpi_script_fixed.py.txt").read_text("utf-8")
PATH = "scripts/create_monthly_shop_report.py"


def _write(setup, content, path=PATH):
    create(setup)
    return execute(setup, "file_write", {"file": path, "content": content})


def test_the_round86_broken_script_is_flagged_on_the_edit(setup):
    receipt = _write(setup, BROKEN)
    assert receipt["ok"] is True, receipt            # 照样落库：不挡写，只说实话
    assert receipt["syntaxError"]["line"] == 260
    assert "IndentationError" in receipt["syntaxError"]["message"]
    assert "第 260 行" in receipt["hint"]


def test_the_fixed_script_gets_no_warning(setup):
    receipt = _write(setup, FIXED)
    assert receipt["ok"] is True and "syntaxError" not in receipt


def test_newer_syntax_the_sandbox_accepts_is_not_called_broken(setup):
    """反向：宿主 3.11、沙盒 3.13。3.12 起合法的 f-string 在宿主 compile 会 SyntaxError——不许报。"""
    newer = 'rows = {"a": 1}\nprint(f"{rows["a"]}")\n'
    receipt = _write(setup, newer, path="scripts/newer.py")
    assert receipt["ok"] is True and "syntaxError" not in receipt


def test_non_python_files_are_not_checked(setup):
    receipt = _write(setup, "  not: [valid\n", path="notes/config.yaml")
    assert receipt["ok"] is True and "syntaxError" not in receipt


def test_on_the_live_dispatch_the_warning_reaches_the_model(setup):
    """§一：走真 _dispatch_tool。第 86 轮的五次改动回执都是直接落版本（没有 operationId，分发处
    不等、不盖回执）——就是这个形状。沙盒里跑着 Vite 时改 .py 会直接 requires_restart，不走这里。"""
    from test_queued_command_names_its_blocker import _dispatch

    create(setup)
    result = _dispatch(setup, "file_write", {"file": PATH, "content": BROKEN})
    assert result["ok"] is True and not result.get("operationId"), result
    assert result["syntaxError"]["line"] == 260
    assert "第 260 行" in result["hint"]
