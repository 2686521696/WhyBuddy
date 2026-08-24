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


# ── 首轮：草稿 id → 模型 id（2026-08-24）─────────────────────────────────
#
# 上面那半个文件解决的是**精修轮**的漂移（新一轮铸的 id 拨回上一版）。
# 下面这半个解决的是**首轮**的错位，两者方向相反、成因也不同：
#
#     第 2 步  SPEC 铸草稿 id            p1 p2 p3 p4
#     第 3 步  按草稿 id 画页            pages = {p1: html, ...}
#     第 4 步  从 HTML 反推结构，LLM 给每页起**语义 id**
#              borrow_return_desk / reader_archive_center …
#              （DerivedPage.sourcePageId 记着它是从哪张草稿来的）
#     第 6 步  模型的 page.pages[].id 取自结构 = 语义 id
#
# 于是首轮交付的那一份里，**页面包的键是 p1..p4，模型的页面 id 是语义 id**，
# 交集为空。第 4 步那句注释写着「HTML 键已经是拨回后的 id」——那句话在精修轮
# 成立（第 2 步 freeze 已经把 SPEC 拨到上一版模型的 id 上了），**首轮不成立，
# 而没有任何一处校验它**。
#
# ## 真机后果（2026-08-24，图书馆借阅那趟，三轮对照）
#
# ① 第一次迭代必然全量重写。`split_pages_for_refine` 的照搬条件是
#    `pid in declared`——pid 来自上一版页面包（p1..p4），declared 是本轮 SPEC
#    的页面 id（已被 freeze 拨成语义 id），交集恒空：
#
#        第一次迭代   重画 1 页 / 照搬 0 页 → 实际改了 4/4 页
#                     画页 50.1s、bind 34.2s（bound=4 bindSkipped=0）
#        第二次迭代   重画 1 页 / 照搬 3 页 → 实际改了 1/4 页
#                     画页 4.7s、bind 30.3s（bound=1 bindSkipped=3）
#
#    量的是渲染后的 DOM（纪律五）：第一次迭代里用户没点名的三页，整张表消失、
#    表头 12 列变 7 列、列名全换；连点名那一页的 data 绑定都从 49 掉到 28。
#    第二次迭代那三页 nodes/th/bind/text **四项逐一相等**。
#
# ② 首轮的页面拿不到工作流动作。`html_bindings.build_prompt` 里
#    `this_page_bound = page_id in wf_bound_pages`——page_id 是页面包的键、
#    wf_bound_pages 来自 model.appbundle.pageBindings[].pageRef，首轮恒不相等，
#    于是每一页都被告知「这一页没有绑定流程，不要用那三种转移动作」。
#    真机对照：首轮交付页的 data-* 里没有 data-action / data-entity，
#    第二轮补齐了。
#
# ## 做法
#
# 不是新发明一套对照，**第 4 步的产物里本来就带着这条映射**：
# `DerivedPage.sourcePageId`（"这一页由哪份 HTML 推出来的，不是模型编的"），
# 而且 `html_structure.check_page_coverage` 已经把它钉成双向全覆盖——
# 喂进去的每一页都必须有条目、不许凭空多一个。也就是说
# `sourcePageId → id` 是一条**已经被校验过的双射**，拿来即用。
#
# 口径同 Terraform 的 `moved` 块：改名不是让下游各自去猜，而是把「旧地址→新
# 地址」显式声明在一个地方、在下游动手之前应用掉，并且在 plan 阶段就校验。
# 这里对应的是 `assert_pages_match_model` 那条不变式。
#
# ⚠ 精修轮这条映射恒为空（第 2 步 freeze 已经让 SPEC id == 上一版模型 id，
#   第 4 步的 freeze 又把结构拨了回去，于是 sourcePageId == id）。也就是说
#   这一整段在精修轮是 no-op——它只治首轮。


def canonical_page_id_map(structure: Any) -> Dict[str, str]:
    """草稿 id → 模型 id。取自第 4 步 `DerivedPage.sourcePageId → id`。

    只收**真的改了名**的那些；一个都没改就返回空表（精修轮的常态）。
    同一个 sourcePageId 出现两次（结构畸形）时整条放弃——宁可维持现状，
    也不要按一半的映射改键，那会把页面包改成半新半旧。
    """
    pages = []
    if isinstance(structure, dict):
        pages = [p for p in (structure.get("pages") or []) if isinstance(p, dict)]
    if not pages:
        return {}
    mapping: Dict[str, str] = {}
    for page in pages:
        src = str(page.get("sourcePageId") or "").strip()
        new = str(page.get("id") or "").strip()
        if not src or not new or src == new:
            continue
        if src in mapping:
            return {}  # 一对多 = 结构畸形，不动
        mapping[src] = new
    if len(set(mapping.values())) != len(mapping):
        return {}  # 多对一，同上
    return mapping


def rekey_page_map(value: Any, mapping: Dict[str, str]) -> Any:
    """把 `{pageId: X}` 这种**以页面 id 作键**的表换成新键。非 dict 原样返回。"""
    if not mapping or not isinstance(value, dict):
        return value
    return {mapping.get(str(k), k): v for k, v in value.items()}


def rekey_page_ids(value: Any, mapping: Dict[str, str]) -> Any:
    """把一串页面 id 换成新 id。非 list 原样返回。"""
    if not mapping or not isinstance(value, list):
        return value
    return [mapping.get(str(v), v) if isinstance(v, str) else v for v in value]


def rekey_page_refs(value: Any, mapping: Dict[str, str]) -> Any:
    """把嵌套结构里 id/pageRef/pageId 这类**引用**换成新 id（navItems / spec）。"""
    if not mapping:
        return value
    return _rewrite_refs(value, mapping)


def pages_match_model(pages: Any, model: Any) -> Tuple[bool, List[str], List[str]]:
    """页面包的键与模型的页面 id 对得上吗。返回 (对得上, 只有页面包有, 只有模型有)。

    ⚠ 这条不变式全仓**从来没有人校验过**，而它一旦不成立，坏的东西全是静默的：
      照搬集为空（全量重写）、bind 的流程判定恒 False、按 landingPageRef 取页
      取不到。没有一处会报错，判据也全绿。所以补这一条，宁可吵。

    只报不拦（纪律七）：交付链路上发现错位时，端出去仍然好过整轮作废——
    错位的表现是"下一轮多花 40 秒重画"，作废的表现是"这一轮白跑"。
    """
    keys = set((pages or {}).keys()) if isinstance(pages, dict) else set()
    mids = set()
    if isinstance(model, dict):
        mids = {
            str(p.get("id"))
            for p in ((model.get("page") or {}).get("pages") or [])
            if isinstance(p, dict) and p.get("id")
        }
    if not keys or not mids:
        return True, [], []  # 没得比就不报——空页面包另有闸管
    return keys == mids, sorted(keys - mids), sorted(mids - keys)
