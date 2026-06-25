"""
SlideRule AgentLoop 109: navigation shell test file.

Covers the browser navigation shell for AgentLoop.
"""

import os

import pytest


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(BASE_DIR, "static", "agent-loop", "index.html")
JS_PATH = os.path.join(BASE_DIR, "static", "agent-loop", "agent-loop-dashboard.js")


def test_agentloop_navigation_shell_109_exposes_workbench_runs_settings_and_sliderule_links():
    """agentloop navigation shell 109 exposes workbench runs settings and sliderule links

    - Navigation includes Workbench, Runs, Settings, and a SlideRule back link.
    - Active view state is represented in URL hash or documented local state.
    - Menu labels are stable enough for later React/AntD replacement.
    - No VS Code APIs; pure python-served static shell.
    """
    assert os.path.exists(HTML_PATH), "index.html must exist for navigation shell"
    assert os.path.exists(JS_PATH), "agent-loop-dashboard.js must exist"

    with open(HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()

    with open(JS_PATH, "r", encoding="utf-8") as f:
        js = f.read()

    # Required navigation labels (stable menu text)
    assert "Workbench" in html
    assert "Runs" in html
    assert "Settings" in html
    assert "SlideRule" in html

    # Back link present as anchor
    assert 'href="/"' in html or "SlideRule" in html
    assert 'data-nav="sliderule"' in html or 'class="back"' in html

    # Active view state via URL hash (or documented local state)
    assert "location.hash" in js or "hashchange" in js
    assert "setActiveView" in js or ".active" in js
    # documented in source
    assert "Active view state" in js or "URL hash" in js

    # Stable labels for future replacement (no inline dynamic labels)
    assert 'data-nav="workbench"' in html
    assert 'data-nav="runs"' in html
    assert 'data-nav="settings"' in html

    # No VS Code message APIs
    assert "acquireVsCodeApi" not in html
    assert "acquireVsCodeApi" not in js
    assert "vscode" not in html.lower()
    assert "vscode" not in js.lower()

    # Minimal structure for views
    assert 'class="nav"' in html or "id=\"nav-shell\"" in html
    assert 'class="view"' in html
