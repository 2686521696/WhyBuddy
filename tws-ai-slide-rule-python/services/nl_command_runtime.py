"""Deterministic Python contract boundary for NL command runtime.

The real NL command orchestration, mission decomposition, task execution, and
permission policy remain Node-owned in this migration slice. This module only
locks the result envelopes that Python will need to preserve when the runtime is
incrementally migrated.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


NL_COMMAND_RUNTIME_CONTRACT_VERSION = "nl-command.runtime.v1"
NL_COMMAND_RUNTIME_NAME = "python-contract"

NLCommandRuntimeOperation = Literal["analyze", "clarify", "plan", "approval", "report"]
NLCommandRuntimeStatus = Literal["completed", "permission_denied"]


def _non_empty(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


class NLCommandRuntimePermission(BaseModel):
    model_config = ConfigDict(extra="allow")

    allowed: bool = True
    reason: Optional[str] = None
    auditId: Optional[str] = None

    @field_validator("reason", "auditId")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class NLCommandRuntimeAudit(BaseModel):
    model_config = ConfigDict(extra="allow")

    eventId: str
    operationType: str
    actorId: str
    entityId: str
    entityType: str
    timestamp: int
    result: Literal["success", "failure"]
    metadata: Optional[Dict[str, Any]] = None

    @field_validator("eventId", "operationType", "actorId", "entityId", "entityType")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str

    @field_validator("code", "message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: str
    entities: List[Dict[str, Any]] = Field(default_factory=list)
    constraints: List[Dict[str, Any]] = Field(default_factory=list)
    objectives: List[str] = Field(default_factory=list)
    risks: List[Dict[str, Any]] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    needsClarification: bool
    clarificationTopics: Optional[List[str]] = None

    @field_validator("intent")
    @classmethod
    def _validate_intent(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionId: str
    text: str
    type: Literal["free_text", "single_choice", "multi_choice"]
    options: Optional[List[str]] = None
    context: Optional[str] = None

    @field_validator("questionId", "text")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionId: str
    text: str
    selectedOptions: Optional[List[str]] = None
    timestamp: Optional[int] = None

    @field_validator("questionId", "text")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeClarification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialogId: str
    commandId: str
    questions: List[NLCommandRuntimeQuestion]
    answers: List[NLCommandRuntimeAnswer] = Field(default_factory=list)
    clarificationRounds: int = Field(ge=0)
    status: Literal["active", "completed"]

    @field_validator("dialogId", "commandId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimePlanStep(BaseModel):
    model_config = ConfigDict(extra="allow")

    stepId: str
    title: str
    kind: str

    @field_validator("stepId", "title", "kind")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimePlan(BaseModel):
    model_config = ConfigDict(extra="allow")

    planId: str
    commandId: str
    status: Literal["draft", "pending_approval", "approved"]
    summary: str
    steps: List[NLCommandRuntimePlanStep]

    @field_validator("planId", "commandId", "summary")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeApproval(BaseModel):
    model_config = ConfigDict(extra="allow")

    requestId: str
    planId: str
    status: Literal["pending", "approved", "rejected", "revision_requested"]
    requiredApprovers: List[str]
    approvals: List[Dict[str, Any]] = Field(default_factory=list)

    @field_validator("requestId", "planId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeReport(BaseModel):
    model_config = ConfigDict(extra="allow")

    reportId: str
    planId: str
    summary: str
    sections: Dict[str, str]

    @field_validator("reportId", "planId", "summary")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class NLCommandRuntimeBaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[NL_COMMAND_RUNTIME_CONTRACT_VERSION] = (
        NL_COMMAND_RUNTIME_CONTRACT_VERSION
    )
    runtime: Literal[NL_COMMAND_RUNTIME_NAME] = NL_COMMAND_RUNTIME_NAME
    operation: NLCommandRuntimeOperation
    ok: bool
    status: NLCommandRuntimeStatus
    commandId: str
    planId: Optional[str] = None
    permission: NLCommandRuntimePermission
    audit: NLCommandRuntimeAudit

    @field_validator("commandId", "planId")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class NLCommandRuntimeCompletedResult(NLCommandRuntimeBaseResult):
    ok: Literal[True] = True
    status: Literal["completed"] = "completed"
    analysis: Optional[NLCommandRuntimeAnalysis] = None
    clarification: Optional[NLCommandRuntimeClarification] = None
    plan: Optional[NLCommandRuntimePlan] = None
    approval: Optional[NLCommandRuntimeApproval] = None
    report: Optional[NLCommandRuntimeReport] = None

    @model_validator(mode="after")
    def _validate_completed_payload(self) -> "NLCommandRuntimeCompletedResult":
        if not self.permission.allowed:
            raise ValueError("completed result requires allowed permission")
        if self.audit.result != "success":
            raise ValueError("completed result requires success audit")

        fields = {
            "analyze": self.analysis,
            "clarify": self.clarification,
            "plan": self.plan,
            "approval": self.approval,
            "report": self.report,
        }
        if fields[self.operation] is None:
            raise ValueError(f"{self.operation} result payload is required")
        extras = [
            name
            for name, value in fields.items()
            if name != self.operation and value is not None
        ]
        if extras:
            raise ValueError("completed result contains mismatched operation payload")
        return self


class NLCommandRuntimeDeniedResult(NLCommandRuntimeBaseResult):
    ok: Literal[False] = False
    status: Literal["permission_denied"] = "permission_denied"
    error: NLCommandRuntimeError

    @model_validator(mode="after")
    def _validate_denied_payload(self) -> "NLCommandRuntimeDeniedResult":
        if self.permission.allowed:
            raise ValueError("permission_denied result requires denied permission")
        if self.audit.result != "failure":
            raise ValueError("permission_denied result requires failure audit")
        if self.error.code != "permission_denied":
            raise ValueError("permission_denied result requires permission_denied error")
        return self


NLCommandRuntimeResult = Union[
    NLCommandRuntimeCompletedResult,
    NLCommandRuntimeDeniedResult,
]


def execute_nl_command_runtime_contract(payload: Dict[str, Any]) -> NLCommandRuntimeResult:
    """Project a deterministic NL command runtime contract result.

    No command is executed. Inputs are used only to fill a stable envelope and
    operation-specific placeholder payload.
    """

    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")

    operation = _read_operation(payload.get("operation"))
    command_id = _read_non_empty(payload.get("commandId"), "commandId")
    plan_id = _read_optional_non_empty(payload.get("planId"), "planId")
    user_id = _read_non_empty(payload.get("userId"), "userId")
    command_text = _read_non_empty(payload.get("commandText"), "commandText")
    permission = _read_permission(payload.get("permission"))

    if not permission.allowed:
        return NLCommandRuntimeDeniedResult(
            operation=operation,
            commandId=command_id,
            planId=plan_id,
            permission=permission,
            audit=_build_audit(
                payload.get("audit"),
                operation=operation,
                actor_id=user_id,
                entity_id=command_id,
                result="failure",
            ),
            error=NLCommandRuntimeError(
                code="permission_denied",
                message="NL command runtime denied by permission guard.",
            ),
        )

    base: Dict[str, Any] = {
        "operation": operation,
        "commandId": command_id,
        "planId": plan_id,
        "permission": permission,
        "audit": _build_audit(
            payload.get("audit"),
            operation=operation,
            actor_id=user_id,
            entity_id=command_id,
            result="success",
        ),
    }
    base[_payload_field_for_operation(operation)] = _build_operation_payload(
        operation,
        command_id=command_id,
        plan_id=plan_id,
        command_text=command_text,
    )
    return NLCommandRuntimeCompletedResult(**base)


def _read_operation(value: Any) -> NLCommandRuntimeOperation:
    if value in {"analyze", "clarify", "plan", "approval", "report"}:
        return value
    raise ValueError("operation must be analyze, clarify, plan, approval, or report")


def _read_non_empty(value: Any, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a non-empty string")
    return _non_empty(value)


def _read_optional_non_empty(value: Any, field_name: str) -> Optional[str]:
    if value is None:
        return None
    return _read_non_empty(value, field_name)


def _read_permission(value: Any) -> NLCommandRuntimePermission:
    if value is None:
        return NLCommandRuntimePermission()
    if not isinstance(value, dict):
        raise ValueError("permission must be an object")
    return NLCommandRuntimePermission(**value)


def _build_audit(
    value: Any,
    *,
    operation: NLCommandRuntimeOperation,
    actor_id: str,
    entity_id: str,
    result: Literal["success", "failure"],
) -> NLCommandRuntimeAudit:
    data = value if isinstance(value, dict) else {}
    return NLCommandRuntimeAudit(
        eventId=str(data.get("eventId") or f"audit-{operation}-{entity_id}"),
        operationType=f"nl_command_{operation}",
        actorId=str(data.get("actorId") or actor_id),
        entityId=str(data.get("entityId") or entity_id),
        entityType=str(data.get("entityType") or "command"),
        timestamp=int(data.get("timestamp") or 0),
        result=result,
        metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else None,
    )

def _payload_field_for_operation(operation: NLCommandRuntimeOperation) -> str:
    return {
        "analyze": "analysis",
        "clarify": "clarification",
        "plan": "plan",
        "approval": "approval",
        "report": "report",
    }[operation]


def _build_operation_payload(
    operation: NLCommandRuntimeOperation,
    *,
    command_id: str,
    plan_id: Optional[str],
    command_text: str,
) -> BaseModel:
    resolved_plan_id = plan_id or f"plan-{command_id}"
    if operation == "analyze":
        return NLCommandRuntimeAnalysis(
            intent=command_text,
            entities=[],
            constraints=[],
            objectives=["Lock NL command Python runtime contract"],
            risks=[],
            assumptions=["Contract projection only; no command execution occurred."],
            confidence=0.72,
            needsClarification=False,
        )
    if operation == "clarify":
        return NLCommandRuntimeClarification(
            dialogId=f"dialog-{command_id}",
            commandId=command_id,
            questions=[
                NLCommandRuntimeQuestion(
                    questionId="q-contract-boundary",
                    text="Which NL command runtime boundary should Python lock?",
                    type="single_choice",
                    options=["contract only", "full execution"],
                    context="This migration slice must remain contract-only.",
                )
            ],
            answers=[],
            clarificationRounds=0,
            status="active",
        )
    if operation == "plan":
        return NLCommandRuntimePlan(
            planId=resolved_plan_id,
            commandId=command_id,
            status="pending_approval",
            summary="Contract-only NL command plan projection.",
            steps=[
                NLCommandRuntimePlanStep(
                    stepId="step-contract",
                    title="Define Python runtime contract",
                    kind="contract",
                )
            ],
        )
    if operation == "approval":
        return NLCommandRuntimeApproval(
            requestId=f"approval-{resolved_plan_id}",
            planId=resolved_plan_id,
            status="pending",
            requiredApprovers=["manager"],
            approvals=[],
        )
    return NLCommandRuntimeReport(
        reportId=f"report-{resolved_plan_id}",
        planId=resolved_plan_id,
        summary="Python NL command runtime contract projection completed.",
        sections={
            "summary": "Contract envelope projected.",
            "progress": "No mission or task execution was migrated.",
            "risk": "Permission and audit fields are preserved.",
        },
    )

