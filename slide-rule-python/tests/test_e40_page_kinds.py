"""E40.5 页面骨架扩容：wizard（向导式）+ monitor（监控总览式）。"""

from services import schema_legal
from services.v5_model_gate import validate_five_system_model


def _model(page_kind="monitor", bind_workflow=True):
    return {
        "datamodel": {"entities": [{"id": "t", "name": "T", "fields": [
            {"id": "n", "name": "N", "type": "string"}]}]},
        "rbac": {"roles": ["r"], "permissions": ["t:view"],
                 "menus": [{"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}]},
        "workflow": {"id": "wf", "nodes": [{"id": "n1", "name": "第一步", "assigneeRole": "r"}],
                     "transitions": []},
        "page": {"pages": [{"id": "p", "name": "P", "kind": page_kind,
                            "fieldBindings": ["t.n"], "actionPermissions": ["t:view"]}]},
        "aigc": {"capabilities": []},
        "appbundle": {"pageBindings": [
            {"pageRef": "p", "workflowRef": "wf"} if bind_workflow else {"pageRef": "p"}],
            "roleRefs": ["r"], "dataModelRefs": ["t"]},
    }


def test_new_kinds_in_ledger_and_contract():
    assert "wizard" in schema_legal.PAGE_KINDS and "monitor" in schema_legal.PAGE_KINDS
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert schema_legal.enum_str("pageKinds") in _SCHEMA_INSTRUCTION
    assert "PAGE KINDS" in _SCHEMA_INSTRUCTION


def test_monitor_kind_passes_gate():
    assert validate_five_system_model(_model("monitor"))["passed"] is True


def test_wizard_requires_workflow_binding():
    assert validate_five_system_model(_model("wizard", bind_workflow=True))["passed"] is True
    verdict = validate_five_system_model(_model("wizard", bind_workflow=False))
    assert verdict["passed"] is False
    assert any("wizard page must be bound" in f["message"] for f in verdict["findings"])
