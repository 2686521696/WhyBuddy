"""
Durable SlideRule V5 session store.

The on-disk contract intentionally matches the Node durable pilot:
JSON array entries of ``[sessionId, V5SessionState]``. The reader also accepts
the older Python mapping shape so existing local dev files can be recovered.
"""

import json
import os
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
    try:
        return V5SessionState(**raw), None
    except (TypeError, ValidationError, ValueError) as error:
        return None, _store_error("invalid_session", str(error).splitlines()[0])


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
    sessions, error = _read_store(store_file)
    if error:
        return error
    sessions[state.sessionId] = state
    result = _write_store(sessions, store_file)
    if not result.get("ok"):
        return result
    return {"ok": True, "sessionId": state.sessionId}


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
