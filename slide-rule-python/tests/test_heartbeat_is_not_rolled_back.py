"""心跳续的租约不许被生产者的一次普通写回滚。

⚠ 2026-10-06 真机 r29 sr-20261006032934-1QPRYB0C4P（@systematic-debugging 购物车总价）：跑到第 19 分钟、
  project_verify 刚派出去 14 秒，run 判成 interrupted / control_reconciliation_required。库里 lease_owner 还是
  本机同一个 worker、generation=2——本机自己把还活着的那发重新领了：

      heartbeat 只改 lease_expires_at，不动 rev；
      _producer_update 先读行，再 `set lease_expires_at=<读到的旧值> … where rev=<读到的 rev>`。

  心跳落在「读 → 写」之间，rev 没变、CAS 照过，旧值把刚续的租约写回去。HTTPS 网关一发几百毫秒，等浏览器操作时
  control_project_state 几秒一条，连着吞两拍心跳租约就过期 → 扫描当成崩了的 run 重新领 → checkpoint 停在
  dispatching(project_verify) → 对账不了。线上同一个网关，一样会中。

判据走真 SQL / HTTP 两个后端（test_control_run_store 的夹具），心跳是真 heartbeat，插在真 _producer_update 的读写之间。
"""

from __future__ import annotations

import time

from test_control_run_store import claim, store  # noqa: F401  （夹具）


def _lease(store, run_id):
    return float(store._row(run_id)["lease_expires_at"])


def _heartbeat_between_read_and_write(store, monkeypatch, record, lease=600):
    """生产者读完行、写之前，心跳续一次。返回心跳续到的时刻。"""
    spill = store._spill_payload_events
    fired = {}

    def spill_then_heartbeat(run_id, events):
        spill(run_id, events)
        if not fired:
            fired["at"] = store.heartbeat(run_id, record["leaseOwner"], record["generation"], lease)["leaseExpiresAt"]
    monkeypatch.setattr(store, "_spill_payload_events", spill_then_heartbeat)
    return fired


def test_an_event_append_does_not_undo_a_heartbeat(store, monkeypatch):
    record = claim(store, lease=30)
    run_id, gen = record["runId"], record["generation"]
    fired = _heartbeat_between_read_and_write(store, monkeypatch, record)
    store.update_goal(run_id, "worker-1", gen, status="active")
    assert fired, "前提：心跳真的插进了读写之间"
    assert _lease(store, run_id) >= fired["at"] - 0.001          # 续到的 600 秒还在，不是回到 30 秒
    assert _lease(store, run_id) > time.time() + 500


def test_a_checkpoint_save_does_not_undo_a_heartbeat(store, monkeypatch):
    record = claim(store, lease=30)
    fired = _heartbeat_between_read_and_write(store, monkeypatch, record)
    store.save_checkpoint(record["runId"], "worker-1", record["generation"], {"schemaVersion": 1, "phase": "model"})
    assert fired and _lease(store, record["runId"]) > time.time() + 500


def test_a_write_that_means_to_drop_the_lease_still_drops_it(store):
    """反向：停下来等操作（wait_for_operations）本来就要把租约清零让别人领——这一类写照旧落库。"""
    record = claim(store, lease=600)
    store.wait_for_operations(record["runId"], "worker-1", record["generation"], ["pop-1"])
    assert _lease(store, record["runId"]) == 0
