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
        {"id": "<snake_case>", "name": "<label>", "type": "string|number|date|ref|enum"}
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
    "nodes": [{"id": "<id>", "name": "<label>", "assigneeRole": "<role_id>"}],
    "transitions": [{"from": "<node_id>", "to": "<node_id>", "condition": "<optional>"}]
  },
  "page": {
    "pages": [{"id": "<id>", "name": "<label>",
               "fieldBindings": ["<entity_id>.<field_id>"],
               "actionPermissions": ["<resource>:<action>"]}]
  },
  "aigc": {
    "capabilities": [{"id": "<id>", "name": "<label>",
                      "inputFields": ["<entity_id>.<field_id>"],
                      "outputField": "<entity_id>.<field_id>",
                      "roleRefs": ["<role_id>"]}]
  },
  "appbundle": {
    "pageBindings": [{"pageRef": "<page_id>", "workflowRef": "<workflow_id_or_node_id>"}],
    "roleRefs": ["<role_id>"],
    "dataModelRefs": ["<entity_id>"]
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


def _default_llm_json_fn(goal: str) -> Optional[Dict[str, Any]]:
    """Real LLM path — provider chain + JSON shape validation. None on any failure."""
    global _last_call_error
    _last_call_error = ""
    try:
        from sliderule_llm.client import call_llm_json_with_shape, LlmError
    except Exception as exc:
        _last_call_error = f"llm client unavailable: {str(exc)[:160]}"
        return None
    messages = [
        {"role": "system", "content": _SCHEMA_INSTRUCTION},
        {"role": "user", "content": f"Business intent:\n{goal}\n\nProduce the five-system JSON now."},
    ]
    try:
        parsed, _result = call_llm_json_with_shape(
            messages,
            required_keys=_REQUIRED_SECTIONS,
            max_shape_retries=1,
            temperature=0.2,
            max_tokens=4000,
            # sink 已注册时走流式：内容增量实时推给 UI（llm_delta）。
            on_delta=_emit_delta if _delta_sink is not None else None,
        )
        return parsed if isinstance(parsed, dict) else None
    except LlmError as exc:
        # No key / rate limit / parse failure / shape failure — fail-closed，但留痕便于诊断。
        _last_call_error = f"LlmError: {str(exc)[:180]}"
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
) -> Optional[Dict[str, Any]]:
    """Generate a five-system model candidate for `goal`.

    Returns the raw model dict (NOT yet gated) or None if generation is
    unavailable/failed. The caller MUST run it through
    v5_model_gate.validate_five_system_model before trusting it.

    `llm_json_fn(goal) -> dict|None` is injectable for tests (fake LLM),
    keeping generality proof decoupled from LLM reliability.
    """
    global last_generate_diagnostic
    last_generate_diagnostic = {}
    if not (goal or "").strip():
        return None
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
