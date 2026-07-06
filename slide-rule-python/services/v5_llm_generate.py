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


def _default_llm_json_fn(goal: str) -> Optional[Dict[str, Any]]:
    """Real LLM path — provider chain + JSON shape validation. None on any failure."""
    try:
        from sliderule_llm.client import call_llm_json_with_shape, LlmError
    except Exception:
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
        )
        return parsed if isinstance(parsed, dict) else None
    except LlmError:
        # No key / rate limit / parse failure / shape failure — fail-closed.
        return None
    except Exception:
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
    if not (goal or "").strip():
        return None
    fn = llm_json_fn or _default_llm_json_fn
    try:
        model = fn(goal)
    except Exception:
        return None
    if not isinstance(model, dict):
        return None
    # Cheap presence check before handing to the gate (gate does the real work).
    if not all(section in model for section in _REQUIRED_SECTIONS):
        return None
    return model


def model_to_linkage_artifacts(model: Dict[str, Any], goal: str) -> List[Dict[str, Any]]:
    """Convert a gate-passed model into per-skill artifacts the closure evidence
    builder can match (id contains the skill key, so _build_per_skill_evidence
    picks them up). Deterministic; no LLM.
    """
    artifacts: List[Dict[str, Any]] = []
    for skill in _REQUIRED_SECTIONS:
        section = model.get(skill)
        summary = f"LLM-generated {skill} model for: {goal[:60]}"
        artifacts.append({
            "id": f"llm-linkage-{skill}",
            "title": f"{skill} model (LLM generate)",
            "kind": "runtimeClosureEvidence",
            "summary": summary,
            "content": f"{skill} section of LLM-generated five-system model",
            "provenance": "python-llm-generate",
            "_model_section": section,
        })
    return artifacts
