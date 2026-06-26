"""
SlideRule AgentLoop queue overview API tests.

Verifies the web-facing queue overview reads the same queue/outcome files as the VS Code dashboard.
"""

import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from fastapi.testclient import TestClient
    from app import app
    import services.agent_loop_runs as agent_loop_runs
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


def test_agentloop_queue_overview_reads_queue_and_outcomes(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    agent_loop_dir = repo_root / "agent-loop" / "scripts"
    agent_loop_dir.mkdir(parents=True)
    latest_dir = repo_root / ".agent-loop" / "latest"
    latest_dir.mkdir(parents=True)
    agent_tasks_dir = repo_root / "agent-loop" / "tasks"
    agent_tasks_dir.mkdir(parents=True)
    queue_root = repo_root / ".agent-loop"
    queue_root.mkdir(exist_ok=True)

    queue_file = agent_loop_dir / "migration-queue.json"
    queue_file.write_text(
        json.dumps(
            {
                "cwd": "..",
                "defaults": {
                    "fixAgent": "grok",
                    "reviewAgent": "codex",
                    "queueWorktreeName": "migration-queue",
                    "worktreeScope": "queue",
                },
                "tasks": [
                    {"id": "task-a", "task": "agent-loop/tasks/task-a.md", "enabled": True},
                    {"id": "task-b", "task": "agent-loop/tasks/task-b.md", "enabled": False},
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (agent_tasks_dir / "task-a.md").write_text("任务 A", encoding="utf-8")
    (agent_tasks_dir / "task-b.md").write_text("任务 B", encoding="utf-8")
    (latest_dir / "state.json").write_text(
        json.dumps(
            {
                "runId": "2026-06-25T12-00-00-000Z",
                "status": "GROK_FIX",
                "options": {"task": "agent-loop/tasks/task-a.md"},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (queue_root / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-a": {
                        "lastStatus": "GROK_FIX",
                        "lastOutcome": "pending",
                        "lastRunId": "2026-06-25T12-00-00-000Z",
                        "lastUpdatedAt": "2026-06-25T12:00:00.000Z",
                        "fixAgent": "grok",
                        "reviewAgent": "codex",
                        "diffBytes": 1234,
                    },
                    "task-b": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "2026-06-25T10-00-00-000Z",
                        "lastUpdatedAt": "2026-06-25T10:00:00.000Z",
                        "fixAgent": "grok",
                        "reviewAgent": "codex",
                    },
                }
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (queue_root / "queue-landing.json").write_text(json.dumps({"status": "PENDING"}, indent=2), encoding="utf-8")

    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(repo_root / "data" / "agent-loop-settings.json"))
    monkeypatch.setenv("AGENT_LOOP_RUNS_DIR", str(repo_root / ".agent-loop" / "runs"))

    direct = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    assert direct["counts"]["total"] == 2
    assert direct["tasks"][1]["outcomeGroup"] == "reviewed"

    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    resp = client.get("/api/agent-loop/queue/overview")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["queueRunning"] is True
    assert data["counts"]["total"] == 2
    assert data["counts"]["queueTotal"] == 1
    assert data["counts"]["running"] == 1
    assert len(data["tasks"]) == 2
    assert data["tasks"][0]["id"] == "task-a"
    assert data["tasks"][0]["running"] is True
    assert data["tasks"][0]["category"] == "running"
    assert data["tasks"][1]["enabled"] is False
    assert data["tasks"][1]["outcomeGroup"] == "reviewed"
    assert data["tasks"][1]["category"] == "disabled"
    assert data["counts"]["done"] == 1
    assert data["counts"]["reviewed"] == 1
    assert data["counts"]["pending"] == 0
    assert data["current"]["taskLabel"] == "task-a"
    assert data["current"]["profileName"] == "grok / codex"


def test_agentloop_queue_overview_reports_stale_active_queue_when_newer_queue_exists(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    (repo_root / ".agent-loop").mkdir(parents=True)

    old_queue = scripts_dir / "sliderule-v2-skills-113-queue.json"
    old_queue.write_text(
        json.dumps(
            {
                "tasks": [
                    {"id": "old-113-task", "task": "agent-loop/tasks/old-113-task.md", "enabled": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    new_queue = scripts_dir / "sliderule-v2-hardening-115-queue.json"
    new_queue.write_text(
        json.dumps(
            {
                "tasks": [
                    {"id": "new-115-task-a", "task": "agent-loop/tasks/new-115-task-a.md", "enabled": True},
                    {"id": "new-115-task-b", "task": "agent-loop/tasks/new-115-task-b.md", "enabled": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "old-113-task.md").write_text("# old", encoding="utf-8")
    (tasks_dir / "new-115-task-a.md").write_text("# new a", encoding="utf-8")
    (tasks_dir / "new-115-task-b.md").write_text("# new b", encoding="utf-8")

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/sliderule-v2-skills-113-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))

    assert data["queuePath"] == "agent-loop/scripts/sliderule-v2-skills-113-queue.json"
    assert data["latestQueuePath"] == "agent-loop/scripts/sliderule-v2-hardening-115-queue.json"
    assert data["queueStale"] is True
    assert [q["path"] for q in data["availableQueues"]] == [
        "agent-loop/scripts/sliderule-v2-hardening-115-queue.json",
        "agent-loop/scripts/sliderule-v2-skills-113-queue.json",
    ]
    assert data["tasks"][0]["id"] == "old-113-task"
