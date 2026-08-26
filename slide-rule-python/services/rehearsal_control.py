"""薄控制面（M1 合同）。点火插座是信封 helper，不是裸生成器。

⚠ 2026-08-27 PR-4：写进模块头的是合同，不是「这个文件做什么」。缺任何一条
= 这个 PR 失败。实现必须能被变异咬住（删 helper 调用点 → 测试红）。

1. Route POST /api/sliderule/control-turn-stream, _require_login. No Node twin.
2. SSE: control_text, control_tool_start, control_tool_result, control_ask_user,
   control_scope_card, control_handoff_factory (with runId), complete.
   Cheap turns are request-scoped (no run_registry). Handoff starts the factory
   run; same SSE (or client resume consumer) then factory events.
3. Parking: awaitReason MUST be the expanded control_ask / control_scope.
   controlTranscript is a schema field. Tool loop MUST NOT spin waiting for
   the user in the same HTTP request.
4. Cheap turns write only controlTranscript. FORBIDDEN to append
   greetings/inspect/search into conversation.
5. inspect_model bounded digest (≤40 items / ≤4k chars), never raw five-system
   JSON; missing → fail-open empty digest + one human sentence.
6. Hard caps: 8 tool rounds, 8k cheap tokens, 45s wall clock before ignition.
   Over cap → control_text 「停在控制面，未点火」+ complete, helper = 0.
7. Failure → canned reply 「我是面团的推演引擎。说一个要做的应用，或问当前应用里已经推出来的角色/页面。」
   FORBIDDEN open chat without tools. FORBIDDEN helper/generator.
   FORBIDDEN driveReasoningSession.
8. Ignition socket = envelope helper, not bare generator. Named fields.
   Product missing session_id → 400 (no anon-).
9. Every product POST (including greetings) MUST carry the six fields.
   FORBIDDEN {forcedTool, goal} only.
10. Expensive buttons are deterministic: 开始推演 = forcedTool rehearse
    (skip LLM). /推演 without confirmed card parks. /精修 = refine.
    补齐缺口 = repair. 质疑 = challenge (invalidate once, no helper).

Closed tool table: ask_user, search_evidence, inspect_model, scope_card,
rehearse, refine, challenge, repair, restore_version, fork_variant.
LLM cannot invent tools. No tool may write blocked=false.

Q1=A：tools 只活在 control_client；factory sliderule_llm/client.py 不得长
tools 字段。rehearse/refine/repair 只调 start_drive_full_factory_run。
FORBIDDEN: `async for drive_full_v5_session_stream`。
refine 走生成器 refine-context（v5_full_driver wants_refine /
set_refine_context）；FORBIDDEN 把 v5_capability_executor 当入口 import。
未确认范围 + forcedTool rehearse → park，helper calls = 0。
"""

from __future__ import annotations

import copy
import json
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import HTTPException

from models.v5_state import UserIntervention, V5SessionState
from services.drive_full_factory import start_drive_full_factory_run
from services.slide_rule_interactive_gates import (
    apply_user_intervention_invalidation,
)
from services.slide_rule_session import load_session, save_session
from services.v5_full_driver import _truthy_scope_flag
from sliderule_llm.control_client import ControlLlmResult, call_control_llm

CANNED_FAILURE = (
    "我是面团的推演引擎。说一个要做的应用，或问当前应用里已经推出来的角色/页面。"
)
OVER_CAP_TEXT = "停在控制面，未点火"

CONTROL_SIX_FIELDS = (
    "sessionId",
    "userText",
    "installedSkills",
    "activeConnectors",
    "preferredDevice",
    "designSystemId",
)

# 控制面本回合信封。_handoff_factory 在 persist-as-authority 之后再读，
# 把 reuse_charter / product_charter 交给工厂命名字段——asyncio.create_task
# 复制 ContextVar 救不了「脚本直打 /drive-full-stream」那条。
_CONTROL_PAYLOAD: ContextVar[Dict[str, Any]] = ContextVar(
    "sliderule_control_payload", default={}
)

CLOSED_TOOLS = (
    "ask_user",
    "search_evidence",
    "inspect_model",
    "scope_card",
    "rehearse",
    "refine",
    "challenge",
    "repair",
    "restore_version",
    "fork_variant",
)

MAX_TOOL_ROUNDS = 8
MAX_CHEAP_TOKENS = 8000
MAX_WALL_SECONDS = 45.0
INSPECT_MAX_ITEMS = 40
INSPECT_MAX_CHARS = 4000

CONTROL_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": "停下来问用户一个问题。本请求必须结束，不得空转等待。",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_evidence",
            "description": "控制面检索。不计入闭环证据，不 commit_artifact。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_model",
            "description": "查看当前五系统模型的有界摘要，禁止倒出原始 JSON。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scope_card",
            "description": "出示推演范围卡并停泊，等用户点开始推演。",
            "parameters": {
                "type": "object",
                "properties": {
                    "restatement": {"type": "string"},
                    "device": {"type": "string"},
                    "variant": {"type": "string"},
                    "wantEvidence": {"type": "boolean"},
                    "wantFeasibilityReport": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rehearse",
            "description": "点火推演。未确认范围卡时必须先 park。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refine",
            "description": "在现有模型上精修。不得用 userText 覆盖 session goal。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "challenge",
            "description": "质疑：失效一次，不点火。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repair",
            "description": "补齐缺口。只重跑覆盖门标红的能力。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restore_version",
            "description": "回退到某一版模型。",
            "parameters": {
                "type": "object",
                "properties": {"versionId": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fork_variant",
            "description": "从当前应用分出一条变体。",
            "parameters": {
                "type": "object",
                "properties": {"newName": {"type": "string"}},
            },
        },
    },
]


def validate_control_turn_body(payload: Dict[str, Any]) -> None:
    """产品 POST 必须带齐六字段。{forcedTool, goal} only → 400。"""
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="control-turn requires sessionId, userText, installedSkills, "
            "activeConnectors, preferredDevice, designSystemId",
        )
    missing = [key for key in CONTROL_SIX_FIELDS if key not in payload]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="control-turn requires sessionId, userText, installedSkills, "
            "activeConnectors, preferredDevice, designSystemId",
        )
    sid = str(payload.get("sessionId") or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id required")


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _append_transcript(state: V5SessionState, entry: Dict[str, Any]) -> None:
    rows = list(getattr(state, "controlTranscript", None) or [])
    item = {"id": f"ct-{uuid.uuid4().hex[:10]}", "timestamp": _now_iso(), **entry}
    rows.append(item)
    state.controlTranscript = rows


def _goal_text(state: V5SessionState) -> str:
    goal = getattr(state, "goal", None) or {}
    if isinstance(goal, dict):
        return str(goal.get("text") or "").strip()
    return str(getattr(goal, "text", "") or "").strip()


def _scope_confirmed(state: V5SessionState) -> bool:
    """已确认范围：有模型版本，或 transcript 里有 scope_confirmed。

    ⚠ 2026-08-27 评审：awaitReason==control_scope 是「等确认」，不是已确认。
    第一版把停泊当成已确认，先改范围后 /推演 或模型 rehearse 会跳卡点火。
    """
    if getattr(state, "awaitReason", None) == "control_scope":
        return False
    versions = getattr(state, "modelVersions", None) or []
    if versions:
        return True
    for row in getattr(state, "controlTranscript", None) or []:
        if isinstance(row, dict) and row.get("kind") == "scope_confirmed":
            return True
    return False


def _write_confirmed_goal(state: V5SessionState, restatement: str) -> None:
    """确认 rehearse 才写 goal；空 goal 用复述句。精修不得走这里。"""
    if _goal_text(state):
        return
    text = (restatement or "").strip()
    if not text:
        return
    goal = dict(state.goal) if isinstance(state.goal, dict) else {}
    goal["text"] = text
    if not goal.get("status"):
        goal["status"] = "clear"
    state.goal = goal


def _copy_scope_opt_in_into_goal(state: V5SessionState) -> None:
    """把范围卡勾选写进 goal，供 persist-as-authority 工厂短清单读取。

    ⚠ 2026-08-27 评审：第一版「两旗都假就 return」。上一张卡勾过的
    wantFeasibilityReport 留在 goal 上，下一张没勾的卡确认时 copy 空转，
    短清单仍注入 critique/risk/report——缺字段本应 fail-closed。每次都
    按最后一张 scope_card 同步 True 和 False（没勾就删键）。
    bool("false") 是 True，读旗必须走生成器同一份 _truthy_scope_flag。
    不把 HTTP factoryProfile 当勾选通道。
    """
    want_evidence = False
    want_report = False
    for row in reversed(list(getattr(state, "controlTranscript", None) or [])):
        if not isinstance(row, dict) or row.get("kind") != "scope_card":
            continue
        want_evidence = _truthy_scope_flag(row.get("wantEvidence"))
        want_report = _truthy_scope_flag(row.get("wantFeasibilityReport"))
        break
    goal = dict(state.goal) if isinstance(state.goal, dict) else {}
    if want_evidence:
        goal["wantEvidence"] = True
    else:
        goal.pop("wantEvidence", None)
        goal.pop("includeEvidence", None)
    if want_report:
        goal["wantFeasibilityReport"] = True
    else:
        goal.pop("wantFeasibilityReport", None)
        goal.pop("includeFeasibilityReport", None)
    state.goal = goal


def _confirmed_restatement(state: V5SessionState, user_text: str) -> str:
    parked = str(getattr(state, "awaitDetail", None) or "").strip()
    if parked:
        return parked
    return _restate(user_text)


def _is_slash_rehearse(user_text: str) -> bool:
    text = (user_text or "").strip()
    return text.startswith("/推演") or text == "推演"


def resolve_forced_tool(payload: Dict[str, Any], user_text: str) -> Optional[str]:
    raw = payload.get("forcedTool") or payload.get("forced_tool")
    if isinstance(raw, str) and raw.strip() in CLOSED_TOOLS:
        return raw.strip()
    if str(payload.get("mode") or "").strip().lower() == "repair":
        return "repair"
    text = (user_text or "").strip()
    if text.startswith("/精修"):
        return "refine"
    if text.startswith("/质疑"):
        return "challenge"
    if text.startswith("/范围"):
        return "scope_card"
    if text.startswith("/回退"):
        return "restore_version"
    return None


def _dump_state(state: V5SessionState) -> Dict[str, Any]:
    return state.model_dump()


def _complete(state: V5SessionState) -> Dict[str, Any]:
    return {"type": "complete", "state": _dump_state(state)}


def _persist(state: V5SessionState) -> V5SessionState:
    return save_session(state)


_SLASH_VERBS = ("/推演", "/精修", "/质疑", "/范围", "/回退")


def _restate(user_text: str) -> str:
    """复述句。斜杠动词剥掉；剥空返回空串，让调用方落到 original_goal。

    ⚠ 2026-08-27：第一版只剥 `/推演`，且 `stripped or text` 把裸 `/范围`
    填回去——卡标题变成「将做成：/范围」，goal 再没用上。
    """
    import re

    text = (user_text or "").strip()
    stripped = re.sub(
        r"^(请)?(帮我)?(做一?个|搭建|设计一?个|构建|开发一?个|建一?个|来一?个|create|build|design)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(r"[。！？.!?]+$", "", stripped).strip()
    for cmd in _SLASH_VERBS:
        if stripped == cmd or stripped.startswith(cmd):
            stripped = stripped[len(cmd) :].strip()
            break
    if not stripped or stripped.startswith("/"):
        return ""
    return stripped


def _previous_model_version_id(state: V5SessionState) -> str:
    """当前指针的上一版。对不上 / 已经是第一版 → 空（fail-closed）。"""
    versions = list(getattr(state, "modelVersions", None) or [])
    ids: List[str] = []
    for row in versions:
        vid = ""
        if isinstance(row, dict):
            vid = str(row.get("id") or "").strip()
        else:
            vid = str(getattr(row, "id", "") or "").strip()
        if vid:
            ids.append(vid)
    if not ids:
        return ""
    current = str(getattr(state, "currentModelVersionId", None) or "").strip()
    if current and current in ids:
        idx = ids.index(current)
    else:
        idx = len(ids) - 1
    if idx > 0:
        return ids[idx - 1]
    return ""


def _inspect_digest(state: V5SessionState) -> tuple[str, str]:
    """有界摘要。缺模型 → fail-open 空摘要 + 一句人话。永不倒出原始五系统 JSON。"""
    human = "当前还没有五系统模型可查看。"
    model: Optional[Dict[str, Any]] = None
    try:
        from services.v5_full_driver import extract_model_from_closure

        closure = getattr(state, "publishClosure", None)
        model = extract_model_from_closure(closure) if closure is not None else None
        if model is None:
            versions = list(getattr(state, "modelVersions", None) or [])
            current_id = getattr(state, "currentModelVersionId", None)
            for row in reversed(versions):
                if not isinstance(row, dict):
                    continue
                if current_id and row.get("id") != current_id:
                    continue
                if isinstance(row.get("model"), dict):
                    model = row["model"]
                    break
            if model is None:
                for row in reversed(versions):
                    if isinstance(row, dict) and isinstance(row.get("model"), dict):
                        model = row["model"]
                        break
    except Exception:  # noqa: BLE001 — 增强类 fail-open
        model = None
    if not isinstance(model, dict) or not model:
        return "", human

    items: List[str] = []

    def walk(prefix: str, value: Any) -> None:
        if len(items) >= INSPECT_MAX_ITEMS:
            return
        if isinstance(value, dict):
            for key, child in list(value.items())[:12]:
                walk(f"{prefix}.{key}" if prefix else str(key), child)
        elif isinstance(value, list):
            items.append(f"{prefix}: {len(value)} items")
        else:
            text = str(value)
            if len(text) > 80:
                text = text[:77] + "..."
            items.append(f"{prefix}: {text}")

    walk("", model)
    digest = "\n".join(items[:INSPECT_MAX_ITEMS])
    if len(digest) > INSPECT_MAX_CHARS:
        digest = digest[:INSPECT_MAX_CHARS]
    return digest, "当前模型摘要（有界，不是原始五系统 JSON）。"


async def _park_ask(
    state: V5SessionState, question: str, options: Optional[List[str]] = None
) -> AsyncIterator[Dict[str, Any]]:
    state.runtimePhase = "awaiting"
    state.awaitReason = "control_ask"
    state.awaitDetail = question
    _append_transcript(
        state,
        {
            "role": "assistant",
            "kind": "ask_user",
            "text": question,
            "options": list(options or []),
        },
    )
    _persist(state)
    yield {
        "type": "control_ask_user",
        "question": question,
        "options": list(options or []),
    }
    yield _complete(state)


async def _park_scope(
    state: V5SessionState,
    restatement: str,
    *,
    device: str = "unspecified",
    variant: str = "full",
    user_text: str = "",
    want_evidence: bool = False,
    want_feasibility_report: bool = False,
) -> AsyncIterator[Dict[str, Any]]:
    state.runtimePhase = "awaiting"
    state.awaitReason = "control_scope"
    state.awaitDetail = restatement
    _append_transcript(
        state,
        {
            "role": "assistant",
            "kind": "scope_card",
            "text": restatement,
            "device": device,
            "variant": variant,
            "wantEvidence": _truthy_scope_flag(want_evidence),
            "wantFeasibilityReport": _truthy_scope_flag(want_feasibility_report),
        },
    )
    _persist(state)
    yield {
        "type": "control_scope_card",
        "restatement": restatement,
        "device": device,
        "variant": variant,
        "userText": user_text or restatement,
        # 前端 localStorage 未写时用账户/会话旗hydrate「下一场沿用」。
        "charterReuseNext": bool(getattr(state, "charterReuseNext", False)),
    }
    yield _complete(state)


async def _dismiss_scope(state: V5SessionState) -> AsyncIterator[Dict[str, Any]]:
    """先改范围：持久化清掉 control_scope 停泊，不点火。"""
    state.awaitReason = None
    state.awaitDetail = None
    if getattr(state, "runtimePhase", None) == "awaiting":
        state.runtimePhase = "idle"
    _append_transcript(
        state,
        {"role": "system", "kind": "scope_dismissed", "text": "先改范围"},
    )
    _persist(state)
    yield _complete(state)


async def _confirm_rehearse_and_handoff(
    state: V5SessionState,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
) -> AsyncIterator[Dict[str, Any]]:
    """确认 rehearse：空 goal 写入复述句、persist，再交给 persist-as-authority 信封。"""
    restatement = _confirmed_restatement(state, user_text)
    _write_confirmed_goal(state, restatement)
    _copy_scope_opt_in_into_goal(state)
    _append_transcript(
        state,
        {"role": "system", "kind": "scope_confirmed", "text": restatement},
    )
    state.awaitReason = None
    state.awaitDetail = None
    _persist(state)
    async for event in _handoff_factory(
        state,
        user_text,
        installed_skills,
        active_connectors,
        preferred_device,
        design_system_id,
        repair=False,
        profile="app",
    ):
        yield event


async def _handoff_factory(
    state: V5SessionState,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    *,
    repair: bool = False,
    profile: str = "full",
    max_loops: int = 10,
) -> AsyncIterator[Dict[str, Any]]:
    """唯一点火插座。rehearse/refine/repair 必须走这里，禁止裸生成器。"""
    from services import run_registry
    from services.product_charter import factory_charter_kwargs

    charter_kw = factory_charter_kwargs(_CONTROL_PAYLOAD.get())
    run = await start_drive_full_factory_run(
        state.sessionId,
        user_text,
        installed_skills,
        active_connectors,
        preferred_device,
        design_system_id,
        repair=repair,
        profile=profile,  # type: ignore[arg-type]
        max_loops=max_loops,
        require_session_id=True,
        **charter_kw,
    )
    yield {
        "type": "control_handoff_factory",
        "runId": getattr(run, "run_id", None),
    }
    async for event in run_registry.subscribe(run, since=0):
        yield event


async def _tool_challenge(state: V5SessionState, user_text: str) -> AsyncIterator[Dict[str, Any]]:
    yield {"type": "control_tool_start", "tool": "challenge"}
    intervention = UserIntervention(
        intent="challenge",
        text=(user_text or "质疑").strip() or "质疑",
    )
    apply_user_intervention_invalidation(state, intervention)
    _append_transcript(state, {"role": "assistant", "kind": "challenge", "text": user_text})
    _persist(state)
    yield {
        "type": "control_tool_result",
        "tool": "challenge",
        "ok": True,
        "detail": "invalidated",
    }
    yield {
        "type": "control_text",
        "text": "已按质疑失效相关产物。需要的话再说一次要改什么。",
    }
    yield _complete(state)


async def _tool_search(state: V5SessionState, query: str) -> Dict[str, Any]:
    hits: List[Dict[str, Any]] = []
    try:
        from services.rag_service import retrieve_evidence

        raw = retrieve_evidence(query or "", top_k=6) or []
        for item in raw[:6]:
            if not isinstance(item, dict):
                continue
            hits.append(
                {
                    "title": item.get("title") or item.get("source") or "",
                    "content": str(item.get("content") or item.get("text") or "")[:400],
                    "provenance": "control-search",
                }
            )
    except Exception:  # noqa: BLE001 — 增强类 fail-open
        hits = []
    summary = (
        "；".join(
            str(h.get("title") or h.get("content") or "")[:80] for h in hits if h
        )
        or "没有检索到可用片段。"
    )
    _append_transcript(
        state,
        {
            "role": "tool",
            "kind": "search_evidence",
            "text": query,
            "provenance": "control-search",
            "hits": hits,
        },
    )
    # 故意不碰 conversation / publishClosure / commit_artifact
    return {"ok": True, "summary": summary, "hits": hits, "provenance": "control-search"}


async def _tool_inspect(state: V5SessionState) -> Dict[str, Any]:
    digest, human = _inspect_digest(state)
    _append_transcript(
        state,
        {"role": "tool", "kind": "inspect_model", "text": digest or human},
    )
    return {"ok": True, "digest": digest, "human": human}


async def _tool_restore(state: V5SessionState, version_id: str) -> Dict[str, Any]:
    """空 versionId 是静默 no-op（锁里找不到 id==""）。缺 id 必须 fail-closed。"""
    vid = (version_id or "").strip()
    if not vid:
        return {"ok": False, "error": "version_id required"}
    try:
        from fastapi.responses import JSONResponse
        from routes.sliderule_full import _restore_model_version_locked

        result = _restore_model_version_locked(state.sessionId, vid)
        if isinstance(result, JSONResponse):
            return {"ok": False, "error": "restore_failed", "versionId": vid}
        if isinstance(result, dict) and isinstance(result.get("state"), dict):
            restored = V5SessionState.server_load(result["state"])
            state.modelVersions = restored.modelVersions
            state.currentModelVersionId = restored.currentModelVersionId
            state.publishClosure = restored.publishClosure
            state.specFirstPages = restored.specFirstPages
            _append_transcript(
                state, {"role": "tool", "kind": "restore_version", "text": vid}
            )
            return {
                "ok": True,
                "versionId": vid,
                "restored": result.get("restored", True),
            }
        return {"ok": False, "error": "restore_failed", "versionId": vid}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:200]}


async def _tool_fork(state: V5SessionState, new_name: str) -> Dict[str, Any]:
    """在本会话 modelVersions 时间线上分一条变体。

    ⚠ 不能调 fork_app(..., session_id=state.sessionId)：画廊副本会粘在源
    会话上——点开副本却进了源会话。版本条坐在 modelVersions 上，用户要
    看到的是 变体 n+1，不是画廊里多一张同会话卡片。失败必须 ok:false。
    """
    try:
        versions = [
            item
            for item in (getattr(state, "modelVersions", None) or [])
            if isinstance(item, dict)
        ]
        current_id = str(getattr(state, "currentModelVersionId", "") or "")
        source = None
        if current_id:
            for item in versions:
                if str(item.get("id") or "") == current_id:
                    source = item
                    break
        if source is None and versions:
            source = versions[-1]
        if not isinstance(source, dict) or not source:
            return {"ok": False, "error": "没有可分的模型版本"}
        max_seq = 0
        for item in versions:
            vid = str(item.get("id") or "")
            if vid.startswith("mv-"):
                try:
                    max_seq = max(max_seq, int(vid[3:]))
                except ValueError:
                    pass
        new_id = f"mv-{max_seq + 1}"
        clone = copy.deepcopy(source)
        clone["id"] = new_id
        clone["instruction"] = str(new_name or "变体")[:300]
        clone["createdAt"] = datetime.now(timezone.utc).isoformat()
        clone["turnId"] = str(getattr(state, "lastTurnId", "") or "")
        versions.append(clone)
        state.modelVersions = versions[-20:]
        state.currentModelVersionId = new_id
        _append_transcript(
            state,
            {
                "role": "tool",
                "kind": "fork_variant",
                "text": clone["instruction"],
                "versionId": new_id,
            },
        )
        return {"ok": True, "versionId": new_id}
    except Exception as exc:  # noqa: BLE001 — 增强类 fail-open
        return {"ok": False, "error": str(exc)[:200]}


def _system_prompt(state: V5SessionState) -> str:
    goal = _goal_text(state) or "（尚无确认的应用目标）"
    parked = getattr(state, "awaitReason", None) or "none"
    from services.product_charter import charter_prompt_block

    extra = charter_prompt_block()
    base = (
        "你是面团的薄控制面。只能调用给定工具，不能发明工具。"
        "禁止开放闲聊。问候用 ask_user 或一句短回复；"
        "要做应用先 scope_card；未确认不得 rehearse。"
        "search_evidence 不计入闭环。inspect_model 只看摘要。"
        f"当前目标：{goal[:200]}。停泊：{parked}。"
    )
    return f"{base}\n{extra}" if extra else base


def _usage_tokens(usage: Any) -> int:
    if not isinstance(usage, dict):
        return 0
    for key in ("total_tokens", "prompt_tokens", "completion_tokens"):
        try:
            value = int(usage.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if key == "total_tokens" and value:
            return value
    try:
        return int(usage.get("prompt_tokens") or 0) + int(
            usage.get("completion_tokens") or 0
        )
    except (TypeError, ValueError):
        return 0


async def _canned(state: V5SessionState, text: str) -> AsyncIterator[Dict[str, Any]]:
    _append_transcript(state, {"role": "assistant", "kind": "canned", "text": text})
    _persist(state)
    yield {"type": "control_text", "text": text}
    yield _complete(state)


async def run_control_turn(
    payload: Dict[str, Any],
) -> AsyncIterator[Dict[str, Any]]:
    """产品控制面主循环。cheap 请求内结束；点火才调信封 helper。"""
    validate_control_turn_body(payload)
    session_id = str(payload["sessionId"]).strip()
    state = load_session(session_id)
    if state is None:
        raise HTTPException(status_code=400, detail="session_id required")

    from services.product_charter import activate_charter_for_run, clear_charter_for_run

    token = _CONTROL_PAYLOAD.set(payload if isinstance(payload, dict) else {})
    activate_charter_for_run(state, payload)
    try:
        async for event in _run_control_turn_body(payload, state):
            yield event
    finally:
        clear_charter_for_run()
        _CONTROL_PAYLOAD.reset(token)


async def _run_control_turn_body(
    payload: Dict[str, Any],
    state: V5SessionState,
) -> AsyncIterator[Dict[str, Any]]:
    user_text = str(payload.get("userText") or "")
    installed_skills = payload.get("installedSkills")
    active_connectors = payload.get("activeConnectors")
    preferred_device = payload.get("preferredDevice")
    design_system_id = payload.get("designSystemId")
    started = time.monotonic()
    cheap_tokens = 0
    original_goal = _goal_text(state)

    _append_transcript(state, {"role": "user", "kind": "turn", "text": user_text})

    raw_forced = str(
        payload.get("forcedTool") or payload.get("forced_tool") or ""
    ).strip()
    if raw_forced == "dismiss_scope":
        async for event in _dismiss_scope(state):
            yield event
        return

    forced = resolve_forced_tool(payload, user_text)

    async def _maybe_over_cap() -> bool:
        return (
            time.monotonic() - started > MAX_WALL_SECONDS
            or cheap_tokens > MAX_CHEAP_TOKENS
        )

    # 昂贵按钮：跳过控制面 LLM。
    # 停泊中只有「开始推演」(forcedTool=rehearse) 才点火；/推演 与模型
    # rehearse 必须再 park。确认时把复述句写入 goal 并 persist，再 handoff。
    parked_unconfirmed = getattr(state, "awaitReason", None) == "control_scope"
    if forced == "rehearse" or (forced is None and _is_slash_rehearse(user_text)):
        may_ignite = _scope_confirmed(state) or (
            forced == "rehearse" and parked_unconfirmed
        )
        if not may_ignite:
            restatement = _confirmed_restatement(state, user_text) or _restate(
                original_goal
            )
            async for event in _park_scope(
                state,
                restatement,
                device=str(preferred_device or "unspecified"),
                variant="thin" if original_goal else "full",
                user_text=user_text,
            ):
                yield event
            return
        async for event in _confirm_rehearse_and_handoff(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
        ):
            yield event
        return

    if forced == "refine":
        # 精修：userText 是增量指令，禁止覆盖 session goal。persist 后再
        # handoff，否则 persist-as-authority 工厂加载看不到这道闸。
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        goal["text"] = original_goal
        state.goal = goal
        _persist(state)
        async for event in _handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            repair=False,
            profile="full",
        ):
            yield event
        return

    if forced == "repair":
        async for event in _handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            repair=True,
            profile="full",
            max_loops=2,
        ):
            yield event
        return

    if forced == "challenge":
        async for event in _tool_challenge(state, user_text):
            yield event
        return

    if forced in CLOSED_TOOLS:
        # 其余 forced 工具仍跳过 LLM，走一圈执行器。
        tool_args: Dict[str, Any] = {}
        if forced == "restore_version":
            vid = str(
                payload.get("versionId") or payload.get("version_id") or ""
            ).strip()
            if vid:
                tool_args["versionId"] = vid
        async for event in _dispatch_tool(
            forced,
            tool_args,
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            original_goal,
        ):
            yield event
        return

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": _system_prompt(state)},
        {"role": "user", "content": user_text or "你好"},
    ]

    try:
        for _round in range(MAX_TOOL_ROUNDS):
            if await _maybe_over_cap():
                async for event in _canned(state, OVER_CAP_TEXT):
                    yield event
                return
            result = call_control_llm(messages, tools=CONTROL_TOOLS)
            cheap_tokens += _usage_tokens(getattr(result, "usage", None))
            if await _maybe_over_cap():
                async for event in _canned(state, OVER_CAP_TEXT):
                    yield event
                return
            calls = [
                call
                for call in (result.tool_calls or [])
                if (call.get("name") or "") in CLOSED_TOOLS
            ]
            content = (result.content or "").strip()
            if not calls:
                text = content or CANNED_FAILURE
                _append_transcript(
                    state, {"role": "assistant", "kind": "control_text", "text": text}
                )
                _persist(state)
                yield {"type": "control_text", "text": text}
                yield _complete(state)
                return

            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": content or None,
                "tool_calls": [
                    {
                        "id": call.get("id") or f"call-{i}",
                        "type": "function",
                        "function": {
                            "name": call.get("name"),
                            "arguments": json.dumps(
                                call.get("arguments") or {}, ensure_ascii=False
                            ),
                        },
                    }
                    for i, call in enumerate(calls)
                ],
            }
            messages.append(assistant_msg)

            parked = False
            handed = False
            for call in calls:
                name = str(call.get("name") or "")
                args = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
                tool_body: Optional[Dict[str, Any]] = None
                async for event in _dispatch_tool(
                    name,
                    args,
                    state,
                    user_text,
                    installed_skills,
                    active_connectors,
                    preferred_device,
                    design_system_id,
                    original_goal,
                ):
                    yield event
                    if event.get("type") == "control_tool_result":
                        tool_body = {
                            k: v for k, v in event.items() if k != "type"
                        }
                    if event.get("type") in {
                        "control_ask_user",
                        "control_scope_card",
                        "control_handoff_factory",
                        "complete",
                    }:
                        parked = event.get("type") in {
                            "control_ask_user",
                            "control_scope_card",
                            "complete",
                        }
                        handed = event.get("type") == "control_handoff_factory"
                if parked or handed:
                    return
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or "",
                        "content": json.dumps(
                            tool_body
                            if tool_body is not None
                            else {"ok": True, "tool": name},
                            ensure_ascii=False,
                        ),
                    }
                )
        async for event in _canned(state, OVER_CAP_TEXT):
            yield event
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — 失败合同：罐头回复，禁止点火
        async for event in _canned(state, CANNED_FAILURE):
            yield event


async def _dispatch_tool(
    name: str,
    args: Dict[str, Any],
    state: V5SessionState,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    original_goal: str,
) -> AsyncIterator[Dict[str, Any]]:
    if name == "ask_user":
        question = str(args.get("question") or "你想做什么应用？")
        options = args.get("options") if isinstance(args.get("options"), list) else []
        async for event in _park_ask(state, question, [str(x) for x in options]):
            yield event
        return
    if name == "scope_card":
        restatement = str(args.get("restatement") or _restate(user_text) or _restate(original_goal))
        async for event in _park_scope(
            state,
            restatement,
            device=str(args.get("device") or preferred_device or "unspecified"),
            variant=str(args.get("variant") or ("thin" if original_goal else "full")),
            user_text=user_text,
            want_evidence=_truthy_scope_flag(args.get("wantEvidence")),
            want_feasibility_report=_truthy_scope_flag(args.get("wantFeasibilityReport")),
        ):
            yield event
        return
    if name == "rehearse":
        # 模型 rehearse 不是确认按钮。停泊 / 未确认必须再 park。
        if not _scope_confirmed(state):
            async for event in _park_scope(
                state,
                _confirmed_restatement(state, user_text) or _restate(original_goal),
                device=str(preferred_device or "unspecified"),
                variant="thin" if original_goal else "full",
                user_text=user_text,
            ):
                yield event
            return
        restatement = _confirmed_restatement(state, user_text)
        _write_confirmed_goal(state, restatement)
        _copy_scope_opt_in_into_goal(state)
        _persist(state)
        async for event in _handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            profile="app",
        ):
            yield event
        return
    if name == "refine":
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        goal["text"] = original_goal
        state.goal = goal
        _persist(state)
        async for event in _handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            profile="full",
        ):
            yield event
        return
    if name == "repair":
        async for event in _handoff_factory(
            state,
            user_text,
            installed_skills,
            active_connectors,
            preferred_device,
            design_system_id,
            repair=True,
            profile="full",
            max_loops=2,
        ):
            yield event
        return
    if name == "challenge":
        async for event in _tool_challenge(state, user_text):
            yield event
        return
    if name == "search_evidence":
        yield {"type": "control_tool_start", "tool": "search_evidence"}
        result = await _tool_search(state, str(args.get("query") or user_text))
        _persist(state)
        yield {"type": "control_tool_result", "tool": "search_evidence", **result}
        return
    if name == "inspect_model":
        yield {"type": "control_tool_start", "tool": "inspect_model"}
        result = await _tool_inspect(state)
        _persist(state)
        yield {"type": "control_tool_result", "tool": "inspect_model", **result}
        return
    if name == "restore_version":
        version_id = str(args.get("versionId") or args.get("version_id") or "").strip()
        if not version_id:
            version_id = _previous_model_version_id(state)
        yield {"type": "control_tool_start", "tool": "restore_version"}
        result = await _tool_restore(state, version_id)
        _persist(state)
        yield {"type": "control_tool_result", "tool": "restore_version", **result}
        return
    if name == "fork_variant":
        yield {"type": "control_tool_start", "tool": "fork_variant"}
        result = await _tool_fork(state, str(args.get("newName") or user_text or "变体"))
        _persist(state)
        yield {"type": "control_tool_result", "tool": "fork_variant", **result}
        # 客户端靠 complete.finalState 看见新 versionId；不 yield 等于点了没反应。
        yield _complete(state)
        return
    yield {"type": "control_text", "text": CANNED_FAILURE}
    yield _complete(state)
