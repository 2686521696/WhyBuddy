"""多行命令（heredoc）能跑：换行只在 PTY 打字那一层处理。

⚠ 2026-09-27 隔离真机第 31 轮（Excel 预算表 + 追问加「执行率」列和柱状图）：
  改完后模型写了下面这段 `python3 - <<'PY' … PY` 去核对公式、数据验证和图表，
  被 project_shell_multiline_not_supported 拒掉。它没改写成一行重跑，收尾照样写
  「已检查工作簿结构、公式、数据验证和图表」——一行核对输出都没有。

判据用那一发的**原样命令**（CLAUDE.md §一之二）。
把 start_console 里 `command = pty_line(command)` 那行删掉，第三条变红；
把 sandbox_shell_script 的多行拒绝加回来，第四条变红。
"""

import shutil
import subprocess
import time

import pytest

from services import e2b_workspace_provider as module
from services.e2b_workspace_provider import pty_line
from services.project_tool_contracts import classify_shell_command
from tests.test_workspace_provider import setup_provider  # noqa: F401  (fixture)

# 第 31 轮 shell_exec 的 command 原样。
ROUND31 = """python3 - <<'PY'
from openpyxl import load_workbook
p='2026年部门季度预算跟踪.xlsx'
wb=load_workbook(p, data_only=False)
ws=wb['汇总表']
print('Q5=', ws['Q5'].value, 'format=', ws['Q5'].number_format)
print('Q9=', ws['Q9'].value, 'charts=', len(ws._charts))
print('chart_title=', ws._charts[0].title.tx.rich.p[0].r[0].t)
print('validations=', wb['支出明细'].data_validations.count)
PY"""

needs_bash = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")


def test_the_real_command_becomes_one_line():
    line = pty_line(ROUND31)
    assert "\n" not in line and "\r" not in line
    assert line.startswith("bash -c $'")


@needs_bash
def test_bash_restores_the_real_command_byte_for_byte():
    """一行敲进去，bash 还原出来的必须就是模型写的那段——不是差不多。"""
    line = pty_line(ROUND31)
    echoed = "printf %s " + line[len("bash -c "):]
    out = subprocess.run(["bash", "-c", echoed], capture_output=True, text=True, check=True).stdout
    assert out == ROUND31


@needs_bash
def test_a_heredoc_with_quotes_backslashes_and_dollars_runs_as_written(tmp_path):
    script = "python3 - <<'PY'\nimport os\nprint('it''s', \"a\\\\nb\", '$HOME', os.getcwd() != '')\nPY\necho \"done $((1+1))\""
    direct = subprocess.run(["bash", "-c", script], capture_output=True, text=True, cwd=tmp_path)
    typed = subprocess.run(["bash", "-c", pty_line(script)], capture_output=True, text=True, cwd=tmp_path)
    assert direct.returncode == 0, direct.stderr
    assert typed.stdout == direct.stdout
    assert "done 2" in typed.stdout


def test_one_line_commands_are_typed_unchanged():
    """反向：单行命令一个字都不动（pane 上看到的就是模型写的）。"""
    for command in ("npm ci --ignore-scripts", "python3 -c 'print(1)'", "echo a\\nb"):
        assert pty_line(command) == command


def test_the_console_never_types_a_newline_inside_the_command(setup_provider, monkeypatch):  # noqa: F811
    provider, handle, fake, _ = setup_provider
    monkeypatch.setattr(module, "CONSOLE_TYPE_INTERVAL", 0)
    provider.start_console(handle, ROUND31)
    deadline = time.time() + 2
    while provider.is_process_running(handle, "7") and time.time() < deadline:
        time.sleep(0.01)
    typed = [chunk for chunk in fake.pty.sent if len(chunk) <= 4 and b"PROMPT_COMMAND" not in chunk]
    # 只有最后那一下回车；命令中间敲一个 \n，bash 就当回车执行半段 heredoc
    assert typed[-1] == b"\n"
    assert b"\n" not in b"".join(typed[:-1])
    assert b"".join(typed[:-1]).decode() == pty_line(ROUND31)


def test_the_contract_accepts_the_real_command_as_written():
    kind, script = classify_shell_command(ROUND31)
    assert kind == "shell" and script == ROUND31
