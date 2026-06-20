"""Deterministic Python contract boundary for A2A runtime.

The real CrewAI, LangGraph, Claude, external HTTP agent calls, registry
mutation, and streaming transport remain Node-owned in this migration slice.
This module only locks invoke, stream chunk, cancel, failure, and agent-list
envelopes that a Python runtime must preserve later.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


A2A_RUNTIME_CONTRACT_VERSION = "a2a.runtime.v1"
A2A_RUNTIME_NAME = "python-contract"

A2A_ERROR_CANCELLED = -32005
A2A_ERROR_FRAMEWORK = -32006

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
