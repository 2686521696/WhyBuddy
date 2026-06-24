"""Blueprint prompt package runtime takeover 104.

Python-owned validation/normalization/metadata slice for Blueprint prompt package.
- promptPackage: node-retained (full packaging, LLM, retention per 103)
- validationSlice: python-owned thin slice for validate/build minimal envelope

Python service validates or builds a minimal prompt package envelope.
Envelope includes ownership, takeover flag, and denominator accounting.
productionTakeover remains false for retained surface; slice is accounting only.
Node bridge verifies consumption and retained fallback.
Does not rewrite full prompt generation or change user-visible content.
"""

from __future__ import annotations

from typing import Any, Dict

CONTRACT_VERSION = "blueprint.prompt-package-runtime-takeover.v1"
PROVENANCE = "python-blueprint-prompt-package-runtime-takeover-104"

SURFACES = ("promptPackage", "validationSlice")


def _clean(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    text = str(value or "").strip()
    return text or fallback


def _error_envelope(code: str, message: str) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": code,
        "message": message,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
    }


def decide_blueprint_prompt_package_runtime_takeover(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Return prompt package runtime takeover decision envelope.

    Payload:
      - surface or area: one of SURFACES or "all"
      - simulate: { "forceNodeRetained": true }

    Ownership:
      - promptPackage: node-retained (real packaging retained)
      - validationSlice: python-owned (thin validate/normalize/metadata)
    productionTakeover always false for this boundary (slice only).
    """
    if payload is not None and not isinstance(payload, dict):
        return _error_envelope("invalid_payload", "payload must be object or null")

    simulate = payload.get("simulate") if isinstance(payload, dict) and isinstance(payload.get("simulate"), dict) else {}
    requested = _clean((payload or {}).get("surface") or (payload or {}).get("area") or (payload or {}).get("op"), "all")

    base_ownership: Dict[str, str] = {
        "promptPackage": "node-retained",
        "validationSlice": "python-owned",
    }

    if simulate.get("forceNodeRetained") or simulate.get("allRetained"):
        for k in list(base_ownership.keys()):
            base_ownership[k] = "node-retained"

    if requested == "all":
        surface = "all"
        ownership: Any = dict(base_ownership)
    elif requested in base_ownership:
        surface = requested
        ownership = base_ownership[surface]
    else:
        surface = requested
        ownership = "out-of-scope"

    python_slices = ("validationSlice",)
    production_takeover = False
    if simulate.get("productionTakeover") and (surface in python_slices or (surface == "all" and False)):
        production_takeover = True

    if surface in python_slices:
        reason = "python-thin-prompt-package-validation-normalize-slice;promptPackage-retained-in-node"
        fallback = "node"
    elif ownership == "out-of-scope":
        reason = "out-of-scope-surface-for-prompt-package;only-known-surfaces-classified"
        fallback = "node"
    else:
        reason = "node-retained-prompt-package-per-103;no-production-prompt-package-takeover"
        fallback = "node"

    evidence = {
        "source": "103-scope + prompt-preview-validation + 104-prompt-package-slice",
        "nodeRetains": ["promptPackage"],
        "pythonOnlySlice": ["validationSlice"],
        "realPromptPackage": "node",
        "realLLMOwner": "node",
    }

    out_of_scope_count = 1 if (isinstance(ownership, str) and ownership == "out-of-scope") else 0
    migration_denominator = {
        "total": len(base_ownership) + out_of_scope_count,
        "pythonOwned": sum(1 for v in base_ownership.values() if v == "python-owned"),
        "nodeRetained": sum(1 for v in base_ownership.values() if v == "node-retained"),
        "externalOwned": 0,
        "outOfScope": out_of_scope_count,
    }

    result: Dict[str, Any] = {
        "surface": surface,
        "area": surface,
        "ownership": ownership,
        "productionTakeover": production_takeover,
        "migrationDenominator": migration_denominator,
        "evidence": evidence,
        "fallback": fallback,
        "reason": reason,
        "contractVersion": CONTRACT_VERSION,
        "provenance": PROVENANCE,
        "ok": True,
    }
    if surface == "all":
        result["surfaces"] = base_ownership
    return result


def build_prompt_package_runtime_envelope(payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Validate or build a minimal prompt package envelope.

    Returns shape matching PythonPromptPackageEnvelope (status, generationSource,
    rendered*, promptId, provenance, policy, cost).
    Degraded/invalid never claim generationSource "llm".
    """
    prov = PROVENANCE
    if payload is not None and not isinstance(payload, dict):
        return {
            "status": "invalid",
            "generationSource": "llm_fallback",
            "error": "non-json response",
            "provenance": prov,
        }
    raw = (payload or {}).get("package") or (payload or {}).get("response") or (payload or {})
    if not isinstance(raw, dict):
        return {
            "status": "invalid",
            "generationSource": "llm_fallback",
            "error": "non-json response",
            "provenance": prov,
        }

    title = str(raw.get("title", "") or "").strip()[:200]
    summary = str(raw.get("summary", "") or "").strip()[:500]
    prompts = raw.get("prompts") or []
    sections = raw.get("sections") or []

    # minimal validation gate: require title and at least one prompt entry for success path
    if not title or not isinstance(prompts, list) or len(prompts) == 0:
        return {
            "status": "invalid",
            "generationSource": "llm_fallback",
            "error": "schema validation failed: missing title or prompts",
            "promptId": "blueprint.prompt-package.v1",
            "provenance": prov,
        }

    # success envelope (minimal render)
    rendered_content = f"# {title}\n\n{summary}"
    return {
        "status": "success",
        "generationSource": "llm",
        "renderedTitle": title,
        "renderedSummary": summary,
        "renderedContent": rendered_content,
        "renderedSections": sections if isinstance(sections, list) else [],
        "renderedPrompts": prompts if isinstance(prompts, list) else [],
        "promptId": "blueprint.prompt-package.v1",
        "model": "python-runtime",
        "promptFingerprint": "py-pkg-" + str(abs(hash(title)))[:16],
        "responseDigest": "sha256:pkg-mock",
        "structuredPayloadDigest": "sha256:pkg-struct-mock",
        "provenance": prov,
        "policy": {"source": "validation-slice-104"},
    }


get_blueprint_prompt_package_runtime_takeover = decide_blueprint_prompt_package_runtime_takeover

__all__ = [
    "CONTRACT_VERSION",
    "PROVENANCE",
    "SURFACES",
    "decide_blueprint_prompt_package_runtime_takeover",
    "get_blueprint_prompt_package_runtime_takeover",
    "build_prompt_package_runtime_envelope",
]
