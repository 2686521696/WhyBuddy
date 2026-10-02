"""命令上限（SHELL_COMMAND_MAX_CHARS）那么长的一条，照控制台的敲法敲进真 PTY，要跑得完。

⚠ 2026-09-27 隔离真机第 66、68 轮：上限 2000 时两轮都有核对 / 生成脚本被
  project_tool_arguments_invalid 打回。2000 没标定过；真正的约束在 PTY——规范模式
  一行 4095 字节。_console_boot 等提示符出来才敲，readline 此时是原始模式，不受这个限。
  上限提到 8000 的依据就是这条判据（project_tool_contracts 常量头注）。以后再改上限，
  这条要跟着过：本地 bash -i 起 PTY，送同一行 _CONSOLE_SETUP，pty_line + typing_chunks 原样敲。
"""

from __future__ import annotations

import os
import re
import select
import shutil
import sys
import time

import pytest

from services.e2b_workspace_provider import _CONSOLE_SETUP, pty_line, typing_chunks
from services.project_tool_contracts import SHELL_COMMAND_MAX_CHARS, SHELL_SCRIPT_MAX_CHARS, ShellExecArguments
from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import setup  # noqa: F401  （夹具）

pytestmark = pytest.mark.skipif(
    sys.platform != "linux" or shutil.which("bash") is None or shutil.which("python3") is None,
    reason="needs a Linux PTY with bash and python3")

_MARK = re.compile(rb"\x1b\]777;wb;(\d+)\x07")


def _script_at_the_limit() -> str:
    """第 68 轮那种形状：python3 heredoc，中文注释（UTF-8 比字数多出三成多）。"""
    head, tail = "python3 - <<'PY'\n", "print('LAST', n)\nPY"
    lines, n = [], 0
    while True:
        row = f"n = {n}  # 产品月度汇总第{n}行\n"
        if len(head) + len("".join(lines)) + len(row) + len(tail) > SHELL_COMMAND_MAX_CHARS:
            break
        lines.append(row)
        n += 1
    return head + "".join(lines) + tail, n - 1


def _read_until(fd, pattern, seconds):
    buf, end = b"", time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if ready:
            try:
                buf += os.read(fd, 65536)
            except OSError:
                break
            if pattern.search(buf):
                return buf
    return buf


def test_a_command_at_the_limit_runs_when_typed_like_the_console():
    import pty

    command, last = _script_at_the_limit()
    ShellExecArguments(command=command)  # 恰好在上限内，校验收
    assert len(command) > SHELL_COMMAND_MAX_CHARS - 40
    line = pty_line(command)
    assert len(line.encode("utf-8")) > 4096  # 真的越过规范模式那条线，否则判据没咬住什么

    pid, fd = pty.fork()
    if pid == 0:  # pragma: no cover - 子进程
        os.execvpe("bash", ["bash", "--norc", "--noprofile", "-i"], {**os.environ, "TERM": "xterm-256color"})
    try:
        os.write(fd, _CONSOLE_SETUP)
        assert _MARK.search(_read_until(fd, _MARK, 20)), "提示符没出来"
        for chunk in typing_chunks(line):
            os.write(fd, chunk.encode("utf-8"))
            time.sleep(0.005)
        os.write(fd, b"\n")
        out = _read_until(fd, re.compile(rb"LAST \d+[\s\S]*\x1b\]777;wb;\d+\x07"), 30)
        assert f"LAST {last}".encode() in out, out[-400:]
        assert _MARK.findall(out)[-1] == b"0"
    finally:
        os.kill(pid, 9)
        os.waitpid(pid, 0)


# ⚠ 2026-09-28 隔离真机第 78、82 轮：上面那条判据只证明「敲得进 PTY」，没走分发——
#   sandbox_shell_script 里还写死着 2000，2000～8000 字的命令在那儿被 not_allowed 打回。
#   下面走真的 _dispatch_tool（test_queued_command_names_its_blocker 的夹具）。
#   命令开头是第 78 轮被拒那一发的原样（全文没落库，回执摘要只留了开头），按同样形状长到两千字以上。
ROUND78_HEAD = ("python3 - <<'PY'\nfrom pptx import Presentation\nfrom pptx.enum.shapes import MSO_SHAPE_TYPE\n"
                "from pptx.util import Inches\nfrom lxml import etree\nimport json, zipfile\n")


def _long_check_script(chars):
    body, n = [], 0
    while len(ROUND78_HEAD) + len("".join(body)) < chars:
        body.append(f"assert prs.slides[{n % 5}].shapes is not None  # 第{n}项几何检查\n")
        n += 1
    return ROUND78_HEAD + "prs = Presentation('新品发布会.pptx')\n" + "".join(body) + "print('ok')\nPY"


def test_a_long_command_passes_the_live_dispatch(setup):  # noqa: F811
    from test_project_tools import create
    from test_queued_command_names_its_blocker import _dispatch

    create(setup)
    command = _long_check_script(3500)
    assert 2000 < len(command) < SHELL_COMMAND_MAX_CHARS
    result = _dispatch(setup, "shell_exec", {"command": command, "is_background": True})
    assert result.get("error") != "project_shell_command_not_allowed", result
    assert result["ok"] is True, result


def test_over_the_limit_is_still_refused_at_dispatch(setup):  # noqa: F811
    """反向：上限还在（收的上限 SHELL_SCRIPT_MAX_CHARS），只是两处用同一个数。"""
    from test_project_tools import create
    from test_queued_command_names_its_blocker import _dispatch

    create(setup)
    result = _dispatch(setup, "shell_exec", {"command": _long_check_script(SHELL_SCRIPT_MAX_CHARS + 200)})
    assert result["ok"] is False


# ── 超过敲键上限的命令：存成工作区外的临时脚本再跑（SHELL_SCRIPT_MAX_CHARS 头注） ────────────────
# ⚠ 2026-10-02 隔离真机第 183 轮：整份生成脚本写成一条 heredoc（3981 个输出 token、那一发 374 秒），超 8000 被打回，
#   模型原样改成 file_write 再写一遍。第 131/151/155/174/175 轮同形状。


def test_a_command_over_the_typing_limit_is_accepted_at_dispatch(setup):  # noqa: F811
    from test_project_tools import create
    from test_queued_command_names_its_blocker import _dispatch

    create(setup)
    command = _long_check_script(20_000)
    assert SHELL_COMMAND_MAX_CHARS < len(command) < SHELL_SCRIPT_MAX_CHARS
    result = _dispatch(setup, "shell_exec", {"command": command, "is_background": True})
    assert result["ok"] is True, result


def _local_provider(tmp_path, monkeypatch):
    """E2BWorkspaceProvider 的 _staged_command 原样跑；写文件那一下用产线的 _WRITE_SCRIPT 在本机执行。"""
    import json
    import subprocess

    from services import e2b_workspace_provider as mod

    stage = tmp_path / "stage"
    monkeypatch.setattr(mod, "CONSOLE_STAGE_ROOT", str(stage))
    provider = object.__new__(mod.E2BWorkspaceProvider)
    written = []

    def write_at_root(handle, files, root):
        written.append((root, dict(files)))
        out = subprocess.run([sys.executable, "-c", mod._WRITE_SCRIPT], input=json.dumps([root, files]),
                             capture_output=True, text=True)
        assert out.returncode == 0, out.stderr[-400:]

    provider._write_files_at_root = write_at_root
    return provider, written, stage


def _run_typed(line):
    import pty

    pid, fd = pty.fork()
    if pid == 0:  # pragma: no cover - 子进程
        os.execvpe("bash", ["bash", "--norc", "--noprofile", "-i"], {**os.environ, "TERM": "xterm-256color"})
    try:
        os.write(fd, _CONSOLE_SETUP)
        assert _MARK.search(_read_until(fd, _MARK, 20)), "提示符没出来"
        for chunk in typing_chunks(line):
            os.write(fd, chunk.encode("utf-8"))
            time.sleep(0.005)
        os.write(fd, b"\n")
        return _read_until(fd, re.compile(rb"LAST \d+[\s\S]*\x1b\]777;wb;\d+\x07"), 60)
    finally:
        os.kill(pid, 9)
        os.waitpid(pid, 0)


def test_a_long_script_runs_through_a_staged_file(tmp_path, monkeypatch):
    """两万多字的 heredoc（中文注释）：宿主存成临时脚本，PTY 只敲 `bash 那个文件`，结果跟原文一样。
    把 _staged_command 里的分流去掉（原样往 PTY 里敲），typed 那行就是两万多字——第二个断言红。"""
    provider, written, stage = _local_provider(tmp_path, monkeypatch)
    head, tail, rows = "python3 - <<'PY'\n", "print('LAST', n)\nPY", []
    while len(head) + sum(map(len, rows)) < 20_000:
        rows.append(f"n = {len(rows)}  # 门店月度复盘第{len(rows)}行\n")
    command = head + "".join(rows) + tail
    ShellExecArguments(command=command)                       # 收
    typed = provider._staged_command(object(), command)
    assert len(typed) < 200 and typed.startswith("bash ") and str(stage) in typed
    assert written and written[0][0] == str(stage)              # 写在工作区外那个目录
    out = _run_typed(pty_line(typed))
    assert f"LAST {len(rows) - 1}".encode() in out, out[-400:]
    assert _MARK.findall(out)[-1] == b"0"


def test_a_short_command_is_typed_as_is(tmp_path, monkeypatch):
    """反向：敲键上限以内的照旧原样敲，不写临时文件（用户在面板里看到的就是模型写的那条命令）。"""
    provider, written, _stage = _local_provider(tmp_path, monkeypatch)
    command = "python3 -c 'print(1)'"
    assert provider._staged_command(object(), command) == command
    assert written == []


def test_the_live_console_goes_through_the_staging():
    """接线：start_console 敲之前先过 _staged_command（剥注释后看产线源码）。"""
    import pathlib
    from control_turn_support import strip_python

    src = strip_python(pathlib.Path(__file__).resolve().parents[1] / "services" / "e2b_workspace_provider.py")
    assert "command = pty_line(self._staged_command(handle, command))" in src
