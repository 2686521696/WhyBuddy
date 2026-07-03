"""Publish/runtime closure response extraction for Python drive-full."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import CapabilityRun, V5SessionState  # noqa: E402
from services.v5_publish_closure_response import derive_publish_closure_response  # noqa: E402


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
                        "blockers": [],
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
    assert response["blocked"] is False
    assert response["evidencePresentCount"] == 6
    assert response["skillCount"] == 6
    assert response["versionPinsChecked"] is True
    assert response["closureHash"] == "feedface"
    assert response["stableDigest"] == "deadbeef"
    assert response["tierCounts"] == {"hard_blocker": 0, "warning": 1, "info": 2}
    assert response["perSkillEvidence"]["datamodel"]["evidencePresent"] is True
    assert response["perSkillEvidence"]["aigc"]["evidencePresent"] is True


def test_derive_publish_closure_response_returns_none_without_runtime_closure():
    state = V5SessionState(
        sessionId="closure-response-empty",
        goal={"text": "publish closure"},
        artifacts=[],
        capabilityRuns=[],
    )

    assert derive_publish_closure_response(state) is None
