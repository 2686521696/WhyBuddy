"""
SlideRule AgentLoop 110: web route shell test.

Covers first-class /AgentLoop (and /agent-loop) route served by the Python app.
"""

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_web_route_shell_110_exposes_agentloop_route_from_python_dashboard():
    """agentloop web route shell 110 exposes agentloop route from python dashboard

    - /AgentLoop or /agent-loop serves the AgentLoop shell (python owned, no vscode)
    - shell reads the Python event replay path (/snapshot or /events) as preferred state source
    - existing /api/agent-loop/dashboard route remains available for compatibility
    - no live workers required; uses documented replay + overview endpoints
    """
    # First-class top level routes
    for path in ("/AgentLoop", "/agent-loop"):
        resp = client.get(path)
        assert resp.status_code == 200, f"{path} failed: {resp.text[:200]}"
        content_type = resp.headers.get("content-type", "")
        html = resp.text
        assert "html" in content_type or "<!doctype" in html.lower() or "<html" in html.lower()
        assert "AgentLoop" in html
        # python owned, no vscode
        assert "acquireVsCodeApi" not in html
        assert "postMessage" not in html or "vscode" not in html.lower()
        # references api endpoints (overview ok, and since js updated for snapshot)
        assert "/api/agent-loop/runs" in html or "/runs" in html

    # Compatibility: existing dashboard route
    dash = client.get("/api/agent-loop/dashboard")
    assert dash.status_code == 200
    assert "AgentLoop" in dash.text or "dashboard" in dash.text.lower()
    assert "acquireVsCodeApi" not in dash.text

    # JS served
    jsr = client.get("/api/agent-loop/agent-loop-dashboard.js")
    assert jsr.status_code == 200
    js = jsr.text
    assert "fetch" in js
    assert "acquireVsCodeApi" not in js
    assert "vscode" not in js.lower()
    # 110: prefers event replay snapshot path
    assert "/snapshot" in js or "/events" in js

    # Verify replay paths exist and are usable (no worker needed)
    # overview must work
    ov = client.get("/api/agent-loop/runs/overview")
    assert ov.status_code == 200
    assert isinstance(ov.json(), list)

    # snapshot endpoint (preferred source) returns object even for unknown run
    snap = client.get("/api/agent-loop/runs/unknown-run-xyz/snapshot")
    assert snap.status_code == 200
    sdata = snap.json()
    assert isinstance(sdata, dict)
    assert "status" in sdata or "runId" in sdata or "finalized" in sdata

    # events replay path
    evs = client.get("/api/agent-loop/runs/unknown-run-xyz/events")
    assert evs.status_code == 200
    assert isinstance(evs.json(), list)
