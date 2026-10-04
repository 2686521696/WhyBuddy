"""「我的应用」会话卡的摘要：保存时算好，GET /sessions 一次带齐，卡片不再逐张拉整包。

⚠ 2026-10-03 用户截图「我的应用」一长串「待处理」。本地复现（1920×1080，点「我的应用」）：
  3 秒内 156 个 API 请求在飞，其中 99 个 `GET /sessions/{sid}`——每张会话卡挂载就拉一整份
  会话推状态/指标，合计 9.0 MB，最后一条 23 s。

这里钉四件事，每件都配反向判据（本仓第三条「闸全绿但东西没了」）：
  1. 摘要与前端原推导同一张卡——金样 fixtures/session_card_parity.json，TS 那头见
     client/.../__tests__/session-card-parity.test.ts。
  2. **每一条写路径**都写摘要（普通存 / 控制面受控存；插入 / 更新）——漏一条，那条路
     存过的会话摘要就停在旧版本（第四条「只改一半」）。
  3. 老代码写过（rev+1、不碰摘要列）→ 列表**不给**摘要，不画过期的卡；补算后恢复。
  4. 接在链路上：GET /sessions 那一发真的带着 card；启动预热真的调了补算。

重生金样（改了口径之后，先改前端推导）：
    from services.session_card import session_card_summary
    for c in cases: c["expected"] = session_card_summary(c["state"])
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from models.v5_state import V5SessionState
from services import persistence, slide_rule_session
from services.session_card import CARD_VERSION, decode_card, encode_card, session_card_summary

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "session_card_parity.json").read_text("utf-8"))

CLOSED = {
    "evidencePresentCount": 6,
    "perSkillEvidence": {
        "page": {"modelSection": {"pages": [{"name": "首页"}, {"name": "订单"}]}},
        "rbac": {"modelSection": {"roles": [{"id": "admin"}]}},
        "appbundle": {"modelSection": {"appIdentity": {"productName": "小店", "theme": "emerald", "icon": "store"}}},
    },
}


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_summary_matches_the_golden_shared_with_the_frontend(case):
    assert session_card_summary(case["state"]) == case["expected"]


def test_the_golden_actually_exercises_js_truthiness():
    """反向：金样里得真有「Python 与 JS 真值不同」的那条，不然上面那组判据咬不住
    有人把 _js_truthy 换成 bool()。"""
    case = next(c for c in FIXTURE["cases"] if "blocked = []" in c["name"])
    assert case["expected"]["blocked"] is True and case["expected"]["status"] != "runnable"
    assert bool(case["state"]["publishClosure"]["blocked"]) is False


def test_encode_decode_round_trip_and_unknown_version_is_ignored():
    raw = encode_card({"publishClosure": CLOSED})
    card = decode_card(raw)
    assert card and card["v"] == CARD_VERSION and card["status"] == "runnable"
    assert decode_card(json.dumps({**card, "v": CARD_VERSION + 1})) is None
    assert decode_card("not json") is None and decode_card(None) is None


# ───────────────────────────── 存储：每条写路径 ─────────────────────────────


@pytest.fixture
def blobs(tmp_path, monkeypatch):
    from services.session_blob_store import SqlSessionBlobStore

    store = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'sessions.db'}")
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: store)
    yield store
    store._engine.dispose()


def _listed(store, sid):
    return next(row for row in store.list_summaries() if row["sessionId"] == sid)


def _old_code_write(store, sid, payload):
    """还没部署新版的那台机器存了一次：payload 换了、rev+1，摘要两列一个不碰。"""
    with store._engine.begin() as conn:
        conn.execute(store._text(
            "update sliderule_session set payload = :p, rev = rev + 1 where session_id = :sid"),
            {"p": json.dumps(payload, ensure_ascii=False), "sid": sid})


def test_insert_and_update_both_write_the_card(blobs):
    payload = {"sessionId": "sr-1", "ownerId": "alice", "goal": {"text": "x"}}
    assert blobs.save("sr-1", payload, expected_rev=None)
    assert _listed(blobs, "sr-1")["card"]["status"] == "draft"

    rev = blobs.load("sr-1").rev
    assert blobs.save("sr-1", {**payload, "publishClosure": CLOSED}, expected_rev=rev)
    card = _listed(blobs, "sr-1")["card"]
    assert card["status"] == "runnable" and card["pages"] == 2 and card["identity"]["productName"] == "小店"


def test_a_write_by_old_code_hides_the_card_instead_of_showing_a_stale_one(blobs):
    payload = {"sessionId": "sr-2", "ownerId": "alice", "goal": {"text": "x"}, "publishClosure": CLOSED}
    assert blobs.save("sr-2", payload, expected_rev=None)
    assert _listed(blobs, "sr-2")["card"]["status"] == "runnable"

    _old_code_write(blobs, "sr-2", {**payload, "publishClosure": {**CLOSED, "blocked": True}})
    assert _listed(blobs, "sr-2")["card"] is None  # 作废，前端退回逐张拉

    stats = persistence.refresh_stale_session_cards()
    assert stats["written"] == 1
    card = _listed(blobs, "sr-2")["card"]
    assert card["blocked"] is True and card["status"] == "draft"  # 补的是新 payload 的摘要
    assert persistence.refresh_stale_session_cards()["written"] == 0  # 补完不再是过期行


def test_backfill_covers_rows_saved_before_the_card_columns_existed(blobs):
    with blobs._engine.begin() as conn:
        conn.execute(blobs._text(
            "insert into sliderule_session (session_id, payload, rev, owner_id) values (:sid, :p, 3, 'alice')"),
            {"sid": "sr-legacy", "p": json.dumps({"sessionId": "sr-legacy", "awaitReason": "need_input"})})
    assert _listed(blobs, "sr-legacy")["card"] is None
    assert persistence.refresh_stale_session_cards()["written"] == 1
    assert _listed(blobs, "sr-legacy")["card"]["status"] == "awaiting"


def test_backfill_does_not_overwrite_a_session_saved_meanwhile(blobs):
    """补算读完 payload 之后有人存了一次：rev 对不上，不写——新那次保存自己带着摘要。"""
    payload = {"sessionId": "sr-race", "ownerId": "alice"}
    assert blobs.save("sr-race", payload, expected_rev=None)
    _old_code_write(blobs, "sr-race", payload)
    stale_rev = blobs.load("sr-race").rev
    assert blobs.save("sr-race", {**payload, "publishClosure": CLOSED}, expected_rev=stale_rev)
    assert blobs.write_card("sr-race", stale_rev, encode_card(payload)) is False
    assert _listed(blobs, "sr-race")["card"]["status"] == "runnable"


def test_control_owned_writes_carry_the_card_too(tmp_path, monkeypatch, blobs):
    """推演主链路走的是控制面受控存（_controlled_save_statement），不是普通 save。"""
    from services.control_run_store import ControlRunStore
    from services.project_store import ProjectStore

    # 控制表与会话表必须同一个库（受控存在一条语句里跨表），所以项目库指向同一个文件。
    projects = ProjectStore.from_url(f"sqlite:///{tmp_path / 'sessions.db'}")
    controls = ControlRunStore(projects._q)
    monkeypatch.setattr(slide_rule_session, "_sessions", {})
    state = V5SessionState(sessionId="sr-fenced", ownerId="owner", goal={"text": "x"})
    state = slide_rule_session.save_session(state, server_write=True, require_durable=True)
    run = controls.submit(state.sessionId, state.ownerId, "request", {"sessionId": state.sessionId})
    claimed = controls.claim(run["runId"], "w", 120)
    fence = {"runId": run["runId"], "ownerId": state.ownerId,
             "generation": claimed["generation"], "workerId": "w"}
    before_rev = blobs.load("sr-fenced").rev

    closed = state.model_copy(update={"publishClosure": CLOSED})
    slide_rule_session.save_session(closed, server_write=True, require_durable=True,
                                    expected_control_run=fence)
    assert blobs.load("sr-fenced").rev == before_rev + 1  # 真走了受控更新那条
    card = _listed(blobs, "sr-fenced")["card"]
    assert card is not None and card["status"] == "runnable"
    projects.close()


# ───────────────────────────── 链路：路由 + 启动 ─────────────────────────────


def test_the_sessions_route_hands_the_card_to_the_gallery(blobs, monkeypatch):
    from routes import sliderule_full

    state = V5SessionState(sessionId="sr-route", ownerId="alice", goal={"text": "做个店"},
                           publishClosure=CLOSED)
    assert persistence.save_session_record(state, server_write=True)["ok"]
    monkeypatch.setattr(sliderule_full, "_auth", lambda _key: None)
    monkeypatch.setattr(sliderule_full, "_session_work_index", lambda: {})
    body = sliderule_full.list_sess(SimpleNamespace(id="alice", role="user", email="a@x"), None)
    row = next(r for r in body["sessions"] if r["sessionId"] == "sr-route")
    assert row["card"] == session_card_summary(json.loads(json.dumps(blobs.load("sr-route").payload)))
    assert row["card"]["status"] == "runnable"

    # 反向：摘要作废的那条不带 card 键，前端据此退回老路。
    _old_code_write(blobs, "sr-route", blobs.load("sr-route").payload)
    body = sliderule_full.list_sess(SimpleNamespace(id="alice", role="user", email="a@x"), None)
    row = next(r for r in body["sessions"] if r["sessionId"] == "sr-route")
    assert "card" not in row


@pytest.mark.parametrize("flag, expected_calls", [("1", 1), ("0", 0)])
def test_startup_warmup_runs_the_backfill(monkeypatch, flag, expected_calls):
    """接在启动上：预热线程跑完三个后端之后调补算；=0 时不调（它写库）。"""
    import app as app_module
    from services import app_store, identity_store

    calls = []
    built_store = object()
    monkeypatch.setenv("SLIDERULE_SESSION_CARD_BACKFILL", flag)
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: built_store)
    monkeypatch.setattr(app_store, "get_backend", lambda: None)
    monkeypatch.setattr(identity_store, "get_identity_store", lambda: None)
    # 补算用的就是预热建好的那个后端（不再建第二次——test_session_persistence_contract 数着建了几次）。
    monkeypatch.setattr(persistence, "refresh_stale_session_cards",
                        lambda *, store: calls.append(store) or {})
    app_module._warm_storage_backends()
    for thread in threading.enumerate():
        if thread.name == "warm-storage":
            thread.join(timeout=10)
    assert len(calls) == expected_calls
    assert all(store is built_store for store in calls)


# ───────────────────── 线上那条后端：HTTPS SQL 网关（HttpApiSessionBlobStore）─────────────────────


@pytest.fixture
def http_blobs(tmp_path, monkeypatch):
    """线上走的是 HttpApiSessionBlobStore（继承 NeonHttp 的写语句），上面那组只测了 SQLAlchemy 后端。

    ⚠ 变异实测：把 HTTP 后端 update 里的 card_summary 删掉，上面整组照样全绿——
      线上那一半静默失效（第四条）。这里执行的是**那个类自己的 SQL 原文**，只把
      Postgres 方言翻成 SQLite（`$N`→`?N`、去掉 `::jsonb`），不重抄逻辑（§一之二）。
    """
    import re
    import sqlite3

    from services import session_blob_store as sbs

    conn = sqlite3.connect(tmp_path / "http.db", isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute(sbs._DDL_SQLITE)

    def q(sql, params=None):
        sql = re.sub(r"\$(\d+)", r"?\1", sql.replace("::jsonb", ""))
        if "::" in sql:
            raise AssertionError(f"untranslated cast in {sql}")
        args = [json.dumps(p) if isinstance(p, dict) else p for p in (params or [])]
        return [dict(r) for r in conn.execute(sql, args).fetchall()]

    store = object.__new__(sbs.HttpApiSessionBlobStore)
    store._q = q
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: store)
    yield store, conn
    conn.close()


def test_the_https_gateway_backend_writes_and_lists_the_card(http_blobs):
    store, conn = http_blobs
    payload = {"sessionId": "sr-h", "ownerId": "alice"}
    assert store.save("sr-h", payload, expected_rev=None)
    listed = next(r for r in store.list_summaries() if r["sessionId"] == "sr-h")
    assert listed["card"]["status"] == "draft"

    assert store.save("sr-h", {**payload, "publishClosure": CLOSED}, expected_rev=1)
    listed = next(r for r in store.list_summaries() if r["sessionId"] == "sr-h")
    assert listed["card"]["status"] == "runnable"

    conn.execute("update sliderule_session set rev = rev + 1 where session_id = 'sr-h'")
    assert next(r for r in store.list_summaries() if r["sessionId"] == "sr-h")["card"] is None
    assert store.stale_card_rows(10) == [("sr-h", 3)]
    assert persistence.refresh_stale_session_cards()["written"] == 1
    assert next(r for r in store.list_summaries() if r["sessionId"] == "sr-h")["card"]["status"] == "runnable"


def test_the_file_store_lists_cards_too(tmp_path, monkeypatch):
    """没配库（或显式 SLIDERULE_SESSIONS_FILE）走文件存档：列表那一路也得带摘要（第四条）。"""
    from routes import sliderule_full

    store_file = tmp_path / "sessions.json"
    monkeypatch.setattr(persistence, "_blob_store", lambda _path=None: None)
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(store_file))
    state = V5SessionState(sessionId="sr-file", ownerId="alice", goal={"text": "x"}, publishClosure=CLOSED)
    assert persistence.save_session_record(state, server_write=True)["ok"]
    monkeypatch.setattr(sliderule_full, "_auth", lambda _key: None)
    monkeypatch.setattr(sliderule_full, "_session_work_index", lambda: {})
    body = sliderule_full.list_sess(SimpleNamespace(id="alice", role="user", email="a@x"), None)
    row = next(r for r in body["sessions"] if r["sessionId"] == "sr-file")
    assert row["card"]["status"] == "runnable" and row["card"]["identity"]["productName"] == "小店"
