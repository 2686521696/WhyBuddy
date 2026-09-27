"""改文件、还在排队的命令：回执不许叫模型去翻一个空日志。

⚠ 2026-09-27 隔离真机第 65 轮 sr-20260927190013-AJ2QM1WR1Y（Markdown 笔记追问）：
  1 次 file_write + 5 次 file_str_replace，每张回执都挂「完整输出在操作日志，用
  project_logs 或 shell_view 带 operationId 再取」，excerpt 是空串；排在开发服务器
  后面、还没开始的 npm run build 也挂着这句。

判据喂那一轮的原样回执（去掉宿主后加的 excerpt / hint），走 _command_pointer——
command_receipt_from 与分发处等完都走它（test_waiting_returns_the_output 钉着）。
把 _command_pointer 里 pop("hint") 那支删掉，前两条变红。
"""

from __future__ import annotations

from services.project_tools import LOG_POINTER_HINT, _command_pointer

# 第 65 轮 seq 38：file_str_replace 的回执。
ROUND65_PATCH = {
    "cancelRequested": False, "commandFinished": True, "errorCode": None, "kind": "runtime.patch",
    "lastSeq": 0, "ok": True, "operationId": "pop-b806b4746a6b4e8396eeb2a9bea318b0",
    "projectId": "prj-a8035e8864855606846d46b86e6b35d0", "revision": "prv-4af84b3bd266ff15095881d21a754e32",
    "runtimeOperationId": "pop-15bcd35ac90943ffa5e945703aa0382d", "sourcePublished": True,
    "status": "completed", "synchronized": True, "verification": "not_run",
}
# 第 65 轮 seq 62：排在开发服务器后面的 npm run build。
ROUND65_QUEUED = {
    "blockedBy": {"kind": "runtime.start", "operationId": "pop-15bcd35ac90943ffa5e945703aa0382d",
                  "status": "running"},
    "cancelRequested": False, "commandFinished": False, "kind": "runtime.exec", "lastSeq": 0, "ok": True,
    "operationId": "pop-50d9ba7c184e4ec8a45032d6e985cf8d", "revision": "prv-1df9067b211a00a50e54bf7807046f8c",
    "status": "queued",
}


def test_a_file_edit_receipt_does_not_point_at_a_log():
    out = _command_pointer(dict(ROUND65_PATCH), "")
    assert "hint" not in out
    assert out["operationId"] == ROUND65_PATCH["operationId"]  # 别的照旧


def test_a_queued_command_does_not_point_at_a_log():
    out = _command_pointer(dict(ROUND65_QUEUED), "")
    assert "hint" not in out
    assert out["blockedBy"] == ROUND65_QUEUED["blockedBy"]


def test_a_finished_command_still_points_at_its_log():
    """反向：跑完的命令，日志里有东西，照旧说去哪取全文。"""
    finished = {**ROUND65_QUEUED, "status": "completed", "commandFinished": True, "exitCode": 0,
                "command": "build"}
    out = _command_pointer(finished, "vite v7.3.6 building for production...\n✓ built in 812ms")
    assert out["hint"].endswith(LOG_POINTER_HINT)


def test_a_failed_edit_keeps_what_else_it_has_to_say():
    """反向：只剩那一句时才收；有别的话（这里是 exit 127）整段照旧。"""
    failed = {**ROUND65_PATCH, "exitCode": 127, "status": "failed"}
    out = _command_pointer(failed, "bash: rg: command not found")
    assert "rg" in out["hint"] and LOG_POINTER_HINT in out["hint"]
