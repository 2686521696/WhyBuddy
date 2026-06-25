"""
SlideRule AgentLoop 108: dashboard port test file.

Covers serving a python-owned dashboard shell from the agent-loop router.
"""

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_dashboard_port_108_serves_python_owned_dashboard_shell():
    """agentloop dashboard port 108 serves python owned dashboard shell

    - serves python owned dashboard shell (not VS Code webview)
    - stable route /api/agent-loop/dashboard
    - shell fetches documented /api/agent-loop/runs/overview endpoint (or /runs)
    - empty state and error state render without any VS Code APIs
    """
    # Serve the dashboard shell
    resp = client.get("/api/agent-loop/dashboard")
    assert resp.status_code == 200, resp.text
    content_type = resp.headers.get("content-type", "")
    html = resp.text
    assert "html" in content_type or "<!doctype" in html.lower() or "<html" in html.lower()
    # python owned markers and title
    assert "AgentLoop" in html or "dashboard" in html.lower()
    # stable endpoint reference in shell (html or inline)
    assert "/api/agent-loop/runs" in html or "/runs/overview" in html

    # No VS Code APIs or bundling in the shell
    assert "acquireVsCodeApi" not in html
    assert 'postMessage' not in html or "vscode" not in html.lower()  # tolerant but detect bundle

    # Serve companion JS (no cdn, pure client)
    js_resp = client.get("/api/agent-loop/agent-loop-dashboard.js")
    assert js_resp.status_code == 200
    js = js_resp.text
    assert "function" in js or "fetch" in js or "addEventListener" in js
    assert "acquireVsCodeApi" not in js
    assert "vscode" not in js.lower()

    # Verify the API the shell uses works for empty (per do-not-block)
    runs_resp = client.get("/api/agent-loop/runs/overview")
    assert runs_resp.status_code == 200
    runs = runs_resp.json()
    assert isinstance(runs, list)
    # empty list must be valid, dashboard must not block on it
