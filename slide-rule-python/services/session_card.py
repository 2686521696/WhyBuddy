"""会话卡片摘要：「我的应用」每张会话卡要画的那几样，在**保存时**算好。

## 为什么有这个模块

⚠ 2026-10-03 用户截图 + 本地复现（1920×1080，点「我的应用」）：3 秒内 156 个
API 请求在飞，其中 99 个是 `GET /sessions/{sid}`——每张会话卡挂载就拉一整份
会话（平均 90 KB、最大 800 KB，整页 HTML + 闭环证据全在里面），合计 **9.0 MB**，
最慢一条 17.1 s，最后一条 23 s 才回来。拉回来只为了卡片上那几样：状态标签、
产品名/图标、页面/角色/AI 三个数。封面本来就是「还没有页面截图」占位。
开发态 Vite 是 HTTP/1.1，一个域名 6 条连接，99 条整包排队，就是截图里那一长串
「待处理」。

现在这几样作为**投影列**落在 sliderule_session.card_summary 里（与 goal_text /
runtime_phase 同一路子），GET /sessions 一次带齐，卡片不再逐张拉整包。

## 与前端那份推导逐字段对齐

前端原来的推导是 `AppsWorkbench.tsx` 的 `deriveAppCardDetail(state)`
（→ `buildDetailFromModel` + `parseFiveSystemModelFromPerSkillEvidence`）。
这里是它的 Python 镜像，**语义一处都不许改**——改了就是两张卡同一会话两种状态。
两边被同一份金样钉着：
    tests/fixtures/session_card_parity.json
    tests/test_session_card.py                         （Python 算 → 金样）
    client/src/pages/agent-loop/dashboard/__tests__/session-card-parity.test.ts
                                                       （TS 原推导 → 金样，摘要 → 详情 → 金样）
要改口径先改前端那份推导，再重生金样，两边一起过。

JS 真值语义要照抄：`Boolean([])` 是 true，Python 的 `bool([])` 是 False。
`closure.blocked = []` 这种脏数据在前端判成 blocked，这里也得判成 blocked。

## 不放进摘要的

`model`（五系统模型本体）与 `specPages`（整页 HTML）——卡片不用，会话卡点击
直接进会话（canOpenGalleryItem：session 源恒可进），用不到只读预览。
"""

from __future__ import annotations

import json
import math
from typing import Any, Optional

from .archetype_legal import required_evidence

#: 摘要形状版本。前端只认它认识的版本，不认识就当没有摘要、退回逐张拉整包。
CARD_VERSION = 1

#: 五系统模型的段名。与前端 five-system-model.ts 的 MODEL_KEYS 是同一组——
#: 但这里不抄字面量：闭环定义只有一处账本（services/data/product_archetypes.json，
#: tests/test_product_archetypes.py 钉着「全仓不许再写死六系统字面量」）。
#: 账本的默认原型一改，金样（fixtures/session_card_parity.json）会先红。
MODEL_KEYS = tuple(required_evidence())


def _js_truthy(value: Any) -> bool:
    """JavaScript 的 Boolean(x)：只有 undefined/null/false/0/NaN/"" 是假。"""
    if value is None or value is False:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return not (value == 0 or (isinstance(value, float) and math.isnan(value)))
    if isinstance(value, str):
        return value != ""
    return True  # 空 list / 空 dict 在 JS 里都是真


def _js_string(value: Any) -> str:
    """String(x) 对 JSON 原始值的结果；对象/数组前端会得到 "[object Object]" 之类，
    那是脏数据，这里给空串，不去模仿。"""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isfinite(value) and value == int(value):
            return str(int(value))
        return repr(value) if math.isfinite(value) else ""
    if isinstance(value, str):
        return value
    return ""


def _js_number(value: Any) -> float:
    """`Number(x ?? 0) || 0`：数不出来（NaN）就是 0。"""
    if value is None or value is False:
        return 0.0
    if value is True:
        return 1.0
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if text == "":
            return 0.0
        try:
            number = float(text)
        except ValueError:
            return 0.0
    else:
        return 0.0
    if math.isnan(number) or not math.isfinite(number):
        return 0.0
    return number


def _model_from_closure(closure: dict[str, Any]) -> Optional[dict[str, Any]]:
    """parseFiveSystemModelFromPerSkillEvidence + mergeFiveSystemModels(null, ·)。"""
    evidence = closure.get("perSkillEvidence")
    if not isinstance(evidence, dict):
        return None
    model: dict[str, Any] = {}
    for key in MODEL_KEYS:
        entry = evidence.get(key)
        section = entry.get("modelSection") if isinstance(entry, dict) else None
        if isinstance(section, dict):
            model[key] = section
    return model or None


def _list_of(section: Any, key: str) -> list:
    value = section.get(key) if isinstance(section, dict) else None
    return value if isinstance(value, list) else []


def _names(items: list, limit: int) -> list[str]:
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw = item.get("name")
        if raw is None:
            raw = item.get("id")
        text = _js_string(raw)
        if text:
            out.append(text)
    return out[:limit]


def _identity(model: Optional[dict[str, Any]]) -> Optional[dict[str, str]]:
    bundle = (model or {}).get("appbundle")
    raw = bundle.get("appIdentity") if isinstance(bundle, dict) else None
    if not isinstance(raw, dict):
        return None
    if not (_js_truthy(raw.get("productName")) or _js_truthy(raw.get("theme"))):
        return None
    theme = _js_string(raw.get("theme") if raw.get("theme") is not None else "azure").strip()
    icon = _js_string(raw.get("icon") if raw.get("icon") is not None else "boxes").strip()
    return {
        "productName": _js_string(raw.get("productName")).strip(),
        "theme": theme or "azure",
        "icon": icon or "boxes",
    }


def _status(evidence_count: float, blocked: bool, model: Any, awaiting: bool) -> str:
    if evidence_count >= 6 and not blocked and model:
        return "runnable"
    return "awaiting" if awaiting else "draft"


def session_card_summary(payload: Any) -> dict[str, Any]:
    """会话 payload → 卡片摘要。纯函数，不做 IO，坏数据一律收成「数不出来」。"""
    state = payload if isinstance(payload, dict) else {}
    awaiting = _js_truthy(state.get("awaitReason"))
    if state.get("runtimeKind") == "project":
        # 工程会话：旧闭环 / HTML 可能还留在会话里，但它们给不出工程的结论（同前端那条注释）。
        return {
            "v": CARD_VERSION,
            "runtimeKind": "project",
            "projectId": state["projectId"] if isinstance(state.get("projectId"), str) else None,
            "projectRevision": (
                state["projectRevision"] if isinstance(state.get("projectRevision"), str) else None
            ),
            "status": _status(0, False, None, awaiting),
            "evidenceCount": 0,
            "blocked": False,
            "entities": 0,
            "pages": 0,
            "flowNodes": 0,
            "roles": None,
            "aiCaps": None,
            "identity": None,
            "pageNames": [],
            "entityNames": [],
            "stableDigest": None,
        }
    closure = state.get("publishClosure")
    closure = closure if isinstance(closure, dict) else {}
    model = _model_from_closure(closure)
    evidence_count = _js_number(closure.get("evidencePresentCount"))
    blocked = _js_truthy(closure.get("blocked"))
    digest_raw = closure.get("stableDigest")
    if digest_raw is None:
        digest_raw = closure.get("closureHash")
    digest = _js_string(digest_raw)[:32] or None
    entities = _list_of((model or {}).get("datamodel"), "entities")
    pages = _list_of((model or {}).get("page"), "pages")
    nodes = _list_of((model or {}).get("workflow"), "nodes")
    roles = _list_of((model or {}).get("rbac"), "roles")
    caps = _list_of((model or {}).get("aigc"), "capabilities")
    return {
        "v": CARD_VERSION,
        "runtimeKind": None,
        "projectId": None,
        "projectRevision": None,
        "status": _status(evidence_count, blocked, model, awaiting),
        # 整数就给整数：JSON 里 6 和 6.0 对前端是一回事，但金样比对按字面。
        "evidenceCount": int(evidence_count) if evidence_count == int(evidence_count) else evidence_count,
        "blocked": blocked,
        "entities": len(entities),
        "pages": len(pages),
        "flowNodes": len(nodes),
        "roles": len(roles),
        "aiCaps": len(caps),
        "identity": _identity(model),
        "pageNames": _names(pages, 6),
        "entityNames": _names(entities, 4),
        "stableDigest": digest,
    }


def encode_card(payload: Any) -> Optional[str]:
    """写进 card_summary 列的文本。算不出来就是 None——增强类，不许拖垮保存（本仓第七条）。"""
    try:
        return json.dumps(session_card_summary(payload), ensure_ascii=False, separators=(",", ":"))
    except Exception:  # noqa: BLE001
        return None


def decode_card(raw: Any) -> Optional[dict[str, Any]]:
    """列里读出来的文本 → 摘要。形状不对 / 版本不认识就当没有，调用方退回老路。"""
    if isinstance(raw, dict):
        card = raw
    elif isinstance(raw, (str, bytes)) and raw:
        try:
            card = json.loads(raw)
        except (ValueError, TypeError):
            return None
    else:
        return None
    if not isinstance(card, dict) or card.get("v") != CARD_VERSION:
        return None
    return card
