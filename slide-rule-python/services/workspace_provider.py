"""Provider contract for disposable project workspaces.

The provider owns remote execution details; project_store owns source and
leases. Keeping this protocol free of HTTP routes makes it usable by workers
and by deterministic contract tests.
"""

from dataclasses import dataclass
from typing import Protocol


class WorkspaceProviderError(RuntimeError):
    """A provider operation failed or returned an unusable result."""

    def __init__(self, code: str, *, result: "ProcessResult | None" = None):
        super().__init__(code)
        self.result = result


@dataclass(frozen=True)
class ProcessResult:
    process_id: str | None = None
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    output_truncated: bool = False


@dataclass(frozen=True)
class WorkspaceHandle:
    workspace_id: str
    sandbox_id: str


class WorkspaceProvider(Protocol):
    def create(self, *, workspace_id: str, template: str | None = None, timeout_seconds: int = 900) -> WorkspaceHandle: ...
    def connect(self, handle: WorkspaceHandle, *, timeout_seconds: int = 900) -> WorkspaceHandle: ...
    def write_files(self, handle: WorkspaceHandle, files: dict[str, str]) -> None: ...
    def run(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 60) -> ProcessResult: ...
    def start_process(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 900) -> ProcessResult: ...
    def is_process_running(self, handle: WorkspaceHandle, process_id: str) -> bool: ...
    def probe(self, handle: WorkspaceHandle, port: int, *, expected_revision: str) -> bool: ...
    def renew(self, handle: WorkspaceHandle, *, timeout_seconds: int = 900) -> None: ...
    def preview_url(self, handle: WorkspaceHandle, port: int) -> str: ...
    def stop(self, handle: WorkspaceHandle, process_id: str) -> None: ...
    def destroy(self, handle: WorkspaceHandle) -> None: ...
