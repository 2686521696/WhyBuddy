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
from services.project_tool_contracts import SHELL_COMMAND_MAX_CHARS, ShellExecArguments

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
