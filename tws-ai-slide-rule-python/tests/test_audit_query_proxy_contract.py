"""Contract tests for the Python-side audit query proxy boundary.

These tests lock the JSON shapes only. They intentionally do not read a real
audit store or expose real audit entries.
"""

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


def _normalize_page(page):
    page = page or {}
    page_size = page.get("pageSize") or DEFAULT_PAGE_SIZE
    page_num = page.get("pageNum") or 1
    return {
        "pageSize": min(max(page_size, 1), MAX_PAGE_SIZE),
        "pageNum": max(page_num, 1),
    }


def _ok_response(entries, total, page):
    return {
        "status": "ok",
        "entries": entries,
        "total": total,
        "page": _normalize_page(page),
    }


def _forbidden_response(page):
    return {
        "status": "forbidden",
        "error": {
            "code": "forbidden",
            "message": "Audit query forbidden",
        },
        "page": _normalize_page(page),
    }


def _error_response(page):
    return {
        "status": "error",
        "error": {
            "code": "audit_query_error",
            "message": "Audit query failed",
        },
        "page": _normalize_page(page),
    }


def test_filter_contract_uses_existing_audit_query_fields():
    request = {
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

    assert set(request["filters"].keys()) == {
        "eventType",
        "actorId",
        "actorType",
        "resourceType",
        "resourceId",
        "result",
        "severity",
        "category",
        "timeRange",
        "keyword",
    }
    assert request["page"] == {"pageSize": 25, "pageNum": 2}


def test_page_contract_clamps_to_node_audit_query_limits():
    assert _normalize_page({"pageSize": 999, "pageNum": 0}) == {
        "pageSize": 200,
        "pageNum": 1,
    }
    assert _normalize_page({"pageSize": -10, "pageNum": -5}) == {
        "pageSize": 1,
        "pageNum": 1,
    }


def test_empty_result_contract_is_success_not_forbidden():
    response = _ok_response([], 0, {"pageSize": 50, "pageNum": 1})

    assert response == {
        "status": "ok",
        "entries": [],
        "total": 0,
        "page": {"pageSize": 50, "pageNum": 1},
    }


def test_forbidden_contract_cannot_masquerade_as_empty_result():
    response = _forbidden_response({"pageSize": 50, "pageNum": 1})

    assert response["status"] == "forbidden"
    assert response["error"]["code"] == "forbidden"
    assert "entries" not in response
    assert "total" not in response


def test_error_contract_cannot_masquerade_as_empty_result():
    response = _error_response({"pageSize": 10, "pageNum": 3})

    assert response == {
        "status": "error",
        "error": {
            "code": "audit_query_error",
            "message": "Audit query failed",
        },
        "page": {"pageSize": 10, "pageNum": 3},
    }
    assert "entries" not in response
    assert "total" not in response
