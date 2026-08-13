"""
Durable SlideRule V5 session store.

The on-disk contract intentionally matches the Node durable pilot:
JSON array entries of ``[sessionId, V5SessionState]``. The reader also accepts
the older Python mapping shape so existing local dev files can be recovered.

## 2026-08-02：会话可以落库了

配了 ``APP_STORE_DATABASE_URL`` 时，会话与应用记录进同一个库（见
``services/session_blob_store``）。动机是线上那个「应用中心 23 个应用、点开
18 个空白页」——应用记录跨机器共享，会话却每台机器一份，指针自然断掉。

**本文件的判定逻辑一行没改**：lastTurnId 单调守卫、replay/reasoning 追加合并、
读不回的条目原样保留，全部照旧。换掉的只是「从哪读 prior、往哪写一条」。

两处顺带的收益：
  · 原来每次保存要把整个存档读出来再整个写回去，一轮推演内持久化好几次；
    现在按条读写。
  · 显式传 ``store_file`` 的调用（测试、逃生口）永远走文件，不受库配置影响。

并发保护从「一把进程锁」升级成「进程锁 + 行级 CAS」：库是共享的，开发机和
服务器是两个进程，光靠进程锁挡不住。CAS 失败就重读重算（见 _MAX_CAS_RETRY）。
"""

import json
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from pydantic import ValidationError

from models.v5_state import V5SessionState

STORE_FILE = "data/sliderule-sessions.json"
STORE_FILE_ENV = "SLIDERULE_SESSIONS_FILE"
LEGACY_STORE_FILE_ENV = "WHYBUDDY_SESSIONS_FILE"

StorePath = Union[str, os.PathLike[str]]
StoreError = Dict[str, Any]


def _resolve_store_file(store_file: Optional[StorePath] = None) -> Path:
    if store_file is not None:
        return Path(store_file)
    env_file = os.getenv(STORE_FILE_ENV) or os.getenv(LEGACY_STORE_FILE_ENV)
    return Path(env_file or STORE_FILE)


def _store_error(reason: str, message: str) -> StoreError:
    return {
        "ok": False,
        "error": "store_corrupt",
        "reason": reason,
        "message": message,
    }


def _coerce_state(session_id: str, payload: Any) -> Tuple[Optional[V5SessionState], Optional[StoreError]]:
    if not isinstance(payload, dict):
        return None, _store_error("invalid_shape", f"session {session_id} is not an object")
    raw = {**payload, "sessionId": payload.get("sessionId") or session_id}
    # Round-trip repair: the drive path (interactive gates merge_gap_ask_into_state) may set a
    # partial coverageContract like {"blockingGapIds": [...]} on the in-memory state. That is a
    # legitimate server-produced shape, but CoverageContract requires id/requiredCapabilities, so
    # a persisted session carrying it would fail server_load and poison the whole store read.
    # Fill the missing required fields with neutral defaults so server-written state always reads back.
    contract = raw.get("coverageContract")
    if isinstance(contract, dict) and contract and ("id" not in contract or "requiredCapabilities" not in contract):
        raw["coverageContract"] = {
            "id": contract.get("id") or f"contract-{raw['sessionId']}",
            "requiredCapabilities": contract.get("requiredCapabilities") or [],
            **{k: v for k, v in contract.items() if k not in ("id", "requiredCapabilities")},
        }
    try:
        return V5SessionState.server_load(raw), None
    except (TypeError, ValidationError, ValueError) as error:
        return None, _store_error("invalid_session", str(error).splitlines()[0])


def _monotonic_key(state: V5SessionState) -> tuple:
    """Compute comparable (newer > older) key using ONLY lastTurnId numeric as version.
    This provides the version guard (lastTurnId as monotonic version) for concurrent save protection.
    Timestamp-equivalent ordering for equal lastTurnId uses serialized lock arrival (first commit wins).
    Replay/cap/ledger counts are append-only server history and MUST NOT be used
    to decide full-state clobber (prevents old snapshot with inflated replay count
    from overwriting committed goal/conversation/artifacts/ledgers at same lastTurnId).
    lastTurnId is the authority progression signal for V5.2 guard.
    """
    lt = getattr(state, "lastTurnId", None) or ""
    m = re.search(r"(\d+)", str(lt))
    turn_num = int(m.group(1)) if m else 0
    return (turn_num,)


def _id_set(items: Any) -> set:
    ids = set()
    for it in items or []:
        iid = it.get("id") if isinstance(it, dict) else getattr(it, "id", None)
        if iid:
            ids.add(iid)
    return ids


def _is_same_turn_progress(prior: V5SessionState, incoming: V5SessionState) -> bool:
    """Distinguish the driver's own mid-turn incremental saves (legitimate progress at the
    SAME lastTurnId) from stale same-turn snapshots (which must stay blocked).

    drive_reasoning_turn / drive_full persist several times within one turn for browser poll
    visibility (start emit, capability_start, capability_complete/commit, phase decision).
    Those saves are strictly append-only: every server-owned collection of the prior state is
    contained in the incoming state, and at least one collection (artifacts, capabilityRuns,
    conversation, reasoningEvents, sessionReplayLog) has grown. A stale snapshot is missing
    prior committed data (subset check fails), and an equal-content snapshot (no growth) still
    retains the prior core — so review finding 1 (same-turn stale must not clobber goal/
    conversation/artifacts/ledgers) is preserved, while the drive loop's own commits are no
    longer dropped on the reload-after-save path.
    """
    prior_arts = _id_set(getattr(prior, "artifacts", None))
    inc_arts = _id_set(getattr(incoming, "artifacts", None))
    if not prior_arts.issubset(inc_arts):
        return False
    prior_runs = _id_set(getattr(prior, "capabilityRuns", None))
    inc_runs = _id_set(getattr(incoming, "capabilityRuns", None))
    if not prior_runs.issubset(inc_runs):
        return False
    prior_conv = len(getattr(prior, "conversation", None) or [])
    inc_conv = len(getattr(incoming, "conversation", None) or [])
    if inc_conv < prior_conv:
        return False
    # Strict growth in at least one server-owned collection marks real progress.
    if len(inc_arts) > len(prior_arts) or len(inc_runs) > len(prior_runs) or inc_conv > prior_conv:
        return True
    if _id_set(getattr(incoming, "reasoningEvents", None)) - _id_set(getattr(prior, "reasoningEvents", None)):
        return True
    if _id_set(getattr(incoming, "sessionReplayLog", None)) - _id_set(getattr(prior, "sessionReplayLog", None)):
        return True
    return False


# Serialized guard lock for save_session_record: ensures read-prior / decide / write is atomic
# wrt other concurrent save calls (addresses concurrent RMW races). Re-read inside lock
# sees prior writers' results. Combined with lastTurnId<= compare this provides version/timestamp-equivalent
# guard (lastTurnId as version; lock order for equal-turn) using existing fields (no extra deps, no schema change).
_save_lock = threading.Lock()

# CAS 冲突重试次数。冲突只在「另一个进程/机器刚好写了同一个会话」时发生，
# 重试一次基本就过了；给 3 次是留余量。用尽仍冲突就如实返回错误，不静默丢写入。
_MAX_CAS_RETRY = 3


def _blob_store(store_file: Optional[StorePath] = None):
    """选存储后端。返回 None 表示走文件（本文件下半部分那套实现）。

    显式传了 ``store_file`` 一律走文件：测试和「这台机器就要用这个文件」的
    逃生口都靠这条规则，绝不能被全局库配置改掉行为。
    """
    if store_file is not None:
        return None
    from . import session_blob_store

    store = session_blob_store.get_store()
    if store is not None:
        _import_local_once(store)
    return store


_import_attempted = False


#: 本机文件存档 → 库的自动导入开关。**默认关**（2026-08-13 改）。
#:
#: ## 为什么从"默认开"改成"默认关"
#:
#: 这段原本是一次性的迁移辅助：换到查库那版时，磁盘上原有的会话得搬进去，
#: 否则「数据还在，界面上却没了」。迁移早就完成了，但这段代码一直留着——
#: 于是它从"救命的"变成了"埋雷的"。
#:
#: 2026-08-13 实际炸了一次：本地起了一个进程、加载的是**生产 .env**，
#: 这段就把 data/sliderule-sessions.json 里 21 条**早就清掉的**旧会话
#: 原样推回了生产库。用户在线上又看见了本该没有的数据。
#: 日志里明明白白写着「新增 21 条」，但它长得跟启动噪音一模一样，没人会停下来看。
#:
#: 这个方向天然是危险的：**本地文件是陈旧副本，库才是真相**，而这段代码
#: 让陈旧副本单向地往真相里写。它"只插不改"保护的是"库里已有的那条"，
#: 保护不了"库里已经被删掉的那条"——删除在它眼里跟"还没导入"长得一样。
#:
#: 现在的口径：**一切走库，本地文件不回灌**。真要做一次性迁移，显式打开
#: 这个开关跑一次，别让它常驻在启动路径上。
_LOCAL_IMPORT_ENV = "SLIDERULE_SESSION_LOCAL_IMPORT"


def _local_import_enabled() -> bool:
    return (os.getenv(_LOCAL_IMPORT_ENV) or "").strip().lower() in {"1", "true", "yes", "on"}


def _import_local_once(store) -> None:
    """把本机文件存档里库中还没有的会话搬进库。**默认不跑**，见上面那段。

    只插不改：库里已有的那条永远更权威（本地文件可能是很旧的副本）。
    """
    global _import_attempted
    if not _local_import_enabled():
        return
    if _import_attempted:
        return
    _import_attempted = True
    try:
        from . import session_blob_store

        local, error = _read_store_file()
        if error or not local:
            return
        session_blob_store.import_local_file_once(
            {sid: state.model_dump() for sid, state in local.items()}
        )
    except Exception as exc:  # noqa: BLE001 — 导入失败不能拖垮启动
        print(f"[persistence] 本机会话导入库失败（不影响运行）: {str(exc)[:200]}")


def _reset_import_flag_for_tests() -> None:
    global _import_attempted
    _import_attempted = False


def _coerce_many(payloads: Dict[str, Any]) -> Dict[str, V5SessionState]:
    """库里读出来的原始 payload → V5SessionState。

    单条读不回就跳过（与文件后端同一条纪律：绝不因一条坏记录毒化整个列表），
    但**不需要**文件后端那套 `_unreadable_by_path` 暂存——库是按条写的，
    没被写到的行原样留在库里，本来就不会丢。
    """
    out: Dict[str, V5SessionState] = {}
    bad: list[str] = []
    for sid, payload in payloads.items():
        state, error = _coerce_state(sid, payload)
        if error:
            bad.append(sid)
            continue
        out[sid] = state
    if bad:
        print(
            f"[persistence] WARN: {len(bad)} 条库内会话读不回、已跳过"
            f"（原样留在库里，未删）: {', '.join(bad[:5])}"
        )
    return out


def _read_store(store_file: Optional[StorePath] = None) -> Tuple[Dict[str, V5SessionState], Optional[StoreError]]:
    """读全量。配了库就读库，否则读文件。"""
    store = _blob_store(store_file)
    if store is not None:
        try:
            return _coerce_many(store.load_all()), None
        except Exception as exc:  # noqa: BLE001 — 库读失败按存档损坏处理，调用方各自兜底
            return {}, _store_error("db_read_failed", str(exc)[:200])
    return _read_store_file(store_file)


def _read_store_file(store_file: Optional[StorePath] = None) -> Tuple[Dict[str, V5SessionState], Optional[StoreError]]:
    path = _resolve_store_file(store_file)
    if not path.exists():
        return {}, None

    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else []
    except json.JSONDecodeError as error:
        return {}, _store_error("invalid_json", error.msg)
    except OSError as error:
        return {}, _store_error("read_failed", str(error))

    sessions: Dict[str, V5SessionState] = {}
    unreadable: List[Tuple[str, Any]] = []
    if isinstance(data, list):
        for entry in data:
            if not isinstance(entry, list) or len(entry) != 2 or not isinstance(entry[0], str):
                return {}, _store_error("invalid_shape", "expected [sessionId, state] entries")
            state, error = _coerce_state(entry[0], entry[1])
            if error:
                # 单条读不回（旧 schema/字段漂移）：跳过但原样保留（写回时按
                # 原字节带上），绝不因一条坏记录毒化整个存档（实测踩过：一条
                # 旧 marathon 会话让所有增删改查 500）。也绝不静默删除。
                unreadable.append((entry[0], entry[1]))
                continue
            sessions[entry[0]] = state
        _remember_unreadable(path, unreadable)
        return sessions, None

    if isinstance(data, dict):
        for session_id, payload in data.items():
            if not isinstance(session_id, str):
                return {}, _store_error("invalid_shape", "expected string session ids")
            state, error = _coerce_state(session_id, payload)
            if error:
                unreadable.append((session_id, payload))
                continue
            sessions[session_id] = state
        _remember_unreadable(path, unreadable)
        return sessions, None

    return {}, _store_error("invalid_shape", "expected array entries or mapping")


# 读不回的条目按存档路径暂存（进程内），写回时原样带上——保数据不保解析。
_unreadable_by_path: Dict[str, List[Tuple[str, Any]]] = {}


def _remember_unreadable(path: Path, unreadable: List[Tuple[str, Any]]) -> None:
    _unreadable_by_path[str(path)] = unreadable
    if unreadable:
        ids = ", ".join(sid for sid, _ in unreadable[:5])
        print(f"[persistence] WARN: {len(unreadable)} unreadable session(s) skipped, preserved verbatim: {ids}")


def _write_store(sessions: Dict[str, V5SessionState], store_file: Optional[StorePath] = None) -> StoreError:
    path = _resolve_store_file(store_file)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.tmp")
        payload = [[session_id, state.model_dump()] for session_id, state in sessions.items()]
        # 读不回的旧条目原样写回（除非同 id 已被新状态取代），不静默丢数据
        for sid, raw_payload in _unreadable_by_path.get(str(path), []):
            if sid not in sessions:
                payload.append([sid, raw_payload])
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as error:
        return {"ok": False, "error": "persist_failed", "reason": "write_failed", "message": str(error)}
    return {"ok": True, "count": len(sessions)}


# ── 会话活跃时间 sidecar ─────────────────────────────────────────────────────
# 存档条目是 [sessionId, state]，state 模型没有时间字段（加字段会动全量
# schema/version 语义）。侧栏"最近"排序需要 lastActive，用旁路 meta 文件
# （<store>.meta.json：sessionId → {"lastActive": iso}）每次成功落盘时盖章。
# 纯观测元数据：读写全容错，坏了/丢了只影响排序，绝不影响会话数据本身。


def _meta_path(store_file: Optional[StorePath] = None) -> Path:
    path = _resolve_store_file(store_file)
    return path.with_name(path.name + ".meta.json")


def read_session_meta(store_file: Optional[StorePath] = None) -> Dict[str, Dict[str, Any]]:
    """会话的 createdAt / lastActive。

    库后端不用 sidecar 文件——同一行上就有 created_at / last_active 两列，
    每次写入顺带盖章（见 session_blob_store 的 save）。sidecar 那套是文件后端
    的产物：存档条目是 [sessionId, state]，state 模型里没有时间字段。
    """
    store = _blob_store(store_file)
    if store is not None:
        try:
            return store.meta()
        except Exception:  # noqa: BLE001 — 纯观测数据，取不到只影响排序
            return {}
    try:
        raw = json.loads(_meta_path(store_file).read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _stamp_session_meta(session_id: str, store_file: Optional[StorePath] = None) -> None:
    from datetime import datetime, timezone

    try:
        meta = read_session_meta(store_file)
        entry = meta.get(session_id) if isinstance(meta.get(session_id), dict) else {}
        now = datetime.now(timezone.utc).isoformat()
        entry = {**entry, "lastActive": now}
        entry.setdefault("createdAt", now)
        meta[session_id] = entry
        _meta_path(store_file).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _drop_session_meta(session_id: str, store_file: Optional[StorePath] = None) -> None:
    try:
        meta = read_session_meta(store_file)
        if session_id in meta:
            meta.pop(session_id, None)
            _meta_path(store_file).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def load_all(store_file: Optional[StorePath] = None) -> Dict[str, V5SessionState]:
    sessions, error = _read_store(store_file)
    if error:
        return {}
    return sessions


def save_all(sessions: Dict[str, V5SessionState], store_file: Optional[StorePath] = None) -> StoreError:
    return _write_store(sessions, store_file)


def save_session_record(state: V5SessionState, store_file: Optional[StorePath] = None) -> StoreError:
    # Use lock to serialize the entire read-prior + replay-merge + monotonic compare + write.
    # This ensures that on concurrent saves, each entrant re-reads the *latest* committed
    # prior (after previous writer's atomic replace), then decides using current prior.
    # Replay append-only merge ALWAYS happens from latest prior (server-owned history preserved).
    # Core authoritative fields (goal, conversation, artifacts, ledgers, lastTurnId etc) are
    # protected by lastTurnId (version) + <= compare: same-turn or lower cannot overwrite.
    # counts of replay etc never allow clobber. Fixes review finding 1 (no equal-turn clobber).
    # Serialized lock provides timestamp-equivalent ordering for same lastTurnId.
    store = _blob_store(store_file)
    if store is not None:
        return _save_session_record_db(store, state)
    with _save_lock:
        sessions, error = _read_store_file(store_file)
        if error:
            return error

        prior = sessions.get(state.sessionId)
        write_state = _resolve_write_state(prior, state)
        sessions[write_state.sessionId] = write_state
        result = _write_store(sessions, store_file)
        if not result.get("ok"):
            return result
        _stamp_session_meta(write_state.sessionId, store_file)
        return {"ok": True, "sessionId": write_state.sessionId}


def _resolve_write_state(
    prior: Optional[V5SessionState], state: V5SessionState
) -> V5SessionState:
    """决定这次到底该把什么写下去——**判定逻辑的唯一副本**。

    文件后端和库后端都调它。历史上这段是内联在 save_session_record 里的；
    会话落库时抽出来共用，逻辑逐行照搬，没有任何行为改动。

    两件事：
      ① replay / reasoning 事件按 id 追加合并（服务端历史只增不减）；
      ② lastTurnId 单调守卫决定核心字段能不能被覆盖。
    """
    if True:
        # Append-only replay log merge on save (sliderule-python-v52-session-replay-append-only-105)
        # Classification: ... -> PYTHON_COMPAT -> PYTHON_AUTHORITY
        # Read existing replay from durable store and merge (preserve prior + additive new by id);
        # prevents partial/stale/empty replay from client or in-mem snapshot from overwriting server-owned replay.
        # Matches V5.2 append-only intent (no clobber on save); reasoningEvents treated same.
        # Python owns this durability/readback slice; no Node fallback.
        prior_log = list(getattr(prior, "sessionReplayLog", []) or []) if prior else []
        seen = {getattr(e, "id", None) for e in prior_log if getattr(e, "id", None)}
        for ev in (getattr(state, "sessionReplayLog", []) or []):
            eid = getattr(ev, "id", None)
            if eid and eid not in seen:
                prior_log.append(ev)
        # reasoningEvents append-only merge (same server-owned append-only rule)
        prior_reas = list(getattr(prior, "reasoningEvents", []) or []) if prior else []
        seen_r = {getattr(e, "id", None) for e in prior_reas if getattr(e, "id", None)}
        for ev in (getattr(state, "reasoningEvents", []) or []):
            eid = getattr(ev, "id", None)
            if eid and eid not in seen_r:
                prior_reas.append(ev)

        # Produce candidate that carries server-merged replay/reasoning (append-only never loses)
        try:
            merged_logs_state = state.model_copy(update={"sessionReplayLog": prior_log, "reasoningEvents": prior_reas})
        except Exception:
            # fallback: mutate copy of incoming only if needed (rare)
            try:
                state.sessionReplayLog = prior_log  # type: ignore[attr-defined]
                state.reasoningEvents = prior_reas  # type: ignore[attr-defined]
            except Exception:
                pass
            merged_logs_state = state

        # Version/timestamp-equivalent guard (sliderule-python-v52-session-concurrency-guard-105):
        # lastTurnId ONLY decides core clobber (goal/conversation/artifacts/ledgers/...).
        # Replay counts etc are excluded from key and from clobber decision (per review finding 1).
        # Under lock + re-read, serialized: inc turn <= prior turn blocks core overwrite (stale cannot clobber);
        # this protects same-lastTurnId concurrent/sequential stale snapshots (later arriver under lock loses for core).
        # Higher turn accepts inc core + merged replay/reasoning logs (append-only always).
        # Equal-turn uses first-under-lock as timestamp order (no later same-turn stale wins).
        # This ensures lower or same-turn snapshot cannot overwrite newer authoritative state.
        # Classification: PYTHON_AUTHORITY. No Node fallback.
        write_state = merged_logs_state
        if prior:
            p_lt = getattr(prior, "lastTurnId", None)
            i_lt = getattr(state, "lastTurnId", None)
            if p_lt and i_lt:
                p_turn = _monotonic_key(prior)[0]
                i_turn = _monotonic_key(state)[0]  # use original incoming turn, not affected by logs
                # Equal-turn saves that are append-only supersets of prior (the drive loop's own
                # incremental persists within one turn) are ACCEPTED as progress; only lower-turn
                # or same-turn non-superset/no-growth snapshots retain the prior core.
                if i_turn < p_turn or (i_turn == p_turn and not _is_same_turn_progress(prior, state)):
                    # lower or stale-equal turn (when version present): retain prior authoritative core fields (prevents same-turn stale clobber);
                    # still carry any newly appended server-owned replay/reasoning from this attempt
                    projection_updates: Dict[str, Any] = {}
                    if getattr(state, "publishClosure", None) is not None:
                        projection_updates["publishClosure"] = getattr(state, "publishClosure", None)
                    if getattr(state, "skillRuntimeGraph", None) is not None:
                        projection_updates["skillRuntimeGraph"] = getattr(state, "skillRuntimeGraph", None)
                    # E29 版本史是服务端专有投影（客户端快照不携带，不得清空）
                    if getattr(state, "modelVersions", None):
                        projection_updates["modelVersions"] = getattr(state, "modelVersions", None)
                        projection_updates["currentModelVersionId"] = getattr(state, "currentModelVersionId", None)
                    # E13 turnNarrations 是展示投影（同 publishClosure 类）：客户端
                    # 轮末回传时 lastTurnId 与驱动器终持久化相同且核心无增长，
                    # 不豁免会被同轮守卫连快照一起丢掉
                    if getattr(state, "turnNarrations", None):
                        projection_updates["turnNarrations"] = getattr(state, "turnNarrations", None)
                    try:
                        write_state = prior.model_copy(
                            update={
                                "sessionReplayLog": prior_log,
                                "reasoningEvents": prior_reas,
                                **projection_updates,
                            }
                        )
                    except Exception:
                        write_state = prior
        return write_state


def _save_session_record_db(store, state: V5SessionState) -> StoreError:
    """库后端的写入：读一条 prior → 同一套守卫 → CAS 写回，冲突就重来。

    与文件后端的区别只有原子性来源：文件靠 `_save_lock`（单进程独占文件），
    库靠行级 `rev` 比对（库是共享的，进程锁挡不住另一台机器）。
    判定用的是同一个 `_resolve_write_state`。

    进程锁仍然套在外面——同机多线程冲突在锁里就化解了，不用去库上自旋。
    """
    with _save_lock:
        last_error = "CAS 冲突次数用尽"
        for _ in range(_MAX_CAS_RETRY):
            try:
                row = store.load(state.sessionId)
            except Exception as exc:  # noqa: BLE001
                return _store_error("db_read_failed", str(exc)[:200])

            prior: Optional[V5SessionState] = None
            if row is not None:
                coerced, error = _coerce_state(state.sessionId, row.payload)
                if error:
                    # 库里那条读不回（旧 schema/字段漂移）：当作没有 prior 处理，
                    # 让这次写入把它顶掉。文件后端会把坏条目原样保留，但那是因为
                    # 文件是整体重写、不留就等于删；库是按条写的，这里顶掉的只有
                    # 这一条，而它本来就已经读不出来了。
                    print(
                        f"[persistence] WARN: 库内会话 {state.sessionId} 读不回，"
                        f"本次写入将覆盖它: {error.get('message')}"
                    )
                else:
                    prior = coerced

            write_state = _resolve_write_state(prior, state)
            new_payload = write_state.model_dump()

            # 内容没变就别写（对标 django-reversion 的 ignore_duplicates）。
            # 这不是微优化：一轮推演里 save_session 被调 5~8 次，而守卫判定
            # 「这是陈旧快照」时会把 prior 原样写回去——那次写入必然是无效的，
            # 却照样要驮着约 300KB 跑一趟网络（实测单次全量写 129ms）。
            if row is not None and store.content_hash(new_payload) == store.content_hash(
                row.payload
            ):
                return {"ok": True, "sessionId": write_state.sessionId, "unchanged": True,
                        "state": write_state}

            try:
                ok = store.save(
                    write_state.sessionId,
                    new_payload,
                    expected_rev=row.rev if row is not None else None,
                )
            except Exception as exc:  # noqa: BLE001
                return {
                    "ok": False,
                    "error": "persist_failed",
                    "reason": "db_write_failed",
                    "message": str(exc)[:200],
                }
            if ok:
                # 把刚写下去的状态一并返回：调用方（slide_rule_session.save_session）
                # 本来要再 load 一次来对账，而这里手上就是权威结果——省掉的是
                # 每次 save 的第三趟全量往返（实测 264ms → 约 180ms）。
                return {"ok": True, "sessionId": write_state.sessionId, "state": write_state}
            # 写不进去 = 这一瞬间别人改过同一条。重读重算——注意必须重新过一遍
            # 守卫，不能拿刚才算好的 write_state 硬写，否则就把别人的提交冲掉了。
        return {
            "ok": False,
            "error": "persist_failed",
            "reason": "cas_conflict",
            "message": last_error,
            "sessionId": state.sessionId,
        }


def load_session_record(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    store = _blob_store(store_file)
    if store is not None:
        try:
            row = store.load(session_id)
        except Exception as exc:  # noqa: BLE001
            return {**_store_error("db_read_failed", str(exc)[:200]), "sessionId": session_id}
        if row is None:
            return {"ok": False, "error": "not_found", "sessionId": session_id}
        state, error = _coerce_state(session_id, row.payload)
        if error:
            return {**error, "sessionId": session_id}
        return {"ok": True, "sessionId": session_id, "session": state}
    return _load_session_record_file(session_id, store_file)


def _load_session_record_file(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    sessions, error = _read_store_file(store_file)
    if error:
        return {**error, "sessionId": session_id}
    state = sessions.get(session_id)
    if state is None:
        return {"ok": False, "error": "not_found", "sessionId": session_id}
    return {"ok": True, "sessionId": session_id, "session": state}


def list_session_records(store_file: Optional[StorePath] = None) -> StoreError:
    sessions, error = _read_store(store_file)
    if error:
        return error
    meta = read_session_meta(store_file)
    return {
        "ok": True,
        "sessions": [
            {
                "sessionId": state.sessionId,
                "goal": state.goal.get("text", "") if isinstance(state.goal, dict) else "",
                "createdAt": (meta.get(state.sessionId) or {}).get("createdAt"),
                "lastActive": (meta.get(state.sessionId) or {}).get("lastActive"),
                "artifactCount": len(state.artifacts or []),
                "phase": getattr(state, "runtimePhase", None),
            }
            for state in sessions.values()
        ],
    }


def delete_session_record(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    store = _blob_store(store_file)
    if store is not None:
        try:
            store.delete(session_id)  # 幂等：删不存在的也算成功（G1 契约）
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "error": "persist_failed",
                "reason": "db_delete_failed",
                "message": str(exc)[:200],
                "sessionId": session_id,
            }
        return {"ok": True, "sessionId": session_id}
    sessions, error = _read_store_file(store_file)
    if error:
        return {**error, "sessionId": session_id}
    sessions.pop(session_id, None)
    result = _write_store(sessions, store_file)
    if not result.get("ok"):
        return result
    _drop_session_meta(session_id, store_file)
    return {"ok": True, "sessionId": session_id}


def persist_state(state: V5SessionState):
    return save_session_record(state)
