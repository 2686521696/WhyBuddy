"""AgentLoop v2 normalized runtime event envelope schema (SlideRule AgentLoop 110).

Defines the canonical v2 event shape used by Node, Python, Web, Grok, and Codex projections.

This is the contract slice of the Runtime SSOT migration.

state.json is a derived cache, not the source of truth.
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Literal

from pydantic import BaseModel, Field, field_validator, ValidationError


VERSION = "agentloop.event.v2"


class EventSource(str, Enum):
    NODE = "node"
    PYTHON = "python"
    GROK = "grok"
    CODEX = "codex"
    SYSTEM = "system"


ALLOWED_PHASES = {
    "queue",
    "probe",
    "gate",
    "fix",
    "review",
    "landing",
    "finalize",
}

ALLOWED_TYPES = {
    "RUN_STARTED",
    "GATE_RESULT",
    "AGENT_LOG",
    "REVIEW_RESULT",
    "RUN_FINALIZED",
    "QUEUE_STARTED",
    "TASK_STARTED",
    "WORKTREE_READY",
    "BASELINE_GATE_RESULT",
    "AGENT_FIX_STARTED",
    "AGENT_FIX_RESULT",
    "POST_FIX_GATE_RESULT",
    "REVIEW_STARTED",
    "RETRY_REQUESTED",
    "ARTIFACT_INDEXED",
    "QUEUE_LANDING_READY",
    "QUEUE_FINISHED",
    "RUN_FAILED",
}


class AgentLoopRuntimeEventEnvelope(BaseModel):
    """Normalized runtime event envelope.

    Required: version, runId, seq, ts, source, phase, type.
    Optional: task, status, payload, artifacts, redaction.

    seq is monotonic per-run (validated via sequence helper).
    payload must be redacted for web exposure (contract only, not enforced here).
    """

    version: Literal["agentloop.event.v2"]
    runId: str
    seq: int
    ts: str
    source: EventSource
    phase: str
    type: str
    task: Optional[str] = None
    status: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    artifacts: List[Any] = Field(default_factory=list)
    redaction: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("phase")
    @classmethod
    def _validate_phase(cls, v: str) -> str:
        if v not in ALLOWED_PHASES:
            raise ValueError(f"invalid phase: {v}")
        return v

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ALLOWED_TYPES:
            raise ValueError(f"invalid type: {v}")
        return v

    @field_validator("seq")
    @classmethod
    def _validate_seq(cls, v: int) -> int:
        if not isinstance(v, int) or v < 0:
            raise ValueError("seq must be non-negative integer")
        return v


def validate_event_envelope(data: Dict[str, Any]) -> AgentLoopRuntimeEventEnvelope:
    """Validate single event dict into normalized envelope.

    Raises pydantic.ValidationError on missing required fields or bad values.
    """
    return AgentLoopRuntimeEventEnvelope.model_validate(data)


def validate_run_event_sequence(events: List[Dict[str, Any]]) -> bool:
    """Validate that seq values are strictly monotonic increasing per runId.

    Used to enforce per-run seq expectations.
    Returns True on success; raises ValueError on violation.
    """
    from collections import defaultdict

    seqs_by_run: Dict[str, List[int]] = defaultdict(list)
    for raw in events:
        env = validate_event_envelope(raw)
        seqs_by_run[env.runId].append(env.seq)

    for rid, seqs in seqs_by_run.items():
        if any(seqs[i] <= seqs[i - 1] for i in range(1, len(seqs))):
            raise ValueError(f"seq must be strictly monotonic per run; violation in {rid}: {seqs}")
    return True
