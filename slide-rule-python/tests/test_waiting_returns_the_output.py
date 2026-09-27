"""等完一条命令，回执里要有它的输出。

⚠ 2026-09-27 隔离真机第 34 轮 sr-20260927104309-NGWZ3Z4HWC（信息安全培训 PPT，
  追问「检查每一页有没有文字超出页面」）：模型的逐页越界检查 shell_exec 前台返回
  running，改用 shell_wait 等到完成——回执只有 exitCode / lastSeq，没有一行输出。
  模型判断「受管日志把逐字符终端回显截断了」，接着 shell_wait ×4、project_logs ×4、
  shell_view ×2、再改写成只打一行的检查重跑：3 分半钟在找自己那条命令的输出。

shell_exec 自己等完走的是 command_receipt_from（日志尾 + 提示）；shell_wait、
project_status 是同一件事的另两个入口（CLAUDE.md §四），交回同一份回执。

判据走真的 ProjectTools.execute + SQL 存储，命令与输出是第 34 轮那条原样。
把 _settled_receipt 改回 _snapshot，前两条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401
from test_project_tools import create, execute, setup  # noqa: F401

# 第 34 轮那条逐页越界检查，原样。
ROUND34_CHECK = (
    "python3 -c \"from pptx import Presentation; p=Presentation('新员工信息安全培训.pptx'); "
    "W,H=p.slide_width,p.slide_height; print('slides',len(p.slides),'size',W,H); bad=[]; counts=[]; "
    "[([bad.append((i+1,getattr(sh,'name',''),sh.left,sh.top,sh.left+sh.width,sh.top+sh.height)) "
    "for sh in sl.shapes if sh.left<0 or sh.top<0 or sh.left+sh.width>W or sh.top+sh.height>H], "
    "counts.append(len(sl.shapes))) for i,sl in enumerate(p.slides)]; print('shape_counts',counts); "
    "print('out_of_bounds',bad)\""
)
# 那条命令在终端里的输出（真机 project_logs 最后拿到的那段）。
ROUND34_OUTPUT = (
    "slides 8 size 12191695 6858000\r\n"
    "shape_counts [20, 26, 28, 28, 33, 31, 27, 22]\r\n"
    "out_of_bounds []\r\n"
)


def _finished_check(setup):
    create(setup)
    queued = execute(setup, "shell_exec", {"command": ROUND34_CHECK, "is_background": True})
    assert queued["ok"] and queued["commandFinished"] is False, queued
    op_id = queued["operationId"]
    # 真机形状：PTY 回显 + 输出都在 runtime.console 里；回显是一个字符一个事件。
    for char in "user@e2b:~/workspace$ " + ROUND34_CHECK + "\r\n":
        setup.store.append_event(op_id, owner_id="alice", event_type="runtime.console",
                                 payload={"data": char})
    setup.store.append_event(op_id, owner_id="alice", event_type="runtime.console",
                             payload={"data": ROUND34_OUTPUT + "user@e2b:~/workspace$ "})
    operation = setup.store.get_operation(op_id, owner_id="alice")
    setup.store._q("update wb_project_operation set payload=$1,rev=rev+1 where id=$2", [
        operation.model_copy(update={"status": "completed",
            "result": {"exitCode": 0, "command": ROUND34_CHECK}}).model_dump_json(), op_id])
    return op_id


def test_shell_wait_hands_back_what_the_command_printed(setup):
    op_id = _finished_check(setup)
    waited = execute(setup, "shell_wait", {"id": op_id, "seconds": 5})
    assert waited["commandFinished"] is True and waited["exitCode"] == 0, waited
    assert "out_of_bounds []" in waited["excerpt"]
    assert "shape_counts [20, 26, 28, 28, 33, 31, 27, 22]" in waited["excerpt"]


def test_project_status_on_a_finished_command_hands_back_the_same(setup):
    op_id = _finished_check(setup)
    status = execute(setup, "project_status", {"operationId": op_id})
    assert status["ok"] and "out_of_bounds []" in status["excerpt"], status


def test_a_command_still_running_is_not_given_an_excerpt_as_if_done(setup):
    """反向：还没结束的，照旧是快照——不许拿半截日志当结果交回。"""
    create(setup)
    queued = execute(setup, "shell_exec", {"command": ROUND34_CHECK, "is_background": True})
    waited = execute(setup, "shell_wait", {"id": queued["operationId"], "seconds": 0})
    assert waited["commandFinished"] is False
    assert "excerpt" not in waited
