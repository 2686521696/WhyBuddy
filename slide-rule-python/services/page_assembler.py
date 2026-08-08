"""页面装配 —— 五阶段：意图 → 范式 → 区块 → 实例 → Gate。

## 这个模块是来替换什么的

此前的 block_assembler.assemble_base_screen 把 137 个基础组件的清单丢给模型，
让它"选几个排出来"。实测产物（2026-08-08 用户拿截图指出来的）：

    Menu 一张大卡 / Input 一张卡 / Button 一张卡 / Table 一张卡 /
    Pagination 又单独一张卡；表格内容「甲 乙 12 34」；
    Input 里是「基本用法 / 带前缀 / 密码 / 多行文本」；
    Button 里是「主按钮 / 次按钮 / 虚线 / 危险」

**那是 Ant Design 组件示例合集换了个标题，不是库存管理系统。**

用户的诊断一针见血：根因不是模型不会排版，是装配目标错了。我给它的任务
实际上是"从组件库选几个组件并排列"，它确实完成了。

三条具体的错，逐条对应本模块的设计：

  ① **AI 在复用组件示例，不是组件能力。**
     Definition / Demo / Instance 是三样东西，模型只能引用 Definition、
     产出 Instance，绝不能复制 Demo。所以这里给模型的清单**不含任何 demo
     内容**，只有 type / 能干什么 / 要绑什么。产出必须是带真实业务字段的
     实例（props.title 是"商品名称"而不是"基本用法"）。
  ② **组件粒度太低。** 模型不该操作 Input / Button / Pagination，该操作
     业务区块（数据表格 / 筛选条 / 记录表单）。区块内部自己解析基础组件。
     所以这里的候选集是 14 个业务区块，**基础组件一个都不出现**。
  ③ **没有空间关系。** Pagination 变成独立大卡，是因为系统只知道它是个
     组件，不知道它属于 Table 的页脚。这里靠"区域"表达：区块落进区域，
     区域有权重和容量，分页这类东西根本不是区块——它在 DataTable 内部。

## 为什么组件是最后一步

    意图 → 页面范式 → 业务区域 → 区块 → 组件实例

模型只走到"区块"这一层就停。基础组件由区块自己解析（DataTable 内部用
antd Table，FilterBar 内部用 QueryFilter），模型从头到尾不会命名一个组件。
这不是限制模型，是让它在正确的抽象层上工作。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from services import schema_legal as L
from services.page_archetypes import PAGE_ARCHETYPES, archetype_prompt_block


def _block_menu() -> List[Dict[str, Any]]:
    """给模型看的区块清单 —— **不含任何 demo 内容**。

    只有：叫什么、能干什么（capability）、干什么用（description）、
    要绑什么（bindingSchema）。模型据此产出实例，而不是照抄示例。
    """
    out = []
    for b in L.EXPERIENCE_BLOCKS:
        if not b.get("generationEnabled"):
            continue
        cap = b.get("capability")
        if cap in ("container", "freeform"):
            continue  # 容器与自由版式不参与选型，它们由别的机制决定
        bs = b.get("bindingSchema") or {}
        out.append({
            "type": str(b["type"]),
            "capability": cap,
            "does": b.get("description", ""),
            "needs": list(bs.get("required", [])),
            "optional": list(bs.get("optional", [])),
        })
    return out


def _prompt(
    intent: str, datamodel: Dict[str, Any], blocks: List[Dict[str, Any]]
) -> List[Dict[str, str]]:
    entities = datamodel.get("entities") or []
    entity_lines = [
        f"- {e.get('id')} ({e.get('name') or e.get('id')}): "
        + ", ".join(f"{f.get('id')}[{f.get('type')}]{f.get('name') or ''}" for f in (e.get("fields") or []))
        for e in entities
    ]

    system = (
        "You design ONE business page. You work top-down: first what the user is here to "
        "DO, then which page archetype that is, then which region gets which block. "
        "You never name a UI component — blocks resolve their own components. "
        "A page that reads as a collection of component samples is a failure, no matter "
        "how many blocks it has."
    )
    user = (
        f"WHAT THIS PAGE IS FOR: {intent}\n\n"
        "DATA MODEL (the only entities and fields that exist):\n"
        + "\n".join(entity_lines)
        + "\n\n"
        + archetype_prompt_block()
        + "\n\nAVAILABLE BLOCKS (choose by capability, not by name):\n"
        + json.dumps(blocks, ensure_ascii=False, indent=1)
        + "\n\nRULES\n"
        "1. Start from the user's tasks on this page. Write them into \"tasks\" — 3 to 6 "
        "short Chinese phrases, verbs (查库存 / 筛选 / 新增商品 / 补货). If you cannot "
        "name the tasks, you do not understand the page and the layout will be wrong.\n"
        "2. Pick ONE archetype whose 'when' matches those tasks.\n"
        "3. Fill its regions. Every required region needs at least one block; respect "
        "maxBlocks; a block may only go in a region whose 'accepts' contains its capability.\n"
        "4. Every props.title must be a phrase from THIS business — what the user calls "
        "this thing (商品库存 / 待补货商品). Never a component name, never a demo label "
        "like 基本用法 or 主按钮.\n"
        "5. Every entityRef must be an entity id above; every field ref a field of THAT "
        "entity. Never invent one.\n"
        "6. Exactly one region carries the page's real work. Do not spread everything "
        "evenly — that is how a page turns into a row of equal cards.\n"
        "7. A result screen must say whether the thing worked and where to go next. "
        "Always set props.status (success / error / info / warning / 403 / 404 / 500) — "
        "the icon is how the user reads success or failure at a glance, and a success "
        "page with a neutral icon looks like a warning. Always give at least one action "
        "(primaryAction, optionally secondaryAction: 返回列表 / 查看单据 / 返回修改) — "
        "there is no content after a result screen, so with no button the user is "
        "stranded.\n\n"
        "Return JSON only:\n"
        '{"name":"<页面中文名>","industry":"<行业,2-6字>","archetype":"list",'
        '"tasks":["查库存","新增商品"],'
        '"regions":{"main":[{"type":"DataTable","props":{"title":"商品库存"},'
        '"binding":{"entityRef":"product"}}],"overlay":[...]}}'
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# ── Gate ────────────────────────────────────────────────────────────────
#
# 用户列的那批规则，逐条实现。要点是**用规则判，不再让一个聪明模型凭感觉判**
# ——这些错都有明确特征，规则一查一个准，而且能给出"哪里错了"让下一轮修。

DEMO_WORDS = (
    "基本用法", "主按钮", "次按钮", "带前缀", "多行文本", "选项一", "选项二",
    "第一项", "第二项", "示例", "demo", "Demo", "占位", "标签一", "标签二",
)


def gate(page: Dict[str, Any], datamodel: Dict[str, Any]) -> List[Dict[str, str]]:
    """产品设计常识检查。返回 findings，空 = 通过。

    不通过就该打回重生成，而不是直接展示——用户看到的那张「库存管理」页
    只要有这道 Gate，一条都过不了。
    """
    findings: List[Dict[str, str]] = []
    arch_key = str(page.get("archetype") or "")
    arch = PAGE_ARCHETYPES.get(arch_key)
    if arch is None:
        return [{"code": "bad-archetype", "why": f"范式 '{arch_key}' 不在语法里"}]

    regions = page.get("regions") or {}
    by_type = {str(b["type"]): b for b in L.EXPERIENCE_BLOCKS}
    legal_regions = {r["key"]: r for r in arch["regions"]}

    # ① 必填区域不能空 —— 列表管理页没有列表，它就不是列表管理页
    for r in arch["regions"]:
        if r["required"] and not (regions.get(r["key"]) or []):
            findings.append({
                "code": "missing-required-region",
                "why": f"{arch['label']}的「{r['label']}」是必须的，现在是空的",
            })

    # ② 区块不能落进不收它的区域（空间关系）
    for rkey, items in regions.items():
        r = legal_regions.get(rkey)
        if r is None:
            findings.append({"code": "unknown-region", "why": f"{arch_key} 没有「{rkey}」这个区域"})
            continue
        if len(items or []) > r["maxBlocks"]:
            findings.append({
                "code": "region-overflow",
                "why": f"「{r['label']}」最多 {r['maxBlocks']} 个区块，给了 {len(items)} 个",
            })
        for it in items or []:
            t = str((it or {}).get("type") or "")
            entry = by_type.get(t)
            if entry is None:
                findings.append({"code": "unknown-block", "why": f"「{t}」不在区块目录里"})
                continue
            cap = entry.get("capability")
            if cap not in r["accepts"]:
                findings.append({
                    "code": "capability-mismatch",
                    "why": f"「{r['label']}」收 {r['accepts']}，{t} 是 {cap}",
                })

    # ③ 必须有 primary 区域被填上 —— 没有主次就是一排等大卡片。
    #
    # 看板/日历除外：它们的主体是**页面自带的视图**（按状态分列的棋盘、月历），
    # 不是任何区块，所以范式上根本没有 primary 区域。这与运行时一致
    # （AppRuntimeScreen 为这两类页渲染自己的视图，区块围着它摆）。不豁免的话
    # 这条规则会要求一个不存在的东西，模型每次都被打回。
    filled_primary = [
        r["key"] for r in arch["regions"]
        if r["weight"] == "primary" and (regions.get(r["key"]) or [])
    ]
    if not filled_primary and not arch.get("pageOwnsMain"):
        findings.append({
            "code": "no-primary",
            "why": "没有任何主区域被填上——这一页看不出用户是来干什么的",
        })

    # ④ 标题不能是 demo 文案。这条直接对应用户指出的
    #    「Button Demo 中出现多个互斥样式示例」「Input 出现密码、多行文本」
    for rkey, items in regions.items():
        for it in items or []:
            title = str(((it or {}).get("props") or {}).get("title") or "")
            if any(w in title for w in DEMO_WORDS):
                findings.append({
                    "code": "demo-content",
                    "why": f"「{title}」是组件示例文案，不是这摊业务里的说法",
                })

    # ⑤ 绑定必须落在真实实体与字段上 —— 「页面标题为库存管理，数据内容却为
    #    甲/乙/12/34」的根子就在这
    ents = {
        str(e.get("id")): {str(f.get("id")) for f in (e.get("fields") or [])}
        for e in (datamodel.get("entities") or [])
    }
    for rkey, items in regions.items():
        for it in items or []:
            b = (it or {}).get("binding") or {}
            ref = str(b.get("entityRef") or "")
            t = str((it or {}).get("type") or "")
            entry = by_type.get(t)
            needs = list(((entry or {}).get("bindingSchema") or {}).get("required", []))
            if "entityRef" in needs and ref not in ents:
                findings.append({
                    "code": "dangling-entity",
                    "why": f"{t} 绑了不存在的实体「{ref or '(空)'}」",
                })
                continue
            for f in b.get("fieldRefs") or []:
                if ref in ents and str(f) not in ents[ref]:
                    findings.append({
                        "code": "dangling-field",
                        "why": f"{t} 绑了 {ref} 没有的字段「{f}」",
                    })

    # ⑥ 结果屏必须说清"成了没有"和"接下来去哪"
    #
    # 2026-08-08 实测：模型给 ResultPanel 只填了 title「入库单提交成功」，
    # 既没有 status 也没有任何按钮。后果是实打实的：
    #
    #   没 status → 渲染器退到 info，一张**成功**的页面顶着蓝色感叹号。
    #               图标是用户扫一眼判断成败的东西，中性图标等于把成功和
    #               出错画成一个样。
    #   没按钮   → 用户被困在这一页。结果屏本来就是死胡同（后面没有内容了），
    #               不给出口就只能按浏览器返回。
    #
    # pro-blocks 那 7 页无一例外都有 status 和 extra（返回列表/查看项目/打印、
    # 返回修改、Back Home）。所以这两条不是苛刻，是这类页面的定义。
    for rkey, items in regions.items():
        for it in items or []:
            t = str((it or {}).get("type") or "")
            entry = by_type.get(t)
            if not entry or entry.get("capability") != "outcome":
                continue
            props = (it or {}).get("props") or {}
            allowed = (
                ((entry.get("propsSchema") or {}).get("properties") or {})
                .get("status", {})
                .get("enum")
                or []
            )
            if str(props.get("status") or "") not in allowed:
                findings.append({
                    "code": "result-no-status",
                    "why": f"{t} 没给 status（可选 {allowed}）——"
                           "成功页会顶着中性图标，用户看不出成没成",
                })
            if not str(props.get("primaryAction") or "").strip() and not str(
                props.get("secondaryAction") or ""
            ).strip():
                findings.append({
                    "code": "result-no-exit",
                    "why": f"{t} 一个按钮都没有——结果页是死胡同，"
                           "不给「接下来去哪」用户只能按浏览器返回",
                })

    # ⑦ 得说得出用户在这一页干什么
    tasks = [str(t).strip() for t in (page.get("tasks") or []) if str(t).strip()]
    if len(tasks) < 2:
        findings.append({
            "code": "no-tasks",
            "why": "说不出用户在这一页要完成哪些任务——那这一页的结构就是猜的",
        })
    return findings


def assemble_page(intent: str, datamodel: Dict[str, Any], max_retries: int = 1) -> Dict[str, Any]:
    """五阶段装配。Gate 不过就把 findings 回喂给模型重来一次。

    重试只给一次：Gate 的 findings 是具体的（"「筛选区」收 filter，DataTable
    是 entityRows"），改不对多半是理解偏了，再多轮也只是烧钱。**不通过就如实
    返回失败与原因**，不降级展示一个坏页面——用户看到坏页面时怪的是产品。
    """
    from sliderule_llm.client import LlmError, call_llm_json_with_shape

    blocks = _block_menu()
    messages = _prompt(intent, datamodel, blocks)
    last_findings: List[Dict[str, str]] = []

    for attempt in range(max_retries + 1):
        try:
            parsed, _ = call_llm_json_with_shape(
                messages, required_keys=("regions",), max_shape_retries=1
            )
        except LlmError as exc:
            return {"ok": False, "error": f"模型没能给出可用的装配：{str(exc)[:160]}"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"装配失败：{str(exc)[:160]}"}

        findings = gate(parsed, datamodel)
        if not findings:
            return {
                "ok": True,
                "name": str(parsed.get("name") or "").strip() or "装配页面",
                "industry": str(parsed.get("industry") or "").strip()[:12] or "通用",
                "archetype": parsed.get("archetype"),
                "tasks": parsed.get("tasks") or [],
                "regions": parsed.get("regions") or {},
                "gatePassed": True,
                "attempts": attempt + 1,
            }
        last_findings = findings
        if attempt < max_retries:
            # 把 findings 原样回喂。说清楚"哪条规则、错在哪"，比让它自己猜有效。
            messages = messages + [
                {"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)},
                {
                    "role": "user",
                    "content": "这一版没过检查，逐条修掉再给一版完整 JSON：\n"
                    + "\n".join(f"- [{f['code']}] {f['why']}" for f in findings),
                },
            ]

    return {
        "ok": False,
        "error": "装配结果没通过页面检查",
        "findings": last_findings,
        "attempts": max_retries + 1,
    }
