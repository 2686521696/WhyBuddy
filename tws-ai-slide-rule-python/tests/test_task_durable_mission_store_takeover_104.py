"""Python tests for task durable mission store takeover 104.

Covers:
- Python service classifies surfaces and can execute one deterministic mission-store write op.
- productionTakeover / takeover flag true ONLY for the proven durable write slice.
- durableStore / core paths remain node-retained with explicit retained responsibilities.
- migrationDenominator shows bounded slice only.
- Node create/read/cancel semantics proven intact via separate node tests.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_durable_mission_store_takeover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    SURFACES,
    NODE_RETAINED,
    decide_task_durable_mission_store_takeover,
    execute_mission_durable_store_op,
)


def _payload(**overrides):
    base: dict = {"surface": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_keys_and_version():
    res = decide_task_durable_mission_store_takeover(_payload())
    assert res["ok"] is True
    assert res["contractVersion"] == CONTRACT_VERSION
    assert res["provenance"] == PROVENANCE
    for key in ("area", "ownership", "productionTakeover", "migrationDenominator", "evidence", "fallback", "nodeRetained"):
        assert key in res


def test_durable_store_node_retained_explicit():
    res = decide_task_durable_mission_store_takeover(_payload(surface="durableStore"))
    assert res["ownership"] == "node-retained"
    assert res["productionTakeover"] is False
    assert res["fallback"] == "node"
    assert res["nodeRetained"]["durableStore"] == "node-retained"


def test_core_surfaces_node_retained_no_takeover():
    for surf in ("create", "read", "cancel"):
        res = decide_task_durable_mission_store_takeover(_payload(surface=surf))
        assert res["ownership"] == "node-retained"
        assert res["productionTakeover"] is False
        assert "node-retained" in str(res.get("reason", "")).lower() or "node" in res.get("reason", "").lower()


def test_proven_durable_write_slice_has_takeover_true_only_here():
    for surf in ("durableWriteSlice", "cancelWriteSlice"):
        res = decide_task_durable_mission_store_takeover(_payload(surface=surf))
        assert res["ownership"] == "python-owned"
        assert res["productionTakeover"] is True, f"takeover must be true only for proven slice {surf}"
        assert "python-owned-durable-write-slice" in res.get("reason", "")

    # ensure other surfaces do not get true
    res_ds = decide_task_durable_mission_store_takeover(_payload(surface="durableStore"))
    assert res_ds["productionTakeover"] is False


def test_migration_denominator_counts_bounded_slice():
    res = decide_task_durable_mission_store_takeover(_payload())
    denom = res["migrationDenominator"]
    assert denom["total"] >= 6
    # only the write slices are python owned
    assert denom["pythonOwned"] == 2
    assert denom["nodeRetained"] >= 4
    assert "nodeRetains" in res["evidence"]
    assert "realDurableOwner" in res["evidence"] or "realPersistence" in res["evidence"]


def test_retained_responsibilities_explicit():
    res = decide_task_durable_mission_store_takeover(_payload(surface="all"))
    for key in ("durableStore", "scheduler", "projectResourceAuth"):
        assert key in res["nodeRetained"]
        assert res["nodeRetained"][key] == "node-retained"


def test_execute_deterministic_mission_store_cancel_write_op():
    input_record = {
        "id": "m-104-test",
        "kind": "chat",
        "title": "durable slice test",
        "status": "running",
        "progress": 40,
    }
    res = execute_mission_durable_store_op({
        "op": "cancelWrite",
        "record": input_record,
        "reason": "test-deterministic",
    })
    assert res["ok"] is True
    assert res["op"] == "cancelWrite"
    assert res["ownership"] == "python-owned"
    assert res["productionTakeover"] is True
    result = res["result"]
    assert result["status"] == "cancelled"
    assert result["cancelReason"] == "test-deterministic"
    assert result.get("_durableSlice") == "python-owned-cancelWrite"


def test_execute_for_non_slice_is_retained():
    res = execute_mission_durable_store_op({"op": "create", "record": {"title": "c"}})
    assert res["ok"] is True
    assert res["ownership"] == "node-retained"
    assert res.get("productionTakeover") is False


def test_simulate_force_retained_keeps_durable_node():
    res = decide_task_durable_mission_store_takeover(
        _payload(surface="durableWriteSlice", simulate={"forceNodeRetained": True})
    )
    assert res["ownership"] == "node-retained"
    assert res["productionTakeover"] is False


def test_unsupported_payload():
    bad = decide_task_durable_mission_store_takeover("not-a-dict")  # type: ignore[arg-type]
    assert bad.get("ok") is False or "error" in bad


def test_surfaces_constant_includes_proven_slice():
    assert "durableWriteSlice" in SURFACES
    assert "cancelWriteSlice" in SURFACES
    assert "durableStore" in SURFACES
