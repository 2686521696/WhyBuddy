"""Python tests for task event persistence takeover 104.

Covers:
- Python service classifies event persistence surfaces.
- eventAppendPersistence / append / durable remain node-retained (no durable claim).
- appendReplayEvidence / replay / eventReplaySlice python-owned for bounded slice.
- productionTakeover stays false; envelope separates durable, projection, retained surfaces.
- Python records/validates append/replay evidence for one event slice (thin only).
- Node retains real append persistence; python slice is evidence/projection only.
- In-memory projection never treated as durable.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_event_persistence_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    OPS,
    NODE_RETAINED_SURFACES,
    decide_task_event_persistence_takeover,
    record_task_event_append_replay_evidence,
)


def _payload(**overrides):
    base: dict = {"area": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    res = decide_task_event_persistence_takeover(_payload())
    assert res["ok"] is True
    assert res["contractVersion"] == CONTRACT_VERSION
    assert res["provenance"] == PROVENANCE
    for key in ("area", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback", "reason", "nodeRetained"):
        assert key in res


def test_event_append_persistence_node_retained_explicit():
    res = decide_task_event_persistence_takeover(_payload(area="eventAppendPersistence"))
    assert res["ownership"] == "node-retained"
    assert res["productionTakeover"] is False
    assert res["fallback"] == "node"
    assert res["nodeRetained"]["eventAppendPersistence"] == "node-retained"


def test_durable_and_append_retained():
    for surf in ("durableEventAppend", "append"):
        res = decide_task_event_persistence_takeover(_payload(area=surf))
        assert res["ownership"] == "node-retained"
        assert res["productionTakeover"] is False


def test_append_replay_evidence_python_owned_slice():
    for surf in ("replay", "appendReplayEvidence", "eventReplaySlice"):
        res = decide_task_event_persistence_takeover(_payload(area=surf))
        assert res["ownership"] == "python-owned"
        assert res["productionTakeover"] is False
        assert res["fallback"] == "node"
        assert "python" in res.get("reason", "").lower() or "slice" in res.get("reason", "").lower() or "evidence" in res.get("reason", "").lower()


def test_migration_denominator_and_evidence_separation():
    res = decide_task_event_persistence_takeover(_payload())
    denom = res["migrationDenominator"]
    assert denom["pythonOwned"] >= 3
    assert denom["nodeRetained"] >= 3
    ev = res["evidence"]
    assert "nodeRetains" in ev
    assert "pythonOnlySlice" in ev
    assert ev.get("projectionNotDurable") is True
    assert "realEventAppendOwner" in ev or "realDurableOwner" in ev


def test_simulate_force_node_retained():
    res = decide_task_event_persistence_takeover(_payload(area="replay", simulate={"forceNodeRetained": True}))
    assert res["ownership"] == "node-retained"
    assert res["productionTakeover"] is False


def test_retained_responsibilities_cover_event_persist():
    res = decide_task_event_persistence_takeover(_payload())
    for k in ["eventAppendPersistence", "durableEventAppend"]:
        assert k in res["nodeRetained"]
        assert res["nodeRetained"][k] == "node-retained"


def test_record_append_replay_evidence_validates_slice():
    events = [
        {"type": "created", "message": "task created", "time": 1000, "source": "mission-core"},
        {"type": "progress", "message": "running", "progress": 10, "time": 1001, "source": "python"},
    ]
    res = record_task_event_append_replay_evidence({
        "action": "append",
        "missionId": "m-104-ev",
        "events": events,
        "limit": 1,
        "task": {"id": "m-104-ev", "status": "running", "progress": 10},
        "metadata": {"project": {"projectId": "p-104"}},
    })
    assert res["ok"] is True
    assert res["action"] == "append"
    assert res["ownership"] == "python-owned"
    assert res["productionTakeover"] is False
    assert "runtime" in res
    assert res["runtime"]["eventPersistenceOwner"] == "node"
    assert res["runtime"]["durable"] == "node-retained"
    assert res["runtime"]["projection"] == "python-slice"
    assert res["evidence"]["sliceOwner"] == "python"
    assert res["evidence"]["durableOwner"] == "node"
    assert res["evidence"]["projectionNotDurable"] is True
    assert res["replay"]["eventCount"] == 1  # limited
    assert res["replay"]["owner"] == "node"
    assert "replay" in res
    assert res["task"]["id"] == "m-104-ev"


def test_record_replay_evidence_returns_projection_envelope():
    res = record_task_event_append_replay_evidence({
        "action": "replay",
        "events": [{"type": "log", "message": "evt", "time": 42}],
    })
    assert res["ok"] is True
    assert res["replay"]["eventCount"] == 1
    assert res["evidence"]["validated"] is True


def test_node_retained_constants_and_surfaces():
    for k in ["eventAppendPersistence", "durableEventAppend", "append"]:
        assert k in NODE_RETAINED_SURFACES
    assert NODE_RETAINED_SURFACES["eventAppendPersistence"] == "node-retained"


def test_unknown_surface_out_of_scope():
    res = decide_task_event_persistence_takeover({"area": "unknownEventSurface"})
    assert res["ownership"] == "out-of-scope"
    assert res["productionTakeover"] is False
    assert res["migrationDenominator"]["outOfScope"] == 1


def test_unsupported_payload():
    bad = decide_task_event_persistence_takeover("not-dict")  # type: ignore[arg-type]
    assert bad.get("ok") is False or "error" in bad

    bad2 = record_task_event_append_replay_evidence(["bad"])  # type: ignore[arg-type]
    assert bad2.get("ok") is False or "error" in bad2
