"""Test for Blueprint prompt package runtime takeover 104.

Verifies:
- Python service validates or builds a minimal prompt package envelope.
- Stable decision envelope with ownership, productionTakeover, migrationDenominator, fallback.
- promptPackage remains node-retained (per 103) with productionTakeover=false and node fallback.
- validationSlice python-owned thin slice but no production takeover.
- Envelope includes ownership, takeover flag, denominator accounting.
- Node bridge consumption verified via decider path (uses python result).
- Retained surfaces never overstated as takeover.
- Does not claim full prompt package production ownership.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.blueprint_prompt_package_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SURFACES,
    decide_blueprint_prompt_package_runtime_takeover,
    build_prompt_package_runtime_envelope,
)


def _payload(**overrides):
    base = {"surface": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_blueprint_prompt_package_runtime_takeover(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("surface", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback", "reason"):
        assert key in result


def test_prompt_package_is_node_retained_no_takeover_fallback_node():
    result = decide_blueprint_prompt_package_runtime_takeover(_payload(surface="promptPackage"))
    assert result["surface"] in ("promptPackage", "all")
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "node-retained" in result.get("reason", "") or "103" in result.get("reason", "")


def test_validation_slice_python_owned_but_no_production_takeover():
    result = decide_blueprint_prompt_package_runtime_takeover(_payload(surface="validationSlice"))
    assert result["surface"] == "validationSlice"
    assert result["ownership"] == "python-owned"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "thin" in result.get("reason", "").lower() or "python" in result.get("reason", "").lower() or "validation" in result.get("reason", "").lower()


def test_migration_denominator_accounts_prompt_package():
    result = decide_blueprint_prompt_package_runtime_takeover(_payload(surface="all"))
    denom = result["migrationDenominator"]
    assert denom["total"] >= 2
    assert denom["nodeRetained"] >= 1
    assert denom["pythonOwned"] >= 1
    assert "evidence" in result
    assert "nodeRetains" in result["evidence"] or "promptPackage" in str(result["evidence"])


def test_simulate_all_retained_forces_node_on_slice():
    result = decide_blueprint_prompt_package_runtime_takeover(_payload(surface="validationSlice", simulate={"forceNodeRetained": True}))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_build_prompt_package_runtime_envelope_success():
    payload = {"title": "Test Title", "summary": "Test summary", "prompts": [{"id": "p1"}], "sections": []}
    result = build_prompt_package_runtime_envelope({"package": payload})
    assert result["status"] == "success"
    assert result["generationSource"] == "llm"
    assert result["renderedTitle"] == "Test Title"
    assert result["provenance"] == PROVENANCE
    assert "policy" in result


def test_build_prompt_package_runtime_envelope_invalid_falls_back():
    result = build_prompt_package_runtime_envelope({"package": {"summary": "no title"}})
    assert result["status"] in ("invalid", "degraded")
    assert result["generationSource"] == "llm_fallback"
    assert result.get("error")
    assert result["provenance"] == PROVENANCE


def test_node_bridge_consumption_shape_via_python_result():
    # mirrors what node test asserts for bridge consumption
    for surf in SURFACES:
        result = decide_blueprint_prompt_package_runtime_takeover({"surface": surf})
        if result["ownership"] in ("node-retained", "out-of-scope"):
            assert result["productionTakeover"] is not True
        if result.get("productionTakeover") is True:
            assert result["ownership"] == "python-owned"
    # out of scope
    bad = decide_blueprint_prompt_package_runtime_takeover({"surface": "unknown"})
    assert bad["ownership"] == "out-of-scope"
    assert bad["productionTakeover"] is False
