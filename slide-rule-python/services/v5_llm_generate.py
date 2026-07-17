"""
T3 — LLM generate() for the five-system model.

Produces a five-system (six-section) enterprise-app metamodel from a free-text
intent, targeting the exact shape validate_five_system_model() checks. The
LLM output is ALWAYS run through the structural gate by the caller; this module
only produces a candidate.

North-star discipline (先证通用性，再接 LLM；别把两件事耦合):
    generate_five_system_model(goal, *, llm_json_fn=None)
      - llm_json_fn is injectable. Default wraps call_llm_json_with_shape.
      - Tests pass a fake llm_json_fn so gate/closure logic is verified with
        NO real key and NO network.
      - No key / LLM error / unparseable => returns None (never raises,
        never a silent stub). Caller treats None as fail-closed.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

# Sections the model must contain — mirrors v5_model_gate.SKILL_KEYS.
_REQUIRED_SECTIONS = ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")

# The JSON contract handed to the LLM. Kept explicit so the model emits exactly
# the shape the gate validates (cross-refs must be internally consistent).
_SCHEMA_INSTRUCTION = """\
You are an enterprise-application metamodel designer. Given a business intent,
produce a SINGLE JSON object modelling FIVE interlocking systems. Output ONLY
valid JSON (no prose, no markdown fences). Every cross-system reference MUST
resolve to a node you define in this same object — dangling references will be
rejected by a structural gate.

Required shape (use these exact keys):
{
  "datamodel": {
    "entities": [
      {"id": "<snake_case>", "name": "<label>", "fields": [
        {"id": "<snake_case>", "name": "<label>", "type": "string|number|date|ref|enum",
         "options": [{"id": "<value>", "label": "<label>", "tone": "success|processing|warning|danger|default"}],
         "format": "money|percent|progress|score|rating|masked"}
      ]}
    ]
  },
  "rbac": {
    "roles": ["<role_id>", ...],
    "permissions": ["<resource>:<action>", ...],
    "menus": [{"id": "<id>", "label": "<label>", "roleRefs": ["<role_id>"], "permissionRefs": ["<perm>"]}]
  },
  "workflow": {
    "id": "<workflow_id>",
    "name": "<label of the PRIMARY chain — the core business object lifecycle>",
    "nodes": [{"id": "<id>", "name": "<label>", "assigneeRole": "<role_id>", "phase": "<stage label>"}],
    "transitions": [{"from": "<node_id>", "to": "<node_id>", "condition": "<optional>"}],
    "chains": [
      {"id": "<chain_id>", "name": "<label>", "kind": "money|lifecycle|governance|recovery",
       "nodes": [{"id": "<id>", "name": "<label>", "assigneeRole": "<role_id>", "phase": "<stage label>"}],
       "transitions": [{"from": "<node_id>", "to": "<node_id>", "condition": "<optional>"}]}
    ]
  },
  "page": {
    "pages": [{"id": "<id>", "name": "<label>",
               "kind": "workbench|kanban|calendar|dashboard",
               "statusField": "<entity_id>.<field_id> (kanban only)",
               "dateField": "<entity_id>.<field_id> (calendar only)",
               "colorBy": "<entity_id>.<field_id> (calendar only, optional)",
               "fieldBindings": ["<entity_id>.<field_id>"],
               "actionPermissions": ["<resource>:<action>"],
               "stats": [
                 {"id": "<id>", "name": "<label>", "entity": "<entity_id>",
                  "metric": "count|sum:<entity_id>.<field_id>|avg:<entity_id>.<field_id>",
                  "format": "number|money|percent"}
               ],
               "charts": [
                 {"id": "<id>", "name": "<label>", "type": "bar|line|pie",
                  "dimension": "<entity_id>.<field_id>",
                  "metric": "count|sum:<entity_id>.<field_id>"}
               ]}]
  },
  "aigc": {
    "capabilities": [{"id": "<id>", "name": "<label>",
                      "inputFields": ["<entity_id>.<field_id>"],
                      "outputField": "<entity_id>.<field_id>",
                      "roleRefs": ["<role_id>"]}],
    "pipelines": [
      {"id": "<id>", "name": "<label>", "steps": ["<capability_id>", "<capability_id>"]}
    ]
  },
  "appbundle": {
    "pageBindings": [{"pageRef": "<page_id>", "workflowRef": "<workflow_id_or_node_id>"}],
    "roleRefs": ["<role_id>"],
    "dataModelRefs": ["<entity_id>"],
    "invariants": [
      {"id": "<snake_case>", "statement": "<one-sentence declarative constraint>",
       "systems": ["datamodel|rbac|workflow|page|aigc"],
       "refs": ["<entity_id or entity_id.field_id or role_id or permission or workflow/chain node_id or aigc capability id>"]}
    ]
  }
}

Rules:
- Every workflow node assigneeRole MUST be in rbac.roles.
- Every page fieldBinding MUST be "<entityId>.<fieldId>" from datamodel.
- Every page actionPermission MUST be in rbac.permissions.
- Every aigc input/output field MUST be from datamodel; roleRefs from rbac.roles.
- appbundle pageRef∈pages, workflowRef∈workflow, roleRefs∈roles, dataModelRefs∈entities.
- Model the SPECIFIC business the intent describes (entities, roles, approval
  steps, pages that fit that domain). Do not emit a generic template.
- PHASES (swimlanes): give EVERY workflow node a "phase" — a short stage label
  in the intent's language (e.g. 申请 / 审核 / 执行 / 验收). Use 2-4 phases
  total; nodes of the same phase must be consecutive along the main flow.

Content-quality rules (checked by a deterministic regression gate):
- REACHABILITY: every permission listed in a page's actionPermissions MUST be
  granted to at least one role via rbac.menus[].permissionRefs — a page whose
  permissions no role holds is unreachable for everyone (hard failure).
- LEAST PRIVILEGE: spread permissions across roles by duty; no single role
  should hold (almost) all permissions. Every declared permission should be
  granted to at least one role.
- FLOW SHAPE: the workflow MUST contain at least one conditional branch and a
  rejection/return path (e.g. a transition back to an earlier node or to a
  terminal "rejected/cancelled" node) — never a single straight line.
- NO ORPHANS: every entity should be referenced by at least one page
  fieldBinding, aigc field, or another entity's ref field.
- MULTI-CHAIN COVERAGE: real systems run on SEVERAL business chains, not one
  approval flow. The top-level workflow (id/nodes/transitions) is the PRIMARY
  chain: the lifecycle of the core business object (e.g. order/task/case:
  create → validate/charge → execute → archive). Then add 1-3 more chains in
  "chains", each with a distinct kind:
    * "money"      — funds movement (order → pay → server-side confirm → credit
                     account → audit trail), if the intent involves payment/billing;
    * "governance" — approval/review flow, if the domain needs one;
    * "recovery"   — compensation/retry/cleanup for failures, when async work exists.
  Every chain follows the same node/transition rules (assigneeRole ∈ rbac.roles,
  phase labels, at least one branch or return path). Node ids must be unique
  ACROSS all chains. Do NOT duplicate the primary chain inside "chains".
- PIPELINES (agent orchestration): when two or more capabilities naturally
  chain — one capability's outputField feeds another's inputFields — declare
  1-2 "pipelines" (2-4 steps each, steps are capability ids in execution
  order). HARD RULE: for every adjacent pair, the previous capability's
  outputField MUST literally appear in the next capability's inputFields —
  that field IS the handoff (orchestration is wired through datamodel fields,
  not loose prose). Do NOT force pipelines when capabilities are unrelated;
  omit "pipelines" entirely in that case.
- CHARTS (library-agnostic): pages whose job includes monitoring/analytics
  (dashboards, finance, audit, ops) should declare 1-2 "charts". A chart is a
  SEMANTIC declaration — what to visualize, never which UI library renders it:
  "dimension" is the grouping field (enum/status/category/date fields work
  best), "metric" is either "count" (rows per group) or "sum:<entity.field>"
  over a number field. Both MUST reference real datamodel fields. "type" picks
  the form by the data's job: bar = compare magnitudes across categories,
  line = change over an ordered/date dimension, pie = share of a whole with
  FEW (≤5) categories. Pure CRUD pages need no charts.
- ENUM OPTIONS (status semantics): EVERY enum field MUST declare "options" —
  2-6 concrete values in the intent's language, each with a "tone" carrying
  its color semantics: success = positive/done (已通过/已完成), processing =
  in-flight (进行中/审核中), warning = waiting/attention (待审批/即将到期),
  danger = risk/failure (已驳回/高风险), default = neutral (草稿/未开始).
  Status-machine fields (审批状态/优先级/风险等级/阶段) matter most — the
  runtime renders these as colored badges, kanban columns and filters.
  Never declare "options" on a non-enum field.
- FIELD FORMAT (display semantics, optional): declare "format" only when a
  field has one canonical rendering — number fields: "money" (amounts, ¥),
  "percent" (rates 0-100), "progress" (completion 0-100 → progress bar),
  "score" (0-100 evaluation), "rating" (1-5 stars); string fields: "masked"
  (phone/ID-card — sensitive, rendered partially hidden). Omit for plain
  values; NEVER put a format on date/ref/enum fields.
- STATS (KPI cards): pages whose job includes overview/monitoring should
  declare 2-4 "stats" — headline metric cards rendered above the page table.
  "entity" scopes count; sum/avg must target a number field. Same
  field-existence rules as charts. Pure CRUD pages need none.
- PAGE KIND (view paradigm): pick each page's "kind" by its job — omit or
  "workbench" (default) for CRUD tables; "kanban" when the core object flows
  through stages (跟进/审批/生产状态) — REQUIRES "statusField" naming an enum
  field (with options) of this page's entity, columns come from its options;
  "calendar" when rows live on dates (排期/预约/计划) — REQUIRES "dateField"
  naming a date field of this page's entity, optional "colorBy" naming an
  enum field for event coloring; "dashboard" for overview/monitoring pages —
  give those 2-4 stats and 1-2 charts (charts render wide, table shrinks).
  Use at most one kanban and one calendar page; never force a paradigm the
  domain doesn't need.
- INVARIANTS: emit 5-8 entries in "appbundle.invariants" — declarative constraints that
  must always hold, the kind an architect writes after a production incident
  (ordering: "charge before calling the upstream provider"; source of truth:
  "payment status changes only via server-side verified callback"; durability:
  "generated remote media must be re-hosted to owned storage"; traceability:
  "every balance change must have a ledger row"). Each invariant MUST ground
  itself via "refs" pointing at ids that exist in THIS model (entity, field,
  role, permission, or workflow/chain node) and "systems" naming the sections
  it constrains. Write statements in the intent's language. No vague platitudes
  ("system should be secure") — each must be checkable against the model.
"""


# 最近一次生成的诊断（供 publish closure 的 blocker 面向用户透出失败原因；
# fail-closed 判定完全不读它——它只是留痕，不参与 trust/gate）。
last_generate_diagnostic: Dict[str, Any] = {}

# 实时增量回调（推演可观测性）：驱动层注册后，五系统 LLM 生成的内容增量会
# 逐块推给它（SSE llm_delta → 前端左栏实时草稿）。只是观测钩子——不参与
# 生成结果、gate、trust 判定；回调异常被吞掉，永不影响调用本身。
# 注意：模块级单 sink，多会话并发时增量会交织（本地单人 dev 可接受）。
_delta_sink: Optional[Callable[[str], None]] = None


def set_generate_delta_sink(sink: "Optional[Callable[[str], None]]") -> None:
    global _delta_sink
    _delta_sink = sink


# 已安装技能（技能库六期"推演注入"）：/drive-full(-stream) 在请求进入时设置、
# 结束后清空——与 _delta_sink 同一请求域上下文模式（同样的单进程并发注意事项）。
_installed_skills: List[Dict[str, str]] = []


def set_installed_skills(skills: "Optional[List[Dict[str, Any]]]") -> None:
    """设置本轮推演要注入的已安装技能（清洗：上限 6 条，name/description 截断）。

    传 None / 空列表即清空——无安装时生成 prompt 与历史逐字节一致。
    """
    global _installed_skills
    cleaned: List[Dict[str, str]] = []
    for raw in skills or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()[:60]
        if not name:
            continue
        cleaned.append({"name": name, "description": str(raw.get("description") or "").strip()[:160]})
        if len(cleaned) >= 6:
            break
    _installed_skills = cleaned


# E29 增量迭代：精修/回退上下文（与 _installed_skills 同一请求域模式）。
# refine：带当前模型 + 补充指令，让 LLM 在现有设计上做增量修改；
# override：直接以给定模型为生成结果（版本回退用，不调 LLM）。
_refine_context: Optional[Dict[str, Any]] = None
_model_override: Optional[Dict[str, Any]] = None


def set_refine_context(model: "Optional[Dict[str, Any]]", instruction: str = "") -> None:
    """设置本轮精修上下文：现有五系统模型 + 用户补充指令。传 None 清空。"""
    global _refine_context
    _refine_context = (
        {"model": model, "instruction": str(instruction or "").strip()[:2000]}
        if model
        else None
    )


def set_model_override(model: "Optional[Dict[str, Any]]") -> None:
    """设置模型直供（版本回退）：生成层原样返回该模型，不调 LLM；
    结构闸照常校验。传 None 清空。"""
    global _model_override
    _model_override = model if isinstance(model, dict) else None


def _emit_delta(chunk: str) -> None:
    sink = _delta_sink
    if sink is None:
        return
    try:
        sink(chunk)
    except Exception:
        pass

# _default_llm_json_fn 内部最近一次调用失败的原因（LlmError / 异常文本）。
_last_call_error: str = ""


def _build_user_content(goal: str) -> str:
    """用户消息装配：意图 + （命中时）业界参考技能块。

    参考块来自宽松协议开源技能语料（v5_skill_reference，技能库二期）——
    只给命名与输入输出风格的 few-shot 氛围，明确指示不复制内容；
    语料缺失或与意图无关时不加块，prompt 与从前逐字节一致。
    """
    parts = [f"Business intent:\n{goal}"]
    # ①已安装技能（硬要求）：每项必须落成一条 aigc.capabilities，字段绑定
    # 到真实 datamodel 实体字段——门禁仍然硬校验，绑不上会被拦（不豁免）。
    if _installed_skills:
        lines = [
            "User-installed skills (REQUIRED: for EACH one below, include a matching "
            "entry in aigc.capabilities with inputFields/outputField bound to real "
            "datamodel entity fields of this app):"
        ]
        for skill in _installed_skills:
            desc = f" — {skill['description']}" if skill["description"] else ""
            lines.append(f"- {skill['name']}{desc}")
        parts.append("\n".join(lines))
    # ②业界参考技能（软参考）：只借命名与 IO 风格
    try:
        from .v5_skill_reference import reference_prompt_block

        block = reference_prompt_block(goal)
        if block:
            parts.append(block)
    except Exception:
        pass  # 参考语料是增强项，任何异常都不拦生成主路径
    # E29 精修：把现有模型与补充指令给到 LLM——在现有设计上做最小增量修改，
    # 与设计无关的指令要求原样返回（版本判等后不记新版本）。
    if _refine_context:
        import json as _json

        try:
            model_json = _json.dumps(_refine_context["model"], ensure_ascii=False)
        except (TypeError, ValueError):
            model_json = "{}"
        parts.append(
            "REFINE MODE — an approved five-system model for this app already "
            "exists. Apply the user's follow-up instruction as a MINIMAL "
            "incremental edit on top of it. Keep every id/field not affected "
            "by the instruction byte-identical. If the instruction does not "
            "ask for any design change, return the current model unchanged.\n"
            f"Current model JSON:\n{model_json}\n"
            f"Follow-up instruction:\n{_refine_context['instruction']}"
        )
    parts.append("Produce the five-system JSON now.")
    return "\n\n".join(parts)


def _structured_llm_json_fn(messages: list) -> Optional[Dict[str, Any]]:
    """P3 结构化通道（instructor 错误回喂）：校验失败把「上次输出+具体报错」
    拼回消息让模型自我修正——替代盲重采样。失败返回 None（调用方回落/留痕）。"""
    global _last_call_error
    try:
        from sliderule_llm.structured import (
            StructuredLlmError,
            structured_llm_enabled,
            structured_llm_json,
        )
    except Exception:
        return None
    if not structured_llm_enabled():
        return None
    try:
        parsed = structured_llm_json(
            messages,
            required_keys=_REQUIRED_SECTIONS,
            temperature=0.2,
            max_tokens=8000,
            max_retries=2,
        )
        return parsed if isinstance(parsed, dict) else None
    except StructuredLlmError as exc:
        print(f"[v5_llm_generate] structured channel failed: {str(exc)[:200]}")
        _last_call_error = f"structured: {str(exc)[:160]}"
        return None


def _default_llm_json_fn(goal: str, gate_feedback: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Real LLM path — provider chain + JSON shape validation. None on any failure.

    P3（OSS_GAP_ANALYSIS）双通道互为救场：
    - 无流式 sink（后台驱动/评测）：结构化通道优先（错误回喂重试，治
      推理模型空正文/形状失败——F2 评测两模式闭环全 0 的元凶），失败回落旧通道；
    - 有流式 sink（交互 UI 要 llm_delta 直播）：旧流式通道优先保直播，
      失败用结构化通道救场（少看一段直播，换回一个能用的模型）。
    """
    global _last_call_error
    _last_call_error = ""
    try:
        from sliderule_llm.client import call_llm_json_with_shape, LlmError
    except Exception as exc:
        _last_call_error = f"llm client unavailable: {str(exc)[:160]}"
        return None
    user_content = _build_user_content(goal)
    if gate_feedback:
        # E37 门裁决回喂：上一版模型被结构门拦截时，把门的具体 findings
        # 原文喂回（错哪改哪）——比盲重试命中率高一个量级，与 P3 的
        # JSON 形状回喂互补（那层治缺段，这层治悬空引用/枚举违规）。
        user_content += (
            "\n\nIMPORTANT — your previous model FAILED the deterministic structural "
            "gate. Fix EXACTLY these violations and keep everything else unchanged:\n"
            + gate_feedback
        )
    messages = [
        {"role": "system", "content": _SCHEMA_INSTRUCTION},
        {"role": "user", "content": user_content},
    ]
    streaming = _delta_sink is not None
    if not streaming:
        parsed = _structured_llm_json_fn(messages)
        if parsed is not None:
            return parsed
    try:
        parsed, _result = call_llm_json_with_shape(
            messages,
            required_keys=_REQUIRED_SECTIONS,
            max_shape_retries=1,
            temperature=0.2,
            # 多链路 + 不变式后契约变大（原 4000 面向单链路模型）；截断会直接
            # 变成 shape 失败 → 重试 → fail-closed，宁可放宽。
            max_tokens=8000,
            # 瞬时错误（网关 502/503/超时）退避拉长：默认 200ms 扛不过几秒级
            # 的网关抖动（线上案例：blackaicoding 502 连吃三发）。
            backoff_ms=2000,
            # sink 已注册时走流式：内容增量实时推给 UI（llm_delta）。
            on_delta=_emit_delta if _delta_sink is not None else None,
        )
        return parsed if isinstance(parsed, dict) else None
    except LlmError as exc:
        # No key / rate limit / parse failure / shape failure — 流式主路失败先试
        # 结构化通道救场，救不回再 fail-closed 留痕。
        # 展示层人话化：剥 HTML 错误页、5xx 标注瞬时故障（不改 fail-closed 语义）。
        if streaming:
            rescued = _structured_llm_json_fn(messages)
            if rescued is not None:
                print("[v5_llm_generate] legacy stream failed; structured channel rescued")
                return rescued
        from services.llm_error_text import humanize_llm_error

        _last_call_error = f"LlmError: {humanize_llm_error(str(exc))[:180]}"
        print(f"[v5_llm_generate] LlmError: {str(exc)[:200]}")
        return None
    except Exception as exc:  # noqa: BLE001
        _last_call_error = f"{type(exc).__name__}: {str(exc)[:180]}"
        print(f"[v5_llm_generate] unexpected error: {str(exc)[:200]}")
        return None


def generate_five_system_model(
    goal: str,
    *,
    llm_json_fn: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    gate_feedback: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Generate a five-system model candidate for `goal`.

    Returns the raw model dict (NOT yet gated) or None if generation is
    unavailable/failed. The caller MUST run it through
    v5_model_gate.validate_five_system_model before trusting it.

    `llm_json_fn(goal) -> dict|None` is injectable for tests (fake LLM),
    keeping generality proof decoupled from LLM reliability.

    `gate_feedback`（E37）：上一版模型的结构门裁决文本。只作用于默认 LLM
    通道（注入 fn 的测试路径不受影响）——喂回后 LLM 定向改错重生成。
    """
    global last_generate_diagnostic
    last_generate_diagnostic = {}
    if not (goal or "").strip():
        return None
    # E29 版本回退：直供模型即生成结果（结构闸仍由调用方照常执行）
    if _model_override is not None:
        last_generate_diagnostic = {"outcome": "ok"}
        return dict(_model_override)
    if llm_json_fn is None and gate_feedback:
        fn: Callable[[str], Optional[Dict[str, Any]]] = (
            lambda g: _default_llm_json_fn(g, gate_feedback=gate_feedback)
        )
    else:
        fn = llm_json_fn or _default_llm_json_fn
    # 一次有界重试：并发/限流下的瞬时失败不该直接变成永久 publish blocked
    # （fail-closed 语义保留：两次都失败仍返回 None）。注入 fn 的测试不受影响。
    attempts = 2 if llm_json_fn is None else 1
    last_detail = ""
    for attempt in range(attempts):
        try:
            model = fn(goal)
        except Exception as exc:  # noqa: BLE001
            print(f"[v5_llm_generate] attempt {attempt + 1}/{attempts} raised: {str(exc)[:200]}")
            last_detail = f"{type(exc).__name__}: {str(exc)[:180]}"
            model = None
        if isinstance(model, dict) and all(section in model for section in _REQUIRED_SECTIONS):
            last_generate_diagnostic = {"outcome": "ok"}
            return model
        if model is not None:
            print(f"[v5_llm_generate] attempt {attempt + 1}/{attempts} returned incomplete model (missing sections)")
            last_detail = "LLM 返回的模型缺少必需的五系统段"
        else:
            print(f"[v5_llm_generate] attempt {attempt + 1}/{attempts} returned no model")
            last_detail = _last_call_error or last_detail or "LLM 未返回模型"
        if attempt + 1 < attempts:
            import time as _time

            _time.sleep(2.0)
    last_generate_diagnostic = {"outcome": "failed", "detail": last_detail}
    return None


def model_to_linkage_artifacts(model: Dict[str, Any], goal: str) -> List[Dict[str, Any]]:
    """Convert a gate-passed model into per-skill artifacts the closure evidence
    builder can match (id contains the skill key, so _build_per_skill_evidence
    picks them up). Deterministic; no LLM.

    The gate-PASSED model section rides along twice:
      - `_model_section` — structured payload consumed by _build_per_skill_evidence
        (becomes perSkillEvidence[skill].modelSection and the skill_result SSE field);
      - a fenced ```json block inside `content` so the section survives as plain
        artifact text too (the client parser reads fenced JSON from rawContent).
    Both are PAYLOAD ONLY: evidence matching hashes only id/title/kind/summary and
    the closure hash never includes them, so they cannot flip trust decisions.
    """
    import json as _json

    artifacts: List[Dict[str, Any]] = []
    for skill in _REQUIRED_SECTIONS:
        section = model.get(skill)
        summary = f"LLM-generated {skill} model for: {goal[:60]}"
        section_block = ""
        if section is not None:
            try:
                section_block = (
                    "\n\n```json\n"
                    + _json.dumps({skill: section}, ensure_ascii=False)
                    + "\n```"
                )
            except (TypeError, ValueError):
                section_block = ""  # unserializable payload — keep the artifact text-only
        artifacts.append({
            "id": f"llm-linkage-{skill}",
            "title": f"{skill} model (LLM generate)",
            "kind": "runtimeClosureEvidence",
            "summary": summary,
            "content": f"{skill} section of LLM-generated five-system model{section_block}",
            "provenance": "python-llm-generate",
            "_model_section": section,
        })
    return artifacts
