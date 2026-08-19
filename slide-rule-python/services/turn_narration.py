"""驱动器写左栏步骤记录（E13 turnNarrations），随会话 blob 进库。

2026-08-18 社区工具屋（sr-20260818172818-8XJ40SG9AH）：四轮都画了页，
左栏却是「1 阶段 · 0 步」。库里 turnNarrations=[]。

E13 早就把叙述放进会话状态（文件 / HTTPS SQL 网关同一份 blob），
封顶、同轮守卫豁免都在。缺的是**谁写**：注释写「客户端轮末 PUT」，
而旁路 fetch、刷新后水合都不会走那条 SSE 收尾。Python 只封顶、不写，
于是落库字段永远空着。

⚠ 不另开一张步骤表。会话已经在库里；另开表要跟 lastTurnId 守卫、
3 轮封顶、水合对账再对一次，而这次看不见步骤的原因是「没人写字段」。

文案跟前端 useSlideRuleSession / capability-process-labels 对齐——
隔着一条 SSE，漏一个的后果是内部 id 漏到用户脸上。
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

MAX_TURNS = 3
MAX_STEPS = 300
MAX_TEXT = 1200

# 只收静态 liveLabel。函数型（mcp.call 等）走「正在执行 {id}」。
_CAPABILITY_LIVE_LABELS: Dict[str, str] = {
    "intent.parse": "正在理解你的目标",
    "intent.clarify": "正在澄清需求",
    "context.collect": "正在整理上下文",
    "source.classify": "正在归类信息来源",
    "gap.ask": "正在定位信息缺口",
    "question.expand": "正在展开关键问题",
    "assumption.validate": "正在校验假设",
    "route.generate": "正在生成可行路线",
    "route.compare": "正在对比路线",
    "tradeoff.evaluate": "正在权衡取舍",
    "scenario.simulate": "正在模拟场景",
    "execution.prepare": "正在准备执行方案",
    "risk.analyze": "正在分析风险",
    "counter.argue": "正在寻找反方观点",
    "argument.expand": "正在展开论证",
    "critique.generate": "正在自我挑刺",
    "rebuttal.resolve": "正在消解分歧",
    "evidence.search": "⚡ 正在全网检索外部证据",
    "memory.recall": "⚡ 正在回忆历史会话",
    "structure.decompose": "正在拆解结构",
    "document.draft": "正在起草文档",
    "requirement.write": "正在编写需求",
    "design.write": "正在编写设计",
    "task.write": "正在编写任务清单",
    "ux.preview": "正在生成交互预览",
    "outcome.visualize": "正在生成效果预览",
    "instruction.package": "正在打包执行指令",
    "synthesis.merge": "正在综合各方结论",
    "report.write": "正在撰写可行性报告",
    "traceability.matrix": "正在构建追溯矩阵",
    "handoff.package": "正在打包交接材料",
    "appbundle.runtimeClosure": "正在生成应用闭环",
    "refine": "精修：跳过规划，直进收口",
    "planning": "正在规划本轮动作",
}

_SPEC_FIRST_LABELS: Dict[str, str] = {
    "specfirst.spec": "起草规格：成功判据、需求节点与页面清单",
    "specfirst.design": "定这个应用的设计语言",
    "specfirst.pagescope": "判断这次要改哪几页",
    "specfirst.graphscope": "分析这次修改牵扯的范围",
    "specfirst.pages": "逐页画界面（并发）",
    "specfirst.structure": "从界面反推数据模型与关联关系",
    "specfirst.semantics": "推导权限、工作流与不变式",
    "specfirst.assemble": "汇合五系统模型并过结构闸",
    "specfirst.bind": "给界面接上数据",
}

_SKILL_LABELS: Dict[str, str] = {
    "datamodel": "数据模型",
    "dataModel": "数据模型",
    "workflow": "工作流",
    "rbac": "角色权限",
    "page": "页面",
    "aigc": "AI 能力",
    "appbundle": "应用装配",
    "appBundle": "应用装配",
}

_SKILL_EMIT_ORDER = [
    "datamodel",
    "rbac",
    "workflow",
    "page",
    "aigc",
    "appbundle",
]

_SKIP_THINK_PREFIXES = ("phase_changed:", "loop_timing:")


def human_capability_label(capability_id: str) -> str:
    cap = str(capability_id or "").strip()
    if cap in _CAPABILITY_LIVE_LABELS:
        return _CAPABILITY_LIVE_LABELS[cap]
    if cap in _SPEC_FIRST_LABELS:
        return _SPEC_FIRST_LABELS[cap]
    return f"正在执行 {cap}" if cap else "正在执行"


def _event_fields(ev: Any) -> Dict[str, Any]:
    if isinstance(ev, dict):
        return ev
    return {
        "kind": getattr(ev, "kind", ""),
        "text": getattr(ev, "text", ""),
        "capabilityId": getattr(ev, "capabilityId", ""),
        "turnId": getattr(ev, "turnId", ""),
    }


def _loop_index(turn_id: str) -> Optional[int]:
    matched = re.match(r"loop-(\d+)$", str(turn_id or ""))
    if not matched:
        return None
    return int(matched.group(1))


def _goal_text(state: Any) -> str:
    goal = getattr(state, "goal", None)
    if isinstance(goal, dict):
        return str(goal.get("text") or "")
    if goal is None:
        return ""
    return str(getattr(goal, "text", "") or "")


def _slim_step(step: Dict[str, Any]) -> Dict[str, Any]:
    slim = dict(step)
    for key in ("text", "message", "label", "title"):
        value = slim.get(key)
        if isinstance(value, str) and len(value) > MAX_TEXT:
            slim[key] = value[:MAX_TEXT] + "…"
    return slim


def cap_turn_narrations(state: Any) -> None:
    """E13 展示数据封顶：最近 3 轮 × 每轮 300 步 × 字段 1200 字。"""
    raw = getattr(state, "turnNarrations", None) or []
    capped: List[Dict[str, Any]] = []
    for entry in raw[-MAX_TURNS:]:
        if not isinstance(entry, dict) or not entry.get("turnId"):
            continue
        steps = []
        for step in (entry.get("steps") or [])[:MAX_STEPS]:
            if not isinstance(step, dict):
                continue
            steps.append(_slim_step(step))
        slim_entry: Dict[str, Any] = {
            "turnId": str(entry["turnId"]),
            "user": str(entry.get("user") or "")[:600],
            "steps": steps,
        }
        try:
            duration = int(entry.get("durationMs") or 0)
            if duration > 0:
                slim_entry["durationMs"] = min(duration, 24 * 3600 * 1000)
        except (TypeError, ValueError):
            pass
        capped.append(slim_entry)
    state.turnNarrations = capped


def stamp_turn_narration(
    state: Any,
    *,
    turn_id: str,
    user: str,
    steps: List[Dict[str, Any]],
    duration_ms: Optional[int] = None,
) -> Any:
    """同轮覆盖、只留最近 MAX_TURNS 轮。空步骤不打戳——与前端 stampTurnNarration 一致。"""
    if not turn_id or not steps:
        return state
    prior = [
        entry
        for entry in (getattr(state, "turnNarrations", None) or [])
        if isinstance(entry, dict) and entry.get("turnId") != turn_id
    ]
    entry: Dict[str, Any] = {
        "turnId": str(turn_id),
        "user": str(user or "")[:600],
        "steps": [_slim_step(step) for step in steps[:MAX_STEPS] if isinstance(step, dict)],
    }
    if duration_ms and duration_ms > 0:
        entry["durationMs"] = min(int(duration_ms), 24 * 3600 * 1000)
    state.turnNarrations = (prior + [entry])[-MAX_TURNS:]
    cap_turn_narrations(state)
    return state


def project_drive_steps(
    state: Any,
    *,
    user: str,
    events_cursor: int,
) -> List[Dict[str, Any]]:
    """把本趟 drive 新增的 reasoningEvents + 本轮页面/闭环投成左栏 steps。

    ``events_cursor`` 是本趟开头的事件条数。不截的话精修轮会把首轮
    intent.parse 再投一遍——看起来像规划又跑了，其实是上一趟的骨灰。
    """
    steps: List[Dict[str, Any]] = []
    seq = 0

    def add_chip(label: str, *, capability_id: str = "intent.parse") -> None:
        nonlocal seq
        seq += 1
        steps.append(
            {
                "id": f"srv-{seq}",
                "kind": "chip",
                "capabilityId": capability_id,
                "roleId": "system",
                "label": str(label)[:MAX_TEXT],
                "realLlm": False,
                "progressType": "thinking",
            }
        )

    def add_narration(text: str) -> None:
        nonlocal seq
        seq += 1
        steps.append(
            {
                "id": f"srv-{seq}",
                "kind": "narration",
                "text": str(text)[:MAX_TEXT],
                "source": "llm",
                "isFinal": True,
            }
        )

    add_chip("指令已接收 · 启动推理")

    events = list(getattr(state, "reasoningEvents", None) or [])[max(0, events_cursor) :]
    for ev in events:
        fields = _event_fields(ev)
        kind = str(fields.get("kind") or "")
        text = str(fields.get("text") or "")
        cap = str(fields.get("capabilityId") or "")
        turn = str(fields.get("turnId") or "")
        if kind == "think" and text.startswith("refine_skip_planning"):
            add_chip(
                "第 1 轮 · 精修：跳过规划，直进收口",
                capability_id="appbundle.runtimeClosure",
            )
            continue
        if kind == "think" and text.startswith(_SKIP_THINK_PREFIXES):
            continue
        if kind != "capability_start":
            continue
        human = human_capability_label(cap)
        loop = _loop_index(turn)
        label = f"第 {loop + 1} 轮 · {human}" if loop is not None else human
        add_chip(label, capability_id=cap or "intent.parse")

    pages_blob = getattr(state, "specFirstPages", None) or {}
    page_map = pages_blob.get("pages") if isinstance(pages_blob, dict) else None
    if isinstance(page_map, dict) and page_map:
        total = len(page_map)
        for index, page_id in enumerate(page_map.keys(), 1):
            add_chip(
                f"🖼 界面已出：{page_id}（{index}/{total}）",
                capability_id="ux.preview",
            )

    closure = getattr(state, "publishClosure", None) or {}
    if not isinstance(closure, dict):
        closure = {}
    per_skill = closure.get("perSkillEvidence") or {}
    if isinstance(per_skill, dict) and per_skill:
        for key in _SKILL_EMIT_ORDER:
            evidence = per_skill.get(key)
            if not isinstance(evidence, dict):
                continue
            name = _SKILL_LABELS.get(key, key)
            add_chip(f"⚙ {name} 系统画面生成中...", capability_id="appbundle.runtimeClosure")
            present = evidence.get("evidencePresent") is True
            add_chip(
                f"{'✓' if present else '✗'} {name} 证据{'落地' if present else '缺失（fail-closed）'}",
                capability_id="appbundle.runtimeClosure",
            )

    paint = str(closure.get("refinePaintNote") or "").strip()
    summary = str(closure.get("chatSummary") or "").strip()
    instruction = str(user or "").strip()
    goal = _goal_text(state).strip()
    follow_up = bool(instruction and goal and instruction != goal)
    painted = bool(page_map)
    if paint:
        add_narration(paint)
    elif follow_up and painted:
        add_narration("本轮已按指令改画页面。")
    elif follow_up:
        add_narration("本轮没有画出新的页面，上一版保留。")
    elif summary:
        add_narration(summary)

    return steps[:MAX_STEPS]


def stamp_drive_narration(
    state: Any,
    *,
    turn_id: str,
    user: str,
    events_cursor: int,
    started_monotonic: Optional[float] = None,
) -> Any:
    """轮末把本趟步骤打进 state.turnNarrations，下一笔 persist_state 进库。"""
    steps = project_drive_steps(state, user=user, events_cursor=events_cursor)
    duration_ms = None
    if started_monotonic is not None:
        duration_ms = int((time.monotonic() - started_monotonic) * 1000)
    return stamp_turn_narration(
        state,
        turn_id=turn_id,
        user=user,
        steps=steps,
        duration_ms=duration_ms,
    )
