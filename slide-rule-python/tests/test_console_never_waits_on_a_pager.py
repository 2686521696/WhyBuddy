"""控制台（真 PTY）里跑 git diff 这类会起分页器的命令，要自己跑完，不许停在 less 等人按 q。

⚠ 2026-10-07 真机 r84 sr-20261007100837-9EX8Q6WH7W（@verification-before-completion 修分账函数）：收尾前跑
  `git diff -- split_bill.py tests/test_split_bill.py && git status --short`，diff 超过一屏，控制台里出现 `\\x1b[?1h\\x1b=`
  （less 起来了）——命令只能等 900 秒超时，模型一遍遍 shell_wait（e2b_workspace_provider._CONSOLE_SETUP 头注）。
本地 bash -i 起 PTY，跟 test_command_limit_fits_the_console 同一个敲法：原样送产线的 _CONSOLE_SETUP，再敲命令。
第一条判据先证明「不设分页器时它真的会卡住」——否则后面那条绿了也说明不了什么（CLAUDE.md §一之二）。
"""

from __future__ import annotations

import os
import re
import select
import shutil
import subprocess
import sys
import time

import pytest

from services.e2b_workspace_provider import _CONSOLE_SETUP, pty_line

pytestmark = pytest.mark.skipif(
    sys.platform != "linux" or not all(shutil.which(b) for b in ("bash", "git", "less")),
    reason="needs a Linux PTY with bash, git and less")

_MARK = re.compile(rb"\x1b\]777;wb;(\d+)\x07")
COMMAND = "git diff -- split_bill.py tests/test_split_bill.py && git status --short"   # r84 那一发原样
BARE_SETUP = _CONSOLE_SETUP.replace(b"export PAGER=cat GIT_PAGER=cat MANPAGER=cat SYSTEMD_PAGER=; ", b"")


def _repo(tmp_path):
    """跟 r84 一样：两个文件改了几十行，diff 超过控制台的 32 行。"""
    run = lambda *a: subprocess.run(a, cwd=tmp_path, check=True, capture_output=True)  # noqa: E731
    run("git", "init", "-q")
    run("git", "config", "user.email", "t@t")
    run("git", "config", "user.name", "t")
    (tmp_path / "tests").mkdir()
    for name in ("split_bill.py", "tests/test_split_bill.py"):
        (tmp_path / name).write_text("".join(f"x{i} = {i}\n" for i in range(40)))
    run("git", "add", "-A")
    run("git", "commit", "-qm", "init")
    for name in ("split_bill.py", "tests/test_split_bill.py"):
        (tmp_path / name).write_text("".join(f"y{i} = {i * 2}\n" for i in range(40)))


def _type_and_wait(tmp_path, setup: bytes, seconds: float) -> tuple[bytes, bytes | None]:
    import pty
    import struct
    import fcntl
    import termios

    pid, fd = pty.fork()
    if pid == 0:  # pragma: no cover - 子进程
        os.chdir(tmp_path)
        env = {k: v for k, v in os.environ.items() if k not in ("PAGER", "GIT_PAGER", "LESS", "MANPAGER")}
        os.execvpe("bash", ["bash", "--norc", "--noprofile", "-i"], {**env, "TERM": "xterm-256color"})
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))   # 跟 pty.create(PtySize(32, 100)) 一样
    buf = b""
    try:
        os.write(fd, setup)
        deadline = time.time() + 20
        while not _MARK.search(buf) and time.time() < deadline:
            if select.select([fd], [], [], 0.2)[0]:
                buf += os.read(fd, 65536)
        assert _MARK.search(buf), "提示符没出来"
        seen = len(buf)
        os.write(fd, pty_line(COMMAND).encode() + b"\n")
        deadline = time.time() + seconds
        while time.time() < deadline:
            if select.select([fd], [], [], 0.2)[0]:
                buf += os.read(fd, 65536)
            hit = _MARK.search(buf, seen)
            if hit:
                return buf[seen:], hit.group(1)
        return buf[seen:], None
    finally:
        os.kill(pid, 9)
        os.waitpid(pid, 0)


def test_without_the_pager_line_git_diff_really_hangs(tmp_path):
    """前提：r84 的卡法在本地复现得出来。"""
    _repo(tmp_path)
    out, code = _type_and_wait(tmp_path, BARE_SETUP, 4)
    assert code is None and b"\x1b[?1h\x1b=" in out          # less 起来了，命令没结束


def test_the_console_runs_it_through(tmp_path):
    _repo(tmp_path)
    out, code = _type_and_wait(tmp_path, _CONSOLE_SETUP, 15)
    assert code == b"0", out[-400:]
    assert b"y39 = 78" in out                                  # diff 全文出来了，不是只看到第一屏
    assert b"\x1b[?1h\x1b=" not in out
