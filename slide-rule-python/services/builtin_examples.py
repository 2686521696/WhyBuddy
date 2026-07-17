"""builtin_examples — 官方示例库的数据源（E41）。

示例 = E35 冻结的四个过门演示域模型（builtin_domain_models.json）。这里
只做提炼投影：产品身份（E40.2 已入夹具）+ 真实指标（页面/角色/AI 能力数
= 模型里数出来的，不发明）+ 起手意图（点卡即预填的话题原文）。

北极星纪律：示例永远来自过门冻结模型——没有过门模型就没有示例卡，
数量如实（4 个就是 4 个，不摆 12 个假货架）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

_MODELS_PATH = Path(__file__).resolve().parent / "data" / "builtin_domain_models.json"

# 起手意图与场景分类（点「使用模板」预填的话题原文；分类按域如实标注）
_EXAMPLE_META: Dict[str, Dict[str, str]] = {
    "purchase_approval": {
        "intent": "设计一个采购审批系统，包含采购申请、部门审批和供应商管理",
        "category": "供应链",
    },
    "leave_approval": {
        "intent": "设计一个请假审批系统，包含请假申请、主管审批和假期额度管理",
        "category": "人力资源",
    },
    "service_ticket": {
        "intent": "我们客服团队需要一个服务工单系统，支持工单流转、SLA 升级和客服绩效",
        "category": "客户服务",
    },
    "employee_onboarding": {
        "intent": "设计一个员工入职系统，包含入职流程、部门分配和 HR 权限管理",
        "category": "人力资源",
    },
}

_cache: Optional[List[Dict[str, Any]]] = None


def list_builtin_examples() -> List[Dict[str, Any]]:
    """示例摘要列表（缓存；夹具缺失返回空列表——没有真模型就没有示例）。"""
    global _cache
    if _cache is not None:
        return _cache
    try:
        models = json.loads(_MODELS_PATH.read_text(encoding="utf-8"))
    except Exception:
        _cache = []
        return _cache
    out: List[Dict[str, Any]] = []
    for domain, meta in _EXAMPLE_META.items():
        model = models.get(domain)
        if not isinstance(model, dict):
            continue  # 夹具缺失 → 该示例如实不出现
        identity = (model.get("appbundle") or {}).get("appIdentity") or {}
        pages = (model.get("page") or {}).get("pages") or []
        roles = (model.get("rbac") or {}).get("roles") or []
        caps = (model.get("aigc") or {}).get("capabilities") or []
        out.append({
            "domain": domain,
            "productName": identity.get("productName") or domain,
            "theme": identity.get("theme") or "azure",
            "icon": identity.get("icon") or "boxes",
            "nav": identity.get("nav") or "side",
            "intent": meta["intent"],
            "category": meta["category"],
            "pages": len(pages),
            "roles": len(roles),
            "aiCapabilities": len(caps),
            # 能力标签 = 真实页面名前三（模型里真有的，不编营销词）
            "tags": [
                str(p.get("name") or p.get("id") or "").strip()
                for p in pages[:3]
                if str(p.get("name") or p.get("id") or "").strip()
            ],
        })
    _cache = out
    return _cache
