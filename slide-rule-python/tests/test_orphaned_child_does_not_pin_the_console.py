"""命令自己退出了，留下的后台子进程不许把它钉成 running。

⚠ 2026-09-28 隔离真机第 83 轮 sr-20260928031857-QGV5XCJ4GS（稍后阅读网页，追问「用 webapp-testing 把添加、
  标记已读、删除点一遍」）：`with_server.py --server "npm run dev" … -- python3 scripts/acceptance_flow.py`
  03:41:20 打完 Traceback、「All servers stopped」、回到提示符，操作一直 running 到 03:45:27 被模型
  取消；前一条同样的命令挂了 9 分钟，后一条排队 6 分钟。with_server 用 shell=True 起服务，terminate
  只杀到 sh，vite 孙进程握着 PTY，读循环等不到流结束。

E2B 真机探针（start_console 原样）：`python3 -c "…Popen('sleep 120', stdout=PIPE)…"` 修前 bash 退出 40 秒
仍 running；修后 7.6 秒结束，exit 0。这里用假 PTY 摆同一个形状：退出标记到了，kill 之后流也不结束。
把 _console_finish_after 里兜底的 _console_settle 删掉，第一条变红。
"""

from __future__ import annotations

import time

from services import e2b_workspace_provider as module
from tests.test_workspace_provider import FakePtyHandle, setup_provider  # noqa: F401  （夹具）


class HeldOpenPty(FakePtyHandle):
    """孙进程握着 PTY：kill 了 bash，流仍不结束。"""

    def kill(self):
        self.killed = True  # 不 close()


def _run(setup_provider, monkeypatch, held):  # noqa: F811
    provider, handle, fake, _ = setup_provider
    monkeypatch.setattr(module, "CONSOLE_TYPE_INTERVAL", 0)
    monkeypatch.setattr(module, "CONSOLE_ORPHAN_GRACE", 0.2)
    if held:
        fake.pty.handle = HeldOpenPty()
    started = provider.start_console(handle, "python3 with_server.py --server 'npm run dev' -- python3 flow.py")
    deadline = time.time() + 5
    while provider.is_process_running(handle, started.process_id) and time.time() < deadline:
        time.sleep(0.05)
    return provider, handle, started, fake


def test_a_console_whose_pty_stays_open_still_finishes_after_exit(setup_provider, monkeypatch):  # noqa: F811
    provider, handle, started, fake = _run(setup_provider, monkeypatch, held=True)
    assert provider.is_process_running(handle, started.process_id) is False
    assert provider.process_result(handle, started.process_id).exit_code == 0
    # 退出前打的东西一个不少
    assert "added 21 packages" in provider.read_console(handle, started.process_id).text


def test_a_normal_console_still_ends_on_its_own(setup_provider, monkeypatch):  # noqa: F811
    """反向：流正常结束的，照旧由读循环收尾，结果不变。"""
    provider, handle, started, _ = _run(setup_provider, monkeypatch, held=False)
    assert provider.is_process_running(handle, started.process_id) is False
    assert provider.process_result(handle, started.process_id).exit_code == 0


def test_no_exit_marker_means_still_running(setup_provider, monkeypatch):  # noqa: F811
    """反向：bash 没报退出码（命令真的还在跑）就不许替它收尾。"""
    provider, handle, fake, _ = setup_provider
    monkeypatch.setattr(module, "CONSOLE_TYPE_INTERVAL", 0)
    monkeypatch.setattr(module, "CONSOLE_ORPHAN_GRACE", 0.2)
    fake.pty.handle = HeldOpenPty()
    fake.pty.send_stdin = lambda pid, data: (fake.pty.sent.append(data), fake.pty.handle.push(data),
        fake.pty.handle.push(b"\x1b]777;wb;0\x07") if b"PROMPT_COMMAND" in data else None)
    started = provider.start_console(handle, "npm run dev")
    time.sleep(1.0)
    assert provider.is_process_running(handle, started.process_id) is True
