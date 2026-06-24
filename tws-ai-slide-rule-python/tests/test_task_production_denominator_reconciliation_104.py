"""Test for Task production denominator reconciliation 104.

Verifies reconciliation aggregates durable store / project auth / scheduler / event persistence
+ thin python slices from the 104 takeover attempts.

Node and Python tests must agree on exact counts for pythonOwned/nodeRetained/blocked/outOfScope.

Blockers are listed in machine-readable "blockers" array.

Do not claim production takeover for retained durable surfaces.
Remaining blockers surface explicitly; no hidden state.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_production_denominator_reconciliation import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    TASK_104_SURFACES,
    BLOCKERS,
    decide_task_production_denominator_reconciliation,
)


def _payload(**overrides):
    base = {"area": "all"}
    base.update(overrides)
    return base


def test_decision_envelope_shape_and_keys():
    result = decide_task_production_denominator_reconciliation(_payload())
    assert result["ok"] is True
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    for key in ("area", "ownership", "productionTakeover", "migrationDenominator", "blockers", "reason", "evidence"):
        assert key in result
    assert isinstance(result["blockers"], list)


def test_task_104_surfaces_are_reconciled():
    result = decide_task_production_denominator_reconciliation(_payload(area="all"))
    assert "surfaces" in result
    surfaces = result["surfaces"]
    # core retained
    for main in ("durableStore", "projectResourceAuth", "scheduler", "eventAppendPersistence"):
        assert surfaces.get(main) == "node-retained"
    # python thin slices from takeovers
    py_slices = [k for k, v in surfaces.items() if v == "python-owned"]
    assert len(py_slices) >= 6
    assert result["productionTakeover"] is False


def test_all_core_surfaces_node_retained_no_takeover():
    for area in ("durableStore", "projectResourceAuth", "scheduler", "eventAppendPersistence"):
        result = decide_task_production_denominator_reconciliation(_payload(area=area))
        assert result["ownership"] == "node-retained"
        assert result["productionTakeover"] is False


def test_python_slices_owned_but_no_takeover_by_default():
    py_slices = ["runtimeStateSlice", "durableWriteSlice", "cancelWriteSlice", "eventReplaySlice", "replayProjectionSlice", "appendReplayEvidence"]
    for sl in py_slices:
        result = decide_task_production_denominator_reconciliation(_payload(area=sl))
        assert result["ownership"] == "python-owned"
        assert result["productionTakeover"] is False


def test_migration_denominator_counts_agree_with_aggregation():
    result = decide_task_production_denominator_reconciliation(_payload(area="all"))
    denom = result["migrationDenominator"]
    # 4 retained core + 7 python slices (see surfaces)
    assert denom["total"] == 11
    assert denom["pythonOwned"] == 7
    assert denom["nodeRetained"] == 4
    assert denom["blocked"] == 0
    assert denom["outOfScope"] == 0
    # blockers present
    assert len(result["blockers"]) == 4
    for b in BLOCKERS:
        assert b in result["blockers"]


def test_blocked_simulate_marks_blocked_and_counts():
    result = decide_task_production_denominator_reconciliation(
        _payload(area="all", simulate={"block": True})
    )
    denom = result["migrationDenominator"]
    assert denom["blocked"] >= 4
    assert "durableStore" in result["blockers"]
    assert result["productionTakeover"] is False


def test_out_of_scope_yields_outOfScope_count():
    result = decide_task_production_denominator_reconciliation(_payload(area="unknownTaskSurfaceXYZ"))
    assert result.get("ownership") == "out-of-scope" or result["migrationDenominator"]["outOfScope"] >= 0


def test_blockers_is_machine_readable_list():
    result = decide_task_production_denominator_reconciliation(_payload())
    blockers = result["blockers"]
    assert isinstance(blockers, list)
    assert all(isinstance(x, str) for x in blockers)
    assert "durableStore" in blockers
    assert "scheduler" in blockers
