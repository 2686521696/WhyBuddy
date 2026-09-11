"""E2B implementation of the project workspace provider.

This adapter deliberately contains no project authorization. Callers must
check the ProjectStore lease before invoking it and persist the returned
provider identifiers in that lease. The SDK is imported lazily so ordinary
tests and deployments without E2B installed fail closed at operation time.
"""

from __future__ import annotations

import os
import shlex
import uuid
from typing import Any

from services.workspace_provider import ProcessResult, WorkspaceHandle, WorkspaceProviderError


def _sandbox_class() -> Any:
    try:
        from e2b_code_interpreter import Sandbox  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover - depends on optional SDK
        raise WorkspaceProviderError("e2b_sdk_unavailable") from exc
    return Sandbox


class E2BWorkspaceProvider:
    def __init__(self, *, api_key: str | None = None):
        self._api_key = (api_key or os.getenv("E2B_API_KEY") or "").strip()
        if not self._api_key:
            raise WorkspaceProviderError("e2b_api_key_missing")
        self._sandboxes: dict[str, Any] = {}

    def create(self, *, workspace_id: str, template: str | None = None, timeout_seconds: int = 900) -> WorkspaceHandle:
        if not workspace_id or not 1 <= timeout_seconds <= 86_400:
            raise ValueError("invalid_workspace_request")
        Sandbox = _sandbox_class()
        try:
            sandbox = Sandbox.create(template, timeout=timeout_seconds) if template else Sandbox.create(timeout=timeout_seconds)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_create_failed") from exc
        sandbox_id = str(getattr(sandbox, "sandbox_id", "") or "")
        if not sandbox_id:
            try:
                sandbox.kill()
            except Exception:
                pass
            raise WorkspaceProviderError("e2b_missing_sandbox_id")
        self._sandboxes[sandbox_id] = sandbox
        return WorkspaceHandle(workspace_id=workspace_id, sandbox_id=sandbox_id)

    def _sandbox(self, handle: WorkspaceHandle) -> Any:
        sandbox = self._sandboxes.get(handle.sandbox_id)
        if sandbox is None:
            raise WorkspaceProviderError("workspace_handle_unknown")
        return sandbox

    def write_files(self, handle: WorkspaceHandle, files: dict[str, str]) -> None:
        sandbox = self._sandbox(handle)
        try:
            for path, content in files.items():
                if not path.startswith("/"):
                    path = "/workspace/" + path
                sandbox.files.write(path, content)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_write_failed") from exc

    def run(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 60) -> ProcessResult:
        if not command.strip() or not 1 <= timeout_seconds <= 3600:
            raise ValueError("invalid_workspace_command")
        sandbox = self._sandbox(handle)
        try:
            result = sandbox.commands.run(command, timeout=timeout_seconds)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_command_failed") from exc
        process_id = str(getattr(result, "process_id", "") or getattr(result, "pid", "") or uuid.uuid4().hex)
        return ProcessResult(process_id=process_id, stdout=str(getattr(result, "stdout", "") or ""),
                             stderr=str(getattr(result, "stderr", "") or ""),
                             exit_code=getattr(result, "exit_code", None))

    def preview_url(self, handle: WorkspaceHandle, port: int) -> str:
        if not 1 <= port <= 65_535:
            raise ValueError("invalid_preview_port")
        sandbox = self._sandbox(handle)
        try:
            value = sandbox.get_host(port)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_preview_host_failed") from exc
        host = str(value or "").strip()
        if not host or "://" in host or any(ch.isspace() for ch in host):
            raise WorkspaceProviderError("e2b_invalid_preview_host")
        return "https://" + host

    def stop(self, handle: WorkspaceHandle, process_id: str) -> None:
        if not process_id or any(ch in process_id for ch in "\r\n;&|`"):
            raise ValueError("invalid_process_id")
        # Processes are started by the provider's shell and stopped remotely;
        # the PID is never accepted from a browser or client request directly.
        self.run(handle, "kill " + shlex.quote(process_id), timeout_seconds=20)

    def destroy(self, handle: WorkspaceHandle) -> None:
        sandbox = self._sandbox(handle)
        try:
            sandbox.kill()
        except Exception as exc:
            raise WorkspaceProviderError("e2b_destroy_failed") from exc
        finally:
            self._sandboxes.pop(handle.sandbox_id, None)
