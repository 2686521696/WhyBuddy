"""命令失败，模型要看得见报错本身。

⚠ 2026-09-25 隔离真机 sr-20260925111249-E1Y12175TS：`python3 generate_deck.py` 缺
  pptx 退出码 1。回执 excerpt 只有回显的那半行命令和控制码，ModuleNotFoundError
  一个字没有；提示「完整输出在操作日志，用 project_logs 再取」，模型照做两次拿回
  同一段。原因：从 seq 0 读前 100 条事件，而 PTY 回显一字节一个事件——187 条
  控制台事件里前 100 条全是回显，报错在最后。模型最后靠猜 pip install 修好。

夹具 `fixtures/pptx_missing_module_pty_events.json` 是那条操作在库里的原样 193 条
事件。假 store 只替换存储，读取语义照 SQL：seq > after_seq 升序取 limit 条。
把 command_receipt_from 传 lastSeq 那处删掉，或把 excerpt 改回从 0 读，第一条变红。
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from services.project_tools import _terminal_text, command_receipt_from, tool_error

EVENTS = json.loads((Path(__file__).parent / "fixtures" / "pptx_missing_module_pty_events.json")
                    .read_text(encoding="utf-8"))


class _Store:
    def list_events(self, operation_id, *, owner_id, after_seq=0, limit=200):
        rows = [e for e in EVENTS if e["seq"] > after_seq]
        rows.sort(key=lambda e: e["seq"])
        return [SimpleNamespace(type=e["type"], payload=e["payload"], seq=e["seq"]) for e in rows[:limit]]


def _adapter():
    last = max(e["seq"] for e in EVENTS)
    return SimpleNamespace(
        store=_Store(), owner_id="alice",
        _snapshot=lambda op: {"operationId": op, "kind": "runtime.exec", "status": "failed",
                              "lastSeq": last, "result": {"exitCode": 1}})


def test_the_receipt_of_a_failed_command_carries_the_error_itself():
    receipt = command_receipt_from(_adapter(), EVENTS[0]["operationId"])
    excerpt = receipt["excerpt"]
    assert "ModuleNotFoundError" in excerpt and "No module named 'pptx'" in excerpt
    assert "\x1b" not in excerpt  # 控制码去掉了，模型读的是屏幕上的字


def test_the_echoed_command_is_rejoined_not_cut_at_the_terminal_wrap():
    """终端第 80 列折行的「空格 + 回车」是续行，不是覆盖：命令要拼回原样。"""
    raw = "".join(str(e["payload"].get("data") or "") for e in EVENTS if e["type"] == "runtime.console")
    screen = _terminal_text(raw)
    assert "p=Presentation('2026_Q3_Product_Review.pptx')" in screen


def test_a_redrawn_progress_line_keeps_only_its_final_state():
    """反向：真正的回车覆盖（进度条重画）只留最后一版，不许把每一帧都塞给模型。"""
    assert _terminal_text("Downloading 10%\r Downloading 55%\r Downloading 100%\nok") == " Downloading 100%\nok"


def test_a_multiline_command_is_told_how_to_run_it():
    body = tool_error("project_shell_multiline_not_supported")
    assert "file_write" in body["hint"] and "一行" in body["hint"]
    # 反向：其他拒绝原因不挂这句
    assert "hint" not in tool_error("project_shell_command_not_allowed")


def test_a_long_install_before_the_error_still_leaves_the_error_in_view():
    """报错前面先跑了很久的安装：npm/pip 的转圈进度也是一字符一个事件
    （上一轮真机日志里的 ⠙⠹⠸…）。读尾巴必须从 lastSeq 往回数，不能从头数。"""
    spinner = [{"seq": i + 1, "type": "runtime.console", "payload": {"data": "⠙⠹⠸⠼"[i % 4]},
                "operationId": EVENTS[0]["operationId"]} for i in range(1200)]
    shifted = [{**e, "seq": e["seq"] + 1200} for e in EVENTS]
    long_log = spinner + shifted

    class Store:
        def list_events(self, operation_id, *, owner_id, after_seq=0, limit=200):
            rows = sorted((e for e in long_log if e["seq"] > after_seq), key=lambda e: e["seq"])
            return [SimpleNamespace(type=e["type"], payload=e["payload"], seq=e["seq"]) for e in rows[:limit]]

    adapter = SimpleNamespace(store=Store(), owner_id="alice",
        _snapshot=lambda op: {"operationId": op, "kind": "runtime.exec", "status": "failed",
                              "lastSeq": long_log[-1]["seq"], "result": {"exitCode": 1}})
    excerpt = command_receipt_from(adapter, EVENTS[0]["operationId"])["excerpt"]
    assert "No module named 'pptx'" in excerpt
