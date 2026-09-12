"""E2B execution with a fixed root, real process identities and private ingress.

2026-09-11: SDK foreground CommandResult has no PID. Background commands must
retain their actual handle; inventing an ID made cancellation ineffective.
Directory-fd writes avoid following symlinks left by generated project code.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import shlex
import time
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from services.project_manifest import build_manifest
from services.workspace_provider import PROJECT_REVISION_FILE, PrivatePreviewTarget, ProcessLogChunk, ProcessResult, WorkspaceHandle, WorkspaceProviderError

PROJECT_ROOT = "/home/user/workspace"
MAX_OUTPUT_BYTES = 32 * 1024
MAX_SYNC_PAYLOAD_BYTES = 64 * 1024 * 1024

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

# Validate the entire expected tree before creating even temporary files. Only
# named source paths are changed; dependency directories and app data are never
# traversed or recursively removed. Atomic individual writes do not make this a
# multi-file transaction: any failure after mutation starts is explicitly partial.
_SYNC_SCRIPT = r'''
import hashlib, json, os, re, stat, sys, uuid
changed = False
root_chain = []
root_fd = None
directory_ids = {}
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def validate_path(path):
    if not isinstance(path, str) or not path or len(path) > 240 or re.search(r"[\\:\x00-\x1f\x7f]", path):
        raise ValueError()
    parts = path.split("/")
    for part in parts:
        lower = part.casefold()
        if part in ("", ".", "..") or part.endswith((" ", ".")) or lower in (".git", "node_modules", ".venv"):
            raise ValueError()
        if lower.startswith(".env") and lower not in (".env.example", ".env.sample"):
            raise ValueError()
    return parts

def validate_manifest(entries, content=False):
    if not isinstance(entries, dict) or not 1 <= len(entries) <= 512:
        raise ValueError()
    folded, total = set(), 0
    for path, entry in entries.items():
        validate_path(path)
        if path.casefold() in folded or not isinstance(entry, dict): raise ValueError()
        folded.add(path.casefold())
        size, digest = entry.get("size"), entry.get("sha256")
        if type(size) is not int or not 0 <= size <= 512 * 1024 or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError()
        total += size
        if content:
            text = entry.get("content")
            if not isinstance(text, str) or "\x00" in text: raise ValueError()
            data = text.encode("utf-8")
            if len(data) != size or hashlib.sha256(data).hexdigest() != digest: raise ValueError()
    if total > 8 * 1024 * 1024: raise ValueError()
    for path in folded:
        parts = path.split("/")
        if any("/".join(parts[:i]) in folded for i in range(1, len(parts))): raise ValueError()

def verify_chain(chain):
    for parent, name, child in root_chain + chain:
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        pinned = os.fstat(child)
        if not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise ValueError()

def parent_for(path, create=False):
    global changed
    parts = validate_path(path)
    chain = []
    parent = root_fd
    try:
        for i, part in enumerate(parts[:-1]):
            verify_chain(chain)
            try:
                child = os.open(part, flags, dir_fd=parent)
            except FileNotFoundError:
                if not create: return None, chain
                changed = True
                os.mkdir(part, 0o700, dir_fd=parent)
                child = os.open(part, flags, dir_fd=parent)
            chain.append((parent, part, child))
            info = os.fstat(child)
            key, value = tuple(parts[:i + 1]), (info.st_dev, info.st_ino)
            if key in directory_ids and directory_ids[key] != value: raise ValueError()
            directory_ids[key] = value
            parent = child
        verify_chain(chain)
        return parent, chain
    except Exception:
        close_chain(chain)
        raise

def close_chain(chain):
    for _, _, child in reversed(chain): os.close(child)

def check_file(parent, name, expected):
    before = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != expected["size"]:
        raise ValueError()
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        if identity(os.fstat(fd)) != identity(before): raise ValueError()
        digest = hashlib.sha256()
        remaining = expected["size"] + 1
        while remaining:
            data = os.read(fd, min(65536, remaining))
            if not data: break
            digest.update(data)
            remaining -= len(data)
        if digest.hexdigest() != expected["sha256"] or identity(os.fstat(fd)) != identity(before):
            raise ValueError()
        if identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) != identity(before): raise ValueError()
    finally:
        os.close(fd)

def absent(parent, name):
    if parent is None: return
    try: os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError: return
    raise ValueError()

def verify(path, expected):
    parent, chain = parent_for(path)
    try:
        if expected is None:
            absent(parent, path.split("/")[-1])
        else:
            if parent is None: raise ValueError()
            check_file(parent, path.split("/")[-1], expected)
        verify_chain(chain)
    finally:
        close_chain(chain)

def update(path, old, new):
    global changed
    parent, chain = parent_for(path, create=new is not None)
    temporary = None
    try:
        if parent is None: raise ValueError()
        name = path.split("/")[-1]
        if old is None: absent(parent, name)
        else: check_file(parent, name, old)
        verify_chain(chain)
        if new is None:
            changed = True
            os.unlink(name, dir_fd=parent)
        else:
            changed = True
            temporary = ".wb-sync-" + uuid.uuid4().hex
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            with os.fdopen(fd, "wb") as stream:
                stream.write(new["content"].encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            verify_chain(chain)
            if old is None:
                # An unexpected new file must not be overwritten after preflight.
                os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
                os.unlink(temporary, dir_fd=parent)
            else:
                check_file(parent, name, old)
                os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
            temporary = None
        os.fsync(parent)
        verify_chain(chain)
    finally:
        if temporary is not None:
            try: os.unlink(temporary, dir_fd=parent)
            except OSError: pass
        close_chain(chain)

try:
    raw = sys.stdin.buffer.read(64 * 1024 * 1024 + 1)
    if len(raw) > 64 * 1024 * 1024: raise ValueError()
    root, marker, old, new = json.loads(raw)
    validate_manifest(old)
    validate_manifest(new, content=True)
    if marker != "public/__whybuddy_revision.json" or marker not in old or marker not in new: raise ValueError()
    differences = sorted(path for path in old.keys() | new.keys()
        if path not in old or path not in new or old[path]["sha256"] != new[path]["sha256"])
    if differences and old[marker]["sha256"] == new[marker]["sha256"]: raise ValueError()
    if not isinstance(root, str) or not root.startswith("/") or any(p in ("", ".", "..") for p in root[1:].split("/")):
        raise ValueError()
    parent = os.open("/", flags)
    root_fd = parent
    for part in root[1:].split("/"):
        child = os.open(part, flags, dir_fd=parent)
        root_chain.append((parent, part, child))
        parent = child
    root_fd = parent
    for path in sorted(old): verify(path, old[path])
    for path in sorted(new.keys() - old.keys()): verify(path, None)
    for path in differences:
        if path != marker: update(path, old.get(path), new.get(path))
    # Recheck unchanged sources too: the published revision names a whole tree.
    for path in sorted(old.keys() | new.keys()):
        if path != marker: verify(path, new.get(path))
    if marker in differences: update(marker, old[marker], new[marker])
    print(json.dumps({"status": "ok"}))
except Exception:
    print(json.dumps({"code": "e2b_source_sync_partial" if changed else "e2b_source_sync_conflict"}))
    sys.exit(1)
finally:
    if root_chain:
        first = root_chain[0][0]
        close_chain(root_chain)
        os.close(first)
    elif root_fd is not None:
        os.close(root_fd)
'''

_START_SCRIPT = r'''
import json, os, subprocess, sys
if os.getpgrp() != os.getpid():
    os.setsid()
path = "/tmp/whybuddy-process-" + str(os.getpid()) + ".log"
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "wb", buffering=0) as log:
    child = subprocess.Popen(["/bin/bash", "-c", sys.argv[1]], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    total = 0
    while True:
        chunk = os.read(child.stdout.fileno(), 4096)
        if not chunk: break
        remaining = max(0, 1024 * 1024 - total)
        kept = chunk[:remaining]
        if kept:
            log.write(kept)
            os.write(1, kept)
        total += len(chunk)
    code = child.wait()
code = code if code >= 0 else 128 - code
# envd forgets completed commands: commit the wrapper's wait result before exit.
result_path = path[:-4] + ".result"
fd = os.open(result_path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "w") as result:
    json.dump({"pid": os.getpid(), "exitCode": code}, result)
    result.flush()
    os.fsync(result.fileno())
os.replace(result_path + ".tmp", result_path)
sys.exit(code)
'''

_RESULT_SCRIPT = r'''
import base64, json, os, stat, sys
prefix = "/tmp/whybuddy-process-" + sys.argv[1]
def read(path, limit, tail=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode): raise ValueError("process_result_not_regular")
        if not tail and info.st_size > limit: raise ValueError("process_result_too_large")
        if tail: stream.seek(max(0, info.st_size - limit))
        return stream.read(limit), info.st_size
body = json.loads(read(prefix + ".result", 4096)[0])
if body.get("pid") != int(sys.argv[1]) or type(body.get("exitCode")) is not int or not 0 <= body["exitCode"] <= 255:
    raise ValueError("invalid_process_result")
log, size = read(prefix + ".log", 16384, tail=True)
body.update(data=base64.b64encode(log).decode(), truncated=size > 16384)
print(json.dumps(body))
'''

_LOG_SCRIPT = r'''
import base64, codecs, json, os, stat, sys
path, offset = "/tmp/whybuddy-process-" + sys.argv[1] + ".log", int(sys.argv[2])
try:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
except FileNotFoundError:
    if offset: sys.exit(1)
    print(json.dumps({"data": "", "nextOffset": offset, "truncated": False}))
    sys.exit(0)
with os.fdopen(fd, "rb") as stream:
    size = os.fstat(stream.fileno()).st_size
    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode) or offset > size: sys.exit(1)
    stream.seek(offset)
    data = stream.read(8192)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
decoder.decode(data, final=offset + len(data) == size and (os.path.isfile(path[:-4] + ".result") or size >= 1024 * 1024))
pending = decoder.getstate()[0]
if pending: data = data[:-len(pending)]
print(json.dumps({"data": base64.b64encode(data).decode(), "nextOffset": offset + len(data), "truncated": size >= 1024 * 1024}))
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

    def find_workspaces(self, *, workspace_id: str) -> list[WorkspaceHandle]:
        if not isinstance(workspace_id, str) or not workspace_id.strip():
            raise ValueError("invalid_workspace_request")
        try:
            from e2b import SandboxQuery

            pages = _sandbox_class().list(query=SandboxQuery(metadata={"whybuddy_workspace_id": workspace_id}),
                limit=100, api_key=self._api_key, request_timeout=20)
            handles: dict[str, WorkspaceHandle] = {}
            while pages.has_next:
                for sandbox in pages.next_items():
                    metadata = getattr(sandbox, "metadata", None)
                    sandbox_id = getattr(sandbox, "sandbox_id", None)
                    if not isinstance(metadata, dict) or metadata.get("whybuddy_workspace_id") != workspace_id:
                        raise ValueError("workspace_query_identity_mismatch")
                    if not isinstance(sandbox_id, str) or not sandbox_id:
                        raise ValueError("workspace_query_missing_identity")
                    handles[sandbox_id] = WorkspaceHandle(workspace_id, sandbox_id)
            return list(handles.values())
        except Exception as exc:
            raise WorkspaceProviderError("e2b_workspace_discovery_failed") from exc

    def _sandbox(self, handle: WorkspaceHandle) -> Any:
        if handle.sandbox_id not in self._sandboxes:
            self.connect(handle)
        return self._sandboxes[handle.sandbox_id]

    def write_files(self, handle: WorkspaceHandle, files: dict[str, str]) -> None:
        self._write_files_at_root(handle, files, PROJECT_ROOT)

    def sync_files(self, handle: WorkspaceHandle, *, expected_files: dict[str, str], files: dict[str, str]) -> None:
        """CAS against all persisted source files; a partial write is never retried here."""
        old_manifest, new_manifest = build_manifest(expected_files), build_manifest(files)
        if PROJECT_REVISION_FILE not in expected_files or PROJECT_REVISION_FILE not in files:
            raise ValueError("project_source_revision_required")
        if expected_files != files and expected_files[PROJECT_REVISION_FILE] == files[PROJECT_REVISION_FILE]:
            raise ValueError("project_source_revision_unchanged")
        old = {entry.path: {"sha256": entry.sha256, "size": entry.sizeBytes} for entry in old_manifest.files}
        new = {entry.path: {"sha256": entry.sha256, "size": entry.sizeBytes, "content": files[entry.path]}
               for entry in new_manifest.files}
        payload = json.dumps([PROJECT_ROOT, PROJECT_REVISION_FILE, old, new], ensure_ascii=True)
        if len(payload) > MAX_SYNC_PAYLOAD_BYTES:
            raise ValueError("project_source_sync_payload_too_large")
        try:
            sandbox = self._sandbox(handle)
            process = sandbox.commands.run(_python(_SYNC_SCRIPT), cwd="/home/user",
                background=True, stdin=True, timeout=60)
            for offset in range(0, len(payload), 32 * 1024):
                process.send_stdin(payload[offset:offset + 32 * 1024])
            process.close_stdin()
            try:
                result = process.wait()
            except Exception as exc:
                if type(getattr(exc, "exit_code", None)) is not int:
                    raise
                result = exc
            code = getattr(result, "exit_code", None)
            stdout = getattr(result, "stdout", None)
            if type(code) is not int or not isinstance(stdout, str) or len(stdout) > 256:
                raise ValueError()
            receipt = json.loads(stdout)
            if code == 0 and receipt == {"status": "ok"}:
                return
            if code != 0 and receipt in ({"code": "e2b_source_sync_conflict"}, {"code": "e2b_source_sync_partial"}):
                raise WorkspaceProviderError(receipt["code"], result=ProcessResult(exit_code=code))
            raise ValueError()
        except WorkspaceProviderError as exc:
            if str(exc) in {"e2b_source_sync_conflict", "e2b_source_sync_partial"}:
                raise exc from None
            raise WorkspaceProviderError("e2b_source_sync_uncertain") from None
        except Exception:
            raise WorkspaceProviderError("e2b_source_sync_uncertain") from None

    def _write_files_at_root(self, handle: WorkspaceHandle, files: dict[str, str], root: str) -> None:
        build_manifest(files)
        sandbox = self._sandbox(handle)
        try:
            process = sandbox.commands.run(_python(_WRITE_SCRIPT), cwd="/home/user",
                background=True, stdin=True, timeout=60)
            payload = json.dumps([root, files], ensure_ascii=True)
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

    def start_preview_tunnel(self, handle: WorkspaceHandle, *, agent_source: str, relay_origin: str,
                             token: str, port: int, expires_at: float) -> ProcessResult:
        """Only a scoped tunnel capability enters the application sandbox.

        Install outside the Vite root, via stdin and directory-fd writes. This
        is not a secret boundary against application code running as the same
        user: the capability must remain harmless outside this runtime/role.
        No E2B or gateway management credentials are accepted by this method.
        """
        try:
            origin = urlsplit(relay_origin)
            host, origin_port = origin.hostname or "", origin.port
            canonical = f"{origin.scheme}://{host}" + (f":{origin_port}" if origin_port is not None else "")
            origin_valid = (canonical == relay_origin and origin.scheme in {"https", "http"}
                and len(host) <= 253 and "." in host and all(re.fullmatch(
                    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split("."))
                and (origin_port is None or 1 <= origin_port <= 65535)
                and (origin.scheme == "https" or host.endswith(".localhost")))
        except (ValueError, TypeError, AttributeError):
            origin_valid = False
        now = time.time()
        if (not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
                or type(port) is not int or not 1024 <= port <= 65535
                or type(expires_at) not in (float, int) or not math.isfinite(expires_at) or not now < expires_at <= now + 901
                or not isinstance(agent_source, str) or not agent_source.strip() or len(agent_source.encode("utf-8")) > 512 * 1024
                or not origin_valid):
            raise WorkspaceProviderError("e2b_preview_tunnel_config_invalid")
        root = "/home/user/.whybuddy-preview/" + uuid.uuid4().hex
        try:
            self._write_files_at_root(handle, {"agent.cjs": agent_source, "config.json": json.dumps({
                "relayOrigin": relay_origin, "token": token, "localPort": port,
                "expiresAt": expires_at * 1000})}, root)
            return self.start_process(handle, f"node {root}/agent.cjs {root}/config.json",
                timeout_seconds=max(1, min(900, int(expires_at - time.time()) + 1)))
        except Exception:
            raise WorkspaceProviderError("e2b_preview_tunnel_start_failed") from None

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

    def process_result(self, handle: WorkspaceHandle, process_id: str) -> ProcessResult:
        pid = _pid(process_id)
        result = self.run(handle, _python(_RESULT_SCRIPT) + f" {pid}", timeout_seconds=15)
        try:
            if result.exit_code != 0 or result.output_truncated:
                raise ValueError("incomplete_process_result")
            body = json.loads(result.stdout)
            code = body["exitCode"]
            if body["pid"] != pid or type(code) is not int or not 0 <= code <= 255 or type(body["truncated"]) is not bool:
                raise ValueError("invalid_process_result")
            raw = base64.b64decode(body["data"], validate=True)
            if len(raw) > 16384:
                raise ValueError("invalid_process_result_size")
            return ProcessResult(process_id, raw.decode("utf-8", errors="replace"), "", code, body["truncated"])
        except (ValueError, KeyError, TypeError) as exc:
            raise WorkspaceProviderError("e2b_process_result_unavailable", result=result) from exc

    def read_process_logs(self, handle: WorkspaceHandle, process_id: str, *, offset: int = 0) -> ProcessLogChunk:
        pid = _pid(process_id)
        if type(offset) is not int or not 0 <= offset <= 1024 * 1024:
            raise ValueError("invalid_process_log_cursor")
        result = self.run(handle, _python(_LOG_SCRIPT) + f" {pid} {offset}", timeout_seconds=15)
        try:
            if result.exit_code != 0 or result.output_truncated:
                raise ValueError("invalid_log_result")
            body = json.loads(result.stdout)
            raw = base64.b64decode(body["data"], validate=True)
            if len(raw) > 8192 or type(body["nextOffset"]) is not int or body["nextOffset"] != offset + len(raw) or type(body["truncated"]) is not bool:
                raise ValueError("invalid_log_offset")
            return ProcessLogChunk(raw.decode("utf-8", errors="replace"), body["nextOffset"], body["truncated"])
        except (ValueError, KeyError, TypeError) as exc:
            raise WorkspaceProviderError("e2b_process_log_failed") from exc

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

    def private_preview_target(self, handle: WorkspaceHandle, port: int) -> PrivatePreviewTarget:
        """Resolve the runtime authority's registered port without publishing it.

        secure=True protects envd, not the application. Require actual private
        ingress metadata and its distinct traffic token, including on reconnect.
        No SDK error text or token enters the exception/representation contract.
        This does not strip the credential from upstream application requests;
        the live ingress smoke deliberately fails that required security check.

        Resolving access must not resume or extend billing. SDK connect() does
        both, so the runtime owner must explicitly create/connect first; this
        getter only inspects that existing client with read-only get_info().
        """
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError("invalid_preview_port")
        if (not isinstance(handle.workspace_id, str) or not handle.workspace_id.strip()
                or not isinstance(handle.sandbox_id, str)
                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{0,79}", handle.sandbox_id)):
            raise ValueError("invalid_workspace_request")
        try:
            sandbox = self._sandboxes.get(handle.sandbox_id)
            if sandbox is None:
                raise WorkspaceProviderError("e2b_preview_connection_required")
            info = sandbox.get_info(request_timeout=20)
            metadata = getattr(info, "metadata", None)
            if (getattr(sandbox, "sandbox_id", None) != handle.sandbox_id
                    or getattr(info, "sandbox_id", None) != handle.sandbox_id
                    or not isinstance(metadata, dict)
                    or metadata.get("whybuddy_workspace_id") != handle.workspace_id):
                raise WorkspaceProviderError("e2b_preview_identity_mismatch")
            network = getattr(info, "network", None)
            if not isinstance(network, dict) or network.get("allow_public_traffic") is not False:
                raise WorkspaceProviderError("e2b_preview_private_ingress_required")
            expiration = getattr(info, "end_at", None)
            if (getattr(info, "state", None) != "running" or not isinstance(expiration, datetime)
                    or expiration.tzinfo is None or expiration.utcoffset() is None
                    or expiration.timestamp() <= time.time()):
                raise WorkspaceProviderError("e2b_preview_sandbox_not_running")
            token = getattr(sandbox, "traffic_access_token", None)
            if not isinstance(token, str) or not re.fullmatch(r"[\x21-\x7e]{1,8192}", token):
                raise WorkspaceProviderError("e2b_preview_traffic_token_unavailable")
            domain = getattr(sandbox, "sandbox_domain", None)
            label = r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
            if (not isinstance(domain, str) or len(domain) > 253
                    or not re.fullmatch(label + r"(?:\." + label + r")+", domain)
                    or not any(c.isalpha() for c in domain)):
                raise WorkspaceProviderError("e2b_invalid_preview_host")
            expected_host = f"{port}-{handle.sandbox_id}.{domain}"
            host = sandbox.get_host(port)
            if host != expected_host:
                raise WorkspaceProviderError("e2b_invalid_preview_host")
            return PrivatePreviewTarget(handle.workspace_id, handle.sandbox_id, port,
                "https://" + host, expiration.timestamp(), token)
        except WorkspaceProviderError as exc:
            # Metadata adapters can wrap SDK errors. Suppress nested causes so
            # a later exception logger cannot include request credentials.
            raise WorkspaceProviderError(str(exc)) from None
        except Exception:
            raise WorkspaceProviderError("e2b_private_preview_unavailable") from None

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
