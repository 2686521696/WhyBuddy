"""
Test for SlideRule AgentLoop 111 settings profile runtime.

Verifies no fake profile/queue default success stubs in runtime surfaces.
"""

import os
import sys
from pathlib import Path

# Ensure services can be imported when running pytest from slide-rule-python/
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.agent_loop_settings import (
    load_agent_loop_settings,
    save_agent_loop_settings,
)


def test_agentloop_settings_profile_runtime_111_avoids_fake_profile_and_queue_default_success(tmp_path, monkeypatch):
    """agentloop settings profile runtime 111 avoids fake profile and queue default success"""
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(tmp_path / "agent-loop-settings.json"))

    # load must return real non-secret state; never synthetic profile collections
    data = load_agent_loop_settings()
    assert isinstance(data, dict)
    # explicitly avoid fakes that would pretend full profile/queue persistence
    assert "profiles" not in data
    assert "queueDefaults" not in data
    assert "diagnostics" not in data
    assert "queueApply" not in data
    # activeProfile and other non-secrets are the real persisted surface
    assert "activeProfile" in data
    assert data.get("activeProfile") in (None, "") or isinstance(data.get("activeProfile"), str)

    # save must persist only allowed; never inject fake profile structures
    saved = save_agent_loop_settings({
        "activeProfile": "runtime111",
        "workerMaxTurns": 64,
    })
    assert isinstance(saved, dict)
    assert saved.get("activeProfile") == "runtime111"
    assert "profiles" not in saved
    assert "queueDefaults" not in saved
    assert "diagnostics" not in saved

    # roundtrip via load after save (persistence truth)
    reloaded = load_agent_loop_settings()
    assert reloaded.get("activeProfile") == "runtime111"
    assert "profiles" not in reloaded
