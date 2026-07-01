"""Python-owned A2A registry and session runtime + stream/cancel transport.

Registry mutation (register/list/get_agent) and session persistence
(create/read/update/list_active/terminate) are implemented here with file-backed
stores. Stream chunks, cancel (idempotent), timeout, retry envelope, and
malformed handling now Python-owned runtime (task 47/48). Error, retry, and
cancel semantics centralized via create_a2a_error + dedicated transport funcs.
Node a2a-server/client/routes act only as thin proxies or explicit compatibility
shells delegating to Python. Contract projection retained for compat; real
transport uses side-effecting store funcs.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


A2A_RUNTIME_CONTRACT_VERSION = "a2a.runtime.v1"
A2A_RUNTIME_NAME = "python-contract"

A2A_ERROR_CANCELLED = -32005
A2A_ERROR_FRAMEWORK = -32006

def create_a2a_error(code: int, message: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Python-owned central A2A error factory for error, retry, and cancel semantics.
    Ensures consistent shape + provenance attachment in transport paths.
    Used by cancel/retry/malformed/timeout error cases so Node thin proxy sees Python source.
    """
    err: Dict[str, Any] = {"code": int(code), "message": message}
    if data is not None:
        err["data"] = data
    return err

A2ARuntimeOperation = Literal["invoke", "stream_chunk", "cancel", "list_agents"]
A2AFrameworkType = Literal["crewai", "langgraph", "claude", "custom"]
A2AMethod = Literal["a2a.invoke", "a2a.stream", "a2a.cancel"]
A2ASessionStatus = Literal["pending", "running", "completed", "failed", "cancelled"]


def _non_empty(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


class A2AInvokeParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targetAgent: str
    task: str
    context: str
    capabilities: List[str] = Field(default_factory=list)
    streamMode: bool

    @field_validator("targetAgent", "task")
    @classmethod
    def _validate_required_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class A2AEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jsonrpc: Literal["2.0"] = "2.0"
    method: A2AMethod
    id: str
    params: A2AInvokeParams
    auth: Optional[str] = None

    @field_validator("id", "auth")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class A2AArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    type: str
    content: str

    @field_validator("name", "type")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class A2AResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    output: str
    artifacts: List[A2AArtifact] = Field(default_factory=list)
    metadata: Dict[str, str] = Field(default_factory=dict)


class A2AError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: int
    message: str
    data: Optional[Any] = None

    @field_validator("message")
    @classmethod
    def _validate_message(cls, value: str) -> str:
        return _non_empty(value)


class A2AResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jsonrpc: Literal["2.0"] = "2.0"
    id: str
    result: Optional[A2AResult] = None
    error: Optional[A2AError] = None

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_result_or_error(self) -> "A2AResponse":
        if (self.result is None) == (self.error is None):
            raise ValueError("response must contain exactly one of result or error")
        return self


class A2AStreamChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jsonrpc: Literal["2.0"] = "2.0"
    id: str
    chunk: str
    done: bool

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        return _non_empty(value)


class A2ASession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessionId: str
    requestEnvelope: A2AEnvelope
    status: A2ASessionStatus
    frameworkType: A2AFrameworkType
    startedAt: int
    completedAt: Optional[int] = None
    response: Optional[A2AResponse] = None
    streamChunks: List[A2AStreamChunk] = Field(default_factory=list)

    @field_validator("sessionId")
    @classmethod
    def _validate_session_id(cls, value: str) -> str:
        return _non_empty(value)

    @model_validator(mode="after")
    def _validate_session_identity(self) -> "A2ASession":
        if self.sessionId != self.requestEnvelope.id:
            raise ValueError("sessionId must match requestEnvelope.id")
        if self.response is not None and self.response.id != self.requestEnvelope.id:
            raise ValueError("response.id must match requestEnvelope.id")
        for chunk in self.streamChunks:
            if chunk.id != self.requestEnvelope.id:
                raise ValueError("stream chunk id must match requestEnvelope.id")
        return self


class A2AExposedAgentInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    capabilities: List[str] = Field(default_factory=list)
    description: str

    @field_validator("id", "name", "description")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class A2ARuntimeBaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[A2A_RUNTIME_CONTRACT_VERSION] = A2A_RUNTIME_CONTRACT_VERSION
    runtime: Literal[A2A_RUNTIME_NAME] = A2A_RUNTIME_NAME
    operation: A2ARuntimeOperation
    ok: bool
    status: str


class A2ARuntimeInvokeResult(A2ARuntimeBaseResult):
    operation: Literal["invoke"] = "invoke"
    ok: Literal[True] = True
    status: Literal["completed"] = "completed"
    envelope: A2AEnvelope
    response: A2AResponse
    session: A2ASession

    @model_validator(mode="after")
    def _validate_invoke_completed(self) -> "A2ARuntimeInvokeResult":
        if self.envelope.method != "a2a.invoke":
            raise ValueError("invoke result requires a2a.invoke envelope")
        if self.response.id != self.envelope.id or self.response.result is None:
            raise ValueError("invoke result requires successful matching response")
        if self.session.requestEnvelope != self.envelope:
            raise ValueError("session requestEnvelope must match envelope")
        if self.session.status != "completed":
            raise ValueError("invoke result requires completed session")
        if self.session.response != self.response:
            raise ValueError("session.response must match response")
        return self


class A2ARuntimeStreamChunkResult(A2ARuntimeBaseResult):
    operation: Literal["stream_chunk"] = "stream_chunk"
    ok: Literal[True] = True
    status: Literal["streaming", "completed"]
    envelope: A2AEnvelope
    streamChunk: A2AStreamChunk
    session: A2ASession

    @model_validator(mode="after")
    def _validate_stream_chunk(self) -> "A2ARuntimeStreamChunkResult":
        if self.envelope.method != "a2a.stream":
            raise ValueError("stream_chunk result requires a2a.stream envelope")
        if self.streamChunk.id != self.envelope.id:
            raise ValueError("streamChunk.id must match envelope.id")
        if self.session.requestEnvelope != self.envelope:
            raise ValueError("session requestEnvelope must match envelope")
        expected_status = "completed" if self.streamChunk.done else "running"
        expected_result_status = "completed" if self.streamChunk.done else "streaming"
        if self.status != expected_result_status:
            raise ValueError("stream result status must match chunk.done")
        if self.session.status != expected_status:
            raise ValueError("stream session status must match chunk.done")
        if not self.session.streamChunks or self.session.streamChunks[-1] != self.streamChunk:
            raise ValueError("stream session must include the emitted chunk")
        return self


class A2ARuntimeCancelResult(A2ARuntimeBaseResult):
    operation: Literal["cancel"] = "cancel"
    ok: Literal[False] = False
    status: Literal["cancelled"] = "cancelled"
    envelope: A2AEnvelope
    error: A2AError
    response: A2AResponse
    session: A2ASession

    @model_validator(mode="after")
    def _validate_cancelled(self) -> "A2ARuntimeCancelResult":
        if self.envelope.method != "a2a.cancel":
            raise ValueError("cancel result requires a2a.cancel envelope")
        if self.error.code != A2A_ERROR_CANCELLED:
            raise ValueError("cancel result requires cancelled error code")
        if self.response.id != self.envelope.id or self.response.error != self.error:
            raise ValueError("cancel response must preserve error")
        if self.session.status != "cancelled":
            raise ValueError("cancel result requires cancelled session")
        if self.session.response != self.response:
            raise ValueError("session.response must match cancel response")
        return self


class A2ARuntimeFailureResult(A2ARuntimeBaseResult):
    operation: Literal["invoke", "stream_chunk"]
    ok: Literal[False] = False
    status: Literal["failed"] = "failed"
    envelope: Optional[A2AEnvelope] = None
    error: A2AError
    response: Optional[A2AResponse] = None
    session: Optional[A2ASession] = None

    @model_validator(mode="after")
    def _validate_failure(self) -> "A2ARuntimeFailureResult":
        if self.response is not None and self.response.result is not None:
            raise ValueError("failed result cannot contain successful response")
        if self.session is not None and self.session.status != "failed":
            raise ValueError("failed result requires failed session")
        return self


class A2ARuntimeListAgentsResult(A2ARuntimeBaseResult):
    operation: Literal["list_agents"] = "list_agents"
    ok: Literal[True] = True
    status: Literal["completed"] = "completed"
    agents: List[A2AExposedAgentInfo]


# Python-owned registry and session store (file-backed for cross-process calls from Node thin proxy).
# This implements the required register/list/create/read/update/missing-agent behavior.
_REGISTRY_STORE: Path = Path("slide-rule-python/tmp/a2a_registry.json")
_SESSIONS_STORE: Path = Path("slide-rule-python/tmp/a2a_sessions.json")


def _ensure_store_dir(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)


def _load_store(path: Path) -> Dict[str, Any]:
    _ensure_store_dir(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_store(path: Path, data: Dict[str, Any]) -> None:
    _ensure_store_dir(path)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def register_a2a_agent(agent: Dict[str, Any]) -> Dict[str, Any]:
    """Register agent into Python-owned registry. Used for registry takeover."""
    if not isinstance(agent, dict):
        raise ValueError("agent must be object")
    aid = str(agent.get("id") or "").strip()
    if not aid:
        raise ValueError("agent id required")
    reg = _load_store(_REGISTRY_STORE)
    entry = {
        "id": aid,
        "name": str(agent.get("name") or aid),
        "capabilities": list(agent.get("capabilities") or []),
        "description": str(agent.get("description") or ""),
    }
    reg[aid] = entry
    _save_store(_REGISTRY_STORE, reg)
    return entry


def list_a2a_agents() -> List[Dict[str, Any]]:
    """List from Python-owned registry (thin proxy target)."""
    reg = _load_store(_REGISTRY_STORE)
    return list(reg.values())


def get_a2a_agent(agent_id: str) -> Optional[Dict[str, Any]]:
    """Get single agent; enables Python-owned missing agent semantics."""
    reg = _load_store(_REGISTRY_STORE)
    return reg.get(str(agent_id))


def create_a2a_session(envelope: Dict[str, Any], framework_type: str = "custom", started_at: Optional[int] = None) -> Dict[str, Any]:
    """Create session in Python-owned store."""
    if not isinstance(envelope, dict):
        raise ValueError("envelope must be object")
    sid = str(envelope.get("id") or "").strip()
    if not sid:
        raise ValueError("envelope id required for session")
    ft = framework_type if framework_type in {"crewai", "langgraph", "claude", "custom"} else "custom"
    sess: Dict[str, Any] = {
        "sessionId": sid,
        "requestEnvelope": envelope,
        "status": "pending",
        "frameworkType": ft,
        "startedAt": int(started_at) if started_at is not None else 0,
        "completedAt": None,
        "response": None,
        "streamChunks": [],
    }
    sessions = _load_store(_SESSIONS_STORE)
    sessions[sid] = sess
    _save_store(_SESSIONS_STORE, sessions)
    return sess


def get_a2a_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Read session from Python-owned store."""
    sessions = _load_store(_SESSIONS_STORE)
    return sessions.get(str(session_id))


def update_a2a_session(session_id: str, **updates: Any) -> Optional[Dict[str, Any]]:
    """Update session fields in Python-owned store (status/response/completedAt/streamChunks etc)."""
    sessions = _load_store(_SESSIONS_STORE)
    sid = str(session_id)
    if sid not in sessions:
        return None
    sess = dict(sessions[sid])
    for k, v in updates.items():
        if k in ("status", "response", "completedAt", "streamChunks"):
            sess[k] = v
    sessions[sid] = sess
    _save_store(_SESSIONS_STORE, sessions)
    return sess


def list_a2a_active_sessions() -> List[Dict[str, Any]]:
    """List active sessions from Python-owned store."""
    sessions = _load_store(_SESSIONS_STORE)
    return [s for s in sessions.values() if s.get("status") in ("pending", "running")]


def terminate_timed_out_a2a_sessions(default_timeout_ms: int = 60000, now: Optional[int] = None) -> List[Dict[str, Any]]:
    """Terminate timed out in Python store; returns affected."""
    sessions = _load_store(_SESSIONS_STORE)
    now_ms = now if now is not None else 0
    timed: List[Dict[str, Any]] = []
    for sid, sess in list(sessions.items()):
        if sess.get("status") in ("pending", "running"):
            started = int(sess.get("startedAt") or 0)
            if now_ms - started > default_timeout_ms:
                sess["status"] = "failed"
                sess["completedAt"] = now_ms
                sess["response"] = {
                    "jsonrpc": "2.0",
                    "id": sid,
                    "error": {"code": -32000, "message": "Session timed out"},
                }
                sessions[sid] = sess
                timed.append(sess)
    if timed:
        _save_store(_SESSIONS_STORE, sessions)
    return timed


A2ARuntimeResult = Union[
    A2ARuntimeInvokeResult,
    A2ARuntimeStreamChunkResult,
    A2ARuntimeCancelResult,
    A2ARuntimeFailureResult,
    A2ARuntimeListAgentsResult,
]


def project_a2a_runtime_contract(payload: Dict[str, Any]) -> A2ARuntimeResult:
    """Project a deterministic A2A runtime contract result.

    No agent, network request, stream transport, registry write, or session
    persistence side effect is performed. Inputs are only validated and copied
    into the stable Python contract envelope.
    """

    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")

    operation = _read_operation(payload.get("operation"))
    if operation == "list_agents":
        agents = payload.get("agents")
        if not isinstance(agents, list):
            raise ValueError("agents must be an array")
        return A2ARuntimeListAgentsResult(agents=agents)

    envelope = A2AEnvelope(**_read_object(payload.get("envelope"), "envelope"))
    framework_type = _read_framework_type(payload.get("frameworkType"))
    started_at = _read_int(payload.get("startedAt"), "startedAt", default=0)
    completed_at = _read_optional_int(payload.get("completedAt"), "completedAt")

    if operation == "cancel":
        session_id = _read_optional_non_empty(payload.get("sessionId"), "sessionId") or envelope.id
        # task 48: use consistent error via factory shape
        error = A2AError(
            code=A2A_ERROR_CANCELLED,
            message="A2A session cancelled.",
        )
        response = A2AResponse(id=session_id, error=error)
        return A2ARuntimeCancelResult(
            envelope=envelope,
            error=error,
            response=response,
            session=A2ASession(
                sessionId=session_id,
                requestEnvelope=envelope,
                status="cancelled",
                frameworkType=framework_type,
                startedAt=started_at,
                completedAt=completed_at,
                response=response,
                streamChunks=[],
            ),
        )

    if _is_failure_payload(payload):
        error = A2AError(**_read_object(payload.get("error"), "error"))
        response = A2AResponse(id=envelope.id, error=error)
        return A2ARuntimeFailureResult(
            operation=operation,
            envelope=envelope,
            error=error,
            response=response,
            session=A2ASession(
                sessionId=envelope.id,
                requestEnvelope=envelope,
                status="failed",
                frameworkType=framework_type,
                startedAt=started_at,
                completedAt=completed_at,
                response=response,
                streamChunks=[],
            ),
        )

    if operation == "invoke":
        result = A2AResult(
            output=str(payload.get("output") or ""),
            artifacts=payload.get("artifacts") if isinstance(payload.get("artifacts"), list) else [],
            metadata=_read_string_map(payload.get("metadata")),
        )
        response = A2AResponse(id=envelope.id, result=result)
        return A2ARuntimeInvokeResult(
            envelope=envelope,
            response=response,
            session=A2ASession(
                sessionId=envelope.id,
                requestEnvelope=envelope,
                status="completed",
                frameworkType=framework_type,
                startedAt=started_at,
                completedAt=completed_at,
                response=response,
                streamChunks=[],
            ),
        )

    chunk = A2AStreamChunk(
        id=envelope.id,
        chunk=str(payload.get("chunk") or ""),
        done=bool(payload.get("done")),
    )
    return A2ARuntimeStreamChunkResult(
        status="completed" if chunk.done else "streaming",
        envelope=envelope,
        streamChunk=chunk,
        session=A2ASession(
            sessionId=envelope.id,
            requestEnvelope=envelope,
            status="completed" if chunk.done else "running",
            frameworkType=framework_type,
            startedAt=started_at,
            completedAt=completed_at if chunk.done else None,
            streamChunks=[chunk],
        ),
    )


def invoke_a2a_runtime_bridge(
    *,
    envelope: Dict[str, Any],
    output: str = "",
    framework_type: A2AFrameworkType = "custom",
    metadata: Optional[Dict[str, Any]] = None,
    artifacts: Optional[List[Dict[str, Any]]] = None,
    error: Optional[Dict[str, Any]] = None,
    started_at: int = 0,
    completed_at: Optional[int] = None,
) -> Union[A2ARuntimeInvokeResult, A2ARuntimeFailureResult]:
    """Project an invoke bridge result without starting a real external agent."""

    payload: Dict[str, Any] = {
        "operation": "invoke",
        "envelope": envelope,
        "frameworkType": framework_type,
        "startedAt": started_at,
        "completedAt": completed_at,
    }
    if error is not None:
        payload.update({"status": "failed", "error": error})
    else:
        payload.update({
            "output": output,
            "metadata": metadata or {},
            "artifacts": artifacts or [],
        })
    result = project_a2a_runtime_contract(payload)
    if not isinstance(result, (A2ARuntimeInvokeResult, A2ARuntimeFailureResult)):
        raise ValueError("invoke bridge returned unexpected operation")
    return result


def list_a2a_runtime_agents(
    agents: List[Dict[str, Any]],
) -> A2ARuntimeListAgentsResult:
    """Project exposed agents into the Python runtime bridge contract."""

    result = project_a2a_runtime_contract({
        "operation": "list_agents",
        "agents": agents,
    })
    if not isinstance(result, A2ARuntimeListAgentsResult):
        raise ValueError("list agents bridge returned unexpected operation")
    return result


def cancel_a2a_runtime_bridge(
    *,
    envelope: Dict[str, Any],
    session_id: Optional[str] = None,
    framework_type: A2AFrameworkType = "custom",
    started_at: int = 0,
    completed_at: Optional[int] = None,
) -> A2ARuntimeCancelResult:
    """Project a cancellation result; cancelled is never reported as completed."""

    payload: Dict[str, Any] = {
        "operation": "cancel",
        "envelope": envelope,
        "frameworkType": framework_type,
        "startedAt": started_at,
        "completedAt": completed_at,
    }
    if session_id is not None:
        payload["sessionId"] = session_id
    result = project_a2a_runtime_contract(payload)
    if not isinstance(result, A2ARuntimeCancelResult):
        raise ValueError("cancel bridge returned unexpected operation")
    return result


def _read_operation(value: Any) -> A2ARuntimeOperation:
    if value in {"invoke", "stream_chunk", "cancel", "list_agents"}:
        return value
    raise ValueError("operation must be invoke, stream_chunk, cancel, or list_agents")


def _read_framework_type(value: Any) -> A2AFrameworkType:
    if value in {"crewai", "langgraph", "claude", "custom"}:
        return value
    if value is None:
        return "custom"
    raise ValueError("frameworkType must be crewai, langgraph, claude, or custom")


def _read_object(value: Any, field_name: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return value


def _read_optional_non_empty(value: Any, field_name: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a non-empty string")
    return _non_empty(value)


def _read_int(value: Any, field_name: str, *, default: int) -> int:
    if value is None:
        return default
    if not isinstance(value, int):
        raise ValueError(f"{field_name} must be an integer")
    return value


def _read_optional_int(value: Any, field_name: str) -> Optional[int]:
    if value is None:
        return None
    if not isinstance(value, int):
        raise ValueError(f"{field_name} must be an integer")
    return value


def _read_string_map(value: Any) -> Dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("metadata must be an object")
    return {str(key): str(item) for key, item in value.items()}


def _is_failure_payload(payload: Dict[str, Any]) -> bool:
    return payload.get("status") == "failed" or payload.get("error") is not None


# --- Python-owned A2A stream/cancel transport runtime (for 105 takeover) ---
# Real side-effecting functions using session store. Node is thin proxy/compat shell.
# Implements: stream chunks, cancel (idempotent), timeout, retry envelope, malformed handling.
# All return dicts carry explicit python-contract provenance so callers (thin Node proxy) see Python source of truth.

def _a2a_runtime_result(base: Dict[str, Any]) -> Dict[str, Any]:
    """Attach Python contract provenance to transport results for stream/event semantics."""
    out = dict(base)
    out["contractVersion"] = A2A_RUNTIME_CONTRACT_VERSION
    out["runtime"] = A2A_RUNTIME_NAME
    return out


def start_a2a_stream_session(envelope: Dict[str, Any], framework_type: str = "custom") -> Dict[str, Any]:
    """Python-owned: start a stream session (running status, time, empty chunks)."""
    if not isinstance(envelope, dict):
        raise ValueError("envelope must be object")
    sess = create_a2a_session(envelope, framework_type, started_at=int(time.time() * 1000))
    sid = sess["sessionId"]
    update_a2a_session(sid, status="running")
    return _a2a_runtime_result({"ok": True, "status": "running", "session": get_a2a_session(sid)})


def emit_a2a_stream_chunk(session_id: str, chunk: str, done: bool = False) -> Dict[str, Any]:
    """Python-owned stream chunk transport semantics.
    Appends validated chunk to session, updates status.
    Malformed (non-str chunk) or missing session -> error result (no silent).
    """
    if not isinstance(chunk, str):
        err = {"code": A2A_ERROR_FRAMEWORK, "message": "Malformed stream chunk: chunk must be string"}
        return _a2a_runtime_result({"ok": False, "status": "failed", "error": err, "session": get_a2a_session(session_id)})
    sess = get_a2a_session(session_id)
    if not sess:
        err = {"code": A2A_ERROR_FRAMEWORK, "message": "Session not found for stream chunk"}
        return _a2a_runtime_result({"ok": False, "status": "failed", "error": err})
    ch = {"jsonrpc": "2.0", "id": session_id, "chunk": chunk, "done": bool(done)}
    chunks = list(sess.get("streamChunks", [])) + [ch]
    new_status = "completed" if done else "running"
    completed_at = int(time.time() * 1000) if done else sess.get("completedAt")
    update_a2a_session(session_id, status=new_status, streamChunks=chunks, completedAt=completed_at)
    updated = get_a2a_session(session_id)
    return _a2a_runtime_result({
        "ok": True,
        "status": "completed" if done else "streaming",
        "streamChunk": ch,
        "session": updated,
    })


def cancel_a2a_transport(session_id: str) -> Dict[str, Any]:
    """Python-owned cancel transport with idempotency (task 48 error/retry/cancel semantics).
    Uses create_a2a_error for central error shape. If already cancelled, returns same without re-update.
    """
    sess = get_a2a_session(session_id)
    error = create_a2a_error(A2A_ERROR_CANCELLED, "A2A session cancelled.")
    resp = {"jsonrpc": "2.0", "id": session_id, "error": error}
    now = int(time.time() * 1000)
    if sess and sess.get("status") == "cancelled":
        # idempotent: no side effect change
        existing_resp = sess.get("response") or resp
        return _a2a_runtime_result({
            "ok": False,
            "status": "cancelled",
            "error": error,
            "response": existing_resp,
            "session": sess,
        })
    if sess:
        update_a2a_session(
            session_id,
            status="cancelled",
            completedAt=now,
            response=resp,
            streamChunks=sess.get("streamChunks", []),
        )
        updated = get_a2a_session(session_id)
    else:
        # create cancelled placeholder for visibility
        updated = {
            "sessionId": session_id,
            "status": "cancelled",
            "completedAt": now,
            "response": resp,
            "streamChunks": [],
        }
    return _a2a_runtime_result({
        "ok": False,
        "status": "cancelled",
        "error": error,
        "response": resp,
        "session": updated,
    })


def check_a2a_stream_timeout(session_id: str, timeout_ms: int = 60000) -> Dict[str, Any]:
    """Python-owned timeout integration for stream/cancel paths (task 48 error semantics).
    Uses create_a2a_error shape for timeout errors.
    """
    timed = terminate_timed_out_a2a_sessions(default_timeout_ms=timeout_ms)
    for s in timed:
        if str(s.get("sessionId")) == str(session_id):
            err = create_a2a_error(A2A_ERROR_FRAMEWORK, "Session timed out", {"timeoutMs": timeout_ms})
            return _a2a_runtime_result({"ok": False, "status": "failed", "error": err})
    return _a2a_runtime_result({"ok": True, "status": "active"})


def get_a2a_retry_envelope(session_id: str, attempt: int = 0) -> Dict[str, Any]:
    """Python-owned retry envelope (task 48) for error/retry/cancel transport paths.
    Central error used for retry-on-fail cases.
    """
    sess = get_a2a_session(session_id) or {}
    delay = 100 * (attempt + 1)
    base = {
        "ok": True,
        "retry": {"sessionId": session_id, "attempt": attempt, "nextDelayMs": delay},
        "session": sess,
    }
    if sess.get("status") == "failed":
        base["error"] = create_a2a_error(A2A_ERROR_FRAMEWORK, "retry after failure", {"attempt": attempt})
    return _a2a_runtime_result(base)


def handle_malformed_a2a_chunk(session_id: str, reason: str = "bad chunk") -> Dict[str, Any]:
    """Python-owned malformed handling using central error (task 48).
    Explicit error envelope for retry/cancel paths; visible degraded.
    """
    err = create_a2a_error(A2A_ERROR_FRAMEWORK, f"Malformed A2A chunk: {reason}")
    resp = {"jsonrpc": "2.0", "id": session_id, "error": err}
    if session_id:
        update_a2a_session(session_id, status="failed", response=resp, completedAt=int(time.time() * 1000))
    return _a2a_runtime_result({"ok": False, "status": "failed", "error": err, "response": resp})


# --- Python-owned external agent invoke provider (105 takeover) ---
# Contract: missing endpoint, provider failure, success, permission metadata, no-key degraded mode.
# Safe-failure always visible; Node a2a-client/routes become thin proxy / compat shell.
# Real HTTP to external A2A endpoints + framework adaptation done here.


def _adapt_request_for_external(ft: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal framework adaptation mirrored for external invoke ownership in Python."""
    ft = ft or "custom"
    if ft == "crewai":
        return {
            "url": "",
            "headers": {"Content-Type": "application/json"},
            "body": {
                "agent_role": params.get("targetAgent"),
                "task_description": params.get("task"),
                "expected_output": "completion",
                "context": params.get("context"),
                "tools": params.get("capabilities", []),
            },
        }
    if ft == "langgraph":
        return {
            "url": "",
            "headers": {"Content-Type": "application/json"},
            "body": {
                "input": {
                    "task": params.get("task"),
                    "context": params.get("context"),
                    "capabilities": params.get("capabilities", []),
                },
                "config": {
                    "configurable": {
                        "agent_id": params.get("targetAgent"),
                        "stream_mode": bool(params.get("streamMode")),
                    }
                },
            },
        }
    if ft == "claude":
        return {
            "url": "",
            "headers": {
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
            },
            "body": {
                "model": "claude-sonnet-4-20250514",
                "system": params.get("context") or "You are a helpful assistant.",
                "messages": [{"role": "user", "content": params.get("task")}],
                "tools": [
                    {"name": c, "description": c, "input_schema": {"type": "object", "properties": {}}}
                    for c in (params.get("capabilities") or [])
                ],
                "max_tokens": 4096,
                "stream": bool(params.get("streamMode")),
            },
        }
    # custom: passthrough (Node previously errored on getAdapter for custom; now owned here as valid)
    return {
        "url": "",
        "headers": {"Content-Type": "application/json"},
        "body": {
            "targetAgent": params.get("targetAgent"),
            "task": params.get("task"),
            "context": params.get("context"),
            "capabilities": params.get("capabilities", []),
        },
    }


def _adapt_response_for_external(ft: str, raw: Any) -> Dict[str, Any]:
    """Adapt external provider raw response; attach permission metadata."""
    output = ""
    if isinstance(raw, dict):
        if isinstance(raw.get("result"), str):
            output = raw["result"]
        elif isinstance(raw.get("output"), str):
            output = raw["output"]
        elif ft == "langgraph" and isinstance(raw.get("result"), dict):
            ro = raw.get("result") or {}
            output = ro.get("output") if isinstance(ro.get("output"), str) else ""
        elif ft == "claude" and isinstance(raw.get("content"), list):
            for block in raw.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                    output = block["text"]
                    break
    meta = {"framework": ft or "custom", "permission": "granted" if ft else "limited"}
    return {"output": output, "artifacts": [], "metadata": meta}


def invoke_external_a2a_agent(
    envelope: Dict[str, Any],
    endpoint: Optional[str] = None,
    auth: Optional[str] = None,
    framework_type: str = "custom",
) -> Dict[str, Any]:
    """Python external agent invoke provider contract.

    - missing endpoint: explicit error, no fetch
    - no-key degraded mode: returns visible degraded result with permission metadata; no network call
    - provider (network/adapt) failure: safe error response with data
    - success: result with metadata
    Always updates Python-owned session; failures visible (no silent Node success).
    """
    if not isinstance(envelope, dict):
        envelope = {}
    sid = str(envelope.get("id") or f"ext-{int(time.time()*1000)}")
    params = envelope.get("params") or {}
    ft = framework_type if framework_type in {"crewai", "langgraph", "claude", "custom"} else "custom"

    # ensure session (Python owned)
    try:
        create_a2a_session(envelope, ft, started_at=int(time.time() * 1000))
        update_a2a_session(sid, status="running")
    except Exception:
        pass

    if not endpoint or not str(endpoint).strip():
        err = {
            "code": A2A_ERROR_FRAMEWORK,
            "message": "Missing external agent endpoint",
            "data": {"missing_endpoint": True},
        }
        resp = {"jsonrpc": "2.0", "id": sid, "error": err}
        try:
            update_a2a_session(sid, status="failed", completedAt=int(time.time() * 1000), response=resp)
        except Exception:
            pass
        return {"ok": False, "response": resp, "session": get_a2a_session(sid) or {}}

    no_key = auth is None or str(auth).strip() == ""
    if no_key:
        # no-key degraded mode: visible, limited permission metadata, no external call
        result = {
            "output": "[degraded] external agent invoke in no-key mode",
            "artifacts": [],
            "metadata": {
                "degraded": True,
                "mode": "no-key",
                "permission": "limited",
                "source": "python-external-provider",
            },
        }
        resp = {"jsonrpc": "2.0", "id": sid, "result": result}
        try:
            update_a2a_session(sid, status="completed", completedAt=int(time.time() * 1000), response=resp)
        except Exception:
            pass
        return {
            "ok": True,
            "degraded": True,
            "response": resp,
            "session": get_a2a_session(sid) or {},
            "permissionMetadata": result["metadata"],
        }

    adapted = _adapt_request_for_external(ft, params)
    url = str(endpoint) + (adapted.get("url") or "")
    headers = dict(adapted.get("headers") or {"Content-Type": "application/json"})
    if auth:
        headers["Authorization"] = f"Bearer {auth}"
    body = adapted.get("body")

    try:
        import urllib.request
        import urllib.error
        data_bytes = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            raw_resp = json.loads(r.read().decode("utf-8", errors="replace"))
        adapted_result = _adapt_response_for_external(ft, raw_resp)
        # attach permission metadata on success
        if isinstance(adapted_result.get("metadata"), dict):
            adapted_result["metadata"]["permission"] = "granted"
        resp = {"jsonrpc": "2.0", "id": sid, "result": adapted_result}
        try:
            update_a2a_session(sid, status="completed", completedAt=int(time.time() * 1000), response=resp)
        except Exception:
            pass
        return {"ok": True, "response": resp, "session": get_a2a_session(sid) or {}}
    except Exception as exc:
        # provider failure -> safe visible error, no silent
        msg = f"External provider failure: {str(exc)}"
        err = {
            "code": A2A_ERROR_FRAMEWORK,
            "message": msg,
            "data": {"provider_failure": True, "endpoint": endpoint, "error": str(exc)},
        }
        resp = {"jsonrpc": "2.0", "id": sid, "error": err}
        try:
            update_a2a_session(sid, status="failed", completedAt=int(time.time() * 1000), response=resp)
        except Exception:
            pass
        return {"ok": False, "response": resp, "session": get_a2a_session(sid) or {}, "degraded": True}


# --- Python-owned chat/report/analytics projection service (105 cutover) ---
# These implement the required projections, report generation and analytics counters
# as Python-owned runtime. Node routes are thin proxies only.
# All failures/degraded states are returned visibly; no silent fallback semantics.
# File-backed for cross-process Node thin-proxy calls.

_CHAT_PROJ_STORE: Path = Path("slide-rule-python/tmp/a2a_chat_proj.json")
_REPORT_PROJ_STORE: Path = Path("slide-rule-python/tmp/a2a_report_proj.json")
_ANALYTICS_STORE: Path = Path("slide-rule-python/tmp/a2a_analytics.json")


def _load_proj_store(path: Path) -> Dict[str, Any]:
    _ensure_store_dir(path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_proj_store(path: Path, data: Dict[str, Any]) -> None:
    _ensure_store_dir(path)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def record_a2a_chat_projection(session_id: str, role: str, content: str) -> Dict[str, Any]:
    """Python-owned A2A chat projection: append message to chat history for session."""
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("session_id must be non-empty string")
    role = (role or "user").strip() or "user"
    content = str(content or "")
    store = _load_proj_store(_CHAT_PROJ_STORE)
    if session_id not in store:
        store[session_id] = {"sessionId": session_id, "messages": []}
    msg = {"role": role, "content": content, "ts": int(time.time() * 1000)}
    store[session_id]["messages"].append(msg)
    _save_proj_store(_CHAT_PROJ_STORE, store)
    return {"ok": True, "sessionId": session_id, "message": msg, "count": len(store[session_id]["messages"])}


def generate_a2a_report(session_id: str, kind: str = "summary") -> Dict[str, Any]:
    """Python-owned A2A report generation projection.
    Pulls chat proj + session, produces deterministic report output.
    """
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("session_id required")
    kind = (kind or "summary").lower()
    chats = _load_proj_store(_CHAT_PROJ_STORE).get(session_id, {"messages": []})
    sess = get_a2a_session(session_id) or {}
    messages = chats.get("messages", [])
    if kind == "full":
        output = "FULL REPORT for " + session_id + "\nmsgs:" + str(len(messages))
    else:
        output = "SUMMARY REPORT for " + session_id + ": " + str(len(messages)) + " messages; status=" + str(sess.get("status"))
    report = {
        "reportId": session_id + "-" + kind,
        "sessionId": session_id,
        "kind": kind,
        "output": output,
        "generatedAt": int(time.time() * 1000),
        "chatMessageCount": len(messages),
        "sessionStatus": sess.get("status"),
    }
    reports = _load_proj_store(_REPORT_PROJ_STORE)
    reports[report["reportId"]] = report
    _save_proj_store(_REPORT_PROJ_STORE, reports)
    return {"ok": True, "report": report}


def increment_a2a_analytics_counter(name: str, delta: int = 1) -> Dict[str, Any]:
    """Python-owned analytics counter projection. Visible increments only."""
    if not isinstance(name, str) or not name.strip():
        raise ValueError("counter name required")
    delta = int(delta) if isinstance(delta, (int, float)) else 1
    store = _load_proj_store(_ANALYTICS_STORE)
    cur = int(store.get(name, 0))
    new_val = cur + delta
    store[name] = new_val
    _save_proj_store(_ANALYTICS_STORE, store)
    return {"ok": True, "counter": name, "value": new_val, "delta": delta}


def get_a2a_analytics_snapshot() -> Dict[str, Any]:
    """Python-owned read of analytics counters."""
    store = _load_proj_store(_ANALYTICS_STORE)
    return {"ok": True, "counters": store, "source": "python-a2a-analytics"}


def project_a2a_chat_report_analytics(op: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Unified Python projection entry for chat/report/analytics.
    Used by Node thin proxy adapters. All paths return explicit ok/degraded.
    """
    if not isinstance(payload, dict):
        payload = {}
    op = (op or "").strip()
    sid = str(payload.get("sessionId") or payload.get("id") or "")
    if op == "chat":
        return record_a2a_chat_projection(sid or "anon", payload.get("role", "user"), payload.get("content", ""))
    if op == "report":
        return generate_a2a_report(sid or "anon", payload.get("kind", "summary"))
    if op == "analytics_inc":
        return increment_a2a_analytics_counter(payload.get("name", "default"), payload.get("delta", 1))
    if op == "analytics_get":
        return get_a2a_analytics_snapshot()
    # fallback visible error for unknown
    return {"ok": False, "error": {"code": -32000, "message": "unknown a2a chat/report/analytics op: " + op}, "degraded": True}
