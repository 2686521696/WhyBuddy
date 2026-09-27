"""验收构建失败：回执带上构建输出的尾巴（tsc 报错），不让模型去翻开发服务器的原始日志。

⚠ 2026-09-27 隔离真机第 50 轮 sr-20260927152105-0S41JP22AM（民宿预订管理 + 追问按房型
  和日期筛空房）：project_verify 回 project_build_failed，回执只有 buildExitCode=2。
  模型去 project_logs 翻开发服务器那条操作——一个字符一个事件、夹着 ANSI、混着开发
  服务器重启——翻两页才看到 tsc 的错。

夹具是那条开发服务器操作上的 runtime.log 事件原样（15 条，带 processId 与时间戳）：
同一条操作上三次验收构建，一次过（1648）、一次挂（2238）、一次过（2557）。
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from services.project_tools import _build_log_tail

EVENTS = json.loads((Path(__file__).parent / "fixtures" / "round50_runtime_logs.json").read_text("utf-8"))
# 那三次验收构建证据的起止（wb_project_verification 原样）。
PASSED_FIRST = ("2026-09-27T15:34:23.595", "2026-09-27T15:34:36.634")
FAILED = ("2026-09-27T15:37:35.531", "2026-09-27T15:37:44.937")
PASSED_LAST = ("2026-09-27T15:38:50.336", "2026-09-27T15:39:03.172")


class _Store:
    def list_events(self, operation_id, *, owner_id, after_seq=0, limit=200):
        rows = [e for e in EVENTS if e["seq"] > after_seq][:limit]
        return [SimpleNamespace(type=e["type"], seq=e["seq"], timestamp=e["timestamp"], payload=e["payload"]) for e in rows]


def _tail(window):
    return _build_log_tail(_Store(), "pop-960e", "alice", since=window[0], until=window[1] + "999+00:00")


def test_the_failed_build_window_yields_the_tsc_errors():
    tail = _tail(FAILED)
    assert "error TS2345" in tail and "src/main.tsx(93,144)" in tail


def test_a_later_passing_build_does_not_leak_into_the_failed_one():
    """反向：同一条操作上后来又跑了一次通过的构建；查失败那次，不许拿到后来那次的输出。"""
    tail = _tail(FAILED)
    later = _tail(PASSED_LAST)
    assert "error TS" not in later
    assert tail != later


def test_dev_server_output_is_never_mistaken_for_the_build():
    """反向：开发服务器（> … dev）那几段不是构建。"""
    assert "vite --host" not in _tail(FAILED)


# ── 接在链路上（§三）：真 SQL 验收 owner + 假进程，构建输出是第 50 轮原样 ──────────
import pytest  # noqa: E402

from project_actor_support import project_actor  # noqa: E402,F401
from services.workspace_provider import ProcessLogChunk  # noqa: E402
from test_project_browser_verification import install_browser, verdict, verify  # noqa: E402
from test_project_live_source_sync import live  # noqa: E402,F401

ROUND50_BUILD_OUTPUT = next(e["payload"]["text"] for e in EVENTS if "error TS2345" in (e["payload"]["text"] or ""))


def test_the_live_receipt_carries_the_build_errors(live, monkeypatch):  # noqa: F811
    install_browser(live, monkeypatch)
    live.provider.build_code = 2
    plain = live.provider.read_process_logs

    def logs(handle, pid, *, offset=0):
        if live.provider.processes.get(pid) == "build":
            value = ROUND50_BUILD_OUTPUT.encode()
            return ProcessLogChunk(value[offset:].decode(), len(value))
        return plain(handle, pid, offset=offset)

    monkeypatch.setattr(live.provider, "read_process_logs", logs)
    child = verify(live)
    assert verdict(live, child).verification.build.status == "failed"
    observed = live.tools.execute("project_verification", {"operationId": child}, live.state)
    assert observed["ok"] and "error TS2345" in observed["verification"]["buildLogTail"]


def test_a_passing_build_has_no_tail(live, monkeypatch):  # noqa: F811
    """反向：构建过了就不挂这段。"""
    install_browser(live, monkeypatch)
    child = verify(live)
    verdict(live, child)
    observed = live.tools.execute("project_verification", {"operationId": child}, live.state)
    assert "buildLogTail" not in (observed.get("verification") or {})
