"""Closed, typed project-tool inputs shared by model dispatch and HTTP adapters."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class CreateArguments(ToolArguments):
    approvalRef: str = Field(min_length=1, max_length=240)


class RevisionArguments(ToolArguments):
    revision: str | None = Field(default=None, min_length=1, max_length=240)


class ListArguments(RevisionArguments):
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=20)


class ReadArguments(RevisionArguments):
    path: str = Field(min_length=1, max_length=240)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=2000, ge=1, le=2000)


class SearchArguments(RevisionArguments):
    query: str = Field(min_length=1, max_length=200)
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=8, ge=1, le=8)
    caseSensitive: bool = False


class WriteArguments(ToolArguments):
    approvalRef: str = Field(min_length=1, max_length=240)
    expectedRevision: str = Field(min_length=1, max_length=240)


class FileChange(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    content: str | None = Field(max_length=512 * 1024)
    expectedSha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")


class PatchArguments(WriteArguments):
    changes: list[FileChange] = Field(min_length=1, max_length=64)


class StartArguments(WriteArguments):
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")
    port: int = Field(default=5173, ge=1024, le=65535)


class ExecArguments(WriteArguments):
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")
    command: Literal["check", "build", "test"]


class VerifyArguments(WriteArguments):
    runtimeOperationId: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")


class StatusArguments(ToolArguments):
    operationId: str | None = Field(default=None, min_length=1, max_length=240)
    waitSeconds: float = Field(default=2, ge=0, le=5)
    operationCursor: str = Field(default="", max_length=240)


class OperationArguments(ToolArguments):
    operationId: str = Field(min_length=1, max_length=240)


class LogsArguments(OperationArguments):
    afterSeq: int = Field(default=0, ge=0)
    offset: int = Field(default=0, ge=0)


PROJECT_ARGUMENTS = {
    "project_create": CreateArguments,
    "project_list": ListArguments,
    "project_read": ReadArguments,
    "project_search": SearchArguments,
    "project_patch": PatchArguments,
    "project_start": StartArguments,
    "project_exec": ExecArguments,
    "project_verify": VerifyArguments,
    "project_verification": OperationArguments,
    "project_status": StatusArguments,
    "project_logs": LogsArguments,
    "project_cancel": OperationArguments,
}
PROJECT_TOOL_NAMES = frozenset(PROJECT_ARGUMENTS)
PROJECT_WRITE_TOOLS = frozenset({"project_create", "project_patch", "project_start", "project_exec", "project_verify"})

_DESCRIPTIONS = {
    "project_create": "Create or recover this session's fixed React/TypeScript/Vite source project using the current approved plan reference. Returns source revision; does not start execution or claim delivery.",
    "project_list": "List immutable project files with SHA256 and source revision. Continue with nextCursor and the returned revision while truncated.",
    "project_read": "Read a bounded character slice of a saved source file. Use returned SHA256 for patch preconditions. Continue with nextOffset and the same revision.",
    "project_search": "Search saved source for literal text, with bounded line excerpts. Use nextCursor and the same revision to continue; this is not regex or shell execution.",
    "project_patch": "Apply exact file replacements/deletions to this session project using expectedRevision and per-file expectedSha256 (null only for new files). A ready runtime queues source/assets to its existing worker and returns operationId: poll project_status until completed with synchronized=true before using the returned new revision. Dependencies/startup configuration require a stopped, reconciled runtime. Submission is not completion; old verification is not proof for new source.",
    "project_start": "Queue managed installation and Vite startup for an exact approved source revision. Use one idempotencyKey per intended operation, then inspect status/logs. Ready is not verified delivery; private browser preview may remain unavailable.",
    "project_exec": "Queue one fixed project command (check, build or test) in E2B for the approved source revision. Reuse idempotencyKey on retries. Poll status/logs for actual results. A command passing is not browser or business verification.",
    "project_verify": "Queue the trusted react-vite-counter@1 browser suite against a ready runtime and its exact approved source revision. It checks the visible heading, counter clicks, reload reset and page/resource errors in a separate browser sandbox. Keep the runtime running; its owner serializes checks and source edits. Reuse idempotencyKey when retrying. Read project_verification with the returned operationId. Missing browser or preview is blocked; passing this narrow suite never means full business delivery.",
    "project_verification": "Read trusted browser assertions and artifact references for this session's verification operation. Source or approval changes make old evidence stale. Use real failed assertions to guide source fixes, then request a new verification. Never treat queued/completed alone as passed or a template suite as business acceptance.",
    "project_status": "Without operationId, discover this session's saved operations and current revision; continue with nextOperationCursor while hasMoreOperations. With operationId, read durable status and optionally wait up to waitSeconds (max 5). A status is not business acceptance.",
    "project_logs": "Read bounded durable command output. Continue using returned nextSeq and nextOffset until hasMore is false. Full logs remain available through the authorized operation HTTP endpoint.",
    "project_cancel": "Request cancellation of this session project's operation. Cancelling is intent; wait for a terminal status to confirm remote cleanup. Approval is not needed to stop owned work.",
}


def project_tool_definitions() -> list[dict]:
    return [{"type": "function", "function": {
        "name": name, "description": _DESCRIPTIONS[name], "parameters": model.model_json_schema(),
    }} for name, model in PROJECT_ARGUMENTS.items()]


PROJECT_TOOLS = project_tool_definitions()
