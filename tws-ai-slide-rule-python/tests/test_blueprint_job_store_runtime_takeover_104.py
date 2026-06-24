"""Test for Blueprint job store runtime takeover 104.

Verifies:
- Stable decision envelope: surface, ownership, productionTakeover, migrationDenominator, evidence, fallback.
- jobStore/eventBus/ledger/replan/promptPackage/previewState default to node-retained with productionTakeover=false, fallback="node".
- jobStateRuntimeSlice can be marked python-owned (thin runtime slice) but productionTakeover remains false.
- Durable store explicitly retained and excluded from migration numerator (nodeRetained count).
- Node bridge can consume and assert retained surfaces preserve node fallback when takeover false.
- No masquerading of node-retained surfaces as python production takeover or migration complete.
- At least one job-state runtime slice reported python-owned (decision surface only).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.blueprint_job_store_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SURFACES,
    decide_blueprint_job_store_runtime_takeover,
)


def _payload(**overrides):
    base = {"surface": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_blueprint_job_store_runtime_takeover(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("surface", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback"):
        assert key in result


def test_job_store_is_node_retained_no_takeover_fallback_node():
    result = decide_blueprint_job_store_runtime_takeover(_payload(surface="jobStore"))
    assert result["surface"] == "jobStore"
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_event_bus_ledger_replan_prompt_preview_all_node_retained_with_node_fallback():
    for surf in ("eventBus", "ledger", "replan", "promptPackage", "previewState"):
        result = decide_blueprint_job_store_runtime_takeover(_payload(surface=surf))
        assert result["ownership"] == "node-retained"
        assert result["productionTakeover"] is False
        assert result["fallback"] == "node"


def test_job_state_runtime_slice_python_owned_but_no_production_takeover():
    result = decide_blueprint_job_store_runtime_takeover(_payload(surface="jobStateRuntimeSlice"))
    assert result["surface"] == "jobStateRuntimeSlice"
    assert result["ownership"] == "python-owned"
    # Guard: even python slice for runtime state does not claim production takeover of durable store
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "thin" in result.get("reason", "") or "python" in result.get("reason", "").lower()


def test_migration_denominator_counts_retained_excluded():
    result = decide_blueprint_job_store_runtime_takeover(_payload(surface="all"))
    denom = result["migrationDenominator"]
    assert denom["total"] == 7
    assert denom["pythonOwned"] == 1  # only the thin jobStateRuntimeSlice
    assert denom["nodeRetained"] >= 6
    assert "surfaces" in result


def test_simulate_all_retained_forces_node():
    result = decide_blueprint_job_store_runtime_takeover(_payload(surface="jobStateRuntimeSlice", simulate={"forceNodeRetained": True}))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_node_bridge_consumption_assertion_shape():
    # Simulates what node bridge test will assert
    for surf in SURFACES:
        result = decide_blueprint_job_store_runtime_takeover({"surface": surf})
        if result["ownership"] in ("node-retained", "out-of-scope"):
            assert result["productionTakeover"] is not True
            assert result.get("fallback") == "node"
        # never allow retained to be reported as takeover
        if result.get("productionTakeover") is True:
            assert result["ownership"] == "python-owned"
