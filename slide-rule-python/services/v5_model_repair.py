"""
门禁前确定性修复（不变式引用近邻修复 + 悬挂不变式剔除降级）。

背景：真实生成三次有两次栽在 invariants.refs——LLM 在长 JSON 末尾回忆自己
前文起的几十个 id，是整个契约里幻觉率最高的部位（见
docs/reverse-eval-ai-artist-saas.md 实验 A 与线上截图案例
`generate_fall_risk_explanation`）。此前一个 ref 拼错 → 门禁硬拦 → 整个
模型报废 0/6，惩罚粒度不对称：不变式是增强注释层，不是结构骨架。

本模块在 generate 之后、gate 之前跑一次**确定性**修复（零 LLM、可解释）：
  1. 近邻修复：ref 解析失败时，在模型已知 id 集里找唯一近邻
     （词干包含 / difflib 相似度），唯一命中才改写并留痕；歧义不猜。
  2. 剔除降级：修不好的不变式整条剔除并留痕——坏引用不展示（诚实性不丢），
     但一条注释级内容不再株连骨架六系统。
骨架五段（datamodel/rbac/workflow/page/aigc/appbundle 绑定）不在修复范围，
悬挂仍由门禁硬拦——fail-closed 语义只对不变式层降级。

留痕写进 appbundle.invariantNotes = {"repaired": [...], "dropped": [...]}，
随 per-skill 证据通道原样到达客户端（AppBundle 屏如实展示）。
"""

from __future__ import annotations

import copy
import difflib
from typing import Any, Dict, List

from .v5_model_gate import _as_dict, _as_list, collect_invariant_ref_ids

# difflib 相似度阈值：0.75 能接住"多/少一个前缀词"级别的拼错
# （generate_fall_risk_explanation ↔ fall_risk_explanation ≈ 0.86），
# 又不至于把不相干 id 拉郎配。
_SIMILARITY_CUTOFF = 0.75


def _unique_near_match(ref: str, known: set) -> str | None:
    """唯一近邻：词干包含（唯一）→ difflib 相似度（唯一且过阈值）→ None。"""
    # 1) 词干包含：ref 是某已知 id 的子串 / 超串（去掉动词前缀这类拼错）
    containment = [k for k in known if (ref in k or k in ref) and k != ref]
    if len(containment) == 1:
        return containment[0]
    if len(containment) > 1:
        return None  # 歧义不猜
    # 2) difflib 近邻（cutoff 内唯一命中才算）
    close = difflib.get_close_matches(ref, list(known), n=2, cutoff=_SIMILARITY_CUTOFF)
    return close[0] if len(close) == 1 else None


def repair_five_system_model(model: Dict[str, Any]) -> Dict[str, Any]:
    """返回 {"model": 修复后的深拷贝, "repaired": [...], "dropped": [...]}。

    只动 appbundle.invariants：refs 近邻修复（唯一命中才改），修不好的
    不变式整条剔除。无 invariants 时原样返回（老模型零变化）。纯函数。
    """
    m = copy.deepcopy(_as_dict(model))
    appbundle = _as_dict(m.get("appbundle"))
    invariants = _as_list(appbundle.get("invariants"))
    if not invariants:
        return {"model": m, "repaired": [], "dropped": []}

    # 合法解析域与门禁第 7 节共享同一函数（曾因两边各自维护导致奇偶不齐：
    # 修复器认 AIGC 能力 id、门禁不认 → 合法不变式被误拦）
    known = collect_invariant_ref_ids(m)
    repaired: List[Dict[str, Any]] = []
    dropped: List[Dict[str, Any]] = []
    kept: List[Any] = []

    for inv in invariants:
        iv = _as_dict(inv)
        iid = str(iv.get("id") or iv.get("statement") or "").strip()[:60] or "<unnamed>"
        refs = [str(r).strip() for r in _as_list(iv.get("refs")) if str(r).strip()]
        new_refs: List[str] = []
        unresolved: List[str] = []
        for ref in refs:
            if ref in known:
                new_refs.append(ref)
                continue
            fixed = _unique_near_match(ref, known)
            if fixed is not None:
                new_refs.append(fixed)
                repaired.append({"invariantId": iid, "from": ref, "to": fixed})
            else:
                unresolved.append(ref)
        if not refs or unresolved:
            # 无 refs 的口号式不变式、或修不好的引用 → 整条剔除（留痕，不展示坏引用）
            dropped.append({
                "invariantId": iid,
                "statement": str(iv.get("statement") or "")[:120],
                "unresolvedRefs": unresolved,
            })
            continue
        fixed_inv = dict(iv)
        fixed_inv["refs"] = new_refs
        kept.append(fixed_inv)

    appbundle = dict(appbundle)
    appbundle["invariants"] = kept
    if repaired or dropped:
        appbundle["invariantNotes"] = {"repaired": repaired, "dropped": dropped}
    m["appbundle"] = appbundle
    return {"model": m, "repaired": repaired, "dropped": dropped}
