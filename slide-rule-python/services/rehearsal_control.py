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
import asyncio
import inspect
import json
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from enum import Enum
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from models.v5_state import CoverageGap, UserIntervention, V5SessionState
from services.drive_full_factory import start_drive_full_factory_run
from services.slide_rule_interactive_gates import (
    apply_user_intervention_invalidation,
    resolve_readiness_gaps_by_ids,
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

class ToolScope(str, Enum):
    """工具在「能不能造一份新五系统模型」这条轴上的权限。

    抄的标准答案：grok-build `xai-tool-protocol/src/capabilities.rs`

        pub enum ToolScope { Read, Write }
        /// Tools that mutate external state must declare `Write` so the
        /// computer hub routes them to the leader agent only.
        /// Absence is treated as `Read`.

    要点是**缺省 Read**：以后加的新工具默认进不了工厂，想写得显式声明。
    本仓 KD3 说的是同一件事，但一直只是文档里的一段话——而这个仓自己
    第三条写着「函数写对了 ≠ 它被调用了」，同理：纪律写对了 ≠ 它被强制了。

    ⚠ 这里的 WRITE 精确指**生成新五系统模型**（进 `_handoff_factory`），
      不是"落不落盘"。challenge 写 staleArtifactIds、restore_version /
      fork_variant 移指针，都会 persist，但在这条轴上是 READ。
      别看见 READ 就以为它们不碰会话；也别为了"看着一致"把它们提成
      WRITE——提上去这道闸就没有意义了。
    """

    READ = "read"
    WRITE = "write"


CLOSED_TOOLS = (
    "ask_user",
    "clarify",
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

# 写权限声明表。**只列 WRITE**——缺省即 READ（grok 的 "Absence is
# treated as Read"）。这三个动词是 KD3 点名可以生成新五系统模型的：
# 它们各自都最终走 `_handoff_factory`（rehearse 经
# `_confirm_rehearse_and_handoff`）。
#
# ⚠ 往这张表里加名字之前先问：这个工具真的要**造一份新模型**吗？
#   落盘不等于写模型（见 ToolScope 头注）。加错一个，工厂就多一个入口。
TOOL_SCOPE: Dict[str, ToolScope] = {
    "rehearse": ToolScope.WRITE,
    "refine": ToolScope.WRITE,
    "repair": ToolScope.WRITE,
}


class ToolScopeViolation(RuntimeError):
    """READ 权限的工具试图进工厂信封。fail-closed：抛，不降级放行。"""


# 本回合正在分发的工具名。走 ContextVar 而不是给 `_handoff_factory` 加参数：
# 跟本文件里 `_CONTROL_PAYLOAD` / 读 charter 同一套机制（本回合信封），
# 也逼着判据打在真分发上而不是直调函数。
#
# 缺省空串 → resolve_tool_scope 给 READ → 没进过分发就直调工厂会被拦。
_ACTIVE_TOOL: ContextVar[str] = ContextVar("sliderule_active_tool", default="")


def resolve_tool_scope(name: Any) -> ToolScope:
    """查权限。没声明的一律 READ（含拼错的、以后新加的）。"""
    return TOOL_SCOPE.get(str(name or "").strip(), ToolScope.READ)


@contextmanager
def tool_scope_scope(name: str):
    """标记本回合正在分发哪个工具。两条分发路径都要用（成对，少一条 = 半个闸）。"""
    token = _ACTIVE_TOOL.set(str(name or ""))
    try:
        yield
    finally:
        _ACTIVE_TOOL.reset(token)


def assert_may_write_model() -> None:
    """工厂信封入口闸。READ 工具到这里就是**违约**，抛出来，别静静放行。

    对照 grok：写工具由 computer hub 路由给 leader agent，缺省 Read 的
    根本到不了那条路。这里没有多 agent 路由，等价物就是这道断言。
    """
    name = _ACTIVE_TOOL.get()
    if resolve_tool_scope(name) is not ToolScope.WRITE:
        raise ToolScopeViolation(
            f"工具 {name or '(未声明)'} 是 READ 权限，不能进工厂信封生成新五系统模型。"
            "要写请在 TOOL_SCOPE 里显式声明 WRITE——缺省只读是故意的。"
        )


def _has_model(state: V5SessionState) -> bool:
    """这个会话里已经有一份可精修 / 可分叉 / 可回退的模型吗。"""
    return bool(getattr(state, "modelVersions", None) or [])


def _has_inspectable(state: V5SessionState) -> bool:
    """有没有东西可给 inspect_model 看。

    ⚠ 口径**照抄 `_inspect_digest` 自己读的两个来源**（publishClosure 优先、
      再退到 modelVersions），不写成 `_has_model`。写成 _has_model 会在
      「有闭环产物、还没落版本」的会话上把 inspect_model 裁掉——那正是
      CLAUDE.md §4 说的「同一件事两处实现，口径一歪就半边不生效」。
    """
    if getattr(state, "publishClosure", None):
        return True
    return _has_model(state)


# 按轮的清单谓词。**只列需要裁的**——没声明的一律列出
# （grok 的 `should_list` 默认 true）。
#
# 抄的标准答案：grok-build `xai-tool-runtime/src/tool.rs`
#     /// Per-turn listing predicate. Return `false` to exclude this tool
#     /// from the model-facing manifest for a given turn.
#     fn should_list(&self, _ctx: &ListToolsContext) -> bool { true }
#
# 比「闭集 + 分发时拒绝」强一档：模型**看不见**的工具不用写规则拒绝。
# 下面每条都对应分发器里一段现成的防御性重定向——那正是"本来就不该被
# 列出"的证据：不裁的话每次都要先让模型挑一次、再被服务端纠正一次。
TOOL_LIST_WHEN: Dict[str, Any] = {
    # 未确认范围时 rehearse 会被 re-park（见 _dispatch_tool 的 rehearse 分支）。
    # 「开始推演」按钮走 forcedTool 绕过 LLM（KD21），裁掉不影响用户点火。
    "rehearse": lambda st: _scope_confirmed(st),
    # 问过一轮再问就改开范围卡（见 clarify 分支）。
    "clarify": lambda st: _clarify_rounds_done(st) < 1,
    # 没有上一版可回（_previous_model_version_id fail-closed 返回 ""）。
    "restore_version": lambda st: bool(_previous_model_version_id(st)),
    # ⚠ refine / fork_variant 在空会话上无事可做，而 refine 的分发分支
    #   **没有** rehearse 那样的 _scope_confirmed 兜底：实测夹具让模型在
    #   空 goal 会话上挑 refine，工厂信封被调 1 次、零范围卡就点了火
    #   （违反验收 A / KD4）。裁清单 + 分发兜底两处一起补。
    "refine": lambda st: _has_model(st),
    "fork_variant": lambda st: _has_model(st),
    # ⚠ 2026-08-27 压测逮到的第三个同形态：同一句「中小学课后托管」跑三遍，
    #   两遍模型挑 scope_card（41s 出范围卡），一遍在**零模型**的会话上挑了
    #   inspect_model —— `_inspect_digest` 老实回「当前还没有五系统模型可
    #   查看」，模型接着甩了句套话就收尾，范围卡再没出现，136s 打空
    #   （真机 sr-20260827073836-C3VJV41PV5，controlTranscript 里明写着
    #    turn → clarify → turn → inspect_model → canned）。
    #   refine / fork_variant 当时补了 _has_model，inspect_model 漏了一个。
    "inspect_model": lambda st: _has_inspectable(st),
}


# 「这个工具要不要用户显式批准才能执行」。**只列要批准的**——缺省不需要
# （grok 的 `ToolDef.requires_permission` 默认 false）。
#
# 抄的标准答案：grok-build `xai-grok-workspace-types/src/types/tools.rs`
#     pub struct ToolDef { ...
#         /// Whether invocations require explicit user permission.
#         pub requires_permission: bool, }
#     pub enum ToolProgress {
#         /// Tool started (after permission was granted, before execution).
#         Started { call_id: ToolCallId }, ... }
#
# 值放的是「已获批准吗」的谓词：本仓的批准动作就是范围卡上那次
# 「开始推演」，落在 transcript 的 scope_confirmed 上。
#
# ⚠ 原来这两条检查散在各自的 if 分支里。散着写的代价刚付过：refine 那段
#   是 2026-08-27 才补的，补之前空会话上模型挑 refine 零范围卡就点火
#   （实测信封调用 1 次）。**新加一个贵动词很容易忘写那一段，而忘了不会
#   报错，只会绕过范围卡。** 所以收到一处声明 + 一道统一闸。
#
# ⚠ 声明**不进 provider 线上 payload**：CONTROL_TOOLS 是 OpenAI 风格的
#   function 定义，塞非标准键有被拒的风险。grok 的 ToolDef 是他们自己的
#   内部类型，对应物就是这张表。
TOOL_PERMISSION: Dict[str, Any] = {
    # 范围卡上的「开始推演」就是这道批准。停泊 ≠ 已批准（见 _scope_confirmed）。
    "rehearse": lambda st: _scope_confirmed(st),
    # 空会话没模型可精修 → 先开卡。有模型时是否也出薄卡是产品决定
    # （M2 Q2），本次不扩大范围。
    "refine": lambda st: _has_model(st),
}


def tool_requires_permission(name: Any) -> bool:
    """这个工具要不要显式批准。没声明的一律不需要。"""
    return str(name or "").strip() in TOOL_PERMISSION


def tool_permission_granted(name: Any, state: V5SessionState) -> bool:
    """已获批准吗。不需要批准的恒为真。"""
    pred = TOOL_PERMISSION.get(str(name or "").strip())
    if pred is None:
        return True
    return bool(pred(state))


def should_list_tool(name: Any, state: V5SessionState) -> bool:
    """这一轮要不要把这个工具摆给模型看。没声明谓词的一律列出。"""
    pred = TOOL_LIST_WHEN.get(str(name or "").strip())
    if pred is None:
        return True
    try:
        return bool(pred(state))
    except Exception:
        # 谓词自己炸了不许把工具吞掉：清单是增强，不是闸（闸在 ToolScope）。
        return True


def list_control_tools(state: V5SessionState) -> List[Dict[str, Any]]:
    """本回合摆给模型的工具清单。原样透传定义，只做裁剪。

    ⚠ 永不为空：全裁光了模型无事可做，比多列一个更糟。兜底留下
      ask_user / scope_card——"问一句"和"开范围卡"在任何状态都做得成。
    """
    listed = [
        t
        for t in CONTROL_TOOLS
        if should_list_tool(((t.get("function") or {}).get("name")), state)
    ]
    if listed:
        return listed
    floor = {"ask_user", "scope_card"}
    return [
        t for t in CONTROL_TOOLS if ((t.get("function") or {}).get("name")) in floor
    ]


async def _invoke_control_llm(
    messages: List[Dict[str, Any]], *, tools: List[Dict[str, Any]]
) -> Any:
    """问一次控制面模型。**真协程直接 await，同步实现才下线程池。**

    为什么要分这一下（两条判据各钉住一半，缺一条就静默失效）：

    · 生产实现 `call_control_llm` 是 async + httpx.AsyncClient。必须**直接
      await 在事件循环上**——只有这样客户端断开时 asyncio 的取消才传导得到
      socket，请求才是真停了而不是"账面停了、线程还在烧"。塞进
      run_in_threadpool 会把这条链斩断（那正是 2026-08-27 实测到的
      「客户端走后 LLM 又跑 3.1 秒」）。
      钉这一半的是 tests/test_control_llm_cancel_really_aborts.py。

    · 测试替身（42 个文件共用的 ControlHarness）传的是**同步**函数，其中
      test_control_stream_does_not_block_the_loop 的夹具还故意用 time.sleep
      阻塞——那条判据要的就是"阻塞实现不许冻住别人的流"。同步实现直接
      await 会真把事件循环焊死，那条测试立刻红。所以同步的照旧下线程池。
      钉这一半的是那条并发测试本身。

    ⚠ 分派看的是**函数**不是返回值：同步阻塞实现一旦被调用就已经把循环占住了，
      拿到返回值再判断已经晚了。
    """
    fn = call_control_llm
    if inspect.iscoroutinefunction(fn):
        return await fn(messages, tools=tools)
    return await run_in_threadpool(lambda: fn(messages, tools=tools))


# 客户端认得的**终局事件**。少了它们，`consumeControlStreamResponse` 的
# `acc.finalState` 一直是 null → `postControlTurnStream` 返回 null →
# `runTurn` 抛「控制面未返回结果」，然后 catch 里把**这一轮开始前的快照**
# PUT 回去。
#
# ⚠ 2026-08-27 评审逮到 `restore_version` 就是这样：服务端明明回退成功并
#   `_persist` 了，客户端一个错误路径把它盖回去——比"点了没反应"更糟。
#   紧挨着的 `fork_variant` 有 `yield _complete(state)`，注释还写着
#   「不 yield 等于点了没反应」，只有它漏了。
#   所以不再指望每个分支各自记得：**在 forced 这条总出口上兜一次**。
_TERMINAL_EVENTS = ("complete", "control_handoff_factory")

MAX_TOOL_ROUNDS = 8
MAX_CHEAP_TOKENS = 8000
MAX_WALL_SECONDS = 45.0
INSPECT_MAX_ITEMS = 40
INSPECT_MAX_CHARS = 4000

CONTROL_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "clarify",
            "description": (
                "开工前把这句需求里**没说清的**问出来，最多 3 条。"
                "只问缺的：用户已经说清的不许再问一遍。"
                "已经够清楚就别调这个工具，直接 scope_card——问废话比不问更烦人。"
                "选项要用**这门生意自己的词**（诊所就写 医生/护士/前台/患者，"
                "不要写 个人C端/企业内部 这种通用词）。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "maxItems": 3,
                        "items": {
                            "type": "object",
                            "properties": {
                                "prompt": {
                                    "type": "string",
                                    "description": "问题本身，一句话，用用户的词",
                                },
                                "type": {
                                    "type": "string",
                                    "enum": [
                                        "single_choice",
                                        "multi_choice",
                                        "free_text",
                                    ],
                                },
                                "options": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "选项（single/multi 必填，3-5 个，本行业的词）",
                                },
                                "defaultAnswer": {"type": "string"},
                                "context": {
                                    "type": "string",
                                    "description": "为什么要问这条：它会影响推演里的什么",
                                },
                                "kind": {
                                    "type": "string",
                                    "description": "维度：users / platform / scenario / scope / rules",
                                },
                            },
                            "required": ["prompt", "type"],
                        },
                    }
                },
                "required": ["questions"],
            },
        },
    },
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


async def _apersist(state: V5SessionState) -> V5SessionState:
    """落盘挪出事件循环。

    ⚠ 2026-08-27 评审：`save_session` 是**同步**的，而这台机器上的会话后端
      是「自定义 HTTPS SQL 网关」——一次落盘就是一次同步 HTTP。直接在
      async 生成器里调，整个事件循环停在那里：单人开发看不出来，**两个人
      同时推演就互相卡**（对方的 SSE 一个字都不出）。

    ⚠ 走 starlette 的 `run_in_threadpool`（FastAPI 跑同步 endpoint 用的就是
      它），不是自己 new 线程池：它跟着请求上下文走、有并发上限、
      contextvars 会被带进工作线程（`_CONTROL_PAYLOAD` 靠这个）。

    ⚠ 包一层而不是把 `_persist` 直接改成 async：漏改一处的话，
      `_persist(...)` 会变成"造了个协程没人 await"——**不报错、也不落盘**，
      是最难查的那种。现在漏改一处只是那处仍然阻塞，行为不变。
    """
    return await run_in_threadpool(_persist, state)


async def _settled(
    state: V5SessionState, events: AsyncIterator[Dict[str, Any]]
) -> AsyncIterator[Dict[str, Any]]:
    """昂贵按钮这条出口**一定**以终局事件收尾。

    见 `_TERMINAL_EVENTS` 的注释：漏一个 `complete`，客户端不是"没反应"，
    而是报「推演中断」并把这一轮开始前的快照 PUT 回去，把服务端已经做成的
    事（比如版本回退）原地抹掉。

    ⚠ 兜底只在**没出过**终局事件时补一个，不是无脑追加：多发一个 complete
      会让客户端把中途状态当最终状态（handoff 之后工厂还要继续发）。
    """
    settled = False
    async for event in events:
        if str(event.get("type") or "") in _TERMINAL_EVENTS:
            settled = True
        yield event
    if not settled:
        yield _complete(state)


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
    await _apersist(state)
    yield {
        "type": "control_ask_user",
        "question": question,
        "options": list(options or []),
    }
    yield _complete(state)


# 这句需求里通常会漏掉的四个维度。**只当提示，不当闸。**
#
# ⚠ 旧的 TS 那套（shared/blueprint/sliderule-readiness-chain.ts 的
#   SPEC_DIMENSIONS + isUnderSpecifiedGoal）把它做成了硬判定：命中 <2 才问、
#   目标 ≥80 字直接算"已充分规约、一个问题都不问"。结果是一句 100 字的
#   废话不问，一句 30 字的好需求反倒被问四条模板题。
#   参考成熟做法（dzhng/deep-research 的 generateFeedback）：**问几条交给模型**
#   ——"最多 N 条，本来就清楚就少问或不问"，规则只负责告诉它"这句话里我没读到
#   用户/平台/场景/边界"，问不问、问什么由模型看着办。
_SPEC_DIMENSIONS: List[tuple] = [
    ("users", "谁用（角色）", r"用户|面向|客户|员工|老师|学生|医生|护士|患者|商家|管理员|团队|to ?[cb]"),
    ("platform", "在哪用（平台）", r"平台|web|网页|ios|android|安卓|小程序|桌面|客户端|pc|手机|大屏"),
    ("scenario", "核心流程与验收", r"流程|场景|用于|目标是|核心|kpi|指标|验收|成功标准|解决|审批|下单|结算"),
    ("scope", "本期边界", r"范围|不做|边界|mvp|仅|只做|首期|第一期|优先|暂不"),
]


def _missing_dimensions(goal_text: str) -> List[str]:
    """这句需求里**没读到**的维度（人话标签）。只用于提示模型。"""
    import re as _re

    text = (goal_text or "").strip()
    out: List[str] = []
    for _key, label, pattern in _SPEC_DIMENSIONS:
        if not _re.search(pattern, text, _re.IGNORECASE):
            out.append(label)
    return out


def _clarify_rounds_done(state: V5SessionState) -> int:
    """已经问过几轮澄清。用来防止模型没完没了地问。"""
    return sum(
        1
        for row in getattr(state, "controlTranscript", None) or []
        if isinstance(row, dict) and row.get("kind") == "clarify"
    )


async def _park_clarify(
    state: V5SessionState, raw_questions: Any
) -> AsyncIterator[Dict[str, Any]]:
    """把澄清问题落成 coverageGaps，让现成的澄清卡去渲染。

    ⚠ **不是新做一张卡。** `ClarificationCard.tsx` 早就做好了：多步分页、
      单选/多选/自由文本、默认值、context、「其他」。前端
      `pendingClarifications` 也早就在读 coverageGaps 里的 open_question。
      缺的从来只是——**产品路径上没有任何东西往里写问题**
      （profile=app 的短清单里没有 gap.ask，TS 那套模拟问题在旧本地引擎上）。
      所以这里只补"写"，一行渲染代码都不加。

    ⚠ 空问题列表 = 模型判断"已经够清楚"。那就**不要 park**，让它接着去开
      范围卡；硬 park 一张空卡片就是为了问而问。
    """
    questions: List[Dict[str, Any]] = []
    for i, raw in enumerate(raw_questions if isinstance(raw_questions, list) else []):
        if not isinstance(raw, dict):
            continue
        prompt = str(raw.get("prompt") or "").strip()
        if not prompt:
            continue
        options = [
            str(o).strip()
            for o in (raw.get("options") or [])
            if str(o or "").strip()
        ]
        qtype = str(raw.get("type") or "").strip()
        if qtype not in ("single_choice", "multi_choice", "free_text"):
            qtype = "single_choice" if options else "free_text"
        # ⚠ 说是选择题却没给选项 → 退成填空，别端出一张点不动的卡
        if qtype in ("single_choice", "multi_choice") and not options:
            qtype = "free_text"
        questions.append(
            {
                "prompt": prompt[:240],
                "type": qtype,
                "options": options or None,
                "defaultAnswer": (str(raw.get("defaultAnswer") or "").strip() or None),
                "context": (str(raw.get("context") or "").strip() or None),
                "kind": (str(raw.get("kind") or "").strip() or None),
            }
        )
        if len(questions) >= 3:
            break

    if not questions:
        return

    now = _now_iso()
    turn = str(getattr(state, "lastTurnId", None) or "ctl")
    gaps = list(getattr(state, "coverageGaps", None) or [])
    made: List[Dict[str, Any]] = []
    for i, q in enumerate(questions):
        gid = f"gap-q-{turn}-{uuid.uuid4().hex[:6]}-{i}"
        made.append(
            {
                "id": gid,
                "kind": "open_question",
                "label": q["prompt"],
                "status": "open",
                "createdAt": now,
                "reason": "control_plane_clarify",
                "clarifyType": q["type"],
                "options": q["options"],
                "defaultAnswer": q["defaultAnswer"],
                "context": q["context"],
                "clarifyKind": q["kind"],
                "questionId": gid,
            }
        )
    # ⚠ 往 `List[CoverageGap]` 里塞裸 dict 能跑，但 pydantic 会在序列化时
    #   报 PydanticSerializationUnexpectedValue——模型头注里那段"代码是靠
    #   状态没被校验才正常工作的"说的就是这个。这里直接建模型对象：
    #   哪天校验真的生效，缺口不会无声无息地少几个字段。
    state.coverageGaps = gaps + [CoverageGap(**row) for row in made]
    state.runtimePhase = "awaiting"
    state.awaitReason = "control_clarify"
    state.awaitDetail = questions[0]["prompt"]
    _append_transcript(
        state,
        {
            "role": "assistant",
            "kind": "clarify",
            "text": "；".join(q["prompt"] for q in questions),
            "questionIds": [g["id"] for g in made],
        },
    )
    await _apersist(state)
    yield {
        "type": "control_clarify",
        "questions": [
            {
                "id": g["id"],
                "prompt": g["label"],
                "type": g["clarifyType"],
                "options": g["options"],
                "defaultAnswer": g["defaultAnswer"],
                "context": g["context"],
            }
            for g in made
        ],
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
    await _apersist(state)
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
    await _apersist(state)
    yield _complete(state)


def _retire_stale_control_questions(state: V5SessionState) -> None:
    """确认新范围时，把上一轮范围下的控制面提问置为 superseded。

    ⚠ 2026-08-27 真机：会话 goal 已经是「连锁宠物医院管理系统」，作曲家还在
      弹上一轮的「这个**诊所系统**首期主要服务哪几类核心角色？」。三条
      `gap-q-…` 全是 status=open / reason=control_plane_clarify，而 gap 上
      既没有 turnId 也没有 goal 引用——客户端判定不了归属，只能在这里收口。

    状态用 `waived`（既有闭集 Literal 的"免除/作废"档），不新造
    `superseded`：CoverageGap.status 是 open/resolved/waived 的闭集，
    Python 与 TS 两边都声明了——新造值要双边同步改，那是 KD22 已经付过
    学费的形状。作废是安全的：控制面从不往 contract.blockingGapIds 里加
    自己的提问，所以 waive 它们碰不到覆盖闸（见同名测试的反向判据）。

    只碰 `kind == "open_question"` 且 `reason == "control_plane_clarify"` 的：
    · 证据缺口 / 能力缺口是**门说了算**的，fail-closed，顺手关掉就是伪造
      绿灯（Claude.md §7）；
    · 工厂内 G_READY 出的澄清（reason 不是 control_plane_clarify）也不归
      控制面管。

    作废而不是删除：证据链要留痕，删了就没法解释这张卡去哪了。
    """
    gaps = list(getattr(state, "coverageGaps", None) or [])
    if not gaps:
        return
    now = _now_iso()
    changed = False
    out: List[Any] = []
    for g in gaps:
        row = g if isinstance(g, dict) else g.model_dump()
        if (
            row.get("kind") == "open_question"
            and row.get("reason") == "control_plane_clarify"
            and row.get("status") == "open"
        ):
            row = {**row, "status": "waived", "updatedAt": now}
            changed = True
            out.append(CoverageGap(**row))
        else:
            out.append(g)
    if changed:
        state.coverageGaps = out


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
    # 新范围一确认，上一轮范围下的控制面提问就作废：否则作曲家会继续弹
    # 问上一个 goal 的澄清卡（2026-08-27 真机：goal 已是宠物医院，卡还在
    # 问诊所系统）。只碰控制面自己出的提问，证据/能力缺口不许动。
    _retire_stale_control_questions(state)
    _append_transcript(
        state,
        {"role": "system", "kind": "scope_confirmed", "text": restatement},
    )
    state.awaitReason = None
    state.awaitDetail = None
    await _apersist(state)
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
    # 写权限闸（抄 grok 的 ToolScope）：只有声明了 WRITE 的工具能造新模型。
    # 缺省 READ ⇒ 新工具、拼错的名字、绕过分发直调，统统在这里被拦。
    assert_may_write_model()

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


def _challenge_target(state: V5SessionState) -> Optional[str]:
    """这次质疑指向哪件产物。

    ⚠ **必须来自本回合的 POST。** 2026-08-27 评审逮到的断链：
      `_tool_challenge` 只拿 intent + text 造 UserIntervention，
      `invalidate_for_intervention` 三个 target 全空 → `initial_art_targets`
      空 → 级联整段跳过 → `staleArtifactIds` 一个都不加，而流里照样说
      「已按质疑失效相关产物」。三段（客户端解析 → POST → 服务端失效）各自
      都写了，接起来是空的——本仓第七条最坏的形态：**绿灯是假的**。

    ⚠ 客户端给的 id **要跟 artifacts 对一遍**。对不上就当没指到：
      往 staleArtifactIds 里塞一个不存在的 id 不会报错，只会让那份名单
      越长越脏，而且看着像"失效过了"。

    走 ContextVar 而不是加参数，跟 `_handoff_factory` 读 charter 是同一个
    机制（本回合信封），也逼着判据打在真 HTTP 上而不是直调函数。
    """
    payload = _CONTROL_PAYLOAD.get() or {}
    raw = str(
        payload.get("targetArtifactId") or payload.get("target_artifact_id") or ""
    ).strip()
    if not raw:
        return None
    for art in getattr(state, "artifacts", None) or []:
        aid = art.get("id") if isinstance(art, dict) else getattr(art, "id", None)
        if aid and str(aid) == raw:
            return raw
    return None


async def _tool_challenge(state: V5SessionState, user_text: str) -> AsyncIterator[Dict[str, Any]]:
    yield {"type": "control_tool_start", "tool": "challenge"}
    target = _challenge_target(state)
    before = set(getattr(state, "staleArtifactIds", None) or [])
    intervention = UserIntervention(
        intent="challenge",
        text=(user_text or "质疑").strip() or "质疑",
        targetArtifactId=target,
    )
    apply_user_intervention_invalidation(state, intervention)
    after = set(getattr(state, "staleArtifactIds", None) or [])
    newly = sorted(after - before)
    _append_transcript(
        state,
        {
            "role": "assistant",
            "kind": "challenge",
            "text": user_text,
            "targetArtifactId": target,
            "staleArtifactIds": newly,
        },
    )
    await _apersist(state)
    yield {
        "type": "control_tool_result",
        "tool": "challenge",
        "ok": True,
        # ⚠ detail 说的是**这次真的发生了什么**，不是"这个分支跑过了"。
        "detail": "invalidated" if newly else "no_target",
        "targetArtifactId": target,
        "staleArtifactIds": newly,
    }
    yield {
        "type": "control_text",
        # ⚠ 一件都没失效时**不许说已失效**（第七条）。说了就是假绿灯：
        #   用户以为那份产物已经作废，下一轮照样拿它当依据。
        "text": (
            f"已按质疑失效 {len(newly)} 件产物。需要的话再说一次要改什么。"
            if newly
            else "记下了这条质疑，但没有指到具体产物——没有任何产物被失效。"
            "点某张卡片上的「质疑」，或者说清是哪一份。"
        ),
    }
    yield _complete(state)


#: 证据检索的整体死线。供应商链是 12s × 最多 3 家
#: （services/mcp_tools._TIMEOUT_S），向量库那条真机上还可能更久——不封顶
#: 的话一次控制面轮次能被它拖住半分钟，而用户那头只看见一个转圈。
_SEARCH_DEADLINE_S = 20.0


async def _tool_search(state: V5SessionState, query: str) -> Dict[str, Any]:
    """查外部证据。**「查过了没有」和「没查成」必须分得开。**

    ⚠ 2026-08-27 修的就是这条：老版本任何失败都走
      `except Exception: hits = []`，然后照样返回 `ok=True` +
      「没有检索到可用片段。」+ 一条 provenance=control-search 的空证据行。
      Tavily 挂了、网断了、超时了——对模型和用户来说**跟"网上确实没有"
      长得一模一样**。这就是 CLAUDE.md §7 说的伪造绿灯：流程可以 fail-open
      （不该因为搜不到就打死整轮），但**结论不许 fail-open**。

    抄的标准答案：grok-build `xai-grok-session-search/src/bootstrap.rs`

        Err(_) => {
            // The abandoned spawn_blocking task runs to completion.
            log_bootstrap_timeout(&session_id, per_session_timeout.as_secs());
            progress.skipped.fetch_add(1, Ordering::Relaxed);
            return;
        }

    三件事一件不少：**限时**（per_session_timeout）、**放弃**、**记成
    skipped 而不是 indexed**。整轮继续跑，但那一份被如实记成"没做成"。

    ⚠ 这里**不**学上面 call_control_llm 改 async：`retrieve_evidence` 有 28 个
      同步调用方（整条工厂流水线），改 async 得把整条链一起改。而 grok 自己
      对这种天生阻塞的活也不是"想办法中断"，就是上面那段——**被放弃的线程
      会跑到底**（实测：wait_for 1.00s 返回，孤儿线程跑满 5.00s），这是
      已知且接受的代价，不假装它停了。
    """
    hits: List[Dict[str, Any]] = []
    outcome = "searched"
    try:
        from services.rag_service import retrieve_evidence

        # 同上：RAG 检索是同步的（可能带网络/向量库），一样不许坐在事件循环上
        raw = await asyncio.wait_for(
            run_in_threadpool(lambda: retrieve_evidence(query or "", top_k=6) or []),
            timeout=_SEARCH_DEADLINE_S,
        )
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
    except asyncio.TimeoutError:
        # 超过死线：孤儿线程还在跑（见头注），但这一轮不再等它。
        hits, outcome = [], "abandoned"
    except Exception:  # noqa: BLE001 — 流程 fail-open，结论 fail-closed（见头注）
        hits, outcome = [], "failed"

    if outcome == "abandoned":
        summary = (
            f"证据检索超过 {int(_SEARCH_DEADLINE_S)} 秒未返回，已放弃。"
            "这一轮**没有**外部证据——不是「查过了、没有」，是没查成。"
        )
    elif outcome == "failed":
        summary = (
            "证据检索失败（外部检索不可用）。"
            "这一轮**没有**外部证据——不是「查过了、没有」，是没查成。"
        )
    else:
        summary = (
            "；".join(
                str(h.get("title") or h.get("content") or "")[:80] for h in hits if h
            )
            or "查过了，没有检索到可用片段。"
        )
    _append_transcript(
        state,
        {
            "role": "tool",
            "kind": "search_evidence",
            "text": query,
            "provenance": "control-search",
            # ⚠ outcome 必须进存档：会话读回来时，空 hits 到底是"查过没有"
            #   还是"没查成"，只有这个字段分得开。
            "outcome": outcome,
            "hits": hits,
        },
    )
    # 故意不碰 conversation / publishClosure / commit_artifact
    return {
        "ok": outcome == "searched",
        "outcome": outcome,
        "summary": summary,
        "hits": hits,
        "provenance": "control-search",
    }


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

        # 回退要重建闭环证据（可能走 LLM），是这条链上最重的一次同步调用
        result = await run_in_threadpool(
            _restore_model_version_locked, state.sessionId, vid
        )
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
    missing = _missing_dimensions(_goal_text(state) or "")
    asked = _clarify_rounds_done(state)
    # ⚠ 规则只报告"这句话里我没读到什么"，**问不问、问几条由模型定**。
    #   参考 dzhng/deep-research 的 generateFeedback：最多 N 条、本来清楚就少问。
    #   做成硬闸的那一版（TS isUnderSpecifiedGoal：≥80 字就算说清）会一边放过
    #   一百字的废话，一边对着一句好需求问四条模板题。
    clarify_hint = (
        (
            f"这句需求里还没读到：{'、'.join(missing)}。"
            "开范围卡之前先用 clarify 把其中真正影响推演的问出来（最多 3 条，"
            "已经清楚的别问）。"
        )
        if missing and asked == 0
        else ("已经问过一轮澄清，不要再问，直接 scope_card。" if asked else "")
    )
    base = (
        "你是面团的薄控制面。只能调用给定工具，不能发明工具。"
        "禁止开放闲聊。问候用 ask_user 或一句短回复；"
        "要做应用先 clarify（需求含糊时）再 scope_card；未确认不得 rehearse。"
        "search_evidence 不计入闭环。inspect_model 只看摘要。"
        f"当前目标：{goal[:200]}。停泊：{parked}。{clarify_hint}"
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
    await _apersist(state)
    yield {"type": "control_text", "text": text}
    yield _complete(state)


async def run_control_turn(
    payload: Dict[str, Any],
) -> AsyncIterator[Dict[str, Any]]:
    """产品控制面主循环。cheap 请求内结束；点火才调信封 helper。"""
    validate_control_turn_body(payload)
    session_id = str(payload["sessionId"]).strip()
    state = await run_in_threadpool(load_session, session_id)
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


def _open_question_gaps(state: V5SessionState) -> List[str]:
    out: List[str] = []
    for gap in getattr(state, "coverageGaps", None) or []:
        get = gap.get if isinstance(gap, dict) else lambda k, _g=gap: getattr(_g, k, None)
        if get("status") == "open" and get("kind") == "open_question":
            gid = get("id")
            if gid:
                out.append(str(gid))
    return out


async def _resolve_answered_gaps(
    state: V5SessionState, payload: Dict[str, Any]
) -> List[str]:
    """澄清卡答完，按 id 精确关掉这几个缺口。返回真的被关掉的那些。

    ⚠ **`resolve_readiness_gaps_by_ids` 一直就在**（slide_rule_interactive_gates
      :182），逐条写对、还有单测——**只是产品链路上没有任何调用点**。
      本仓第三条的原话：函数写对了 ≠ 它被调用了。控制面改造把 TS 那侧的
      `intakeMessage`（唯一的 resolveReadinessGapsByIds 调用点）删了，
      客户端仍在拼 answeredGapIds，于是答完卡片一个缺口都不关，闸还是红的，
      而用户以为自己已经答过了。

    ⚠ 只关**这次点名的**：整批关掉等于把没答的问题也当答了，覆盖门就成了
      摆设（第七条：闭环类 fail-closed，不许伪造绿灯）。
    """
    answers: Dict[str, str] = {}
    # 结构化形态：[{gapId, answer}]。**答案要留下来**——只把缺口置 resolved
    # 而不记答案，等于闸绿了、生成侧什么也没多知道，澄清白问（见
    # v5_llm_generate.clarification_prompt_block）。
    for row in payload.get("answeredGaps") or payload.get("answered_gaps") or []:
        if not isinstance(row, dict):
            continue
        gid = str(row.get("gapId") or row.get("id") or "").strip()
        if gid:
            answers[gid] = str(row.get("answer") or "").strip()
    # 只有 id 的老形态照旧收（早前的调用方还在发它）
    for x in payload.get("answeredGapIds") or payload.get("answered_gap_ids") or []:
        gid = str(x or "").strip()
        if gid:
            answers.setdefault(gid, "")
    ids = [gid for gid in answers if gid]
    if not ids:
        return []
    before = set(_open_question_gaps(state))
    # 先把答案写在缺口上，再 resolve —— 反过来写的话 resolve 那步会
    # model_copy 出新对象，答案落在被丢掉的旧对象上。
    for gap in getattr(state, "coverageGaps", None) or []:
        gid = gap.get("id") if isinstance(gap, dict) else getattr(gap, "id", None)
        if not gid or gid not in answers or not answers[gid]:
            continue
        if isinstance(gap, dict):
            gap["answer"] = answers[gid]
        else:
            try:
                gap.answer = answers[gid]
            except (ValueError, AttributeError):
                pass
    resolve_readiness_gaps_by_ids(state, ids)
    closed = sorted(before - set(_open_question_gaps(state)))
    if closed:
        await _apersist(state)
    return closed


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
    await _resolve_answered_gaps(state, payload)

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
        # ⚠ 这里不是"又查一遍" TOOL_PERMISSION，**这一支就是那次授予**：
        #   停泊态 + forcedTool=rehearse = 用户点了范围卡上的「开始推演」。
        #   对照 grok：`NeedPermission{req_id}` 是请求，用户回的
        #   `Permission{req_id, decision}` 是授予——这个按钮就是那个 decision。
        #   `_scope_confirmed` 对停泊态返回 False（停泊 ≠ 已确认），所以
        #   少了下面这个 or 子句，按钮永远点不着。别把它"统一"掉。
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
        # 写权限：forcedTool 绕过 _dispatch_tool 直接进工厂，scope 要在这里设。
        with tool_scope_scope("rehearse"):
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
        await _apersist(state)
        # 写权限：forcedTool 绕过 _dispatch_tool 直接进工厂，scope 要在这里设。
        with tool_scope_scope("refine"):
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
        # 写权限：forcedTool 绕过 _dispatch_tool 直接进工厂，scope 要在这里设。
        with tool_scope_scope("repair"):
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
        async for event in _settled(state, _tool_challenge(state, user_text)):
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
        async for event in _settled(
            state,
            _dispatch_tool(
                forced,
                tool_args,
                state,
                user_text,
                installed_skills,
                active_connectors,
                preferred_device,
                design_system_id,
                original_goal,
            ),
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
            result = await _invoke_control_llm(messages, tools=list_control_tools(state))
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
                await _apersist(state)
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
                # 写权限：本回合分发的是 name 这个工具。缺省 READ，
                # 只有 TOOL_SCOPE 里声明 WRITE 的才进得了工厂信封。
                with tool_scope_scope(name):
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
    # 批准闸（抄 grok 的 ToolDef.requires_permission）。声明在 TOOL_PERMISSION
    # 一处，强制在这一处——不再让每个贵动词各写一段（漏写不报错，只会绕过
    # 范围卡：refine 就这么漏过一次）。
    #
    # grok 把 `Started` 的语义钉成「批准之后、执行之前」，所以这道闸必须在
    # 任何 control_tool_start / handoff 之前。
    if not tool_permission_granted(name, state):
        async for event in _park_scope(
            state,
            _confirmed_restatement(state, user_text) or _restate(original_goal),
            device=str(preferred_device or "unspecified"),
            variant="thin" if original_goal else "full",
            user_text=user_text,
        ):
            yield event
        return
    if name == "ask_user":
        question = str(args.get("question") or "你想做什么应用？")
        options = args.get("options") if isinstance(args.get("options"), list) else []
        async for event in _park_ask(state, question, [str(x) for x in options]):
            yield event
        return
    if name == "clarify":
        # ⚠ 已经问过一轮就不许再问：模型很容易越问越细，把用户困在问答里。
        #   问过了还想问 → 直接去开范围卡（不清楚的部分让用户在卡上改）。
        if _clarify_rounds_done(state) >= 1:
            async for event in _park_scope(
                state,
                _restate(user_text) or _restate(original_goal),
                device=str(preferred_device or "unspecified"),
                variant="thin" if original_goal else "full",
                user_text=user_text,
            ):
                yield event
            return
        yielded = False
        async for event in _park_clarify(state, args.get("questions")):
            yielded = True
            yield event
        if yielded:
            return
        # 模型自己判断"已经够清楚"（给了空列表）→ 不 park，接着开范围卡
        async for event in _park_scope(
            state,
            _restate(user_text) or _restate(original_goal),
            device=str(preferred_device or "unspecified"),
            variant="thin" if original_goal else "full",
            user_text=user_text,
        ):
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
        # 「模型 rehearse 不是确认按钮」这道闸已收进函数开头的统一批准闸
        # （TOOL_PERMISSION["rehearse"] = _scope_confirmed）。
        restatement = _confirmed_restatement(state, user_text)
        _write_confirmed_goal(state, restatement)
        _copy_scope_opt_in_into_goal(state)
        await _apersist(state)
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
        # 空会话没东西可精修这道闸已收进统一批准闸
        # （TOOL_PERMISSION["refine"] = _has_model）。实测过的洞：补之前
        # 模型在空 goal 会话上挑 refine，信封被调 1 次、零范围卡就点了火。
        goal = dict(state.goal) if isinstance(state.goal, dict) else {}
        goal["text"] = original_goal
        state.goal = goal
        await _apersist(state)
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
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "search_evidence", **result}
        return
    if name == "inspect_model":
        yield {"type": "control_tool_start", "tool": "inspect_model"}
        result = await _tool_inspect(state)
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "inspect_model", **result}
        return
    if name == "restore_version":
        version_id = str(args.get("versionId") or args.get("version_id") or "").strip()
        if not version_id:
            version_id = _previous_model_version_id(state)
        yield {"type": "control_tool_start", "tool": "restore_version"}
        result = await _tool_restore(state, version_id)
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "restore_version", **result}
        return
    if name == "fork_variant":
        yield {"type": "control_tool_start", "tool": "fork_variant"}
        result = await _tool_fork(state, str(args.get("newName") or user_text or "变体"))
        await _apersist(state)
        yield {"type": "control_tool_result", "tool": "fork_variant", **result}
        # 客户端靠 complete.finalState 看见新 versionId；不 yield 等于点了没反应。
        yield _complete(state)
        return
    yield {"type": "control_text", "text": CANNED_FAILURE}
    yield _complete(state)
