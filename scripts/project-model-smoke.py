"""Live configured model -> durable control HTTP -> saved source -> real E2B.

The approved plan, isolated account and fixed starting project are fixtures.
Tool selection, tool arguments, results and follow-up model requests use the
production control loop unchanged. Command observation is a separate user turn
after the remote operation settles; the production turn budgets remain intact.
No browser, production login or business acceptance is claimed.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "slide-rule-python"
sys.path.insert(0, str(BACKEND))
TERMINAL = {"completed", "failed", "cancelled", "interrupted", "waiting_user"}


def redact(text):
    for name, value in os.environ.items():
        if value and len(value) > 7 and any(part in name.upper() for part in ("KEY", "TOKEN", "SECRET", "PASSWORD")):
            text = text.replace(value, "[redacted]")
    return text


def write_report(directory, report, name="report.json"):
    destination = directory / name
    temporary = directory / (name + ".tmp")
    temporary.write_text(redact(json.dumps(report, ensure_ascii=False, indent=2)), encoding="utf-8")
    temporary.replace(destination)


def correlate(record, events):
    """A successful SSE string alone is insufficient: match durable model IO."""
    checkpoint = record.get("checkpoint") or {}
    calls, replies = {}, {}
    for message in checkpoint.get("messages", []):
        if message.get("role") == "assistant":
            for call in message.get("tool_calls", []):
                function = call.get("function") or {}
                arguments = json.loads(function.get("arguments") or "{}")
                calls[call["id"]] = {"tool": function.get("name"), "arguments": arguments}
        elif message.get("role") == "tool":
            replies[message.get("tool_call_id")] = json.loads(message.get("content") or "{}")
    evidence = []
    for event in events:
        if event.get("type") != "control_tool_result":
            continue
        call_id = event.get("toolCallId")
        call, reply = calls.get(call_id), replies.get(call_id)
        if not call or not reply or call["tool"] != event.get("tool") or reply.get("tool") != call["tool"]:
            raise RuntimeError("model_tool_result_correlation_missing")
        for key in ("ok", "revision", "operationId", "status", "exitCode", "content", "logs"):
            if key in event and reply.get(key) != event[key]:
                raise RuntimeError("model_tool_result_correlation_mismatch")
        evidence.append({"toolCallId": call_id, **call, "result": reply})
    if not evidence:
        raise RuntimeError("live_model_did_not_execute_tools")
    return evidence


def require_edit(before, after, old_revision, new_revision, expected_title):
    expected = dict(before)
    marker = "<h1>New Project</h1>"
    if before["src/main.tsx"].count(marker) != 1:
        raise RuntimeError("fixture_heading_changed")
    expected["src/main.tsx"] = before["src/main.tsx"].replace(marker, f"<h1>{expected_title}</h1>")
    if new_revision == old_revision or after != expected:
        raise RuntimeError("model_did_not_save_requested_exact_edit")


def require_model_receipts(samples, evidence):
    for tool in evidence:
        if not any(json.loads(receipt["content"] or "{}") == tool["result"]
                   for sample in samples if sample.get("status") == "completed"
                   for receipt in sample["receivedToolResults"]
                   if receipt["toolCallId"] == tool["toolCallId"]):
            raise RuntimeError("tool_result_not_sent_back_to_live_model")


def require_verified_command(operation, revision, evidence):
    result = operation.result or {}
    if (operation.expectedRevision != revision or operation.input.get("command") != "check"
            or operation.status != "completed" or type(result.get("exitCode")) is not int
            or result["exitCode"] != 0):
        raise RuntimeError("real_e2b_check_not_passed")
    statuses = [item["result"] for item in evidence if item["tool"] == "project_status"
                and item["result"].get("operationId") == operation.operationId]
    logs = [item["result"] for item in evidence if item["tool"] == "project_logs"
            and item["result"].get("operationId") == operation.operationId]
    if not any(item.get("status") == "completed" and item.get("exitCode") == 0
               and item.get("revision") == revision for item in statuses):
        raise RuntimeError("model_did_not_observe_terminal_command_result")
    text = "".join(chunk["text"] for item in logs for chunk in item.get("logs", []))
    if "tsc --noEmit" not in text:
        raise RuntimeError("model_did_not_read_real_typecheck_logs")


async def worker(directory, timeout, scenario):
    import httpx
    from config.settings import settings

    # Windows drops empty environment values in child processes; explicitly
    # reject a dotenv gateway before any store can issue a remote DDL request.
    expected_database = "sqlite:///" + (directory / "state.db").as_posix()
    if (settings.APP_STORE_DATABASE_URL != expected_database
            or (settings.APP_STORE_HTTP_API_URL or "").strip()
            or (settings.APP_STORE_HTTP_API_KEY or "").strip()):
        raise RuntimeError("model_smoke_storage_isolation_failed")
    from app import app
    from middlewares.current_user import optional_user, require_user
    from models.v5_state import V5SessionState
    from services import persistence, rehearsal_control
    from services.control_run_service import ControlRunService
    from services.control_run_store import ControlRunStore
    from services.e2b_workspace_provider import E2BWorkspaceProvider
    from services.identity_store import get_identity_store
    from services.project_authority import approved_reference
    from services.project_creation import create_session_project, load_project_template
    from services.project_manifest import build_manifest
    from services.project_runtime_worker import ProjectRuntimeSupervisor
    from services.project_store import get_project_store, reset_project_store
    from services.session_blob_store import SqlSessionBlobStore
    from sliderule_llm.config import get_llm_config

    report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    sessions = SqlSessionBlobStore(os.environ["APP_STORE_DATABASE_URL"])
    persistence._blob_store = lambda _path=None: sessions
    store = get_project_store()
    identity = get_identity_store()
    viewer = identity.create("smoke-" + directory.name + "@example.invalid", "!no-login-smoke-fixture",
                             is_superuser=True, is_verified=True)
    owner_id = viewer.id
    app.dependency_overrides[optional_user] = lambda: viewer
    app.dependency_overrides[require_user] = lambda: viewer
    supervisor = ProjectRuntimeSupervisor(store, E2BWorkspaceProvider, max_workers=1,
        lifetime_seconds=min(timeout, 900), idle_seconds=60, install_timeout=min(timeout, 600))
    control_store = ControlRunStore(store._q)
    control = ControlRunService(control_store, store, supervisor)
    app.state.project_runtime_supervisor = supervisor
    app.state.control_run_service = control
    tables = {row["name"] for row in store._q("select name from sqlite_master where type='table'")}
    if not {"sliderule_session", "sliderule_user", "wb_control_run", "wb_project"} <= tables:
        raise RuntimeError("model_smoke_shared_database_required")
    session_id = "model-smoke-" + directory.name
    expected_title = "Model smoke " + directory.name
    config = get_llm_config()
    report["model"] = {"configuredModel": config.model, "routerModel": config.router_model,
        "configuredControlModel": os.getenv("SLIDERULE_CONTROL_MODEL") or config.model,
        "wireApi": "chat_completions", "providerHost": urlsplit(config.base_url).hostname,
        "selection": "production auto tool choice; no model or budget overrides"}
    report["modelSamples"] = []
    original_model = rehearsal_control.call_control_llm

    async def observe_model(messages, **kwargs):
        # Observe the real client result without replacing input, output or limits.
        sample = {"stage": report.get("stage"), "offeredTools": [
            tool["function"]["name"] for tool in kwargs.get("tools") or []],
            "receivedToolResults": [
                {"toolCallId": message.get("tool_call_id"), "content": message.get("content")}
                for message in messages if message.get("role") == "tool"]}
        report["modelSamples"].append(sample)
        started = time.monotonic()
        try:
            result = await original_model(messages, **kwargs)
            sample.update(status="completed", returnedModel=result.model, usage=result.usage,
                latencyMs=result.latency_ms, finishReason=result.finish_reason,
                selectedTools=copy.deepcopy(result.tool_calls))
            return result
        except BaseException as exc:
            sample.update(status="failed", error=redact(str(exc) or type(exc).__name__)[:700])
            raise
        finally:
            sample["elapsedSeconds"] = round(time.monotonic() - started, 2)
            write_report(directory, report)

    rehearsal_control.call_control_llm = observe_model
    report["sessionId"] = session_id
    report["repositoryHead"] = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
        capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    source_paths = ["services/rehearsal_control.py", "services/control_run_service.py",
        "services/project_tools.py", "sliderule_llm/control_client.py"]
    report["implementationSha256"] = {path: hashlib.sha256((BACKEND / path).read_bytes()).hexdigest()
                                        for path in source_paths}
    files, template = load_project_template()
    report.update(templateVersion=template, initialTreeHash=build_manifest(files).treeHash,
                  lockfileSha256=hashlib.sha256(files["package-lock.json"].encode()).hexdigest())
    plan = {"planId": "model-smoke-approved-plan", "revision": 1, "reqId": "model-smoke-approval",
        "planContent": f"In the existing React/Vite project change only the New Project heading to {expected_title}. "
                       "Read the source first, preserve every other byte, then run the check command in E2B and inspect status and logs. Do not publish."}
    state = V5SessionState(sessionId=session_id, ownerId=owner_id,
        goal={"text": "Edit the existing project heading and verify TypeScript in E2B", "status": "clear"},
        controlTranscript=[{**plan, "kind": kind} for kind in ("plan_written", "plan_approval", "plan_approved")])
    saved = persistence.save_session_record(state, server_write=True)
    if not saved.get("ok"):
        raise RuntimeError("model_smoke_session_not_persisted")
    project = create_session_project(store, session_id, owner_id=owner_id,
                                     approval_ref=approved_reference(state))
    project_id, initial_revision = project.projectId, project.currentRevision
    report.update(projectId=project_id, workspaceId="ws-" + project_id, initialRevision=initial_revision)
    write_report(directory, report)
    deadline = time.monotonic() + timeout - 60
    await control.start()
    supervisor.start()

    def remaining():
        return max(0.01, deadline - time.monotonic())

    def check(name):
        report["checks"].append({"name": name, "status": "passed"})
        write_report(directory, report)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://model-smoke",
            headers={"x-internal-key": os.environ["SLIDE_RULE_INTERNAL_KEY"]}) as client:
        async def turn(name, prompt):
            report["stage"] = name
            write_report(directory, report)
            payload = {"sessionId": session_id, "userText": prompt, "installedSkills": [],
                       "activeConnectors": [], "preferredDevice": "desktop", "designSystemId": None}
            response = await asyncio.wait_for(client.post("/api/sliderule/control-turn-stream", json=payload,
                headers={"x-control-request-id": directory.name + "-" + name}), timeout=remaining())
            if response.status_code != 200:
                raise RuntimeError(f"control_http_{response.status_code}")
            events = [json.loads(line[5:].strip()) for line in response.text.splitlines() if line.startswith("data:")]
            run_id = response.headers.get("x-control-run-id")
            if not run_id or not any(event.get("type") == "control_run_started" for event in events):
                raise RuntimeError("durable_control_route_not_used")
            record = control_store.get(run_id, owner_id)
            stage = {"name": name, "runId": run_id, "request": payload,
                "status": record["status"], "stopReasons": [e["stopReason"] for e in events if e.get("stopReason")],
                "eventTypes": [e.get("type") for e in events],
                "toolResults": [e for e in events if e.get("type") == "control_tool_result"]}
            report["turns"].append(stage)
            write_report(directory, report)
            if record["status"] != "completed" or not any(e.get("type") == "complete" for e in events):
                raise RuntimeError("live_control_turn_not_completed")
            if stage["stopReasons"]:
                raise RuntimeError("live_control_turn_stopped:" + str(stage["stopReasons"][0]))
            stage["correlatedTools"] = correlate(record, events)
            samples = [sample for sample in report["modelSamples"]
                       if sample["stage"] == name and sample.get("status") == "completed"]
            require_model_receipts(samples, stage["correlatedTools"])
            write_report(directory, report)
            return stage["correlatedTools"]

        try:
            if scenario == "combined-edit":
                edit = await turn("edit", f"Execute only the source-edit step of the approved plan now. "
                    f"Read src/main.tsx from the existing saved project, then change exactly the heading text "
                    f"New Project to {expected_title}. Keep every other byte and every other file unchanged. "
                    "Save the edit as a new revision. Stop after saving; I will request the E2B check separately.")
            else:
                read = await turn("read", f"Read only src/main.tsx at revision {initial_revision} "
                    "using project_read, then finish this step. This fixture project is newly created with no "
                    "operations or active runtime; no status query is needed. Only the file content and hash are "
                    "requested. Do not change files or use other tools.")
                reads = [item["result"] for item in read if item["tool"] == "project_read" and item["result"].get("ok")]
                if len(reads) != 1 or reads[0].get("truncated"):
                    raise RuntimeError("model_source_read_missing_or_truncated")
                # This is an explicit new user step with the real previous read
                # attached. It is not a forged tool message or model continuation.
                context = {key: reads[0][key] for key in ("path", "content", "revision", "sha256")}
                edit = await turn("edit", f"Apply the approved edit using the preceding real read attached below. "
                    f"Change only the heading text New Project to {expected_title}; preserve every other byte and file. "
                    f"Use approvalRef {approved_reference(state)}. There are no operations or active runtime. "
                    "The tool schema takes expectedRevision once at the top level; each changes item contains only "
                    "path, content and expectedSha256. Stop after saving the new revision; do not read again, "
                    "query status or run commands in this step. Previous actual project_read result: " + json.dumps(context, ensure_ascii=False))
                edit = read + edit
            names = [item["tool"] for item in edit if item["result"].get("ok")]
            if "project_read" not in names or "project_patch" not in names or names.index("project_read") > names.index("project_patch"):
                raise RuntimeError("model_read_before_patch_missing")
            project = store.get_project(project_id, owner_id=owner_id)
            revised = project.currentRevision
            require_edit(files, store.read_files(project_id, owner_id=owner_id), initial_revision, revised, expected_title)
            if store.read_files(project_id, initial_revision, owner_id=owner_id) != files:
                raise RuntimeError("immutable_original_revision_changed")
            persisted = persistence.load_session_record(session_id)["session"]
            if persisted.projectRevision != revised:
                raise RuntimeError("session_revision_not_updated")
            report["editedRevision"] = revised
            check("live_model_reads_and_saves_exact_edit_with_immutable_parent")

            executed = await turn("execute", "The source-edit step is complete. Queue exactly one E2B check "
                f"command for revision {revised} with approvalRef {approved_reference(state)}. Return the operation ID "
                "and stop once queued; I will ask you to inspect its result when the background operation settles. "
                "Do not modify files or start a preview.")
            dispatched = [item for item in executed if item["tool"] == "project_exec" and item["result"].get("ok")]
            if len(dispatched) != 1 or dispatched[0]["arguments"].get("command") != "check":
                raise RuntimeError("model_did_not_dispatch_one_check")
            operation_id = dispatched[0]["result"]["operationId"]
            report["operationId"] = operation_id
            check("live_model_selects_real_e2b_check_for_edited_revision")
            report["stage"] = "waiting_for_e2b"
            write_report(directory, report)
            while remaining() > 0.1:
                snapshot = await client.get("/api/sliderule/project-operations/" + operation_id)
                if snapshot.status_code != 200:
                    raise RuntimeError("operation_snapshot_unavailable")
                lease = store.get_lease(project_id, owner_id=owner_id)
                if lease and lease.sandboxId and lease.sandboxId not in report["sandboxIds"]:
                    report["sandboxIds"].append(lease.sandboxId)
                    write_report(directory, report)
                if snapshot.json()["operation"]["status"] in {"completed", "failed", "cancelled"}:
                    break
                await asyncio.sleep(1)
            else:
                raise RuntimeError("e2b_check_wait_timeout")
            operation = store.get_operation(operation_id, owner_id=owner_id)
            report["command"] = {"operationId": operation_id, "revision": operation.expectedRevision,
                "status": operation.status, "command": operation.input.get("command"),
                "exitCode": (operation.result or {}).get("exitCode"),
                "errorCode": (operation.result or {}).get("errorCode")}
            write_report(directory, report)
            observed = await turn("observe_status", f"The background wait for operation {operation_id} has ended. "
                "Read this operation's durable status and report its actual result. This step only reads status; "
                "do not launch operations, read logs or edit files. Do not claim browser or business acceptance.")
            observed += await turn("observe_logs", f"Read the command logs of operation {operation_id} and report "
                "what command actually ran. This step only reads logs; do not launch operations, read status or edit files. "
                "If needed follow the returned log cursor until you find the typecheck command.")
            require_verified_command(operation, revised, observed)
            all_operations = store.list_project_operations(project_id, owner_id=owner_id, limit=100)
            if len(all_operations) != 1 or all_operations[0].operationId != operation_id:
                raise RuntimeError("unexpected_extra_remote_operations")
            if store.get_project(project_id, owner_id=owner_id).currentRevision != revised:
                raise RuntimeError("model_changed_revision_after_check")
            check("live_model_receives_terminal_exit_and_real_typecheck_logs")
            report["status"] = "passed"
        except Exception as exc:
            report.update(status="failed", error=redact(str(exc) or type(exc).__name__)[:1000])
        finally:
            record = control_store.latest(session_id, owner_id)
            if record and record["status"] not in TERMINAL:
                await control.cancel(record["runId"], owner_id)
            for operation in store.list_project_operations(project_id, owner_id=owner_id, limit=100):
                if operation.status not in {"completed", "failed", "cancelled"}:
                    supervisor.cancel(operation.operationId, owner_id=owner_id)
            try:
                await asyncio.wait_for(control.shutdown(), timeout=20)
                await asyncio.to_thread(supervisor.shutdown, 35)
            except Exception as exc:
                report.update(status="failed", shutdownError=type(exc).__name__)
            write_report(directory, report)
            sessions._engine.dispose()
            reset_project_store()
    return 0 if report["status"] == "passed" else 1


def cleanup(directory):
    from services.e2b_workspace_provider import E2BWorkspaceProvider

    report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
    workspace_id = report.get("workspaceId")
    result = {"status": "not_needed", "workspaceId": workspace_id, "sandboxIds": []}
    if workspace_id:
        result["status"] = "pending"
        write_report(directory, result, "cleanup.json")
        provider = E2BWorkspaceProvider()
        try:
            for handle in provider.find_workspaces(workspace_id=workspace_id):
                result["sandboxIds"].append(handle.sandbox_id)
                write_report(directory, result, "cleanup.json")
                provider.destroy(handle)
            if provider.find_workspaces(workspace_id=workspace_id):
                raise RuntimeError("remote_cleanup_not_confirmed")
            result["status"] = "confirmed_empty"
        except Exception as exc:
            result["error"] = redact(str(exc))[:500]
    write_report(directory, result, "cleanup.json")
    return 0 if result["status"] in {"confirmed_empty", "not_needed"} else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=600, help="Total worker seconds, followed by at most 90 seconds of cleanup")
    parser.add_argument("--without-key", action="store_true", help="Test the blocked preflight without network calls")
    parser.add_argument("--scenario", choices=("combined-edit", "guided-tools"), default="combined-edit",
        help="Keep the combined edit as the default acceptance; guided-tools explicitly supplies separate user steps")
    parser.add_argument("--worker", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--cleanup", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 180 <= args.timeout <= 900:
        parser.error("timeout must be between 180 and 900 seconds")
    if args.cleanup:
        return cleanup(args.cleanup)
    if args.worker:
        try:
            return asyncio.run(worker(args.worker, args.timeout, args.scenario))
        except Exception as exc:
            report = json.loads((args.worker / "report.json").read_text(encoding="utf-8"))
            causes = []
            cause = exc
            while cause is not None and len(causes) < 6:
                causes.append({"type": type(cause).__name__, "message": redact(str(cause))[:700]})
                cause = cause.__cause__
            report.update(status="failed", error=redact(str(exc) or type(exc).__name__)[:1000], causes=causes)
            write_report(args.worker, report)
            return 1

    from dotenv import dotenv_values

    # Explicit overrides retain whitespace: on Windows, assigning an empty
    # environment value removes it before the child can override dotenv.
    for source in (ROOT / ".env", BACKEND / ".env"):
        for key, value in dotenv_values(source).items():
            if value is not None and (key.startswith(("LLM_", "OPENAI_")) or key in {"E2B_API_KEY", "SLIDERULE_CONTROL_MODEL"}):
                os.environ.setdefault(key, value)
    directory = ROOT / "artifacts" / "project-model" / (str(int(time.time())) + "-" + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, exist_ok=True)
    report = {"scope": "live-model-durable-control-http-real-e2b-source-edit-and-check", "status": "running",
        "scenario": args.scenario,
        "controlTransport": "actual FastAPI HTTP routes via ASGI transport",
        "fixtures": ["isolated active superuser", "already approved plan", "checked-in initial project"],
        "storage": "one isolated SQLite for session, identity, control and project stores",
        "notCovered": ["production login", "model-driven planning or approval", "private browser preview",
            "browser behavior", "application business acceptance", "unprompted autonomous task completion"],
        "checks": [], "turns": [], "sandboxIds": [], "cleanup": []}
    missing = []
    if args.without_key or not os.getenv("E2B_API_KEY"):
        missing.append("e2b_api_key_missing")
    if args.without_key or not (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")):
        missing.append("llm_api_key_missing")
    if not (os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")):
        missing.append("llm_base_url_missing")
    if importlib.util.find_spec("e2b_code_interpreter") is None:
        missing.append("e2b_sdk_missing")
    if missing:
        report.update(status="blocked", missing=missing)
        write_report(directory, report)
        print("BLOCKED " + ", ".join(missing) + "; report: " + str(directory / "report.json"))
        return 2
    database_url = "sqlite:///" + (directory / "state.db").as_posix()
    os.environ.update({"NODE_ENV": "development", "APP_STORE_DATABASE_URL": database_url,
        "APP_STORE_HTTP_API_URL": " ", "APP_STORE_HTTP_API_KEY": " ", "APP_STORE_NEON_HTTP": "0",
        "SLIDERULE_IDENTITY_SQLITE": database_url, "SLIDERULE_DISABLE_ENV_HYDRATION": "1",
        "APP_STORE_FILE": str(directory / "apps.json"), "SLIDERULE_SESSIONS_FILE": str(directory / "sessions.json"),
        "SLIDERULE_SESSION_LOCAL_IMPORT": "0", "SLIDE_RULE_INTERNAL_KEY": secrets.token_hex(32),
        "SLIDERULE_AUTH_SECRET": secrets.token_hex(32), "SLIDERULE_WEB_SEARCH": "off",
        "SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED": "1", "PYTHONIOENCODING": "utf-8"})
    write_report(directory, report)
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", str(directory),
        "--timeout", str(args.timeout), "--scenario", args.scenario], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=creationflags)
    deadline, last_stage = time.monotonic() + args.timeout, None
    interrupted = False
    try:
        while process.poll() is None and time.monotonic() < deadline:
            report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
            stage = report.get("stage")
            if stage and stage != last_stage:
                print("RUN " + stage, flush=True)
                last_stage = stage
            time.sleep(1)
        if process.poll() is None:
            interrupted = True
    except KeyboardInterrupt:
        interrupted = True
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
        if interrupted or process.returncode != 0 or report["status"] == "running":
            report.update(status="failed", error=report.get("error") or
                          ("smoke_worker_timeout_or_interrupted" if interrupted else "smoke_worker_failed"))
        write_report(directory, report)
        try:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), "--cleanup", str(directory)],
                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90, check=True,
                creationflags=creationflags)
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            report.update(status="failed", cleanupError="remote_cleanup_pending")
        cleanup_path = directory / "cleanup.json"
        report["cleanup"] = [json.loads(cleanup_path.read_text(encoding="utf-8"))] if cleanup_path.exists() else [{"status": "pending"}]
        if any(item["status"] == "pending" for item in report["cleanup"]):
            report["status"] = "failed"
        write_report(directory, report)
    print(report["status"].upper() + "; report: " + str(directory / "report.json"), flush=True)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
