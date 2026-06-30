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
    from services.agent_loop_process_registry import write_background_run_record
except Exception as e:
    pytest.skip(f"app import failed (install requirements.txt first): {e}", allow_module_level=True)

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_agent_loop_control_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_LOOP_CONTROL_DIR", str(tmp_path / ".agent-loop" / "control"))


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
    assert data["queueRunning"] is False
    assert data["counts"]["total"] == 2
    assert data["counts"]["queueTotal"] == 1
    assert data["counts"]["running"] == 0
    assert len(data["tasks"]) == 2
    assert data["tasks"][0]["id"] == "task-a"
    assert data["tasks"][0]["running"] is False
    assert data["tasks"][0]["stale"] is True
    assert data["tasks"][0]["category"] == "attention"
    assert data["tasks"][1]["enabled"] is False
    assert data["tasks"][1]["outcomeGroup"] == "reviewed"
    assert data["tasks"][1]["category"] == "disabled"
    assert data["counts"]["done"] == 1
    assert data["counts"]["reviewed"] == 1
    assert data["counts"]["pending"] == 1
    assert data["current"]["taskLabel"] == "task-a"
    assert data["current"]["staleRun"] is True
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


def test_agentloop_queue_overview_prefers_queue_containing_active_latest_task(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    latest_dir = repo_root / ".agent-loop" / "latest"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    latest_dir.mkdir(parents=True)

    configured_queue = scripts_dir / "sliderule-v2-hardening-115-queue.json"
    configured_queue.write_text(
        json.dumps(
            {
                "tasks": [
                    {"id": "old-115-task", "task": "agent-loop/tasks/old-115-task.md", "enabled": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    active_queue = scripts_dir / "backend-python-total-cutover-105-queue.json"
    active_queue.write_text(
        json.dumps(
            {
                "tasks": [
                    {
                        "id": "backend-python-blueprint-job-store-production-takeover-105",
                        "task": "agent-loop/tasks/backend-python-blueprint-job-store-production-takeover-105.md",
                        "enabled": True,
                    },
                    {
                        "id": "backend-python-blueprint-event-bus-stream-takeover-105",
                        "task": "agent-loop/tasks/backend-python-blueprint-event-bus-stream-takeover-105.md",
                        "enabled": True,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "old-115-task.md").write_text("# old", encoding="utf-8")
    (tasks_dir / "backend-python-blueprint-job-store-production-takeover-105.md").write_text("# task 1", encoding="utf-8")
    (tasks_dir / "backend-python-blueprint-event-bus-stream-takeover-105.md").write_text("# task 2", encoding="utf-8")
    (latest_dir / "state.json").write_text(
        json.dumps(
            {
                "runId": "2026-06-27T13-43-24-683Z",
                "status": "GROK_FIX",
                "options": {
                    "task": "agent-loop/tasks/backend-python-blueprint-event-bus-stream-takeover-105.md",
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (repo_root / ".agent-loop" / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "backend-python-blueprint-job-store-production-takeover-105": {
                        "lastStatus": "HALT_HUMAN",
                        "lastOutcome": "quarantined",
                        "lastRunId": "2026-06-27T13-38-22-100Z",
                    },
                    "backend-python-blueprint-event-bus-stream-takeover-105": {
                        "lastStatus": "GROK_FIX",
                        "lastOutcome": "failed",
                        "lastRunId": "2026-06-27T13-43-24-683Z",
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/sliderule-v2-hardening-115-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))

    assert data["queuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["latestQueuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["queueStale"] is False
    assert data["counts"]["total"] == 3
    assert data["counts"]["queueTotal"] == 2
    assert data["tasks"][0]["id"] == "backend-python-blueprint-job-store-production-takeover-105"
    assert data["tasks"][0]["outcomeGroup"] == "quarantined"
    assert data["tasks"][0]["category"] == "attention"
    assert data["tasks"][1]["running"] is False
    assert data["tasks"][1]["stale"] is True
    assert data["tasks"][1]["category"] == "attention"
    assert data["tasks"][2]["id"] == "old-115-task"
    assert data["tasks"][2]["inQueue"] is False
    assert data["current"]["taskLabel"] == "backend-python-blueprint-event-bus-stream-takeover-105"
    assert data["current"]["staleRun"] is True


def test_agentloop_queue_overview_prefers_newer_queue_worktree_artifacts(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    root_loop_dir = repo_root / ".agent-loop"
    worktree_loop_dir = repo_root / ".worktrees" / "backend-python-total-cutover-105" / ".agent-loop"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    root_loop_dir.mkdir(parents=True)
    (worktree_loop_dir / "latest").mkdir(parents=True)

    configured_queue = scripts_dir / "sliderule-v2-hardening-115-queue.json"
    configured_queue.write_text(
        json.dumps(
            {
                "tasks": [
                    {"id": "old-115-task", "task": "agent-loop/tasks/old-115-task.md", "enabled": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    active_queue = scripts_dir / "backend-python-total-cutover-105-queue.json"
    active_queue.write_text(
        json.dumps(
            {
                "defaults": {
                    "useWorktree": True,
                    "worktreeScope": "queue",
                    "queueWorktreeName": "backend-python-total-cutover-105",
                    "fixAgent": "grok",
                    "reviewAgent": "codex",
                },
                "tasks": [
                    {
                        "id": "backend-python-auth-user-repository-takeover-105",
                        "task": "agent-loop/tasks/backend-python-auth-user-repository-takeover-105.md",
                        "enabled": True,
                    },
                    {
                        "id": "backend-python-auth-session-repository-production-takeover-105",
                        "task": "agent-loop/tasks/backend-python-auth-session-repository-production-takeover-105.md",
                        "enabled": True,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "old-115-task.md").write_text("# old", encoding="utf-8")
    (tasks_dir / "backend-python-auth-user-repository-takeover-105.md").write_text("# user", encoding="utf-8")
    (tasks_dir / "backend-python-auth-session-repository-production-takeover-105.md").write_text("# session", encoding="utf-8")

    (root_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "old-115-task": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "2026-06-27T00-00-00-000Z",
                        "lastUpdatedAt": "2026-06-27T00:00:00.000Z",
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "backend-python-auth-user-repository-takeover-105": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "2026-06-28T18-16-22-850Z",
                        "lastUpdatedAt": "2026-06-28T18:33:31.233Z",
                        "diffBytes": 41943,
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-landing.json").write_text(
        json.dumps(
            {
                "status": "PENDING_QUEUE_LANDING",
                "updatedAt": "2026-06-28T18:33:31.332Z",
                "tasks": [
                    {
                        "id": "backend-python-auth-user-repository-takeover-105",
                        "status": "DONE_REVIEWED",
                        "outcome": "done",
                        "runId": "2026-06-28T18-16-22-850Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "latest" / "state.json").write_text(
        json.dumps(
            {
                "runId": "2026-06-28T18-16-22-850Z",
                "status": "DONE_REVIEWED",
                "options": {
                    "task": "agent-loop/tasks/backend-python-auth-user-repository-takeover-105.md",
                    "fixAgent": "grok",
                    "reviewAgent": "codex",
                },
                "reviewVerdict": "pass",
            }
        ),
        encoding="utf-8",
    )

    os.utime(root_loop_dir / "queue-outcomes.json", (1000, 1000))
    os.utime(worktree_loop_dir / "queue-outcomes.json", (2000, 2000))
    os.utime(worktree_loop_dir / "queue-landing.json", (2000, 2000))
    os.utime(worktree_loop_dir / "latest" / "state.json", (2000, 2000))

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/sliderule-v2-hardening-115-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))

    assert data["queuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["latestQueuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["queueStale"] is False
    assert data["landing"]["status"] == "PENDING_QUEUE_LANDING"
    assert data["counts"]["queueTotal"] == 2
    assert [task["id"] for task in data["tasks"][:2]] == [
        "backend-python-auth-user-repository-takeover-105",
        "backend-python-auth-session-repository-production-takeover-105",
    ]
    assert data["tasks"][0]["status"] == "DONE_REVIEWED"
    assert data["tasks"][0]["outcomeGroup"] == "reviewed"
    assert data["tasks"][0]["category"] == "landed"


def test_agentloop_queue_overview_merges_configured_queue_worktree_even_when_root_is_newer(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    root_loop_dir = repo_root / ".agent-loop"
    worktree_loop_dir = repo_root / ".worktrees" / "backend-python-total-cutover-105" / ".agent-loop"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    root_loop_dir.mkdir(parents=True)
    worktree_loop_dir.mkdir(parents=True)

    (scripts_dir / "backend-python-total-cutover-105-queue.json").write_text(
        json.dumps(
            {
                "defaults": {
                    "useWorktree": True,
                    "worktreeScope": "queue",
                    "queueWorktreeName": "backend-python-total-cutover-105",
                },
                "tasks": [
                    {"id": "task-clean-in-worktree", "task": "agent-loop/tasks/task-clean-in-worktree.md", "enabled": True},
                    {"id": "task-root-done", "task": "agent-loop/tasks/task-root-done.md", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "task-clean-in-worktree.md").write_text("# task-clean-in-worktree\n", encoding="utf-8")
    (tasks_dir / "task-root-done.md").write_text("# task-root-done\n", encoding="utf-8")

    (root_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-clean-in-worktree": {
                        "lastStatus": "HALT_HUMAN",
                        "lastOutcome": "quarantined",
                        "lastRunId": "root-later-failed",
                        "lastUpdatedAt": "2026-06-30T09:15:55.153Z",
                    },
                    "task-root-done": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "root-done",
                        "lastUpdatedAt": "2026-06-30T09:16:00.000Z",
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-clean-in-worktree": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "worktree-clean",
                        "lastUpdatedAt": "2026-06-29T21:54:05.338Z",
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    os.utime(worktree_loop_dir / "queue-outcomes.json", (1000, 1000))
    os.utime(root_loop_dir / "queue-outcomes.json", (2000, 2000))

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/backend-python-total-cutover-105-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    by_id = {task["id"]: task for task in data["tasks"]}

    assert data["queuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["latestQueuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["queueStale"] is False
    assert by_id["task-clean-in-worktree"]["status"] == "DONE_REVIEWED"
    assert by_id["task-clean-in-worktree"]["lastRunId"] == "worktree-clean"
    assert by_id["task-clean-in-worktree"]["outcomeGroup"] == "reviewed"
    assert by_id["task-clean-in-worktree"]["category"] == "landed"
    assert by_id["task-clean-in-worktree"]["latestAttemptAt"] == "2026-06-30T09:15:55.153Z"
    assert by_id["task-root-done"]["status"] == "DONE_REVIEWED"


def test_agentloop_queue_overview_merges_root_and_queue_worktree_outcomes(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    root_loop_dir = repo_root / ".agent-loop"
    worktree_loop_dir = repo_root / ".worktrees" / "backend-python-total-cutover-105" / ".agent-loop"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    root_loop_dir.mkdir(parents=True)
    worktree_loop_dir.mkdir(parents=True)

    queue_file = scripts_dir / "backend-python-total-cutover-105-queue.json"
    queue_file.write_text(
        json.dumps(
            {
                "defaults": {
                    "useWorktree": True,
                    "worktreeScope": "queue",
                    "queueWorktreeName": "backend-python-total-cutover-105",
                },
                "tasks": [
                    {"id": "task-a", "task": "agent-loop/tasks/task-a.md", "enabled": True},
                    {"id": "task-b", "task": "agent-loop/tasks/task-b.md", "enabled": True},
                    {"id": "task-c", "task": "agent-loop/tasks/task-c.md", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    for name in ("task-a.md", "task-b.md", "task-c.md"):
        (tasks_dir / name).write_text(f"# {name}\n", encoding="utf-8")

    (root_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-a": {
                        "lastStatus": "HALT_HUMAN",
                        "lastOutcome": "quarantined",
                        "lastRunId": "old-a",
                        "lastUpdatedAt": "2026-06-27T17:20:06.183Z",
                        "applyStatus": "RESCUE_PATCH_AVAILABLE",
                        "applyErrorKind": "PARTIAL_DIFF_GATE_RED",
                        "rescuePatchAvailable": True,
                    },
                    "task-b": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "root-b",
                        "lastUpdatedAt": "2026-06-29T23:40:41.596Z",
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-a": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "fresh-a",
                        "lastUpdatedAt": "2026-06-28T17:29:26.931Z",
                    },
                    "task-b": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "stale-rescue-b",
                        "lastUpdatedAt": "2026-06-28T16:32:26.272Z",
                        "applyStatus": "RESCUE_PATCH_AVAILABLE",
                        "applyErrorKind": "PARTIAL_DIFF_GATE_RED",
                        "rescuePatchAvailable": True,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-landing.json").write_text(json.dumps({"status": "PENDING_QUEUE_LANDING"}), encoding="utf-8")
    os.utime(root_loop_dir / "queue-outcomes.json", (1000, 1000))
    os.utime(worktree_loop_dir / "queue-outcomes.json", (2000, 2000))
    os.utime(worktree_loop_dir / "queue-landing.json", (2000, 2000))

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/backend-python-total-cutover-105-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    by_id = {task["id"]: task for task in data["tasks"]}

    assert data["queuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert data["latestQueuePath"] == "agent-loop/scripts/backend-python-total-cutover-105-queue.json"
    assert by_id["task-a"]["status"] == "DONE_REVIEWED"
    assert by_id["task-a"]["lastRunId"] == "fresh-a"
    assert by_id["task-a"]["stateUpdatedAt"] == "2026-06-28T17:29:26.931Z"
    assert by_id["task-a"]["latestAttemptAt"] == "2026-06-28T17:29:26.931Z"
    assert by_id["task-a"]["outcomeGroup"] == "reviewed"
    assert by_id["task-a"]["rescuePatchAvailable"] is False
    assert by_id["task-a"]["applyStatus"] is None
    assert by_id["task-b"]["status"] == "DONE_REVIEWED"
    assert by_id["task-b"]["lastRunId"] == "root-b"
    assert by_id["task-b"]["stateUpdatedAt"] == "2026-06-29T23:40:41.596Z"
    assert by_id["task-b"]["latestAttemptAt"] == "2026-06-29T23:40:41.596Z"
    assert by_id["task-b"]["outcomeGroup"] == "reviewed"
    assert by_id["task-b"]["rescuePatchAvailable"] is False
    assert by_id["task-b"]["applyStatus"] is None
    assert by_id["task-c"]["category"] == "pending"


def test_agentloop_queue_overview_treats_done_reviewed_as_reviewed_even_with_stale_rescue_fields(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    root_loop_dir = repo_root / ".agent-loop"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    root_loop_dir.mkdir(parents=True)

    (scripts_dir / "backend-python-total-cutover-105-queue.json").write_text(
        json.dumps(
            {
                "tasks": [
                    {"id": "task-done-with-stale-rescue", "task": "agent-loop/tasks/task-done-with-stale-rescue.md", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "task-done-with-stale-rescue.md").write_text("# task\n", encoding="utf-8")
    (root_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-done-with-stale-rescue": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "clean-run",
                        "lastUpdatedAt": "2026-06-30T11:08:18.079Z",
                        "applyStatus": "RESCUE_PATCH_AVAILABLE",
                        "applyErrorKind": "PARTIAL_DIFF_GATE_RED",
                        "rescuePatchAvailable": True,
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/backend-python-total-cutover-105-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    task = data["tasks"][0]

    assert task["status"] == "DONE_REVIEWED"
    assert task["outcomeGroup"] == "reviewed"
    assert task["category"] == "landed"
    assert task["rescuePatchAvailable"] is False
    assert task["applyStatus"] is None
    assert data["counts"]["done"] == 1
    assert data["counts"]["reviewed"] == 1


def test_agentloop_queue_overview_prefers_done_reviewed_over_newer_failed_attempt(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    root_loop_dir = repo_root / ".agent-loop"
    worktree_loop_dir = repo_root / ".worktrees" / "backend-python-total-cutover-105" / ".agent-loop"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    root_loop_dir.mkdir(parents=True)
    worktree_loop_dir.mkdir(parents=True)

    (scripts_dir / "backend-python-total-cutover-105-queue.json").write_text(
        json.dumps(
            {
                "defaults": {
                    "useWorktree": True,
                    "worktreeScope": "queue",
                    "queueWorktreeName": "backend-python-total-cutover-105",
                },
                "tasks": [
                    {"id": "task-clean-with-newer-failure", "task": "agent-loop/tasks/task-clean-with-newer-failure.md", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "task-clean-with-newer-failure.md").write_text("# task\n", encoding="utf-8")
    (root_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-clean-with-newer-failure": {
                        "lastStatus": "HALT_HUMAN",
                        "lastOutcome": "failed",
                        "lastRunId": "newer-failed",
                        "lastUpdatedAt": "2026-06-30T09:14:13.331Z",
                        "diffBytes": 0,
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-clean-with-newer-failure": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "older-clean",
                        "lastUpdatedAt": "2026-06-29T11:39:56.472Z",
                        "applyStatus": "RESCUE_PATCH_AVAILABLE",
                        "applyErrorKind": "PARTIAL_DIFF_GATE_RED",
                        "rescuePatchAvailable": True,
                        "diffBytes": 24848,
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/backend-python-total-cutover-105-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    task = data["tasks"][0]

    assert task["status"] == "DONE_REVIEWED"
    assert task["lastRunId"] == "older-clean"
    assert task["outcomeGroup"] == "reviewed"
    assert task["category"] == "landed"
    assert task["rescuePatchAvailable"] is False
    assert task["applyStatus"] is None


def test_agentloop_queue_overview_separates_state_time_from_latest_attempt(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    root_loop_dir = repo_root / ".agent-loop"
    worktree_loop_dir = repo_root / ".worktrees" / "backend-python-total-cutover-105" / ".agent-loop"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    root_loop_dir.mkdir(parents=True)
    worktree_loop_dir.mkdir(parents=True)

    (scripts_dir / "backend-python-total-cutover-105-queue.json").write_text(
        json.dumps(
            {
                "defaults": {
                    "useWorktree": True,
                    "worktreeScope": "queue",
                    "queueWorktreeName": "backend-python-total-cutover-105",
                },
                "tasks": [
                    {"id": "task-clean-then-rescue", "task": "agent-loop/tasks/task-clean-then-rescue.md", "enabled": True},
                    {"id": "task-rescue-then-clean", "task": "agent-loop/tasks/task-rescue-then-clean.md", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "task-clean-then-rescue.md").write_text("# task-clean-then-rescue\n", encoding="utf-8")
    (tasks_dir / "task-rescue-then-clean.md").write_text("# task-rescue-then-clean\n", encoding="utf-8")

    (root_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-clean-then-rescue": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "newer-rescue",
                        "lastUpdatedAt": "2026-06-30T01:05:32.209Z",
                        "applyStatus": "RESCUE_PATCH_AVAILABLE",
                        "applyErrorKind": "PARTIAL_DIFF_GATE_RED",
                        "rescuePatchAvailable": True,
                    },
                    "task-rescue-then-clean": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "newer-clean",
                        "lastUpdatedAt": "2026-06-30T02:00:00.000Z",
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    (worktree_loop_dir / "queue-outcomes.json").write_text(
        json.dumps(
            {
                "tasks": {
                    "task-clean-then-rescue": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "older-clean",
                        "lastUpdatedAt": "2026-06-28T19:11:10.174Z",
                    },
                    "task-rescue-then-clean": {
                        "lastStatus": "DONE_REVIEWED",
                        "lastOutcome": "done",
                        "lastRunId": "older-rescue",
                        "lastUpdatedAt": "2026-06-28T16:32:26.272Z",
                        "applyStatus": "RESCUE_PATCH_AVAILABLE",
                        "applyErrorKind": "PARTIAL_DIFF_GATE_RED",
                        "rescuePatchAvailable": True,
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    os.utime(root_loop_dir / "queue-outcomes.json", (1000, 1000))
    os.utime(worktree_loop_dir / "queue-outcomes.json", (2000, 2000))

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/backend-python-total-cutover-105-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    by_id = {task["id"]: task for task in data["tasks"]}

    clean_then_rescue = by_id["task-clean-then-rescue"]
    assert clean_then_rescue["lastRunId"] == "newer-rescue"
    assert clean_then_rescue["stateUpdatedAt"] == "2026-06-30T01:05:32.209Z"
    assert clean_then_rescue["stateUpdatedText"] == "2026-06-30 01:05:32"
    assert clean_then_rescue["latestAttemptAt"] == "2026-06-30T01:05:32.209Z"
    assert clean_then_rescue["latestAttemptText"] == "2026-06-30 01:05:32"
    assert clean_then_rescue["outcomeGroup"] == "reviewed"
    assert clean_then_rescue["category"] == "landed"
    assert clean_then_rescue["rescuePatchAvailable"] is False
    assert clean_then_rescue["applyStatus"] is None

    rescue_then_clean = by_id["task-rescue-then-clean"]
    assert rescue_then_clean["lastRunId"] == "newer-clean"
    assert rescue_then_clean["stateUpdatedAt"] == "2026-06-30T02:00:00.000Z"
    assert rescue_then_clean["latestAttemptAt"] == "2026-06-30T02:00:00.000Z"


def test_agentloop_queue_overview_includes_all_task_files_not_only_queue_entries(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    (repo_root / ".agent-loop").mkdir(parents=True)

    queue_file = scripts_dir / "migration-queue.json"
    queue_file.write_text(
        json.dumps(
            {
                "tasks": [
                    {"id": "queued-task", "task": "agent-loop/tasks/queued-task.md", "enabled": True},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tasks_dir / "queued-task.md").write_text("# queued", encoding="utf-8")
    (tasks_dir / "new-unqueued-task.md").write_text("# new unqueued", encoding="utf-8")

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/migration-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))

    assert data["counts"]["queueTotal"] == 1
    assert data["counts"]["total"] == 2
    assert [task["id"] for task in data["tasks"]] == ["queued-task", "new-unqueued-task"]
    assert data["tasks"][0]["inQueue"] is True
    assert data["tasks"][0]["category"] == "pending"
    assert data["tasks"][1]["task"] == "agent-loop/tasks/new-unqueued-task.md"
    assert data["tasks"][1]["inQueue"] is False
    assert data["tasks"][1]["enabled"] is True
    assert data["tasks"][1]["category"] == "pending"


def test_agentloop_queue_overview_uses_background_record_and_marks_stale_runs(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    latest_dir = repo_root / ".agent-loop" / "latest"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    latest_dir.mkdir(parents=True)

    task_path = "agent-loop/tasks/current-task.md"
    (scripts_dir / "migration-queue.json").write_text(
        json.dumps({"tasks": [{"id": "current-task", "task": task_path, "enabled": True}]}),
        encoding="utf-8",
    )
    (tasks_dir / "current-task.md").write_text("# Current task\n", encoding="utf-8")
    (latest_dir / "state.json").write_text(
        json.dumps(
            {
                "runId": "2026-06-27T01-02-03-004Z",
                "status": "GROK_FIX",
                "options": {"task": task_path},
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/migration-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("AGENT_LOOP_CONTROL_DIR", str(repo_root / ".agent-loop" / "control"))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    write_background_run_record(
        {
            "runId": "bridge-2026-06-27T00-00-00-000Z",
            "pid": 4567,
            "status": "running",
            "startedAt": "2026-06-27T00:00:00.000Z",
            "heartbeatAt": "2099-01-01T00:00:00.000Z",
        }
    )

    running = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    assert running["queueRunning"] is True
    assert running["current"]["runId"] == "2026-06-27T01-02-03-004Z"
    assert running["current"]["backgroundRunId"] == "bridge-2026-06-27T00-00-00-000Z"
    assert running["current"]["pid"] == 4567
    assert running["current"]["staleRun"] is False

    write_background_run_record(
        {
            "runId": "bridge-2026-06-27T00-00-00-000Z",
            "pid": 4567,
            "status": "running",
            "startedAt": "2026-06-27T00:00:00.000Z",
            "heartbeatAt": "2000-01-01T00:00:00.000Z",
        }
    )

    stale = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))
    assert stale["queueRunning"] is False
    assert stale["current"]["staleRun"] is True
    assert stale["current"]["backgroundRunId"] == "bridge-2026-06-27T00-00-00-000Z"


def test_agentloop_queue_overview_does_not_treat_active_state_as_running_without_background_record(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "agent-loop" / "scripts"
    tasks_dir = repo_root / "agent-loop" / "tasks"
    latest_dir = repo_root / ".agent-loop" / "latest"
    scripts_dir.mkdir(parents=True)
    tasks_dir.mkdir(parents=True)
    latest_dir.mkdir(parents=True)

    task_path = "agent-loop/tasks/old-active-task.md"
    (scripts_dir / "migration-queue.json").write_text(
        json.dumps({"tasks": [{"id": "old-active-task", "task": task_path, "enabled": True}]}),
        encoding="utf-8",
    )
    (tasks_dir / "old-active-task.md").write_text("# Old active task\n", encoding="utf-8")
    (latest_dir / "state.json").write_text(
        json.dumps(
            {
                "runId": "2026-06-27T13-43-24-683Z",
                "status": "GROK_FIX",
                "options": {"task": task_path},
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    settings_file = repo_root / "data" / "agent-loop-settings.json"
    settings_file.parent.mkdir(parents=True)
    settings_file.write_text(
        json.dumps({"queuePath": "agent-loop/scripts/migration-queue.json"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENT_LOOP_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("AGENT_LOOP_CONTROL_DIR", str(repo_root / ".agent-loop" / "control"))
    monkeypatch.setattr(agent_loop_runs, "_get_repo_root", lambda: repo_root)

    data = agent_loop_runs.get_agent_loop_queue_overview(str(repo_root))

    assert data["queueRunning"] is False
    assert data["counts"]["running"] == 0
    assert data["tasks"][0]["running"] is False
    assert data["tasks"][0]["stale"] is True
    assert data["tasks"][0]["category"] == "attention"
    assert data["current"]["runId"] == "2026-06-27T13-43-24-683Z"
    assert data["current"]["backgroundRunId"] is None
    assert data["current"]["staleRun"] is True
