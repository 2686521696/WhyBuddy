"""Agentic pick（F2 实验，2026-07-15）：LLM 提案下一批能力，确定门验收。

北极星语境：V5.2 的 pick_next_capabilities 是纯规则挑选（关键词路由 +
缺啥补啥 + 冷启动兜底），LLM 在推演循环里只在盒子内填空、没有驾驶权
——这是「IM 照本宣科」观感的直接来源。本模块把"下一步干什么"这一个
决策点让给 LLM，但保持三条不变量（门裁决）：

  1. 收敛权仍归规则：规则版 pick 为空 → 本轮照旧收敛，LLM 无权续命；
     LLM 提案只在规则版非空时才可能替换它（选材自主，停机确定）。
  2. 词表封闭：提案里的 capabilityId 必须在 V5.2 能力词表内，roleId
     必须在四角色内——幻觉能力/角色直接剔除。
  3. fail-open 回落：LLM 停用/失败/提案全被剔除 → 返回 None，调用方
     沿用规则版结果。实验开关 SLIDERULE_AGENTIC_PICK=on（默认 off，
     不影响现有全部行为与测试）。

对比评测跑法见 scripts/agentic_pick_eval.py（十话题双模式指标对比）。
"""

from __future__ import annotations

import os
from typing import Any, Optional

from models.v5_state import V5SessionState

# ── V5.2 能力词表（与 slide_rule_session.pick_next_capabilities 的产出
#    全集一致；中文注解给 LLM 读）─────────────────────────────────────

CAPABILITY_VOCAB: dict[str, str] = {
    "gap.ask": "识别信息缺口并向用户提问（澄清需求）",
    "intent.clarify": "细化模糊意图为明确目标",
    "intent.parse": "解析用户意图结构",
    "structure.decompose": "把目标分解成规格树（spec tree）",
    "evidence.search": "检索外部证据（RAG/搜索）支撑结论",
    "repo.inspect": "检查代码仓库（有 GitHub/GitLab 链接时）",
    "risk.analyze": "分析关键风险与分歧点",
    "route.generate": "生成可选实现路线",
    "route.compare": "对比路线优劣并给出建议",
    "scenario.simulate": "沙盘推演关键场景",
    "critique.generate": "生成批判性质疑（红队视角）",
    "counter.argue": "对既有结论提出反方论证",
    "synthesis.merge": "综合多方产物成统一结论",
    "report.write": "撰写可行性/结论报告",
    "document.draft": "起草交付文档",
    "traceability.matrix": "生成需求-实现追溯矩阵",
    "task.write": "拆写可执行任务清单",
    "instruction.package": "打包提示词/指令包",
    "outcome.visualize": "可视化成果（图表/结构图）",
    "handoff.package": "打包最终交接物",
}

ROLE_VOCAB = ("产品", "架构", "工程", "综合")

# 能力 → 缺省角色（LLM 给了非法角色时的纠偏映射，与规则版口径一致）
_DEFAULT_ROLE: dict[str, str] = {
    "gap.ask": "产品",
    "intent.clarify": "产品",
    "intent.parse": "产品",
    "task.write": "产品",
    "structure.decompose": "架构",
    "outcome.visualize": "架构",
    "route.generate": "架构",
    "route.compare": "架构",
    "document.draft": "工程",
    "instruction.package": "工程",
    "handoff.package": "工程",
    "repo.inspect": "工程",
}

_MAX_PICKS = 5  # 与规则版 cap<=5 同口径


def agentic_pick_enabled() -> bool:
    return str(os.getenv("SLIDERULE_AGENTIC_PICK", "")).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


# ── 状态摘要（LLM 的"仪表盘"：让它看见全局再提案）──────────────────────


def _artifact_kind_counts(state: V5SessionState) -> dict[str, int]:
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    counts: dict[str, int] = {}
    for a in getattr(state, "artifacts", []) or []:
        if isinstance(a, dict):
            aid, kind, tl = a.get("id"), a.get("kind"), a.get("trustLevel")
        else:
            aid = getattr(a, "id", None)
            kind = getattr(a, "kind", None)
            tl = getattr(a, "trustLevel", None)
        if not kind or aid in stales:
            continue
        if tl in ("gated_pass", "audited"):
            counts[kind] = counts.get(kind, 0) + 1
    return counts


def _state_digest(state: V5SessionState, user_text: str, loop_index: int) -> str:
    goal = state.goal if isinstance(state.goal, dict) else {}
    kinds = _artifact_kind_counts(state)
    runs = getattr(state, "capabilityRuns", []) or []
    recent = [
        (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        for r in runs[-8:]
    ]
    open_qs = [
        str(q.get("text") if isinstance(q, dict) else q)[:60]
        for q in (getattr(state, "openQuestions", []) or [])[:5]
    ]
    gaps = [
        str(g.get("title") or g.get("id") if isinstance(g, dict) else g)[:60]
        for g in (getattr(state, "coverageGaps", []) or [])[:6]
    ]
    lines = [
        f"【本轮用户输入】{(user_text or '').strip()[:300]}",
        f"【目标】{str(goal.get('text') or '')[:200]}（状态 {goal.get('status') or '未定'}）",
        f"【第 {loop_index + 1} 轮】已执行能力序列（最近 8 步）：{' → '.join(recent) or '无'}",
        f"【健康产物】{kinds or '无'}；失效产物 {len(getattr(state, 'staleArtifactIds', []) or [])} 件",
        f"【未答问题】{open_qs or '无'}",
        f"【覆盖缺口】{gaps or '无'}",
    ]
    return "\n".join(lines)


# ── LLM 提案 + 门验收 ─────────────────────────────────────────────────


def _validate_proposal(raw: Any, state: V5SessionState) -> list[dict] | None:
    """验收：词表封闭 + 角色纠偏 + 去重 + 重复护栏 + cap<=5。全灭 → None。"""
    if not isinstance(raw, dict):
        return None
    items = raw.get("picks")
    if not isinstance(items, list):
        return None
    runs = getattr(state, "capabilityRuns", []) or []
    recent = [
        (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        for r in runs[-6:]
    ]
    picks: list[dict] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        cap = str(item.get("capabilityId") or "").strip()
        if cap not in CAPABILITY_VOCAB or cap in seen:
            continue  # 幻觉能力/重复提案剔除
        # 重复护栏（与驱动器 max_repeat_guard 同精神）：最近 6 步里已跑过
        # 两次的能力不许再提——防 LLM 原地打转
        if recent.count(cap) >= 2:
            continue
        role = str(item.get("roleId") or "").strip()
        if role not in ROLE_VOCAB:
            role = _DEFAULT_ROLE.get(cap, "综合")
        seen.add(cap)
        picks.append({"capabilityId": cap, "roleId": role})
        if len(picks) >= _MAX_PICKS:
            break
    return picks or None


def agentic_pick_next_capabilities(
    state: V5SessionState,
    user_text: str,
    *,
    loop_index: int = 0,
) -> Optional[dict]:
    """LLM 看全局提案下一批能力。返回 {"picks": [...], "rationale": str}；
    停用/失败/提案全被门剔除 → None（调用方回落规则版）。"""
    if not agentic_pick_enabled():
        return None
    vocab_lines = "\n".join(f"- {cap}：{desc}" for cap, desc in CAPABILITY_VOCAB.items())
    try:
        from sliderule_llm.client import call_llm_json

        parsed, _res = call_llm_json(
            [
                {
                    "role": "system",
                    "content": (
                        "你是产品推演引擎的编排器。根据推演现场的仪表盘，"
                        "提案下一批要执行的能力（1-5 个，按执行顺序）。原则：\n"
                        "1. 缺证据先补证据，有分歧先红队质疑，结论未综合先综合，"
                        "用户明确要交付物才走交付链\n"
                        "2. 不要重复已充分执行的能力；每个提案说一句为什么\n"
                        "3. capabilityId 只能从能力清单里选（原样抄写），"
                        "roleId 只能是 产品|架构|工程|综合\n"
                        "只输出 JSON：{\"rationale\":\"一句话总体策略\","
                        "\"picks\":[{\"capabilityId\":\"\",\"roleId\":\"\","
                        "\"why\":\"\"}]}\n"
                        "能力清单：\n" + vocab_lines
                    ),
                },
                {"role": "user", "content": _state_digest(state, user_text, loop_index)},
            ],
            temperature=0.2,
            max_tokens=4000,
            max_attempts=1,
            reasoning_effort="low",
        )
    except Exception:
        return None
    picks = _validate_proposal(parsed, state)
    if not picks:
        return None
    return {
        "picks": picks,
        "rationale": str(parsed.get("rationale") or "")[:200],
    }
