"""精修轮把已有页面 id 拨回上一版（2026-08-18 过夜）。

## 事故

提示词冻结（model_id_lexicon +「照抄」硬词表）在第 2 步已经接线，日志也打
「精修 id 冻结：页面 N」。过夜 6 个话题里它**求不动**：

    物业   p1..p4  →  p1_page / p3_page / p4_page，p2 失踪
    活动室 p1..p4  →  equipment_hall / admin_dashboard / …
    快递   p1      →  p1_page  →  p1_page_workbench

id 一漂，图判「重画这一页」、照搬 reuse_pages、版本回退全对不上，而且不报错。
`精修 id 冻结` 那行照常出现——闸全绿但东西没了。

## 做法不是新发明

Reformer（RecLLM）的 identifier freezing：已分配的 item id 跨轮不变，新东西
才领新号。本仓 `v5_model_repair._unique_near_match` 已经是同一套——生成后
确定性对齐，零 LLM，歧义不猜。MCP LFID / 本仓 html_structure 第 5 条也是
「语义信号（名字）和 canonical_id 分开」。

提示词继续喂词表（模型少漂一次是赚的）。**拨回是结构闸**，不求自觉。

判断锚：精确 id → 剥后缀词干（p1_page_workbench → p1）→ 名字唯一命中。
顺序不当锚（SPEC 注释写过：顺序会变，名字不会）。

只在发生过改名/加后缀的那一轮，把对不上的旧页补回去——物业丢 p2 就是
「其余页加了 _page、这一页被当成删掉」。四页都还是原 id、少一页，当作
真删，不补（提示词允许「被迭代要求删掉的页面直接不出现」）。
"""

from __future__ import annotations

import copy
import os
import re
from typing import Any, Dict, List, Optional, Tuple


def refine_id_freeze_enabled() -> bool:
    """`SLIDERULE_REFINE_ID_FREEZE=0` 关掉提示词词表和结构拨回。默认开。

    线上回退杆和对照臂同一根：量"是不是它起的作用"必须同模型同话题跑 A/B。
    """
    raw = str(os.environ.get("SLIDERULE_REFINE_ID_FREEZE", "1")).strip().lower()
    return raw not in ("0", "false", "no", "off")

# 过夜实测漂法：p1 → p1_page → p1_page_workbench。剥的是装饰后缀，不是
# 业务词干（reservation 不会被剥成空）。
_SUFFIX_TOKENS = frozenset({
    "page", "pages", "workbench", "dashboard", "hall", "board",
    "view", "screen", "panel", "console",
})

_PAGE_REF_KEYS = frozenset({
    "id", "pageRef", "landingPageRef", "sourcePageId", "pageId",
})


def _norm_text(value: Any) -> str:
    return re.sub(r"[\s_\-]+", "", str(value or "").lower())


def _id_stem(pid: Any) -> str:
    parts = [p for p in str(pid or "").split("_") if p]
    while len(parts) > 1 and parts[-1].lower() in _SUFFIX_TOKENS:
        parts.pop()
    return "_".join(parts) if parts else str(pid or "")


def _prev_list(prev_pages: Any) -> List[Dict[str, Any]]:
    if not isinstance(prev_pages, list):
        return []
    return [p for p in prev_pages if isinstance(p, dict) and p.get("id")]


def resolve_prev_page_id(
    page: Dict[str, Any],
    prev_pages: List[Dict[str, Any]],
    taken: set,
) -> Optional[str]:
    """这一页对应上一版哪个 id。对不上就当新页（None）。歧义不猜。"""
    nid = str(page.get("id") or "").strip()
    nname = _norm_text(page.get("name"))

    unused = [p for p in prev_pages if str(p.get("id")) not in taken]
    if not unused:
        return None

    exact = [p for p in unused if str(p.get("id")) == nid]
    if len(exact) == 1:
        return str(exact[0]["id"])

    stem = _id_stem(nid)
    if stem:
        stem_hits = [
            p for p in unused
            if str(p.get("id")) == stem or _id_stem(p.get("id")) == stem
        ]
        if len(stem_hits) == 1:
            return str(stem_hits[0]["id"])

    if nname:
        name_hits = [p for p in unused if _norm_text(p.get("name")) == nname]
        if len(name_hits) == 1:
            return str(name_hits[0]["id"])
        contained = [
            p for p in unused
            if nname in _norm_text(p.get("name")) or _norm_text(p.get("name")) in nname
        ]
        if len(contained) == 1:
            return str(contained[0]["id"])

    return None


def _rewrite_refs(node: Any, mapping: Dict[str, str]) -> Any:
    if not mapping:
        return node
    if isinstance(node, dict):
        out = {}
        for key, value in node.items():
            if key in _PAGE_REF_KEYS and isinstance(value, str) and value in mapping:
                out[key] = mapping[value]
            else:
                out[key] = _rewrite_refs(value, mapping)
        return out
    if isinstance(node, list):
        return [_rewrite_refs(item, mapping) for item in node]
    return node


def _as_spec_page(prev: Dict[str, Any]) -> Dict[str, Any]:
    # purpose / audience 不能空：SpecPage 校验会咬。上一版模型页经常只有
    # id+name，用名字顶上，别为了补洞把整份 SPEC 作废。
    name = prev.get("name") or prev.get("id")
    return {
        "id": prev.get("id"),
        "name": name,
        "purpose": prev.get("purpose") or name or "沿用上一版页面",
        "audience": prev.get("audience") or "使用者",
        "coversNodes": list(prev.get("coversNodes") or []),
    }


def reconcile_pages(
    pages: List[Dict[str, Any]],
    prev_pages: List[Dict[str, Any]],
    prev_page_objs: Optional[List[Dict[str, Any]]] = None,
    *,
    restore: bool = True,
) -> Tuple[List[Dict[str, Any]], Dict[str, str], List[str]]:
    """把本轮页清单拨回上一版 id。返回 (新清单, 新id→旧id, 补回的旧id)。"""
    prev = _prev_list(prev_pages)
    if not prev:
        return pages, {}, []

    taken: set = set()
    mapping: Dict[str, str] = {}
    out: List[Dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        new_id = str(page.get("id") or "").strip()
        old_id = resolve_prev_page_id(page, prev, taken)
        if old_id:
            taken.add(old_id)
            if new_id and new_id != old_id:
                mapping[new_id] = old_id
            page = {**page, "id": old_id}
        out.append(page)

    restored: List[str] = []
    # 只有发生过改名/加后缀才补洞——否则「删掉报修台」会被我们偷偷加回来。
    if mapping and restore:
        by_id = {str(p.get("id")): p for p in out}
        catalog = _prev_list(prev_page_objs) or prev
        ordered: List[Dict[str, Any]] = []
        seen: set = set()
        for old in catalog:
            oid = str(old.get("id"))
            if oid in by_id:
                ordered.append(by_id[oid])
            else:
                ordered.append(_as_spec_page(old))
                restored.append(oid)
            seen.add(oid)
        for page in out:
            pid = str(page.get("id"))
            if pid not in seen:
                ordered.append(page)
                seen.add(pid)
        out = ordered
    return out, mapping, restored


def freeze_spec_pages(
    spec: Any,
    prev_pages: Any,
    prev_page_objs: Optional[List[Dict[str, Any]]] = None,
    *,
    restore: bool = True,
) -> Tuple[Any, Dict[str, Any]]:
    """第 2 步出口：SPEC 页 id 拨回。必须赶在图判 / 照搬 / 画页之前。"""
    if not isinstance(spec, dict):
        return spec, {"mapping": {}, "restored": []}
    spec = copy.deepcopy(spec)
    pages = [p for p in (spec.get("pages") or []) if isinstance(p, dict)]
    pages, mapping, restored = reconcile_pages(
        pages, prev_pages, prev_page_objs, restore=restore
    )
    spec["pages"] = pages
    spec = _rewrite_refs(spec, mapping)
    return spec, {"mapping": mapping, "restored": restored}


def freeze_pages_in_model(model: Any, reuse_model: Any) -> Tuple[Any, Dict[str, Any]]:
    """汇合出口 / GEN5 回落：模型侧 page.pages 与引用一并拨回。"""
    if not isinstance(model, dict) or not isinstance(reuse_model, dict):
        return model, {"mapping": {}, "restored": []}
    prev = _prev_list((reuse_model.get("page") or {}).get("pages"))
    if not prev:
        return model, {"mapping": {}, "restored": []}
    model = copy.deepcopy(model)
    page_block = model.get("page") if isinstance(model.get("page"), dict) else {}
    pages = [p for p in (page_block.get("pages") or []) if isinstance(p, dict)]
    pages, mapping, restored = reconcile_pages(pages, prev, prev)
    page_block = {**page_block, "pages": pages}
    model["page"] = page_block
    model = _rewrite_refs(model, mapping)
    return model, {"mapping": mapping, "restored": restored}


def log_freeze(report: Dict[str, Any], *, where: str) -> None:
    mapping = report.get("mapping") or {}
    restored = report.get("restored") or []
    if not mapping and not restored:
        return
    bits = []
    if mapping:
        bits.append("、".join(f"{n}→{o}" for n, o in mapping.items()))
    if restored:
        bits.append("补回 " + "、".join(restored))
    print(f"[page_id_freeze] {where}：{'；'.join(bits)}")
