"""shell_view 给的是终端此刻的最后一屏，不是日志第一页。

⚠ 2026-09-28 隔离真机第 83 轮 sr-20260928031857-QGV5XCJ4GS（稍后阅读网页，追问「用 webapp-testing 点一遍」）：
  那条 `pip install playwright && playwright install chromium && with_server.py … -- python3 flow.py`
  跑着，模型 shell_view 三次拿回同一段 npm notice（日志开头），只好猜「在下 Chromium」。
  真实的尾巴：Chromium 起不来（libnspr4.so 缺失）、服务已停、回到提示符。

夹具 fixtures/round83_orphaned_with_server_console.json 是那条命令的 116 个 console 事件原样。
判据走真 ProjectTools.execute + SQL 存储。把 shell_view 改回走 _logs，第一条变红。
"""

from __future__ import annotations

import json
from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）

EVENTS = json.loads((Path(__file__).parent / "fixtures" / "round83_orphaned_with_server_console.json").read_text("utf-8"))
COMMAND = ("python3 -m pip install --user playwright && python3 -m playwright install chromium && "
           "python3 .sliderule/skills/webapp-testing/scripts/with_server.py --server \"npm run dev -- --host 0.0.0.0\" "
           "--port 5173 -- python3 scripts/acceptance_flow.py")


def _running(setup, status="running"):
    create(setup)
    queued = execute(setup, "shell_exec", {"command": COMMAND, "is_background": True})
    op_id = queued["operationId"]
    for event in EVENTS:
        setup.store.append_event(op_id, owner_id="alice", event_type=event["type"], payload=event["payload"])
    operation = setup.store.get_operation(op_id, owner_id="alice")
    update = {"status": status}
    if status == "completed":
        update["result"] = {"exitCode": 1, "command": COMMAND}
    setup.store._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2",
                   [operation.model_copy(update=update).model_dump_json(), op_id])
    return op_id


def test_shell_view_on_a_running_command_shows_the_tail(setup):
    op_id = _running(setup)
    viewed = execute(setup, "shell_view", {"id": op_id})
    assert viewed["ok"] is True and viewed["commandFinished"] is False, viewed
    assert "libnspr4.so" in viewed["screen"] or "All servers stopped" in viewed["screen"], viewed["screen"][-300:]
    assert "最后一屏" in viewed["hint"]


def test_project_logs_still_pages_from_the_start(setup):
    """反向：要从头翻的入口还在，给的还是开头。"""
    op_id = _running(setup)
    logs = execute(setup, "project_logs", {"operationId": op_id})
    head = "".join(item["text"] for item in logs["logs"])
    assert "libnspr4.so" not in head and head


def test_shell_view_on_a_finished_command_is_the_full_receipt(setup):
    """跑完的给跟 shell_wait 一样的回执（带尾巴和提示）。"""
    op_id = _running(setup, status="completed")
    viewed = execute(setup, "shell_view", {"id": op_id})
    assert viewed["commandFinished"] is True and "excerpt" in viewed
    assert "All servers stopped" in viewed["excerpt"] or "libnspr4" in viewed["excerpt"]
