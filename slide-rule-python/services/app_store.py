"""
生成应用存储 / Generated App Store —— 把推演出来的应用「设计层」持久化，
作为后续「组建库」的原料仓库。

设计层 = 一个生成应用长啥样：五系统模型 + appbundle + 身份主题 +
FreeformInsight 内容 + 首页设计。这跟"用户在生成出来的 app 里录入的真实
业务行数据"（运行时实例层，现在在前端 localStorage）是两回事，本模块只管
设计层。

后端选择（照 vector_rag / image_client / e2b 同一套"有 key 就用、没 key
诚实兜底"纪律）：
- settings.APP_STORE_DATABASE_URL 填了任意 SQLAlchemy URL（Neon/自建
  Postgres 用 postgresql://…；也接受 sqlite:///data/apps.db 这种本地库）
  → 落库，可查询、可索引、可并发。
- 不填 → fail-open 回退本地 JSON 文件（APP_STORE_FILE），行为跟"没有 DB"
  时完全一致，不引入新的失败面。

两个后端跑同一套 SQLAlchemy/文件无关的接口，model_json 用可移植的 JSON 类型
（生产落 Postgres 的 JSONB、本地/测试落 SQLite 的 JSON，同一份代码）——所以
本地用 SQLite 就能把落库逻辑全测通，生产换 Neon 连接串零改动。

血缘：每条记录带 root_id（同一应用的所有版本/派生共享）、parent_id（上一版
/派生源）、version。save_app 存原始应用（root=自己·v1）；save_version 存同
一应用的新一版；fork_app 从现有应用分出一条新血缘（新 root·v1·parent 指向源）。
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from config.settings import settings


# ────────────────────────── 记录形状 / 元数据派生 ──────────────────────────

def _new_id() -> str:
    return uuid.uuid4().hex


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def derive_app_metadata(model: dict[str, Any]) -> dict[str, Any]:
    """从生成模型里抽出可查询的元数据（列表/筛选/血缘展示用），不塞进
    model_json 里，避免列表查询要反序列化整个大模型。"""
    appbundle = model.get("appbundle") or {}
    identity = appbundle.get("appIdentity") or {}
    gen_theme = identity.get("generatedTheme") if isinstance(identity.get("generatedTheme"), dict) else {}
    datamodel = model.get("datamodel") or {}
    pages = ((model.get("page") or {}).get("pages")) or []
    return {
        "product_name": str(identity.get("productName") or "")[:120],
        "theme_id": str(identity.get("theme") or "")[:64],
        "theme_label": str((gen_theme or {}).get("label") or "")[:120],
        "device": str(appbundle.get("preferredDevice") or "")[:16],
        "landing_page_ref": str(appbundle.get("landingPageRef") or "")[:64],
        "entity_count": len(datamodel.get("entities") or []),
        "page_count": len(pages),
    }


def _build_record(
    model: dict[str, Any],
    *,
    goal: str,
    session_id: Optional[str],
    gate_passed: bool,
    app_id: str,
    root_id: str,
    parent_id: Optional[str],
    version: int,
    dedup_key: Optional[str] = None,
) -> dict[str, Any]:
    meta = derive_app_metadata(model)
    return {
        "id": app_id,
        "root_id": root_id,
        "parent_id": parent_id,
        "version": version,
        "session_id": (session_id or "")[:64] or None,
        "goal": (goal or "")[:2000],
        "gate_passed": bool(gate_passed),
        "dedup_key": (dedup_key or None),
        "created_at": _now_iso(),
        "model_json": model,
        **meta,
    }


def model_signature(session_id: Optional[str], model: dict[str, Any]) -> str:
    """(会话 + 模型内容) 的稳定签名，用作落库幂等键——同一会话反复落同一个
    模型只更新一条记录，不堆重复；模型真变了（精修改了内容）签名就变、落新记录。"""
    import hashlib

    payload = json.dumps(model, ensure_ascii=False, sort_keys=True).encode("utf-8")
    digest = hashlib.sha1(payload).hexdigest()[:16]
    return f"{(session_id or '-')[:40]}:{digest}"


def _summary(record: dict[str, Any]) -> dict[str, Any]:
    """列表用摘要——去掉 model_json 这个大载荷，只留可查询/展示字段。"""
    return {k: v for k, v in record.items() if k != "model_json"}


# ────────────────────────── 后端接口 ──────────────────────────

class AppStoreBackend:
    def save(self, record: dict[str, Any]) -> str:  # pragma: no cover - interface
        raise NotImplementedError

    def get(self, app_id: str) -> Optional[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def list(self, *, limit: int, offset: int, latest_per_root: bool) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def versions(self, root_id: str) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    def delete(self, app_id: str) -> bool:  # pragma: no cover
        raise NotImplementedError

    def export_all(self) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError


# ────────────────────────── JSON 文件后端（兜底）──────────────────────────

class JsonFileAppStore(AppStoreBackend):
    """无 DB 时的兜底：一个 JSON 文件存全部记录（list of record dict）。
    线程锁 + 临时文件原子写，跟 persistence.py 同套纪律。离线可用。"""

    def __init__(self, store_file: Optional[str] = None) -> None:
        self._path = Path(store_file or settings.APP_STORE_FILE)
        self._lock = threading.RLock()

    def _read(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return []
        return data if isinstance(data, list) else []

    def _write(self, rows: list[dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)

    def save(self, record: dict[str, Any]) -> str:
        with self._lock:
            rows = self._read()
            rows = [r for r in rows if r.get("id") != record["id"]]  # upsert by id
            rows.append(record)
            self._write(rows)
        return record["id"]

    def get(self, app_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            for r in self._read():
                if r.get("id") == app_id:
                    return r
        return None

    def list(self, *, limit: int, offset: int, latest_per_root: bool) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._read()
        # 排序键 (version, created_at) 双降序——同 root 内"最新"以 version 为准
        # （created_at 在 dedup 幂等更新时可能被保留为旧值，单靠时间会把 v1
        # 排到 v2 前面，画廊展示旧版当最新）。
        rows.sort(key=lambda r: (r.get("version") or 0, r.get("created_at") or ""), reverse=True)
        if latest_per_root:
            seen: set[str] = set()
            latest: list[dict[str, Any]] = []
            # rows 已按 (version, 时间) 倒序 → 每个 root 第一次遇到就是最新版
            for r in rows:
                root = r.get("root_id") or r.get("id")
                if root in seen:
                    continue
                seen.add(root)
                latest.append(r)
            rows = latest
            # 卡片间仍按时间倒序展示（跨应用之间 version 没有可比性）
            rows.sort(key=lambda r: (r.get("created_at") or ""), reverse=True)
        return [_summary(r) for r in rows[offset:offset + limit]]

    def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            rows = [r for r in self._read() if r.get("session_id") == session_id]
        if not rows:
            return None
        rows.sort(key=lambda r: (r.get("version") or 0, r.get("created_at") or ""), reverse=True)
        return rows[0]

    def versions(self, root_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._read()
        chain = [r for r in rows if (r.get("root_id") or r.get("id")) == root_id]
        chain.sort(key=lambda r: r.get("version") or 0)
        return [_summary(r) for r in chain]

    def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:
        with self._lock:
            for r in self._read():
                if r.get("dedup_key") == dedup_key:
                    return r
        return None

    def delete(self, app_id: str) -> bool:
        with self._lock:
            rows = self._read()
            remaining = [r for r in rows if r.get("id") != app_id]
            if len(remaining) == len(rows):
                return False
            self._write(remaining)
        return True

    def export_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read()


# ────────────────────────── SQLAlchemy 后端（Postgres / SQLite）──────────────

def _sql_engine_config(url: str, null_pool: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """按后端方言产出 (connect_args, engine_kwargs)——Postgres 走 Neon 最佳
    实践，SQLite 走本地默认。抽成纯函数是为了能离线单测这套配置（不真连库）。

    Neon 最佳实践（连接串是 -pooler 端点 = PgBouncer transaction 模式）：
    - prepare_threshold=None：关掉 psycopg 客户端自动预处理语句。预处理语句活在
      session 层、跨事务不保留，transaction 池并发下会抛 "prepared statement
      does not exist"（psycopg#1151 / Crunchy Data / Neon 官方一致建议）。
    - poolclass=NullPool：用了 Neon 自带 PgBouncer 就别让 SQLAlchemy 再套一层
      连接池（两层打架 + 长连遇 scale-to-zero 挂起变陈旧）。NullPool 每次开新
      连接、用完即还给 PgBouncer，是 SQLAlchemy 官方对"外部池"的推荐。
    - connect_timeout=4：连不上快速失败 → fail-open 回退 JSON。
    """
    connect_args: dict[str, Any] = {}
    engine_kwargs: dict[str, Any] = {"future": True}
    if url.startswith("postgresql"):
        connect_args["connect_timeout"] = 4
        connect_args["prepare_threshold"] = None
        engine_kwargs["poolclass"] = null_pool
    else:
        # 本地 SQLite：无外部池，保留 pre_ping（文件库无 scale-to-zero 问题，无害）。
        engine_kwargs["pool_pre_ping"] = True
    return connect_args, engine_kwargs


def _sqlalchemy_backend(database_url: str) -> AppStoreBackend:
    """延迟导入 SQLAlchemy——只在真配了连接串时才 import，没配就完全不碰
    这条依赖（保持"无 DB 也能启动"）。"""
    from sqlalchemy import (
        Boolean, Column, DateTime, Integer, String, Text, create_engine, select, JSON,
    )
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.orm import Session, declarative_base
    from sqlalchemy.pool import NullPool

    # 生产 Neon/自建 PG 给的是 postgresql://…，SQLAlchemy + psycopg v3 需要
    # postgresql+psycopg:// 前缀；sqlite://… 原样。只补驱动前缀，不动别的。
    url = re.sub(r"^postgresql://", "postgresql+psycopg://", database_url)
    # 可移植 JSON：Postgres 落 JSONB（可 GIN 索引，组建库拆件用得上），
    # SQLite 落 JSON（本地/测试同一份代码）。
    json_type = JSON().with_variant(JSONB, "postgresql")

    # 用经典 Column 声明风格（不是 2.0 的 Mapped[] 注解）——ORM 模型定义在
    # 函数内（惰性 import：没配 DB 就完全不碰 SQLAlchemy），而 Mapped[] 注解
    # 解析要求类型名在模块级可见，函数内定义会解析失败。Column 风格不走注解
    # 解析，功能完全等价。
    Base = declarative_base()

    class GeneratedApp(Base):
        __tablename__ = "generated_app"
        id = Column(String(36), primary_key=True)
        root_id = Column(String(36), index=True)
        parent_id = Column(String(36), nullable=True)
        version = Column(Integer, default=1)
        session_id = Column(String(64), nullable=True)
        goal = Column(Text, default="")
        product_name = Column(String(120), default="", index=True)
        theme_id = Column(String(64), default="")
        theme_label = Column(String(120), default="")
        device = Column(String(16), default="")
        landing_page_ref = Column(String(64), default="")
        entity_count = Column(Integer, default=0)
        page_count = Column(Integer, default=0)
        gate_passed = Column(Boolean, default=False)
        dedup_key = Column(String(80), nullable=True, index=True)
        created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
        model_json = Column(json_type)

        def to_record(self) -> dict[str, Any]:
            return {
                "id": self.id, "root_id": self.root_id, "parent_id": self.parent_id,
                "version": self.version, "session_id": self.session_id, "goal": self.goal,
                "product_name": self.product_name, "theme_id": self.theme_id,
                "theme_label": self.theme_label, "device": self.device,
                "landing_page_ref": self.landing_page_ref, "entity_count": self.entity_count,
                "page_count": self.page_count, "gate_passed": self.gate_passed,
                "dedup_key": self.dedup_key,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "model_json": self.model_json,
            }

    # 连接超时收短 + 先做一次 2s TCP 探针：DB 不可达（网络封端口/连接串错/
    # 服务挂了）时快速失败 → get_backend 捕获后 fail-open 回退 JSON 文件，绝不
    # 让存储层把主链路吊死（真实撞到：沙盒封了 5432；且 Neon pooler 解析成多个
    # IP，psycopg 会逐个重试，不先探针的话超时叠加到十几秒）。sqlite 跳过探针。
    connect_args, engine_kwargs = _sql_engine_config(url, NullPool)
    if url.startswith("postgresql"):
        from sqlalchemy.engine.url import make_url

        parsed = make_url(url)
        if parsed.host:
            import socket

            # 连不上快速失败：只解析 + 试连第一个 IPv4 地址、硬超时 2s——不用
            # create_connection 的多地址轮询（Neon pooler 解析出多个 IP + IPv6，
            # 逐个 2s 会叠成十几秒；沙盒还不支持 IPv6 family）。探针只验端口可达，
            # 真正握手交给 SQLAlchemy。失败 → get_backend 捕获后 fail-open 回退
            # JSON 文件，绝不让存储层把主链路吊死。sqlite 跳过探针。
            infos = socket.getaddrinfo(parsed.host, parsed.port or 5432, socket.AF_INET, socket.SOCK_STREAM)
            if not infos:
                raise OSError(f"no IPv4 address for {parsed.host}")
            fam, typ, proto, _canon, sa = infos[0]
            probe = socket.socket(fam, typ, proto)
            probe.settimeout(2)
            try:
                probe.connect(sa)
            finally:
                probe.close()
    engine = create_engine(url, connect_args=connect_args, **engine_kwargs)
    Base.metadata.create_all(engine)

    class SqlAppStore(AppStoreBackend):
        def _row_from_record(self, record: dict[str, Any]) -> "GeneratedApp":
            ca = record.get("created_at")
            created = datetime.fromisoformat(ca) if isinstance(ca, str) else datetime.now(timezone.utc)
            return GeneratedApp(
                id=record["id"], root_id=record["root_id"], parent_id=record.get("parent_id"),
                version=int(record.get("version") or 1), session_id=record.get("session_id"),
                goal=record.get("goal") or "", product_name=record.get("product_name") or "",
                theme_id=record.get("theme_id") or "", theme_label=record.get("theme_label") or "",
                device=record.get("device") or "", landing_page_ref=record.get("landing_page_ref") or "",
                entity_count=int(record.get("entity_count") or 0), page_count=int(record.get("page_count") or 0),
                gate_passed=bool(record.get("gate_passed")), created_at=created,
                dedup_key=record.get("dedup_key"),
                model_json=record.get("model_json") or {},
            )

        def save(self, record: dict[str, Any]) -> str:
            with Session(engine) as s:
                existing = s.get(GeneratedApp, record["id"])
                if existing is not None:
                    s.delete(existing)
                    s.flush()
                s.add(self._row_from_record(record))
                s.commit()
            return record["id"]

        def get(self, app_id: str) -> Optional[dict[str, Any]]:
            with Session(engine) as s:
                row = s.get(GeneratedApp, app_id)
                return row.to_record() if row else None

        def list(self, *, limit: int, offset: int, latest_per_root: bool) -> list[dict[str, Any]]:
            with Session(engine) as s:
                # 同 root 内以 version 为准挑最新（created_at 在 dedup 幂等更新
                # 时可能保留旧值，见 JSON 后端同注释）。
                rows = list(s.scalars(select(GeneratedApp).order_by(
                    GeneratedApp.version.desc(), GeneratedApp.created_at.desc()
                )))
            if latest_per_root:
                seen: set[str] = set()
                latest: list[GeneratedApp] = []
                for r in rows:
                    if r.root_id in seen:
                        continue
                    seen.add(r.root_id)
                    latest.append(r)
                rows = latest
                rows.sort(key=lambda r: (r.created_at or ""), reverse=True)
            return [_summary(r.to_record()) for r in rows[offset:offset + limit]]

        def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
            with Session(engine) as s:
                row = s.scalars(
                    select(GeneratedApp).where(GeneratedApp.session_id == session_id)
                    .order_by(GeneratedApp.version.desc(), GeneratedApp.created_at.desc())
                    .limit(1)
                ).first()
                return row.to_record() if row else None

        def versions(self, root_id: str) -> list[dict[str, Any]]:
            with Session(engine) as s:
                rows = list(s.scalars(
                    select(GeneratedApp).where(GeneratedApp.root_id == root_id).order_by(GeneratedApp.version)
                ))
            return [_summary(r.to_record()) for r in rows]

        def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:
            with Session(engine) as s:
                row = s.scalars(
                    select(GeneratedApp).where(GeneratedApp.dedup_key == dedup_key).limit(1)
                ).first()
                return row.to_record() if row else None

        def delete(self, app_id: str) -> bool:
            with Session(engine) as s:
                row = s.get(GeneratedApp, app_id)
                if row is None:
                    return False
                s.delete(row)
                s.commit()
            return True

        def export_all(self) -> list[dict[str, Any]]:
            with Session(engine) as s:
                return [r.to_record() for r in s.scalars(select(GeneratedApp))]

    return SqlAppStore()


# ─────────────── Neon SQL over HTTP 后端（受限网络：只有 443 出得去）───────────────
#
# 为什么要这条路：Neon 的常规连接走 TCP 5432，但很多环境只放行 HTTPS——
# 无服务器/边缘运行时（Vercel Edge、Cloudflare Workers 那类）没有原始 TCP，
# 受限的容器/沙盒也常只开 443。Neon 官方为此提供 SQL-over-HTTP 端点
# （https://<endpoint-host>/sql，就是官方 JS serverless driver 用的那个），
# 我们这里用同一套协议做一个 Python 侧的薄适配：只依赖已有的 httpx，不引新依赖，
# 也不依赖任何第三方 Neon 库（社区 Python 封装还很小众，不值得押上生产）。
#
# 定位是「TCP 不通时的第二选择」，不是默认路径：能走 TCP 就走 TCP（连接复用、
# 延迟低、事务语义完整）。本后端每条语句一次 HTTPS 往返，够画廊这种低频读写用。

_NEON_HTTP_TIMEOUT_S = 15


def neon_http_endpoint(database_url: str) -> Optional[str]:
    """从 Postgres 连接串派生 Neon 的 SQL-over-HTTP 端点；非 Neon 主机返回 None。

    只对 *.neon.tech 生效——别的 Postgres（自建/RDS）没有这个 HTTP 端点，
    盲目拼一个地址去打只会得到一串困惑的连接错误。"""
    try:
        from sqlalchemy.engine.url import make_url

        host = make_url(re.sub(r"^postgresql\+\w+://", "postgresql://", database_url)).host
    except Exception:  # noqa: BLE001 — 连接串解析不了就不是我们能处理的
        return None
    if not host or not host.lower().endswith(".neon.tech"):
        return None
    return f"https://{host}/sql"


def _neon_normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    """把 HTTP 返回的一行归一化成跟另外两个后端完全一致的记录形状。

    实测（2026-07-26）HTTP 端点的类型映射已经很干净：varchar→str、integer→int、
    boolean→bool、jsonb→dict（自动解析）、NULL→None，都不用动。唯一要修的是
    timestamptz：它给 '2026-07-26 12:34:56+00' 这种带空格的写法，而另外两个后端
    产出的是 isoformat()——不统一的话，画廊排序/相对时间会在不同后端下不一致。

    ⚠ 加字段前必读（2026-07-27 对真库逐类型实测）：端点对 **int8/bigint 和
    numeric 返回的是字符串**，不是数字——`count(*)` 拿到的是 "5" 而非 5。
    本表当前所有数值列都是 integer(int4，返回 int)，且代码里没有 count(*)，
    所以现在是安全的；将来谁加 bigint/numeric 列或写聚合查询，必须在这里
    显式转型，否则 TCP 后端返回 int、HTTP 后端返回 str，同一份数据在两个
    后端下行为不一致（排序、比较、算术全会悄悄错）。
    官方 JS 驱动绕开这个坑的办法是设 `Neon-Raw-Text-Output: true` 全部取
    文本再自己解析——那是因为 JS 的 number 是双精度、int8 会丢精度；Python
    的 int 任意精度，没这个必要，让服务端解析反而省事。"""
    out = dict(row)
    ts = out.get("created_at")
    if isinstance(ts, str) and ts:
        try:
            out["created_at"] = datetime.fromisoformat(ts).isoformat()
        except ValueError:
            pass  # 解析不了就原样留着，不编造时间
    if not isinstance(out.get("model_json"), dict):
        out["model_json"] = out.get("model_json") or {}
    return out


# Postgres 错误的结构化字段。与官方 JS 驱动 @neondatabase/serverless 的
# httpQuery.ts `errorFields` 对齐（16 项），外加 `neon:retryable`——那一项
# 官方没读，但端点确实会返回（2026-07-27 对真库触发唯一键冲突/语法错误
# /列不存在实测确认），它直接回答"重试有没有意义"，比自己猜错误码靠谱。
_NEON_ERROR_FIELDS = (
    "severity", "code", "detail", "hint", "position", "internalPosition",
    "internalQuery", "where", "schema", "table", "column", "dataType",
    "constraint", "file", "line", "routine", "neon:retryable",
)


class NeonHttpError(RuntimeError):
    """带 Postgres 结构化错误字段的 HTTP 后端异常。

    此前只截响应体前 200 字符，诊断信息虽然在文本里但要靠人眼捞——唯一键
    冲突这种只想知道 `code=23505 constraint=xxx` 的场景，截断还可能正好把
    关键部分切掉。现在按官方驱动同款把字段提出来挂在异常上。

    注意：调用方（get_backend）仍然是 fail-open——出错就降级，不因为拿到了
    结构化字段就改成重试或抛给主链路。这里只提升可诊断性，不动控制流。"""

    def __init__(self, message: str, status: int, fields: Optional[dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.status = status
        self.fields = fields or {}

    @property
    def code(self) -> Optional[str]:
        return self.fields.get("code") or None

    @property
    def retryable(self) -> Optional[bool]:
        value = self.fields.get("neon:retryable")
        return value if isinstance(value, bool) else None


def _neon_http_error(resp: Any) -> NeonHttpError:
    """把一个失败响应解析成带结构化字段的异常；非 JSON 响应回落到文本截断。"""
    try:
        payload = resp.json()
        if not isinstance(payload, dict):
            raise ValueError("payload not an object")
    except Exception:  # noqa: BLE001 — 网关 5xx 常返回 HTML，回落文本即可
        return NeonHttpError(f"neon http {resp.status_code}: {resp.text[:200]}", resp.status_code)
    fields = {k: payload[k] for k in _NEON_ERROR_FIELDS if payload.get(k) not in (None, "")}
    message = str(payload.get("message") or "").strip() or resp.text[:200]
    # 摘要里带上最常用来定位的三项，日志一眼能看出是什么错
    summary = ", ".join(
        f"{k}={fields[k]}" for k in ("code", "constraint", "detail") if k in fields
    )
    text = f"neon http {resp.status_code}: {message}" + (f" ({summary})" if summary else "")
    return NeonHttpError(text, resp.status_code, fields)


# 记录字段顺序——INSERT 的列序与占位符序绑定在这里，改字段只改这一处
_NEON_COLUMNS = (
    "id", "root_id", "parent_id", "version", "session_id", "goal",
    "product_name", "theme_id", "theme_label", "device", "landing_page_ref",
    "entity_count", "page_count", "gate_passed", "dedup_key", "created_at", "model_json",
)


class NeonHttpAppStore(AppStoreBackend):
    """Neon SQL-over-HTTP 后端。与 SQLAlchemy 后端共用同一张 generated_app 表，
    行为（含 list 的「同 root 按 version 挑最新」语义）与另外两个后端严格对齐。"""

    def __init__(self, database_url: str, endpoint: str) -> None:
        import httpx

        self._endpoint = endpoint
        self._client = httpx.Client(
            timeout=_NEON_HTTP_TIMEOUT_S,
            headers={
                # 端点靠这个头拿到库/角色/密码——凭据只在头里，不进 URL 也不进日志
                "Neon-Connection-String": database_url,
                "Content-Type": "application/json",
            },
        )
        self._ensure_table()

    # ── 底层：一次 HTTPS 往返 ────────────────────────────────
    def _q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        resp = self._client.post(self._endpoint, json={"query": sql, "params": params or []})
        if resp.status_code >= 400:
            # 结构化解析：code/constraint/detail 等字段直接提出来，比截 200 字符
            # 好定位（见 _neon_http_error）。仍然抛异常，fail-open 语义不变。
            raise _neon_http_error(resp)
        return resp.json().get("rows") or []

    def _ensure_table(self) -> None:
        """IF NOT EXISTS：SQLAlchemy 后端可能已经建过同一张表，这里不覆盖它。
        列定义与 SQLAlchemy 模型保持一致，两个后端可以读写同一份数据。"""
        self._q(
            """
            create table if not exists generated_app (
                id varchar(36) primary key,
                root_id varchar(36),
                parent_id varchar(36),
                version integer,
                session_id varchar(64),
                goal text,
                product_name varchar(120),
                theme_id varchar(64),
                theme_label varchar(120),
                device varchar(16),
                landing_page_ref varchar(64),
                entity_count integer,
                page_count integer,
                gate_passed boolean,
                dedup_key varchar(80),
                created_at timestamptz,
                model_json jsonb
            )
            """
        )
        for col in ("root_id", "product_name", "dedup_key"):
            self._q(f"create index if not exists ix_generated_app_{col} on generated_app ({col})")

    # ── 接口实现 ────────────────────────────────────────────
    def save(self, record: dict[str, Any]) -> str:
        params: list[Any] = []
        for col in _NEON_COLUMNS:
            val = record.get(col)
            if col == "model_json":
                # jsonb 参数按 JSON 文本传，SQL 里再 ::jsonb 转——直接塞 dict 会被
                # 当成未知类型
                val = json.dumps(val or {}, ensure_ascii=False)
            elif col == "version":
                val = int(val or 1)
            elif col in ("entity_count", "page_count"):
                val = int(val or 0)
            elif col == "gate_passed":
                val = bool(val)
            params.append(val)
        placeholders = ", ".join(
            f"${i + 1}::jsonb" if col == "model_json" else f"${i + 1}"
            for i, col in enumerate(_NEON_COLUMNS)
        )
        updates = ", ".join(f"{c} = excluded.{c}" for c in _NEON_COLUMNS if c != "id")
        self._q(
            f"insert into generated_app ({', '.join(_NEON_COLUMNS)}) values ({placeholders}) "
            f"on conflict (id) do update set {updates}",
            params,
        )
        return record["id"]

    def get(self, app_id: str) -> Optional[dict[str, Any]]:
        rows = self._q("select * from generated_app where id = $1", [app_id])
        return _neon_normalize_row(rows[0]) if rows else None

    def list(self, *, limit: int, offset: int, latest_per_root: bool) -> list[dict[str, Any]]:
        # 排序/去重语义与另外两个后端逐字对齐（见 JSON 后端 list 注释）：
        # 同 root 内以 version 为准挑最新，卡片之间再按时间倒序。
        rows = [
            _neon_normalize_row(r)
            for r in self._q(
                "select * from generated_app order by version desc, created_at desc"
            )
        ]
        if latest_per_root:
            seen: set[str] = set()
            latest: list[dict[str, Any]] = []
            for r in rows:
                root = r.get("root_id") or r.get("id")
                if root in seen:
                    continue
                seen.add(root)
                latest.append(r)
            rows = latest
            rows.sort(key=lambda r: (r.get("created_at") or ""), reverse=True)
        return [_summary(r) for r in rows[offset:offset + limit]]

    def versions(self, root_id: str) -> list[dict[str, Any]]:
        rows = self._q(
            "select * from generated_app where root_id = $1 order by version", [root_id]
        )
        return [_summary(_neon_normalize_row(r)) for r in rows]

    def find_by_dedup_key(self, dedup_key: str) -> Optional[dict[str, Any]]:
        rows = self._q(
            "select * from generated_app where dedup_key = $1 limit 1", [dedup_key]
        )
        return _neon_normalize_row(rows[0]) if rows else None

    def find_latest_by_session(self, session_id: str) -> Optional[dict[str, Any]]:
        rows = self._q(
            "select * from generated_app where session_id = $1 "
            "order by version desc, created_at desc limit 1",
            [session_id],
        )
        return _neon_normalize_row(rows[0]) if rows else None

    def delete(self, app_id: str) -> bool:
        rows = self._q("delete from generated_app where id = $1 returning id", [app_id])
        return bool(rows)

    def export_all(self) -> list[dict[str, Any]]:
        return [_neon_normalize_row(r) for r in self._q("select * from generated_app")]


# ────────────────────────── 后端单例选择 ──────────────────────────

_backend_lock = threading.Lock()
_backend_instance: Optional[AppStoreBackend] = None
_backend_signature: Optional[str] = None
# 本进程内已经初始化失败过的 DB URL——不再重试（避免每次 get_backend 都吃一次
# 连接超时）。直接走 JSON 兜底。reset_backend_cache 会一并清空（测试用）。
_failed_db_urls: set[str] = set()


def _current_signature() -> str:
    return (settings.APP_STORE_DATABASE_URL or "").strip() or f"jsonfile:{settings.APP_STORE_FILE}"


def get_backend() -> AppStoreBackend:
    """按当前配置返回后端单例，三级 fail-open：

        TCP（SQLAlchemy/psycopg）→ Neon SQL over HTTP → 本地 JSON 文件

    首选 TCP：连接复用、延迟低、事务语义完整。TCP 不通（受限网络只放行 443、
    无服务器/边缘运行时没有原始 TCP）且连接串指向 Neon 时，自动改走官方
    SQL-over-HTTP 端点——同一个 APP_STORE_DATABASE_URL，无需改配置：生产环境
    照旧走 TCP，受限环境自动降级但仍然是真库。两条都不通才回退 JSON 文件。

    签名变了（比如测试里改环境）就重建。任何一级失败都不抛给调用方——存储层
    绝不拖垮主链路。"""
    global _backend_instance, _backend_signature
    with _backend_lock:
        sig = _current_signature()
        if _backend_instance is not None and _backend_signature == sig:
            return _backend_instance
        db_url = (settings.APP_STORE_DATABASE_URL or "").strip()
        if db_url and db_url not in _failed_db_urls:
            try:
                _backend_instance = _sqlalchemy_backend(db_url)
            except Exception as exc:  # noqa: BLE001 — 连不上/驱动缺失时诚实降级
                tcp_err = str(exc)[:200]
                endpoint = neon_http_endpoint(db_url)
                if endpoint:
                    try:
                        _backend_instance = NeonHttpAppStore(db_url, endpoint)
                        print(
                            f"[app_store] TCP 不可用（{tcp_err}），已改走 Neon SQL over HTTP"
                        )
                    except Exception as http_exc:  # noqa: BLE001
                        print(
                            f"[app_store] TCP 与 HTTP 均不可用，回退 JSON 文件兜底: "
                            f"TCP={tcp_err} / HTTP={str(http_exc)[:200]}"
                        )
                        _failed_db_urls.add(db_url)
                        _backend_instance = JsonFileAppStore()
                else:
                    print(f"[app_store] DB 初始化失败，回退 JSON 文件兜底: {tcp_err}")
                    _failed_db_urls.add(db_url)  # 本进程不再重试这个 URL
                    _backend_instance = JsonFileAppStore()
        else:
            _backend_instance = JsonFileAppStore()
        _backend_signature = sig
        return _backend_instance


def reset_backend_cache() -> None:
    """测试用：改了配置后强制下次重建后端（含清空"失败过的 URL"记忆）。"""
    global _backend_instance, _backend_signature
    with _backend_lock:
        _backend_instance = None
        _backend_signature = None
        _failed_db_urls.clear()


# ────────────────────────── 公开 API ──────────────────────────

def save_app(
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
    dedup_key: Optional[str] = None,
) -> str:
    """存一个新生成的原始应用（root=自己·v1·无 parent）。返回 app id。

    传了 dedup_key 且已有同键记录 → 幂等更新那一条（复用它的 id/root/version，
    刷新 model_json/元数据），不堆重复；用于"同一会话反复落同一个模型"。"""
    backend = get_backend()
    if dedup_key:
        existing = backend.find_by_dedup_key(dedup_key)
        if existing is not None:
            record = _build_record(
                model, goal=goal, session_id=session_id, gate_passed=gate_passed,
                app_id=existing["id"], root_id=existing["root_id"],
                parent_id=existing.get("parent_id"), version=existing.get("version") or 1,
                dedup_key=dedup_key,
            )
            record["created_at"] = existing.get("created_at") or record["created_at"]
            return backend.save(record)
    app_id = _new_id()
    record = _build_record(
        model, goal=goal, session_id=session_id, gate_passed=gate_passed,
        app_id=app_id, root_id=app_id, parent_id=None, version=1, dedup_key=dedup_key,
    )
    return backend.save(record)


def save_app_or_version(
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
) -> str:
    """闭环落库的正确入口（2026-07-27，审查修复）：

    - 模型一字未变（同 dedup_key）→ 幂等更新既有记录；
    - 同一会话、模型有变 → **同 root 的新版本**（save_version，version 递增，
      卡片长出 v2 徽标、版本链可查）；
    - 该会话首次落库 → 新应用（save_app，root=自己·v1）。

    此前闭环路径只调 save_app(dedup_key=会话+模型签名)：模型一变签名就变
    → miss → 每次精修都新建 root——版本链永远不产生（save_version 是全仓
    零调用的死代码），画廊里同一会话堆同名重复卡，v2 徽标恒为死代码。
    """
    dedup_key = model_signature(session_id, model)
    backend = get_backend()
    existing_same = backend.find_by_dedup_key(dedup_key)
    if existing_same is not None:
        return save_app(
            model, goal=goal, session_id=session_id,
            gate_passed=gate_passed, dedup_key=dedup_key,
        )
    prior = backend.find_latest_by_session(session_id) if session_id else None
    if prior is not None:
        return save_version(
            prior.get("root_id") or prior["id"], prior["id"], model,
            goal=goal or (prior.get("goal") or ""),
            session_id=session_id, gate_passed=gate_passed,
        )
    return save_app(
        model, goal=goal, session_id=session_id,
        gate_passed=gate_passed, dedup_key=dedup_key,
    )


def save_version(root_id: str, parent_id: str, model: dict[str, Any], *, goal: str = "", session_id: Optional[str] = None, gate_passed: bool = True) -> str:
    """同一应用的新一版（同 root，version 递增）。用于对已有应用精修/重生成。"""
    existing = get_backend().versions(root_id)
    next_version = (max((v.get("version") or 0) for v in existing) + 1) if existing else 1
    app_id = _new_id()
    record = _build_record(
        model, goal=goal, session_id=session_id, gate_passed=gate_passed,
        app_id=app_id, root_id=root_id, parent_id=parent_id, version=next_version,
    )
    return get_backend().save(record)


def fork_app(
    source_id: str,
    *,
    session_id: Optional[str] = None,
    new_name: Optional[str] = None,
) -> Optional[str]:
    """从现有应用分出一条新血缘：新 root·v1·parent 指向源，model_json 拷贝一份。
    源不存在返回 None。用于"以某个生成应用为起点，改成一个新应用"。

    - new_name：给副本改名（写进模型身份 appIdentity.productName，product_name
      元数据会自动跟着 re-derive）。对标 Budibase duplicateApp 的"预填 X 副本"——
      避免复刻出同名孪生卡。
    - session_id：不再默认继承源应用的会话（那会导致点开副本却进了源会话）。
      只在显式传入时才带；默认 None = 副本是独立设计快照，不绑任何会话。
    """
    source = get_backend().get(source_id)
    if source is None:
        return None
    import copy

    model = copy.deepcopy(source.get("model_json") or {})
    if new_name and isinstance(model, dict):
        appbundle = model.setdefault("appbundle", {})
        identity = appbundle.setdefault("appIdentity", {})
        identity["productName"] = str(new_name)[:120]
    app_id = _new_id()
    record = _build_record(
        model, goal=source.get("goal") or "",
        session_id=session_id,
        gate_passed=bool(source.get("gate_passed")),
        app_id=app_id, root_id=app_id, parent_id=source_id, version=1,
    )
    return get_backend().save(record)


def get_app(app_id: str) -> Optional[dict[str, Any]]:
    return get_backend().get(app_id)


def list_apps(*, limit: int = 50, offset: int = 0, latest_per_root: bool = True) -> list[dict[str, Any]]:
    """列表（默认每个应用只出最新版），返回摘要（不含 model_json）。"""
    return get_backend().list(limit=max(1, min(limit, 200)), offset=max(0, offset), latest_per_root=latest_per_root)


def list_versions(root_id: str) -> list[dict[str, Any]]:
    return get_backend().versions(root_id)


def delete_app(app_id: str) -> bool:
    """从画廊移除一个应用记录。返回是否真删到（不存在返回 False）。
    只删这一条记录，不动它对应的推演会话（会话另有独立生命周期）。"""
    return get_backend().delete(app_id)


def export_all() -> list[dict[str, Any]]:
    """导出全部记录（备份/迁移用）——无论后端在哪，手上永远有一份可迁移真数据。"""
    return get_backend().export_all()
