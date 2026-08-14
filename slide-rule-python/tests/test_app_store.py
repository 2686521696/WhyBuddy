"""生成应用存储 / App Store（2026-07-24）的单测覆盖。

同一套 SQLAlchemy 代码在 SQLite（本地/CI，离线）和 Postgres（生产 Neon）上
跑，所以这里用 SQLite 内存/临时库把落库逻辑全测通，等于间接验证了生产
Postgres 路径；再单独测 JSON 文件兜底。两条后端跑同一批断言（参数化），
证明"有 DB 用 DB、没 DB 回退文件"两条路行为一致。
"""

import json
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
        # 2026-07-28 起降级链多了一级本地 SQLite（远端 → 本地库 → JSON）。
        # 要测 JSON 兜底本身，得把中间那级关掉，否则永远走不到最后一档。
        monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    else:
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'apps.db'}")
        monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
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


def test_no_db_url_falls_back_to_local_sqlite(tmp_path, monkeypatch):
    """没配远端连接串时落**本地 SQLite**，不是 JSON（2026-07-28 起）。

    优先级是 远端 → 本地库 → JSON。没有远端不代表就该退到最弱的那一档：
    SQLite 能查能索引、写入是事务性的，JSON 是整文件读改写。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "SqlAppStore"
    app_id = store.save_app(_model("咖营通"))
    assert store.get_app(app_id) is not None
    assert (tmp_path / "local.db").exists()
    store.reset_backend_cache()


def test_local_sqlite_disabled_falls_back_to_jsonfile(tmp_path, monkeypatch):
    """本地库置空 = 跳过这一级，直接 JSON。只读文件系统/容器里用得上。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
    store.reset_backend_cache()


def test_local_sqlite_config_is_part_of_backend_signature(tmp_path, monkeypatch):
    """改本地库配置要能触发重建——否则改了配置像没生效（拿的是旧单例）。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'a.db'}"
    )
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "SqlAppStore"
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    # 不调 reset_backend_cache——签名变了就该自己重建
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


def test_bad_db_url_fails_open_to_local_sqlite(tmp_path, monkeypatch):
    """远端初始化失败（无法解析的连接串）时降到本地 SQLite，不崩。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", "not-a-valid-url://xxx")
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "SqlAppStore"
    app_id = store.save_app(_model("咖营通"))
    assert store.get_app(app_id) is not None
    store.reset_backend_cache()


def test_bad_db_url_and_no_local_falls_open_to_jsonfile(tmp_path, monkeypatch):
    """远端挂 + 本地库禁用 → 最后一档 JSON。任何一级失败都不抛给调用方。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", "not-a-valid-url://xxx")
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    assert type(store.get_backend()).__name__ == "JsonFileAppStore"
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


def test_http_api_query_endpoint_normalizes_base_urls():
    assert store.http_api_query_endpoint("https://miantuan.ai/db-api") == (
        "https://miantuan.ai/db-api/v1/query"
    )
    assert store.http_api_query_endpoint("https://miantuan.ai/db-api/") == (
        "https://miantuan.ai/db-api/v1/query"
    )
    assert store.http_api_query_endpoint("https://miantuan.ai/db-api/v1/query") == (
        "https://miantuan.ai/db-api/v1/query"
    )
    assert store.http_api_query_endpoint("") is None


class _FakeHttpxResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"rows": []}
        self.text = json.dumps(self._payload, ensure_ascii=False)

    def json(self):
        return self._payload


class _FakeHttpxClient:
    instances = []

    def __init__(self, timeout=None, headers=None):
        self.timeout = timeout
        self.headers = headers or {}
        self.posts = []
        self.__class__.instances.append(self)

    def post(self, endpoint, json=None):
        self.posts.append((endpoint, json))
        return _FakeHttpxResp()


def test_http_api_backend_uses_sql_endpoint_and_bearer_token(monkeypatch):
    import httpx

    _FakeHttpxClient.instances.clear()
    monkeypatch.setattr(httpx, "Client", _FakeHttpxClient)

    backend = store.HttpApiAppStore("https://miantuan.ai/db-api", "secret-token")
    client = _FakeHttpxClient.instances[-1]
    assert client.headers["Authorization"] == "Bearer secret-token"
    assert client.posts[0][0] == "https://miantuan.ai/db-api/v1/query"
    assert client.posts[0][1]["sql"].lstrip().startswith("create table if not exists generated_app")
    assert client.posts[0][1]["timeout_ms"] == store._PG_STATEMENT_TIMEOUT_MS

    backend._q("select 1", [])
    assert client.posts[-1][1]["sql"] == "select 1"
    assert client.posts[-1][1]["params"] == []
    assert client.posts[-1][1]["timeout_ms"] == store._PG_STATEMENT_TIMEOUT_MS


def test_http_api_base_url_takes_priority_when_configured(tmp_path, monkeypatch):
    chosen = []

    class FakeHttpApi:
        def __init__(self, api_base_url, api_key):
            chosen.append((api_base_url, api_key))

    monkeypatch.setattr(store, "HttpApiAppStore", FakeHttpApi)
    monkeypatch.setattr(store.settings, "APP_STORE_HTTP_API_URL", "https://miantuan.ai/db-api")
    monkeypatch.setattr(store.settings, "APP_STORE_HTTP_API_KEY", "secret-token")
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()

    backend = store.get_backend()
    assert type(backend).__name__ == "FakeHttpApi"
    assert chosen == [("https://miantuan.ai/db-api", "secret-token")]
    store.reset_backend_cache()


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


# ────────────────────── Neon 事故（2026-08-02）的三层守卫 ──────────────────────
#
# 事故形状：切回 Neon 后 Python 单 worker 被堵死，/api/health 一起超时。
# 三个原因叠加，各配一条守卫：
#   ① fail-open 只兜异常、不兜"卡住"        → 服务端超时 + 墙钟预算
#   ② 初始化每一步各开一条连接              → 合并成一次握手
#   ③ async 路由里同步调库，单 worker       → to_thread（在路由那侧断言）


def test_postgres_config_sets_server_side_timeouts():
    """**没有语句级超时 = 那套四级 fail-open 是摆设。**

    降级全靠 except 触发，而一条永远不返回的查询什么都不抛。connect_timeout
    只管握手，连上之后想跑多久跑多久——线上就是这么被堵死的。
    """
    connect_args, _ = store._sql_engine_config(
        "postgresql+psycopg://u:p@ep-x-pooler.neon.tech/db?sslmode=require", _FakeNullPool
    )
    opts = connect_args.get("options") or ""
    assert f"statement_timeout={store._PG_STATEMENT_TIMEOUT_MS}" in opts
    # 等锁超时是给 DDL 的：ALTER TABLE 要 ACCESS EXCLUSIVE，撞上任何一个正在读
    # 这张表的连接就会无限等，那正是把单 worker 堵死的形状。
    assert f"lock_timeout={store._PG_LOCK_TIMEOUT_MS}" in opts
    assert f"idle_in_transaction_session_timeout={store._PG_IDLE_TX_TIMEOUT_MS}" in opts


def test_connection_string_options_are_never_clobbered():
    """连接串自带 options 时不许覆盖——Neon 用 `options=endpoint%3D...` 做端点
    路由，盖掉就连错库了。宁可这一条没有服务端超时（还有墙钟预算兜底），也不能
    改坏路由。"""
    connect_args, _ = store._sql_engine_config(
        "postgresql+psycopg://u:p@ep-x.neon.tech/db?options=endpoint%3Dep-x", _FakeNullPool
    )
    assert "options" not in connect_args


def test_sqlite_gets_no_postgres_timeouts():
    """SQLite 不认 postgres 的 options，塞进去会连不上。"""
    connect_args, _ = store._sql_engine_config("sqlite:///x.db", _FakeNullPool)
    assert "options" not in connect_args


def test_slow_remote_init_degrades_instead_of_hanging(tmp_path, monkeypatch):
    """**初始化卡住时必须降级，不能吊死。**

    这是事故的核心：存储层承诺"绝不拖垮主链路"，但那个承诺只覆盖了"失败"，
    没覆盖"不返回"。这条用例模拟一个永远不返回的初始化，断言 get_backend 在
    预算内放弃并落到本地 SQLite——而不是一直等下去。
    """
    started = __import__("threading").Event()
    real_factory = store._sqlalchemy_backend

    # **只拦远端那一个 URL**：_local_sqlite_backend 走的是同一个工厂函数，
    # 一刀切地替换会让降级目标也卡住——本地兜底那一步没有预算保护，于是整条
    # 用例挂死。第一版就是这么写的，被自己挂住了。
    def blocks_only_the_remote(url):
        if "invalid.internal" in url:
            started.set()
            __import__("threading").Event().wait()  # 永远不返回
        return real_factory(url)

    monkeypatch.setattr(store, "_sqlalchemy_backend", blocks_only_the_remote)
    monkeypatch.setattr(store, "_SQL_INIT_BUDGET_S", 0.5)
    # 刻意用**非 Neon** 主机：*.neon.tech 会让降级链先去试 SQL-over-HTTP，
    # 那是一次真实网络请求，会把这条用例的耗时变成网络超时而不是预算。
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL",
        "postgresql://u:p@db.invalid.internal:5432/x?sslmode=require",
    )
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(
        store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'local.db'}"
    )
    store.reset_backend_cache()

    import time as _t

    t0 = _t.time()
    backend = store.get_backend()
    elapsed = _t.time() - t0

    assert started.is_set(), "初始化根本没被调用，这条用例是空过的"
    assert elapsed < 5, f"没有在预算内放弃，等了 {elapsed:.1f}s"
    assert type(backend).__name__ == "SqlAppStore", "应当降级到本地 SQLite"
    store.reset_backend_cache()


def test_remote_init_opens_one_connection_not_three(monkeypatch):
    """建表 + 查列 + 补列**共用一条连接**。

    NullPool 下每次 engine 级操作都是新建连接。平时无所谓，但线上撞到的正是
    "每次连接都慢"（Neon pooler 多地址 × connect_timeout=4s），连接次数在这条
    路径上是直接乘上去的成本。这条按源码钉住，因为真连库测不了。
    """
    import inspect as _inspect

    src = _inspect.getsource(store._sqlalchemy_backend)
    body = src[src.index("engine = create_engine"):src.index("class SqlAppStore")]
    # 只允许出现一次 engine 级的连接获取
    assert body.count("engine.begin()") == 1, "初始化里不止一次 engine.begin()"
    assert "create_all(_init_conn)" in body, "create_all 没有复用那条连接"
    assert "_sql_inspect(_init_conn)" in body, "查列没有复用那条连接"
    assert "_sql_inspect(engine)" not in body, "查列又开了一条新连接"


def test_hung_init_thread_never_blocks_process_exit():
    """**卡住的初始化线程必须是 daemon。**

    第一版用 ThreadPoolExecutor + future.result(timeout=…)，被这条抓了：它的
    工作线程是非守护线程，而 concurrent.futures 注册了 atexit 钩子去 join 它们
    ——卡住的线程会挡住**进程退出**。那等于把"启动卡死"换成"关停卡死"，容器停
    不下来，部署时更难受。

    这条不是风格检查：非 daemon 会让整个测试进程在收集完后挂死（实测撞到过）。
    """
    import threading

    started = threading.Event()
    release = threading.Event()

    def blocks(_url):
        started.set()
        release.wait(timeout=30)
        raise RuntimeError("late")

    orig = store._sqlalchemy_backend
    orig_budget = store._SQL_INIT_BUDGET_S
    store._sqlalchemy_backend = blocks
    store._SQL_INIT_BUDGET_S = 0.3
    try:
        try:
            store._sqlalchemy_backend_within_budget("postgresql://u:p@h/db")
        except TimeoutError:
            pass
        else:
            raise AssertionError("超预算时应当抛 TimeoutError")
        assert started.is_set(), "初始化没被调用，用例空过"
        stuck = [t for t in threading.enumerate() if t.name == "appstore-init"]
        assert stuck, "没找到那个卡住的线程，用例空过"
        assert all(t.daemon for t in stuck), "初始化线程不是 daemon，会挡住进程退出"
    finally:
        release.set()
        store._sqlalchemy_backend = orig
        store._SQL_INIT_BUDGET_S = orig_budget


# ────────────────────── 显式指定 Neon HTTP 通道 ──────────────────────
#
# 事故后加的口子：TCP "能连上、只是慢得要死"时，兜底逻辑永远轮不到 HTTP
# （它只在 TCP 抛异常时才触发）。这一组盯这个开关的边界。


def test_http_channel_is_opt_in(monkeypatch):
    """默认不开——行为必须与加这个开关之前逐字节一致。"""
    monkeypatch.delenv(store._PREFER_HTTP_ENV, raising=False)
    assert store.prefer_neon_http() is False
    for truthy in ("1", "true", "YES", "on"):
        monkeypatch.setenv(store._PREFER_HTTP_ENV, truthy)
        assert store.prefer_neon_http() is True, truthy
    for falsy in ("0", "false", "no", ""):
        monkeypatch.setenv(store._PREFER_HTTP_ENV, falsy)
        assert store.prefer_neon_http() is False, falsy


def test_http_preference_skips_the_tcp_path_entirely(monkeypatch, tmp_path):
    """开了就**根本不碰 TCP**。

    这是这个开关存在的全部意义：TCP 那一段（探针 + pooler 多地址逐个试 ×
    connect_timeout 4s + 建表补列）正是把线上堵死的地方，指定 HTTP 就不该再
    走进去一步。
    """
    tcp_calls = []
    monkeypatch.setattr(
        store, "_sqlalchemy_backend",
        lambda url: tcp_calls.append(url) or (_ for _ in ()).throw(AssertionError("不该走 TCP")),
    )
    made = []

    class FakeHttp:
        def __init__(self, url, endpoint):
            made.append(endpoint)

    monkeypatch.setattr(store, "NeonHttpAppStore", FakeHttp)
    monkeypatch.setenv(store._PREFER_HTTP_ENV, "1")
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL",
        "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
    )
    store.reset_backend_cache()
    try:
        backend = store.get_backend()
        assert isinstance(backend, FakeHttp), type(backend).__name__
        assert made, "没有真的去建 HTTP 后端，用例空过"
        assert tcp_calls == [], "开了 HTTP 偏好却仍然走了 TCP"
    finally:
        store.reset_backend_cache()


def test_http_preference_still_degrades_when_http_is_down(monkeypatch, tmp_path):
    """指定了 HTTP 也可能连不上——那时候要继续往下降级，不能把人卡在这一级。"""
    class Broken:
        def __init__(self, url, endpoint):
            raise RuntimeError("http down")

    monkeypatch.setattr(store, "NeonHttpAppStore", Broken)
    monkeypatch.setattr(store, "_sqlalchemy_backend", lambda url: (_ for _ in ()).throw(OSError("tcp down")))
    monkeypatch.setenv(store._PREFER_HTTP_ENV, "1")
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL",
        "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
    )
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path/'l.db'}")
    store.reset_backend_cache()
    try:
        assert type(store.get_backend()).__name__ in ("SqlAppStore", "JsonFileAppStore")
    finally:
        store.reset_backend_cache()


def test_http_preference_ignored_for_non_neon_hosts(monkeypatch, tmp_path):
    """自建 PG / RDS 没有这个 HTTP 端点，盲目拼一个只会得到困惑的连接错误。
    这种情况忽略偏好、照常走 TCP。"""
    tcp = []
    monkeypatch.setattr(
        store, "_sqlalchemy_backend",
        lambda url: tcp.append(url) or (_ for _ in ()).throw(OSError("tcp down")),
    )
    monkeypatch.setenv(store._PREFER_HTTP_ENV, "1")
    monkeypatch.setattr(
        store.settings, "APP_STORE_DATABASE_URL", "postgresql://u:p@pg.internal:5432/x"
    )
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path/'l.db'}")
    store.reset_backend_cache()
    try:
        store.get_backend()
        assert tcp, "非 Neon 主机应当照常走 TCP"
    finally:
        store.reset_backend_cache()


# ── spec-first 整页 HTML（pages_json，2026-08-14）────────────────────────
#
# 应用中心的卡和只读预览靠这份 HTML 渲染真页面。这里钉四条语义：
# 落库回读、摘要不带本体只带 has_pages 一位、幂等更新"没传保留"、
# 新版本"不继承"（模型变了，旧 HTML 是照旧模型打的孔）。


def _pages(n: int = 2) -> dict:
    return {
        "version": "spec-first-pipeline-v1",
        "pages": {f"p{i}": f"<!DOCTYPE html><html><body>页 {i}</body></html>" for i in range(n)},
        "navItems": [{"pageId": f"p{i}", "label": f"页{i}"} for i in range(n)],
        "boundPages": n,
        "failedPages": {},
    }


def test_pages_json_roundtrip_and_summary_flag(configured_store):
    with_pages = store.save_app(_model("咖营通"), session_id="s1", pages_json=_pages())
    without = store.save_app(_model("宠医云"), session_id="s2")
    rec = store.get_app(with_pages)
    assert rec["pages_json"]["pages"]["p0"].startswith("<!DOCTYPE html>"), "完整记录回读到整页 HTML"
    assert rec["pages_json"]["boundPages"] == 2
    assert store.get_app(without)["pages_json"] is None, "没有页面就是 None，不造空 dict"
    summaries = {s["product_name"]: s for s in store.list_apps()}
    assert all("pages_json" not in s for s in summaries.values()), "摘要不带页面本体（大载荷）"
    assert summaries["咖营通"]["has_pages"] is True
    assert summaries["宠医云"]["has_pages"] is False


def test_pages_json_empty_pages_normalized_to_none(configured_store):
    """{"pages": {}} 这种"有壳没页"的载荷落成 None——前端拿到空壳会当成
    "有页面但空"，判定分支走错。判空在落库口做一次，三个后端同一行为。"""
    app_id = store.save_app(_model("咖营通"), pages_json={"pages": {}, "navItems": []})
    assert store.get_app(app_id)["pages_json"] is None


def test_pages_json_kept_on_dedup_resave_without_pages(configured_store):
    """幂等重存（同会话同模型，如重开夹具）不带页面是常态——纪律与
    preview_png_b64 同款：没传就保留既有那份，不把卡打回区块渲染。"""
    model = _model("咖营通")
    first = store.save_app_or_version(model, session_id="s1", pages_json=_pages())
    again = store.save_app_or_version(model, session_id="s1")  # 同模型 → dedup 幂等更新
    assert again == first
    assert store.get_app(first)["pages_json"]["pages"], "重存没传页面，既有那份还在"


def test_pages_json_not_inherited_by_new_version(configured_store):
    """模型变了才会开新版本，上一版的 HTML 是照旧模型打的孔——挂过去就是
    「东西看着在，其实是旧的」。新版本自己没画页面就落 None。"""
    first = store.save_app_or_version(_model("咖营通"), session_id="s1", pages_json=_pages())
    second = store.save_app_or_version(_model("咖营通", entities=3), session_id="s1")
    assert second != first
    rec = store.get_app(second)
    assert rec["version"] == 2 and rec["pages_json"] is None
    # 这一版自己画了页面就用自己的
    third = store.save_app_or_version(_model("咖营通", entities=4), session_id="s1", pages_json=_pages(3))
    assert store.get_app(third)["pages_json"]["boundPages"] == 3


def test_pages_json_copied_on_fork(configured_store):
    """fork 的设计层逐字拷贝、模型没变，孔照样对得上——页面跟着走。"""
    src = store.save_app(_model("咖营通"), session_id="s1", pages_json=_pages())
    fk = store.fork_app(src, session_id="s9")
    assert store.get_app(fk)["pages_json"]["pages"] == _pages()["pages"]
