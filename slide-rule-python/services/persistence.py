"""
Durable SlideRule V5 session store.

The on-disk contract intentionally matches the Node durable pilot:
JSON array entries of ``[sessionId, V5SessionState]``. The reader also accepts
the older Python mapping shape so existing local dev files can be recovered.
"""

import json
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

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


def _read_store(store_file: Optional[StorePath] = None) -> Tuple[Dict[str, V5SessionState], Optional[StoreError]]:
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
    if isinstance(data, list):
        for entry in data:
            if not isinstance(entry, list) or len(entry) != 2 or not isinstance(entry[0], str):
                return {}, _store_error("invalid_shape", "expected [sessionId, state] entries")
            state, error = _coerce_state(entry[0], entry[1])
            if error:
                return {}, error
            sessions[entry[0]] = state
        return sessions, None

    if isinstance(data, dict):
        for session_id, payload in data.items():
            if not isinstance(session_id, str):
                return {}, _store_error("invalid_shape", "expected string session ids")
            state, error = _coerce_state(session_id, payload)
            if error:
                return {}, error
            sessions[session_id] = state
        return sessions, None

    return {}, _store_error("invalid_shape", "expected array entries or mapping")


def _write_store(sessions: Dict[str, V5SessionState], store_file: Optional[StorePath] = None) -> StoreError:
    path = _resolve_store_file(store_file)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.tmp")
        payload = [[session_id, state.model_dump()] for session_id, state in sessions.items()]
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as error:
        return {"ok": False, "error": "persist_failed", "reason": "write_failed", "message": str(error)}
    return {"ok": True, "count": len(sessions)}


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
    with _save_lock:
        sessions, error = _read_store(store_file)
        if error:
            return error

        # Append-only replay log merge on save (sliderule-python-v52-session-replay-append-only-105)
        # Classification: ... -> PYTHON_COMPAT -> PYTHON_AUTHORITY
        # Read existing replay from durable store and merge (preserve prior + additive new by id);
        # prevents partial/stale/empty replay from client or in-mem snapshot from overwriting server-owned replay.
        # Matches V5.2 append-only intent (no clobber on save); reasoningEvents treated same.
        # Python owns this durability/readback slice; no Node fallback.
        prior = sessions.get(state.sessionId)
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
        sessions[write_state.sessionId] = write_state
        result = _write_store(sessions, store_file)
        if not result.get("ok"):
            return result
        return {"ok": True, "sessionId": write_state.sessionId}


def load_session_record(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    sessions, error = _read_store(store_file)
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
    return {
        "ok": True,
        "sessions": [
            {
                "sessionId": state.sessionId,
                "goal": state.goal.get("text", "") if isinstance(state.goal, dict) else "",
                "createdAt": getattr(state, "createdAt", None),
                "lastActive": getattr(state, "lastActive", None),
                "artifactCount": len(state.artifacts or []),
                "phase": getattr(state, "runtimePhase", None),
            }
            for state in sessions.values()
        ],
    }


def delete_session_record(session_id: str, store_file: Optional[StorePath] = None) -> StoreError:
    sessions, error = _read_store(store_file)
    if error:
        return {**error, "sessionId": session_id}
    sessions.pop(session_id, None)
    result = _write_store(sessions, store_file)
    if not result.get("ok"):
        return result
    return {"ok": True, "sessionId": session_id}


def persist_state(state: V5SessionState):
    return save_session_record(state)
