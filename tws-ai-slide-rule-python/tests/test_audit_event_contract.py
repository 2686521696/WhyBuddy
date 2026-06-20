from enum import Enum
from typing import Any, Dict, Literal, Optional

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class AuditEventType(str, Enum):
    DECISION_MADE = "DECISION_MADE"
    PERMISSION_GRANTED = "PERMISSION_GRANTED"
    PERMISSION_REVOKED = "PERMISSION_REVOKED"
    PERMISSION_CHECKED = "PERMISSION_CHECKED"
    GOVERNANCE_ENFORCED = "GOVERNANCE_ENFORCED"
    DATA_ACCESSED = "DATA_ACCESSED"
    AGENT_EXECUTED = "AGENT_EXECUTED"
    AGENT_FAILED = "AGENT_FAILED"
    CONFIG_CHANGED = "CONFIG_CHANGED"
    USER_LOGIN = "USER_LOGIN"
    USER_LOGOUT = "USER_LOGOUT"
    ESCALATION_REQUESTED = "ESCALATION_REQUESTED"
    ESCALATION_APPROVED = "ESCALATION_APPROVED"
    AUDIT_QUERY = "AUDIT_QUERY"
    AUDIT_EXPORT = "AUDIT_EXPORT"
    AUDIT_ARCHIVE = "AUDIT_ARCHIVE"
    AUDIT_DELETE = "AUDIT_DELETE"
    ANOMALY_DETECTED = "ANOMALY_DETECTED"


class AuditActor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["user", "agent", "system"]
    id: str = Field(min_length=1)
    name: Optional[str] = None

    @field_validator("id")
    @classmethod
    def require_non_blank_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("actor.id must be non-blank")
        return value


class AuditResource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1)
    id: str = Field(min_length=1)
    name: Optional[str] = None

    @field_validator("type", "id")
    @classmethod
    def require_non_blank_resource_fields(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("resource.type and resource.id must be non-blank")
        return value


class AuditContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessionId: Optional[str] = None
    requestId: Optional[str] = None
    sourceIp: Optional[str] = None
    userAgent: Optional[str] = None
    organizationId: Optional[str] = None


class AuditEventInput(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    eventType: AuditEventType
    actor: AuditActor
    action: str = Field(min_length=1)
    resource: AuditResource
    result: Literal["success", "failure", "denied", "error"]
    context: Optional[AuditContext] = None
    metadata: Optional[Dict[str, Any]] = None
    lineageId: Optional[str] = None

    @field_validator("action")
    @classmethod
    def require_non_blank_action(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("action must be non-blank")
        return value


class AuditEvent(AuditEventInput):
    eventId: str = Field(min_length=1)
    timestamp: int = Field(ge=0)
    context: AuditContext = Field(default_factory=AuditContext)

    @field_validator("eventId")
    @classmethod
    def require_non_blank_event_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("eventId must be non-blank")
        return value


def validate_audit_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    return AuditEvent.model_validate(payload).model_dump(mode="json", exclude_none=True)


def validate_audit_event_input(payload: Dict[str, Any]) -> Dict[str, Any]:
    return AuditEventInput.model_validate(payload).model_dump(mode="json", exclude_none=True)


def _valid_event() -> Dict[str, Any]:
    return {
        "eventId": "ae_1710000000000_ab12cd34",
        "eventType": "AGENT_EXECUTED",
        "timestamp": 1710000000000,
        "actor": {"type": "agent", "id": "agent-1", "name": "Planner"},
        "action": "execute_task",
        "resource": {"type": "mission", "id": "mission-1", "name": "Migration"},
        "result": "success",
        "context": {"sessionId": "sess-1", "requestId": "req-1"},
        "metadata": {"capabilityId": "audit.event"},
        "lineageId": "lineage-1",
    }


def test_audit_event_contract_preserves_event_actor_resource_and_result_shape():
    payload = validate_audit_event(_valid_event())

    assert payload["eventType"] == "AGENT_EXECUTED"
    assert payload["actor"] == {"type": "agent", "id": "agent-1", "name": "Planner"}
    assert payload["resource"] == {"type": "mission", "id": "mission-1", "name": "Migration"}
    assert payload["result"] == "success"
    assert payload["context"] == {"sessionId": "sess-1", "requestId": "req-1"}
    assert payload["metadata"] == {"capabilityId": "audit.event"}
    assert payload["lineageId"] == "lineage-1"


def test_audit_event_input_contract_accepts_node_collector_shape_before_chain_envelope():
    payload = validate_audit_event_input(
        {
            "eventType": "PERMISSION_CHECKED",
            "actor": {"type": "system", "id": "authz"},
            "action": "check_permission",
            "resource": {"type": "permission", "id": "policy-1"},
            "result": "denied",
            "context": {"organizationId": "org-1"},
        }
    )

    assert "eventId" not in payload
    assert "timestamp" not in payload
    assert payload["eventType"] == "PERMISSION_CHECKED"
    assert payload["actor"]["type"] == "system"
    assert payload["resource"]["id"] == "policy-1"
    assert payload["result"] == "denied"


@pytest.mark.parametrize(
    "patch",
    [
        {"eventType": "NOT_A_REAL_EVENT"},
        {"actor": {"type": "robot", "id": "agent-1"}},
        {"actor": {"type": "agent", "id": "   "}},
        {"action": " "},
        {"resource": {"type": "mission", "id": ""}},
        {"result": "ok"},
        {"context": {"sessionId": "sess-1", "unexpected": "value"}},
    ],
)
def test_invalid_audit_event_payloads_are_rejected(patch: Dict[str, Any]):
    event = _valid_event()
    event.update(patch)

    with pytest.raises(ValidationError):
        validate_audit_event(event)


def test_invalid_success_event_is_rejected_instead_of_normalized_as_success():
    event = _valid_event()
    event["actor"] = {"type": "agent", "id": ""}
    event["result"] = "success"

    with pytest.raises(ValidationError) as exc:
        validate_audit_event(event)

    assert "actor.id" in str(exc.value) or "String should have at least 1 character" in str(exc.value)
