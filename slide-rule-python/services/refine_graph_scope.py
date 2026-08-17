# -*- coding: utf-8 -*-
"""精修作用域的**影子对照**：图闭包挑页 vs 文本挑页（2026-08-17，纯影子）。

## 病灶

`refine_page_scope` 只按**页面清单的文字**判作用域——LLM 看到的是"页面名 +
用途"，看不到数据模型 / 权限 / 工作流。于是"把审批人从店长改成店员"这类
指令，文本判定只会点到某一页，而它真正牵扯的是 `wf:approve → role` 那条边
以及所有声明了相关权限的页面。**影响面这层知识在 `app_graph` 上，文本判定
够不着。**

## 为什么先影子、不直接切主路径

按需重画（refine_page_scope）2026-08-17 刚上线，真机才跑了几轮。直接把
作用域判定换成图闭包，等于把两个变量混在一起改——出了问题分不清是图挑错
了种子，还是闭包半径划错了。所以先**并排跑**：主路径照旧按文本挑页，影子
按图算一遍，只打一行对照日志，攒够真机样本再决定切不切。

    [refine_graph_scope] 影子对照：种子=… 图闭包页=… 图段=… 文本挑页=… 交集=…

## 三条纪律（跟 refine_page_scope 同源，见其模块头）

1. **判作用域这一步绝不产内容**——逐字对应 Aider ContextPrompts 的
   `NEVER RETURN CODE!`。LLM 只挑**种子节点**，扩散交给 `impacted_closure`
   确定性地算，不让模型自由发挥"影响面"。
2. **宁窄勿宽**：种子挑多了，闭包会把半张图卷进来，对照就没有信息量。
3. **纯影子 = 结构上碰不到主路径**：本模块没有任何返回值被接回
   `_scope` / `_reuse_now`（判据钉在 tests/test_refine_graph_scope.py 的
   接线组里）。fail 的方向是纪律七的增强类：**任何失败只打日志，绝不外抛**。

## 开关

`SLIDERULE_GRAPH_SCOPE_SHADOW=0` 整个关掉（缺省开）。影子自己要花一次
LLM 调用（3~5 秒），线上想省这笔钱、或者影子日志刷屏时一键关。

## ⚠ 故意不进左侧进度线

不包 `_stage()`：`test_enrich_stage_visibility` 的全等判据会把没进
`_ENRICH_STAGE_LABELS` 表的埋点当场咬红；而进表意味着"决定让用户看见"——
影子对用户没有任何可感知的产出，报出去只会让进度线多一格看不懂的东西。
哪天影子转正（真的拿图闭包定作用域了），再按 test_enrich_stage_visibility
的正反两半把 stage 一起加上。
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

_SYSTEM = (
    "你在判断一条修改要求会**直接**牵动一个应用里的哪几个构件（页面/角色/"
    "权限/字段/流程节点/数据实体/AIGC能力）。"
    "只输出一个 JSON 对象，不要解释、不要 markdown 围栏。"
)

#: 判作用域这一步**绝不产内容**。逐字对应 Aider ContextPrompts 的
#: `system_reminder = "NEVER RETURN CODE!"`——同 refine_page_scope 那份。
_NEVER_GENERATE = "**不要输出任何 HTML、页面内容或模型内容**，这一步只挑节点。"

_KIND_CN = {
    "entity": "数据实体",
    "field": "字段",
    "role": "角色",
    "perm": "权限",
    "page": "页面",
    "wf": "流程节点",
    "aigc": "AIGC能力",
}


def graph_scope_shadow_enabled() -> bool:
    """开关：`SLIDERULE_GRAPH_SCOPE_SHADOW=0` 关掉影子对照，缺省开。

    写法对齐 `SLIDERULE_REFINE_ID_FREEZE` 那个开关：0/false/no/off 都算关。
    """
    return str(
        os.environ.get("SLIDERULE_GRAPH_SCOPE_SHADOW", "1")
    ).strip().lower() not in ("0", "false", "no", "off")


def build_seed_prompt(instruction: str, graph: Dict[str, Any]) -> List[Dict[str, str]]:
    """装配挑种子的对话。graph 是 `build_app_graph` 的产物。

    节点 id **带 kind 前缀**原样列出（`page:p1` / `role:mgr`…）——让模型
    照抄，不让它裸造 id（裸 id 在图上对不上，会被 parse_seeds 丢掉）。
    """
    nodes = graph.get("nodes") or {}
    lines = []
    for nid in sorted(nodes):
        meta = nodes[nid] if isinstance(nodes[nid], dict) else {}
        kind_cn = _KIND_CN.get(str(meta.get("kind")), str(meta.get("kind")))
        lines.append(f"- {nid}：{kind_cn}「{meta.get('name')}」")
    listing = "\n".join(lines)
    body = f"""这个应用的构件清单（节点 id：类型「名字」）：

{listing}

用户提出的修改要求是：

{instruction.strip()[:2000]}

请挑出这条要求**直接点到**的构件节点（种子）。间接被牵连的不用你算——
后续会沿引用关系确定性地扩散。

{_NEVER_GENERATE}

输出这个形状：

{{"seeds": ["<节点id>", "..."], "why": "<一句话说清为什么是这几个>"}}

硬性要求：

1. 节点 id **必须从上面的清单里原样照抄**（带前缀），不许新造、不许改写。
2. **宁窄勿宽**：只挑要求直接点名或直接修改的构件，
   不要挑"跟这件事有关但不用动"的。挑多了扩散会把半个应用卷进来。
3. 要求明确指名了某个东西（"XX 那一页…"、"把审批人改成…"），
   就只挑对应的那几个节点。
"""
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": body},
    ]


def parse_seeds(payload: Any, graph: Dict[str, Any]) -> Optional[List[str]]:
    """把 LLM 的回答收成一份**只含图上真有的节点 id** 的清单。判不出来回 None。

    ⚠ 图外 id 直接丢掉，不做模糊匹配——同 refine_page_scope.parse_scope：
      模糊匹配一旦对错人，闭包就从错误的种子扩散，而日志里长得跟正常一模一样。
    """
    if not isinstance(payload, dict):
        return None
    raw = payload.get("seeds")
    if not isinstance(raw, list):
        return None
    known = set(graph.get("nodes") or {})
    got = [str(x).strip() for x in raw if str(x).strip()]
    picked = [x for x in got if x in known]
    dropped = [x for x in got if x not in known]
    if dropped:
        print(f"[refine_graph_scope] ⚠ 模型报了图外的节点 id，已丢弃：{dropped}")
    return picked


def compare_graph_scope_shadow(
    instruction: str,
    reuse_model: Optional[Dict[str, Any]],
    text_scope: Optional[List[str]],
    pages: List[Dict[str, Any]],
    *,
    llm_json_fn=None,
    hops: int = 2,
) -> Optional[Dict[str, Any]]:
    """影子对照的唯一入口：建图 → LLM 挑种子 → 闭包 → 翻回页/段 → 打一行日志。

    返回对照结果 `{seeds, graphPages, graphSegments, textPages, overlapPages,
    declaredPages}` **只供判据和日志用**——调用方（spec_first_pipeline 第 2.85
    步）不许把它接回 `_scope` / `_reuse_now`，接线判据盯着这一条。

    ⚠ fail-open：这里的任何失败（建图 / LLM / 解析）都只打一行 ⚠ 日志然后
      回 None，**绝不外抛**——影子炸了拖垮主链路，是纪律七里最不该犯的那种。
    """
    if not graph_scope_shadow_enabled():
        return None
    try:
        if not (instruction or "").strip():
            return None
        if not isinstance(reuse_model, dict) or not reuse_model:
            # 精修轮却没有上一版模型：建不出图，影子无事可做。主路径那边
            # 已经有自己的"⚠ 精修轮但…"日志，这里不再重复刷屏。
            return None

        from .app_graph import build_app_graph, impacted_closure, segments_touched

        graph = build_app_graph(reuse_model)
        nodes = graph.get("nodes") or {}
        if not nodes:
            print("[refine_graph_scope] ⚠ 上一版模型建不出图（零节点），影子对照跳过")
            return None

        from .spec_llm_call import call_spec_json

        outcome = call_spec_json(
            build_seed_prompt(instruction, graph), llm_json_fn, stage="specfirst.graphscope"
        )
        seeds = parse_seeds(outcome.payload, graph)
        if not seeds:
            print(
                "[refine_graph_scope] ⚠ 影子挑种子没给出可用节点，本轮不对照："
                f"{outcome.failure or '空清单/答非所问'}"
            )
            return None

        closure = impacted_closure(graph, seeds, hops=hops)
        graph_pages = sorted(
            nid.split(":", 1)[1]
            for nid in closure
            if isinstance(nodes.get(nid), dict) and nodes[nid].get("kind") == "page"
        )
        graph_segments = sorted(segments_touched(graph, closure))
        text_pages = sorted(str(x) for x in text_scope) if isinstance(text_scope, list) else None
        overlap = sorted(set(graph_pages) & set(text_pages or []))
        print(
            "[refine_graph_scope] 影子对照："
            f"种子={','.join(seeds)} "
            f"图闭包页={','.join(graph_pages) or '(无)'} "
            f"图段={','.join(graph_segments) or '(无)'} "
            f"文本挑页={','.join(text_pages) if text_pages is not None else '(全量)'} "
            f"交集={','.join(overlap) or '(无)'}"
        )
        return {
            "seeds": seeds,
            "graphPages": graph_pages,
            "graphSegments": graph_segments,
            "textPages": text_pages,
            "overlapPages": overlap,
            "declaredPages": [
                str(p.get("id")) for p in (pages or []) if isinstance(p, dict) and p.get("id")
            ],
        }
    except Exception as exc:  # noqa: BLE001 — 影子炸了不许拖垮主链路
        print(f"[refine_graph_scope] ⚠ 影子对照失败（fail-open，不影响主链路）：{str(exc)[:200]}")
        return None
