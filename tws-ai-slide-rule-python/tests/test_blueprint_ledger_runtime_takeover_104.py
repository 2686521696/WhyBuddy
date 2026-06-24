"""Test for Blueprint ledger runtime takeover 104.

Verifies:
- Python computes or validates a ledger entry from real job/event inputs.
- Stable decision envelope for ledger surfaces.
- ledger defaults to node-retained, productionTakeover=false, fallback="node".
- ledgerEntrySlice is python-owned (thin compute slice) but productionTakeover false unless explicit simulate on slice.
- Node bridge consumption shape + assertions hold.
- migrationDenominator records retained ledger responsibility (nodeRetained).
- productionTakeover true ONLY for proven slice.
- compute_blueprint_ledger_entry uses real job+events to produce replayable entry.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.blueprint_ledger_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SURFACES,
    decide_blueprint_ledger_runtime_takeover,
    compute_blueprint_ledger_entry,
)


def _payload(**overrides):
    base = {"surface": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_blueprint_ledger_runtime_takeover(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("surface", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback"):
        assert key in result


def test_ledger_is_node_retained_no_takeover_fallback_node():
    result = decide_blueprint_ledger_runtime_takeover(_payload(surface="ledger"))
    assert result["surface"] == "ledger"
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "node-retained" in result.get("reason", "")


def test_ledger_entry_slice_python_owned_but_no_production_takeover():
    result = decide_blueprint_ledger_runtime_takeover(_payload(surface="ledgerEntrySlice"))
    assert result["surface"] == "ledgerEntrySlice"
    assert result["ownership"] == "python-owned"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"
    assert "ledgerEntry" in result.get("reason", "") or "thin" in result.get("reason", "").lower() or "python" in result.get("reason", "").lower()


def test_migration_denominator_records_retained_ledger():
    result = decide_blueprint_ledger_runtime_takeover(_payload(surface="all"))
    denom = result["migrationDenominator"]
    assert denom["total"] >= 2
    # ledger contributes to nodeRetained
    assert denom["nodeRetained"] >= 1
    assert "evidence" in result
    assert result["evidence"].get("nodeRetains") == ["ledger"] or "ledger" in str(result["evidence"])


def test_simulate_all_retained_forces_node_on_slice():
    result = decide_blueprint_ledger_runtime_takeover(_payload(surface="ledgerEntrySlice", simulate={"forceNodeRetained": True}))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_compute_ledger_entry_from_real_job_event_inputs():
    job = {"id": "job-104", "status": "running", "stage": "spec", "projectId": "p1", "updatedAt": "2026-06-24T10:00:00.000Z"}
    events = [
        {"id": "e1", "status": "created", "type": "job.created"},
        {"id": "e2", "status": "running", "type": "job.running"},
    ]
    result = compute_blueprint_ledger_entry({"job": job, "events": events, "now": "2026-06-24T10:01:00.000Z"})
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert "ledgerEntry" in result
    entry = result["ledgerEntry"]
    assert entry["jobId"] == "job-104"
    assert entry["eventCount"] == 2
    assert entry["computedFrom"] == "real-job+events"
    assert entry["status"] == "running"
    assert "id" in entry and entry["id"].startswith("led-")


def test_compute_ledger_entry_handles_minimal_input():
    result = compute_blueprint_ledger_entry({"jobId": "j-min"})
    assert result["ok"] is True
    entry = result["ledgerEntry"]
    assert entry["jobId"] == "j-min"
    assert entry["eventCount"] == 0


def test_production_takeover_true_only_for_proven_slice():
    # retained never
    d_ledger = decide_blueprint_ledger_runtime_takeover({"surface": "ledger", "simulate": {"productionTakeover": True}})
    assert d_ledger["productionTakeover"] is False
    # slice only under simulate
    d_slice = decide_blueprint_ledger_runtime_takeover({"surface": "ledgerEntrySlice", "simulate": {"productionTakeover": True}})
    assert d_slice["productionTakeover"] is True
    assert d_slice["ownership"] == "python-owned"


def test_node_bridge_consumption_assertion_shape():
    for surf in SURFACES:
        result = decide_blueprint_ledger_runtime_takeover({"surface": surf})
        if result.get("ownership") in ("node-retained", "out-of-scope"):
            assert result["productionTakeover"] is not True
            assert result.get("fallback") == "node"
        if result.get("productionTakeover") is True:
            assert result["ownership"] == "python-owned"
