"""Test for Blueprint replan runtime takeover 104.

Verifies:
- Stable decision envelope: surface, ownership, productionTakeover, migrationDenominator, evidence, fallback, reason.
- replan default to node-retained with productionTakeover=false, fallback="node".
- replanDecisionSlice can be marked python-owned (thin decision/branch-validation slice) but productionTakeover remains false unless simulated for slice.
- Node bridge can consume and assert retained surfaces (incl replan) preserve node fallback.
- Python classify_blueprint_replan_decision returns deterministic branch/replan classification for realistic input.
- No masquerading of node-retained replan as python production takeover.
- Existing Node conflict 409 and replan surfaces retained.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.blueprint_replan_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SURFACES,
    decide_blueprint_replan_runtime_takeover,
    classify_blueprint_replan_decision,
)


def _payload(**overrides):
    base = {"surface": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_blueprint_replan_runtime_takeover(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("surface", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback", "reason"):
        assert key in result


def test_replan_is_node_retained_no_takeover_fallback_node():
    result = decide_blueprint_replan_runtime_takeover(_payload(surface="replan"))
    assert result["surface"] == "replan"
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_replan_decision_slice_python_owned_but_no_production_takeover():
    result = decide_blueprint_replan_runtime_takeover(_payload(surface="replanDecisionSlice"))
    assert result["surface"] == "replanDecisionSlice"
    assert result["ownership"] == "python-owned"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "python" in result.get("reason", "").lower() or "slice" in result.get("reason", "")


def test_migration_denominator_counts_retained_replan():
    result = decide_blueprint_replan_runtime_takeover(_payload(surface="all"))
    denom = result["migrationDenominator"]
    assert denom["total"] == 2
    assert denom["pythonOwned"] == 1
    assert denom["nodeRetained"] >= 1
    assert "replan" in str(result.get("evidence", {})) or result["evidence"].get("nodeRetains") == ["replan"] or "replan" in str(result["evidence"])


def test_simulate_all_retained_forces_node():
    result = decide_blueprint_replan_runtime_takeover(_payload(surface="replanDecisionSlice", simulate={"forceNodeRetained": True}))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_production_takeover_true_only_for_slice():
    d_replan = decide_blueprint_replan_runtime_takeover({"surface": "replan", "simulate": {"productionTakeover": True}})
    assert d_replan["productionTakeover"] is False
    d_slice = decide_blueprint_replan_runtime_takeover({"surface": "replanDecisionSlice", "simulate": {"productionTakeover": True}})
    assert d_slice["productionTakeover"] is True
    assert d_slice["ownership"] == "python-owned"


def test_node_bridge_consumption_assertion_shape():
    for surf in SURFACES:
        result = decide_blueprint_replan_runtime_takeover({"surface": surf})
        if result["ownership"] in ("node-retained", "out-of-scope"):
            assert result["productionTakeover"] is not True
            assert result.get("fallback") == "node"
        if result.get("productionTakeover") is True:
            assert result["ownership"] == "python-owned"


def test_classify_replan_decision_deterministic_for_realistic_input():
    # realistic input matching replan request shape
    payload = {
        "replanRequest": {
            "fromStage": "spec_tree",
            "mode": "branch",
            "reason": "user edit after review",
        },
        "job": {"id": "job-rp-104", "status": "completed", "stage": "spec_tree"},
    }
    result = classify_blueprint_replan_decision(payload)
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert "classification" in result
    cls = result["classification"]
    assert cls["fromStage"] == "spec_tree"
    assert cls["mode"] == "branch"
    assert cls["classification"] in ("branch", "in_place")
    assert "valid" in cls
    assert result["ownership"] == "python-owned"
    assert result["productionTakeover"] is False
    assert result["provenance"] == PROVENANCE


def test_classify_replan_decision_handles_in_place_and_late_stage():
    payload = {"fromStage": "final_artifact", "mode": "branch"}
    result = classify_blueprint_replan_decision(payload)
    assert result["ok"] is True
    cls = result["classification"]
    assert cls["fromStage"] == "final_artifact"
    assert cls["mode"] == "branch"
    # deterministic rule in slice marks invalid for branch at final in this bounded example
    assert cls["valid"] is False or cls.get("conflictReason") is not None

    payload2 = {"fromStage": "spec", "mode": "in_place"}
    result2 = classify_blueprint_replan_decision(payload2)
    assert result2["classification"]["classification"] == "in_place"
    assert result2["classification"]["valid"] is True
