"""
SlideRule AgentLoop 109: task detail view (browser shell against python run detail endpoint).
"""

import os

import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(BASE_DIR, "static", "agent-loop", "index.html")
JS_PATH = os.path.join(BASE_DIR, "static", "agent-loop", "agent-loop-dashboard.js")


def test_agentloop_task_detail_view_109_renders_flow_timeline_review_diff_output_and_artifacts():
    """agentloop task detail view 109 renders flow timeline review diff output and artifacts

    Acceptance:
    - Detail view uses the Python run detail endpoint.
    - Flow, timeline, review, diff, agent output, and artifact sections have stable DOM anchors.
    - Missing sections render empty states instead of crashing.
    - No VS Code bridge code.
    """
    assert os.path.exists(HTML_PATH), "index.html must exist"
    assert os.path.exists(JS_PATH), "agent-loop-dashboard.js must exist"

    with open(HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()

    with open(JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()

    # No VS Code specific code (per do-not)
    assert "acquireVsCodeApi" not in html
    assert "acquireVsCodeApi" not in js
    assert "vscode" not in html.lower()
    assert "vscode" not in js.lower()

    # Detail view container present
    assert 'id="detail"' in html

    # Stable DOM anchors for required sections
    assert 'id="flow"' in html
    assert 'id="timeline"' in html
    assert 'id="review"' in html
    assert 'id="diff"' in html
    assert 'id="agent-output"' in html
    assert 'id="artifacts"' in html

    # Uses the Python run detail endpoint (not overview only)
    assert "/api/agent-loop/runs/" in js
    assert 'fetch(' in js and ('/runs/' in js or 'loadDetail' in js)

    # Empty state support for missing sections (no crash)
    assert 'class="empty"' in html or 'empty' in js
    assert 'No ' in js or '.empty' in js  # covers render empty paths

    # Detail activation logic present (clickable from runs, render)
    assert 'loadDetail' in js
    assert 'renderDetail' in js or 'renderSection' in js
    # clickable runs list items wired
    assert 'data-run-id' in html or 'data-run-id' in js
    assert 'onclick' in js or 'loadDetail' in js