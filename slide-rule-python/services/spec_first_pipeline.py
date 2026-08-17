"""把 spec-first 七步接到推演主轴上。

## 这一步在干什么

七步（spec_tree → spec_page_html → page_shell → html_structure →
spec_semantics → model_assembly → html_bindings）此前是**七个可独立调用的
模块**，推演主轴（v5_capability_executor._try_llm_generate_evidence）仍走老路：
`generate_five_system_model(goal)` 从一句话里同时发明实体/字段/enum/页面/
权限/工作流/不变式（架构图 ⛔1）。本文件是把七步串成一条、接到那个入口上。

⚠ **不是给 GEN5 加参数，是它不在这条路上。** 新链路自己产出完整六段再过
`v5_model_gate`，所以 ⛔1 / ⛔3 那两条描述的是老链路——那条今天还在跑，
两条都还成立，只是不适用于这里。

## 开源怎么选的：查过五个，一个都不引

编排类候选逐个看过：**LangGraph / Burr / Prefect / Temporal / Dagster**，
容器里一个都没装。不引的理由不是"懒得装"，是它们解决的问题这里已经有更贴合的：

  它们给的                     仓里现成的
  ─────────────────────────    ────────────────────────────────────────
  图/状态机编排                 这条链是**线性的**，只有第 3 步一处扇出
  checkpoint / 断点续跑         run_registry：事件带单调 seq、按 SSE
                               Last-Event-ID 续播、孤儿 run 看门狗回收
  每步耗时与进度上报            enrich_timing.stage()：墙钟埋点 + sink 直接
                               喂给 SSE 慢阶段心跳
  超时/预算                     remaining_run_budget_seconds()
  重试                          call_llm_with_retry（带 transient 分级 +
                               gRPC hedging 治长尾，见第 3 步那次）

引 LangGraph 会多出**第二套编排模型**，而它的 checkpoint 跟现有事件日志各记
各的，续播语义要对齐两遍。这跟第 3 步那次拒绝 tenacity 是同一个判断：
**多一个依赖换一个更差的集成。**

真正该抄开源的地方在**各步内部**，而且已经抄了：第 3 步照 screenshot-to-code
的 create/text.py，第 5 步的权限合法性照 Apache Casbin 的 {subject, object, action}。
编排这一层没有可抄的。

## 开关：2026-08-14 起**默认开**，`SLIDERULE_SPEC_FIRST=0` 才关

原先缺省 off，照的是目录窄化（3 覆盖域 × 2 臂 × n=6，p=0.00004）和 agentic
pick（十话题 4:0）那两次"拿证据换默认开"的老规矩。

翻默认由用户拍板。手上的对照支持这个方向，但**要如实说清它有多薄**：
n=3 的一轮 A/B（experiments/visual-first/ab_spec_first.py），同一个话题——

    过闸      NEW 3/3          OLD 2/3
    findings  NEW 恒 0          OLD 有拦
    页面数    NEW 恒 5          OLD 4~6（同一句话，页数自己在飘）
    字段      NEW 声明 40 / 页面真用 38（95%）
              OLD 声明 51 / 页面真用 36（71%，15 个字段一次都没出现过）

⚠ 那条"OLD 字段多 30%"是**判据错**，不是结论：它数的是声明数，不是用到的数。
按用到的数 NEW 38 > OLD 36。这一轮里判据被返工过四次，记在这儿是为了下次
别再拿"造个数替代看一眼"当证据。

⚠ 一轮 n=3 够不上前两次翻默认的量级（那两次是 p 值和十话题）。所以这不是
"攒够了证据"，是**用户在知道证据有多薄的前提下决定的**。真正的兜底是失败
不静默：整条链挂了就抛，由 v5_capability_executor 显式回落老路并打日志——
"新链路跑通了"和"新链路挂了但老路兜住了"在日志里长得不一样。

⚠ 同时进 /ready 的 `specFirst` 探针。理由是 rank-bm25 那次的教训：
**会静默失效的功能，健康探针里必须有它的位置**——开关开着不算数，
七个模块都在才算 effective。
"""

from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Any, Callable, Dict, List, Optional

SPEC_FIRST_VERSION = "spec-first-pipeline-v1"

#: 每落地一页叫一次的出口：(page_id, html, done, total[, bound])。
#:
#: 第 5 个参数 bound（2026-08-14 晚加）：同一页会到达**不止一次**——
#: 第 3 步素颜页先到（bound=False），第 3.5 步外壳统一后重发一遍（仍 False，
#: 但菜单已经按 spec 锚定），第 6.5 步打完 data-* 孔再发（bound=True）。
#: 前端按 pageId 覆盖（useSlideRuleSession.onSpecPage 那句"同一页第二次
#: 到达——覆盖，不是追加"）。不重发的话，用户整个推演期盯着的都是
#: 各页各自发明菜单的中间态——「三个产品名、三个登录人」那个病灶
#: （page_shell.py 头注），修好了却只有落库那份能看见。
#:
#: ⚠ **ContextVar 而不是模块属性。** 这条是本仓 2026-08-06 踩出来的：
#: `last_generate_diagnostic` 当初就是模块属性，多租户下一个请求读到了另一个
#: 请求的结果。页面 HTML 串台比诊断串台严重得多——那是把 A 的界面推给 B。
#:
#: 为什么要有这个通道，而不是把 on_page 从主轴一路当参数传下来：
#: 中间隔着 v5_capability_executor._try_llm_generate_evidence，那是条**同步**
#: 函数、且被十几处调用。为一件"顺带推给前端看"的事去改所有调用方的签名不划算。
#: 同款判断见 set_capability_delta_sink / set_generate_delta_sink / set_stage_sink，
#: 驱动器那一层已经是这么接的三条流。
_page_sink_var: ContextVar[Optional[Callable[..., None]]] = ContextVar(
    "sliderule_spec_first_page_sink", default=None
)


def set_page_sink(sink: Optional[Callable[..., None]]) -> None:
    """装/卸页面出口。驱动器在流开始时装、finally 里卸。"""
    _page_sink_var.set(sink)


#: 本轮跑出来的整页 HTML，供**调用方落库**用。
#:
#: 为什么要这么一个暂存而不是从返回值里拿：主轴那一处
#: （v5_capability_executor._try_llm_generate_evidence）只回 model，它自己
#: **拿不到 state**——state 在它的调用方手里。改签名要动十几处调用点，
#: 而这件事本身只是"顺路把产物交出去"。
#:
#: ⚠ 同样是 ContextVar 不是模块属性，理由跟上面那条 sink 一样：
#: 多租户下页面串台等于把 A 的界面存进 B 的会话。
_last_pages_var: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "sliderule_spec_first_last_pages", default=None
)


def take_last_pages() -> Optional[Dict[str, Any]]:
    """取走本轮产物（取一次就清）。

    **取走**而不是"读一遍"：留在原地的话，下一轮如果新链路挂了回落老路，
    调用方会读到**上一轮的页面**当成这一轮的产出落库——那正是本仓反复
    数到的那个形状（东西看着在，其实是旧的）。
    """
    got = _last_pages_var.get()
    _last_pages_var.set(None)
    return got


def peek_last_pages() -> Optional[Dict[str, Any]]:
    """只读不清——给**同一轮里、take 之前**的顺路消费用。

    具体是 executor 往 App Store 落闭环记录那一处（应用中心的卡要带页面）：
    它跑在 run_spec_first 刚返回之后、_cache_spec_first_pages 的 take 之前。
    在那里 take 会把会话侧的落库饿死；再传一遍参数又是改十几处签名（见
    _last_pages_var 头注）。所以 peek。

    ⚠ 防串轮的责任仍然在 take 那一次：本函数**只允许**在同一请求域里、
    take 发生前调用。跨轮读到旧页面的风险由"take 清场 + run_spec_first
    只在整链跑成时写入"这两条原有纪律兜住，peek 不新增窗口。
    """
    return _last_pages_var.get()


_ENABLE_ENV = "SLIDERULE_SPEC_FIRST"
#: **默认开，显式关才关**（2026-08-14）。词表照仓里另外六处同款开关逐字一致
#: （enrich_timing / block_narrowing / intake_judge / v5_parallel_generate /
#: mailer / v5_full_driver 两处）——开关口径分叉的代价是"我明明关了它还在跑"。
_OFF_VALUES = frozenset({"0", "false", "no", "off"})

#: 七步各自的模块名。**探针与 import 共用这一份**，不手抄两遍——
#: 手抄两份必然漂移（本仓在「区块 uses 声明」「前端手抄区域词汇」上踩过两次）。
_STEP_MODULES = (
    "spec_tree",
    "spec_page_html",
    "page_shell",
    "html_structure",
    "spec_semantics",
    "model_assembly",
    "html_bindings",
)


class SpecFirstError(RuntimeError):
    """整条链失败就如实失败。

    **不回落老链路**：那样会让「新链路跑通了」和「新链路挂了但老链路兜住了」
    在外面长得一模一样，而那正是本仓今天数到第九次的失败形态
    （闸全绿但东西没了）。要回落由调用方显式决定，不在这里偷偷做。
    """


def spec_first_enabled() -> bool:
    """默认开。**没设过 = 开**，设成 0/false/no/off 才关。

    ⚠ 空串按"没设过"处理，跟 `.env` 里留一行 `SLIDERULE_SPEC_FIRST=` 是一回事。
    仓里六处同款开关都是这个口径，别在这儿自创一种。
    """
    return (os.environ.get(_ENABLE_ENV) or "").strip().lower() not in _OFF_VALUES


def spec_first_readiness() -> Dict[str, Any]:
    """给 /ready 用：它现在能不能干活。

    照 `_narrowing_readiness` 同一个思路——不暴露实现细节，只回答那一个问题。
    `effective` 的判据是**开关开着 ∧ 七个模块都导得进来**，缺一不可：
    只看开关会重演 rank-bm25 那次（开着但依赖没装，功能一声不吭地整个失效，
    而 health、日志、返回值没有任何一处看得出来）。
    """
    missing: List[str] = []
    for name in _STEP_MODULES:
        try:
            __import__(f"services.{name}")
        except Exception:  # noqa: BLE001 — 探针不许因为被探的东西坏了而炸
            missing.append(name)
    enabled = spec_first_enabled()
    return {
        "version": SPEC_FIRST_VERSION,
        "enabled": enabled,
        "modules": len(_STEP_MODULES) - len(missing),
        "missing": missing,
        "effective": bool(enabled and not missing),
    }


def _stage(name: str, **fields: Any):
    """埋点用仓里现成的那套，进度直接喂给 SSE 慢阶段心跳。"""
    from .enrich_timing import stage

    return stage(name, **fields)


def model_refine_digest(model: Optional[Dict[str, Any]]) -> str:
    """把上一版五系统模型摊成给 SPEC 步看的结构摘要（纯函数，零 LLM）。

    增量迭代时喂给 spec_tree 的 refine 段用。**是摘要不是全量 JSON**：
    SPEC 步只需要「有哪些实体/页面/角色/流程节点」来保持连续性，
    全量 JSON（几十 KB）里绝大部分是它不该管的细节（字段枚举、主题、
    绑定），塞进去只会稀释注意力——E29 老链路喂全量是因为老生成器
    直接产模型，这里产的是 SPEC，粒度对齐 SPEC。
    """
    if not isinstance(model, dict):
        return ""
    lines: List[str] = []
    entities = ((model.get("datamodel") or {}).get("entities") or [])[:20]
    if entities:
        ent_lines = []
        for e in entities:
            fields = ", ".join(
                str(f.get("name") or f.get("id") or "") for f in (e.get("fields") or [])[:12]
            )
            ent_lines.append(f"  - {e.get('name') or e.get('id')}（{fields}）")
        lines.append("实体：\n" + "\n".join(ent_lines))
    pages = ((model.get("page") or {}).get("pages") or [])[:12]
    if pages:
        lines.append("页面：" + "、".join(str(p.get("name") or p.get("id") or "") for p in pages))
    roles = (model.get("rbac") or {}).get("roles") or []
    if roles:
        lines.append("角色：" + "、".join(str(r) for r in roles[:10]))
    nodes = ((model.get("workflow") or {}).get("nodes") or [])[:12]
    if nodes:
        lines.append("流程节点：" + "、".join(str(n.get("name") or n.get("id") or "") for n in nodes))
    return "\n".join(lines)[:4000]


def model_id_lexicon(model: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """把上一版模型摊成「概念名 → id」词表，喂给第 4/5 步当"认出同一个就照抄"。

    ## 为什么需要它（2026-08-17 实测）

    精修第二轮，同一个「社区养老站长」拿到过三套 id：

        station_manager  →  role_station_manager  →  manager_role
        elder:read       →  care_order:read       →  elder_archive:read
        wo_created       →  wf_pending            →  node_pending

    **不是随机重铸，是近义漂移**：id 由概念名派生，派生规则稳定但用词不稳定。
    后果是跨轮引用全部悬空——逐段沿用四次尝试全被引用完整性闸拒绝，
    「逐段指纹 0/6」里有四段其实是这个造成的，不是内容真被重写
    （量法与数据见 experiments/refine-fingerprint/）。

    根因是 refine 上下文**只到达第 2 步**：

        grep -c refine services/html_structure.py services/spec_semantics.py
        # 都是 0

    而铸 id 的恰恰是第 4 步（实体/字段）和第 5 步（角色/流程节点）。
    第 6 步不用管——它的提示词已经写死"只能用下面这些 id，一个都不许新造"，
    词表从第 4/5 步来，上游稳了它自然稳。权限同理：形状是 `<实体id>:create`，
    跟着实体 id 走。

    ## 做法照 identifier freezing，不是新发明

    RecLLM 的 Reformer 用"标识符冻结"保证重训练前后 item id 不变；MCP 的
    LFID 提案（modelcontextprotocol#1626）把"语义信号"和"稳定 canonical_id"
    分开——**以人类可读名字为锚、id 照抄**。本仓自己也早有同款：
    `html_structure.build_prompt` 第 5 条写着「sourcePageId 照抄上面给你的
    页面 id，不要自己改名」，而实测**唯一 id 保住 5/5 的段恰好就是 page**。
    这条只是把已经跑通的做法推广到实体/角色/节点。

    ## 只给名字和 id，不给别的

    跟 model_refine_digest 一样是摘要不是全量：这里要解决的是"同一个概念
    换了名字"，字段枚举、绑定、主题都与它无关，塞进去只会稀释注意力。
    """
    if not isinstance(model, dict):
        return {}
    lex: Dict[str, Any] = {}

    entities = []
    for e in ((model.get("datamodel") or {}).get("entities") or [])[:20]:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        entities.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "fields": [
                {"id": f.get("id"), "name": f.get("name")}
                for f in (e.get("fields") or [])[:15]
                if isinstance(f, dict) and f.get("id")
            ],
        })
    if entities:
        lex["entities"] = entities

    roles = [
        {"id": r.get("id"), "name": r.get("name")}
        for r in ((model.get("rbac") or {}).get("roles") or [])[:12]
        if isinstance(r, dict) and r.get("id")
    ]
    if roles:
        lex["roles"] = roles

    nodes = [
        {"id": n.get("id"), "name": n.get("name")}
        for n in ((model.get("workflow") or {}).get("nodes") or [])[:15]
        if isinstance(n, dict) and n.get("id")
    ]
    if nodes:
        lex["workflowNodes"] = nodes

    return lex


#: 精修时**可以整段沿用上一版**的模型段。**顺序有意义**：按「对本轮产物的耦合度」
#: 从低到高排，过不了闸时从尾巴开始丢（见 apply_refine_segment_reuse）。
#:
#: ⚠ 为什么不含 datamodel / page：这两段跟第 3 步刚生成的 HTML 是绑定关系——
#:   页面里的 data-field 指向 datamodel 的字段 id，bind_pages 按 page.pages 打孔。
#:   沿用上一版 = 拿旧字段 id 去绑新 HTML，必然错位。它们该重新生成，
#:   保结构靠的是 SPEC 步的连续性约束（那条对页面/角色**是**管用的，
#:   实测菜单 4/4；管不住的是这里这几段）。
#:
#: ⚠ 为什么不含 appbundle（2026-08-17 写第一版时错放进来了，被闸当场咬出来）：
#:   它整段都是**指向本轮产物的引用**——pageBindings.pageRef ∈ page.pages、
#:   landingPageRef ∈ page.pages、roleRefs ∈ rbac.roles、dataModelRefs ∈ entities，
#:   外加一个 preferredDevice。它是连接表，不是自有内容，沿用上一版等于拿旧
#:   页面 id 当落地页。跟 page 是同一类错误，只是没那么显眼。
#:
#: ⚠ aigc 排在最后是因为它的 inputFields 指 datamodel 字段、roleRefs 指 rbac 角色，
#:   而 datamodel **永远重新生成**——字段 id 一飘它就悬空。留着它是因为
#:   capabilities 是用户真正在意的自有内容，丢了可惜；排最后是因为它最先该被丢。
REFINE_REUSABLE_SEGMENTS = ("rbac", "workflow", "aigc")


def refine_reuse_enabled() -> bool:
    """`SLIDERULE_REFINE_REUSE_SEGMENTS=0` 关掉整个沿用。默认开。

    留开关是因为这是本轮唯一会**改变落库内容**的改动，线上出问题要能一键退回
    「全量重生成」的老行为，不用回滚部署。
    """
    raw = str(os.environ.get("SLIDERULE_REFINE_REUSE_SEGMENTS", "1")).strip().lower()
    return raw not in ("0", "false", "no", "off")


def apply_refine_segment_reuse(
    model: Dict[str, Any],
    baseline: Optional[Dict[str, Any]],
    scope: Optional[List[str]],
    *,
    gate_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """精修时把**指令没点名的段**整段换回上一版。返回换好的 model（不改入参）。

    ## 为什么是"沿用"不是"打补丁"

    2026-08-16 先试的是 RFC 7386 Merge Patch（`services/merge_patch.py`，实现和
    12 条单测都对），真机跑完发现诊断日志一次都没出现——它接在
    `generate_five_system_model` 上，而真正在跑的是 spec-first。补丁语义跟
    「从 spec 树重新生成、出口永远是完整模型」这条链**架构上不兼容**，不是接线
    问题。改用同文件里已有的 `reuse_language` / `reuse_style_brief` 那套做法：
    不问模型要增量，直接在出口把不该动的段按住。思路同 Kubernetes server-side
    apply 的字段归属——谁拥有哪一段，重新生成就不许覆盖不属于它的部分。

    ## scope 的三种取值，语义不同

        None  模型没声明（老 spec / 非精修 / 它没答）→ 按"不知道"处理，一段都不沿用
        []    模型明确说"一段都没碰"                  → 四段全沿用
        [...] 点名的段重新生成，其余沿用

    None 和 [] **必须分开**：混成一个会让"模型没答"静默变成"全沿用"，
    那是拿沉默当授权——用户真要求改权限时权限会一声不吭地不生效。

    ## fail-open，而且是有意的

    换完要重过一遍闸（`gate_fn`）。过不了就**逐段往回退**，退到能过为止；一段都
    过不了就整份用重新生成的那份。沿用是质量增强（少改点东西），不是证据/闭环
    类的东西，把它写成 fail-closed 会让一次本来能跑完的推演直接崩掉。
    每次退让都打日志，别静默——按纪律七分类。

    ⚠ 重过闸不是可选项。reused 的 workflow 里 `assigneeRole` 指的是**上一版**的
      角色 id，而 rbac 若被点名重新生成，角色 id 可能整套换了——不重过闸就是
      拿"闸之前绿过"给换过内容的模型发绿灯，正是本仓说的伪造绿灯。

    ⚠ 退让必须**逐段**，不能全有或全无（2026-08-17 第一版就是全有全无，被自己的
      探针咬出来）：aigc 的 inputFields 指 datamodel 字段，而 datamodel 永远重新
      生成，字段 id 一飘 aigc 就悬空——全有全无的话，一个 aigc 悬空会把 rbac 和
      workflow 的沿用一起赔掉，而那两段本来是好的、也正是用户抱怨的那两段。
      按 REFINE_REUSABLE_SEGMENTS 的顺序从尾巴丢（耦合最高的先丢），最多过 n+1 次闸；
      闸是纯机械的、不调 LLM，这个代价换"尽可能多保住几段"是划算的。
    """
    import copy

    # ⚠ 三条"什么都不做"的出口**都要说话**（2026-08-17 补）。
    #
    # 第一版三条全是静默 return。而这个功能最可能的失效方式恰恰是"整个没生效"：
    # 模型不吐 refineScope → scope 恒为 None → 一段都不沿用 → **判据全绿、
    # 线上照旧全量重写、日志里一个字都没有**。那正是本仓数到第十次以上的形状。
    # 会静默失效的功能必须说得出话——同 rank-bm25 那次的教训。
    if not isinstance(model, dict):
        return model
    if not isinstance(baseline, dict):
        print("[spec_first_pipeline] 精修沿用跳过：没拿到上一版模型（reuse_model 为空）")
        return model
    if scope is None:
        print(
            "[spec_first_pipeline] ⚠ 精修沿用跳过：SPEC 没声明 refineScope，"
            "按「不知道」处理，一段都不沿用（模型没答？prompt 没要？）"
        )
        return model

    named = {str(s).strip() for s in scope if str(s).strip()}
    candidates = [
        seg
        for seg in REFINE_REUSABLE_SEGMENTS
        if seg not in named and isinstance(baseline.get(seg), (dict, list))
    ]
    if not candidates:
        return model

    while candidates:
        candidate = dict(model)
        for seg in candidates:
            candidate[seg] = copy.deepcopy(baseline[seg])

        if gate_fn is None:
            print(f"[spec_first_pipeline] 精修沿用上一版模型段：{'、'.join(candidates)}")
            return candidate

        try:
            verdict = gate_fn(candidate)
        except Exception as exc:  # noqa: BLE001
            # 纪律七：沿用是增强类，**自己炸了不许拖垮主链路**。闸抛异常时整份
            # 退回重新生成的那份——它在 assemble 里已经过过闸，是已知可用的。
            # 抛出去的话，一个"少改点东西"的优化会让整轮推演崩掉。
            print(
                f"[spec_first_pipeline] ⚠ 精修沿用重过闸时闸自己抛了，"
                f"整份退回重新生成的那份：{type(exc).__name__}: {str(exc)[:200]}"
            )
            return model
        if isinstance(verdict, dict) and verdict.get("passed"):
            print(f"[spec_first_pipeline] 精修沿用上一版模型段：{'、'.join(candidates)}")
            return candidate

        findings = (verdict or {}).get("findings") or []
        detail = "；".join(f"{f.get('path')}：{f.get('message')}" for f in findings[:3])
        dropped = candidates.pop()
        print(
            f"[spec_first_pipeline] ⚠ 沿用「{dropped}」后过不了闸，改为重新生成这一段"
            f"（其余继续沿用）：{detail[:200]}"
        )

    print("[spec_first_pipeline] ⚠ 精修沿用逐段退让到空，整份用重新生成的那份")
    return model


def _reemit_pages(
    sink: Optional[Callable[..., None]],
    pages: Dict[str, str],
    *,
    bound: bool,
) -> None:
    """把统一/打孔后的整批页面再冲一遍 sink（前端按 pageId 覆盖）。

    异常吞掉：与 generate_pages_parallel 的 on_page 同一条纪律——
    UI 推送失败不许赔掉已经生成好的页面。"""
    if sink is None:
        return
    total = len(pages)
    for i, (pid, html) in enumerate(pages.items(), 1):
        try:
            sink(pid, html, i, total, bound)
        except Exception as exc:  # noqa: BLE001 — 顺路推送，不打死主链
            print(f"[spec_first_pipeline] 页面重发失败（不影响产出）：{str(exc)[:120]}")


def _with_device(
    raw_sink: Optional[Callable[..., None]], device: str
) -> Optional[Callable[..., None]]:
    """给页面 sink 注入 device（2026-08-14 竖屏加）。

    设备在管道开头定一次，每个页面事件都该带着它——前端拿它选画布视口
    （桌面 1920×1080 / 手机 1080×1920），不带的话竖屏页会被塞进横屏画布。
    老 sink（不收 device 的四参/五参）带不动就按原参重调——UI 推送的
    兼容问题不许赔掉已经烧过 LLM 的页面。
    """
    if raw_sink is None:
        return None

    def _sink(pid: str, html: str, done: int, total: int, *args: Any, **kw: Any) -> None:
        try:
            raw_sink(pid, html, done, total, *args, device=device, **kw)
        except TypeError:
            raw_sink(pid, html, done, total, *args, **kw)

    return _sink


def run_spec_first(
    goal: str,
    *,
    evidence: str = "",
    refine: Optional[Dict[str, Any]] = None,
    llm_json_fn: Optional[Callable[..., Any]] = None,
    bind_html: bool = True,
    design_system: Optional[str] = None,
    design_override: Optional[Dict[str, Any]] = None,
    reuse_language: Optional[Dict[str, Any]] = None,
    reuse_style_brief: Optional[Dict[str, Any]] = None,
    reuse_model: Optional[Dict[str, Any]] = None,
    on_page: Optional[Callable[[str, str, int, int], None]] = None,
) -> Dict[str, Any]:
    """一句话 → 完整五系统模型 + 带 data-* 孔的多页 HTML。

    design_system（2026-08-15 晚加）：这个应用的**风格**描述（版式原型、密度、
    组件词汇、配色基调），一路透到第 3 步注进提示词。不传就用缺省那一句。
    ⚠ 它只管风格：结构契约（<aside>/<header>/面包屑/无脚本…）永远由代码
      拼在后面，注入方碰不到——见 spec_page_html.build_design_system_prompt_block。

    refine（2026-08-14 晚加）：增量迭代上下文
    `{"instruction": 本轮追加要求, "modelDigest": model_refine_digest(上一版)}`。
    只影响第 2 步的 SPEC 提示词（加既有结构 + 连续性约束），后续步骤
    照常从新 SPEC 往下走——页面/模型是重新生成的，但被要求保持稳定。

    reuse_model（2026-08-17 加）：**上一版的完整模型**，精修时未被指令点名的段
    从它整段复制（第 6.2 步）。跟 refine 的 modelDigest 是两回事，别合并：
    digest 是喂给 LLM 看的摘要（几百字、有意丢细节），这个是拿来**照搬**的
    原始数据，丢了细节就搬不回去。"点名了哪几段"由 SPEC 步的 refineScope 声明。
    ⚠ 只在 refine 在场时生效——非精修轮传了也不会沿用，那是新建应用，没有上一版。

    device（2026-08-14 竖屏加）：从 goal 里认（device_policy 同一份词表，
    「手机/移动端/App/小程序」→ phone），一处定、处处跟——页面提示词换
    移动设计系统，3.5 抠移动壳（顶栏+底部标签栏），页面事件与产物都带
    device 字段，前端据此选竖屏画布。

    返回 {"version", "model", "spec", "structure", "semantics", "pages",
          "navItems", "failedPages", "stages", "device"}。
    任何一步失败抛 SpecFirstError，**不回落占位、不回落老链路**。
    """
    from .device_policy import resolve_preferred_device
    from .design_language import (
        generate_design_language,
        merge_override,
        normalize_design_language,
        render_design_language,
    )
    from .design_language import (
        generate_style_brief,
        style_brief_ok,
        style_for_page,
    )
    from .html_bindings import bind_pages
    from .html_structure import derive_structure, to_datamodel  # noqa: F401
    from .model_assembly import assemble
    from .page_shell import (
        check_shell_consistency,
        repair_pages_after_bind,
        unify_shell,
    )
    from .spec_page_html import generate_pages_parallel
    from .spec_semantics import derive_semantics, to_model_sections  # noqa: F401
    from .spec_tree import generate_spec_tree
    from .run_cancel import raise_if_cancelled

    stages: Dict[str, Any] = {}
    device = resolve_preferred_device(goal, None)
    sink = _with_device(on_page or _page_sink_var.get(), device)

    # ★ id 冻结（2026-08-17）：把上一版的「概念名 → id」词表算出来，第 4/5 步
    #   各拿一份。**只在精修轮**——新建应用没有上一版，给它一批无关 id 只会
    #   让它硬凑。算一次给两处用，不在两边各取一次数（两处取数迟早对不齐，
    #   本仓在别处栽过）。
    #   `SLIDERULE_REFINE_ID_FREEZE=0` 关掉：既是线上一键回退，也是**对照臂开关**
    #   ——量"是不是它起的作用"必须同模型同话题跑 A/B，换个模型比前后是把两个
    #   变量混在一起（本仓吃过"拿造出来的数替代看一眼"的亏）。
    _freeze_on = str(
        os.environ.get("SLIDERULE_REFINE_ID_FREEZE", "1")
    ).strip().lower() not in ("0", "false", "no", "off")
    _prev_ids = model_id_lexicon(reuse_model) if (refine and _freeze_on) else {}
    if _prev_ids:
        print(
            f"[spec_first_pipeline] 精修 id 冻结：实体 {len(_prev_ids.get('entities') or [])}、"
            f"角色 {len(_prev_ids.get('roles') or [])}、"
            f"流程节点 {len(_prev_ids.get('workflowNodes') or [])}"
        )
    elif refine and not _freeze_on:
        print("[spec_first_pipeline] id 冻结被开关关掉（SLIDERULE_REFINE_ID_FREEZE=0）")
    elif refine:
        # 静默失效的老形状：精修轮却没有词表（reuse_model 没传/上一版是空的）。
        # 不说话的话，线上表现是"id 照样每轮重铸"而日志一个字都没有。
        print("[spec_first_pipeline] ⚠ 精修轮但拿不到上一版 id 词表，id 冻结未生效")

    # ── 第 2 步：起草 SPEC ──────────────────────────────────────────
    # （第 1 步「澄清 + 缺口 + 证据」用的是现有能力，由调用方把 evidence 传进来）
    with _stage("specfirst.spec") as st:
        spec_model = generate_spec_tree(goal, evidence=evidence, refine=refine)
        spec = spec_model.model_dump(mode="json") if hasattr(spec_model, "model_dump") else spec_model
        st["pages"] = len(spec.get("pages") or [])
        st["nodes"] = len(spec.get("nodes") or [])
    stages["spec"] = dict(st)
    # SPEC 声明的页面清单——**交付对账的基准**。在这里取一次，下面第 3 步
    # 拿它跟实交页面比。⚠ 取 id 不取数量：只比数量的话，"少了 p5、多了 p9"
    # 会两两相消，数字对得上而内容错位——本仓在别处栽过这种"数对了东西不对"。
    spec_pages_declared_objs = [
        p for p in (spec.get("pages") or []) if isinstance(p, dict) and p.get("id")
    ]
    spec_pages_declared = [
        str(p.get("id") or "") for p in (spec.get("pages") or []) if isinstance(p, dict) and p.get("id")
    ]

    # ── 第 2.5 步：定这个应用的设计语言（风格那一半）────────────────
    #
    # 链路原来从"起草规格"直接跳到"逐页画界面"，中间没有"这个应用长什么样"
    # 的环节——于是不管什么业务出来都是同一个模子。
    #
    # ⚠ 人给了散文就**不调 LLM**：显式指定优先于生成，这跟 on_page 那条
    #   "显式实参优先于 sink"是同一条纪律。省一次调用是顺带的，主要是
    #   别让生成结果去覆盖人明确写下的东西。
    # ⚠ 契约不经过这一步。它只出风格，塞进 spec_page_html 的槽位，
    #   结构契约照旧由代码拼在后面——见 build_design_system_prompt_block。
    # ⚠ 复用优先于重新生成（2026-08-15 晚补）。真机量到过：同一个应用连着
    #   跑两次，配色一次 #1b3a57+#a1824a、一次 #1e3a8a+#b45309——气质同向，
    #   具体值全变。修补/迭代场景下用户会看见界面颜色莫名其妙换掉，而那是
    #   **一眼可见**的不稳定，比密度不够伤得多。
    design_language: Optional[Dict[str, Any]] = None
    style_brief: Optional[Dict[str, Any]] = None
    if (design_system or "").strip():
        pass  # 人直接给了散文，最高优先，连生成带复用一起跳过
    elif reuse_style_brief and style_brief_ok(
        reuse_style_brief, [str(p.get("id")) for p in spec_pages_declared_objs]
    ):
        style_brief = reuse_style_brief
        print("[spec_first_pipeline] 复用上一版风格段，不重新生成")
    elif reuse_language:
        design_language = merge_override(
            normalize_design_language(reuse_language), design_override
        )
        design_system = render_design_language(design_language)
        # ⚠ 零 LLM、瞬时完成，**不进进度线**——照 specfirst.shell 那条：
        #   start/end 背靠背发出去只会在左侧闪一下。
        print("[spec_first_pipeline] 复用上一版设计语言，不重新生成")
    else:
        raise_if_cancelled("第2.5步 定设计语言")
        with _stage("specfirst.design") as st:
            # ★ 2026-08-16 用户裁决：风格段改由 LLM **现写**——
            #   「a 就算内容再多也是写死的」。确定性那套降为回落。
            style_brief = generate_style_brief(spec)
            st["mode"] = "llm" if style_brief else "fallback"
            if style_brief is None:
                # ⚠ 回落不是可有可无：审美挂了不该打死整轮，而确定性那套
                #   永远出得来。这跟 spec_tree「失败不回落占位」不矛盾——
                #   那条护的是内容，这里回落的是审美。
                design_language = generate_design_language(spec, override=design_override)
                design_system = render_design_language(design_language)
                st["density"] = design_language.get("density")
        stages["design"] = dict(st)

    # 逐页各拿各的那份；应用级基调对每页相同，所以页面才像同一个产品。
    if style_brief:
        design_system = {
            str(p.get("id")): style_for_page(style_brief, str(p.get("id")))
            for p in spec_pages_declared_objs
        }

    # ── 第 3 步：每页 HTML（并发；单页失败不拖垮整批）────────────────
    raise_if_cancelled("第3步 逐页画界面")
    with _stage("specfirst.pages") as st:
        # on_page 透传：这一步是整条链上**第一个产出可以直接看的东西**的地方，
        # 一份能独立打开的 HTML 比最终模型早四五分钟。攒齐再交等于白白转圈。
        #
        # 显式实参优先于 sink：脚本/评测直接调这个函数时不该被"当前请求恰好
        # 装了个 sink"影响。生产路径（主轴）走 sink，因为中间那层是同步的。
        batch = generate_pages_parallel(
            spec, device=device, design_system=design_system,
            product=goal, on_page=sink
        )
        pages = dict(batch.get("pages") or {})
        failed = dict(batch.get("failed") or {})
        st["got"] = len(pages)
        st["failed"] = len(failed)
        # ★ 交付页数对账（2026-08-14）：**SPEC 说要几页，就得交几页**。
        #
        # 第 4 步的 check_page_coverage 守的是「喂几份 HTML → 出几个页面」，
        # 它比的是**这一步的输入**。而这一步自己少产一页时，第 4 步收到的
        # 就是少了的那份，喂 4 出 4——**判据全绿，缺口在它上游**。
        #
        # 真机撞到过（2026-08-14 市政园林那轮）：spec 5 页、第 3 步 failed=1，
        # 后面所有步骤按 4 页跑完，闭环 6/6、blocked=false，没有任何一处
        # 提过"少了一页"。缺的那页记在 failedPages 里，但没人拿它跟 spec 对账。
        #
        # ⚠ 只记不拦：单页失败本来就是 fail-open 设计（另外几页已经烧掉几分钟，
        #   不该被一页拖垮）。这里补的是**让它说得出话**，不是把它改成 fail-closed。
        st["declaredPages"] = len(spec_pages_declared)
        missing_pages = [pid for pid in spec_pages_declared if pid not in pages]
        if missing_pages:
            st["missingPages"] = ",".join(missing_pages)
            print(
                f"[spec_first] ⚠ 交付页数对不上 SPEC：声明 {len(spec_pages_declared)} 页、"
                f"实交 {len(pages)} 页，缺 {missing_pages}（失败原因见 failedPages）"
            )
    stages["pages"] = dict(st)
    if not pages:
        raise SpecFirstError(f"第 3 步一页都没出来：{list(failed.values())[:2]}")

    # ── 第 3.5 步：外壳统一（零 LLM）────────────────────────────────
    raise_if_cancelled("第3.5步 外壳统一")
    with _stage("specfirst.shell") as st:
        shell = unify_shell(pages, spec, device=device)
        pages = dict(shell.get("pages") or pages)
        st["pages"] = len(pages)
        # 判据接进生产（此前只在测试里跑）：统一完还剩几处不一致，如实记账。
        # 只记不拦——挡运行的闸在结构那边，这里的职责是让漂移**看得见**。
        shell_problems = check_shell_consistency(pages, spec)
        st["problems"] = len(shell_problems)
        for p in shell_problems[:3]:
            print(f"[spec_first_pipeline] 外壳统一后仍不一致：{p['path']} — {p['message']}")
    stages["shell"] = dict(st)

    # 统一后的页面立刻重发一遍（bound 仍是 False，但菜单已按 spec 锚定）。
    # 不发的话，前端直播舞台从第 3 步起一直摆着「三个产品名、三套菜单」的
    # 素颜页，要等整轮跑完 finalState 到达才换——那是十几分钟的错误画面。
    _reemit_pages(sink, pages, bound=False)

    # ── 第 4 步：HTML → 结构 ────────────────────────────────────────
    raise_if_cancelled("第4步 反推结构")
    with _stage("specfirst.structure") as st:
        structure_model = derive_structure(
            pages, goal=goal, llm_json_fn=llm_json_fn, prev_ids=_prev_ids
        )
        structure = (
            structure_model.model_dump(mode="json")
            if hasattr(structure_model, "model_dump")
            else structure_model
        )
        st["entities"] = len(structure.get("entities") or [])
        st["pages"] = len(structure.get("pages") or [])
    stages["structure"] = dict(st)

    # ── 第 5 步：(结构 + SPEC) → 权限 / 工作流 / 不变式 ───────────────
    # ⚠ 两个输入都要。三臂对照实测：只有 SPEC 会编出结构里没有的对象；
    #   只有结构会把多类使用者塌成一个角色。B 是唯一过闸的那一臂。
    raise_if_cancelled("第5步 推导语义")
    with _stage("specfirst.semantics") as st:
        semantics_model = derive_semantics(
            structure, spec, llm_json_fn=llm_json_fn, prev_ids=_prev_ids
        )
        semantics = (
            semantics_model.model_dump(mode="json")
            if hasattr(semantics_model, "model_dump")
            else semantics_model
        )
        st["roles"] = len(semantics.get("roles") or [])
        st["nodes"] = len(semantics.get("workflowNodes") or semantics.get("nodes") or [])
    stages["semantics"] = dict(st)

    # ── 第 6 步：汇合 → 完整六段 → 过结构闸 ─────────────────────────
    raise_if_cancelled("第6步 汇合过闸")
    with _stage("specfirst.assemble") as st:
        assembled = assemble(structure, semantics, spec, llm_json_fn=llm_json_fn)
        model = assembled.get("model") if isinstance(assembled, dict) else assembled
        if not isinstance(model, dict):
            raise SpecFirstError("第 6 步没有产出模型")
        st["ok"] = 1
    stages["assemble"] = dict(st)

    # ── 第 6.2 步：精修时，指令没点名的段沿用上一版 ─────────────────
    #
    # ⚠ 位置很要紧：必须在**这个** model 上做，不是在别处。2026-08-16 同一件事
    #   打偏过三次，全是改在没通电的那一步上（闭环重建、提示词收尾、老生成器）。
    #   这里是 assemble 的出口，也是下面 bind / 落库 / 精修回流拿到的同一份对象——
    #   接线由 tests/test_refine_segment_reuse.py 端到端钉住（跑真实控制流，非 mock）。
    #
    # 放在 bind 之前：bind_pages 要用 model 打孔，让它看到最终那份，别打完再换。
    if refine and refine_reuse_enabled():
        from .v5_model_gate import validate_five_system_model

        model = apply_refine_segment_reuse(
            model,
            reuse_model,
            (spec or {}).get("refineScope"),
            gate_fn=lambda m: validate_five_system_model(
                m,
                require_landing_page_ref=True,
                require_preferred_device=True,
                # 跟 model_assembly.assemble 里那次过闸**必须同参**：换了参数就是
                # 换了把尺子，"重新量一遍"会量出跟原来不同的结论，退回逻辑失真。
                require_page_kind_contract=False,
            ),
        )
        stages["refineReuse"] = {
            "scopeDeclared": (spec or {}).get("refineScope") is not None,
            "reused": [
                seg
                for seg in REFINE_REUSABLE_SEGMENTS
                if isinstance(reuse_model, dict)
                and model.get(seg) is not None
                and model.get(seg) == (reuse_model or {}).get(seg)
            ],
        }

    # ── 第 6.5 步：给 HTML 打 data-* 孔 ─────────────────────────────
    # ⚠ 到这里实体与字段才定死校验过，孔才打得成。第 3 步打不了——
    #   那时 datamodel 还不存在，写 data-field 是引用没被发明的 id。
    bound_failed: Dict[str, Any] = {}
    if bind_html:
        raise_if_cancelled("第6.5步 打绑定孔")
        with _stage("specfirst.bind") as st:
            before_bind = dict(pages)
            bound = bind_pages(pages, model)
            if bound.get("pages"):
                pages = dict(bound["pages"])
            bound_failed = dict(bound.get("failed") or {})
            st["bound"] = len(bound.get("pages") or {})
            st["failed"] = len(bound_failed)
            # ★ 把 bind 改坏的壳换回打孔前那份（2026-08-15）。
            #
            # 3.5 步已经把壳统一好了，bind 又给弄乱——八趟八次，最狠一次是
            # 同一个应用两个产品名两套菜单。打孔前那份是**已知正确**的，
            # 直接换回来，不用再问模型。
            # ⚠ 只还原**结构被改**的；bind 往壳里打的合法绑定孔要保留
            #   （实测 34 份里 12 份壳里有 data-*）。判定见 restore_shell_after_bind。
            # ⚠ 还要把内容区偏移重新对齐一遍：bind 重写整页时会把 <main> 上的
            #   ml-64 一起吃掉，而还原那一步只管 aside/header。真机（律所那趟）
            #   4 页里 2 页被吃，判据报了但没人修——见 repair_pages_after_bind。
            pages, restored, reconciled = repair_pages_after_bind(pages, before_bind)
            st["shellRestored"] = len(restored)
            st["mainReconciled"] = len(reconciled)
            if restored:
                print(f"[spec_first_pipeline] 打孔后外壳被改，已还原：{'、'.join(restored)}")
            if reconciled:
                print(f"[spec_first_pipeline] 打孔后内容区偏移已重新对齐：{'、'.join(reconciled)}")
            # 还原之后再量一次：剩下的才是还原不了的（比如两页壳本来就不同源）。
            drift = check_shell_consistency(pages, spec)
            st["shellProblems"] = len(drift)
            for p in drift[:3]:
                print(f"[spec_first_pipeline] 打孔后外壳漂移：{p['path']} — {p['message']}")
        stages["bind"] = dict(st)

        # 打完孔的成品页重发（bound=True）：前端徽标从「尚未接数据」翻成
        # 「已接数据」，不用等交付那一刻的 finalState。
        _reemit_pages(sink, pages, bound=True)

    # 挂进 model：它是唯一被落库、也是精修时回流的那份。
    if isinstance(model, dict):
        if design_language:
            model["designLanguage"] = design_language
        if style_brief:
            model["styleBrief"] = style_brief

    result = {
        "version": SPEC_FIRST_VERSION,
        "model": model,
        "spec": spec,
        # ⚠ designLanguage 同时**挂进 model**（见下面那行）而不是只放在这里：
        #   model 是唯一被落库的那份（app_store 的 model_json），也是精修时
        #   回流的那份（refine_ctx["model"]）。只放返回值里的话，谁都不会存它
        #   ——真机验过：唯一的调用方只取 result["model"]。
        "structure": structure,
        "semantics": semantics,
        "pages": pages,
        "navItems": shell.get("navItems") or [],
        "failedPages": {**failed, **bound_failed},
        # SPEC 声明了、最终没交出来的页。**空列表和缺这个键是两回事**：
        # 空 = 对过账、一页不缺；缺键 = 老产物，没对过账。所以恒给出来。
        "missingPages": missing_pages,
        "declaredPages": spec_pages_declared,
        "designLanguage": design_language,
        "stages": stages,
        "device": device,
    }
    # 顺路把页面留给调用方落库（见 take_last_pages 的说明）。
    # ⚠ 只在**整条链跑成**之后写：中途抛 SpecFirstError 时这里根本不执行，
    #   于是暂存里不会留下半份产物冒充成品。
    _last_pages_var.set({
        "version": SPEC_FIRST_VERSION,
        "pages": dict(pages),
        "navItems": list(result["navItems"]),
        "boundPages": len(pages) if bind_html and not bound_failed else 0,
        "failedPages": dict(result["failedPages"]),
        # 交付对账结果一并落库：**刷新之后仍然说得出"这个应用少了一页"**。
        # 只留在日志里等于只有当场看着的人知道，第二天打开应用中心的人不知道。
        "missingPages": list(missing_pages),
        "declaredPages": list(spec_pages_declared),
        # 前端（直播舞台/应用中心）拿它选画布视口：desktop 横屏 / phone 竖屏
        "device": device,
    })
    return result
