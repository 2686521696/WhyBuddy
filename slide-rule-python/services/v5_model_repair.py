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
悬挂仍由门禁硬拦——fail-closed 语义只对不变式/展示层降级。

E37 扩展：page.charts / page.stats（图表与统计卡声明）与不变式同理——
可选的展示增强层，不是结构骨架。用户实测案例：LLM 在 chart.metric 写了
`avg:word_card.mastery_score`（stats 合法、charts 非法的枚举陷阱）→ 门禁
硬拦 → 整个模型 0/6 报废。此处同款处方：字段引用近邻修复（唯一命中才改）、
形态非法（type/metric 枚举违规）整条剔除留痕、非法 format 清除回默认渲染。

留痕写进 appbundle.invariantNotes = {"repaired": [...], "dropped": [...]} 与
appbundle.presentationNotes = {"repaired","droppedCharts","droppedStats",
"clearedFormats"}，随 per-skill 证据通道原样到达客户端（AppBundle 屏如实展示）。
"""

from __future__ import annotations

import copy
import difflib
from typing import Any, Dict, List

from .v5_model_gate import (
    STAT_FORMATS,
    _as_dict,
    _as_list,
    _collect_datamodel_field_refs,
    collect_invariant_ref_ids,
)

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


# 合法域来自单一真相源（经 gate re-export，E40.1）——与门永远同一本账
from .v5_model_gate import CHART_TYPES as _CHART_TYPES


def _repair_presentation_layer(m: Dict[str, Any]) -> Dict[str, Any]:
    """page.charts / page.stats 的确定性修复（E37，与门禁同一套合法域）。

    返回留痕 {"repaired","droppedCharts","droppedStats","clearedFormats"}，
    并原地改写 m["page"]["pages"]（调用方已深拷贝）。规则与 gate 的
    charts/stats 校验一一对应：能近邻修复的字段引用修掉，形态非法
    （枚举违规）的整条剔除——展示层小违规不再株连整模型 0/6。
    """
    field_refs = _collect_datamodel_field_refs(_as_dict(m.get("datamodel")))
    entity_ids = {r for r in field_refs if "." not in r}
    dotted_refs = field_refs - entity_ids
    from .v5_model_gate import _collect_field_types

    field_types = _collect_field_types(_as_dict(m.get("datamodel")))
    notes: Dict[str, List[Dict[str, Any]]] = {
        "repaired": [], "droppedCharts": [], "droppedStats": [],
        "droppedRankings": [], "droppedFeeds": [],
        "clearedFormats": [], "clearedIdentity": [],
    }

    def _fix_ref(container: Dict[str, Any], key: str, ref: str, known: set, pid: str) -> bool:
        """近邻修复 container[key]（引用 ref）。修成返回 True 并留痕。"""
        if not ref:
            return False  # 缺失的引用没有"近邻"，修它是瞎猜——留给剔除
        # 带点的字段引用只在带点集合里找近邻：裸实体 id 是任何 entity.* 的
        # 子串，混进候选会把明显的字段拼错误判成"歧义不猜"
        if "." in ref and known is field_refs:
            known = dotted_refs
        fixed = _unique_near_match(ref, known)
        if fixed is None:
            return False
        container[key] = fixed
        notes["repaired"].append({"pageId": pid, "path": key, "from": ref, "to": fixed})
        return True

    page = _as_dict(m.get("page"))
    pages = _as_list(page.get("pages"))
    new_pages: List[Any] = []
    for p in pages:
        if not isinstance(p, dict):
            new_pages.append(p)
            continue
        pd = dict(p)
        pid = str(pd.get("id") or pd.get("name") or "<unnamed>")

        kept_charts: List[Any] = []
        for chart in _as_list(pd.get("charts")):
            cd = dict(_as_dict(chart))
            cid = str(cd.get("id") or cd.get("name") or "<unnamed>")
            drop_reason = ""
            ctype = str(cd.get("type") or "").strip()
            if not isinstance(chart, dict):
                drop_reason = "声明不是对象"
            elif ctype and ctype not in _CHART_TYPES:
                drop_reason = f"图表形态 '{ctype}' 渲染层不支持"
            if not drop_reason:
                dim = str(cd.get("dimension") or "").strip()
                if (not dim or dim not in field_refs) and not _fix_ref(cd, "dimension", dim, field_refs, pid):
                    drop_reason = f"维度 '{dim or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                metric = str(cd.get("metric") or "").strip()
                if metric.startswith("sum:"):
                    mref = metric[4:].strip()
                    if mref not in field_refs:
                        fixed = _unique_near_match(mref, dotted_refs if "." in mref else field_refs)
                        if fixed is None:
                            drop_reason = f"指标字段 '{mref}' 无法解析到数据模型"
                        else:
                            cd["metric"] = f"sum:{fixed}"
                            notes["repaired"].append({"pageId": pid, "path": "metric", "from": mref, "to": fixed})
                elif metric and metric != "count":
                    # charts 只认 count/sum:*（avg: 是 stats 专属）——改写会撒谎，剔除留痕
                    drop_reason = f"图表指标 '{metric}' 只能是 count 或 sum:<entity.field>"
            if drop_reason:
                notes["droppedCharts"].append({"pageId": pid, "chartId": cid, "reason": drop_reason})
            else:
                kept_charts.append(cd)
        if "charts" in pd:
            pd["charts"] = kept_charts

        kept_stats: List[Any] = []
        for stat in _as_list(pd.get("stats")):
            sd = dict(_as_dict(stat))
            sid = str(sd.get("id") or sd.get("name") or "<unnamed>")
            drop_reason = ""
            if not isinstance(stat, dict):
                drop_reason = "声明不是对象"
            if not drop_reason:
                entity_ref = str(sd.get("entity") or "").strip()
                if (not entity_ref or entity_ref not in entity_ids) and not _fix_ref(sd, "entity", entity_ref, entity_ids, pid):
                    drop_reason = f"实体 '{entity_ref or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                metric = str(sd.get("metric") or "").strip()
                if metric.startswith("sum:") or metric.startswith("avg:"):
                    mref = metric[4:].strip()
                    if mref not in field_refs:
                        fixed = _unique_near_match(mref, dotted_refs if "." in mref else field_refs)
                        if fixed is None:
                            drop_reason = f"指标字段 '{mref}' 无法解析到数据模型"
                        else:
                            sd["metric"] = f"{metric[:4]}{fixed}"
                            notes["repaired"].append({"pageId": pid, "path": "metric", "from": mref, "to": fixed})
                elif metric != "count":
                    drop_reason = f"统计指标 '{metric or '<缺失>'}' 只能是 count/sum:/avg:"
            if not drop_reason:
                sfmt = str(sd.get("format") or "").strip()
                if sfmt and sfmt not in STAT_FORMATS:
                    sd.pop("format", None)  # 非法 format 清除，回默认渲染（stat 本体保留）
                    notes["clearedFormats"].append({"pageId": pid, "statId": sid, "format": sfmt})
            if drop_reason:
                notes["droppedStats"].append({"pageId": pid, "statId": sid, "reason": drop_reason})
            else:
                kept_stats.append(sd)
        if "stats" in pd:
            pd["stats"] = kept_stats

        # E40.4 排行榜/动态流：与图表同款处方——引用近邻修复（唯一命中），
        # 修不好整条剔除留痕。类型不匹配（sortBy 非 number / timeField 非
        # date / levelField 非 enum）由门硬拦，这里只治悬空引用。
        number_refs = {r for r, t in field_types.items() if t == "number"}
        date_refs = {r for r, t in field_types.items() if t == "date"}
        enum_refs = {r for r, t in field_types.items() if t == "enum"}

        kept_rankings: List[Any] = []
        for rank in _as_list(pd.get("rankings")):
            rd = dict(_as_dict(rank))
            rid = str(rd.get("id") or rd.get("name") or "<unnamed>")
            drop_reason = ""
            if not isinstance(rank, dict):
                drop_reason = "声明不是对象"
            if not drop_reason:
                entity_ref = str(rd.get("entity") or "").strip()
                if (not entity_ref or entity_ref not in entity_ids) and not _fix_ref(rd, "entity", entity_ref, entity_ids, pid):
                    drop_reason = f"实体 '{entity_ref or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                sort_ref = str(rd.get("sortBy") or "").strip()
                if (sort_ref not in number_refs) and not _fix_ref(rd, "sortBy", sort_ref, number_refs, pid):
                    drop_reason = f"排序字段 '{sort_ref or '<缺失>'}' 无法解析到数值字段"
            if drop_reason:
                notes["droppedRankings"].append({"pageId": pid, "rankingId": rid, "reason": drop_reason})
            else:
                kept_rankings.append(rd)
        if "rankings" in pd:
            pd["rankings"] = kept_rankings

        kept_feeds: List[Any] = []
        for feed in _as_list(pd.get("feeds")):
            fd2 = dict(_as_dict(feed))
            fid = str(fd2.get("id") or fd2.get("name") or "<unnamed>")
            drop_reason = ""
            if not isinstance(feed, dict):
                drop_reason = "声明不是对象"
            if not drop_reason:
                entity_ref = str(fd2.get("entity") or "").strip()
                if (not entity_ref or entity_ref not in entity_ids) and not _fix_ref(fd2, "entity", entity_ref, entity_ids, pid):
                    drop_reason = f"实体 '{entity_ref or '<缺失>'}' 无法解析到数据模型"
            if not drop_reason:
                time_ref = str(fd2.get("timeField") or "").strip()
                if (time_ref not in date_refs) and not _fix_ref(fd2, "timeField", time_ref, date_refs, pid):
                    drop_reason = f"时间字段 '{time_ref or '<缺失>'}' 无法解析到日期字段"
            if not drop_reason:
                level_ref = str(fd2.get("levelField") or "").strip()
                if level_ref and level_ref not in enum_refs and not _fix_ref(fd2, "levelField", level_ref, enum_refs, pid):
                    fd2.pop("levelField", None)  # 级别是可选增强——修不好清掉，流本体保留
                    notes["clearedFormats"].append({"pageId": pid, "statId": fid, "format": f"levelField:{level_ref}"})
            if drop_reason:
                notes["droppedFeeds"].append({"pageId": pid, "feedId": fid, "reason": drop_reason})
            else:
                kept_feeds.append(fd2)
        if "feeds" in pd:
            pd["feeds"] = kept_feeds

        new_pages.append(pd)

    if pages:
        page = dict(page)
        page["pages"] = new_pages
        m["page"] = page

    # E40.2 应用身份段：非法枚举值清除回默认（渲染层会用缺省主题/图标/导航），
    # 产品名空串清除。身份是纯展示增强层——与 format 同款处方，绝不株连。
    from .schema_legal import IDENTITY_ICONS, IDENTITY_NAVS, IDENTITY_THEMES

    appbundle_i = _as_dict(m.get("appbundle"))
    identity = appbundle_i.get("appIdentity")
    if isinstance(identity, dict):
        fixed_identity = dict(identity)
        for key, legal in (("theme", IDENTITY_THEMES), ("icon", IDENTITY_ICONS), ("nav", IDENTITY_NAVS)):
            value = str(fixed_identity.get(key) or "").strip()
            if key in fixed_identity and (not value or value not in legal):
                fixed_identity.pop(key, None)
                notes["clearedIdentity"].append({"key": key, "value": value})
        if "productName" in fixed_identity and not str(fixed_identity.get("productName") or "").strip():
            fixed_identity.pop("productName", None)
            notes["clearedIdentity"].append({"key": "productName", "value": ""})
        if fixed_identity != identity:
            appbundle_i = dict(appbundle_i)
            appbundle_i["appIdentity"] = fixed_identity
            m["appbundle"] = appbundle_i
    return notes


def repair_five_system_model(model: Dict[str, Any]) -> Dict[str, Any]:
    """返回 {"model": 修复后的深拷贝, "repaired": [...], "dropped": [...],
    "presentation": {...}}。

    动两层：appbundle.invariants（refs 近邻修复，修不好的整条剔除）与
    page.charts/stats 展示层声明（E37 同款处方）。两层都没内容时原样返回
    （老模型零变化）。纯函数。
    """
    m = copy.deepcopy(_as_dict(model))

    presentation = _repair_presentation_layer(m)
    if any(presentation.values()):
        appbundle_p = dict(_as_dict(m.get("appbundle")))
        appbundle_p["presentationNotes"] = {k: v for k, v in presentation.items() if v}
        m["appbundle"] = appbundle_p

    appbundle = _as_dict(m.get("appbundle"))
    invariants = _as_list(appbundle.get("invariants"))
    if not invariants:
        return {"model": m, "repaired": [], "dropped": [], "presentation": presentation}

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
    return {"model": m, "repaired": repaired, "dropped": dropped, "presentation": presentation}
