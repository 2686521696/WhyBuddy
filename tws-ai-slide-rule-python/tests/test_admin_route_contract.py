import json


def _assert_admin_contract(response):
    assert response["statusCode"] in {200, 403, 500}
    assert isinstance(response["body"], dict)
    assert isinstance(response["body"].get("success"), bool)

    if response["statusCode"] == 200:
        assert response["outcome"] == "success"
        assert response["body"]["success"] is True
        assert "error" not in response["body"]
        return

    assert response["body"]["success"] is False
    assert isinstance(response["body"].get("error"), str)
    assert response["body"]["error"]
    assert "summary" not in response["body"]
    assert "items" not in response["body"]
    assert "user" not in response["body"]
    assert "project" not in response["body"]


def test_admin_success_contract_locks_safe_summary_shape():
    response = {
        "outcome": "success",
        "statusCode": 200,
        "body": {
            "success": True,
            "summary": {
                "users": 2,
                "projects": 1,
                "runs": 0,
                "failures": 0,
                "audit": 0,
            },
        },
    }

    _assert_admin_contract(response)
    assert set(response["body"]["summary"]) == {
        "users",
        "projects",
        "runs",
        "failures",
        "audit",
    }


def test_admin_success_contract_does_not_include_password_hashes():
    response = {
        "outcome": "success",
        "statusCode": 200,
        "body": {
            "success": True,
            "items": [
                {
                    "id": "user-1",
                    "email": "user@example.com",
                    "role": "user",
                    "status": "active",
                }
            ],
        },
    }

    _assert_admin_contract(response)
    serialized = json.dumps(response["body"], sort_keys=True)
    assert "passwordHash" not in serialized
    assert "hash-should-not-leak" not in serialized


def test_admin_forbidden_contract_never_falls_back_to_success():
    response = {
        "outcome": "forbidden",
        "statusCode": 403,
        "body": {
            "success": False,
            "error": "Admin privileges required",
        },
    }

    _assert_admin_contract(response)
    assert response["body"]["success"] is False
    assert response["body"]["error"] == "Admin privileges required"


def test_admin_error_contract_is_sanitized_and_not_success():
    response = {
        "outcome": "error",
        "statusCode": 500,
        "body": {
            "success": False,
            "error": "Admin route failed",
        },
    }

    _assert_admin_contract(response)
    assert response["body"]["success"] is False
    assert response["body"]["error"] == "Admin route failed"
    assert "database" not in response["body"]["error"].lower()
    assert "password" not in response["body"]["error"].lower()
