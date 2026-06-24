"""Test for Blueprint preview state runtime takeover 104.

Verifies:
- Python returns a preview-state decision/projection for a realistic input.
- Stable decision envelope with surface, fallback, migrationDenominator.
- previewState defaults to node-retained, productionTakeover=false, fallback="node".
- previewStateRuntimeSlice python-owned thin projection but no durable production takeover.
- Tests distinguish projection (python slice) from durable production takeover.
- Node bridge shape consumption + retained never takeover.
- Migration denominator updated in code-level evidence (python slice accounted).
- No rewrite of effect preview; projection is runtime envelope only.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.blueprint_preview_state_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SURFACES,
    decide_blueprint_preview_state_runtime_takeover,
    project_blueprint_preview_state,
)


def _payload(**overrides):
    base = {"surface": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_blueprint_preview_state_runtime_takeover(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("surface", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback"):
        assert key in result


def test_preview_state_is_node_retained_no_takeover_fallback_node():
    result = decide_blueprint_preview_state_runtime_takeover(_payload(surface="previewState"))
    assert result["surface"] == "previewState"
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_preview_state_runtime_slice_python_owned_no_production_takeover():
    result = decide_blueprint_preview_state_runtime_takeover(_payload(surface="previewStateRuntimeSlice"))
    assert result["surface"] == "previewStateRuntimeSlice"
    assert result["ownership"] == "python-owned"
    # Guard: projection slice does not claim durable production takeover
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "thin" in result.get("reason", "") or "python" in result.get("reason", "").lower() or "projection" in result.get("reason", "").lower()


def test_migration_denominator_updated_in_evidence():
    result = decide_blueprint_preview_state_runtime_takeover(_payload(surface="all"))
    denom = result["migrationDenominator"]
    assert denom["total"] >= 2
    assert denom["pythonOwned"] == 1  # only the thin previewStateRuntimeSlice
    assert denom["nodeRetained"] >= 1
    assert result["evidence"].get("migrationDenominatorUpdated") is True
    assert "surfaces" in result or "areas" in result


def test_simulate_force_retained():
    result = decide_blueprint_preview_state_runtime_takeover(_payload(surface="previewStateRuntimeSlice", simulate={"forceNodeRetained": True}))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_python_returns_preview_state_projection_for_realistic_input():
    realistic = {
        "blueprintId": "bp-104-preview-test",
        "nodes": [
            {"id": "node-a", "state": {"ready": True}},
            {"id": "node-b", "previewStatus": "partial"},
            {"id": "node-c"},
        ],
    }
    proj = project_blueprint_preview_state(realistic)
    assert proj["ok"] is True
    assert proj["productionTakeover"] is False
    assert proj["ownership"] == "python-owned"
    assert proj["fallback"] == "node"
    assert "projection" in proj
    p = proj["projection"]
    assert p["blueprintId"] == "bp-104-preview-test"
    assert p["nodeCount"] == 3
    assert p["validated"] is True
    assert len(p["nodes"]) == 3
    # distinguish from durable
    assert proj.get("runtime", {}).get("mode") == "projection_slice"


def test_node_bridge_consumption_assertion_shape():
    # mirrors what node bridge test asserts
    for surf in SURFACES:
        result = decide_blueprint_preview_state_runtime_takeover({"surface": surf})
        if result["ownership"] in ("node-retained", "out-of-scope"):
            assert result["productionTakeover"] is not True
            assert result.get("fallback") == "node"
        if result.get("productionTakeover") is True:
            assert result["ownership"] == "python-owned"


def test_projection_distinguishes_from_durable_takeover():
    # explicit test: projection never reports production takeover
    proj = project_blueprint_preview_state({"nodes": [{"id": "x"}]})
    assert proj["productionTakeover"] is False
    # decision for slice also never
    dec = decide_blueprint_preview_state_runtime_takeover({"surface": "previewStateRuntimeSlice"})
    assert dec["productionTakeover"] is False
