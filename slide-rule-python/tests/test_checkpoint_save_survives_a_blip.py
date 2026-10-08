"""存检查点碰上存储抖一下：退避重试，不把整轮掐成「控制面未返回结果」；真正的停照旧立刻停。

⚠ 2026-10-07 真机 r108 ctr-cf9f46ef249455f783c441362cbf6f1d（@kpi-dashboard-design 咖啡豆订阅看板）：子代理复核刚回来，
  存档一次失败整轮 interrupted / control_checkpoint_unavailable（control_run_service.RunCheckpoint.save 头注）。
走真的 RunCheckpoint.save；存储换成按脚本出错的假的。
"""

from __future__ import annotations

import asyncio
import logging
import time
from types import SimpleNamespace

import pytest

from services import control_run_service as service_module
from services.control_checkpoint import ControlRunStopped
from services.control_run_service import RunCheckpoint
from services.control_run_store import ControlRunConflict, ControlRunUnavailable
from services.sql_gateway import NeonHttpError

RECORD = {"runId": "ctr-cf9f46ef249455f783c441362cbf6f1d", "generation": 1, "ownerId": "alice",
          "checkpoint": {"phase": "dispatching", "round": 2}}


class _Store:
    def __init__(self, script):
        self.script, self.saved, self.calls = list(script), [], 0

    def inspect_fence(self, run_id, owner_id):
        return {"generation": 1, "leaseOwner": "w-1", "leaseExpiresAt": time.time() + 60,
                "status": "running", "cancelRequested": False, "sessionId": "sr-1", "ownerId": owner_id}

    def save_checkpoint(self, run_id, worker_id, generation, checkpoint):
        self.calls += 1
        step = self.script.pop(0) if self.script else None
        if step is not None:
            raise step
        self.saved.append(checkpoint)


@pytest.fixture(autouse=True)
def _no_wait(monkeypatch):
    monkeypatch.setattr(service_module, "_SAVE_BACKOFF_SECONDS", 0)


def _save(script):
    store = _Store(script)
    port = RunCheckpoint(SimpleNamespace(store=store, worker_id="w-1", authorize=lambda s, o: None), RECORD)
    asyncio.run(port.save({"phase": "dispatching", "round": 3}))
    return store, port


def test_one_blip_does_not_end_the_run(caplog):
    """r108 那一下：数据库网关 500 一次。"""
    with caplog.at_level(logging.WARNING):
        store, port = _save([NeonHttpError("db-api http 500: Internal Server Error", 500)])
    assert store.saved == [{"phase": "dispatching", "round": 3}] and port.checkpoint["round"] == 3
    assert "retrying" in caplog.text                                        # 这次留了痕迹，下回能查


def test_two_blips_too():
    store, _ = _save([ControlRunUnavailable("x"), NeonHttpError("db-api http 500", 500)])
    assert store.calls == 3 and store.saved


def test_a_store_that_stays_down_still_stops_the_run(caplog):
    """反向：不是无限重试——一直不可用，还是停，原因照旧。"""
    with caplog.at_level(logging.WARNING), pytest.raises(ControlRunStopped, match="control_checkpoint_unavailable"):
        _save([NeonHttpError("500", 500)] * 5)
    assert "after 3 attempts" in caplog.text


@pytest.mark.parametrize("error,reason", [(ControlRunConflict("taken"), "control_lease_lost"),
                                         (ValueError("control_run_size_limit"), "control_checkpoint_unavailable")])
def test_a_real_stop_is_not_retried(error, reason):
    """反向：租约被别的 worker 接走、超限——重试只会更糟或白费，第一次就停。"""
    store = _Store([error, None])
    port = RunCheckpoint(SimpleNamespace(store=store, worker_id="w-1", authorize=lambda s, o: None), RECORD)
    with pytest.raises(ControlRunStopped, match=reason):
        asyncio.run(port.save({"round": 3}))
    assert store.calls == 1 and not store.saved


# ── 采样期间每 0.25 秒的权限确认：查不到给宽限，查到没权限当场停，确认过 5 秒内不重查 ──────────────────
#
# ⚠ 2026-10-08 用户本机执行轮 ctr-6da33921cb525b04ae9454ba46caaede：跑了 6 分钟，interrupted / control_run_access_revoked，
#   账号一秒都没被停用过（control_run_service.RunCheckpoint._authorize 头注）。

def _guarding(authorize):
    calls = []

    def counted(session_id, owner_id):
        calls.append(session_id)
        return authorize(len(calls))
    port = RunCheckpoint(SimpleNamespace(store=_Store([]), worker_id="w-1", authorize=counted), RECORD)
    return port, calls


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(service_module.time, "time", lambda: now[0])
    return now


def _raise(exc):
    raise exc


@pytest.mark.parametrize("blip", [PermissionError("project_actor_unavailable"), NeonHttpError("db-api http 500", 500),
                                  ControlRunUnavailable("x")])
def test_a_lookup_that_cannot_answer_does_not_end_the_run(clock, blip, caplog):
    port, calls = _guarding(lambda n: _raise(blip) if n == 1 else None)
    with caplog.at_level(logging.WARNING):
        port.guard()                                                        # 查不到：不停
        clock[0] += 6
        port.guard()                                                        # 好了：照常
    assert len(calls) == 2 and "keeping run" in caplog.text


def test_a_real_revocation_still_stops_at_once(clock):
    """反向：查到了、没权限，不吃宽限（2026-09-13 那条性质）。"""
    port, _ = _guarding(lambda n: _raise(PermissionError("control_run_access_revoked")))
    with pytest.raises(ControlRunStopped, match="control_run_access_revoked"):
        port.guard()


def test_a_lookup_down_past_the_grace_stops_the_run(clock):
    """反向：不是无限放行。"""
    port, _ = _guarding(lambda n: _raise(NeonHttpError("db-api http 500", 500)))
    port.guard()
    clock[0] += service_module._AUTHORITY_BLIP_GRACE_SECONDS
    with pytest.raises(ControlRunStopped, match="control_checkpoint_unavailable"):
        port.guard()


def test_a_confirmed_authority_is_not_rechecked_every_quarter_second(clock):
    port, calls = _guarding(lambda n: None)
    for _ in range(20):                                                     # 5 秒里采样期间那 20 次 guard
        port.guard()
        clock[0] += 0.25
    assert len(calls) == 1
    clock[0] += 0.1
    port.guard()
    assert len(calls) == 2                                                  # 过了 5 秒就重查：吊销最多晚 5 秒生效


def test_the_identity_blip_is_not_renamed_revocation(monkeypatch):
    """authorize_control_run 不再把「身份库查不到」改写成「被吊销」——否则 guard 分不出来。"""
    monkeypatch.setattr(service_module, "authorize_project_actor",
                        lambda owner: _raise(PermissionError("project_actor_unavailable")))
    with pytest.raises(PermissionError, match="project_actor_unavailable"):
        service_module.authorize_control_run("sr-1", "alice")
    monkeypatch.setattr(service_module, "authorize_project_actor",
                        lambda owner: _raise(PermissionError("project_actor_access_revoked")))
    with pytest.raises(PermissionError, match="control_run_access_revoked"):
        service_module.authorize_control_run("sr-1", "alice")
