"""Use the SDK's real result shape: foreground completion has no PID.

Linux-only cases execute the actual remote helper scripts against real files
and child processes. Windows contract tests do not claim Linux execution.
"""

import json
import os
import shlex
import subprocess
import sys
import types

import pytest
from e2b.sandbox.commands.command_handle import CommandExitException, CommandResult

from services import e2b_workspace_provider as module
from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.workspace_provider import WorkspaceHandle, WorkspaceProviderError


def completed(stdout="", stderr="", exit_code=0):
    return CommandResult(stdout=stdout, stderr=stderr, exit_code=exit_code, error=None)


class FakeProcess:
    pid = 4242

    def __init__(self):
        self.input = ""
        self.closed = False
        self.result = completed()

    def send_stdin(self, data):
        self.input += data

    def close_stdin(self):
        self.closed = True

    def wait(self):
        assert self.closed
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeSandbox:
    sandbox_id = "sb-test"

    def __init__(self):
        self.calls = []
        self.result = completed()
        self.process = FakeProcess()
        self.commands = types.SimpleNamespace(run=self.run)
        self.killed = 0
        self.kill_error = None

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if kwargs.get("background"):
            return self.process
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def get_host(self, port):
        return f"{port}-sb-test.e2b.app"

    def kill(self):
        self.killed += 1
        if self.kill_error:
            raise self.kill_error


@pytest.fixture
def setup_provider(monkeypatch):
    fake = FakeSandbox()
    calls = []

    def create(**kwargs):
        calls.append(("create", kwargs))
        return fake

    def connect(sandbox_id, **kwargs):
        calls.append(("connect", sandbox_id, kwargs))
        return fake

    monkeypatch.setattr(module, "_sandbox_class", lambda: types.SimpleNamespace(create=create, connect=connect))
    provider = E2BWorkspaceProvider(api_key="provider-test-key")
    handle = provider.create(workspace_id="ws-1")
    return provider, handle, fake, calls


def test_create_forwards_explicit_key_and_requires_private_ingress(setup_provider):
    _, _, _, calls = setup_provider
    assert calls[0][1]["api_key"] == "provider-test-key"
    assert calls[0][1]["network"]["allow_public_traffic"] is False
    assert calls[0][1]["metadata"] == {"whybuddy_workspace_id": "ws-1"}


def test_write_and_foreground_run_share_root_without_fabricating_pid(setup_provider):
    provider, handle, fake, _ = setup_provider
    provider.write_files(handle, {"package.json": "{}", "src/index.ts": "export {};"})
    assert json.loads(fake.process.input) == [module.PROJECT_ROOT, {"package.json": "{}", "src/index.ts": "export {};"}]
    assert fake.process.closed
    assert shlex.split(fake.calls[0][0])[-1] == module._WRITE_SCRIPT
    result = provider.run(handle, "npm install --ignore-scripts")
    assert fake.calls[-1][1]["cwd"] == module.PROJECT_ROOT
    assert result.exit_code == 0
    assert result.process_id is None


@pytest.mark.parametrize("path", ["../escape", "/outside", "C:/outside", "nested/../../escape", "nested\\escape", ".env"])
def test_bad_paths_are_rejected_before_remote_execution(setup_provider, path):
    provider, handle, fake, _ = setup_provider
    with pytest.raises(ValueError):
        provider.write_files(handle, {path: "bad"})
    assert not fake.calls


def test_write_failure_preserves_real_error(setup_provider):
    provider, handle, fake, _ = setup_provider
    fake.process.result = CommandExitException(stdout="", stderr="symlink rejected", exit_code=1, error=None)
    with pytest.raises(WorkspaceProviderError, match="e2b_write_failed") as caught:
        provider.write_files(handle, {"src/a.ts": "ok"})
    assert caught.value.result.exit_code == 1
    assert caught.value.result.stderr == "symlink rejected"


def test_completed_command_failure_returns_bounded_sdk_evidence(setup_provider):
    provider, handle, fake, _ = setup_provider
    fake.result = CommandExitException(stdout="x" * (module.MAX_OUTPUT_BYTES + 1), stderr="ERR package missing", exit_code=7, error=None)
    result = provider.run(handle, "npm install")
    assert result.exit_code == 7
    assert result.stderr == "ERR package missing"
    assert len(result.stdout.encode()) <= module.MAX_OUTPUT_BYTES
    assert result.output_truncated
    assert result.process_id is None


def test_transport_failure_does_not_claim_command_completed(setup_provider):
    provider, handle, fake, _ = setup_provider
    fake.result = OSError("transport unavailable")
    with pytest.raises(WorkspaceProviderError, match="e2b_command_failed") as caught:
        provider.run(handle, "npm install")
    assert caught.value.result.exit_code is None


def test_background_start_uses_actual_sdk_pid_and_process_group(setup_provider):
    provider, handle, fake, _ = setup_provider
    command = "npm run dev -- --port 5173"
    result = provider.start_process(handle, command)
    assert result.process_id == str(fake.process.pid)
    assert result.exit_code is None
    script = shlex.split(fake.calls[-1][0])
    assert script == ["exec", "python3", "-I", "-S", "-c", module._START_SCRIPT, command]
    assert fake.calls[-1][1]["background"] is True
    assert fake.calls[-1][1]["cwd"] == module.PROJECT_ROOT


def test_background_missing_pid_is_an_error(setup_provider):
    provider, handle, fake, _ = setup_provider
    fake.process.pid = None
    with pytest.raises(WorkspaceProviderError, match="e2b_start_failed"):
        provider.start_process(handle, "npm run dev")


@pytest.mark.parametrize("pid", ["", "0", "1", "-9", "42;true", "abc", "2147483648"])
def test_stop_rejects_unowned_process_selectors(setup_provider, pid):
    provider, handle, fake, _ = setup_provider
    with pytest.raises(ValueError, match="invalid_process_id"):
        provider.stop(handle, pid)
    assert not fake.calls


def test_stop_requires_confirmation_and_propagates_failure(setup_provider):
    provider, handle, fake, _ = setup_provider
    fake.result = completed(stdout="true\n")
    assert provider.is_process_running(handle, "4242")
    fake.result = completed(stderr="still running", exit_code=1)
    with pytest.raises(WorkspaceProviderError, match="e2b_stop_failed"):
        provider.stop(handle, "4242")
    fake.result = completed(stdout="false\n")
    provider.stop(handle, "4242")
    assert shlex.split(fake.calls[-1][0])[-2:] == ["4242", "stop"]
    assert not provider.is_process_running(handle, "4242")


def test_new_provider_reconnects_using_persisted_identity(setup_provider):
    _, handle, _, calls = setup_provider
    other = E2BWorkspaceProvider(api_key="second-provider-key")
    assert other.run(handle, "pwd").exit_code == 0
    assert calls[-1] == ("connect", handle.sandbox_id, {"timeout": 900, "api_key": "second-provider-key"})


def test_destroy_failure_keeps_retryable_handle(setup_provider):
    provider, handle, fake, calls = setup_provider
    fake.kill_error = OSError("temporary outage")
    with pytest.raises(WorkspaceProviderError, match="e2b_destroy_failed"):
        provider.destroy(handle)
    fake.kill_error = None
    provider.destroy(handle)
    assert fake.killed == 2
    assert len(calls) == 1
    assert handle.sandbox_id not in provider._sandboxes


def test_destroy_already_expired_sandbox_uses_id_without_reconnecting(monkeypatch):
    calls = []
    def kill(sandbox_id, **kwargs):
        calls.append((sandbox_id, kwargs))
        return False
    monkeypatch.setattr(module, "_sandbox_class", lambda: types.SimpleNamespace(kill=kill))
    provider = E2BWorkspaceProvider(api_key="explicit-key")
    provider.destroy(WorkspaceHandle("workspace", "expired-sandbox"))
    assert calls == [("expired-sandbox", {"api_key": "explicit-key"})]


def test_preview_host_rejects_url_authority_injection(setup_provider):
    provider, handle, fake, _ = setup_provider
    assert provider.preview_url(handle, 5173) == "https://5173-sb-test.e2b.app"
    for value in ("https://evil.example", "good.example@evil.example", "evil.example/path", "evil.example#frag"):
        fake.get_host = lambda port: value
        with pytest.raises(WorkspaceProviderError, match="invalid_preview_host"):
            provider.preview_url(handle, 5173)


def test_provider_fails_closed_without_key(monkeypatch):
    monkeypatch.delenv("E2B_API_KEY", raising=False)
    with pytest.raises(WorkspaceProviderError, match="api_key_missing"):
        E2BWorkspaceProvider()


@pytest.mark.skipif(sys.platform != "linux", reason="remote writer uses Linux dir_fd and O_NOFOLLOW")
def test_remote_writer_preserves_outside_files_across_links(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("original")
    (root / "linked").symlink_to(tmp_path, target_is_directory=True)
    (root / "final.txt").symlink_to(outside)
    for path in ("linked/outside.txt", "final.txt"):
        result = subprocess.run([sys.executable, "-I", "-S", "-c", module._WRITE_SCRIPT],
            input=json.dumps([str(root), {path: "bad"}]), text=True, capture_output=True)
        assert result.returncode != 0
        assert outside.read_text() == "original"
    os.link(outside, root / "hard.txt")
    result = subprocess.run([sys.executable, "-I", "-S", "-c", module._WRITE_SCRIPT],
        input=json.dumps([str(root), {"hard.txt": "changed", "src/a.txt": "created"}]), text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert outside.read_text() == "original"
    assert (root / "hard.txt").read_text() == "changed"
    assert (root / "src/a.txt").read_text() == "created"


@pytest.mark.skipif(sys.platform != "linux", reason="remote process monitor uses Linux /proc")
def test_remote_stop_terminates_parent_and_child():
    process = subprocess.Popen([sys.executable, "-I", "-S", "-c", module._START_SCRIPT,
        "sleep 60 & wait"], start_new_session=True)
    try:
        running = subprocess.run([sys.executable, "-I", "-S", "-c", module._PROCESS_SCRIPT, str(process.pid), "status"], text=True, capture_output=True)
        assert running.stdout.strip() == "true"
        stopped = subprocess.run([sys.executable, "-I", "-S", "-c", module._PROCESS_SCRIPT, str(process.pid), "stop"], text=True, capture_output=True, timeout=10)
        assert stopped.returncode == 0, stopped.stderr
        assert stopped.stdout.strip() == "false"
        process.wait(timeout=5)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
