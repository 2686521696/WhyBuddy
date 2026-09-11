import types

import pytest

from services.e2b_workspace_provider import E2BWorkspaceProvider
from services.workspace_provider import WorkspaceProviderError


class FakeSandbox:
    def __init__(self):
        self.sandbox_id = "sb-test"
        self.files = types.SimpleNamespace(write=lambda path, content: setattr(self, "written", (path, content)))
        self.commands = types.SimpleNamespace(run=lambda command, timeout: types.SimpleNamespace(stdout="ok", stderr="", exit_code=0, pid="42"))
        self.killed = False

    def get_host(self, port):
        return f"sb-test-{port}.e2b.app"

    def kill(self):
        self.killed = True


def test_provider_lifecycle_is_explicit_and_returns_real_preview(monkeypatch):
    fake = FakeSandbox()
    monkeypatch.setattr("services.e2b_workspace_provider._sandbox_class", lambda: types.SimpleNamespace(create=lambda **kwargs: fake))
    provider = E2BWorkspaceProvider(api_key="test")
    handle = provider.create(workspace_id="ws-1")
    provider.write_files(handle, {"package.json": "{}"})
    result = provider.run(handle, "npm test")
    assert result.process_id == "42"
    assert provider.preview_url(handle, 5173) == "https://sb-test-5173.e2b.app"
    provider.stop(handle, result.process_id)
    provider.destroy(handle)
    assert fake.killed


def test_provider_fails_closed_without_key(monkeypatch):
    monkeypatch.delenv("E2B_API_KEY", raising=False)
    with pytest.raises(WorkspaceProviderError, match="api_key_missing"):
        E2BWorkspaceProvider()


def test_preview_rejects_malformed_host(monkeypatch):
    fake = FakeSandbox()
    fake.get_host = lambda port: "https://evil.example"
    monkeypatch.setattr("services.e2b_workspace_provider._sandbox_class", lambda: types.SimpleNamespace(create=lambda **kwargs: fake))
    provider = E2BWorkspaceProvider(api_key="test")
    handle = provider.create(workspace_id="ws-1")
    with pytest.raises(WorkspaceProviderError, match="invalid_preview_host"):
        provider.preview_url(handle, 5173)
