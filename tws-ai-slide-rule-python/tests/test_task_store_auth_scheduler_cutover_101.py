"""Python tests for task store/auth/scheduler cutover 101.

Covers Python decision envelopes for missionStore, projectResourceAuth, scheduler.
Classifies ready / blocked / degraded / unsupported.
Node keeps durable store, auth middleware, full scheduler, cancel/replay/error semantics.
"""

import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.task_store_auth_scheduler_cutover import (  # noqa: E402
    CONTRACT_VERSION,
    PROVENANCE,
    CUTOVER_DECISIONS,
    NODE_BOUNDARIES,
    decide_task_store_auth_scheduler_cutover,
)


def _base_payload(**overrides: Any) -> dict:
    base: dict[str, Any] = {
        "missionId": "mission-cutover-101",
        "projectId": "project-cutover-101",
        "resourceId": "resource-cutover-101",
        "actor": {"id": "user-cutover", "role": "owner"},
        "area": "all",
    }
    base.update(overrides)
    return base


def test_default_is_ready_all_participation_and_node_boundaries():
    result = decide_task_store_auth_scheduler_cutover(_base_payload())
    assert result["decision"] == "ready"
    assert result["contractVersion"] == CONTRACT_VERSION
    assert result["provenance"] == PROVENANCE
    assert result["missionId"] == "mission-cutover-101"
    assert result["decisions"] == {
        "missionStore": "ready",
        "projectResourceAuth": "ready",
        "scheduler": "ready",
    }
    assert result["canParticipate"] == {
        "missionStore": True,
        "projectResourceAuth": True,
        "scheduler": True,
    }
    assert result["runtime"]["owner"] == "python"
    assert result["runtime"]["missionStoreOwner"] == "node"
    assert result["boundaries"]["durableStoreOwner"] == "node"
    assert result["boundaries"]["schedulerOwner"] == "node"
    assert result.get("ok") is not False
    assert "productionTakeover" not in result or result.get("productionTakeover") is not True


def test_simulate_unsupported_covers_all_areas():
    result = decide_task_store_auth_scheduler_cutover(
        _base_payload(simulate={"forceUnsupported": True})
    )
    assert result["decision"] == "unsupported"
    assert result["decisions"]["missionStore"] == "unsupported"
    assert result["decisions"]["projectResourceAuth"] == "unsupported"
    assert result["decisions"]["scheduler"] == "unsupported"
    assert result["canParticipate"] == {"missionStore": False, "projectResourceAuth": False, "scheduler": False}
    assert result["ok"] is False
    assert result["schedulerClassification"]["state"] == "unsupported"
    assert result["diagnostics"]["reason"] == "unsupported-by-simulation"


def test_simulate_blocked_marks_blocked_and_ok_false():
    result = decide_task_store_auth_scheduler_cutover(
        _base_payload(simulate={"block": True}, missionId="m-block")
    )
    assert result["decision"] == "blocked"
    assert result["ok"] is False
    assert result["blocked"] is True
    assert all(v == "blocked" for v in result["decisions"].values())
    assert result["schedulerClassification"]["cancel"] == "node"
    assert result["schedulerClassification"]["replay"] == "node"


def test_simulate_degraded_allows_scheduler_advisory():
    result = decide_task_store_auth_scheduler_cutover(
        _base_payload(simulate={"degrade": True})
    )
    assert result["decision"] == "degraded"
    assert result["decisions"]["scheduler"] == "degraded"
    assert result["canParticipate"]["scheduler"] is True
    assert result["canParticipate"]["missionStore"] is False
    assert result["schedulerClassification"]["state"] == "degraded"
    assert result["schedulerClassification"]["replay"] == "python-decision-advisory"


def test_area_scopes_to_ready_for_one_unsupported_for_others():
    for area, ready_key in [
        ("missionStore", "missionStore"),
        ("auth", "projectResourceAuth"),
        ("scheduler", "scheduler"),
    ]:
        result = decide_task_store_auth_scheduler_cutover(_base_payload(area=area))
        assert result["area"] == area
        assert result["decision"] == "ready"
        assert result["decisions"][ready_key] == "ready"
        for k, v in result["decisions"].items():
            if k != ready_key:
                assert v == "unsupported"
        assert result["canParticipate"][ready_key] is (ready_key != "scheduler" or True)


def test_diagnostic_only_flags_no_takeover():
    result = decide_task_store_auth_scheduler_cutover(
        _base_payload(diagnosticOnly=True, missionId="m-diag")
    )
    assert result["decision"] == "diagnostic-only"
    assert result["diagnosticOnly"] is True
    assert result["productionTakeover"] is False
    assert all(v == "unsupported" for v in result["decisions"].values())


def test_mission_store_auth_scheduler_classifications_locked():
    # ensure all four states exercised and boundaries preserved
    states = set()
    for sim in [None, {"forceUnsupported": True}, {"block": True}, {"degrade": True}]:
        p = _base_payload()
        if sim:
            p["simulate"] = sim
        r = decide_task_store_auth_scheduler_cutover(p)
        states.add(r["decision"])
        # node owned never flipped
        assert r["runtime"]["authOwner"] == "node"
        assert r["runtime"]["schedulerOwner"] == "node"
        assert "cancel" in r["schedulerClassification"]
    assert states >= {"ready", "unsupported", "blocked", "degraded"}


def test_validation_error_for_non_object():
    result = decide_task_store_auth_scheduler_cutover("not-dict")  # type: ignore[arg-type]
    assert result["ok"] is False
    assert result["code"] == "validation_error"
    assert result["error"] == "payload_not_object"
    assert "must be an object" in result["message"]


def test_cutover_decisions_constant_and_node_boundaries():
    assert "ready" in CUTOVER_DECISIONS
    assert "blocked" in CUTOVER_DECISIONS
    assert NODE_BOUNDARIES["missionStoreOwner"] == "node"
    assert NODE_BOUNDARIES["cancelSemanticsOwner"] == "node"
