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

## 上线方式照仓里的老规矩：开关默认关，拿证据换默认开

`SLIDERULE_SPEC_FIRST` 缺省 off。先例：目录窄化默认关到攒够评测
（3 覆盖域 × 2 臂 × n=6，p=0.00004）才翻默认；agentic pick 也是十话题 4:0
之后才转正。这条链路一轮 8~9 分钟、烧十几次 LLM，**没有对照就翻默认是拿
生产当实验台**。

⚠ 同时进 /ready 的 `specFirst` 探针。理由是 rank-bm25 那次的教训：
**会静默失效的功能，健康探针里必须有它的位置**——开关开着不算数，
七个模块都在才算 effective。
"""

from __future__ import annotations

import os
from typing import Any, Callable, Dict, List, Optional

SPEC_FIRST_VERSION = "spec-first-pipeline-v1"

_ENABLE_ENV = "SLIDERULE_SPEC_FIRST"
#: 照 overview_html 的 _OFF_VALUES 同款口径：显式关才关。
_ON_VALUES = frozenset({"1", "true", "yes", "on"})

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
    return (os.environ.get(_ENABLE_ENV) or "").strip().lower() in _ON_VALUES


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


def run_spec_first(
    goal: str,
    *,
    evidence: str = "",
    llm_json_fn: Optional[Callable[..., Any]] = None,
    bind_html: bool = True,
    on_page: Optional[Callable[[str, str, int, int], None]] = None,
) -> Dict[str, Any]:
    """一句话 → 完整五系统模型 + 带 data-* 孔的多页 HTML。

    返回 {"version", "model", "spec", "structure", "semantics", "pages",
          "navItems", "failedPages", "stages"}。
    任何一步失败抛 SpecFirstError，**不回落占位、不回落老链路**。
    """
    from .html_bindings import bind_pages
    from .html_structure import derive_structure, to_datamodel  # noqa: F401
    from .model_assembly import assemble
    from .page_shell import unify_shell
    from .spec_page_html import generate_pages_parallel
    from .spec_semantics import derive_semantics, to_model_sections  # noqa: F401
    from .spec_tree import generate_spec_tree

    stages: Dict[str, Any] = {}

    # ── 第 2 步：起草 SPEC ──────────────────────────────────────────
    # （第 1 步「澄清 + 缺口 + 证据」用的是现有能力，由调用方把 evidence 传进来）
    with _stage("specfirst.spec") as st:
        spec_model = generate_spec_tree(goal, evidence=evidence)
        spec = spec_model.model_dump(mode="json") if hasattr(spec_model, "model_dump") else spec_model
        st["pages"] = len(spec.get("pages") or [])
        st["nodes"] = len(spec.get("nodes") or [])
    stages["spec"] = dict(st)

    # ── 第 3 步：每页 HTML（并发；单页失败不拖垮整批）────────────────
    with _stage("specfirst.pages") as st:
        # on_page 透传：这一步是整条链上**第一个产出可以直接看的东西**的地方，
        # 一份能独立打开的 HTML 比最终模型早四五分钟。攒齐再交等于白白转圈。
        batch = generate_pages_parallel(spec, on_page=on_page)
        pages = dict(batch.get("pages") or {})
        failed = dict(batch.get("failed") or {})
        st["got"] = len(pages)
        st["failed"] = len(failed)
    stages["pages"] = dict(st)
    if not pages:
        raise SpecFirstError(f"第 3 步一页都没出来：{list(failed.values())[:2]}")

    # ── 第 3.5 步：外壳统一（零 LLM）────────────────────────────────
    with _stage("specfirst.shell") as st:
        shell = unify_shell(pages, spec)
        pages = dict(shell.get("pages") or pages)
        st["pages"] = len(pages)
    stages["shell"] = dict(st)

    # ── 第 4 步：HTML → 结构 ────────────────────────────────────────
    with _stage("specfirst.structure") as st:
        structure_model = derive_structure(pages, goal=goal, llm_json_fn=llm_json_fn)
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
    with _stage("specfirst.semantics") as st:
        semantics_model = derive_semantics(structure, spec, llm_json_fn=llm_json_fn)
        semantics = (
            semantics_model.model_dump(mode="json")
            if hasattr(semantics_model, "model_dump")
            else semantics_model
        )
        st["roles"] = len(semantics.get("roles") or [])
        st["nodes"] = len(semantics.get("workflowNodes") or semantics.get("nodes") or [])
    stages["semantics"] = dict(st)

    # ── 第 6 步：汇合 → 完整六段 → 过结构闸 ─────────────────────────
    with _stage("specfirst.assemble") as st:
        assembled = assemble(structure, semantics, spec, llm_json_fn=llm_json_fn)
        model = assembled.get("model") if isinstance(assembled, dict) else assembled
        if not isinstance(model, dict):
            raise SpecFirstError("第 6 步没有产出模型")
        st["ok"] = 1
    stages["assemble"] = dict(st)

    # ── 第 6.5 步：给 HTML 打 data-* 孔 ─────────────────────────────
    # ⚠ 到这里实体与字段才定死校验过，孔才打得成。第 3 步打不了——
    #   那时 datamodel 还不存在，写 data-field 是引用没被发明的 id。
    bound_failed: Dict[str, Any] = {}
    if bind_html:
        with _stage("specfirst.bind") as st:
            bound = bind_pages(pages, model)
            if bound.get("pages"):
                pages = dict(bound["pages"])
            bound_failed = dict(bound.get("failed") or {})
            st["bound"] = len(bound.get("pages") or {})
            st["failed"] = len(bound_failed)
        stages["bind"] = dict(st)

    return {
        "version": SPEC_FIRST_VERSION,
        "model": model,
        "spec": spec,
        "structure": structure,
        "semantics": semantics,
        "pages": pages,
        "navItems": shell.get("navItems") or [],
        "failedPages": {**failed, **bound_failed},
        "stages": stages,
    }
