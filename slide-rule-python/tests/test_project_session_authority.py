"""Project identity and verification cannot be forged through legacy session PUT.

These tests exercise the existing HTTP/save path, including stale driver writes.
Adding a field only to V5SessionState would let the ordinary session update
silently overwrite the server's project pointer or claim a browser verification.
"""

import pytest

from control_turn_support import KEY, client, new_sid, seed_session
from models.v5_state import V5SessionState
from services.slide_rule_session import load_session, save_session


PROJECT_FIELDS = {
    "runtimeKind": "project",
    "projectId": "project-owned",
    "projectRevision": "revision-owned",
}


def test_old_sessions_keep_the_html_runtime():
    state = V5SessionState(sessionId="old", goal={})
    assert state.runtimeKind == "html-prototype"
    assert state.projectId is None and state.projectRevision is None


def test_client_put_cannot_claim_a_project_or_browser_success():
    sid = new_sid("project-forgery")
    seed_session(sid)
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": {}, **PROJECT_FIELDS,
        "projectVerification": {"status": "passed"},
    })
    assert response.status_code == 200
    state = load_session(sid)
    assert state.runtimeKind == "html-prototype"
    assert state.projectId is None
    assert "projectVerification" not in state.model_dump()


@pytest.mark.parametrize("incoming", [{}, {
    "runtimeKind": "html-prototype", "projectId": "other-project", "projectRevision": "forged",
}])
def test_client_snapshot_cannot_erase_or_replace_existing_project(incoming):
    sid = new_sid("project-roundtrip")
    state = seed_session(sid)
    state = state.model_copy(update=PROJECT_FIELDS)
    save_session(state, server_write=True, require_durable=True)
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": state.goal, **incoming,
    })
    assert response.status_code == 200
    stored = load_session(sid)
    assert {key: getattr(stored, key) for key in PROJECT_FIELDS} == PROJECT_FIELDS


def test_late_html_driver_cannot_clear_server_project_reference():
    sid = new_sid("project-stale-driver")
    stale = seed_session(sid).model_copy(deep=True)
    current = stale.model_copy(update=PROJECT_FIELDS)
    save_session(current, server_write=True, require_durable=True)
    stale.lastTurnId = "999999"
    save_session(stale, server_write=True, require_durable=True)
    stored = load_session(sid)
    assert {key: getattr(stored, key) for key in PROJECT_FIELDS} == PROJECT_FIELDS


def test_client_put_cannot_create_new_session_with_project_identity():
    sid = new_sid("project-new-forgery")
    response = client.put(f"/api/sliderule/sessions/{sid}", headers=KEY, json={
        "sessionId": sid, "goal": {}, **PROJECT_FIELDS,
    })
    assert response.status_code == 200
    assert load_session(sid).runtimeKind == "html-prototype"
    assert load_session(sid).projectId is None
