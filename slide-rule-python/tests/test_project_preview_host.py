"""The real durable scanner must start Vite with the relay's exact Host allowed.

Local HTTP health alone missed the cloud failure: the smoke had this environment
variable, the product worker did not. These tests submit real operations to the
scanner and inspect the commands actually dispatched to the provider. Only the
remote provider is fake; the store, lease, manager and origin validator are real.
"""

import shlex

import pytest

from test_project_preview_runtime import scanner
from test_project_runtime_worker import setup, submit, eventually, state


@pytest.mark.parametrize("origin", [
    "https://{runtimeId}.preview.example.com",
    "https://{runtimeId}.preview.example.com:8443",
    "http://{runtimeId}.localhost:3002",
])
def test_real_worker_allows_only_its_runtime_relay_hostname(scanner, monkeypatch, origin):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", origin)
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(worker, scanner.project)
    ready = eventually(lambda: state(scanner.store, operation, "ready"))
    eventually(lambda: scanner.sent)
    runtime_id = ready.runtime.runtimeId
    expected_host = f"{runtime_id}.localhost" if ".localhost" in origin else f"{runtime_id}.preview.example.com"
    assert scanner.provider.commands[0] == "npm ci --ignore-scripts"
    assert shlex.split(scanner.provider.commands[1]) == [
        f"__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS={expected_host}",
        "npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort",
    ]
    assert scanner.sent[0]["relay_origin"] == origin.replace("{runtimeId}", runtime_id)
    assert "*" not in scanner.provider.commands[1]
    assert "allowedHosts" not in scanner.provider.commands[1]
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


def test_unconfigured_worker_keeps_default_command_and_never_uses_ambient_hosts(scanner, monkeypatch):
    # Production composition deliberately omits the manager if preview config
    # is missing; stray host-related tool/environment fields cannot enable it.
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    worker = scanner.make_worker()
    operation = submit(worker, scanner.project)
    eventually(lambda: state(scanner.store, operation, "ready"))
    assert scanner.provider.commands == ["npm ci --ignore-scripts",
        "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"]
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))


@pytest.mark.parametrize("origin", [
    "https://preview.example.com",
    "https://*.preview.example.com/{runtimeId}",
    "https://{runtimeId}.preview.example.com;echo-pwned",
    "https://{runtimeId}.$(whoami).example.com",
    "https://{runtimeId}.preview.example.com\ntrue",
    "https://user:secret@{runtimeId}.preview.example.com",
    "http://{runtimeId}.preview.example.com",
])
def test_bad_preview_origin_fails_before_any_remote_execution(scanner, monkeypatch, origin):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", origin)
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = submit(worker, scanner.project)
    failed = eventually(lambda: state(scanner.store, operation, "failed"))
    assert failed.status == "failed"
    assert failed.runtime.errorCode in {"project_preview_origin_invalid", "project_preview_origin_not_configured"}
    assert scanner.provider.commands == []
    assert scanner.provider.created == 0
    assert not scanner.sent


def test_build_operations_do_not_add_or_require_preview_hosts(scanner, monkeypatch):
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    worker = scanner.make_worker(preview_runtime=scanner.manager)
    operation = worker.submit_command(scanner.project.projectId, owner_id="alice",
        expected_revision=scanner.project.currentRevision, approval_ref="plan-1",
        idempotency_key="build-without-preview", command="build")
    eventually(lambda: state(scanner.store, operation, "executing"))
    eventually(lambda: len(scanner.provider.commands) == 2)
    assert scanner.provider.commands == ["npm ci --ignore-scripts", "npm run build"]
    assert not scanner.sent
    worker.cancel(operation.operationId, owner_id="alice")
    eventually(lambda: state(scanner.store, operation, "stopped"))
