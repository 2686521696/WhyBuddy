"""把话题档写进 Neon（SQL over HTTP），与 app_store 的 NeonHttpAppStore 同款接法。

凭据只走 Neon-Connection-String 请求头，不进 URL、不进日志。
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

import httpx

REPO = Path(__file__).resolve().parents[2]

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


def database_url() -> str:
    """从环境或 .env 取连接串。"""
    url = os.environ.get("APP_STORE_DATABASE_URL", "").strip()
    if url:
        return url
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("APP_STORE_DATABASE_URL=") and not line.startswith("#"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("找不到 APP_STORE_DATABASE_URL")


def endpoint_for(url: str) -> str:
    host = re.sub(r"^postgresql(\+\w+)?://", "", url).split("@")[-1].split("/")[0].split("?")[0]
    if not host.lower().endswith(".neon.tech"):
        raise SystemExit(f"不是 Neon 主机，没有 SQL-over-HTTP 端点：{host}")
    return f"https://{host}/sql"


class Neon:
    def __init__(self) -> None:
        url = database_url()
        self._client = httpx.Client(
            timeout=60.0,
            headers={"Neon-Connection-String": url, "Content-Type": "application/json"},
        )
        self._endpoint = endpoint_for(url)

    def q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        resp = self._client.post(self._endpoint, json={"query": sql, "params": params or []})
        if resp.status_code >= 400:
            raise RuntimeError(f"neon http {resp.status_code}: {resp.text[:400]}")
        return resp.json().get("rows") or []

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
        # ⚠ HTTP 端点对 bigint 返回字符串（见 app_store._neon_normalize_row 的告
        # 诫），count(*) 必须显式 ::int，否则拿到的是 "23" 而不是 23
        return int(self.q("select count(*)::int as n from forum_topic")[0]["n"])


def main() -> None:
    src = Path(sys.argv[1])
    db = Neon()
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
