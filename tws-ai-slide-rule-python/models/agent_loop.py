"""
Pydantic contracts for AgentLoop (runs, tasks, events, artifacts, commands, settings).

These are the stable response/request models for the Python control plane.
Unknown/optional AgentLoop fields are folded into bounded `metadata`.
No filesystem access. No raw secrets exposed in response shapes.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

AGENT_LOOP_MODEL_VERSION = "agentloop.data.v1"


class AgentLoopBase(BaseModel):
    """Base with unknown-field capture into bounded metadata and camelCase stability."""

    model_config = ConfigDict(extra="allow")

    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _capture_unknown_into_metadata(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            known = set(cls.model_fields.keys())
            extras: Dict[str, Any] = {}
            for k in list(data.keys()):
                if k not in known:
                    extras[k] = data.pop(k)
            if extras:
                meta = dict(data.get("metadata") or {})
                meta.update(extras)
                data["metadata"] = meta
        return data


class AgentLoopTaskEntry(AgentLoopBase):
    id: Optional[str] = None
    path: str
    title: Optional[str] = None
    status: Optional[str] = None


class AgentLoopArtifact(AgentLoopBase):
    id: str
    kind: str = "log"
    title: Optional[str] = None
    content: Optional[str] = None
    path: Optional[str] = None
    producedAt: Optional[str] = None


class AgentLoopEvent(AgentLoopBase):
    """Timeline event shape.

    Supports both the older status-only detail timeline entries and normalized
    v2 runtime envelopes used by AgentLoop SSOT replay.
    """

    ts: Optional[str] = None
    status: Optional[str] = None
    iteration: Optional[int] = None
    message: Optional[str] = None
    version: Optional[str] = None
    runId: Optional[str] = None
    seq: Optional[int] = None
    source: Optional[str] = None
    phase: Optional[str] = None
    type: Optional[str] = None
    task: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    artifacts: List[Any] = Field(default_factory=list)
    redaction: Optional[Dict[str, Any]] = None


class AgentLoopRunSummary(AgentLoopBase):
    """Stable summary shape used by list-runs / run overview."""

    runId: str
    status: Optional[str] = None
    task: Optional[str] = None
    runMode: Optional[str] = None
    iterations: int = 0
    grokRan: bool = False
    codexRan: bool = False
    reviewAgentRan: bool = False
    fixAgent: Optional[str] = "grok"
    reviewAgent: Optional[str] = None
    runTimeLocal: Optional[str] = None
    runTimeUtc: Optional[str] = None


class AgentLoopRunDetail(AgentLoopBase):
    """Full run detail including nested entries, events, artifacts."""

    runId: str
    status: Optional[str] = None
    task: Optional[AgentLoopTaskEntry] = None
    options: Optional[Dict[str, Any]] = None
    iterations: List[Dict[str, Any]] = Field(default_factory=list)
    events: List[AgentLoopEvent] = Field(default_factory=list)
    artifacts: List[AgentLoopArtifact] = Field(default_factory=list)
    grokFix: Optional[Dict[str, Any]] = None
    agentFix: Optional[Dict[str, Any]] = None
    codexReview: Optional[Dict[str, Any]] = None
    grokReview: Optional[Dict[str, Any]] = None


class AgentLoopSettingsStatus(AgentLoopBase):
    """Settings status / effective config without leaking raw secrets."""

    loaded: bool = True
    source: Optional[str] = None
    effective: Dict[str, Any] = Field(default_factory=dict)
    redacted: List[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _reject_raw_secret_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            def _contains_raw_secret(obj: Any) -> bool:
                if isinstance(obj, dict):
                    for key in obj.keys():
                        kl = str(key).lower().replace("_", "").replace("-", "")
                        if any(p in kl for p in ["secret", "apikey", "token", "password", "auth", "credential", "privatekey"]):
                            return True
                        if _contains_raw_secret(obj[key]):
                            return True
                if isinstance(obj, list):
                    for item in obj:
                        if _contains_raw_secret(item):
                            return True
                return False

            if _contains_raw_secret(data):
                raise ValueError("raw secret fields are not permitted in AgentLoop settings/status response models")
        return data


class AgentLoopCommandRequest(AgentLoopBase):
    """Request to execute a bridged command."""

    command: str
    args: List[str] = Field(default_factory=list)
    cwd: Optional[str] = None
    timeoutMs: Optional[int] = None
    env: Optional[Dict[str, str]] = None


class AgentLoopCommandReceipt(AgentLoopBase):
    """Receipt / result after command execution (no secrets)."""

    command: str
    exitCode: Optional[int] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    timedOut: bool = False
    startedAt: Optional[str] = None
    endedAt: Optional[str] = None


# Public exports
__all__ = [
    "AGENT_LOOP_MODEL_VERSION",
    "AgentLoopTaskEntry",
    "AgentLoopArtifact",
    "AgentLoopEvent",
    "AgentLoopRunSummary",
    "AgentLoopRunDetail",
    "AgentLoopSettingsStatus",
    "AgentLoopCommandRequest",
    "AgentLoopCommandReceipt",
]
