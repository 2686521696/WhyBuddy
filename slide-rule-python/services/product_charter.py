"""产品宪章 —— 用户自己的行业约束，opt-in 才进推演。

## 为什么有这个文件

WhyBuddy 仓里的 Claude.md / AGENTS.md 是**引擎建造者**的纪律，不是用户
这场推演的先验。2026-08 设计把「跨场记忆」写成 opt-in 产品宪章，就是为了
挡住两种会静默污染用户应用的做法：

  1. 把建造者文档当 system 提示词喂进去（用户的烘焙工坊变成面团自己的
     工程约束）。
  2. 把上一场的五系统模型当 priors 自动灌进下一场（悬空引用、错公司
     RBAC，闸还可能假绿）。

宪章是**约束，不是证据**。缺证据仍是缺；宪章文本不得绕过 `v5_model_gate`，
也不得当成闭环证据。

## 三条硬约束

1. **默认不注入。** `charter_prompt_block()` 在 opt-in 关着时必须返回空串，
   让 spec-first 的 prompt 跟从前逐字节一致。没有勾「下一场沿用」就灌，
   等于自动沿用——正是这条产品判断要消灭的。
2. **只认白名单字段。** industry / terms / defaultRoles / hardCompliance /
   brandConstraints。其余键（尤其 datamodel / rbac / workflow / page /
   aigc / appbundle）一律丢掉。塞进五系统模型不得变成 priors。
3. **persist fail-open，inject fail-closed。** 存失败不许拖垮推演；读不到
   或没打旗，就当没有宪章，不许编一份。

注入点必须是 spec-first / scope_card 真正读上下文的地方
（`spec_tree.build_spec_prompt`、`rehearsal_control._system_prompt`）。
只接在 `v5_llm_generate._build_user_content` 上等于接在不通电的插座——
默认生成路径是 spec-first。
"""

from __future__ import annotations

import json
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

CHARTER_MARKER = "产品宪章（约束，不是证据）"

CHARTER_FIELDS = (
    "industry",
    "terms",
    "defaultRoles",
    "hardCompliance",
    "brandConstraints",
)

_FIELD_LABELS = {
    "industry": "行业",
    "terms": "术语",
    "defaultRoles": "默认角色",
    "hardCompliance": "硬性合规",
    "brandConstraints": "品牌约束",
}

# 五系统模型段。出现在宪章 JSON 里必须剥掉——那是「上一场当 priors」的入口。
_FIVE_SYSTEM_KEYS = frozenset(
    {
        "datamodel",
        "rbac",
        "workflow",
        "page",
        "aigc",
        "appbundle",
        "model",
        "fiveSystemModel",
        "specFirstPages",
        "pages",
        "entities",
        "permissions",
    }
)

_MAX_FIELD = 500

TABLE = "sliderule_product_charter"

_DDL_PG = f"""
create table if not exists {TABLE} (
    scope varchar(16) not null,
    scope_id varchar(80) not null,
    charter_json jsonb,
    reuse_next boolean,
    updated_at timestamptz,
    primary key (scope, scope_id)
)
"""

_DDL_SQLITE = f"""
create table if not exists {TABLE} (
    scope varchar(16) not null,
    scope_id varchar(80) not null,
    charter_json text,
    reuse_next integer,
    updated_at timestamp,
    primary key (scope, scope_id)
)
"""

_charter_var: ContextVar[Dict[str, str]] = ContextVar(
    "sliderule_product_charter", default={}
)
_opt_in_var: ContextVar[bool] = ContextVar(
    "sliderule_charter_opt_in", default=False
)

_store_lock = threading.Lock()
_store: Any = None
_store_ident: Any = None
# persist 失败时的进程内回落。不是第二套库——只是 fail-open 的缓冲。
_MEM: Dict[Tuple[str, str], Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_charter(raw: Any) -> Dict[str, str]:
    """只留白名单字段。五系统模型键、建造者文档路径一律丢掉。"""
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for key in CHARTER_FIELDS:
        value = str(raw.get(key) or "").strip()
        if not value:
            continue
        # 挡住有人把 Claude.md 正文贴进某一栏
        lowered = value.lower()
        if "claude.md" in lowered or "agents.md" in lowered:
            continue
        out[key] = value[:_MAX_FIELD]
    return out


def charter_has_content(charter: Optional[Dict[str, str]]) -> bool:
    return bool(charter) and any(str(v).strip() for v in charter.values())


def _as_bool(raw: Any) -> Optional[bool]:
    if raw is True or raw is False:
        return raw
    if isinstance(raw, (int, float)) and raw in (0, 1):
        return bool(raw)
    if isinstance(raw, str):
        s = raw.strip().lower()
        if s in ("1", "true", "yes", "on"):
            return True
        if s in ("0", "false", "no", "off"):
            return False
    return None


def charter_prompt_block() -> str:
    """opt-in 关着 → 空串。空串才能让 spec-first prompt 跟从前逐字节一致。"""
    if not _opt_in_var.get():
        return ""
    charter = dict(_charter_var.get() or {})
    if not charter_has_content(charter):
        return ""
    lines = [
        CHARTER_MARKER,
        "这是约束，不是证据。不得当作闭环证据，不得绕过模型闸，"
        "不得把上一场的五系统模型当先验。",
    ]
    for key in CHARTER_FIELDS:
        value = str(charter.get(key) or "").strip()
        if value:
            lines.append(f"{_FIELD_LABELS[key]}：{value}")
    return "\n".join(lines)


def set_charter_context(
    charter: Optional[Dict[str, str]], *, opt_in: bool
) -> None:
    cleaned = normalize_charter(charter or {})
    _charter_var.set(cleaned)
    _opt_in_var.set(bool(opt_in) and charter_has_content(cleaned))


def clear_charter_for_run() -> None:
    _charter_var.set({})
    _opt_in_var.set(False)


class CharterStore:
    """跟 component_preset_store 同一条执行器，不另开数据库。"""

    def __init__(self, executor: Any, *, is_sqlite: bool) -> None:
        self._x = executor
        self._is_sqlite = is_sqlite
        self._x.execute(_DDL_SQLITE if is_sqlite else _DDL_PG)

    def upsert(
        self, *, scope: str, scope_id: str, charter: Dict[str, str], reuse_next: bool
    ) -> None:
        p = self._x.ph
        payload = json.dumps(charter, ensure_ascii=False)
        flag: Any = (1 if reuse_next else 0) if self._is_sqlite else bool(reuse_next)
        self._x.execute(
            f"delete from {TABLE} where scope = {p(1)} and scope_id = {p(2)}",
            [scope, scope_id[:80]],
        )
        self._x.execute(
            f"insert into {TABLE} (scope, scope_id, charter_json, reuse_next, updated_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)},{p(5)})",
            [scope, scope_id[:80], payload, flag, _now_iso()],
        )

    def load(self, *, scope: str, scope_id: str) -> Dict[str, Any]:
        p = self._x.ph
        rows = self._x.query(
            f"select charter_json, reuse_next from {TABLE}"
            f" where scope = {p(1)} and scope_id = {p(2)}",
            [scope, scope_id[:80]],
        )
        if not rows:
            return {}
        row = rows[0]
        raw = row.get("charter_json")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raw = {}
        return {
            "charter": normalize_charter(raw),
            "reuse_next": bool(row.get("reuse_next")),
        }


def get_charter_store() -> Optional[CharterStore]:
    global _store, _store_ident
    try:
        from .identity_store import get_identity_store

        ident = get_identity_store()
    except Exception:  # noqa: BLE001 — persist fail-open
        return None
    with _store_lock:
        if _store is not None and _store_ident is ident:
            return _store
        try:
            _store = CharterStore(ident._x, is_sqlite=ident._is_sqlite)
            _store_ident = ident
            return _store
        except Exception:  # noqa: BLE001
            _store = None
            _store_ident = None
            return None


def reset_charter_cache() -> None:
    """测试用。连同进程内回落一起清。"""
    global _store, _store_ident
    with _store_lock:
        _store = None
        _store_ident = None
    _MEM.clear()
    clear_charter_for_run()


def _mem_key(scope: str, scope_id: str) -> Tuple[str, str]:
    return (str(scope or ""), str(scope_id or "")[:80])


def save_charter(
    *, scope: str, scope_id: str, charter: Dict[str, str], reuse_next: bool
) -> None:
    if not scope_id:
        return
    cleaned = normalize_charter(charter)
    record = {"charter": cleaned, "reuse_next": bool(reuse_next)}
    _MEM[_mem_key(scope, scope_id)] = record
    store = get_charter_store()
    if store is None:
        return
    try:
        store.upsert(
            scope=scope, scope_id=scope_id, charter=cleaned, reuse_next=bool(reuse_next)
        )
    except Exception as exc:  # noqa: BLE001 — persist fail-open
        print(f"[charter] persist failed: {type(exc).__name__}", flush=True)


def load_charter(*, scope: str, scope_id: str) -> Dict[str, Any]:
    if not scope_id:
        return {}
    store = get_charter_store()
    if store is not None:
        try:
            found = store.load(scope=scope, scope_id=scope_id)
            if found:
                return found
        except Exception:  # noqa: BLE001 — inject fail-closed on this channel
            pass
    return dict(_MEM.get(_mem_key(scope, scope_id)) or {})


def _write_state(state: Any, charter: Dict[str, str], opt_in: bool) -> None:
    if state is None:
        return
    try:
        state.productCharter = charter or None
        state.charterReuseNext = bool(opt_in)
    except Exception:  # noqa: BLE001 — 老 state 形状不认这两个字段时别拖垮
        pass


def activate_charter_for_run(state: Any, payload: Optional[Dict[str, Any]] = None) -> None:
    """读 payload / 会话 / 账户，决定本轮要不要把宪章送进 prompt。

    ⚠ 没有 opt-in 旗（payload.reuseCharter / state.charterReuseNext /
      账户 reuse_next）就注入，等于自动沿用上一场——测试必须咬住这条。
    """
    payload = payload if isinstance(payload, dict) else {}
    session_id = str(getattr(state, "sessionId", "") or payload.get("sessionId") or "").strip()
    owner_id = str(getattr(state, "ownerId", "") or payload.get("ownerId") or "").strip()

    incoming = normalize_charter(
        payload.get("productCharter") or payload.get("product_charter")
    )
    if not incoming:
        incoming = normalize_charter(getattr(state, "productCharter", None))

    stored_session = load_charter(scope="session", scope_id=session_id)
    stored_account = (
        load_charter(scope="account", scope_id=owner_id) if owner_id else {}
    )

    explicit = _as_bool(payload.get("reuseCharter"))
    if explicit is None:
        explicit = _as_bool(payload.get("reuse_charter"))

    if explicit is None:
        opt_in = bool(getattr(state, "charterReuseNext", False))
        if not opt_in:
            # 「下一场沿用」落在账户 reuse_next 上。这是旗，不是「库里有文档」。
            opt_in = bool((stored_account or {}).get("reuse_next"))
    else:
        opt_in = explicit

    if not incoming:
        if opt_in:
            incoming = normalize_charter(
                (stored_session or {}).get("charter")
            ) or normalize_charter((stored_account or {}).get("charter"))
        else:
            incoming = normalize_charter((stored_session or {}).get("charter"))

    if incoming and session_id:
        save_charter(
            scope="session",
            scope_id=session_id,
            charter=incoming,
            reuse_next=opt_in,
        )
    if explicit is not None and owner_id:
        # 只在确认按钮带了 reuseCharter 时改账户旗。其它回合缺字段不得把
        # 「下一场沿用」清掉——否则一次问候就把跨场记忆抹了。
        account_charter = incoming or normalize_charter(
            (stored_account or {}).get("charter")
        )
        save_charter(
            scope="account",
            scope_id=owner_id,
            charter=account_charter,
            reuse_next=opt_in,
        )

    _write_state(state, incoming, opt_in)
    set_charter_context(incoming, opt_in=opt_in)
