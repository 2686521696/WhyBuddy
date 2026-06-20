"""Boundary tests for the Python-side audit query proxy contract.

This slice locks query/list/filter/error shapes only. It deliberately uses
synthetic payload validation instead of reading or exporting a real audit store.
"""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


class AuditEventType(str, Enum):
    AGENT_EXECUTED = "AGENT_EXECUTED"
    USER_LOGIN = "USER_LOGIN"
    AUDIT_QUERY = "AUDIT_QUERY"


class AuditQueryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    eventType: Optional[Union[AuditEventType, List[AuditEventType]]] = None
    actorId: Optional[str] = None
    actorType: Optional[Literal["user", "agent", "system"]] = None
    resourceType: Optional[str] = None
    resourceId: Optional[str] = None
    result: Optional[Literal["success", "failure", "denied", "error"]] = None
    severity: Optional[Literal["INFO", "WARNING", "CRITICAL"]] = None
    category: Optional[Literal["security", "compliance", "operational"]] = None
    timeRange: Optional[Dict[Literal["start", "end"], int]] = None
    keyword: Optional[str] = None


class PageOptions(BaseModel):
    pageSize: int = DEFAULT_PAGE_SIZE
    pageNum: int = 1

    @field_validator("pageSize")
    @classmethod
    def clamp_page_size(cls, value: int) -> int:
        return min(max(value or DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    @field_validator("pageNum")
    @classmethod
    def clamp_page_num(cls, value: int) -> int:
        return max(value or 1, 1)


class AuditQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["query", "list", "filter"]
    filters: AuditQueryFilters = Field(default_factory=AuditQueryFilters)
    page: PageOptions = Field(default_factory=PageOptions)


class AuditEntryPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entryId: str
    eventId: str
    eventType: AuditEventType
    actorId: str
    resourceId: str


class AuditQuerySuccess(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    entries: List[AuditEntryPreview]
    total: int = Field(ge=0)
    page: PageOptions


class AuditQueryFailure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["forbidden", "error"]
    error: Dict[Literal["code", "message"], str]
    page: PageOptions

    @field_validator("error")
    @classmethod
    def require_known_error_code(cls, value: Dict[str, str]) -> Dict[str, str]:
        code = value.get("code")
        if code not in {"forbidden", "audit_query_error"}:
            raise ValueError("audit query proxy error code must be stable")
        if not value.get("message"):
            raise ValueError("audit query proxy error message is required")
        return value


def parse_query_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    return AuditQueryRequest.model_validate(payload).model_dump(mode="json", exclude_none=True)


def parse_success(payload: Dict[str, Any]) -> Dict[str, Any]:
    return AuditQuerySuccess.model_validate(payload).model_dump(mode="json")


def parse_failure(payload: Dict[str, Any]) -> Dict[str, Any]:
    return AuditQueryFailure.model_validate(payload).model_dump(mode="json")


def test_query_boundary_accepts_filter_and_page_contract_without_store_access():
    payload = parse_query_request(
        {
            "operation": "query",
            "filters": {
                "eventType": ["AGENT_EXECUTED", "USER_LOGIN"],
                "actorId": "agent-1",
                "actorType": "agent",
                "resourceType": "mission",
                "resourceId": "mission-1",
                "result": "success",
                "severity": "INFO",
                "category": "operational",
                "timeRange": {"start": 1000, "end": 2000},
                "keyword": "deploy",
            },
            "page": {"pageSize": 25, "pageNum": 2},
        }
    )

    assert payload == {
        "operation": "query",
        "filters": {
            "eventType": ["AGENT_EXECUTED", "USER_LOGIN"],
            "actorId": "agent-1",
            "actorType": "agent",
            "resourceType": "mission",
            "resourceId": "mission-1",
            "result": "success",
            "severity": "INFO",
            "category": "operational",
            "timeRange": {"start": 1000, "end": 2000},
            "keyword": "deploy",
        },
        "page": {"pageSize": 25, "pageNum": 2},
    }


def test_list_boundary_returns_stable_empty_success_envelope():
    payload = parse_success(
        {
            "status": "ok",
            "entries": [],
            "total": 0,
            "page": {"pageSize": 50, "pageNum": 1},
        }
    )

    assert payload == {
        "status": "ok",
        "entries": [],
        "total": 0,
        "page": {"pageSize": 50, "pageNum": 1},
    }


def test_filter_boundary_clamps_pagination_fields():
    payload = parse_query_request(
        {
            "operation": "filter",
            "filters": {"actorId": "agent-1"},
            "page": {"pageSize": 999, "pageNum": 0},
        }
    )

    assert payload["page"] == {"pageSize": 200, "pageNum": 1}


@pytest.mark.parametrize(
    "payload,expected_status,expected_code",
    [
        (
            {
                "status": "forbidden",
                "error": {"code": "forbidden", "message": "Audit query forbidden"},
                "page": {"pageSize": 50, "pageNum": 1},
            },
            "forbidden",
            "forbidden",
        ),
        (
            {
                "status": "error",
                "error": {"code": "audit_query_error", "message": "Audit query failed"},
                "page": {"pageSize": 10, "pageNum": 3},
            },
            "error",
            "audit_query_error",
        ),
    ],
)
def test_error_boundary_cannot_masquerade_as_empty_success(
    payload: Dict[str, Any],
    expected_status: str,
    expected_code: str,
):
    parsed = parse_failure(payload)

    assert parsed["status"] == expected_status
    assert parsed["error"]["code"] == expected_code
    assert "entries" not in parsed
    assert "total" not in parsed


def test_forbidden_or_error_with_success_rows_is_rejected():
    with pytest.raises(ValidationError):
        parse_failure(
            {
                "status": "forbidden",
                "error": {"code": "forbidden", "message": "Audit query forbidden"},
                "entries": [],
                "total": 0,
                "page": {"pageSize": 50, "pageNum": 1},
            }
        )
