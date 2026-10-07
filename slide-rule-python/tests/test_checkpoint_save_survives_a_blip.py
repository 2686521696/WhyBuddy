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
