"""E2B execution with a fixed root, real process identities and private ingress.

2026-09-11: SDK foreground CommandResult has no PID. Background commands must
retain their actual handle; inventing an ID made cancellation ineffective.
Directory-fd writes avoid following symlinks left by generated project code.
"""

from __future__ import annotations

import json
import os
import re
import shlex
from typing import Any

from services.project_manifest import build_manifest
from services.workspace_provider import ProcessResult, WorkspaceHandle, WorkspaceProviderError

PROJECT_ROOT = "/home/user/workspace"
MAX_OUTPUT_BYTES = 32 * 1024

# Source arrives on stdin. Directory descriptors and atomic replacement prevent
# symlink races and avoid truncating a hard link to a file outside the project.
_WRITE_SCRIPT = r'''
import json, os, stat, sys, uuid
root, files = json.load(sys.stdin)
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
fd = os.open("/", flags)
try:
    for part in root.strip("/").split("/"):
        try: os.mkdir(part, mode=0o700, dir_fd=fd)
        except FileExistsError: pass
        child = os.open(part, flags, dir_fd=fd)
        os.close(fd)
        fd = child
    for path, content in files.items():
        parts = path.split("/")
        if any(p in ("", ".", "..") for p in parts):
            raise ValueError("invalid_project_path")
        parent = os.dup(fd)
        temporary = None
        try:
            for part in parts[:-1]:
                try: os.mkdir(part, mode=0o700, dir_fd=parent)
                except FileExistsError: pass
                child = os.open(part, flags, dir_fd=parent)
                os.close(parent)
                parent = child
            try:
                existing = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                if not stat.S_ISREG(existing.st_mode):
                    raise ValueError("project_file_not_regular")
            except FileNotFoundError: pass
            temporary = ".wb-write-" + uuid.uuid4().hex
            output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            with os.fdopen(output, "wb") as stream:
                stream.write(content.encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, parts[-1], src_dir_fd=parent, dst_dir_fd=parent)
            temporary = None
        finally:
            if temporary is not None:
                try: os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError: pass
            os.close(parent)
finally:
    os.close(fd)
'''

_START_SCRIPT = r'''
import os, sys
if os.getpgrp() != os.getpid():
    os.setsid()
os.execv("/bin/bash", ["bash", "-c", sys.argv[1]])
'''

# Include npm's child server. Check captured start times before signalling so a
# PID reused between enumeration and cancellation does not target a new process.
_PROCESS_SCRIPT = r'''
import json, os, signal, sys, time
root = int(sys.argv[1])
def snapshot():
    found = {}
    for name in os.listdir("/proc"):
        if not name.isdecimal(): continue
        try:
            with open("/proc/" + name + "/stat") as stream:
                fields = stream.read().rpartition(")")[2].split()
            if fields[0] != "Z":
                found[int(name)] = (int(fields[1]), int(fields[2]), fields[19])
        except (FileNotFoundError, ProcessLookupError): pass
    return found
def members(table):
    chosen = {pid for pid, data in table.items() if pid == root or data[1] == root}
    while True:
        more = {pid for pid, data in table.items() if data[0] in chosen}
        if more <= chosen: return chosen
        chosen |= more
table = snapshot()
known = {pid: table[pid][2] for pid in members(table)}
if sys.argv[2] == "stop":
    for sig in (signal.SIGTERM, signal.SIGKILL):
        current = snapshot()
        for pid in members(current): known.setdefault(pid, current[pid][2])
        for pid, start in known.items():
            if pid in current and current[pid][2] == start:
                try: os.kill(pid, sig)
                except ProcessLookupError: pass
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            current = snapshot()
            alive = {pid for pid, start in known.items() if pid in current and current[pid][2] == start}
            alive |= members(current)
            if not alive: break
            time.sleep(0.05)
    current = snapshot()
    alive = {pid for pid, start in known.items() if pid in current and current[pid][2] == start} | members(current)
    if alive: raise RuntimeError("project_process_still_running")
    print("false")
else:
    print(json.dumps(bool(known)))
'''


def _sandbox_class() -> Any:
    try:
        from e2b_code_interpreter import Sandbox
    except ImportError as exc:  # pragma: no cover - optional SDK
        raise WorkspaceProviderError("e2b_sdk_unavailable") from exc
    return Sandbox


def _python(script: str) -> str:
    return "python3 -I -S -c " + shlex.quote(script)


def _result(value: Any, *, process_id: str | None = None) -> ProcessResult:
    def bounded(name: str) -> tuple[str, bool]:
        raw = str(getattr(value, name, "") or "").encode("utf-8")
        return raw[-MAX_OUTPUT_BYTES:].decode("utf-8", errors="ignore"), len(raw) > MAX_OUTPUT_BYTES

    stdout, out_cut = bounded("stdout")
    stderr, err_cut = bounded("stderr")
    code = getattr(value, "exit_code", None)
    return ProcessResult(process_id, stdout, stderr, code if isinstance(code, int) else None, out_cut or err_cut)


def _pid(process_id: str) -> int:
    if not isinstance(process_id, str) or not re.fullmatch(r"[1-9][0-9]{0,9}", process_id):
        raise ValueError("invalid_process_id")
    value = int(process_id)
    if not 2 <= value <= 2_147_483_647:
        raise ValueError("invalid_process_id")
    return value


class E2BWorkspaceProvider:
    def __init__(self, *, api_key: str | None = None):
        self._api_key = (api_key or os.getenv("E2B_API_KEY") or "").strip()
        if not self._api_key:
            raise WorkspaceProviderError("e2b_api_key_missing")
        self._sandboxes: dict[str, Any] = {}

    def create(self, *, workspace_id: str, template: str | None = None, timeout_seconds: int = 900) -> WorkspaceHandle:
        if not workspace_id or not 1 <= timeout_seconds <= 86_400:
            raise ValueError("invalid_workspace_request")
        try:
            sandbox = _sandbox_class().create(template=template, timeout=timeout_seconds,
                api_key=self._api_key, network={"allow_public_traffic": False},
                metadata={"whybuddy_workspace_id": workspace_id})
        except Exception as exc:
            raise WorkspaceProviderError("e2b_create_failed") from exc
        sandbox_id = str(getattr(sandbox, "sandbox_id", "") or "")
        if not sandbox_id:
            try:
                sandbox.kill()
            finally:
                raise WorkspaceProviderError("e2b_missing_sandbox_id")
        self._sandboxes[sandbox_id] = sandbox
        return WorkspaceHandle(workspace_id, sandbox_id)

    def connect(self, handle: WorkspaceHandle, *, timeout_seconds: int = 900) -> WorkspaceHandle:
        if not handle.workspace_id or not handle.sandbox_id or not 1 <= timeout_seconds <= 86_400:
            raise ValueError("invalid_workspace_request")
        try:
            sandbox = _sandbox_class().connect(handle.sandbox_id, timeout=timeout_seconds, api_key=self._api_key)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_connect_failed") from exc
        if str(getattr(sandbox, "sandbox_id", "")) != handle.sandbox_id:
            raise WorkspaceProviderError("e2b_sandbox_identity_mismatch")
        self._sandboxes[handle.sandbox_id] = sandbox
        return handle

    def _sandbox(self, handle: WorkspaceHandle) -> Any:
        if handle.sandbox_id not in self._sandboxes:
            self.connect(handle)
        return self._sandboxes[handle.sandbox_id]

    def write_files(self, handle: WorkspaceHandle, files: dict[str, str]) -> None:
        build_manifest(files)
        sandbox = self._sandbox(handle)
        try:
            process = sandbox.commands.run(_python(_WRITE_SCRIPT), cwd="/home/user",
                background=True, stdin=True, timeout=60)
            payload = json.dumps([PROJECT_ROOT, files], ensure_ascii=True)
            for offset in range(0, len(payload), 32 * 1024):
                process.send_stdin(payload[offset:offset + 32 * 1024])
            process.close_stdin()
            result = _result(process.wait())
            if result.exit_code != 0:
                raise WorkspaceProviderError("e2b_write_failed", result=result)
        except WorkspaceProviderError:
            raise
        except Exception as exc:
            raise WorkspaceProviderError("e2b_write_failed", result=_result(exc)) from exc

    def run(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 60) -> ProcessResult:
        if not command.strip() or not 1 <= timeout_seconds <= 3600:
            raise ValueError("invalid_workspace_command")
        try:
            result = self._sandbox(handle).commands.run(command, cwd=PROJECT_ROOT, timeout=timeout_seconds)
            completed = _result(result)
            if completed.exit_code is None:
                raise WorkspaceProviderError("e2b_command_incomplete", result=completed)
            return completed
        except WorkspaceProviderError:
            raise
        except Exception as exc:
            failed = _result(exc)
            if failed.exit_code is not None:
                return failed
            raise WorkspaceProviderError("e2b_command_failed", result=failed) from exc

    def start_process(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 900) -> ProcessResult:
        if not command.strip() or not 1 <= timeout_seconds <= 86_400:
            raise ValueError("invalid_workspace_command")
        try:
            process = self._sandbox(handle).commands.run("exec " + _python(_START_SCRIPT) + " " + shlex.quote(command),
                cwd=PROJECT_ROOT, background=True, timeout=timeout_seconds)
            process_id = str(getattr(process, "pid", ""))
            _pid(process_id)
            return ProcessResult(process_id=process_id)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_start_failed", result=_result(exc)) from exc

    def is_process_running(self, handle: WorkspaceHandle, process_id: str) -> bool:
        process_id = str(_pid(process_id))
        result = self.run(handle, _python(_PROCESS_SCRIPT) + " " + process_id + " status", timeout_seconds=20)
        if result.exit_code != 0 or result.stdout.strip() not in ("true", "false"):
            raise WorkspaceProviderError("e2b_process_status_failed", result=result)
        return result.stdout.strip() == "true"

    def preview_url(self, handle: WorkspaceHandle, port: int) -> str:
        if not 1 <= port <= 65_535:
            raise ValueError("invalid_preview_port")
        try:
            host = str(self._sandbox(handle).get_host(port) or "").strip()
        except Exception as exc:
            raise WorkspaceProviderError("e2b_preview_host_failed") from exc
        if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?", host):
            raise WorkspaceProviderError("e2b_invalid_preview_host")
        return "https://" + host

    def probe(self, handle: WorkspaceHandle, port: int, *, expected_revision: str) -> bool:
        if isinstance(port, bool) or not 1024 <= port <= 65535 or not expected_revision:
            raise ValueError("invalid_runtime_probe")
        script = '''import json, sys, urllib.request
base = "http://127.0.0.1:" + sys.argv[1]
try:
    with urllib.request.urlopen(base + "/", timeout=5) as page:
        if page.status != 200 or not page.read(1): sys.exit(1)
    with urllib.request.urlopen(base + "/__whybuddy_revision.json", timeout=5) as marker:
        if marker.status != 200 or json.loads(marker.read(4096)).get("revision") != sys.argv[2]: sys.exit(1)
except Exception:
    sys.exit(1)
'''
        result = self.run(handle, _python(script) + " " + str(port) + " " + shlex.quote(expected_revision), timeout_seconds=15)
        return result.exit_code == 0

    def renew(self, handle: WorkspaceHandle, *, timeout_seconds: int = 900) -> None:
        if not 1 <= timeout_seconds <= 86_400:
            raise ValueError("invalid_workspace_timeout")
        try:
            self._sandbox(handle).set_timeout(timeout_seconds)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_renew_failed") from exc

    def stop(self, handle: WorkspaceHandle, process_id: str) -> None:
        process_id = str(_pid(process_id))
        result = self.run(handle, _python(_PROCESS_SCRIPT) + " " + process_id + " stop", timeout_seconds=20)
        if result.exit_code != 0 or result.stdout.strip() != "false":
            raise WorkspaceProviderError("e2b_stop_failed", result=result)

    def destroy(self, handle: WorkspaceHandle) -> None:
        try:
            sandbox = self._sandboxes.get(handle.sandbox_id)
            if sandbox is not None:
                sandbox.kill()
            else:
                # The SDK's class kill returns False for an expired sandbox.
                # Reconnecting first would make already-gone resources impossible
                # to reconcile, permanently blocking rebuild from saved source.
                _sandbox_class().kill(handle.sandbox_id, api_key=self._api_key)
        except Exception as exc:
            raise WorkspaceProviderError("e2b_destroy_failed") from exc
        self._sandboxes.pop(handle.sandbox_id, None)
