"""把话题档写进远端库。

## 2026-08-05：从 Neon 改成走应用自己那条通道

原来这里自己拼 Neon 的 SQL-over-HTTP 端点，`endpoint_for` 还硬卡
`*.neon.tech`。Neon 因为流量配额打满停用之后，这条链整个断了——表也
跟着没了。

现在不再自己接线，直接复用 `services.app_store` 里的连接选择：网关
（APP_STORE_HTTP_API_URL）优先，其次 TCP 连接串。好处不只是少写代码：
占位符方言转换、鉴权头、行数上限、错误映射都在那一处，网关将来改了
这个脚本不用跟着改——本项目已经在"同一份 SQL 抄两遍"上吃过亏。

凭据只走请求头，不进 URL、不进日志。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# 列序绑定 INSERT 的占位符序，改字段只改这一处
COLUMNS = (
    "id", "topic_id", "url", "title", "category_id", "category_name", "tags",
    "author_username", "author_name", "created_at", "last_posted_at",
    "posts_count", "reply_count", "views", "like_count", "participant_count",
    "word_count", "has_accepted_answer", "body_text", "body_html",
    "images", "links", "replies", "fetched_at",
)
JSONB_COLS = {"tags", "images", "links", "replies"}
INT_COLS = {"topic_id", "category_id", "posts_count", "reply_count", "views",
            "like_count", "participant_count", "word_count"}

DDL = """
create table if not exists forum_topic (
    id                  varchar(64) primary key,
    topic_id            integer not null,
    url                 text,
    title               text,
    category_id         integer,
    category_name       varchar(120),
    tags                jsonb,
    author_username     varchar(120),
    author_name         varchar(120),
    created_at          timestamptz,
    last_posted_at      timestamptz,
    posts_count         integer,
    reply_count         integer,
    views               integer,
    like_count          integer,
    participant_count   integer,
    word_count          integer,
    has_accepted_answer boolean,
    body_text           text,
    body_html           text,
    images              jsonb,
    links               jsonb,
    replies             jsonb,
    fetched_at          timestamptz
)
"""


def _load_env() -> None:
    """脚本单独跑时不经过 app 启动，得自己把 .env 读进来。"""
    try:
        from dotenv import load_dotenv

        load_dotenv(REPO / ".env")
    except ImportError:  # 没装 python-dotenv 就只认真实环境变量
        pass


class Store:
    """话题档的库句柄。通道由 app_store 统一决定，这里不自己判断。"""

    def __init__(self) -> None:
        _load_env()
        from config.settings import settings
        from services.app_store import HttpSqlGateway, http_api_credentials

        api_url, api_key = http_api_credentials()
        if api_url and api_key:
            self._gateway = HttpSqlGateway(api_url, api_key, timeout_s=60.0)
            self._engine = None
            print(f"通道：HTTPS SQL 网关 {self._gateway.endpoint}")
            return

        url = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
        if not url:
            raise SystemExit(
                "既没配 APP_STORE_HTTP_API_URL/_KEY，也没配 APP_STORE_DATABASE_URL"
            )
        from sqlalchemy import create_engine
        from sqlalchemy.pool import NullPool

        from services.app_store import _sql_engine_config

        connect_args, kwargs = _sql_engine_config(url, NullPool)
        self._gateway = None
        self._engine = create_engine(url, connect_args=connect_args, **kwargs)
        print("通道：TCP 直连")

    def q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        if self._gateway is not None:
            # `$n` → `%s` 的方言转换在网关那一层，这里的 SQL 保持 Postgres 写法
            return self._gateway.query(sql, params)
        from sqlalchemy import text

        # SQLAlchemy 走具名参数，把 $n 换成 :pn
        bound = sql
        for i in range(len(params or []), 0, -1):
            bound = bound.replace(f"${i}", f":p{i}")
        binds = {f"p{i + 1}": v for i, v in enumerate(params or [])}
        with self._engine.begin() as conn:
            result = conn.execute(text(bound), binds)
            # DDL / INSERT 没有结果集，取 .mappings() 会抛 ResourceClosedError
            if not result.returns_rows:
                return []
            return [dict(r) for r in result.mappings().all()]

    def ensure_table(self) -> None:
        self.q(DDL)
        for col in ("topic_id", "category_id", "created_at", "views"):
            self.q(f"create index if not exists ix_forum_topic_{col} on forum_topic ({col})")

    def upsert(self, rec: dict[str, Any]) -> None:
        params: list[Any] = []
        for col in COLUMNS:
            val = rec.get(col)
            if col in JSONB_COLS:
                val = json.dumps(val if val is not None else [], ensure_ascii=False)
            elif col in INT_COLS:
                val = None if val is None else int(val)
            elif col == "has_accepted_answer":
                val = bool(val)
            params.append(val)
        placeholders = ", ".join(
            f"${i + 1}::jsonb" if c in JSONB_COLS else f"${i + 1}"
            for i, c in enumerate(COLUMNS)
        )
        updates = ", ".join(f"{c} = excluded.{c}" for c in COLUMNS if c != "id")
        self.q(
            f"insert into forum_topic ({', '.join(COLUMNS)}) values ({placeholders}) "
            f"on conflict (id) do update set {updates}",
            params,
        )

    def count(self) -> int:
        # ⚠ count(*) 是 int8。Neon 的 HTTP 端点对 bigint 返回**字符串**，新网关
        # 走 psycopg 返回真 int——两边行为不一样。显式 ::int 之后两边都对，
        # 外加一层 int() 兜底，不赌任何一边。
        return int(self.q("select count(*)::int as n from forum_topic")[0]["n"])


def main() -> None:
    src = Path(sys.argv[1])
    db = Store()
    db.ensure_table()
    print(f"表就绪，当前 {db.count()} 条")

    ok = fail = 0
    skipped = 0
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            # 抓取还在往同一个文件追加时，最后一行可能只写了一半。跳过而不是
            # 崩掉——这个脚本要能对着一个正在增长的 JSONL 跑，随时落库兜底。
            skipped += 1
            continue
        try:
            db.upsert(rec)
            ok += 1
        except Exception as exc:  # noqa: BLE001 — 单条失败不中断整批
            fail += 1
            print(f"  ✗ {rec.get('id')}: {exc}", flush=True)
    tail = f"，跳过半行 {skipped}" if skipped else ""
    print(f"写入完成：成功 {ok}，失败 {fail}{tail}；表内共 {db.count()} 条")


if __name__ == "__main__":
    main()
