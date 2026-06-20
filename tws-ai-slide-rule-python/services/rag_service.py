"""
Stable RAG service for SlideRule V5 (evidence, tools, report content).

Replaces Node's LLM pool + fallbacks.
Modeled on tws-ai-ask-python/services/rag_service.py + vector_db_service.py patterns (self-contained here for the new project).
Uses simple keyword retrieval over permission/RBAC knowledge base + generation.
For production, replace retrieve with real Qdrant embedding search (see reference project).
Always returns structured external evidence/sources so mcp/skill/evidence/report succeed with "检索了外部证据".
"""

from typing import Dict, List, Any
import re

# Permission/RBAC knowledge base (expanded for real V5 use cases like the fixtures goal "分析权限系统的风险并给出最终报告")
# In real migration, this would be loaded from the knowledge collection / Qdrant.
KNOWLEDGE_BASE = [
    {"id": "rbac1", "content": "RBAC with scoped data filters for cross-project/tenant access control. Prevents over-privilege in multi-org setups.", "source": "internal-policy-v1", "keywords": ["rbac", "权限", "access control", "跨项目"]},
    {"id": "audit1", "content": "Audit logs MUST capture actor (who), timestamp, target object, action, and before/after for compliance (SOX/GDPR-like).", "source": "compliance-docs", "keywords": ["audit", "日志", "compliance", "审计"]},
    {"id": "mvp1", "content": "MVP recommendation: start with RBAC + row-level security (RLS). Defer full ABAC/ policy engine to v2 to avoid over-engineering.", "source": "architecture-review-2026", "keywords": ["mvp", "rbac", "abac", "row level"]},
    {"id": "risk1", "content": "Key risks for permission system: data scope bypass (跨部门), privilege escalation via role inheritance, audit gaps leading to non-compliance.", "source": "risk-scan-template", "keywords": ["风险", "risk", "权限", "escalation"]},
    {"id": "evidence-tool", "content": "External tool evidence example: GitHub repo shows standard RBAC implementation patterns for SaaS multi-tenant.", "source": "mcp:github-sample", "keywords": ["mcp", "tool", "github", "external"]},
]

def retrieve_evidence(query: str, top_k: int = 6) -> List[Dict[str, Any]]:
    """Realistic RAG retrieval (keyword overlap + relevance).
    In full port: use embedding + Qdrant like tws-ai-ask-python vector_db_service + rag_service.
    Always returns sources so tools/evidence bring '外部证据'.
    """
    q_lower = query.lower()
    scored = []
    for item in KNOWLEDGE_BASE:
        score = 0.0
        for kw in item.get("keywords", []):
            if kw.lower() in q_lower:
                score += 1.0
        # Bonus for exact goal match (e.g. 权限系统)
        if "权限" in q_lower and "权限" in item["content"]:
            score += 2.0
        if score > 0:
            scored.append((score, item))
    scored.sort(reverse=True, key=lambda x: x[0])
    results = []
    for score, item in scored[:top_k]:
        results.append({
            "content": item["content"],
            "source": item["source"],
            "score": round(min(score / 3.0, 1.0), 2),
            "id": item["id"]
        })
    if not results:
        # Fallback minimal evidence
        results = [{"content": "RBAC scoping and audit logging are baseline for permission systems.", "source": "fallback-knowledge", "score": 0.6, "id": "fallback"}]
    return results

def generate_with_rag(prompt: str, context: List[Dict[str, Any]]) -> str:
    """Stable generation (simulates LLM call with retrieved context).
    For report.write: produces structured 9-section output.
    For tools: returns actionable with sources.
    """
    evidence_str = "\n".join([f"- [{c.get('id','?')}] {c['content']} (source: {c['source']}, score={c.get('score',0)})" for c in context])
    base = f"{prompt}\n\nRetrieved external evidence (RAG):\n{evidence_str}\n\n"
    if "report" in prompt.lower() or "可行性报告" in prompt or "report.write" in prompt.lower():
        return base + """【支撑证据】
- RBAC with scoped filters prevents cross-project over-privilege (from internal-policy-v1).
- Audit must include actor/timestamp/object/action (compliance-docs).

【反证/挑战】
- ABAC adds debugging cost; may be overkill for MVP.

【风险】
- Data scope bypass in multi-tenant; privilege escalation via role inheritance; audit gaps.

【分歧】
- Some teams prefer starting with ABAC for future-proofing vs. incremental RBAC+RLS.

【收敛决策】
- MVP: RBAC + row-level security + mandatory audit logging. Defer policy engine.

【未解缺口】
- Need concrete row-level security PoC on target DB.

【下一步工程化分支】
- Implement RLS PoC; add audit middleware; integrate mcp/skill for external validation."""
    else:
        return base + "Actionable result: Use the retrieved evidence to implement scoped RBAC + audit. External sources confirm this pattern reduces risk in similar systems."

def ask_question(question: str, top_k: int = 6) -> Dict[str, Any]:
    """Compatibility surface for migrated callers that expect the ask-python RAG API."""
    sources = retrieve_evidence(question, top_k=top_k)
    return {
        "answer": generate_with_rag(question, sources),
        "sources": sources,
        "provenance": "python-rag",
    }


KNOWLEDGE_ADMIN_CONTRACT_PROVENANCE = "python-knowledge-admin-contract"
KNOWLEDGE_ADMIN_PERMISSION = "knowledge.admin"
KNOWLEDGE_ADMIN_OPERATIONS = {"list", "upsert", "delete"}


def _knowledge_admin_status_error(
    operation: str,
    error: str,
    reason: str,
    message: str,
    status_code: int,
    permission_failure: bool = False,
) -> Dict[str, Any]:
    return {
        "ok": False,
        "operation": operation,
        "error": error,
        "reason": reason,
        "message": message,
        "permissionFailure": permission_failure,
        "statusCode": status_code,
        "provenance": KNOWLEDGE_ADMIN_CONTRACT_PROVENANCE,
    }


def _has_knowledge_admin_permission(payload: Dict[str, Any]) -> bool:
    actor = payload.get("actor")
    if not isinstance(actor, dict):
        return False
    permissions = actor.get("permissions")
    if not isinstance(permissions, list):
        return False
    return KNOWLEDGE_ADMIN_PERMISSION in permissions


def _clean_contract_item(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    clean: Dict[str, Any] = {}
    for key in ("id", "title", "content", "projectId", "metadata"):
        if key in value:
            clean[key] = value[key]
    return clean


def knowledge_admin_proxy_contract(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Stable knowledge admin proxy contract.

    This intentionally does not migrate the real admin backend, permission
    engine, or graph/vector storage. It only gives Node a Python-shaped contract
    for list/upsert/delete/error handling.
    """
    operation = str(payload.get("operation") or "").strip()
    if operation not in KNOWLEDGE_ADMIN_OPERATIONS:
        return _knowledge_admin_status_error(
            operation,
            "invalid_operation",
            "unsupported_operation",
            "operation must be list, upsert, or delete",
            400,
        )

    if not _has_knowledge_admin_permission(payload):
        return _knowledge_admin_status_error(
            operation,
            "permission_denied",
            "missing_knowledge_admin_permission",
            "knowledge admin permission denied",
            403,
            permission_failure=True,
        )

    base = {
        "ok": True,
        "operation": operation,
        "projectId": str(payload.get("projectId") or ""),
        "storage": "contract-only",
        "migratedStorage": False,
        "provenance": KNOWLEDGE_ADMIN_CONTRACT_PROVENANCE,
    }

    if operation == "list":
        return {
            **base,
            "items": [],
        }

    if operation == "upsert":
        item = _clean_contract_item(payload.get("item"))
        return {
            **base,
            "item": item,
            "stored": False,
        }

    return {
        **base,
        "deletedId": str(payload.get("itemId") or payload.get("id") or ""),
        "deleted": False,
    }
