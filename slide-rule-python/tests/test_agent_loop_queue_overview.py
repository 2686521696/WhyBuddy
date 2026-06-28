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
