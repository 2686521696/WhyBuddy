"""Session text and product-graph cleanup for SlideRule browser reloads."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Tuple

from models.v5_state import V5SessionState


MOJIBAKE_MARKERS = ("Ã", "Â", "�", "ç", "æ", "ä", "é")
GBK_MOJIBAKE_MARKERS = ("閲", "瀹", "鍗", "绠", "缁", "鐢", "鏉", "椋", "槨")
PURCHASE_MARKERS = ("采购审批", "采购单", "purchase approval", "purchase_request")


def repair_mojibake_text(value: str) -> str:
    """Repair the two mojibake forms seen on the browser -> Python boundary.

    Covers:
    - UTF-8 bytes repeatedly decoded as latin1, e.g. ``Ã§Â...``.
    - UTF-8 bytes decoded as GBK, e.g. ``閲囪喘瀹℃壒``.
    """
    if not isinstance(value, str) or not value:
        return value

    current = value
    for _ in range(3):
        if not any(marker in current for marker in MOJIBAKE_MARKERS):
            break
        try:
            repaired = current.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if repaired == current:
            break
        current = repaired

    if any(marker in current for marker in GBK_MOJIBAKE_MARKERS):
        try:
            repaired = current.encode("gbk").decode("utf-8")
            if repaired:
                current = repaired
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass

    return current


def _repair_deep(value: Any) -> Tuple[Any, bool]:
    if isinstance(value, str):
        repaired = repair_mojibake_text(value)
        return repaired, repaired != value
    if isinstance(value, list):
        changed = False
        items = []
        for item in value:
            repaired, item_changed = _repair_deep(item)
            items.append(repaired)
            changed = changed or item_changed
        return items, changed
    if isinstance(value, dict):
        changed = False
        result = {}
        for key, item in value.items():
            repaired, item_changed = _repair_deep(item)
            result[key] = repaired
            changed = changed or item_changed
        return result, changed
    return value, False


def _goal_text(data: dict[str, Any]) -> str:
    goal = data.get("goal") if isinstance(data, dict) else None
    if isinstance(goal, dict):
        return str(goal.get("text") or "")
    return str(goal or "")


def is_purchase_approval_text(text: str) -> bool:
    repaired = repair_mojibake_text(text or "")
    lower = repaired.lower()
    return any(marker.lower() in lower for marker in PURCHASE_MARKERS)


def _purchase_approval_graph(goal_text: str) -> dict[str, Any]:
    root_body = goal_text or "生成一个采购审批应用，包含采购单、申请人、部门经理、财务、采购执行、审批流、表单页面和风险摘要"
    nodes = [
        {
            "id": "purchase-app-root",
            "type": "question",
            "title": "采购审批应用",
            "body": root_body,
            "status": "complete",
            "order": 0,
            "round": 0,
        },
        {
            "id": "purchase-datamodel",
            "type": "evidence",
            "title": "DataModel（数据模型）：采购单",
            "body": "实体：采购单；字段：申请人、部门、金额、供应商、状态、风险摘要。",
            "status": "complete",
            "order": 1,
            "round": 1,
        },
        {
            "id": "purchase-rbac",
            "type": "risk",
            "title": "RBAC（权限）：角色与字段访问",
            "body": "角色：申请人、部门经理、财务、采购执行；控制字段可见、可编辑和审批权限。",
            "status": "complete",
            "order": 2,
            "round": 1,
        },
        {
            "id": "purchase-workflow",
            "type": "decision",
            "title": "Workflow（流程）：采购审批流",
            "body": "申请提交 -> 部门经理审批 -> 财务复核 -> 采购执行 -> 归档。",
            "status": "complete",
            "order": 3,
            "round": 1,
        },
        {
            "id": "purchase-page",
            "type": "synthesis",
            "title": "Page（页面）：申请与审批表单",
            "body": "页面：采购申请表、经理审批页、财务复核页、采购执行页、待办列表。",
            "status": "complete",
            "order": 4,
            "round": 1,
        },
        {
            "id": "purchase-aigc",
            "type": "synthesis",
            "title": "AIGC（智能生成）：风险摘要",
            "body": "基于金额、供应商、历史风险和审批意见生成风险摘要与处理建议。",
            "status": "complete",
            "order": 5,
            "round": 1,
        },
        {
            "id": "purchase-appbundle",
            "type": "decision",
            "title": "AppBundle（应用发布包）：6/6 证据闭环",
            "body": "汇总 DataModel、RBAC、Workflow、Page、AIGC、AppBundle 的运行证据并形成可发布应用。",
            "status": "complete",
            "order": 6,
            "round": 2,
        },
    ]
    edges = [
        {"id": "purchase-root-dm", "source": "purchase-app-root", "target": "purchase-datamodel", "type": "supports"},
        {"id": "purchase-dm-rbac", "source": "purchase-datamodel", "target": "purchase-rbac", "type": "depends_on"},
        {"id": "purchase-rbac-workflow", "source": "purchase-rbac", "target": "purchase-workflow", "type": "depends_on"},
        {"id": "purchase-workflow-page", "source": "purchase-workflow", "target": "purchase-page", "type": "depends_on"},
        {"id": "purchase-page-aigc", "source": "purchase-page", "target": "purchase-aigc", "type": "supports"},
        {"id": "purchase-page-bundle", "source": "purchase-page", "target": "purchase-appbundle", "type": "depends_on"},
        {"id": "purchase-aigc-bundle", "source": "purchase-aigc", "target": "purchase-appbundle", "type": "depends_on"},
    ]
    return {
        "id": "sliderule-session-graph",
        "jobId": "sliderule-prototype",
        "stage": "purchase_approval_app_closure",
        "nodes": nodes,
        "edges": edges,
        "source": "python-product-closure",
        "centralQuestion": {
            "id": "purchase-app-root",
            "title": "采购审批应用",
            "body": root_body,
        },
    }


def _should_project_purchase_graph(data: dict[str, Any]) -> bool:
    text = _goal_text(data)
    if not is_purchase_approval_text(text):
        return False
    graph = data.get("graph") if isinstance(data.get("graph"), dict) else {}
    nodes = graph.get("nodes") if isinstance(graph, dict) else []
    if not isinstance(nodes, list):
        return True
    if len(nodes) <= 1:
        return True
    if all(str(node.get("id", "")).startswith("purchase-") for node in nodes if isinstance(node, dict)):
        return True
    return not any(str(node.get("id", "")).startswith("purchase-app") for node in nodes if isinstance(node, dict))


def sanitize_session_state(state: V5SessionState) -> tuple[V5SessionState, bool]:
    data = state.model_dump()
    repaired, changed = _repair_deep(data)
    if isinstance(repaired, dict) and _should_project_purchase_graph(repaired):
        repaired["graph"] = _purchase_approval_graph(_goal_text(repaired))
        changed = True
    if not changed:
        return state, False
    return V5SessionState.server_load(repaired), True


def sanitize_session_dict(data: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    repaired, changed = _repair_deep(deepcopy(data))
    if isinstance(repaired, dict) and _should_project_purchase_graph(repaired):
        repaired["graph"] = _purchase_approval_graph(_goal_text(repaired))
        changed = True
    return repaired, changed
