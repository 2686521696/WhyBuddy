"""确定性内容质量启发式（路线 3 · D1）的单元测试。

覆盖：流程形状（线性/无驳回出路 vs 分支+回退）、页面可达性（fail 级）、
最小权限（满权角色/孤儿权限/无用角色）、孤儿实体/空页面、健康模型零 finding。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.v5_content_quality import analyze_content_quality  # noqa: E402


def _codes(result):
    return [f["code"] for f in result["findings"]]


HEALTHY = {
    "datamodel": {
        "entities": [
            {"id": "order", "name": "订单", "fields": [{"id": "title", "type": "string"}]},
            {"id": "approver", "name": "审批人", "fields": [{"id": "name", "type": "string"}]},
        ]
    },
    "rbac": {
        "roles": ["employee", "manager"],
        "permissions": ["order:create", "order:read", "order:approve"],
        "menus": [
            {"id": "m1", "roleRefs": ["employee"], "permissionRefs": ["order:create", "order:read"]},
            {"id": "m2", "roleRefs": ["manager"], "permissionRefs": ["order:approve"]},
        ],
    },
    "workflow": {
        "nodes": [
            {"id": "submit", "assigneeRole": "employee"},
            {"id": "review", "assigneeRole": "manager"},
            {"id": "done"},
            {"id": "rejected"},
        ],
        "transitions": [
            {"from": "submit", "to": "review"},
            {"from": "review", "to": "done", "condition": "通过"},
            {"from": "review", "to": "rejected", "condition": "驳回"},
        ],
    },
    "page": {
        "pages": [
            {"id": "p1", "fieldBindings": ["order.title"], "actionPermissions": ["order:create"]},
            {"id": "p2", "fieldBindings": ["approver.name"], "actionPermissions": ["order:approve"]},
        ]
    },
    "aigc": {"capabilities": []},
    "appbundle": {},
}


def test_healthy_model_has_no_findings():
    result = analyze_content_quality(HEALTHY)
    assert result["findings"] == []
    assert result["hardFailCount"] == 0
    assert result["metrics"]["workflowLinear"] is False
    assert result["metrics"]["branchNodes"] == 1


def test_linear_flow_without_reject_path_warns():
    model = {
        **HEALTHY,
        "workflow": {
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "transitions": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}],
        },
    }
    result = analyze_content_quality(model)
    codes = _codes(result)
    assert "WORKFLOW_LINEAR" in codes
    assert "WORKFLOW_NO_REJECT_PATH" in codes
    assert result["hardFailCount"] == 0  # warn 不进 hard fail


def test_back_edge_counts_as_reject_path():
    model = {
        **HEALTHY,
        "workflow": {
            "nodes": [{"id": "a"}, {"id": "b"}],
            "transitions": [{"from": "a", "to": "b"}, {"from": "b", "to": "a", "condition": "退回"}],
        },
    }
    codes = _codes(analyze_content_quality(model))
    assert "WORKFLOW_NO_REJECT_PATH" not in codes


def test_unreachable_page_is_hard_fail():
    # 真实案例形态：页面动作权限没有授给任何角色（宠物领养 adopter:read）
    model = {
        **HEALTHY,
        "page": {
            "pages": [
                {"id": "locked", "fieldBindings": ["order.title"], "actionPermissions": ["ghost:read"]},
            ]
        },
    }
    result = analyze_content_quality(model)
    assert "PAGE_UNREACHABLE" in _codes(result)
    assert result["hardFailCount"] == 1
    assert result["metrics"]["unreachablePages"] == 1


def test_least_privilege_orphan_permission_and_unused_role():
    model = {
        **HEALTHY,
        "rbac": {
            "roles": ["admin", "ghost"],
            "permissions": ["p1", "p2", "p3", "p4", "p5"],
            "menus": [
                {"id": "m", "roleRefs": ["admin"], "permissionRefs": ["p1", "p2", "p3", "p4", "p5"]},
            ],
        },
        "workflow": HEALTHY["workflow"],
        "page": {"pages": [{"id": "p1", "fieldBindings": ["order.title"], "actionPermissions": ["p1"]}]},
    }
    result = analyze_content_quality(model)
    codes = _codes(result)
    assert "ROLE_OVER_PRIVILEGED" in codes  # admin 100% 权限
    assert "ROLE_UNUSED" in codes  # ghost 无授权/不审批/无引用
    assert "PERMISSION_ORPHAN" not in codes  # 全部权限有人持有


def test_orphan_entity_and_empty_page():
    model = {
        **HEALTHY,
        "datamodel": {
            "entities": [
                {"id": "order", "fields": [{"id": "title", "type": "string"}]},
                {"id": "lonely", "fields": [{"id": "x", "type": "string"}]},
            ]
        },
        "page": {
            "pages": [
                {"id": "p1", "fieldBindings": ["order.title"], "actionPermissions": ["order:create"]},
                {"id": "blank", "fieldBindings": []},
            ]
        },
    }
    result = analyze_content_quality(model)
    codes = _codes(result)
    assert "ENTITY_ORPHAN" in codes
    assert "PAGE_EMPTY" in codes
    assert result["metrics"]["orphanEntities"] == 1


def test_ref_field_keeps_entity_referenced():
    # order 持有 approver_ref → approver 不算孤儿
    model = {
        **HEALTHY,
        "datamodel": {
            "entities": [
                {
                    "id": "order",
                    "fields": [
                        {"id": "title", "type": "string"},
                        {"id": "approver_ref", "type": "ref"},
                    ],
                },
                {"id": "approver", "fields": [{"id": "name", "type": "string"}]},
            ]
        },
        "page": {"pages": [{"id": "p1", "fieldBindings": ["order.title"], "actionPermissions": ["order:create"]}]},
    }
    result = analyze_content_quality(model)
    assert "ENTITY_ORPHAN" not in _codes(result)
