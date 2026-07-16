"""E17 证据上下文管道：上游健康产物 → 轮内能力 prompt 的注入装箱器。

用户实测挖出的缺陷：轮内推理能力（综合各方结论/报告/反证…）的 LLM
prompt 只喂 GOAL + USER_MESSAGE——「综合各方结论」综合的不是各方结论，
是对话题的独立再推演。状态机层面产物正确落库过门，LLM 上下文里却断了。

设计（用户批准 2026-07-16，借三家语义、零新依赖）：
- 准入 = 信任门（本仓独有）：只收 trustLevel ∈ {gated_pass, audited}、
  不 stale 的产物——只喂过了门的，不喂垃圾；
- 优先级 = priompt 语义：按能力定 kind 优先级表，超预算整件丢弃
  低优先级（不腰斩），同优先级新轮次优先（Letta 的"新近"）；
- 装箱 = LlamaIndex compact 语义：单件截断 + 总预算；
- 诚实：被省略的留一行「另有 N 件…未注入」——省略了就说省略了。

停用开关：SLIDERULE_EVIDENCE_CONTEXT=off（A/B 评测的对照臂）。
"""

from __future__ import annotations

import os
from typing import Any

# 单件内容摘录上限 / 总预算（字符）——中文场景字符≈token 数量级可控
PER_ITEM_CONTENT_CHARS = 400
DEFAULT_BUDGET_CHARS = 3000

# kind 优先级表（数字小 = 优先注入）。能力按前缀归族；未列 kind 给低优先级。
_PRIORITY_BY_FAMILY: dict[str, dict[str, int]] = {
    # 综合：吃各方结论的原料——风险/证据/澄清/决策
    "synthesis": {"risk": 0, "evidence": 1, "clarification": 2, "decision": 3},
    # 报告：吃已综合的结论优先，其次原料
    "report": {"synthesis": 0, "risk": 1, "evidence": 2, "decision": 3, "clarification": 4},
    # 反证/挑战：对着结论和风险打
    "counter": {"synthesis": 0, "risk": 1, "evidence": 2},
    "critique": {"synthesis": 0, "risk": 1, "evidence": 2},
    # 缺省：证据打底
    "*": {"evidence": 0, "risk": 1, "synthesis": 2, "clarification": 3, "decision": 4},
}
_UNLISTED_KIND_PRIORITY = 9


def evidence_context_enabled() -> bool:
    return str(os.getenv("SLIDERULE_EVIDENCE_CONTEXT", "on")).strip().lower() not in (
        "off",
        "0",
        "false",
    )


def _family(capability_id: str) -> dict[str, int]:
    cap = (capability_id or "").lower()
    for key, table in _PRIORITY_BY_FAMILY.items():
        if key != "*" and key in cap:
            return table
    return _PRIORITY_BY_FAMILY["*"]


def _admit(artifact: dict[str, Any], stale_ids: set[str]) -> bool:
    """信任门准入：过了门、没失效、有内容。"""
    if artifact.get("trustLevel") not in ("gated_pass", "audited"):
        return False
    if artifact.get("id") in stale_ids:
        return False
    if artifact.get("status") in ("stale", "superseded"):
        return False
    return bool(str(artifact.get("summary") or artifact.get("content") or "").strip())


def _render_item(artifact: dict[str, Any]) -> str:
    kind = str(artifact.get("kind") or "artifact")
    title = str(artifact.get("title") or "").strip()[:80]
    summary = str(artifact.get("summary") or "").strip()[:200]
    content = str(artifact.get("content") or "").strip()[:PER_ITEM_CONTENT_CHARS]
    head = f"【{kind}{' · ' + title if title else ''}】"
    body = summary if summary else ""
    if content and content != summary:
        body = f"{body}\n{content}" if body else content
    return f"{head}{body}"


def build_evidence_context(
    artifacts: list[dict[str, Any]],
    stale_ids: set[str] | None = None,
    *,
    capability_id: str,
    budget_chars: int = DEFAULT_BUDGET_CHARS,
) -> str:
    """健康产物 → 注入文本。没有可注入内容返回空串（调用方不加空段）。"""
    stale = stale_ids or set()
    table = _family(capability_id)
    admitted = [a for a in artifacts or [] if isinstance(a, dict) and _admit(a, stale)]
    if not admitted:
        return ""
    # 排序键：(kind 优先级, 越新越先)——enumerate 序作为"新近"代理（artifacts
    # 是追加式列表，索引大 = 新）
    ranked = sorted(
        enumerate(admitted),
        key=lambda pair: (
            table.get(str(pair[1].get("kind") or ""), _UNLISTED_KIND_PRIORITY),
            -pair[0],
        ),
    )
    blocks: list[str] = []
    used = 0
    dropped = 0
    for pos, (_idx, artifact) in enumerate(ranked):
        block = _render_item(artifact)
        if used + len(block) > budget_chars:
            # priompt 语义：预算满即按优先级整体截止（整件丢弃不腰斩，
            # 也不拿更低优先级的小件塞缝——顺序即承诺）
            dropped = len(ranked) - pos
            break
        blocks.append(block)
        used += len(block) + 2
    if not blocks:
        return ""
    if dropped:
        # 诚实留痕：省略了就说省略了
        blocks.append(f"（另有 {dropped} 件低优先级上游产物因预算未注入）")
    return "\n\n".join(blocks)
