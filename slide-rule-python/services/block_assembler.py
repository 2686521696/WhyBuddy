"""按需组装：让大模型现场从区块目录里挑积木、排槽位、绑字段，拼出一页。

## 这个模块解决什么

2026-08-07 用户的原话：「顶部有个按钮……你点了之后，AI 大模型会自动给你组队，
按需组团，从不同的组件进行拼装，出来一个完整的页面，里面既有 filter 筛选、
还有表格、还有新增表单……点了之后就真的可以进行录入数据了。」

在这之前我做的是**静态预设**——10 套手写在 JSON 里的固定组合。那是错的形状：
组合是死的，每次都一样，而且没经过任何"这套到底能不能用"的检验（实测里三套
工作台预设推荐的 DataTable 会被渲染层直接丢掉，因为它绑的是本页主实体）。

这里换成**现场组装**：目录是活的（组件库显示什么，模型就从什么里面挑），
组装结果是一份自洽的页面规格，前端拿它挂真渲染器 + 真运行时状态，能真录数据。

## 为什么组装完还要自己再验一遍

模型会犯三类错，而且都不会自己报错：

  ① 挑了目录里没有的积木类型（幻觉）
  ② 把积木放进它不允许的槽位（按语义直觉猜，实测最稳定的一类错）
  ③ 绑了数据模型里不存在的实体或字段

这三类在真实推演里由 v5_model_gate 拦。这条路径不走完整推演，所以在这里
按同一份账本（schema_legal 的 allowedSlots / bindingSchema）复验一遍——
**不合格的积木直接剔除，而不是整页失败**：拼出 3 个积木里有 1 个不合格时，
把那 1 个丢掉仍然是一个能用的页面，整页报错则什么都没有。

剔除必须**如实告诉调用方**（dropped 里带原因），否则就是静默降级：用户以为
模型只拼了 2 个，实际是拼了 3 个被我们吃掉 1 个。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from services import schema_legal as L

#: 一页最多几个积木。上限不是性能考虑，是版面：桌面网格 12 列，超过 5 个
#: 积木必然有人被挤进 4/12 窄列或者掉到第三屏，那时"拼得合理"就无从谈起。
MAX_BLOCKS = 5


def _catalog_for_prompt(page_kind: str, allowed_types: List[str]) -> List[Dict[str, Any]]:
    """把可选积木压成给模型看的最小面：类型 + 干什么 + 能放哪 + 要绑什么。

    只给这一页真正可选的（页面形态过滤 + 调用方传来的可见集合求交），
    模型就不必先自己排除一遍——**能选的都摆出来，不能选的一个都不摆**。
    """
    out: List[Dict[str, Any]] = []
    for b in L.EXPERIENCE_BLOCKS:
        t = str(b["type"])
        if not b.get("generationEnabled"):
            continue
        if page_kind not in b.get("pageKinds", []):
            continue
        if allowed_types and t not in allowed_types:
            continue
        bs = b.get("bindingSchema") or {}
        out.append({
            "type": t,
            "does": b.get("description", ""),
            "slots": list(b.get("allowedSlots", [])),
            "bindingRequired": list(bs.get("required", [])),
            "bindingOptional": list(bs.get("optional", [])),
            "props": sorted((b.get("propsSchema") or {}).get("properties", {})),
        })
    return out


def _prompt(page_kind: str, catalog: List[Dict[str, Any]], datamodel: Dict[str, Any]) -> List[Dict[str, str]]:
    entities = datamodel.get("entities") or []
    entity_lines = []
    for e in entities:
        fields = ", ".join(
            f"{f.get('id')}({f.get('type')})" for f in (e.get("fields") or [])
        )
        entity_lines.append(f"- {e.get('id')}: {fields}")

    system = (
        "You assemble ONE working business page out of a closed set of UI blocks. "
        "You are not designing new components — every block already exists and renders. "
        "Your job is picking which ones this page needs, where each goes, and what data "
        "each is bound to."
    )
    user = (
        f"PAGE KIND: {page_kind}\n\n"
        f"DATA MODEL (the only entities and fields that exist):\n"
        + "\n".join(entity_lines)
        + "\n\nAVAILABLE BLOCKS:\n"
        + json.dumps(catalog, ensure_ascii=False, indent=1)
        + "\n\nSLOT WIDTHS (this is the only physical difference between slots):\n"
        "  summary  — full width strip at the top, for scanning; too short for a table or a form\n"
        "  primary  — full width main area\n"
        "  secondary / activity / content — the narrow right column (4 of 12)\n"
        "A table, a form, or a horizontal step bar in the narrow column is unusable. "
        "Put those in primary.\n\n"
        "RULES\n"
        f"1. Between 2 and {MAX_BLOCKS} blocks. A page with one block is not a page; "
        "more than that and they start squeezing each other.\n"
        "2. Every block type MUST come from AVAILABLE BLOCKS, every slot from that "
        "block's own 'slots' list.\n"
        "3. Every entityRef MUST be an entity id above; every field ref MUST be a field "
        "of THAT entity. Never invent one.\n"
        "4. Give each block a Chinese props.title that says what it is FOR in this "
        "business — not the block's type name.\n"
        "5. Compose something a real user could work in: usually a way to narrow down, "
        "a way to see the records, and a way to add one.\n"
        "6. Blocks are NOT wrapped in a card for you. Each one renders as exactly what it "
        "is — its own title and actions come with the block, not with a frame around it. "
        "If — and only if — two or three blocks belong to the same thing and should read "
        "as one panel, add a ContentCard and list their ids in its \"children\". "
        "Wrapping everything in cards is worse than wrapping nothing: it buries the page "
        "in boxes. Most pages need no ContentCard at all.\n"
        "7. props.surface controls whether a block paints its own white panel. Leave it "
        "out (default \"card\") for a block standing on its own. Set \"plain\" for a "
        "block you put INSIDE a ContentCard — the card already provides the surface, and "
        "a panel inside a panel reads as a mistake.\n\n"
        "Return JSON only. Give every block an \"id\" so a container can refer to it:\n"
        '{"name":"<页面中文名>","blocks":['
        '{"id":"b1","type":"...","slot":"...","props":{"title":"..."},'
        '"binding":{"entityRef":"...","fieldRefs":["..."]}},'
        '{"id":"b2","type":"ContentCard","slot":"secondary",'
        '"props":{"title":"..."},"children":["b3"]}]}'
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _validate(
    page_kind: str, raw_blocks: Any, datamodel: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """按同一份账本复验，逐个剔除不合格的，并如实记下原因。"""
    by_type = {str(b["type"]): b for b in L.EXPERIENCE_BLOCKS}
    entities = {
        str(e.get("id")): {str(f.get("id")) for f in (e.get("fields") or [])}
        for e in (datamodel.get("entities") or [])
    }
    kept: List[Dict[str, Any]] = []
    dropped: List[Dict[str, str]] = []

    for i, raw in enumerate(raw_blocks if isinstance(raw_blocks, list) else []):
        if not isinstance(raw, dict):
            dropped.append({"block": f"#{i}", "why": "不是对象"})
            continue
        t = str(raw.get("type") or "").strip()
        slot = str(raw.get("slot") or "").strip()
        entry = by_type.get(t)
        if entry is None or not entry.get("generationEnabled"):
            dropped.append({"block": t or f"#{i}", "why": "不在目录里（模型编的）"})
            continue
        if page_kind not in entry.get("pageKinds", []):
            dropped.append({"block": t, "why": f"这种积木不能放在 {page_kind} 页"})
            continue
        if slot not in entry.get("allowedSlots", []):
            dropped.append({"block": t, "why": f"槽位 {slot or '(空)'} 不在它的允许列表里"})
            continue

        binding = raw.get("binding") if isinstance(raw.get("binding"), dict) else {}
        bs = entry.get("bindingSchema") or {}
        needs_binding = bool(bs.get("required")) or bool(bs.get("optional"))
        if not needs_binding:
            binding = {}
        else:
            ref = str(binding.get("entityRef") or "").strip()
            if "entityRef" in bs.get("required", []) and ref not in entities:
                dropped.append({"block": t, "why": f"绑了不存在的实体 {ref or '(空)'}"})
                continue
            # 字段引用逐个核，**留下核得过的，而不是整个丢掉**：模型多写一个
            # 字段名不该让这个积木整个消失。
            fields = binding.get("fieldRefs")
            if isinstance(fields, list):
                legal = entities.get(ref, set())
                good = [str(f) for f in fields if str(f) in legal]
                if good:
                    binding = {**binding, "fieldRefs": good}
                else:
                    binding = {k: v for k, v in binding.items() if k != "fieldRefs"}

        props = raw.get("props") if isinstance(raw.get("props"), dict) else {}
        allowed_props = set((entry.get("propsSchema") or {}).get("properties", {}))
        props = {k: v for k, v in props.items() if k in allowed_props}

        # children **只有容器能有**。这不是洁癖：渲染侧多数积木把 children
        # 当成"遗留适配内容"直接原样返回（block-registry 里每个渲染器开头那句
        # `if (children != null) return <>{children}</>`），所以给 DataTable
        # 塞 children 会让它变成一个只显示别人、自己什么都不画的空壳——
        # 页面上看着像那个表格坏了。模型确实会这么写，所以在这里剥掉。
        raw_children = [str(c) for c in (raw.get("children") or []) if isinstance(c, str)]
        if raw_children and not entry.get("container"):
            dropped.append({
                "block": t,
                "why": "只有容器类积木能装 children，已剥掉",
            })
            raw_children = []

        kept.append({
            "id": str(raw.get("id") or f"b{i + 1}"),
            "type": t,
            "slot": slot,
            "props": props,
            "binding": binding,
            "children": raw_children,
        })

    # children 只能指向**同一批里真实留下来的** id：模型可能引用一个被剔除的
    # 积木，或者干脆编一个 id。悬空引用留着会让容器渲染成空卡片，而空卡片
    # 看起来像"这里本来该有东西但坏了"——比不放这个容器更糟。
    kept_ids = {b["id"] for b in kept}
    for b in kept:
        bad = [c for c in b["children"] if c not in kept_ids or c == b["id"]]
        if bad:
            dropped.append({
                "block": b["type"],
                "why": f"容器引用了不存在的积木 {bad}，已断开",
            })
            b["children"] = [c for c in b["children"] if c in kept_ids and c != b["id"]]

    # 被装进容器的积木不再单独占槽位——否则同一个积木会出现两次（一次在
    # 容器里，一次在网格上）。
    nested = {c for b in kept for c in b["children"]}
    for b in kept:
        if b["id"] in nested:
            b["nested"] = True
            # 装进容器的积木一律 plain：容器已经提供了表面，里面再来一层白底
            # 就是卡里套卡。模型经常忘了写，这里直接兜住——**不是覆盖它的选择**，
            # 而是这个位置根本没有第二种合理选择。
            if b["props"].get("surface") != "plain":
                b["props"]["surface"] = "plain"
    return kept, dropped


def assemble_page(
    page_kind: str,
    allowed_types: List[str],
    datamodel: Dict[str, Any],
) -> Dict[str, Any]:
    """现场组装一页。返回 {ok, name, blocks, dropped, error}。

    失败不伪造：模型挂了或一个积木都没留下，就如实报 ok=False 加原因——
    造一个假页面出来比报错更糟，用户会以为这就是模型的水平。
    """
    from sliderule_llm.client import LlmError, call_llm_json_with_shape

    catalog = _catalog_for_prompt(page_kind, allowed_types)
    if not catalog:
        return {"ok": False, "error": f"{page_kind} 页没有可用的积木"}

    try:
        parsed, _ = call_llm_json_with_shape(
            _prompt(page_kind, catalog, datamodel),
            required_keys=("blocks",),
            max_shape_retries=1,
        )
    except LlmError as exc:
        return {"ok": False, "error": f"模型没能给出可用的组装：{str(exc)[:160]}"}
    except Exception as exc:  # noqa: BLE001 — 组装失败不该把这条路由打成 500
        return {"ok": False, "error": f"组装失败：{str(exc)[:160]}"}

    kept, dropped = _validate(page_kind, parsed.get("blocks"), datamodel)
    if not kept:
        return {
            "ok": False,
            "error": "模型给出的积木一个都没通过校验",
            "dropped": dropped,
        }
    return {
        "ok": True,
        "name": str(parsed.get("name") or "").strip() or "组装页面",
        "blocks": kept[:MAX_BLOCKS],
        "dropped": dropped,
    }
