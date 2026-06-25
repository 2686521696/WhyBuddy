"""
SlideRule AgentLoop 108: settings API.
Python-owned non-secret settings with secret status reporting only.
"""

import os
import sys

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_settings_api_108_stores_non_secret_settings_and_hides_keys(tmp_path):
    """agentloop settings api 108 stores non secret settings and hides keys

    - Stores and returns non-secret settings: worker agents (fixAgent/reviewAgent),
      max turns (workerMaxTurns), retries (workerMaxRetries), queue path, worktree mode (worktreeScope),
      proxy flags (injectKeysToWorker), provider base URLs (baseUrl).
    - Secret responses return configured status only (no raw keys ever echoed).
    - Save operations reject unsupported enum values with 400 (or normalize).
    - Non-secrets persist (via file under env override in test).
    """
    # isolate store
    store_file = tmp_path / "agent-loop-settings.json"
    orig_env = os.environ.get("AGENT_LOOP_SETTINGS_FILE")
    os.environ["AGENT_LOOP_SETTINGS_FILE"] = str(store_file)
    try:
        # initial get works (defaults)
        r0 = client.get("/api/agent-loop/settings")
        assert r0.status_code == 200, r0.text
        d0 = r0.json()
        eff0 = d0.get("effective") or d0
        assert isinstance(eff0, dict)
        # has key non-secrets
        assert "fixAgent" in eff0 or "workerMaxTurns" in eff0

        # save non-secrets (workers, turns, retries, queue, worktree, proxy flag, base url)
        save_payload = {
            "fixAgent": "codex",
            "reviewAgent": "grok",
            "workerMaxTurns": 7,
            "workerMaxRetries": 3,
            "queuePath": "agent-loop/scripts/test-queue.json",
            "worktreeScope": "task",
            "baseUrl": "http://127.0.0.1:9999",
            "injectKeysToWorker": False,
            # secret must be dropped, never stored or echoed raw
            "grokApiKey": "sk-FAKE-THIS-MUST-NOT-BE-STORED-OR-ECHOED",
            "openaiApiKey": "sk-another-fake",
        }
        rs = client.post("/api/agent-loop/settings", json=save_payload)
        assert rs.status_code == 200, rs.text
        saved_ack = rs.json()
        assert saved_ack.get("ok") is True

        # get back: non-secrets stored
        rg = client.get("/api/agent-loop/settings")
        assert rg.status_code == 200
        data = rg.json()
        eff = data.get("effective") or data
        assert eff.get("fixAgent") == "codex"
        assert eff.get("reviewAgent") == "grok"
        assert eff.get("workerMaxTurns") == 7
        assert eff.get("workerMaxRetries") == 3
        assert "test-queue.json" in str(eff.get("queuePath"))
        assert eff.get("worktreeScope") == "task"
        assert eff.get("baseUrl") == "http://127.0.0.1:9999"
        assert eff.get("injectKeysToWorker") is False

        # secrets: only configured status (no raw value)
        keys = data.get("keys") or {}
        # even if not configured, must not contain raw secret values
        full_str = str(data).lower()
        assert "sk-fake-this-must-not" not in full_str
        assert "sk-another" not in full_str
        # keys/status shape reports configured without value leak
        if keys:
            for v in keys.values():
                assert v in ("", "configured") or isinstance(v, dict)
        # redacted list if present
        if "redacted" in data:
            assert isinstance(data["redacted"], list)

        # unsupported enum -> 400
        bad_enum = client.post("/api/agent-loop/settings", json={"fixAgent": "claude", "reviewAgent": "invalid"})
        assert bad_enum.status_code == 400, bad_enum.text

        # another bad
        bad2 = client.post("/api/agent-loop/settings", json={"worktreeScope": "cluster"})
        assert bad2.status_code == 400

        # valid after bad attempt? previous good save intact
        rg2 = client.get("/api/agent-loop/settings")
        assert rg2.status_code == 200
        eff2 = (rg2.json().get("effective") or rg2.json())
        assert eff2.get("fixAgent") == "codex"  # persisted good value
    finally:
        if orig_env is None:
            os.environ.pop("AGENT_LOOP_SETTINGS_FILE", None)
        else:
            os.environ["AGENT_LOOP_SETTINGS_FILE"] = orig_env
