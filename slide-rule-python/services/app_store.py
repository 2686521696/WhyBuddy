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

import base64
import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from config.settings import settings


# ────────────────────────── 缩略图来源 ──────────────────────────
#
# 优先级链，靠前的更可信（完整说明见 AppStoreBackend 的缩略图小节）：
#   e2b   —— 真浏览器打开这个应用截的图，就是应用本身
#   sheet —— 生成时那张首页参照板，是"应该长这样"的示意
# 都没有 → 前端回落活渲染。
PREVIEW_SOURCE_E2B = "e2b"
PREVIEW_SOURCE_SHEET = "sheet"

#: 读取顺序。get_preview(source=None) 与 preview_sources() 都按这个序走，
#: 两处共用同一份定义——分开写就会出现"列表说有 e2b、取图却给了 sheet"。
PREVIEW_SOURCE_PRIORITY: tuple[str, ...] = (PREVIEW_SOURCE_E2B, PREVIEW_SOURCE_SHEET)


def normalize_preview_source(source: Optional[str]) -> str:
    """把外部传进来的来源名归一到已知值；不认识的一律当 sheet。

    宽进严出：这个值会进 SQL 列名选择与文件名，认不出来的值必须落到一个确定
    的槽里，不能让它自己开一个新槽。"""
    key = (source or "").strip().lower()
    return key if key in PREVIEW_SOURCE_PRIORITY else PREVIEW_SOURCE_SHEET


#: 时刻位的分辨率（每秒多少格）。微秒。
#:
#: 不是随手取的最大值，是被一次实测逼出来的：先写的秒级，再改毫秒级，两版都
#: 会让 test_preview_tag_changes_when_the_same_source_is_rewritten 在 JSON
#: 后端上间歇性变红——那个后端的时刻位取自文件 mtime，而背靠背两次 os.replace
#: 落在同一毫秒内是常事。微秒级下两次写之间隔着好几个系统调用，撞不上。
#:
#: 生产上这两次写隔着几十秒，秒级也够用；但一个"只在生产够用、在测试里必然
#: 撞车"的分辨率等于把 flaky 写进了实现。
_PREVIEW_TAG_TICKS_PER_SEC = 1_000_000


def preview_tag(source: str, written_at: Any) -> str:
    """拼缓存标签：`"{来源}.{写入时刻微秒}"`（理由见 preview_sources 的说明）。

    written_at 接受 datetime / epoch 秒 / ISO 字符串 / None——三个后端存的形态
    不一样，解析不出来就退成 0，标签仍然随来源变，只是丢掉"同来源换图"那一档
    灵敏度。
    """
    src = normalize_preview_source(source)
    seconds: Optional[float] = None
    if isinstance(written_at, datetime):
        seconds = written_at.timestamp()
    elif isinstance(written_at, (int, float)):
        seconds = float(written_at)
    elif isinstance(written_at, str) and written_at:
        try:
            seconds = datetime.fromisoformat(written_at.replace("Z", "+00:00")).timestamp()
        except ValueError:
            seconds = None
    stamp = round(seconds * _PREVIEW_TAG_TICKS_PER_SEC) if seconds is not None else 0
    return f"{src}.{max(0, stamp)}"


def preview_source_of(tag: Optional[str]) -> str:
    """从缓存标签里取回来源名。标签为空/形状不对时按 sheet 处理。"""
    return normalize_preview_source((tag or "").split(".", 1)[0])


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

    # ── 缩略图 ──────────────────────────────────────────────
    #
    # 为什么单独一张表 / 一份存储，而不是 generated_app 上加一列：
    #   那张 base64 约 1MB。加成一列的话，现有每一条 `select *`（list、get、
    #   find_by_dedup_key、find_latest_by_session、versions、export_all）都会
    #   顺手把它拖出来——应用中心一次列 200 个应用就是 200MB 过网，正好跟这
    #   件事要解决的问题相反。单独存就不存在"哪天谁加了个查询忘了排除它"。
    #
    # 三个方法都是**可选能力**：默认实现是"没有缩略图"，后端不实现也不会崩，
    # 只是应用中心回落到活渲染（老行为）。
    #
    # ## 两个来源，一条优先级链（2026-08-02）
    #
    # 一个应用最多挂两张图，按可信度排：
    #
    #   "e2b"   —— E2B 沙盒里用真浏览器打开这个应用截的图。**这就是应用本身**，
    #              不是示意；排第一。异步回填（见 app_shot_backfill），落库那一
    #              刻通常还没有。
    #   "sheet" —— 生成时给设计 LLM 排版式用的那张首页参照板。是"应该长这样"
    #              的示意图，跟最终渲染可能有出入；排第二，但落库即有。
    #
    # 两个都没有 → 前端回落活渲染（第三级，见 AppsWorkbench.SheetThumb）。
    #
    # 两张图**并存**而不是后者覆盖前者：e2b 那条路要 E2B key + 公网地址 + 沙盒
    # 跑通，任何一环断了都得有东西可退。覆盖式存储在那天就只剩活渲染了。
    #
    # 存储形态选的是「一行两列」，不是「(app_id, source) 复合主键两行」：
    # generated_app_preview 在生产 Neon 里已经有数据，改主键要迁移；加一列是
    # `add column if not exists`，三个后端都能就地升级。代价是将来加第四个来源
    # 要再加一列——而这条链是明确的三级，不打算长。

    def save_preview(
        self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
    ) -> None:  # pragma: no cover
        return None

    def get_preview(
        self, app_id: str, *, source: Optional[str] = None
    ) -> Optional[str]:  # pragma: no cover
        """取图。source=None 表示"按优先级取最好的那张"（e2b 优先）；
        指名 source 时只取那一张，取不到返回 None（继承逻辑要按来源分别复制）。"""
        return None

    def preview_sources(self) -> dict[str, str]:  # pragma: no cover
        """app_id → 缓存标签，形如 `"e2b.1754140000"`（来源 + 写入时刻秒数）。

        列表接口靠它给每条摘要打 has_preview / preview_source / preview_tag。
        只取 id、来源与时刻，**不取图**：几千个 36 字符的 id 也就百来 KB，
        而对应的图是几个 GB。

        ## 为什么标签里要带时刻，只带来源不够

        缩略图响应是 `immutable` 强缓存（一条 generated_app 记录不可变，这是
        上一轮改动的性能收益所在）。前端把这个标签拼进 URL 的 `?v=`，图一变
        URL 就变，强缓存才成立。而"图变了"有两种，只认来源会漏掉第二种：

          ① sheet → e2b：异步回填把更可信的那张补上了，来源变了；
          ② e2b → e2b：新版本先继承了上一版的 e2b 图，随后自己的回填到了。
             **来源一个字没变，字节全变了。**

        时刻位把 ② 也盖住了：save_preview 每次都刷 created_at。
        """
        return {}


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
            # 两个来源各是一个文件，都要清——只清 sheet 会留下孤儿 e2b 图，
            # 而 preview_sources 是按目录 glob 的，那张孤儿图会让已删除的应用
            # 在列表里继续显示 has_preview。
            for src in PREVIEW_SOURCE_PRIORITY:
                self._preview_path(app_id, src).unlink(missing_ok=True)
        return True

    def export_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read()

    # ── 缩略图：一个应用一个 .png 文件 ─────────────────────
    #
    # 不塞进上面那份 JSON：那个文件每次 save 都整份读进来、整份写回去，
    # 混进几十 MB 的 base64 之后每存一个应用都要重写全部图片。一图一文件的
    # 写入代价跟应用数量无关。存 PNG 原始字节而不是 base64，省掉 33% 体积，
    # 顺便还能直接用图片查看器打开排查。
    def _preview_dir(self) -> Path:
        return self._path.parent / (self._path.stem + "-previews")

    def _preview_path(self, app_id: str, source: str = PREVIEW_SOURCE_SHEET) -> Path:
        # app id 是 uuid4().hex，不含路径分隔符；仍然过一道白名单，避免将来
        # 有人换了 id 生成方式就把这里变成路径穿越。
        safe = "".join(c for c in str(app_id) if c.isalnum() or c in "-_")[:64]
        # sheet 保持 `{id}.png` 这个老文件名——已经落盘的图不用搬家；e2b 另起
        # `{id}.e2b.png`。两者同目录，preview_sources 一次 glob 就能分辨。
        suffix = "" if source == PREVIEW_SOURCE_SHEET else f".{source}"
        return self._preview_dir() / f"{safe or 'unknown'}{suffix}.png"

    def save_preview(
        self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
    ) -> None:
        raw = base64.b64decode(png_b64)
        src = normalize_preview_source(source)
        with self._lock:
            path = self._preview_path(app_id, src)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".png.tmp")
            tmp.write_bytes(raw)
            os.replace(tmp, path)

    def get_preview(self, app_id: str, *, source: Optional[str] = None) -> Optional[str]:
        wanted = (
            [normalize_preview_source(source)] if source else list(PREVIEW_SOURCE_PRIORITY)
        )
        for src in wanted:
            try:
                return base64.b64encode(
                    self._preview_path(app_id, src).read_bytes()
                ).decode("ascii")
            except OSError:
                continue
        return None

    def preview_sources(self) -> dict[str, str]:
        try:
            paths = list(self._preview_dir().glob("*.png"))
        except OSError:
            return {}
        # app_id → (来源, 该文件 mtime)。文件后端没有 created_at 列，用 mtime
        # 当写入时刻——save_preview 是 os.replace 落盘，mtime 就是那一刻。
        best: dict[str, tuple[str, float]] = {}
        for path in paths:
            stem = path.name[: -len(".png")]
            # `{id}.e2b` → e2b；`{id}` → sheet。id 本身不含 "."（白名单只留
            # 字母数字与 -_），所以这个切分是无歧义的。
            app_id, _, suffix = stem.partition(".")
            src = normalize_preview_source(suffix) if suffix else PREVIEW_SOURCE_SHEET
            # 未知后缀会被归一成 sheet，可能顶掉真的 sheet；只认恰好等于
            # 已知来源名的后缀，其余文件（.tmp 残留之类）忽略。
            if suffix and suffix != src:
                continue
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = 0.0
            prev = best.get(app_id)
            if prev is None or PREVIEW_SOURCE_PRIORITY.index(src) < PREVIEW_SOURCE_PRIORITY.index(prev[0]):
                best[app_id] = (src, mtime)
        return {app_id: preview_tag(src, ts) for app_id, (src, ts) in best.items()}


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

    class GeneratedAppPreview(Base):
        """应用中心的卡片缩略图（生成时那张首页参照板）。

        单独一张表的理由见 AppStoreBackend.save_preview 上方那段：约 1MB 的
        base64 挂在 generated_app 上，会被现有每一条 `select *` 顺手拖出来。
        独立表 + 独立查询 = 只有真要图的那一次请求才付这个代价。

        app_id 不设外键：generated_app 是三个后端共建的表（JSON/SQLAlchemy/
        Neon HTTP 各建各的，都是 IF NOT EXISTS），加外键等于要求建表顺序，
        而 Neon HTTP 那份不参与 SQLAlchemy 的 metadata。孤儿行由 delete_app
        显式清理，代价是一张图，不值得为它引入建表顺序依赖。
        """

        __tablename__ = "generated_app_preview"
        app_id = Column(String(36), primary_key=True)
        #: sheet 来源（生成时那张首页参照板）。列名保持不变——生产 Neon 里
        #: 已经有数据，改名就是一次数据迁移。
        png_b64 = Column(Text, default="")
        #: e2b 来源（真浏览器截的图）。新增列，老库靠下面的 _ensure_columns
        #: 就地补上；补不上时读到的就是 None，等同"没有这张图"。
        e2b_png_b64 = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

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

    # create_all **只建不改**：表已经存在时它一列都不会补。generated_app_preview
    # 在生产 Neon 与本地 SQLite 里都早有数据，e2b_png_b64 这个新列必须自己
    # ALTER 上去，否则所有读写都会撞 UndefinedColumn。
    #
    # 就地补列而不是引 alembic：整个仓库没有迁移框架，为一列引一套版本表 +
    # 迁移目录，运维面比这几行大得多。
    #
    # **先 inspect 再 ALTER，不用 `add column if not exists`**：那个写法只有
    # Postgres 认，SQLite 压根没有这个语法（不是版本问题，是根本不支持），
    # 直接抛 syntax error。inspector 两个后端都认，也顺带避免了"新建的表已经
    # 带这一列"时那句多余的 ALTER。
    #
    # fail-open：补不上就当没有这个来源——读到 None、等同没图，回落 sheet。
    try:
        from sqlalchemy import inspect as _sql_inspect, text as _sql_text

        _cols = {c["name"] for c in _sql_inspect(engine).get_columns("generated_app_preview")}
        if "e2b_png_b64" not in _cols:
            with engine.begin() as _conn:
                _conn.execute(
                    _sql_text("alter table generated_app_preview add column e2b_png_b64 text")
                )
            print("[app_store] generated_app_preview 补上 e2b_png_b64 列")
    except Exception as exc:  # noqa: BLE001 — 补不上就当没有这个来源
        print(f"[app_store] e2b 缩略图列补齐失败（回落 sheet 单来源）: {str(exc)[:160]}")

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
                shot = s.get(GeneratedAppPreview, app_id)
                if shot is not None:
                    s.delete(shot)
                s.commit()
            return True

        def export_all(self) -> list[dict[str, Any]]:
            with Session(engine) as s:
                return [r.to_record() for r in s.scalars(select(GeneratedApp))]

        # ── 缩略图 ───────────────────────────────────────
        def save_preview(
            self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
        ) -> None:
            col = (
                "e2b_png_b64"
                if normalize_preview_source(source) == PREVIEW_SOURCE_E2B
                else "png_b64"
            )
            # 原地更新那一列，不再 delete + add 整行：两个来源共用一行，删行
            # 会把另一个来源那张图一起抹掉（异步回填 e2b 时正好会撞上）。
            with Session(engine) as s:
                row = s.get(GeneratedAppPreview, app_id)
                if row is None:
                    row = GeneratedAppPreview(app_id=app_id)
                    s.add(row)
                setattr(row, col, png_b64)
                row.created_at = datetime.now(timezone.utc)
                s.commit()

        def get_preview(self, app_id: str, *, source: Optional[str] = None) -> Optional[str]:
            with Session(engine) as s:
                row = s.get(GeneratedAppPreview, app_id)
            if row is None:
                return None
            wanted = (
                [normalize_preview_source(source)] if source else list(PREVIEW_SOURCE_PRIORITY)
            )
            for src in wanted:
                val = row.e2b_png_b64 if src == PREVIEW_SOURCE_E2B else row.png_b64
                if val:
                    return val
            return None

        def preview_sources(self) -> dict[str, str]:
            # 不 select 图本体——`select(GeneratedAppPreview)` 会把每行两列
            # base64 一起拉出来，那正是这张表拆出去要避免的事。这里只取
            # 主键 + 两个"这一列非空吗"的布尔，跟图多大无关。
            with Session(engine) as s:
                rows = s.execute(
                    select(
                        GeneratedAppPreview.app_id,
                        GeneratedAppPreview.e2b_png_b64.isnot(None)
                        & (GeneratedAppPreview.e2b_png_b64 != ""),
                        GeneratedAppPreview.png_b64.isnot(None)
                        & (GeneratedAppPreview.png_b64 != ""),
                        GeneratedAppPreview.created_at,
                    )
                ).all()
            best: dict[str, str] = {}
            for app_id, has_e2b, has_sheet, written in rows:
                if has_e2b:
                    best[str(app_id)] = preview_tag(PREVIEW_SOURCE_E2B, written)
                elif has_sheet:
                    best[str(app_id)] = preview_tag(PREVIEW_SOURCE_SHEET, written)
            return best

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
        # 缩略图另起一张表（理由见 AppStoreBackend.save_preview 上方）。列定义
        # 与 SQLAlchemy 侧的 GeneratedAppPreview 保持一致，两个后端读写同一份。
        self._q(
            """
            create table if not exists generated_app_preview (
                app_id varchar(36) primary key,
                png_b64 text,
                created_at timestamptz
            )
            """
        )
        # 一行两列、e2b 优先（理由见 AppStoreBackend 的缩略图小节）。老库靠
        # 这一句就地补列——上面那句 `create table if not exists` 对已存在的表
        # 什么都不做，新列不会自己长出来。补不上就当没有这个来源，读到 NULL
        # 等同"没图"，回落 sheet。
        self._q("alter table generated_app_preview add column if not exists e2b_png_b64 text")

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
        self._q("delete from generated_app_preview where app_id = $1", [app_id])
        return bool(rows)

    def export_all(self) -> list[dict[str, Any]]:
        return [_neon_normalize_row(r) for r in self._q("select * from generated_app")]

    # ── 缩略图 ─────────────────────────────────────────────
    def save_preview(
        self, app_id: str, png_b64: str, *, source: str = PREVIEW_SOURCE_SHEET
    ) -> None:
        # 列名从归一后的来源派生，不是拼接调用方传进来的字符串——normalize
        # 只会返回 PREVIEW_SOURCE_PRIORITY 里的值，这里再映射成两个字面量之一，
        # 外部输入到不了 SQL 文本。
        col = (
            "e2b_png_b64"
            if normalize_preview_source(source) == PREVIEW_SOURCE_E2B
            else "png_b64"
        )
        # 只更新自己那一列：两个来源共用一行，`do update set` 把两列都写一遍
        # 会用 NULL 抹掉另一个来源那张图（异步回填 e2b 时必然撞上）。
        self._q(
            f"insert into generated_app_preview (app_id, {col}, created_at) "
            f"values ($1, $2, $3) on conflict (app_id) do update set "
            f"{col} = excluded.{col}, created_at = excluded.created_at",
            [app_id, png_b64, _now_iso()],
        )

    def get_preview(self, app_id: str, *, source: Optional[str] = None) -> Optional[str]:
        rows = self._q(
            "select e2b_png_b64, png_b64 from generated_app_preview where app_id = $1",
            [app_id],
        )
        if not rows:
            return None
        row = rows[0]
        wanted = (
            [normalize_preview_source(source)] if source else list(PREVIEW_SOURCE_PRIORITY)
        )
        for src in wanted:
            b64 = row.get("e2b_png_b64" if src == PREVIEW_SOURCE_E2B else "png_b64")
            if isinstance(b64, str) and b64:
                return b64
        return None

    def preview_sources(self) -> dict[str, str]:
        # 不 select 图本体：`select *` 会把每行两列共约 2MB 的 base64 一起过网，
        # 而这里要的只是"哪些应用有图、哪一路的"。判空在库里做完，回来的每行
        # 只有一个 id 加两个布尔。
        rows = self._q(
            "select app_id, created_at, "
            "(e2b_png_b64 is not null and e2b_png_b64 <> '') as has_e2b, "
            "(png_b64 is not null and png_b64 <> '') as has_sheet "
            "from generated_app_preview"
        )
        best: dict[str, str] = {}
        for r in rows:
            app_id = r.get("app_id")
            if not app_id:
                continue
            written = r.get("created_at")
            if r.get("has_e2b"):
                best[str(app_id)] = preview_tag(PREVIEW_SOURCE_E2B, written)
            elif r.get("has_sheet"):
                best[str(app_id)] = preview_tag(PREVIEW_SOURCE_SHEET, written)
        return best


# ────────────────────────── 后端单例选择 ──────────────────────────

_backend_lock = threading.Lock()
_backend_instance: Optional[AppStoreBackend] = None
_backend_signature: Optional[str] = None
# 本进程内已经初始化失败过的 DB URL——不再重试（避免每次 get_backend 都吃一次
# 连接超时）。直接走 JSON 兜底。reset_backend_cache 会一并清空（测试用）。
_failed_db_urls: set[str] = set()


def _local_sqlite_backend() -> Optional[AppStoreBackend]:
    """本地 SQLite 兜底（2026-07-28）。远端不可用时的第二选择，排在 JSON 之前。

    为什么值得单独一级：JSON 兜底是"整个文件读出来改完再写回去"，没有索引、
    没有事务、并发写只能靠进程内一把锁；SQLite 是真库——同一套 SQLAlchemy
    模型、同样能查能索引，写入是事务性的，进程崩在半路也不会留下半个文件。
    远端挂掉那段时间里产生的应用，落在 SQLite 比落在 JSON 更捞得回来。

    ⚠️ 分叉是真实存在的：远端恢复后，这段时间写进本地的记录不会自动回流，
    两边从此各说各话。这个问题在 JSON 兜底时代就存在，加了 SQLite 只是让
    兜底更好用、并没有解决它。要解决得有一层同步/对账，那是另一件事。
    所以下面的日志把"现在写在哪"讲明白，而不是静默降级。

    配置置空 → 返回 None（跳过这一级）。建库失败（只读文件系统等）也返回
    None，由调用方继续降到 JSON。
    """
    url = (getattr(settings, "APP_STORE_LOCAL_SQLITE", "") or "").strip()
    if not url:
        return None
    try:
        # sqlite:///data/xxx.db → 确保 data/ 存在，否则 SQLAlchemy 直接抛
        prefix = "sqlite:///"
        if url.startswith(prefix):
            Path(url[len(prefix):]).parent.mkdir(parents=True, exist_ok=True)
        return _sqlalchemy_backend(url)
    except Exception as exc:  # noqa: BLE001 — 本地库也建不起来就继续降级
        print(f"[app_store] 本地 SQLite 不可用，继续回退 JSON: {str(exc)[:200]}")
        return None


def _current_signature() -> str:
    remote = (settings.APP_STORE_DATABASE_URL or "").strip()
    local = (getattr(settings, "APP_STORE_LOCAL_SQLITE", "") or "").strip()
    # 本地库配置也进签名：改了它（比如测试里置空）要能触发重建，否则会一直
    # 拿着上一次的后端单例，改配置像没生效。
    return f"{remote}|{local}|jsonfile:{settings.APP_STORE_FILE}"


def get_backend() -> AppStoreBackend:
    """按当前配置返回后端单例，四级 fail-open（2026-07-28 起）：

        远端 TCP → 远端 SQL over HTTP → 本地 SQLite → 本地 JSON 文件
        └────────── 同一个 APP_STORE_DATABASE_URL ─────────┘

    优先级的意思是"数据最好落在哪"：
    1. 远端库（Neon/自建 PG）走 TCP——连接复用、延迟低、事务语义完整；
    2. TCP 不通（受限网络只放行 443、无服务器/边缘运行时没有原始 TCP）且连接
       串指向 Neon 时，改走官方 SQL-over-HTTP 端点。同一个连接串、无需改配置：
       生产照旧走 TCP，受限环境自动降级但**仍然是同一个远端库**，数据不分叉；
    3. 远端整个不可用时落本地 SQLite——真库，能查能索引、写入是事务性的，比
       JSON 那种"整文件读改写"强；
    4. 本地库也建不起来（只读文件系统等）才回 JSON 文件。

    ⚠️ 第 3 级开始数据就和远端分叉了：远端恢复后本地这段时间的记录不会自动
    回流。这在只有 JSON 兜底的时代就存在，加 SQLite 只是让兜底更可用，没有
    解决分叉。所以每次降级都打印"现在写在哪"，不静默。

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
                        _failed_db_urls.add(db_url)
                        local = _local_sqlite_backend()
                        print(
                            f"[app_store] 远端两条通道均不可用，改写"
                            f"{'本地 SQLite' if local else 'JSON 文件'}"
                            f"（与远端分叉，恢复后不会自动回流）: "
                            f"TCP={tcp_err} / HTTP={str(http_exc)[:200]}"
                        )
                        _backend_instance = local or JsonFileAppStore()
                else:
                    _failed_db_urls.add(db_url)  # 本进程不再重试这个 URL
                    local = _local_sqlite_backend()
                    print(
                        f"[app_store] 远端 DB 初始化失败，改写"
                        f"{'本地 SQLite' if local else 'JSON 文件'}"
                        f"（与远端分叉，恢复后不会自动回流）: {tcp_err}"
                    )
                    _backend_instance = local or JsonFileAppStore()
        else:
            # 没配远端连接串（或这个 URL 本进程已经失败过）：本地 SQLite 仍然
            # 优于 JSON——没有远端不代表就该退到最弱的那一档。
            _backend_instance = _local_sqlite_backend() or JsonFileAppStore()
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
    preview_png_b64: Optional[str] = None,
) -> str:
    """存一个新生成的原始应用（root=自己·v1·无 parent）。返回 app id。

    传了 dedup_key 且已有同键记录 → 幂等更新那一条（复用它的 id/root/version，
    刷新 model_json/元数据），不堆重复；用于"同一会话反复落同一个模型"。

    preview_png_b64 是应用中心的卡片缩略图（生成时那张首页参照板，见
    app_preview）。**没传就保留既有的那张**，不清空——这一路上大部分调用
    根本没生成图（重开夹具、纯精修、fork），若按"没传即无图"处理，一次重存
    就会把卡片打回活渲染。
    """
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
            app_id = backend.save(record)
            _attach_preview(backend, app_id, preview_png_b64, inherit_from=None)
            return app_id
    app_id = _new_id()
    record = _build_record(
        model, goal=goal, session_id=session_id, gate_passed=gate_passed,
        app_id=app_id, root_id=app_id, parent_id=None, version=1, dedup_key=dedup_key,
    )
    saved = backend.save(record)
    _attach_preview(backend, saved, preview_png_b64, inherit_from=None)
    return saved


def _attach_preview(
    backend: AppStoreBackend,
    app_id: str,
    png_b64: Optional[str],
    *,
    inherit_from: Optional[str],
) -> None:
    """给刚落库的这一条挂缩略图。fail-open：挂不上只影响卡片长相，不影响落库。

    png_b64 是这一次生成的**参照板**（sheet 来源）。有就用，没有就从
    inherit_from（上一版 / fork 源）那条继承——新版本是个新 app_id，不继承的话
    每次精修卡片都会掉回活渲染，而实际上这一版跟上一版长得基本一样，上一版那张
    图仍然是诚实的示意。

    **e2b 那张单独继承**，且没有"这次新拍的"这一说：真截图是落库之后异步回填
    的（见 app_shot_backfill），走到这里时必然还没有。继承上一版的 e2b 图是为了
    让新版本在回填到达之前也有真图可用——它比同一条记录的参照板更接近实物，
    回填一到就被顶掉。回填没开/失败，留着的这张也仍然比参照板可信。
    """
    b64 = png_b64
    if not b64 and inherit_from:
        try:
            b64 = backend.get_preview(inherit_from, source=PREVIEW_SOURCE_SHEET)
        except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
            print(f"[app_store] 缩略图继承失败（不影响落库）: {str(exc)[:160]}")
            b64 = None
    if b64:
        try:
            backend.save_preview(app_id, b64, source=PREVIEW_SOURCE_SHEET)
        except Exception as exc:  # noqa: BLE001 — 同上
            print(f"[app_store] 缩略图写入失败（不影响落库）: {str(exc)[:160]}")
    if not inherit_from:
        return
    try:
        e2b = backend.get_preview(inherit_from, source=PREVIEW_SOURCE_E2B)
        if e2b:
            backend.save_preview(app_id, e2b, source=PREVIEW_SOURCE_E2B)
    except Exception as exc:  # noqa: BLE001 — 同上
        print(f"[app_store] e2b 缩略图继承失败（不影响落库）: {str(exc)[:160]}")


def save_app_shot(app_id: str, png_bytes: bytes) -> bool:
    """把一张 E2B 真截图挂到已落库的应用上（异步回填的落点）。

    独立于 _attach_preview：那条路跑在落库事务旁边、参数是"这次生成产出的
    参照板"；这条路是几十秒之后从另一个线程回来的，只认 app_id。

    fail-open 返回 bool 而不是抛：调用方是后台线程，抛出去没人接，而"回填没
    成功"的正确表现就是卡片继续用参照板。
    """
    if not png_bytes:
        return False
    try:
        b64 = base64.b64encode(png_bytes).decode("ascii")
        get_backend().save_preview(app_id, b64, source=PREVIEW_SOURCE_E2B)
        return True
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] e2b 缩略图回填失败: {str(exc)[:160]}")
        return False


def save_app_or_version(
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
    preview_png_b64: Optional[str] = None,
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
            preview_png_b64=preview_png_b64,
        )
    prior = backend.find_latest_by_session(session_id) if session_id else None
    if prior is not None:
        return save_version(
            prior.get("root_id") or prior["id"], prior["id"], model,
            goal=goal or (prior.get("goal") or ""),
            session_id=session_id, gate_passed=gate_passed,
            preview_png_b64=preview_png_b64,
        )
    return save_app(
        model, goal=goal, session_id=session_id,
        gate_passed=gate_passed, dedup_key=dedup_key,
        preview_png_b64=preview_png_b64,
    )


def save_version(
    root_id: str,
    parent_id: str,
    model: dict[str, Any],
    *,
    goal: str = "",
    session_id: Optional[str] = None,
    gate_passed: bool = True,
    preview_png_b64: Optional[str] = None,
) -> str:
    """同一应用的新一版（同 root，version 递增）。用于对已有应用精修/重生成。

    缩略图：这一版自己生了图就用自己的，没生就继承上一版那张（见
    _attach_preview）——精修通常不重跑生图，不继承的话每精修一次卡片就掉回
    活渲染一次。
    """
    backend = get_backend()
    existing = backend.versions(root_id)
    next_version = (max((v.get("version") or 0) for v in existing) + 1) if existing else 1
    app_id = _new_id()
    record = _build_record(
        model, goal=goal, session_id=session_id, gate_passed=gate_passed,
        app_id=app_id, root_id=root_id, parent_id=parent_id, version=next_version,
    )
    saved = backend.save(record)
    _attach_preview(backend, saved, preview_png_b64, inherit_from=parent_id)
    return saved


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
    backend = get_backend()
    saved = backend.save(record)
    # 副本的设计跟源一模一样（model_json 就是拷贝的），源那张图对副本同样诚实。
    _attach_preview(backend, saved, None, inherit_from=source_id)
    return saved


def get_app(app_id: str) -> Optional[dict[str, Any]]:
    return get_backend().get(app_id)


def get_app_preview_png(app_id: str, *, source: Optional[str] = None) -> Optional[bytes]:
    """应用中心卡片缩略图的 PNG 原始字节；没有就 None（调用方 404，前端回落
    活渲染）。fail-open：存储层出问题也当成"没有图"，不把一张缩略图变成故障。

    source 不传 = 按优先级取最好的那张（e2b 优先，见 PREVIEW_SOURCE_PRIORITY）。
    这就是应用中心走的路径——**优先级判定在服务端**，前端不需要知道有几个来源，
    它只管"有图就贴、404 就回落活渲染"。
    """
    try:
        b64 = get_backend().get_preview(app_id, source=source)
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] 缩略图读取失败: {str(exc)[:160]}")
        return None
    if not b64:
        return None
    try:
        return base64.b64decode(b64)
    except (ValueError, TypeError):
        return None


def _mark_previews(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """给一批摘要打上缩略图三件套——前端据此决定这张卡贴哪张图、还是活渲染。

      has_preview    有没有图。false → 前端回落活渲染（第三级）。
      preview_source "e2b" / "sheet"，当前用的是哪一路。观测用，也让"这张卡
                     到底贴的什么"在列表接口上直接可见，不用去翻库。
      preview_tag    拼进缩略图 URL `?v=` 的缓存版本位（见 preview_sources）。

    图本身不进摘要（一张约 1MB，列 200 个就是 200MB）。这里只多做一次索引
    查询，跟列表长度无关。fail-open：查不到就当全都没图，前端回落活渲染
    （老行为），不因为一次查询失败让整个列表 500。
    """
    if not rows:
        return rows
    try:
        tags = get_backend().preview_sources()
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[app_store] 缩略图索引读取失败，本次列表按「无图」处理: {str(exc)[:160]}")
        tags = {}
    for r in rows:
        tag = tags.get(str(r.get("id")))
        r["has_preview"] = bool(tag)
        r["preview_source"] = preview_source_of(tag) if tag else ""
        r["preview_tag"] = tag or ""
    return rows


def list_apps(*, limit: int = 50, offset: int = 0, latest_per_root: bool = True) -> list[dict[str, Any]]:
    """列表（默认每个应用只出最新版），返回摘要（不含 model_json / 缩略图本体）。"""
    return _mark_previews(get_backend().list(
        limit=max(1, min(limit, 200)), offset=max(0, offset), latest_per_root=latest_per_root
    ))


def list_versions(root_id: str) -> list[dict[str, Any]]:
    return _mark_previews(get_backend().versions(root_id))


def delete_app(app_id: str) -> bool:
    """从画廊移除一个应用记录。返回是否真删到（不存在返回 False）。
    只删这一条记录，不动它对应的推演会话（会话另有独立生命周期）。"""
    return get_backend().delete(app_id)


def export_all() -> list[dict[str, Any]]:
    """导出全部记录（备份/迁移用）——无论后端在哪，手上永远有一份可迁移真数据。"""
    return get_backend().export_all()
