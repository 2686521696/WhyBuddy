"""Contract tests for the knowledge admin Python proxy boundary.

This slice locks a proxy contract only. It must not persist or mutate the real
knowledge graph store.
"""

from services.rag_service import knowledge_admin_proxy_contract


ADMIN_ACTOR = {
    "id": "worker-1",
    "permissions": ["knowledge.admin"],
}


def _payload(operation, **overrides):
    payload = {
        "operation": operation,
        "projectId": "project-contract",
        "actor": ADMIN_ACTOR,
    }
    payload.update(overrides)
    return payload


def test_list_returns_empty_contract_view_without_storage_claims():
    data = knowledge_admin_proxy_contract(_payload("list"))

    assert data["ok"] is True
    assert data["operation"] == "list"
    assert data["items"] == []
    assert data["storage"] == "contract-only"
    assert data["migratedStorage"] is False
    assert data["provenance"] == "python-knowledge-admin-contract"


def test_upsert_acknowledges_contract_without_persisting_real_data():
    data = knowledge_admin_proxy_contract(
        _payload(
            "upsert",
            item={
                "id": "kb-1",
                "title": "Proxy contract",
                "content": "Contract-only payload",
            },
        )
    )

    assert data["ok"] is True
    assert data["operation"] == "upsert"
    assert data["item"]["id"] == "kb-1"
    assert data["stored"] is False
    assert data["storage"] == "contract-only"
    assert data["migratedStorage"] is False

    listed = knowledge_admin_proxy_contract(_payload("list"))
    assert listed["items"] == []


def test_delete_acknowledges_contract_without_deleting_real_data():
    data = knowledge_admin_proxy_contract(_payload("delete", itemId="kb-1"))

    assert data["ok"] is True
    assert data["operation"] == "delete"
    assert data["deletedId"] == "kb-1"
    assert data["deleted"] is False
    assert data["storage"] == "contract-only"
    assert data["migratedStorage"] is False


def test_permission_failure_shape_is_stable_and_not_success():
    data = knowledge_admin_proxy_contract(
        {
            "operation": "upsert",
            "projectId": "project-contract",
            "actor": {"id": "viewer-1", "permissions": ["knowledge.read"]},
            "item": {"id": "kb-1", "title": "Denied"},
        }
    )

    assert data == {
        "ok": False,
        "operation": "upsert",
        "error": "permission_denied",
        "reason": "missing_knowledge_admin_permission",
        "message": "knowledge admin permission denied",
        "permissionFailure": True,
        "statusCode": 403,
        "provenance": "python-knowledge-admin-contract",
    }


def test_invalid_operation_returns_contract_error():
    data = knowledge_admin_proxy_contract(_payload("publish"))

    assert data["ok"] is False
    assert data["operation"] == "publish"
    assert data["error"] == "invalid_operation"
    assert data["statusCode"] == 400
    assert data["permissionFailure"] is False
