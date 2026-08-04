# -*- coding: utf-8 -*-
"""本轮运行的降级标记——降级过的一轮不许发合格证。

## 为什么需要这个

系统里到处是 fail-open 兜底：LLM 网关挂了就回落规则版选材、生成失败就退
RAG、取不到模型就用内置夹具。**兜底本身是对的**，外部一抖不该整条链卡死。
错的是兜底完还把结果按正常产出交付：2026-08-04 那轮 `agentic-pick` 连吃两
次 HTTP 400 回落规则版，整轮跳过建模链路，最后照样判 `closed 6/6`。

用户看到绿色的 closed 就以为东西做好了。**这比直接报错要坏**——报错知道
重跑，盖了章就信了。

## 做法来源

结构照 Kubernetes 的 `metav1.Condition`
（kubernetes/apimachinery/pkg/apis/meta/v1/types.go）：

    type / status / reason / message / lastTransitionTime

沿用它两条关键约定：
1. **reason 是机器可读的 CamelCase**，message 才是给人看的。判定逻辑只认
   reason，UI 只显示 message，两者不混用。
2. **status 有三态 True/False/Unknown**，Unknown 表示「状态无法确定」。
   这正是降级轮闭环的真实语义——不是「确定没做成」（False），而是
   「做没做成这件事本身已经不可信」。所以降级时闭环判定取 Unknown 侧：
   不发 closed，如实标出降级原因。

K8s 里 conditions 是**可累加的列表**而非单个 bool，我们照搬：一轮里可能
先后触发多种降级（选材回落 + 生成回退），每种各记一条，排查时能看到全貌。
现有的 `brainstormDegraded: bool` 那种单布尔做不到这点。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

DEGRADED_CONDITION_TYPE = "Degraded"

# reason 取值（CamelCase，机器可读——判定与统计都认这个，不认 message）
REASON_AGENTIC_PICK_FALLBACK = "AgenticPickFallback"
"""LLM 选材失败/被门剔除，回落规则版选能力。"""

REASON_CAPABILITY_LLM_FALLBACK = "CapabilityLlmFallback"
"""能力的原生 LLM 执行失败，回退 RAG。"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def mark_degraded(state: Any, *, reason: str, message: str) -> None:
    """记一条降级 Condition。同 reason 只保留首次（K8s 语义：
    lastTransitionTime 记的是**状态翻转**的时刻，重复上报不算翻转）。

    永不抛异常：这是留痕通道，留痕失败不该把主流程带崩——但它记不下来
    就意味着闭环判定看不见降级，所以宁可静默也要保证调用方不受影响。
    """
    try:
        existing = list(getattr(state, "runConditions", None) or [])
        for item in existing:
            if isinstance(item, dict) and item.get("reason") == reason:
                return
        existing.append(
            {
                "type": DEGRADED_CONDITION_TYPE,
                "status": "True",
                "reason": str(reason),
                "message": str(message)[:500],
                "lastTransitionTime": _now(),
            }
        )
        setattr(state, "runConditions", existing)
    except Exception:
        pass


def collect_degradations(state: Any) -> List[Dict[str, Any]]:
    """取出本轮所有生效的降级条目（status=True 的 Degraded）。"""
    out: List[Dict[str, Any]] = []
    for item in list(getattr(state, "runConditions", None) or []):
        if not isinstance(item, dict):
            continue
        if item.get("type") == DEGRADED_CONDITION_TYPE and item.get("status") == "True":
            out.append(item)
    return out


def degradation_blockers(degradations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """降级条目 → 闭环 blocker。降级轮不发合格证，理由如实透出。"""
    return [
        {
            "code": "CLOSURE_DEGRADED_RUN",
            "path": "runtimeClosure.runConditions",
            "affectedSkill": "",
            "ref": f"{d.get('reason')}: {str(d.get('message') or '')[:160]}",
        }
        for d in degradations
    ]


def degradation_summary(degradations: List[Dict[str, Any]]) -> str:
    """给人看的一句话。"""
    if not degradations:
        return ""
    reasons = "、".join(str(d.get("message") or d.get("reason") or "") for d in degradations[:3])
    return f"本轮有 {len(degradations)} 处降级，产出不足以判定闭环：{reasons}"
