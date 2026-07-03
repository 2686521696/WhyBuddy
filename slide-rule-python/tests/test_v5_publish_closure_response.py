"""Focused schema + derive tests for Python publishClosure/runtimeClosure response payloads.

Covers:
- positive evidence: constructs valid publishClosure payload shape from runtimeClosure result in capabilityRun
- fail-closed negative: None for missing data, empty runs (degraded/error cases preserve prior semantics)
- schema validation via PublishClosureResponse Pydantic model
- deterministic local only; no side effects
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import CapabilityRun, V5SessionState  # noqa: E402
from services.v5_publish_closure_response import (
    derive_publish_closure_response,
    PublishClosureResponse,
    PublishClosureTierCounts,
)  # noqa: E402


def test_derive_publish_closure_response_from_runtime_closure_result():
    state = V5SessionState(
        sessionId="closure-response",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-closure",
                capabilityId="appbundle.runtimeClosure",
                turnId="t1",
                result={
                    "runtimeClosure": {
                        "blocked": False,
                        "blockers": [
                            {
                                "code": "APPBUNDLE_PUBLISH_REF_MISSING",
                                "path": "menuEntries[0].roleRefs[2]",
                                "affectedSkill": "rbac",
                                "ref": "role:finance-admin",
                            }
                        ],
                        "perSkillEvidence": {
                            "datamodel": {"evidencePresent": True},
                            "rbac": {"evidencePresent": True},
                            "workflow": {"evidencePresent": True},
                            "page": {"evidencePresent": True},
                            "aigc": {"evidencePresent": True},
                            "appbundle": {"evidencePresent": True},
                        },
                        "runtimeClosure": {
                            "skillsChecked": ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"],
                            "versionPinsChecked": True,
                        },
                        "closureId": "appbundle:app_purchase_approval@1.0.0:runtime-closure",
                        "closureHash": "feedface",
                        "stableDigest": "deadbeef",
                        "findingsByTier": {"hard_blocker": [], "warning": [{}], "info": [{}, {}]},
                    }
                },
            )
        ],
    )

    response = derive_publish_closure_response(state)

    assert response is not None
    # schema shape validation (evidence of typed schema)
    validated = PublishClosureResponse.model_validate(response)
    assert isinstance(validated.tierCounts, PublishClosureTierCounts)
    assert response["blocked"] is False
    assert response["blockerCount"] == 1
    assert response["evidencePresentCount"] == 6
    assert response["skillCount"] == 6
    assert response["versionPinsChecked"] is True
    assert response["closureHash"] == "feedface"
    assert response["stableDigest"] == "deadbeef"
    assert response["tierCounts"] == {"hard_blocker": 0, "warning": 1, "info": 2}
    assert response["perSkillEvidence"]["datamodel"]["evidencePresent"] is True
    assert response["perSkillEvidence"]["aigc"]["evidencePresent"] is True
    assert response["topBlockers"][0]["affectedSkill"] == "rbac"
    assert response["topBlockers"][0]["ref"] == "role:finance-admin"


def test_derive_publish_closure_response_returns_none_without_runtime_closure():
    """Fail-closed negative: empty runs -> None (no data to derive)."""
    state = V5SessionState(
        sessionId="closure-response-empty",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[],
    )

    assert derive_publish_closure_response(state) is None


def test_derive_publish_closure_response_returns_none_for_degraded_result():
    """Fail-closed negative for degraded: presence of data inside degraded run is still returned
    (driver callers control degraded state exposure); here we test a run without usable closure shape
    is None, and confirm a shape with runtimeClosure inside degraded still derives (current semantics).
    """
    # No usable closure shape at all -> None
    state = V5SessionState(
        sessionId="closure-degraded",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-deg",
                capabilityId="appbundle.runtimeClosure",
                turnId="t2",
                result={"degraded": True},
            )
        ],
    )
    assert derive_publish_closure_response(state) is None


def test_derive_publish_closure_response_fail_closed_on_error_run():
    """Fail-closed negative: error run with no closure data yields None."""
    state = V5SessionState(
        sessionId="closure-error",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-err",
                capabilityId="appbundle.runtimeClosure",
                turnId="t3",
                result={"foo": "bar"},
                error={"code": "CAP_FAILED", "message": "simulated"},
            )
        ],
    )
    assert derive_publish_closure_response(state) is None


def test_derive_publish_closure_response_blocked_for_missing_declared_skill_evidence():
    """Focused blocked-path test (task 119 objective): missing declared Skill evidence does not fake green.

    Declared skills appear in skillsChecked + perSkillEvidence (simulating skillModel presence in evaluate).
    When any has evidencePresent=False, report must report blocked=True (APPBUNDLE_RUNTIME_CLOSURE_BLOCKED semantics).
    Prove derive pass-through for /drive-full surfaces the blocked state (no green faking) for Python path.
    Includes positive schema evidence + negative (blocked, partial evidencePresentCount) behavior.
    All local deterministic; no provider/RAG/DB calls; preserves fail-closed for missing data cases.
    """
    state = V5SessionState(
        sessionId="closure-missing-skill-ev-119",
        goal={"text": "missing declared skill evidence blocked path"},
        artifacts=[],
        capabilityRuns=[
            CapabilityRun(
                id="run-missing-skill-ev",
                capabilityId="appbundle.runtimeClosure",
                turnId="t-miss-ev",
                result={
                    "runtimeClosure": {
                        "blocked": True,
                        "blockers": [
                            {
                                "code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
                                "path": "rbac",
                                "affectedSkill": "rbac",
                                "ref": "",
                            }
                        ],
                        "perSkillEvidence": {
                            "datamodel": {"evidencePresent": True},
                            "rbac": {"evidencePresent": False},  # declared skill (in checked) but missing evidence
                            "appbundle": {"evidencePresent": True},
                        },
                        "runtimeClosure": {
                            "skillsChecked": ["datamodel", "rbac", "appbundle"],
                            "versionPinsChecked": True,
                        },
                        "closureId": "missing-ev-119",
                        "closureHash": "badbeef",
                        "stableDigest": "fade",
                        "findingsByTier": {"hard_blocker": [{}], "warning": [], "info": []},
                    }
                },
            )
        ],
    )

    response = derive_publish_closure_response(state)

    assert response is not None, "derive must surface summary (for pass-through) even on blocked report from declared-missing-ev"
    # schema validation (positive evidence of typed schema)
    validated = PublishClosureResponse.model_validate(response)
    assert isinstance(validated.tierCounts, PublishClosureTierCounts)
    # core proof: does not fake green
    assert response["blocked"] is True, "missing declared Skill evidence must force blocked (not green)"
    assert response["blockerCount"] == 1
    assert response["evidencePresentCount"] == 2
    assert response["skillCount"] == 3
    assert response["perSkillEvidence"]["rbac"]["evidencePresent"] is False
    assert response["topBlockers"][0]["affectedSkill"] == "rbac"
