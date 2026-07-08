"""会话活跃时间 sidecar（侧栏"最近"排序的数据源）。

存档条目 [sessionId, state] 无时间字段；每次成功落盘在 <store>.meta.json
盖 lastActive/createdAt 章。纯观测元数据：坏了只影响排序，不影响会话数据。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import persistence  # noqa: E402


def _state(sid: str, turn: str = "turn-1") -> V5SessionState:
    return V5SessionState(sessionId=sid, goal={"text": f"goal of {sid}"}, artifacts=[], lastTurnId=turn)


def test_save_stamps_last_active_and_list_returns_it(tmp_path):
    store = tmp_path / "sessions.json"
    assert persistence.save_session_record(_state("s-a"), store)["ok"]
    assert persistence.save_session_record(_state("s-b"), store)["ok"]

    listed = persistence.list_session_records(store)
    assert listed["ok"]
    by_id = {s["sessionId"]: s for s in listed["sessions"]}
    assert by_id["s-a"]["lastActive"] and by_id["s-a"]["createdAt"]
    assert by_id["s-b"]["lastActive"] >= by_id["s-a"]["lastActive"]

    # 再次落盘刷新 lastActive、保留 createdAt
    created = by_id["s-a"]["createdAt"]
    assert persistence.save_session_record(_state("s-a", turn="turn-2"), store)["ok"]
    refreshed = {s["sessionId"]: s for s in persistence.list_session_records(store)["sessions"]}
    assert refreshed["s-a"]["createdAt"] == created
    assert refreshed["s-a"]["lastActive"] >= by_id["s-b"]["lastActive"]


def test_delete_drops_meta_and_corrupt_meta_is_tolerated(tmp_path):
    store = tmp_path / "sessions.json"
    persistence.save_session_record(_state("s-x"), store)
    assert "s-x" in persistence.read_session_meta(store)
    persistence.delete_session_record("s-x", store)
    assert "s-x" not in persistence.read_session_meta(store)

    # 坏 meta：读回空 dict，落盘照常成功并重建
    meta_path = store.with_name(store.name + ".meta.json")
    meta_path.write_text("{not json", encoding="utf-8")
    assert persistence.read_session_meta(store) == {}
    assert persistence.save_session_record(_state("s-y"), store)["ok"]
    assert json.loads(meta_path.read_text(encoding="utf-8"))["s-y"]["lastActive"]
