"""只读闸停下时的话：它数的是「整轮没写」，不只是读源码。

⚠ 2026-09-28 隔离真机第 83 轮 sr-20260928031857-QGV5XCJ4GS：停下前那一串是 shell_wait ×4、
  shell_view ×3、project_status、project_logs、project_cancel——在等一条命令，一行源码没读；
  收尾却说「模型连着多轮只读源码」。step_is_read_only 把它们算成只读是对的（都不写），
  话不对。
"""

from __future__ import annotations

from models.v5_state import V5SessionState
from services.rehearsal_control import ControlStopReason, _cap_speech, step_is_read_only

ROUND83_WAITS = [{"name": n} for n in ("shell_wait", "shell_view", "project_status", "project_logs", "project_cancel")]


def test_the_round83_waits_are_counted_as_no_write_rounds():
    """前提：闸对这些调用的判法没变（都算没写），被改的只是那句话。"""
    assert all(step_is_read_only([call]) for call in ROUND83_WAITS)


def test_the_stop_speech_does_not_claim_source_reading():
    speech = _cap_speech(V5SessionState(sessionId="s", ownerId="alice", goal={"text": "稍后阅读网页"}, runtimeKind="project"), ControlStopReason.NO_WRITES)
    assert "只读源码" not in speech
    assert "等命令" in speech and "一次都没写" in speech
