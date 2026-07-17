"""
Full port of Node's capability execution for V5.

Covers all from capability-exec-map, dialogue, deliberation, delivery, structure, visual, evidence, mcp, skill, report, risk, etc.

Uses RAG for external evidence and stable Python-side execution.
No Node LLM, no pool, no su8, no proxy issues, no template/degraded.
"""

from typing import Dict, Any, List, Callable, Optional
import hashlib
import os
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
DOMAIN_INTENT_MARKERS: Dict[str, List[str]] = {
    "purchase_approval": PURCHASE_APPROVAL_INTENT_MARKERS,
    "leave_approval": [
        "leave approval", "leave request", "请假审批", "请假单", "请假", "休假",
    ],
    "service_ticket": [
        "service ticket", "工单", "客户服务", "客服", "服务台", "ticket", "sla", "升级",
    ],
    "employee_onboarding": [
        "onboarding", "employee onboarding", "入职", "员工入职", "新员工", "报到",
    ],
}

# Human-readable domain names for evidence flavour text (deterministic).
DOMAIN_LABELS: Dict[str, str] = {
    "purchase_approval": "purchase approval",
    "leave_approval": "leave approval",
    "service_ticket": "service ticket",
    "employee_onboarding": "employee onboarding",
}


def _recognize_domain(goal: str) -> "str | None":
    """Return the recognized deterministic domain key, or None (fail-closed).

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
        if any(marker.lower() in variant for variant in variants for marker in markers):
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
        "summary": f"deterministic {label} six-Skill linkage evidence",
        "content": f"{skill} evidence for {label} runtime closure: {','.join(evidence_keys)}",
        "provenance": "python-runtime-linkage",
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
) -> Optional[Dict[str, Dict[str, Any]]]:
    """Generate + gate a five-system model for a novel intent.

    Returns {skill: artifact} for all 6 skills if the LLM model PASSES the
    structural gate; otherwise None (fail-closed). Never raises.
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
    gate = validate_five_system_model(model)
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
            retry_gate = validate_five_system_model(retry_model)
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
        getattr(_gen_mod, "_refine_context", None)
        or getattr(_gen_mod, "_model_override", None)
    )
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
        llm_result = _try_llm_generate_evidence(goal, llm_json_fn)
        if llm_result is not None:
            for skill in REQUIRED_EVIDENCE_KEYS:
                matches[skill] = llm_result[skill]
    elif not blocked_signal and recognized_domain is not None:
        # Deterministic domain (purchase/leave/ticket/onboarding) — fast fixture path,
        # no LLM call. This is the T1 generality proof; unchanged.
        for skill in REQUIRED_EVIDENCE_KEYS:
            if skill not in matches:
                matches[skill] = _runtime_linkage_artifact_for_skill(skill, goal, recognized_domain)
    elif not blocked_signal and recognized_domain is None and (force_llm or _llm_generate_enabled() or llm_json_fn is not None):
        # T3: novel intent — ask the LLM to generate a five-system model, then run
        # it through the structural gate. Only gate-PASSED models inject evidence;
        # gate failure / LLM unavailable stays fail-closed (0/6). "失败由 gate 拦截而非静默".
        llm_result = _try_llm_generate_evidence(goal, llm_json_fn)
        if llm_result is not None:
            for skill in REQUIRED_EVIDENCE_KEYS:
                if skill not in matches:
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
