"""
Full port of Node's capability execution for V5.

Covers all from capability-exec-map, dialogue, deliberation, delivery, structure, visual, evidence, mcp, skill, report, risk, etc.

Uses RAG for external evidence and stable Python-side execution.
No Node LLM, no pool, no su8, no proxy issues, no template/degraded.
"""

from typing import Dict, Any, List, Callable, Optional
import hashlib
import os
import re
from models.v5_state import V5SessionState, ExecuteCapabilityResult
from .rag_service import retrieve_evidence, generate_with_rag


def _llm_generate_enabled() -> bool:
    """T3 gate flag. Off by default so deterministic domains + fail-closed stay the
    baseline; opt-in via env for LLM generation of novel intents."""
    return str(os.getenv("SLIDERULE_LLM_GENERATE_ENABLED", "")).strip().lower() in ("1", "true", "yes", "on")


# 最近一次五系统 LLM 生成路径的诊断。仅用于 publish closure 的 blocker 面向
# 用户透出"为什么 0/6"（未开启 / 调用失败 / 结构闸拦截）；fail-closed 判定
# 与 trust/gate/closure hash 完全不读它。
_llm_generate_diagnostic: Dict[str, str] = {}

REQUIRED_EVIDENCE_KEYS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

RUNTIME_CLOSURE_EDGES = [
    {
        "sourceSkill": "datamodel",
        "targetSkill": "rbac",
        "state": "allowed",
        "evidenceKey": "DM_RBAC_FIELD_POLICY_EVIDENCE",
    },
    {
        "sourceSkill": "datamodel",
        "targetSkill": "page",
        "state": "allowed",
        "evidenceKey": "DM_PAGE_BINDING_IMPACT_EVIDENCE",
    },
    {
        "sourceSkill": "rbac",
        "targetSkill": "workflow",
        "state": "allowed",
        "evidenceKey": "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE",
    },
    {
        "sourceSkill": "workflow",
        "targetSkill": "page",
        "state": "allowed",
        "evidenceKey": "WORKFLOW_PAGE_TASK_SURFACE_EVIDENCE",
    },
    {
        "sourceSkill": "page",
        "targetSkill": "appbundle",
        "state": "allowed",
        "evidenceKey": "PAGE_APPBUNDLE_RUNTIME_SURFACE_EVIDENCE",
    },
    {
        "sourceSkill": "aigc",
        "targetSkill": "appbundle",
        "state": "allowed",
        "evidenceKey": "AIGC_APPBUNDLE_RUNTIME_EVIDENCE",
    },
]

PURCHASE_APPROVAL_INTENT_MARKERS = [
    "purchase approval",
    "purchase_request",
    "采购审批",
    "采购单",
    "采购",
]

# Deterministic domain recognizers (T1 generality proof — see
# docs/Intent-to-App 五系统闭包样板 · SPEC.md). Each recognized domain closes
# 6/6 with the SAME structural RUNTIME_CLOSURE_EDGES (the metamodel is
# domain-agnostic); only the evidence flavour text differs. Unknown intents
# stay fail-closed (0/6) until LLM generate() lands (T3). This proves the
# five-system closure generalizes beyond purchase, without coupling to LLM.
#
# 匹配纪律（真实事故修复）：此前是裸子串匹配，"sla" 命中了
# translation/island/slack/slash/legislation，"升级" 命中了任意提到升级的
# 意图——用户要翻译平台、拿到冻结工单系统，且全程无痕。修法借
# RapidFuzz score_cutoff / Rasa FallbackClassifier 的语义：
# - 拉丁 marker 一律词边界匹配（"sla" 只认独立的 SLA 一词）；
# - marker 分强/弱两级：strong 是领域专属词，独立命中即认；weak 是
#   泛词（ticket/sla/升级/onboarding），单独命中不认域，需 ≥2 个不同
#   弱词同现才认——认不出就返回 None，fail-closed 交给 LLM 生成，
#   绝不硬塞一个猜的域。
DOMAIN_INTENT_MARKERS: Dict[str, Dict[str, List[str]]] = {
    "purchase_approval": {
        "strong": PURCHASE_APPROVAL_INTENT_MARKERS,
        "weak": [],
    },
    "leave_approval": {
        "strong": ["leave approval", "leave request", "请假审批", "请假单", "请假", "休假"],
        "weak": [],
    },
    "service_ticket": {
        "strong": ["service ticket", "工单", "客户服务", "客服", "服务台"],
        "weak": ["ticket", "sla", "升级"],
    },
    "employee_onboarding": {
        "strong": ["employee onboarding", "入职", "员工入职", "新员工", "报到"],
        "weak": ["onboarding"],
    },
}

# Human-readable domain names for evidence flavour text (deterministic).
DOMAIN_LABELS: Dict[str, str] = {
    "purchase_approval": "purchase approval",
    "leave_approval": "leave approval",
    "service_ticket": "service ticket",
    "employee_onboarding": "employee onboarding",
}


def _marker_matches(marker: str, text: str) -> bool:
    """单个 marker 是否命中（marker 与 text 均已 lower）。

    含拉丁字母的 marker 按词边界匹配——裸子串会让 "sla" 命中
    translation/island/slack（真实事故）；CJK marker 保持包含匹配
    （中文没有词边界）。marker 内的空格放宽为任意空白。
    """
    if re.search(r"[a-z]", marker):
        # 末尾允许可选复数后缀（tickets/approvals/requests 是极自然的英文
        # 表述，词边界一刀切会把它们全打成"认不出"——终检实测的召回回归）。
        pattern = (
            r"(?<![a-z0-9])"
            + re.escape(marker).replace(r"\ ", r"\s+")
            + r"(?:e?s)?(?![a-z0-9])"
        )
        return re.search(pattern, text) is not None
    return marker in text


def _recognize_domain(goal: str) -> "str | None":
    """Return the recognized deterministic domain key, or None (fail-closed).

    强词独立命中即认；弱词需 ≥2 个不同弱词同现才认（见
    DOMAIN_INTENT_MARKERS 头注）。认不出返回 None——宁可走 LLM 生成，
    不硬塞一个猜的演示域。

    Handles the latin1->utf8 mojibake repair the same way the legacy purchase
    check did, so garbled Windows-shell goals still match.
    """
    variants = [(goal or "").lower()]
    try:
        repaired = (goal or "").encode("latin1").decode("utf-8")
        if repaired and repaired.lower() not in variants:
            variants.append(repaired.lower())
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    for domain, markers in DOMAIN_INTENT_MARKERS.items():
        strong = markers.get("strong") or []
        weak = markers.get("weak") or []
        for variant in variants:
            if any(_marker_matches(m.lower(), variant) for m in strong):
                return domain
            weak_hits = {m for m in weak if _marker_matches(m.lower(), variant)}
            if len(weak_hits) >= 2:
                return domain
    return None


def _artifact_dicts(state: V5SessionState) -> List[Dict[str, Any]]:
    artifacts: List[Dict[str, Any]] = []
    for artifact in getattr(state, "artifacts", []) or []:
        if hasattr(artifact, "model_dump"):
            artifacts.append(artifact.model_dump())
        elif isinstance(artifact, dict):
            artifacts.append(artifact)
    return artifacts


def _is_purchase_approval_intent(goal: str) -> bool:
    """Back-compat shim — true iff the goal is the purchase domain specifically.

    Kept for any external callers; new code should use _recognize_domain().
    """
    return _recognize_domain(goal) == "purchase_approval"


_BUILTIN_DOMAIN_MODELS: "Dict[str, Any] | None" = None


def _builtin_domain_model_section(domain: str, skill: str) -> "Dict[str, Any] | None":
    """E35：确定性演示域的内置五系统模型段（LLM 一次性生成、过结构门后
    冻结的静态夹具，见 services/data/builtin_domain_models.json）。

    用户实测 bug：演示域闭环 6/6 后右侧只有证据看板、长不出应用——因为
    夹具证据历史上不带 modelSection。夹具是确定性的，模型也理应确定：
    随证据以 payload 形式挂上（与 LLM 路径同一机制，不进 haystack、不进
    闭环 hash）。文件缺失/损坏时如实返回 None（老行为，诚实降级）。"""
    global _BUILTIN_DOMAIN_MODELS
    if _BUILTIN_DOMAIN_MODELS is None:
        import json as _json
        from pathlib import Path as _Path

        path = _Path(__file__).resolve().parent / "data" / "builtin_domain_models.json"
        try:
            _BUILTIN_DOMAIN_MODELS = _json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _BUILTIN_DOMAIN_MODELS = {}
    model = _BUILTIN_DOMAIN_MODELS.get(domain)
    if not isinstance(model, dict):
        return None
    section = model.get(skill)
    return section if isinstance(section, dict) else None


def _runtime_linkage_artifact_for_skill(skill: str, goal: str, domain: str = "purchase_approval") -> Dict[str, Any]:
    evidence_keys = [
        edge["evidenceKey"]
        for edge in RUNTIME_CLOSURE_EDGES
        if edge["sourceSkill"] == skill or edge["targetSkill"] == skill
    ]
    label = DOMAIN_LABELS.get(domain, domain)
    artifact = {
        "id": f"runtime-linkage-{skill}",
        "title": f"{skill} runtime linkage evidence",
        "kind": "runtimeClosureEvidence",
        "summary": f"deterministic {label} six-Skill linkage evidence (builtin demo-domain fixture)",
        "content": f"{skill} evidence for {label} runtime closure: {','.join(evidence_keys)}",
        # 走了演示域近路必须可见（此前对用户全程无痕，误判时无从排查）：
        # provenance 带上 builtin-domain:<域>，审计抽屉/交付物里能看到。
        "provenance": f"python-runtime-linkage:builtin-domain:{domain}",
    }
    section = _builtin_domain_model_section(domain, skill)
    if section is not None:
        artifact["_model_section"] = section
    return artifact


def _format_gate_findings(findings: List[Dict[str, Any]], limit: int = 10) -> str:
    """把结构门 findings 压成回喂文本（path: message 逐条，封顶 limit 条）。"""
    lines = [
        f"- {f.get('path', '')}: {f.get('message', '')}"
        for f in findings[:limit]
        if isinstance(f, dict)
    ]
    rest = len(findings) - limit
    if rest > 0:
        lines.append(f"- ...and {rest} more findings of the same kinds")
    return "\n".join(lines)


def _try_llm_generate_evidence(
    goal: str,
    llm_json_fn: Optional[Callable[[str], Any]],
    *,
    require_landing_page_ref: bool = True,
    session_id: Optional[str] = None,
) -> Optional[Dict[str, Dict[str, Any]]]:
    """Generate + gate a five-system model for a novel intent.

    Returns {skill: artifact} for all 6 skills if the LLM model PASSES the
    structural gate; otherwise None (fail-closed). Never raises.

    require_landing_page_ref=True (default): strict gate for LLM-generated/refined
    models — landingPageRef must be present. Set to False for historic override
    (old snapshots without the field must still restore).
    """
    global _llm_generate_diagnostic
    try:
        from .v5_llm_generate import generate_five_system_model, model_to_linkage_artifacts
        from .v5_model_gate import validate_five_system_model
    except Exception as exc:
        _llm_generate_diagnostic = {
            "code": "LLM_GENERATE_FAILED",
            "detail": f"generate module unavailable: {str(exc)[:160]}",
        }
        return None

    def _repair(candidate: Dict[str, Any]) -> Dict[str, Any]:
        # 门禁前确定性修复：不变式/展示层引用近邻修复 + 修不好的整条剔除
        # （零 LLM，留痕）。骨架五段不修——悬挂仍由下面的门禁硬拦。
        try:
            from .v5_model_repair import repair_five_system_model

            return repair_five_system_model(candidate)["model"]
        except Exception as exc:  # noqa: BLE001 — 修复器故障不得放行未修模型，也不该炸管线
            print(f"[v5_capability_executor] model repair skipped: {str(exc)[:120]}")
            return candidate

    model = generate_five_system_model(goal, llm_json_fn=llm_json_fn)
    if model is None:
        from .v5_llm_generate import last_generate_diagnostic as _diag

        _llm_generate_diagnostic = {
            "code": "LLM_GENERATE_FAILED",
            "detail": str((_diag or {}).get("detail") or "LLM 未返回完整五系统模型")[:200],
        }
        return None
    model = _repair(model)
    gate = validate_five_system_model(model, require_landing_page_ref=require_landing_page_ref)
    if not gate.get("passed"):
        # E37 门裁决回喂：确定性修复兜不住的裁决（骨架级悬空引用等），把门的
        # 具体 findings 喂回 LLM 有界重生成一次——错哪改哪，比盲重试/直接
        # fail-closed 都对。仍然失败才落 MODEL_GATE_BLOCKED（fail-closed 不变）。
        try:
            feedback = _format_gate_findings(gate.get("findings") or [])
            retry_model = generate_five_system_model(
                goal, llm_json_fn=llm_json_fn, gate_feedback=feedback
            )
        except Exception as exc:  # noqa: BLE001 — 回喂重试是增强项，失败不改变主路径语义
            print(f"[v5_capability_executor] gate-feedback retry skipped: {str(exc)[:120]}")
            retry_model = None
        if retry_model is not None:
            retry_model = _repair(retry_model)
            retry_gate = validate_five_system_model(retry_model, require_landing_page_ref=require_landing_page_ref)
            if retry_gate.get("passed"):
                model, gate = retry_model, retry_gate
    if not gate.get("passed"):
        # Gate blocked — do NOT inject evidence. Caller stays fail-closed.
        findings = gate.get("findings") or []
        first = findings[0] if findings else {}
        # 人话化首条 finding（此前直接打 dict repr，UI 上是一屏工程术语）
        first_text = f"{first.get('path', '')}：{first.get('message', '')}".strip("：")
        _llm_generate_diagnostic = {
            "code": "MODEL_GATE_BLOCKED",
            "detail": f"结构闸拦截（{len(findings)} 项，已回喂裁决重试仍未过门）：{first_text[:160]}",
        }
        return None
    _llm_generate_diagnostic = {}
    # 身份主题生成已整段移除（2026-08-03，用户裁决：全站一个颜色）。
    #
    # 原来这里会调 enrich_identity_theme：花 ~74s 生一张参照图，喂给视觉 LLM，
    # 取回一个 {label, seed} 种子色写进 appIdentity.generatedTheme，前端再由它
    # 派生整套色板。那张图从不展示给任何人——用一次生图换一个色值。
    #
    # 现在颜色在前端定死（live-runtime/identity-themes.ts 的 BRAND_SEED），
    # 后端不再产出任何配色。存量应用库里的 generatedTheme 字段读到即忽略，
    # 不需要迁移。
    #
    # 注：两段 enrich 的墙钟埋点在各自函数内部（freeform.total / monitor.total），
    # 不在这里——这条链路还有 fresh_topic_shot / 夹具再生成两个入口，
    # 埋在调用点会漏掉它们。
    try:
        from .freeform_block import enrich_freeform_blocks

        model = enrich_freeform_blocks(model)
    except Exception as exc:  # noqa: BLE001 — 二段生成是增强项，故障不改变主路径语义
        print(f"[v5_capability_executor] freeform block enrichment skipped: {str(exc)[:160]}")
    # 参照板收集槽：总览页设计会先画一张参照板给设计 LLM 照着排，那张图同时
    # 也正是应用中心卡片该显示的画面（见 services/app_preview.py）。槽在这里
    # 创建、下面落库时读——**只有闭环发布这条路径收集**；脚本调用方不传槽就
    # 什么都不收，产出的 model.json 和仓库里冻结的域夹具不会混进几 MB base64。
    preview_sink = None
    try:
        from .app_preview import OverviewPreviewSink

        preview_sink = OverviewPreviewSink()
    except Exception as exc:  # noqa: BLE001 — 缩略图是增强项
        print(f"[v5_capability_executor] preview sink unavailable: {str(exc)[:160]}")
    # 首页/monitor 页面的总览区块也交给 FreeformInsight 设计——同样是增强项，
    # 放在 identity 主题之后（配色要照 generatedTheme 走）；失败/未声明就照旧
    # 落回 AppRuntimeScreen 里固定的 stats/charts/rankings/feeds 骨架，不影响
    # 主路径。
    try:
        from .freeform_block import enrich_monitor_page_overviews

        model = enrich_monitor_page_overviews(model, preview_sink=preview_sink)
    except Exception as exc:  # noqa: BLE001 — 首页设计是增强项，故障不改变主路径语义
        print(f"[v5_capability_executor] monitor overview enrichment skipped: {str(exc)[:160]}")
    # 过门 + 增强完的完整设计模型持久化进 App Store（组建库地基）。fail-open：
    # 存储层任何异常（DB 连不上/建表失败/序列化问题）都不能拖垮闭环发布——
    # 跟上面几段增强一个纪律。dedup_key = 会话+模型内容签名，同会话反复落同一
    # 模型只更新一条、不堆重复。
    try:
        from . import app_store

        # 2026-07-27（审查修复 #3/D10）：同会话模型有变 → 同 root 新版本
        # （血缘/版本链/v2 徽标由此激活），不再每次精修都新建孤儿 root、
        # 画廊堆同名重复卡。模型未变仍走 dedup 幂等更新。
        from .request_context import current_user_id

        app_store.save_app_or_version(
            model, goal=goal, session_id=session_id, gate_passed=True,
            # 归属：谁推演出来的就归谁（推演路由已把它放进 contextvar）。
            # 拿不到就落成无主——语义在 app_access 里定义好了（可读、不可写），
            # 不能为了拿归属而让闭环失败。
            owner_id=current_user_id(),
            # 没收到图（生图失败/预算撞顶/这个应用没有总览页）传 None——落库侧
            # 按"保留既有那张"处理，不会把已有卡片打回活渲染。
            preview_png_b64=preview_sink.png_b64 if preview_sink else None,
        )
    except Exception as exc:  # noqa: BLE001 — 存储是增强项，故障不改变主路径语义
        print(f"[v5_capability_executor] app store save skipped: {str(exc)[:160]}")
    artifacts = model_to_linkage_artifacts(model, goal)
    return {a["id"].replace("llm-linkage-", ""): a for a in artifacts}


def _build_per_skill_evidence(
    state: V5SessionState,
    blocked_signal: bool,
    goal: str = "",
    *,
    llm_json_fn: Optional[Callable[[str], Any]] = None,
    force_llm: bool = False,
) -> Dict[str, Any]:
    global _llm_generate_diagnostic
    _llm_generate_diagnostic = {}
    # E29 精修/回退：上下文在场时模型权威 = 生成层结果（精修版或直供版），
    # 跳过旧产物 haystack 匹配——否则旧 linkage 产物会把新模型顶掉。
    from . import v5_llm_generate as _gen_mod

    _refine_active = bool(
        _gen_mod.get_refine_context() or _gen_mod.get_model_override()
    )
    # override 是直供历史快照，旧模型无 landingPageRef 仍应恢复；
    # refine 是首次生成/精修，严格要求 landingPageRef。
    _is_override = bool(_gen_mod.get_model_override())
    matches: Dict[str, Dict[str, Any]] = {}
    for artifact in ([] if _refine_active else _artifact_dicts(state)):
        haystack = " ".join(
            str(artifact.get(key, "") or "").lower()
            for key in ("id", "title", "kind", "summary")
        )
        for skill in REQUIRED_EVIDENCE_KEYS:
            if skill in haystack and skill not in matches:
                matches[skill] = artifact

    recognized_domain = None if _refine_active else _recognize_domain(goal)
    if _refine_active and not blocked_signal:
        # 精修/回退：走 LLM 生成分支（override 时生成层不调 LLM 直接返回快照）
        # override 路径传 False（历史快照无 landingPageRef 仍可恢复）；
        # refine 路径传 True（精修是新产物，必须声明首屏）。
        llm_result = _try_llm_generate_evidence(
            goal, llm_json_fn,
            require_landing_page_ref=not _is_override,
            session_id=getattr(state, "sessionId", None),
        )
        if llm_result is not None:
            for skill in REQUIRED_EVIDENCE_KEYS:
                matches[skill] = llm_result[skill]
        else:
            # D2 修复（2026-07-27 迭代体验审查）：精修失败（LLM 网关抖动/
            # 输出截断/过不了闸）不得摧毁已收口的 6/6 闭环——此前六段证据
            # 全空 → blocked 0/6 覆盖 publishClosure，能跑的应用直接消失且
            # 无 UI 恢复入口。退路：用精修前的现有模型原样重建证据，等价
            # "本轮修改未生效"，诊断照留（用户能看到失败原因），应用照跑。
            ctx = _gen_mod.get_refine_context()
            base_model = (ctx or {}).get("model") if isinstance(ctx, dict) else None
            if not isinstance(base_model, dict):
                base_model = _gen_mod.get_model_override()
            if isinstance(base_model, dict):
                from .v5_llm_generate import model_to_linkage_artifacts

                keep = model_to_linkage_artifacts(base_model, goal)
                keep_by_skill = {a["id"].replace("llm-linkage-", ""): a for a in keep}
                for skill in REQUIRED_EVIDENCE_KEYS:
                    if skill in keep_by_skill:
                        matches[skill] = keep_by_skill[skill]
                detail = str((_llm_generate_diagnostic or {}).get("detail") or "")[:160]
                print(
                    "[v5_capability_executor] refine failed, keeping previous model "
                    f"(本轮修改未生效): {detail}"
                )
    elif not blocked_signal and recognized_domain is not None:
        # Deterministic domain (purchase/leave/ticket/onboarding) — fast fixture path,
        # no LLM call. This is the T1 generality proof.
        # 修复（07-27 实测事故）：haystack 只按关键词认产物，推演自产的
        # "appbundle.runtimeClosure" 这类壳产物 id 里含 "appbundle"，会抢占
        # skill 槽位，把真正携带模型段（_model_section）的夹具产物挡在门外
        # ——appIdentity/generatedTheme 因此从未到达前端（六系统唯 appbundle
        # 丢 modelSection，右栏主题恒回落 azure 默认）。规则：携带模型段的
        # 产物优先于不带模型段的 haystack 壳。
        for skill in REQUIRED_EVIDENCE_KEYS:
            existing = matches.get(skill)
            if existing is None or "_model_section" not in existing:
                matches[skill] = _runtime_linkage_artifact_for_skill(skill, goal, recognized_domain)
    elif not blocked_signal and recognized_domain is None and (force_llm or _llm_generate_enabled() or llm_json_fn is not None):
        # T3: novel intent — ask the LLM to generate a five-system model, then run
        # it through the structural gate. Only gate-PASSED models inject evidence;
        # gate failure / LLM unavailable stays fail-closed (0/6). "失败由 gate 拦截而非静默".
        llm_result = _try_llm_generate_evidence(
            goal, llm_json_fn, session_id=getattr(state, "sessionId", None)
        )
        if llm_result is not None:
            # 同上：LLM 生成的产物携带 _model_section，不能被 haystack 壳
            # 产物（如自产的 appbundle.runtimeClosure）抢占槽位。
            for skill in REQUIRED_EVIDENCE_KEYS:
                existing = matches.get(skill)
                if existing is None or "_model_section" not in existing:
                    matches[skill] = llm_result[skill]
    elif not blocked_signal and recognized_domain is None and (goal or "").strip():
        # 新颖意图但 LLM 生成未开启 → 注定 0/6。把原因留痕给 blocker，
        # 否则用户只看到笼统的 closure blocked，无从排查。
        _llm_generate_diagnostic = {
            "code": "LLM_GENERATE_DISABLED",
            "detail": "SLIDERULE_LLM_GENERATE_ENABLED 未开启：新颖意图不会调用 LLM 生成五系统模型",
        }

    per_skill: Dict[str, Any] = {}
    for skill in REQUIRED_EVIDENCE_KEYS:
        artifact = matches.get(skill)
        evidence_present = artifact is not None and not (blocked_signal and skill == "aigc")
        artifact_id = artifact.get("id") if artifact else None
        digest = (
            hashlib.sha256(str(artifact_id).encode("utf-8")).hexdigest()[:16]
            if artifact_id
            else None
        )
        per_skill[skill] = {
            "evidencePresent": evidence_present,
            "evidenceRef": f"evidence:{skill}:{artifact_id or 'missing'}",
            "path": f"skills/{skill}/closure-evidence.json",
            "artifactId": artifact_id,
            "digest": digest,
        }
        # Gate-PASSED model section rides along as PAYLOAD ONLY: it is not part
        # of the evidence-match haystack, and _stable_closure_hash reads named trust
        # fields only — modelSection can never flip evidencePresent/blocked/hash.
        # E35: deterministic domains (purchase/leave/ticket/onboarding) now carry a
        # frozen gate-PASSED builtin model (services/data/builtin_domain_models.json)
        # so the app stage renders after closure; missing fixture degrades honestly.
        model_section = artifact.get("_model_section") if isinstance(artifact, dict) else None
        if evidence_present and model_section is not None:
            per_skill[skill]["modelSection"] = model_section
    return per_skill


def _stable_closure_hash(per_skill: Dict[str, Any], blocked: bool, goal: str) -> tuple[str, str]:
    parts = []
    for skill in REQUIRED_EVIDENCE_KEYS:
        evidence = per_skill.get(skill) or {}
        parts.append(
            "|".join(
                [
                    skill,
                    "1" if evidence.get("evidencePresent") else "0",
                    str(evidence.get("artifactId") or ""),
                    str(evidence.get("digest") or ""),
                    str(evidence.get("evidenceRef") or ""),
                ]
            )
        )
    source = f"appbundle.runtimeClosure|{goal}|{'blocked' if blocked else 'closed'}|{'/'.join(parts)}"
    return (
        hashlib.sha256(source.encode("utf-8")).hexdigest()[:8],
        hashlib.sha256(f"stable|{source}".encode("utf-8")).hexdigest()[:8],
    )


def _skill_runtime_graph_payload() -> Dict[str, Any]:
    """闭环结果里的跨系统运行时图（确定性，闭环成败共用同一份结构）。"""
    return {
        "edges": RUNTIME_CLOSURE_EDGES[:],
        "bySkill": {
            skill: [
                edge
                for edge in RUNTIME_CLOSURE_EDGES
                if edge["sourceSkill"] == skill or edge["targetSkill"] == skill
            ]
            for skill in REQUIRED_EVIDENCE_KEYS
        },
        "evidenceBySkill": {
            skill: [
                edge["evidenceKey"]
                for edge in RUNTIME_CLOSURE_EDGES
                if edge["sourceSkill"] == skill or edge["targetSkill"] == skill
            ]
            for skill in REQUIRED_EVIDENCE_KEYS
        },
    }


def build_fallback_blocked_closure(state: V5SessionState, goal: str, error_message: str) -> Dict[str, Any]:
    """E37 fail-closed 兜底：闭环重建能力执行炸掉时的确定性 blocked 闭环。

    此前 execute 抛异常只记 error run、不落闭环产物——回合"正常完成"却
    publishClosure 为 null，右侧是一块假装什么都没发生的空看板（用户实测
    案例）。无声无闭环比诚实 blocked 更糟：这里零 LLM 构造一个 0/n blocked
    闭环，blocker 带上真实失败原因，UI 走既有的「发布检查未通过」通道。
    """
    per_skill = _build_per_skill_evidence(state, True, goal)
    closure_hash, stable_digest = _stable_closure_hash(per_skill, True, goal)
    return {
        "title": "appbundle.runtimeClosure (fallback)",
        "summary": "runtime closure rebuild failed; deterministic blocked closure recorded",
        "content": f"closure rebuild failed: {error_message[:200]}",
        "provenance": "python-deterministic",
        "sources": [],
        "runtimeClosure": {
            "skillsChecked": REQUIRED_EVIDENCE_KEYS[:],
            "versionPinsChecked": True,
            "crossSkillRuntimeEdges": RUNTIME_CLOSURE_EDGES[:],
            "perSkill": {},
        },
        "skillRuntimeGraph": _skill_runtime_graph_payload(),
        "perSkillEvidence": per_skill,
        "blocked": True,
        "blockers": [
            {
                "code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
                "path": "runtimeClosure.perSkillEvidence",
                "affectedSkill": "",
                "ref": "",
            },
            {
                "code": "CLOSURE_REBUILD_FAILED",
                "path": "runtimeClosure.rebuild",
                "affectedSkill": "",
                "ref": str(error_message or "")[:200],
            },
        ],
        "closureId": "appbundle:app_purchase_approval@1.0.0:runtime-closure",
        "closureHash": closure_hash,
        "stableDigest": stable_digest,
        "findingsByTier": {
            "hard_blocker": [
                {"code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED"},
                {"code": "CLOSURE_REBUILD_FAILED"},
            ],
            "warning": [],
            "info": [],
        },
    }


def execute_v5_capability(capability_id: str, state: V5SessionState, input_ids: List[str], role_id: str, turn_id: str) -> Any:
    goal = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal)
    evidence = retrieve_evidence(goal + " for " + capability_id, top_k=10)
    content = generate_with_rag(f"Full V5 execution for {capability_id} on {goal}. Must include external evidence from RAG.", evidence)

    provenance = "python-rag"
    if "mcp" in capability_id or "skill" in capability_id:
        summary = "Retrieved external evidence via tool/skill"
    elif "report" in capability_id:
        summary = "Retrieved external evidence and generated a report"
        # 人类可读的证据摘要行（不要 dict 转储进报告正文）
        top = evidence[0] if evidence else None
        top_line = (
            f"{top.get('content', '')}（来源: {top.get('source', '?')} · 置信 {top.get('score', 0)} · 检索方式 {top.get('retrieval', 'keyword')}）"
            if isinstance(top, dict)
            else ""
        )
        content = f"【支撑证据】{top_line}\n\n{content}"
    elif "evidence" in capability_id:
        summary = "Retrieved external evidence"
    else:
        summary = "Stable V5 execution with evidence"

    base = ExecuteCapabilityResult(
        title=f"{capability_id} (Full Migration)",
        summary=summary,
        content=content,
        provenance=provenance,
        sources=evidence,
        toolName=capability_id if "mcp" in capability_id else None,
        skillName=capability_id if "skill" in capability_id else None,
    )
    if "appbundle" in capability_id.lower() or "runtimeclosure" in capability_id.lower():
        blocked_signal = "blocked" in capability_id.lower() or "blocked" in goal.lower()
        per_skill = _build_per_skill_evidence(state, blocked_signal, goal)
        blocked = any(not item.get("evidencePresent") for item in per_skill.values())
        closure_hash, stable_digest = _stable_closure_hash(per_skill, blocked, goal)
        # LLM 生成路径的失败原因随 blocker 透出（诊断留痕，不参与 blocked/hash 判定）。
        llm_diag = dict(_llm_generate_diagnostic) if _llm_generate_diagnostic.get("code") else None
        blockers = (
            [
                {
                    "code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
                    "path": "runtimeClosure.perSkillEvidence",
                    "affectedSkill": "aigc" if blocked_signal else "",
                    "ref": "",
                }
            ]
            if blocked
            else []
        )
        hard_findings = [{"code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED"}] if blocked else []
        if blocked and llm_diag:
            diag_blocker = {
                "code": llm_diag["code"],
                "path": "llmGenerate.fiveSystemModel",
                "affectedSkill": "",
                "ref": llm_diag.get("detail", "")[:200],
            }
            blockers.append(diag_blocker)
            hard_findings.append({"code": llm_diag["code"]})
        result = base.model_dump()
        result.update(
            {
                "runtimeClosure": {
                    "skillsChecked": REQUIRED_EVIDENCE_KEYS[:],
                    "versionPinsChecked": True,
                    "crossSkillRuntimeEdges": RUNTIME_CLOSURE_EDGES[:],
                    "perSkill": {},
                },
                "skillRuntimeGraph": {
                    "edges": RUNTIME_CLOSURE_EDGES[:],
                    "bySkill": {
                        skill: [
                            edge
                            for edge in RUNTIME_CLOSURE_EDGES
                            if edge["sourceSkill"] == skill or edge["targetSkill"] == skill
                        ]
                        for skill in REQUIRED_EVIDENCE_KEYS
                    },
                    "evidenceBySkill": {
                        skill: [
                            edge["evidenceKey"]
                            for edge in RUNTIME_CLOSURE_EDGES
                            if edge["sourceSkill"] == skill or edge["targetSkill"] == skill
                        ]
                        for skill in REQUIRED_EVIDENCE_KEYS
                    },
                },
                "perSkillEvidence": per_skill,
                "blocked": blocked,
                "blockers": blockers,
                "closureId": "appbundle:app_purchase_approval@1.0.0:runtime-closure",
                "closureHash": closure_hash,
                "stableDigest": stable_digest,
                "findingsByTier": {
                    "hard_blocker": hard_findings,
                    "warning": [],
                    "info": [],
                },
            }
        )
        return result
    return base
