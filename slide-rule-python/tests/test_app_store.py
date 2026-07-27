"""生成应用存储 / App Store（2026-07-24）的单测覆盖。

同一套 SQLAlchemy 代码在 SQLite（本地/CI，离线）和 Postgres（生产 Neon）上
跑，所以这里用 SQLite 内存/临时库把落库逻辑全测通，等于间接验证了生产
Postgres 路径；再单独测 JSON 文件兜底。两条后端跑同一批断言（参数化），
证明"有 DB 用 DB、没 DB 回退文件"两条路行为一致。
"""

import os
import tempfile

import pytest

import services.app_store as store


def _model(name: str, entities: int = 2, pages: int = 2, theme: str = "forest") -> dict:
    return {
        "datamodel": {"entities": [{"id": f"e{i}", "name": f"E{i}", "fields": []} for i in range(entities)]},
        "page": {"pages": [{"id": f"p{i}", "kind": "monitor" if i == 0 else "workbench"} for i in range(pages)]},
        "appbundle": {
            "landingPageRef": "p0",
            "preferredDevice": "desktop",
            "appIdentity": {"productName": name, "theme": theme, "generatedTheme": {"label": f"{theme}·测试"}},
        },
    }


@pytest.fixture(params=["jsonfile", "sqlite"])
def configured_store(request, tmp_path, monkeypatch):
    """同一批断言在两个后端各跑一遍。"""
    if request.param == "jsonfile":
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
        monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    else:
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'apps.db'}")
    store.reset_backend_cache()
    yield request.param
    store.reset_backend_cache()


def test_save_and_get_roundtrip(configured_store):
    app_id = store.save_app(_model("咖营通"), goal="咖啡店", session_id="s1", gate_passed=True)
    rec = store.get_app(app_id)
    assert rec is not None
    assert rec["product_name"] == "咖营通"
    assert rec["theme_id"] == "forest" and rec["theme_label"] == "forest·测试"
    assert rec["entity_count"] == 2 and rec["page_count"] == 2
    assert rec["gate_passed"] is True
    assert rec["model_json"]["appbundle"]["landingPageRef"] == "p0"  # 完整模型回读得到


def test_get_missing_returns_none(configured_store):
    assert store.get_app("does-not-exist") is None


def test_list_is_summary_and_latest_per_root(configured_store):
    a = store.save_app(_model("咖营通"), session_id="s1")
    store.save_app(_model("宠医云"), session_id="s2")
    store.save_version(root_id=a, parent_id=a, model=_model("咖营通", entities=3))
    apps = store.list_apps()
    assert len(apps) == 2, "每个应用只出最新版"
    assert all("model_json" not in a for a in apps), "列表是摘要，不含大模型载荷"
    ka = next(a for a in apps if a["product_name"] == "咖营通")
    assert ka["version"] == 2 and ka["entity_count"] == 3, "出的应是最新版"


def test_versions_chain(configured_store):
    a = store.save_app(_model("咖营通"))
    store.save_version(root_id=a, parent_id=a, model=_model("咖营通"))
    store.save_version(root_id=a, parent_id=a, model=_model("咖营通"))
    versions = store.list_versions(a)
    assert [v["version"] for v in versions] == [1, 2, 3]
    assert all(v["root_id"] == a for v in versions)


def test_fork_creates_new_lineage(configured_store):
    a = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(a, session_id="s9")
    assert fk is not None and fk != a
    rec = store.get_app(fk)
    assert rec["parent_id"] == a, "fork 的 parent 指向源"
    assert rec["root_id"] == fk and rec["version"] == 1, "fork 是新血缘根、v1"
    assert rec["model_json"]["appbundle"]["appIdentity"]["productName"] == "咖营通", "model 拷贝了一份"
    assert len(store.list_apps()) == 2, "fork 后是两个独立根"


def test_fork_missing_source_returns_none(configured_store):
    assert store.fork_app("nope") is None


def test_fork_with_new_name_renames_copy(configured_store):
    """复刻改名（对标 Budibase）：副本的 productName + product_name 元数据都跟着改，
    源应用不受影响。"""
    a = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(a, new_name="奶茶版")
    rec = store.get_app(fk)
    assert rec["product_name"] == "奶茶版"
    assert rec["model_json"]["appbundle"]["appIdentity"]["productName"] == "奶茶版"
    assert rec["parent_id"] == a and rec["root_id"] == fk, "仍是新血缘、parent 指源"
    assert store.get_app(a)["product_name"] == "咖营通", "源应用名不受影响"


def test_fork_default_does_not_inherit_source_session(configured_store):
    """默认不继承源会话——避免点开副本却进了源应用的会话。"""
    a = store.save_app(_model("咖营通"), session_id="s1")
    fk = store.fork_app(a)  # 不传 session_id
    assert store.get_app(fk)["session_id"] is None


def test_dedup_key_is_idempotent(configured_store):
    model = _model("咖营通")
    sig = store.model_signature("s1", model)
    id1 = store.save_app(model, session_id="s1", dedup_key=sig)
    id2 = store.save_app(model, session_id="s1", dedup_key=sig)
    assert id1 == id2, "同 dedup_key → 幂等更新同一条"
    assert len(store.list_apps()) == 1, "同会话反复落同一模型不堆重复"


def test_dedup_key_new_record_when_model_changes(configured_store):
    id1 = store.save_app(_model("咖营通", entities=2), session_id="s1",
                         dedup_key=store.model_signature("s1", _model("咖营通", entities=2)))
    id2 = store.save_app(_model("咖营通", entities=5), session_id="s1",
                         dedup_key=store.model_signature("s1", _model("咖营通", entities=5)))
    assert id1 != id2, "模型内容变了 → 签名变 → 落新记录"
    assert len(store.list_apps()) == 2


def test_delete_removes_record(configured_store):
    a = store.save_app(_model("咖营通"), session_id="s1")
    store.save_app(_model("宠医云"), session_id="s2")
    assert store.delete_app(a) is True
    assert store.get_app(a) is None
    assert len(store.list_apps()) == 1, "删掉一条后列表只剩另一条"


def test_delete_missing_returns_false(configured_store):
    assert store.delete_app("does-not-exist") is False


def test_export_all_returns_full_records(configured_store):
    store.save_app(_model("咖营通"))
    store.save_app(_model("宠医云"))
    dump = store.export_all()
    assert len(dump) == 2
    assert all("model_json" in r for r in dump), "导出是完整记录（可迁移备份）"


def test_no_db_url_falls_back_to_jsonfile(tmp_path, monkeypatch):
    """没配连接串时后端就是 JSON 文件——'有 DB 用 DB、没 DB 兜底'。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
    store.reset_backend_cache()


class _FakeNullPool:
    """占位——只需身份可比对，_sql_engine_config 不实例化它。"""


def test_postgres_engine_config_follows_neon_best_practices():
    """Neon（-pooler = PgBouncer transaction 模式）最佳实践锁死：
    psycopg 关预处理语句 + NullPool（不双层池）+ 连接超时。"""
    connect_args, engine_kwargs = store._sql_engine_config(
        "postgresql+psycopg://u:p@ep-x-pooler.neon.tech/db?sslmode=require", _FakeNullPool
    )
    # ① 关掉客户端预处理语句（否则 transaction 池并发抛 prepared statement 错）
    assert connect_args["prepare_threshold"] is None
    # ② 用 NullPool，不让 SQLAlchemy 再套一层池跟 PgBouncer 打架
    assert engine_kwargs["poolclass"] is _FakeNullPool
    # ③ 连不上快速失败
    assert connect_args["connect_timeout"] == 4
    # postgres 不该用 pre_ping（NullPool 无长连可 ping）
    assert "pool_pre_ping" not in engine_kwargs


def test_sqlite_engine_config_no_pgbouncer_tweaks():
    """SQLite 本地库：不该带 postgres 专属的 NullPool/prepare_threshold。"""
    connect_args, engine_kwargs = store._sql_engine_config("sqlite:///x.db", _FakeNullPool)
    assert "prepare_threshold" not in connect_args
    assert "poolclass" not in engine_kwargs
    assert engine_kwargs.get("pool_pre_ping") is True


def test_bad_db_url_fails_open_to_jsonfile(tmp_path, monkeypatch):
    """DB 初始化失败（无法解析的连接串）时 fail-open 落回 JSON 文件，不崩。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", "not-a-valid-url://xxx")
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
    # 仍能正常存取（走了兜底）
    app_id = store.save_app(_model("咖营通"))
    assert store.get_app(app_id) is not None
    store.reset_backend_cache()


# ── Neon SQL over HTTP 后端（受限网络第二选择）────────────────────────
# 真实往返需要出网，CI 里跑不了；这里锁的是不依赖网络的纯逻辑：端点派生
# 与类型归一化。二者错了，HTTP 后端会静默给出与另两个后端不一致的数据。

def test_neon_http_endpoint_derived_only_for_neon_hosts():
    """只有 *.neon.tech 才派生 HTTP 端点——别的 Postgres 没这个口，
    盲拼地址只会换来一串困惑的连接错误。"""
    assert store.neon_http_endpoint(
        "postgresql://u:p@ep-x-pooler.c-4.us-east-2.aws.neon.tech/db?sslmode=require"
    ) == "https://ep-x-pooler.c-4.us-east-2.aws.neon.tech/sql"
    # 驱动前缀（psycopg）也要能解析
    assert store.neon_http_endpoint("postgresql+psycopg://u:p@ep-y.neon.tech/db") == (
        "https://ep-y.neon.tech/sql"
    )
    # 非 Neon / 本地库 / 垃圾串 → None（不派生）
    assert store.neon_http_endpoint("postgresql://u:p@my-rds.amazonaws.com/db") is None
    assert store.neon_http_endpoint("sqlite:///data/apps.db") is None
    assert store.neon_http_endpoint("not-a-url") is None


def test_neon_row_normalization_matches_other_backends():
    """HTTP 端点的 timestamptz 是 '2026-07-26 12:34:56+00' 这种带空格写法，
    另外两个后端产出的是 isoformat()——不归一化的话，画廊排序/相对时间
    会因后端而异。"""
    row = store._neon_normalize_row({
        "id": "a1",
        "created_at": "2026-07-26 12:34:56+00",
        "model_json": {"appbundle": {}},
        "gate_passed": True,
        "version": 2,
    })
    assert row["created_at"] == "2026-07-26T12:34:56+00:00"
    # 已是原生类型的字段不该被动
    assert row["gate_passed"] is True and row["version"] == 2
    assert isinstance(row["model_json"], dict)


def test_neon_row_normalization_tolerates_bad_shapes():
    """坏时间戳原样留着（不编造时间）；model_json 缺失/非 dict 归一成 {}。"""
    assert store._neon_normalize_row({"created_at": "garbage"})["created_at"] == "garbage"
    assert store._neon_normalize_row({"model_json": None})["model_json"] == {}
    assert store._neon_normalize_row({})["model_json"] == {}


# ── HTTP 错误的结构化解析（2026-07-27）──────────────────────────────
# 此前只截响应体前 200 字符：唯一键冲突这种只想知道 code/constraint 的场景，
# 截断还可能正好切掉关键部分。现在按官方 JS 驱动（@neondatabase/serverless
# httpQuery.ts 的 errorFields）同款把字段提出来，另加官方没读但端点确实返回
# 的 neon:retryable。下面的响应形状取自对真库触发真实错误的实测记录。


class _FakeResp:
    def __init__(self, status: int, payload=None, text: str = ""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def test_neon_error_extracts_structured_fields():
    """唯一键冲突：code/constraint/detail 必须能直接取到，并出现在摘要里。"""
    err = store._neon_http_error(_FakeResp(400, {
        "message": 'duplicate key value violates unique constraint "generated_app_pkey"',
        "code": "23505",
        "constraint": "generated_app_pkey",
        "detail": "Key (id)=(abc) already exists.",
        "severity": "ERROR",
        "neon:retryable": False,
    }))
    assert isinstance(err, store.NeonHttpError)
    assert err.code == "23505"
    assert err.retryable is False
    assert err.fields["constraint"] == "generated_app_pkey"
    text = str(err)
    assert "code=23505" in text and "constraint=generated_app_pkey" in text


def test_neon_error_falls_back_to_text_for_non_json():
    """网关 5xx 常返回 HTML——解析不了就回落文本截断，绝不因此再抛一个异常。"""
    err = store._neon_http_error(_FakeResp(502, None, "<html>Bad Gateway</html>"))
    assert isinstance(err, store.NeonHttpError)
    assert err.status == 502
    assert "Bad Gateway" in str(err)
    assert err.code is None and err.retryable is None


def test_neon_error_fields_cover_official_driver_list():
    """字段清单与官方 errorFields 对齐（16 项）+ neon:retryable。
    官方少了 retryable 这项，但端点真的会返回，实测确认。"""
    official = {
        "severity", "code", "detail", "hint", "position", "internalPosition",
        "internalQuery", "where", "schema", "table", "column", "dataType",
        "constraint", "file", "line", "routine",
    }
    assert official <= set(store._NEON_ERROR_FIELDS)
    assert "neon:retryable" in store._NEON_ERROR_FIELDS
