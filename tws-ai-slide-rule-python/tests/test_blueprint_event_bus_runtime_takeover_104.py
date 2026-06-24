"""Test for Blueprint event bus runtime takeover 104.

Verifies:
- Stable decision envelope for event bus ops: area/op, ownership, productionTakeover, migrationDenominator, reason, evidence, fallback.
- eventBus/append default to node-retained with productionTakeover=false, fallback="node".
- project/replay/eventProjectionSlice marked python-owned (thin slice) but productionTakeover remains false.
- Python can run deterministic event projection (stable sort by occurredAt/id) for the slice.
- Node bridge consumption asserts retained != takeover; envelope separates python-owned / node-retained / out-of-scope.
- No masquerading of node-retained eventBus as python production ownership.
- Real event bus transport not claimed; denominator keeps eventBus in nodeRetained.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.blueprint_event_bus_runtime_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    OPS,
    decide_blueprint_event_bus_runtime_takeover,
    project_blueprint_event_bus,
)


def _payload(**overrides):
    base = {"area": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_blueprint_event_bus_runtime_takeover(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("area", "ownership", "productionTakeover", "migrationDenominator", "reason", "evidence", "fallback"):
        assert key in result


def test_event_bus_is_node_retained_no_takeover():
    result = decide_blueprint_event_bus_runtime_takeover(_payload(area="eventBus"))
    assert result["area"] == "eventBus" or result.get("op") == "eventBus"
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_append_is_node_retained():
    result = decide_blueprint_event_bus_runtime_takeover(_payload(area="append"))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_project_replay_projection_slice_python_owned_but_no_production_takeover():
    for op in ("project", "replay", "eventProjectionSlice"):
        result = decide_blueprint_event_bus_runtime_takeover(_payload(area=op))
        assert result["ownership"] == "python-owned"
        assert result["productionTakeover"] is False
        assert result["fallback"] == "node"
        assert "thin" in result.get("reason", "") or "python" in result.get("reason", "").lower() or "projection" in result.get("reason", "").lower()


def test_migration_denominator_counts():
    result = decide_blueprint_event_bus_runtime_takeover(_payload(area="all"))
    denom = result["migrationDenominator"]
    assert denom["total"] == 5
    assert denom["pythonOwned"] == 3  # project, replay, eventProjectionSlice
    assert denom["nodeRetained"] >= 2  # eventBus, append
    assert "areas" in result or "op" in result


def test_simulate_all_retained_forces_node():
    result = decide_blueprint_event_bus_runtime_takeover(_payload(area="project", simulate={"forceNodeRetained": True}))
    assert result["ownership"] == "node-retained"
    assert result["productionTakeover"] is False
    assert result["fallback"] == "node"


def test_node_bridge_consumption_assertion_shape():
    for op in OPS:
        result = decide_blueprint_event_bus_runtime_takeover({"area": op})
        if result["ownership"] in ("node-retained", "out-of-scope"):
            assert result["productionTakeover"] is not True
        if result.get("productionTakeover") is True:
            assert result["ownership"] == "python-owned"


def test_deterministic_event_projection_runs_and_is_stable():
    events = [
        {"id": "e2", "occurredAt": "2026-06-01T00:00:02Z", "type": "job.stage", "jobId": "j1"},
        {"id": "e1", "occurredAt": "2026-06-01T00:00:01Z", "type": "job.created", "jobId": "j1"},
        {"id": "e3", "occurredAt": "2026-06-01T00:00:01Z", "type": "job.stage", "jobId": "j1"},
    ]
    res = project_blueprint_event_bus({"events": events, "action": "project"})
    assert res["ok"] is True
    assert res["contractVersion"] == CONTRACT_VERSION
    assert res["ownership"] == "python-owned"
    assert res["productionTakeover"] is False
    proj = res["projection"]
    assert proj["count"] == 3
    # deterministic order: by occurredAt then id
    ids = [e["id"] for e in proj["events"]]
    assert ids == ["e1", "e3", "e2"]


def test_projection_preserves_core_fields_and_does_not_claim_bus():
    evt = {"id": "pe-1", "jobId": "j-pe", "type": "spec.tree.updated", "status": "running", "occurredAt": "2026-01-01", "stageId": "spec_tree"}
    res = project_blueprint_event_bus({"events": [evt], "action": "replay"})
    assert res["action"] == "replay"
    p0 = res["projection"]["events"][0]
    assert p0["id"] == "pe-1"
    assert p0["jobId"] == "j-pe"
    assert "runtime" in res
    assert res["runtime"]["eventBusOwner"] == "node"


def test_unknown_area_returns_out_of_scope_not_all():
    # ensures out-of-scope classification is expressed (review req)
    res = decide_blueprint_event_bus_runtime_takeover({"area": "unknownArea"})
    assert res["ownership"] == "out-of-scope"
    assert res["productionTakeover"] is False
    assert res["migrationDenominator"]["outOfScope"] == 1


def test_simulate_production_takeover_not_allowed_for_retained_surfaces():
    # productionTakeover must not be true for node-retained even if simulate requests
    res_bus = decide_blueprint_event_bus_runtime_takeover({"area": "eventBus", "simulate": {"productionTakeover": True}})
    assert res_bus["ownership"] == "node-retained"
    assert res_bus["productionTakeover"] is False

    res_append = decide_blueprint_event_bus_runtime_takeover({"op": "append", "simulate": {"productionTakeover": True}})
    assert res_append["productionTakeover"] is False
