"""App Store 版本链激活哨兵（2026-07-27 审查修复 #3/D10）。

历史问题：闭环落库只调 save_app(dedup_key=会话+模型签名)——模型一变签名
就变 → miss → 每次精修都新建孤儿 root（v1），画廊堆同名重复卡；为改版
设计的 save_version 是全仓零调用的死代码，v2 徽标永不出现。

修复入口 save_app_or_version：模型未变幂等更新；同会话模型有变 → 同 root
新版本；新会话 → 新应用。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import app_store


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(app_store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(app_store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    app_store.reset_backend_cache()
    yield
    app_store.reset_backend_cache()


def _model(n: int) -> dict:
    return {
        "datamodel": {"entities": [{"id": f"e{n}", "name": f"实体{n}", "fields": []}]},
        "appbundle": {"appIdentity": {"productName": f"应用{n}"}},
    }


def test_same_session_changed_model_becomes_new_version(store):
    first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    second = app_store.save_app_or_version(_model(2), goal="g", session_id="s1")
    assert first != second
    rec1, rec2 = app_store.get_app(first), app_store.get_app(second)
    assert rec2["root_id"] == rec1["root_id"] == rec1["id"]  # 同根
    assert rec2["parent_id"] == first
    assert (rec1["version"], rec2["version"]) == (1, 2)
    # 画廊每根只出最新版 → 一张卡,不再堆同名重复卡
    cards = app_store.list_apps()
    assert len(cards) == 1
    assert cards[0]["id"] == second and cards[0]["version"] == 2
    # 版本链可查
    chain = app_store.list_versions(rec1["root_id"])
    assert [v["version"] for v in chain] == [1, 2]


def test_unchanged_model_stays_idempotent(store):
    first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    again = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    assert again == first
    assert len(app_store.list_apps()) == 1
    assert app_store.get_app(first)["version"] == 1


def test_different_sessions_stay_separate_apps(store):
    a = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    b = app_store.save_app_or_version(_model(1), goal="g", session_id="s2")
    assert a != b
    assert app_store.get_app(a)["root_id"] != app_store.get_app(b)["root_id"]
    assert len(app_store.list_apps()) == 2


def test_latest_per_root_prefers_version_over_created_at(store):
    """#8：同 root 的"最新"以 version 为准——created_at 在幂等更新时可能保留
    旧值，单靠时间会把 v1 排到 v2 前面。"""
    first = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    second = app_store.save_app_or_version(_model(2), goal="g", session_id="s1")
    backend = app_store.get_backend()
    # 人为把 v2 的时间改到 v1 之前（复现幂等更新保留旧时间的场景）
    rec2 = app_store.get_app(second)
    rec2_full = backend.get(second)
    rec2_full["created_at"] = "2000-01-01T00:00:00+00:00"
    backend.save(rec2_full)
    cards = app_store.list_apps()
    assert cards[0]["version"] == 2, "画廊必须展示 v2,不是时间更晚的 v1"


def test_fork_binds_session(store):
    src = app_store.save_app_or_version(_model(1), goal="g", session_id="s1")
    fid = app_store.fork_app(src, new_name="副本甲", session_id="fork-sess-1")
    rec = app_store.get_app(fid)
    assert rec["session_id"] == "fork-sess-1"
    assert rec["parent_id"] == src and rec["root_id"] == fid and rec["version"] == 1
