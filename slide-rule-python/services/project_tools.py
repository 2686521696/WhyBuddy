"""Session-bound model tools over immutable sources and durable E2B operations.

Tool arguments cannot choose a project or owner. Even a server-side caller holding
an old approved state must re-read durable session authority before each write.
Source edits hold the same fencing lease as the worker, and never reuse a lease
whose sandbox or dispatch references still need reconciliation.
"""

from __future__ import annotations

import base64
import json
import re
import time
import uuid
from types import SimpleNamespace

from pydantic import ValidationError

from services.persistence import PersistClosedError
from services.control_checkpoint import guard_control_run
from services.project_authority import approved_reference, verification_with_current_authority
from services.project_creation import create_session_project, load_authorized_session, sync_session_project
from services.project_manifest import (
    canonical_json, content_hash, file_content_matches, file_name_matches,
    file_tree_matches, kernel_str_replace_changes, kernel_write_changes,
    prepare_source_patch, source_path, workspace_file_path,
)
from services.project_store import ProjectConflict, ProjectNotFound, ProjectStoreUnavailable
from services.project_source_operations import ProjectSourceOperations
from services.project_browser_interact import local_playwright_available, run_browser_action
from services.project_tool_contracts import (
    BROWSER_INTERACT_TOOLS, FILE_READ_EXCERPT_CHARS, FILE_READ_EXCERPT_LINES,
    LEAKED_UNAVAILABLE, PROJECT_ARGUMENTS, PROJECT_KERNEL_WRITE_TOOLS,
    PROJECT_READ_MAX_RESULT_CHARS, PROJECT_WRITE_TOOLS, PatchArguments,
    classify_shell_command, compile_browser_action, explicit_read_window,
    leaked_browser_url_allowed,
    leaked_shell_exec_dir_allowed,
    SHELL_EXEC_FOREGROUND_BLOCK_SECONDS,
)
from services.deliverable_kind import (
    OFFICE_START_NOT_APPLICABLE, OFFICE_VERIFY_NOT_APPLICABLE,
    WORKSPACE_TEMPLATE_VERSION,
    idle_office_exec_allows_source_write,
    operation_left_on_lease,
    is_office_artifact_path, is_office_file_plan,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore, decode_office_write
from services.control_skills import catalog_skill_slug
from services.skill_catalog_store import installed_skill_infos, local_seed_skill_info


def _skill_body_for_catalog_path(path: str, owner_id: str | None) -> str | None:
    """技能目录标签读不到工程文件时，交种子正文，不许变成 project_file_not_found。"""
    slug = catalog_skill_slug(path)
    if not slug:
        return None
    if owner_id:
        try:
            for info in installed_skill_infos(owner_id):
                if getattr(info, "name", None) == slug and getattr(info, "body", None):
                    return info.body
        except Exception:
            pass
    seeded = local_seed_skill_info(slug)
    if seeded is not None and getattr(seeded, "body", None):
        return seeded.body
    return None
from services.scope_authority import latest_control_plan, plan_execution_authorized
from services.project_rollout import rollout_readiness
from services.project_acceptance import approved_acceptance_requirements

MAX_RESULT_CHARS = 3800

_TERMINAL = {"completed", "failed", "cancelled"}


def _size(value):
    return len(json.dumps(value, ensure_ascii=False))


def _bounded_text(value, key, text, cap=None):
    """Account for JSON escaping so the outer control result cap never cuts a cursor."""
    cap = MAX_RESULT_CHARS if cap is None else cap
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if _size({**value, key: text[:middle]}) <= cap:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def _bounded_log_text(result, item, text):
    low, high = 0, min(len(text), 2000)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = {**result, "logs": result["logs"] + [{**item, "text": text[:middle]}]}
        if _size(candidate) <= MAX_RESULT_CHARS:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def present_project_tool_result(body: Any) -> Any:
    """回喂给模型的工程回执只留一个当前版本。

    ⚠ 2026-09-24 sr-20260924094114：file_write 同时给出 revision（新）和
    parentRevision（写入前）。模型把后者读成「源码版本又跳回了」，
    下一跳去核对文件并整份重生成。runtime.revision 是沙盒挂载时的版本，
    也可以比当前头更旧，同样不能跟 revision 并排。
    库里的父子关系不动，只改模型看见的这一份。

    不在回执里写「别重生成」。旧版本号已经不在这一份里，这句没有事实可绑，
    而且每一次写入都说。整份重写是停滞，归已有的打转闸，不归提示词。
    """
    if not isinstance(body, dict):
        return body
    out = dict(body)
    out.pop("parentRevision", None)
    runtime = out.get("runtime")
    if isinstance(runtime, dict):
        runtime = dict(runtime)
        runtime.pop("revision", None)
        out["runtime"] = runtime
    return out


def queue_blocker(adapter, operation_id) -> dict | None:
    """一条 queued 的操作排在谁后面。没人挡、或者查不到，返回 None。

    ⚠ 2026-09-25 隔离真机 sr-20260925025649-74E9KCWHAB（记账网页）：
      runtime.start（pop-7aa459…）起了开发服务器，runtime 已 ready，操作本身
      一直是 running——开发服务器不会自己结束。之后的 project_exec、
      shell_exec、browser_navigate 全是 queued，模型轮着查了六次 status，
      每次只看见 queued，不知道是谁挡着、也不知道挡的那个永远不会让路。

    判据取工人真用的那一条：工程租约 processRefs.operationId 指向另一条
    未终态的操作（`list_runnable_operations` 就是按它跳过的），不另编规则。
    增强类，查不到就当没有（fail-open，CLAUDE.md §7）。
    """
    try:
        operation = adapter.store.get_operation(operation_id, owner_id=adapter.owner_id)
        # ⚠ 2026-09-25 K1N7JX1FPS：project_verify 被挂上「排在开发服务器后面，
        #   先停掉它」。验收（和 live patch）是那台运行时的子操作，由它自己的
        #   工人执行，从不排租约——停掉它反而把验收一起停了。
        if operation.status != "queued" or operation.input.get("runtimeOperationId"):
            return None
        lease = adapter.store.get_lease(operation.projectId, owner_id=adapter.owner_id)
        holder_id = lease.processRefs.get("operationId") if lease else None
        if not holder_id or holder_id == operation.operationId:
            return None
        holder = adapter.store.get_operation(holder_id, owner_id=adapter.owner_id)
    except Exception:
        return None
    if holder.status in _TERMINAL and holder.pendingEvent is None:
        return None
    return {"operationId": holder.operationId, "kind": holder.kind, "status": holder.status,
        # 开发服务器 running 就是常驻：等它结束等于等到租约过期。
        "neverYields": holder.kind == "runtime.start" and holder.status not in _TERMINAL,
        "duplicateStart": operation.kind == "runtime.start" and holder.kind == "runtime.start"}


def explain_queue(adapter, body):
    """queued 的回执说清被谁挡住、该怎么办。见 queue_blocker。"""
    if not isinstance(body, dict) or body.get("status") != "queued" or not body.get("operationId"):
        return body
    blocker = queue_blocker(adapter, body["operationId"])
    if blocker is None:
        return body
    hid = blocker["operationId"]
    if blocker["duplicateStart"]:
        # ⚠ 2026-09-25 K1N7JX1FPS：这里原来也劝「先停掉挡路的」。模型照做，
        #   停掉在跑的那台，排队的旧启动顶上来，它再发一个——6 起 4 停。
        hint = (f"已经有开发服务器 {hid} 在跑，这条启动是多余的。预览、浏览器、验收都直接用 {hid}，"
                f"不要停它；这条排队的用 shell_kill_process 带 {body['operationId']} 取消掉。")
    elif blocker["neverYields"]:
        hint = (f"这条排在 {hid}（runtime.start，开发服务器，正在运行）后面。开发服务器不会自己结束，"
                f"它不停，这条就不会开始，再查状态也还是 queued。要跑这条，先用 shell_kill_process 停掉 {hid}；"
                "不要再提交新的启动，它也会排在同一个位置。")
    else:
        hint = (f"这条排在 {hid}（{blocker['kind']}，{blocker['status']}）后面，它结束后才会开始。"
                f"用 project_status 带 {hid} 看它的进度，不要重复提交。")
    return {**body, "blockedBy": {k: blocker[k] for k in ("operationId", "kind", "status")},
        "queueHint": hint}


def operation_snapshot(snapshot):
    operation = snapshot["operation"]
    result = {"operationId": operation.operationId, "kind": operation.kind,
        "status": operation.status, "revision": operation.expectedRevision,
        "cancelRequested": operation.cancelRequested, "lastSeq": snapshot["lastSeq"]}
    runtime = snapshot.get("runtime")
    expired_lease = False
    if runtime is not None:
        active = operation.status not in _TERMINAL
        expired_lease = active and (snapshot.get("leaseExpiresAt") or 0) <= time.time()
        result["runtime"] = {"status": "reconciling" if expired_lease else runtime.status,
            "revision": runtime.revision, "health": "unknown" if expired_lease else runtime.health,
            "errorCode": "workspace_lease_expired" if expired_lease else runtime.errorCode,
            "expiresAt": runtime.expiresAt}
    # Only command outcomes are model-visible. Provider handles and the worker's
    # recovery/result payload remain private even when new fields are added.
    saved = operation.result or {}
    # 抄 grok：接单成功 ≠ 命令跑完。queued / running 没有 exitCode，
    # 模型不许把 ok:true 说成「已经 build 过」。runtime.start 以 ready 为准
    # （服务中的沙盒不会进 completed，等它死就是 2026-09-16 那次钉目标）。
    serving = (
        operation.kind == "runtime.start"
        and runtime is not None
        and not expired_lease
        and runtime.status == "ready"
    )
    result["commandFinished"] = operation.status in _TERMINAL or serving
    for name in ("command", "exitCode", "errorCode"):
        if name in saved and isinstance(saved[name], (str, int, type(None))):
            result[name] = saved[name][:240] if isinstance(saved[name], str) else saved[name]
    # ⚠ 2026-09-24：成功路径把 template/files/skip 写进 result["gate"]。
    #   skip=True 只表示没跑 npm ci，命令已经跑完。抄进回执后模型读成
    #   「这条没执行」。留在操作记录和 orch_trace，不进这份快照。
    for name in ("officeFiles", "officeFilesHeld"):
        files = saved.get(name)
        if isinstance(files, list) and files:
            result[name] = [str(item)[:240] for item in files[:8] if isinstance(item, str)]
    downloads = saved.get("officeDownloads")
    if isinstance(downloads, dict) and downloads:
        result["officeDownloads"] = {
            str(path)[:240]: str(url)[:300]
            for path, url in list(downloads.items())[:8]
            if isinstance(path, str) and isinstance(url, str) and url.startswith("/api/")
        }
    # 用户原件没放进沙盒时必须让模型看见——否则它会去沙盒里找一份不存在的文件，
    # 或者照样说「已经处理了你的报价表」。
    skipped = saved.get("uploadsSkipped")
    if isinstance(skipped, list) and skipped:
        result["uploadsSkipped"] = [str(item)[:240] for item in skipped[:8] if isinstance(item, str)]
    if saved.get("officeScan") in {"empty", "failed"}:
        result["officeScan"] = saved["officeScan"]
    if operation.kind == "runtime.patch":
        # ⚠ 2026-09-24 真机 sr-20260924094114：回执同时给 revision 和
        #   parentRevision。模型把后者读成「源码版本又跳回了」，写一次核一次、
        #   再整份重生成。上一版只留在库里，不进模型看见的回执。
        for name in ("revision", "runtimeOperationId", "synchronized", "sourcePublished"):
            if name in saved and isinstance(saved[name], (str, bool)):
                result[name] = saved[name]
        result["verification"] = "not_run"
    elif operation.kind == "runtime.verify":
        requirements = operation.input.get("acceptanceRequirements") if isinstance(operation.input, dict) else None
        result["acceptanceRequirements"] = list(requirements or [])
    return result


def _pointer_file(path, text, revision):
    """无窗读：路径 + 文件头，不把全文灌进 messages。"""
    lines = text.splitlines(keepends=True)
    excerpt = "".join(lines[:FILE_READ_EXCERPT_LINES])
    if len(excerpt) > FILE_READ_EXCERPT_CHARS:
        excerpt = excerpt[:FILE_READ_EXCERPT_CHARS]
    return {
        "revision": revision.revision,
        "path": path,
        "sha256": content_hash(text),
        "totalChars": len(text),
        "lineCount": len(lines),
        "excerpt": excerpt,
        "content": "",
        "nextOffset": 0,
        "truncated": len(text) > 0,
        "hint": (
            "这是路径和摘要，不是全文。"
            "要原文带 offset/limit 或 start_line/end_line；搜内容用 file_find_in_content。"
        ),
    }


def _command_log_excerpt(store, operation_id, owner_id) -> str:
    """操作日志末尾。bash 写出的文本不进源码树，file_read 找不到。"""
    op_id = str(operation_id or "").strip()
    if not op_id or store is None:
        return ""
    events = store.list_events(op_id, owner_id=owner_id, after_seq=0, limit=100)
    parts: list[str] = []
    for event in events:
        payload = event.payload if getattr(event, "payload", None) else {}
        if not isinstance(payload, dict):
            continue
        if event.type == "runtime.log":
            parts.append(str(payload.get("text") or ""))
        elif event.type == "runtime.console":
            parts.append(str(payload.get("data") or payload.get("text") or ""))
    text = "".join(parts)
    if len(text) > FILE_READ_EXCERPT_CHARS:
        return text[-FILE_READ_EXCERPT_CHARS:]
    return text


_ANSI_CSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


# 命令里真的起了 Python 进程，日志尾的 Traceback 才可能是它自己的。
# `.py` 只在它是一段命令的第一个词时算（./gen.py），`cat gen.py` 不算。
_RUNS_PYTHON = re.compile(
    r"(?:^|[\s;&|(/])(?:python[0-9.]*|pip[0-9.]*|pytest|uv|poetry)(?=\s|$)"
    r"|(?:^|[;&|(]\s*)[^\s;&|()]*\.py(?=\s|$|[;&|)])")


def _hidden_command_failure(excerpt: str, exit_code, command=None) -> str | None:
    """进程退出码是 0，但日志尾已经说明命令失败。

    ⚠ 2026-09-24 sr-20260924190011：`import pptx > 文件; echo EXIT:$?; cat 文件`
      的进程退出码是 cat 的 0，日志里是 ModuleNotFoundError 和 EXIT:1。
      回执 status=completed，模型当成 python-pptx 已经装上。
    ⚠ 2026-09-24 review：上一版见 Traceback 就判失败。`cat error.log`、
      `grep -rn Traceback .` 是在**看**日志，命令本身成功了，回执却说
      「这次命令没有成功」并置 commandOk=false——模型去修一个不存在的故障，
      或者把刚查明的原因当成新失败。现在：
        - 显式回显的 EXIT:N 最可信，N≠0 失败；EXIT:0 只盖住它前面的 Traceback；
        - 没有回显时，只有命令里真起了 Python 才把 Traceback 算作它的失败；
        - 拿不到命令文本（旧回执）时照旧判，宁可多报，不许把失败报成成功。
    """
    if exit_code not in (0, "0"):
        return None
    text = _ANSI_CSI.sub("", str(excerpt or "")).replace("\r", "\n")
    echoed = None
    echoed_at = -1
    traceback_at = -1
    for index, line in enumerate(text.splitlines()):
        matched = re.fullmatch(r"EXIT:(\d+)", line.strip())
        if matched:
            echoed, echoed_at = int(matched.group(1)), index
        if "Traceback (most recent call last)" in line:
            traceback_at = index
    if echoed not in (None, 0):
        return f"进程退出码是 0，但日志尾有 EXIT:{echoed}。这次命令没有成功。"
    # EXIT:0 只替它前面的那段作证。`pip …; echo EXIT:$?; python3 gen.py | tail`
    # 的 EXIT:0 是 pip 的，后面 gen.py 的 Traceback 不归它管；
    # `python3 gen.py; echo EXIT:$?; cat old.log` 回显之后只是在看旧日志。
    # 两份日志一模一样，只有回显之后那段命令分得开。
    scope = command
    if echoed == 0:
        if echoed_at > traceback_at:
            return None
        if isinstance(command, str) and "EXIT:" in command:
            scope = command.rsplit("EXIT:", 1)[1]
    if isinstance(scope, str) and scope.strip() and not _RUNS_PYTHON.search(scope):
        return None
    if "Traceback (most recent call last)" in text:
        detail = ""
        for line in text.splitlines():
            stripped = line.strip()
            if re.search(r"(Error|Exception):", stripped) and not stripped.startswith("Traceback"):
                detail = stripped[:180]
        if detail:
            return f"进程退出码是 0，但日志尾有异常：{detail}。这次命令没有成功。"
        return "进程退出码是 0，但日志尾有 Traceback。这次命令没有成功。"
    return None


def _download_sentence(result) -> str:
    """把真实下载地址写进模型看得见的那句话。

    ⚠ 2026-09-25 luna 隔离真机：回执只有文件名，模型给用户写的是
      `sandbox:/home/user/workspace/…pptx`——E2B 里的路径，用户点不开。
      地址只写在字段里不够（2026-09-22 BABCJGGB44 同一课：模型读的是这句话）。
    """
    downloads = result.get("officeDownloads")
    if not isinstance(downloads, dict) or not downloads:
        return ""
    links = "；".join(f"[{path}]({url})" for path, url in list(downloads.items())[:8])
    return (
        f"给用户的下载链接：{links}。"
        "交付时用这个链接，不要写沙盒里的路径（sandbox:/home/user/…），用户打不开。"
    )


def _command_pointer(result, excerpt=""):
    """bash / shell_exec：exit + operationId + 日志尾。完整 stdout 留在操作日志。

    ⚠ 2026-09-20 真机：excerpt 写成 errorCode，模型只看见
      project_command_failed，去 file_read run.log 又是 project_file_not_found。
      摘要必须是日志尾，再取带同一个 operationId。
    """
    if not isinstance(result, dict):
        return result
    hint = "完整输出在操作日志，用 project_logs 或 shell_view 带 operationId 再取。"
    # ⚠ 2026-09-22 BABCJGGB44：回执没有文件路径，模型把 pptx base64 进日志。
    #   收回的路径必须写在模型看得见的这句话里，不能只藏在字段名里。
    files = result.get("officeFiles")
    if isinstance(files, list) and files:
        named = ", ".join(str(item) for item in files[:8])
        hint = (
            f"办公文件已收回：{named}。"
            "这就是交付，不要再把文件 base64 进日志或 file_write。"
            "同一个沙盒留给下一条命令，已安装的包还在。"
            + _download_sentence(result)
            + hint
        )
    elif isinstance(result.get("officeFilesHeld"), list) and result["officeFilesHeld"]:
        # 库里的旧文件不是这条命令的产出。说成「已收回」会把一次静默失败的
        # 重新生成报成交付（2026-09-24 review）；说成「没有」又会让模型往树里
        # 写占位（sr-20260924190011）。两件事都照实说。
        named = ", ".join(str(item) for item in result["officeFilesHeld"][:8])
        hint = (
            "这次命令没有产出新的办公文件。"
            f"之前的命令收回、库里还在的：{named}。"
            "如果这条命令本该重新生成它，那次生成没有写出文件，库里仍是旧版。"
            "不要往源码树写占位，也不要把文件 base64 进日志或 file_write。"
            + _download_sentence(result)
            + hint
        )
    elif result.get("officeScan") == "empty":
        hint = "这次扫描没有合格的办公文件。" + hint
    elif result.get("officeScan") == "failed":
        hint = "这次没能扫办公文件。" + hint
    hidden = _hidden_command_failure(excerpt, result.get("exitCode"), result.get("command"))
    if hidden:
        hint = hidden + hint
    out = {
        **result,
        "excerpt": str(excerpt or "")[:FILE_READ_EXCERPT_CHARS],
        "hint": hint,
    }
    if hidden:
        out["commandOk"] = False
    out.pop("stdout", None)
    out.pop("stderr", None)
    out.pop("logPath", None)
    return out


def command_receipt_from(adapter, operation_id):
    """终态回执 = 快照 + 日志尾。分发处等完不许拿裸 snapshot 盖掉 excerpt。

    ⚠ 2026-09-21 sr-20260921170121-13ME64TF8Z：enqueue 时 wait=False，
      excerpt 还是空的；等命令进终态后 `_dispatch_tool` 用 `_snapshot`
      覆盖 body，模型只看见 project_command_failed。PTY 字节在
      runtime.console 里，file_read 源码树找不到。
    """
    snapper = getattr(adapter, "_snapshot", None)
    if not callable(snapper):
        return {"operationId": operation_id}
    snap = snapper(operation_id)
    store = getattr(adapter, "store", None)
    owner = getattr(adapter, "owner_id", None)
    return _command_pointer(
        snap,
        _command_log_excerpt(store, operation_id, owner),
    )


def _wait_backoff(elapsed: float) -> float:
    """等待循环每次重查之间睡多久。

    ⚠ 2026-09-16：原来两个循环都写死 `time.sleep(min(0.1, ...))`。把等待上界
      从 5 秒提到 30 秒之后，那就是**向远程 HTTPS SQL 网关打 300 次查询**去等
      一条 build——把模型往返税换成了数据库风暴，不是省。

      前 2 秒仍然密（刚提交的活经常瞬间就完，密查能立刻返回），之后拉开：
      30 秒总共约 35 次查询，而不是 300 次。

    ⚠ 调用点现在有三处（project_status.waitSeconds、shell_wait.seconds、
      shell_exec/bash 前台）。共用 `_poll_operation` → 共用这一份退避。
      只改一个循环 = 一半还在打风暴，而且不报错（CLAUDE.md §4）。
    """
    if elapsed < 2:
        return 0.1
    if elapsed < 8:
        return 0.5
    return 1.0


class ProjectTools:
    def __init__(self, store, supervisor, owner_id):
        self.store, self.supervisor, self.owner_id = store, supervisor, owner_id

    def capability_readiness(self) -> dict:
        """Return local capability facts for planning, without touching a provider.

        The planner runs before a project exists, so ``project_status`` cannot
        report why a preview or browser check would be blocked.  Keep this
        deliberately side-effect free: it reads configuration and the bundled
        runner only; it never creates an E2B sandbox or exposes credentials.
        """
        rollout = rollout_readiness()
        blockers = list(rollout.get("blockers") or [])
        preview_checker = getattr(self.supervisor, "preview_configuration_enabled", None)
        preview_ready = bool(preview_checker()) if callable(preview_checker) else False
        if not preview_ready and "project_preview_not_configured" not in blockers:
            blockers.append("project_preview_not_configured")
        browser_error = "project_browser_not_configured"
        factory = getattr(self.supervisor, "browser_provider_factory", None) if self.supervisor is not None else None
        if factory is not None:
            try:
                # The provider's availability_error is a pure local check; the
                # factory constructor must not create or connect to a sandbox.
                browser_error = factory().availability_error()
            except (ValueError, TypeError, OSError, ImportError):
                browser_error = "project_browser_unavailable"
        browser_ready = browser_error is None
        if not browser_ready:
            blockers.append(browser_error)
        # Stable, model-safe facts only; never include URLs, keys or provider handles.
        return {"rolloutConfigured": bool(rollout.get("configured")),
                "previewConfigured": preview_ready, "browserConfigured": browser_ready,
                "blockers": list(dict.fromkeys(blockers))}

    def execute(self, name, args, state, *, wait: bool = True) -> dict:
        guard_control_run()
        try:
            if name not in PROJECT_ARGUMENTS:
                raise ValueError("unknown_project_tool")
            if not isinstance(args, dict):
                raise ValueError("project_tool_arguments_invalid")
            parsed = PROJECT_ARGUMENTS[name].model_validate(args)
            session_id = str(getattr(state, "sessionId", "") or "")
            # 核写工具不让模型填 approvalRef：会话里已批准的计划就是闸。
            # 旧的 project_patch 仍要模型回传引用，合同不能改一半。
            if name in PROJECT_KERNEL_WRITE_TOOLS:
                authority = load_authorized_session(session_id, owner_id=self.owner_id)
                if not plan_execution_authorized(authority):
                    raise PermissionError("project_plan_approval_required")
            else:
                authority = load_authorized_session(session_id, owner_id=self.owner_id,
                    approval_ref=parsed.approvalRef if name in PROJECT_WRITE_TOOLS else None)
            if name == "project_create":
                guard_control_run()
                project = create_session_project(self.store, session_id,
                    owner_id=self.owner_id, approval_ref=parsed.approvalRef, template_id=parsed.templateId)
                created = self._project_result(project)
                if created.get("templateVersion") == WORKSPACE_TEMPLATE_VERSION:
                    tree = self.store.read_files(project.projectId, owner_id=self.owner_id)
                    readme = tree.get("README.md") or ""
                    created["readmeBytes"] = len(readme.encode())
                    created["readmeSha"] = content_hash(readme)[:16]
                return {"ok": True, **created}
            project = self.store.get_project_for_session(session_id, owner_id=self.owner_id)
            if (project is None or project.sessionId != authority.sessionId
                    or authority.projectId != project.projectId or authority.runtimeKind != "project"):
                raise ProjectNotFound("session_project_not_found")
            # Runtime tools derive identity from the project index. Session fields
            # are a presentation projection and can lag a successful revision CAS.
            if name == "project_status" and parsed.operationId is None:
                result = self._project_result(project)
                if plan_execution_authorized(authority):
                    result["approvalRef"] = approved_reference(authority)
                operations = self.store.list_project_operations(project.projectId, owner_id=self.owner_id,
                    after_id=parsed.operationCursor, limit=9)
                result["operations"] = [{"operationId": op.operationId, "kind": op.kind,
                    "status": op.status, "revision": op.expectedRevision} for op in operations[:8]]
                result["hasMoreOperations"] = len(operations) > 8
                result["nextOperationCursor"] = operations[7].operationId if len(operations) > 8 else None
                lease = self.store.get_lease(project.projectId, owner_id=self.owner_id)
                result["activeOperationId"] = lease.processRefs.get("operationId") if lease else None
                return {"ok": True, **result}
            if name == "project_patch":
                return {"ok": True, **self._patch(project, parsed)}
            if name in LEAKED_UNAVAILABLE:
                if getattr(parsed, "sudo", False):
                    raise ValueError("project_sudo_forbidden")
                raise ValueError(LEAKED_UNAVAILABLE[name])
            if name in BROWSER_INTERACT_TOOLS:
                result = self._browser_interact(project, name, parsed)
                self._keep_preview_snapshot(project, result, source="browser_interact")
                return {"ok": True, **result}
            if name == "shell_write_to_process":
                return {"ok": True, **self._shell_stdin(project, parsed)}
            if name in {"shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
                        "browser_navigate", "browser_restart"}:
                return {"ok": True, **self._kernel_runtime(
                    project, name, parsed, authority, wait=wait)}
            if name in {"shell_view", "shell_wait", "shell_kill_process", "browser_view",
                        "browser_console_view", "make_manus_page"}:
                result = self._leaked_observe(project, name, parsed)
                if name == "browser_view":
                    self._keep_preview_snapshot(project, result, source="browser_view")
                return {"ok": True, **result}
            if name in PROJECT_KERNEL_WRITE_TOOLS:
                return {"ok": True, **self._kernel_edit(project, name, parsed, authority)}
            if name == "project_revisions":
                return {"ok": True, **ProjectSourceOperations(self.store, self.supervisor, self.owner_id).revisions(
                    project.projectId, parsed.cursor, parsed.limit)}
            if name == "project_restore":
                return {"ok": True, **ProjectSourceOperations(self.store, self.supervisor, self.owner_id).restore(
                    project.projectId, expected_revision=parsed.expectedRevision,
                    target_revision=parsed.targetRevision, idempotency_key=parsed.idempotencyKey,
                    approval_ref=parsed.approvalRef)}
            if name == "project_export":
                revision = self.store.get_revision(project.projectId, parsed.revision, owner_id=self.owner_id)
                return {"ok": True, "revision": revision.revision, "treeHash": revision.treeHash,
                    "downloadPath": f"/api/sliderule/projects/{project.projectId}/export?revision={revision.revision}",
                    "businessDataIncluded": False, "deployed": False}
            if name == "project_verify":
                if is_office_file_plan(latest_control_plan(authority)):
                    raise ValueError(OFFICE_VERIFY_NOT_APPLICABLE)
                guard_control_run()
                if self.supervisor is None:
                    raise ProjectStoreUnavailable("project_worker_unavailable")
                parent = self.store.get_operation(parsed.runtimeOperationId, owner_id=self.owner_id)
                if parent.projectId != project.projectId or parent.sessionId != session_id:
                    raise ProjectNotFound("project_operation_not_found")
                requirements = approved_acceptance_requirements(authority)
                try:
                    operation = self.supervisor.submit_verification(parent.operationId, owner_id=self.owner_id,
                        expected_revision=parsed.expectedRevision, approval_ref=parsed.approvalRef,
                        idempotency_key=parsed.idempotencyKey,
                        acceptance_requirements=requirements)
                except ProjectConflict as exc:
                    # ⚠ 2026-09-23 待办应用：开工那把钥匙又被拿来申请验收，
                    #   回 operation_idempotency_conflict。模型改口「换一个唯一键」
                    #   再交，钥匙还是撞的，独立浏览器一次都没排上。登录 401 是
                    #   应用自己的门。钥匙被占只说明名字冲突，验收请求还在。
                    if str(exc) != "operation_idempotency_conflict":
                        raise
                    operation = self._verify_despite_reused_key(parent, parsed, requirements)
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"project_start", "project_exec"}:
                if name == "project_start" and is_office_file_plan(latest_control_plan(authority)):
                    raise ValueError(OFFICE_START_NOT_APPLICABLE)
                guard_control_run()
                if self.supervisor is None:
                    raise ProjectStoreUnavailable("project_worker_unavailable")
                if name == "project_exec" and project.currentRevision != parsed.expectedRevision:
                    raise ProjectConflict("project_revision_conflict")
                params = dict(owner_id=self.owner_id, expected_revision=parsed.expectedRevision,
                    approval_ref=parsed.approvalRef, idempotency_key=parsed.idempotencyKey)
                if name == "project_start":
                    return {"ok": True, **self._runtime_for_view(project, params, parsed.port)}
                else:
                    operation = self.supervisor.submit_command(project.projectId, **params, command=parsed.command)
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"project_status", "project_logs", "project_cancel", "project_verification"}:
                operation = self.store.get_operation(parsed.operationId, owner_id=self.owner_id)
                if operation.projectId != project.projectId or operation.sessionId != session_id:
                    raise ProjectNotFound("project_operation_not_found")
                if name == "project_verification" and operation.kind != "runtime.verify":
                    raise ProjectNotFound("project_verification_not_found")
                if name == "project_status" and parsed.waitSeconds:
                    operation = self._poll_operation(operation, parsed.waitSeconds)
                if name == "project_logs":
                    return {"ok": True, **self._logs(operation, parsed)}
                if name == "project_cancel":
                    if self.supervisor is None:
                        self.store.request_operation_cancel(operation.operationId, owner_id=self.owner_id)
                    else:
                        self.supervisor.cancel(operation.operationId, owner_id=self.owner_id)
                return {"ok": True, **self._snapshot(operation.operationId)}
            if name in {"file_read", "read_file", "file_find_in_content", "file_find_by_name",
                        "grep", "glob", "list_dir"}:
                revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
                files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
                if name in {"file_read", "read_file"}:
                    return {"ok": True, **self._file_read(files, revision, parsed, project)}
                if name == "file_find_in_content":
                    return {"ok": True, **self._file_find_in_content(files, revision, parsed)}
                if name == "grep":
                    return {"ok": True, **self._github_grep(files, revision, parsed)}
                if name == "list_dir":
                    return {"ok": True, **self._github_list_dir(files, revision, parsed)}
                if name == "glob":
                    return {"ok": True, **self._github_glob(files, revision, parsed, project)}
                return {"ok": True, **self._file_find_by_name(files, revision, parsed, project)}
            revision = self.store.get_revision(project.projectId, parsed.revision, owner_id=self.owner_id)
            if name == "project_list":
                return {"ok": True, **self._list(revision, parsed, project)}
            files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
            if name == "project_read":
                return {"ok": True, **self._read(files, revision, parsed)}
            return {"ok": True, **self._search(files, revision, parsed)}
        except ValidationError:
            return {"ok": False, "error": "project_tool_arguments_invalid"}
        except PersistClosedError as exc:
            return {"ok": False, "error": str(exc.reason)[:240]}
        except (ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, PermissionError, ValueError) as exc:
            return {"ok": False, "error": str(exc)[:240]}

    def _project_result(self, project):
        revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        return {"projectId": project.projectId, "revision": revision.revision,
            "templateVersion": revision.templateVersion, "fileCount": len(revision.manifest.files),
            "sourceBytes": revision.manifest.totalBytes, "runtimeKind": "project"}

    def _keep_preview_snapshot(self, project, result, *, source: str) -> None:
        """Persist a browser PNG for the result card. Fail-open. Not verification."""
        data = result.pop("screenshotPng", None)
        raw = result.pop("screenshot", None)
        if data is None and isinstance(raw, str) and raw.strip():
            try:
                data = base64.b64decode(raw)
            except Exception:
                data = None
        elif data is None and isinstance(raw, (bytes, bytearray)):
            data = bytes(raw)
        if not isinstance(data, (bytes, bytearray)) or not data:
            return
        try:
            self.store.put_preview_snapshot(
                project.projectId,
                owner_id=self.owner_id,
                png=bytes(data),
                revision=str(result.get("revision") or getattr(project, "currentRevision", "") or ""),
                source=source,
            )
            result["previewSnapshot"] = True
        except Exception:
            # 缩略图是增强项：落库失败不许拖垮 browser_view。
            pass

    def _verify_despite_reused_key(self, parent, parsed, requirements):
        """同一把钥匙已经绑了别的请求时，仍然把这次验收排上。

        相同钥匙、相同请求走 submit 的幂等返回，进不了这里。未结束的同版本
        检查直接交回，避免再开一台浏览器。否则换一把主机钥匙排一次。
        """
        inflight = [
            child for child in self.store.list_runtime_verifications(
                parent.operationId, owner_id=self.owner_id)
            if child.expectedRevision == parsed.expectedRevision and child.status not in _TERMINAL
        ]
        if inflight:
            return inflight[-1]
        return self.supervisor.submit_verification(
            parent.operationId, owner_id=self.owner_id,
            expected_revision=parsed.expectedRevision, approval_ref=parsed.approvalRef,
            idempotency_key="verify-" + uuid.uuid4().hex,
            acceptance_requirements=requirements)

    def _snapshot(self, operation_id):
        source = self.store.snapshot_operation(operation_id, owner_id=self.owner_id)
        result = operation_snapshot(source)
        if source["operation"].kind == "runtime.verify" and self.supervisor is not None:
            authority = load_authorized_session(source["operation"].sessionId,
                owner_id=self.owner_id, approval_ref=None)
            snapshot = verification_with_current_authority(self.supervisor.verification_store.for_operation(
                operation_id, owner_id=self.owner_id), authority)
            if snapshot is not None:
                record = snapshot.verification
                result["verification"] = {"verificationId": record.verificationId,
                    "status": snapshot.effectiveStatus, "revision": record.revision,
                    "suiteVersion": record.suiteVersion, "deliveryEligible": snapshot.deliveryEligible,
                    "acceptanceProfile": record.specRevision if snapshot.deliveryEligible else None,
                    "acceptanceRequirements": list(record.acceptanceRequirements),
                    "errorCode": record.errorCode,
                    "runtimeOperationId": record.runtimeOperationId,
                    "logOperationId": record.runtimeOperationId,
                    "build": ({key: getattr(record.build, key) for key in (
                        "status", "installExitCode", "buildExitCode", "outputHash", "revision")}
                        if record.build else None),
                    "assertions": [{"id": item.id, "status": item.status,
                        **({"expected": item.expected, "actual": item.actual}
                            if item.status == "failed" and item.expected is not None and item.actual is not None else {})}
                        for item in record.assertions],
                    "artifactIds": [item.artifactId for item in record.artifactRefs]}
        return result

    def _poll_operation(self, operation, seconds):
        """等到操作释放，或秒数用尽。秒数 <= 0 立刻把当前快照交回去。

        ⚠ 2026-09-18：shell_exec 前台抄 grok bash `backend.run()`——这次工具
          调用要堵住，直到命令进终态。project_status / shell_wait 原来各写
          一份 while；再给 shell_exec 抄第三份就会漂（CLAUDE.md §4）。
          提前返回（终态 / runtime.ready）必须留在这一处。
        """
        if seconds is None or seconds <= 0 or operation is None:
            return operation
        deadline = time.monotonic() + float(seconds)
        started = time.monotonic()
        while operation.status not in _TERMINAL and time.monotonic() < deadline:
            if operation.runtime is not None and getattr(operation.runtime, "status", None) == "ready":
                break
            time.sleep(min(_wait_backoff(time.monotonic() - started),
                           max(0, deadline - time.monotonic())))
            operation = self.store.get_operation(operation.operationId, owner_id=self.owner_id)
        return operation

    def _latest_operation(self, project, kinds=None):
        """按创建时间最近的一条。

        ⚠ 2026-09-25：原来取 `list_project_operations(limit=100)[-1]`——那是按
          operationId 排序，而 id 是随机 uuid，「最后一个」是随机一个，而且
          超过 100 条就只在前 100 条里挑。shell_kill_process 不带 id 时停的、
          browser_restart 停的、browser_view 回报的，都可能是随便哪条。
        """
        operations, after = [], ""
        while True:
            page = self.store.list_project_operations(project.projectId, owner_id=self.owner_id,
                after_id=after, limit=100)
            operations += [item for item in page if not kinds or item.kind in kinds]
            if len(page) < 100:
                break
            after = page[-1].operationId
        return max(operations, key=lambda item: item.createdAt) if operations else None

    def _active_runtime(self, project):
        """这个工程当前那台开发服务器（在跑或已在排队）；没有返回 None。

        ⚠ 2026-09-25 隔离真机 sr-20260925043119-K1N7JX1FPS（记账网页）：
          browser_navigate / deploy_expose_port / project_start 每次都新提交
          一个 runtime.start，排在正在跑的那台后面。模型照回执停掉挡路的，
          排队的旧启动顶上来，它再发一个——一轮里起了 6 次、停了 4 次，
          收工时还有 3 个启动烂在队列里。一个工程同一时刻只该有一台。
        ⚠ 不用 _latest_operation 挑：operationId 是随机 uuid，按 id 排的
          「最后一个」是随机一个。先认租约持有者（工人就按它放行），
          再认最早的 running，再认最早排队的。
        """
        lease = self.store.get_lease(project.projectId, owner_id=self.owner_id)
        holder = lease.processRefs.get("operationId") if lease else None
        active, after = [], ""
        while True:
            page = self.store.list_project_operations(project.projectId, owner_id=self.owner_id,
                after_id=after, limit=100)
            active += [op for op in page if op.kind == "runtime.start"
                       and op.status not in _TERMINAL and not op.cancelRequested]
            if len(page) < 100:
                break
            after = page[-1].operationId
        for op in active:
            if op.operationId == holder:
                return op
        running = [op for op in active if op.status == "running"]
        return min(running or active, key=lambda op: op.createdAt) if active else None

    def _runtime_for_view(self, project, params, port):
        """看页面 / 开端口 / 启动：有现成的开发服务器就用它，没有才起一台。

        同一把幂等键交过的，照旧走幂等：重放拿回原样回执，换参数报冲突。
        """
        key = params["idempotency_key"]
        if self.store.operation_by_key(project.projectId, key, owner_id=self.owner_id) is None:
            active = self._active_runtime(project)
            if active is not None:
                return self._snapshot(active.operationId) | {"runtimeReused": True}
        operation = self.supervisor.submit(project.projectId, **params, port=port)
        return self._snapshot(operation.operationId)

    def _operation_by_id(self, project, session_id, operation_id, kinds=None):
        if operation_id:
            operation = self.store.get_operation(operation_id, owner_id=self.owner_id)
        else:
            operation = self._latest_operation(project, kinds=kinds)
            if operation is None:
                raise ProjectNotFound("project_operation_not_found")
        if operation.projectId != project.projectId or operation.sessionId != session_id:
            raise ProjectNotFound("project_operation_not_found")
        return operation

    def _kernel_runtime(self, project, name, parsed, authority, *, wait=True):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        if self.supervisor is None:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        params = dict(
            owner_id=self.owner_id,
            expected_revision=current.revision,
            approval_ref=approved_reference(authority),
            idempotency_key=getattr(parsed, "id", None) or str(uuid.uuid4()),
        )
        if name in {"shell_exec", "bash"}:
            if name == "shell_exec" and not leaked_shell_exec_dir_allowed(getattr(parsed, "exec_dir", None)):
                raise ValueError("project_shell_exec_dir_not_supported")
            if name == "bash":
                params["idempotency_key"] = str(uuid.uuid4())
            managed, script = classify_shell_command(parsed.command)
            if script is None:
                operation = self.supervisor.submit_command(
                    project.projectId, **params, command=managed)
            else:
                operation = self.supervisor.submit_command(
                    project.projectId, **params, command="shell", script=script)
            operation = self.store.get_operation(operation.operationId, owner_id=self.owner_id)
            # wait=False：分发处先把 operationId 推给界面订 PTY，再自己堵。
            # 这里再等，id 要等命令结束才出去，终端进行中是白纸。
            if wait and not getattr(parsed, "is_background", False):
                block = getattr(parsed, "timeout", None)
                if block is None:
                    block = SHELL_EXEC_FOREGROUND_BLOCK_SECONDS
                operation = self._poll_operation(operation, block)
            return command_receipt_from(self, operation.operationId)
        if name in {"deploy_expose_port", "deploy_apply_deployment"}:
            port = getattr(parsed, "port", None) or 5173
            result = self._runtime_for_view(project, params, port)
            if name == "deploy_apply_deployment":
                result["deployed"] = False
                result["public"] = False
                result["previewPrivate"] = True
            return result
        if name == "browser_navigate":
            if not leaked_browser_url_allowed(parsed.url):
                raise ValueError("project_browser_external_url_forbidden")
            return {**self._runtime_for_view(project, params, 5173), "url": parsed.url, "previewPrivate": True}
        # browser_restart：停掉当前那台，再起一台。明确要求重启才走这里。
        active = self._active_runtime(project)
        if active is not None:
            self.supervisor.cancel(active.operationId, owner_id=self.owner_id)
        operation = self.supervisor.submit(project.projectId, **params, port=5173)
        return self._snapshot(operation.operationId)

    def _leaked_observe(self, project, name, parsed):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        session_id = project.sessionId
        if name == "make_manus_page":
            # ⚠ 2026-09-22 办公文件不在源码树。只查源码时，点名 pptx 得到
            #   project_file_not_found，右边却把失败的网页运行当成预览。
            result = self._project_result(project)
            if parsed.file:
                revision = self.store.get_revision(project.projectId, owner_id=self.owner_id)
                files = self.store.read_files(project.projectId, revision.revision, owner_id=self.owner_id)
                path = workspace_file_path(parsed.file, files)
                if path in files:
                    result["path"] = path
                    result["presented"] = "project"
                else:
                    meta = ProjectOfficeArtifactStore(self.store).find_by_path(
                        project.projectId, path, owner_id=self.owner_id)
                    if meta is None:
                        raise ProjectNotFound("project_file_not_found")
                    result["path"] = meta["path"]
                    result["artifactId"] = meta["artifactId"]
                    result["presented"] = "office"
            else:
                # ⚠ 2026-09-24 sr-20260924190011：不带 file 的交付页被记成
                #   presented=project。产物库里已有 pptx，右侧却去看工程页。
                # ⚠ 2026-09-24 review：上一版不看这是不是办公工程。网页工程里
                #   跑个导出脚本、树里多出一份 .xlsx，交付页就打开那张表——
                #   网页不见了。只有办公工作区（whybuddy-workspace-1）才回退到
                #   产物库；网页工程要看表格就点名 file。判据用修订上记着的
                #   模板版本，跟收集器 _office_scan_is_a_command_fact 同一个事实，
                #   不看计划：恢复的会话可能读不到计划，工程是什么却一直在库里。
                held = []
                if result.get("templateVersion") == WORKSPACE_TEMPLATE_VERSION:
                    try:
                        held = ProjectOfficeArtifactStore(self.store).list(
                            project.projectId, owner_id=self.owner_id)
                    except Exception:
                        held = []
                latest = held[-1] if held else None
                if isinstance(latest, dict) and latest.get("path") and latest.get("artifactId"):
                    result["path"] = latest["path"]
                    result["artifactId"] = latest["artifactId"]
                    result["presented"] = "office"
                else:
                    result["presented"] = "project"
            if parsed.title:
                result["title"] = parsed.title
            return result
        if name == "browser_view":
            result = self._project_result(project)
            # 看的是那台开发服务器，不是随便哪条操作（见 _active_runtime）。
            latest = self._active_runtime(project) or self._latest_operation(project)
            if latest is not None:
                result.update(self._snapshot(latest.operationId))
            page = self._preview_page(project)
            result["interactive"] = page is not None
            if page is not None:
                result["url"] = page["url"]
                interactor = getattr(self.supervisor, "browser_interactor", None)
                if callable(interactor):
                    observed = interactor({"op": "snapshot"}, page)
                    if isinstance(observed, dict):
                        result.update(observed)
                elif local_playwright_available():
                    result.update(run_browser_action(page["url"], {"op": "snapshot"}))
            return result
        operation = self._operation_by_id(project, session_id, parsed.id)
        if name == "shell_kill_process":
            if self.supervisor is None:
                self.store.request_operation_cancel(operation.operationId, owner_id=self.owner_id)
            else:
                self.supervisor.cancel(operation.operationId, owner_id=self.owner_id)
            return self._snapshot(operation.operationId)
        if name == "shell_wait":
            wait = parsed.seconds if parsed.seconds is not None else 2
            operation = self._poll_operation(operation, wait)
            return self._snapshot(operation.operationId)
        logs = self._logs(operation, SimpleNamespace(afterSeq=0, offset=0))
        if name == "browser_console_view":
            logs["console"] = "runtime"
        return logs

    def _preview_page(self, project):
        resolver = getattr(self.supervisor, "preview_page", None)
        if callable(resolver):
            page = resolver(project)
            if isinstance(page, dict) and isinstance(page.get("url"), str) and page["url"].strip():
                if not leaked_browser_url_allowed(page["url"]):
                    raise ValueError("project_browser_external_url_forbidden")
                return page
            return None
        latest = self._latest_operation(project, kinds=("runtime.start",))
        runtime = latest.runtime if latest is not None else None
        if latest is None or latest.status not in {"running", "completed"} or runtime is None:
            return None
        if getattr(runtime, "status", None) != "ready":
            return None
        url = getattr(runtime, "previewUrl", None)
        if not isinstance(url, str) or not leaked_browser_url_allowed(url):
            return None
        return {"url": url, "revision": getattr(runtime, "revision", None)}

    def _browser_interact(self, project, name, parsed):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        action = compile_browser_action(name, parsed)
        page = self._preview_page(project)
        if page is None:
            raise ValueError("project_browser_preview_not_ready")
        interactor = getattr(self.supervisor, "browser_interactor", None)
        if callable(interactor):
            observed = interactor(action, page)
            if not isinstance(observed, dict):
                raise ValueError("project_browser_action_failed")
            return {"interactive": True, **observed}
        if local_playwright_available():
            return run_browser_action(page["url"], action)
        raise ValueError("project_browser_driver_unavailable")

    def _shell_stdin(self, project, parsed):
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        if self.supervisor is None:
            raise ProjectStoreUnavailable("project_worker_unavailable")
        operation = self._operation_by_id(project, project.sessionId, parsed.id)
        self.supervisor.enqueue_stdin(
            operation.operationId, owner_id=self.owner_id, text=parsed.input,
            press_enter=parsed.press_enter)
        return {"operationId": operation.operationId, "stdinQueued": True}

    def _kernel_edit(self, project, name, parsed, authority):
        """把 path+content / 唯一串替换展开成现行 patch，再走同一条落库。

        版本和哈希从当前 revision 读，不信模型。删掉这一支、只加 schema，
        模型会看见工具，写进去的字节却不会落库。
        """
        if getattr(parsed, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
        files = self.store.read_files(project.projectId, current.revision, owner_id=self.owner_id)
        if name in {"file_write", "project_write", "write_file"}:
            path = workspace_file_path(getattr(parsed, "file", None) or parsed.path, files)
            if is_office_artifact_path(path):
                data = decode_office_write(
                    parsed.content,
                    encoding=getattr(parsed, "contentEncoding", None),
                )
                meta = ProjectOfficeArtifactStore(self.store).put(
                    project.projectId, owner_id=self.owner_id, path=path, data=data)
                return {
                    "projectId": project.projectId,
                    "revision": current.revision,
                    "path": meta["path"],
                    "sha256": meta["sha256"],
                    "sizeBytes": meta["sizeBytes"],
                    "downloadable": True,
                    "artifactId": meta["artifactId"],
                    "changedFiles": [meta["path"]],
                }
            content = parsed.content
            if getattr(parsed, "leading_newline", False):
                content = "\n" + content
            if getattr(parsed, "trailing_newline", False) and not content.endswith("\n"):
                content += "\n"
            changes = kernel_write_changes(files, path, content, append=getattr(parsed, "append", False))
        else:
            path = workspace_file_path(getattr(parsed, "file", None) or parsed.path, files)
            old = getattr(parsed, "old_str", None) or getattr(parsed, "old_string", None) or parsed.oldStr
            if hasattr(parsed, "new_str"):
                new = parsed.new_str
            elif hasattr(parsed, "new_string"):
                new = parsed.new_string
            else:
                new = parsed.newStr
            changes = kernel_str_replace_changes(files, path, old, new)
        return self._patch(project, PatchArguments.model_validate({
            "approvalRef": approved_reference(authority),
            "expectedRevision": current.revision,
            "changes": changes,
        }))

    def _patch(self, project, args):
        active = self.store.get_lease(project.projectId, owner_id=self.owner_id)
        if active is not None and active.expiresAt > time.time() and active.processRefs.get("operationId"):
            if self.supervisor is None:
                raise ProjectStoreUnavailable("project_worker_unavailable")
            # Queue to the existing execution owner. Never borrow its lease or
            # write into its sandbox from a control/HTTP request thread.
            changes = [change.model_dump() for change in args.changes]
            before = self.store.read_files(project.projectId, args.expectedRevision, owner_id=self.owner_id)
            prepare_source_patch(before, changes, live=True)
            parent_id = active.processRefs["operationId"]
            key = "live-patch-" + content_hash(canonical_json({"runtimeOperationId": parent_id, **args.model_dump()}))
            operation = self.supervisor.submit_patch(parent_id, owner_id=self.owner_id,
                expected_revision=args.expectedRevision, approval_ref=args.approvalRef,
                idempotency_key=key, changes=changes)
            return {"projectId": project.projectId, "runtimeOperationId": parent_id,
                **self._snapshot(operation.operationId)}
        lease = self.store.acquire_lease(project.projectId, owner_id=self.owner_id,
            lease_owner="patch-" + uuid.uuid4().hex, ttl_seconds=120)
        try:
            prior = operation_left_on_lease(self.store, lease, self.owner_id)
            if (lease.sandboxId or lease.processRefs) and not idle_office_exec_allows_source_write(lease, prior):
                raise ProjectConflict("project_runtime_reconciliation_required")
            load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            current = self.store.get_revision(project.projectId, owner_id=self.owner_id)
            if current.revision != args.expectedRevision:
                raise ProjectConflict("project_revision_conflict")
            files = self.store.read_files(project.projectId, current.revision, owner_id=self.owner_id)
            updated, changed_paths = prepare_source_patch(files, [change.model_dump() for change in args.changes])
            if updated == files and current.planRef == args.approvalRef:
                sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
                return {"projectId": project.projectId, "revision": current.revision, "changedFiles": []}
            # Check again after bounded source reads; no cached approval can be
            # carried through an arbitrarily slow storage call into publication.
            load_authorized_session(project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            guard_control_run()
            revision = self.store.commit_revision(project.projectId, owner_id=self.owner_id,
                expected_revision=current.revision, files=updated, template_version=current.templateVersion,
                plan_ref=args.approvalRef, spec_revision=current.specRevision,
                lease_generation=lease.generation, lease_owner=lease.leaseOwner)
            sync_session_project(self.store, project.sessionId, owner_id=self.owner_id, approval_ref=args.approvalRef)
            result = {"projectId": project.projectId, "revision": revision.revision,
                "changedFileCount": len(changed_paths),
                "changedFiles": [], "truncated": False, "verification": "not_run"}
            for path in changed_paths:
                if _size({**result, "changedFiles": result["changedFiles"] + [path]}) > MAX_RESULT_CHARS:
                    result["truncated"] = True
                    break
                result["changedFiles"].append(path)
            return result
        finally:
            self.store.release_lease(project.projectId, owner_id=self.owner_id,
                lease_owner=lease.leaseOwner, generation=lease.generation)

    def _list(self, revision, args, project=None):
        entries = revision.manifest.files
        if args.cursor > len(entries):
            raise ValueError("invalid_project_cursor")
        result = {"revision": revision.revision, "files": [], "nextCursor": args.cursor, "truncated": True}
        for entry in entries[args.cursor:args.cursor + args.limit]:
            item = entry.model_dump()
            if _size({**result, "files": result["files"] + [item]}) > MAX_RESULT_CHARS:
                break
            result["files"].append(item)
            result["nextCursor"] += 1
        result["truncated"] = result["nextCursor"] < len(entries)
        if project is not None:
            try:
                office = [
                    item["path"]
                    for item in ProjectOfficeArtifactStore(self.store).list(
                        project.projectId, owner_id=self.owner_id)
                    if isinstance(item.get("path"), str)
                ]
            except Exception:
                office = []
            if office:
                # 源码清单里没有 pptx。模型把「files 里没有」读成没交付，
                # 再往树里写占位（2026-09-24 sr-20260924190011）。
                result["officeFiles"] = office[:8]
        return result

    def _file_read(self, files, revision, args, project=None):
        if getattr(args, "sudo", False):
            raise ValueError("project_sudo_forbidden")
        path = workspace_file_path(getattr(args, "file", None) or args.path, files)
        if project is not None and is_office_artifact_path(path):
            meta = ProjectOfficeArtifactStore(self.store).find_by_path(
                project.projectId, path, owner_id=self.owner_id)
            if meta is None:
                raise ProjectNotFound("project_file_not_found")
            return {
                "revision": revision.revision, "path": meta["path"],
                "sha256": meta["sha256"], "sizeBytes": meta["sizeBytes"],
                "downloadable": True, "artifactId": meta["artifactId"],
                "content": "", "truncated": False,
            }
        skill_read = False
        if path not in files:
            # ⚠ 2026-09-22 BABCJGGB44：file_read .sliderule/skills/.../SKILL.md
            #   得到 project_file_not_found，模型接着 bash `find /`。
            skill_body = _skill_body_for_catalog_path(path, self.owner_id)
            if skill_body is None:
                raise ProjectNotFound("project_file_not_found")
            files = {**files, path: skill_body}
            skill_read = True
        if not explicit_read_window(args):
            pointer = _pointer_file(path, files[path], revision)
            if skill_read:
                pointer["hint"] = (
                    "这是技能正文的摘要，不是工程文件。"
                    "全文已经在 skill 回执里。不要在沙盒里 find .sliderule/skills。"
                )
            return pointer
        lines = files[path].splitlines(keepends=True)
        if getattr(args, "start_line", None) is not None:
            start = args.start_line
        else:
            start = getattr(args, "offset", None) or 0
        if getattr(args, "end_line", None) is not None:
            end = args.end_line
        elif getattr(args, "limit", None) is not None:
            end = start + args.limit
        else:
            end = len(lines)
        if start > len(lines) or end < start:
            raise ValueError("invalid_project_offset")
        text = "".join(lines[start:end])
        result = {"revision": revision.revision, "path": path, "sha256": content_hash(files[path]),
            "start_line": start, "end_line": start + text.count("\n") + (0 if text.endswith("\n") or not text else 1),
            "truncated": False, "totalChars": len(files[path])}
        result["content"] = _bounded_text({"ok": True, **result}, "content", text,
            cap=PROJECT_READ_MAX_RESULT_CHARS)
        result["truncated"] = result["content"] != text
        return result

    def _file_find_in_content(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        path = workspace_file_path(args.file, files)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        matches = file_content_matches(files[path], args.regex)
        return {"revision": revision.revision, "path": path, "matches": matches,
            "truncated": len(matches) >= 40}

    def _github_grep(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        target = args.path or "."
        resolved = workspace_file_path(target, files) if target not in {".", ""} else ""
        if resolved in files:
            matches = [{"path": resolved, **row} for row in file_content_matches(files[resolved], args.pattern)]
        else:
            matches = file_tree_matches(files, args.pattern, directory=target, glob=args.glob or "*")
        return {"revision": revision.revision, "matches": matches, "truncated": len(matches) >= 40}

    def _github_list_dir(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        found = file_name_matches(sorted(files), args.path, "*")
        return {"revision": revision.revision, "files": found, "truncated": False}

    def _github_glob(self, files, revision, args, project=None):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        names = self._names_with_artifacts(files, project)
        found = file_name_matches(names, args.path or ".", args.pattern)
        return {"revision": revision.revision, "files": found, "truncated": False}

    def _file_find_by_name(self, files, revision, args, project=None):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        names = self._names_with_artifacts(files, project)
        found = file_name_matches(names, args.path, args.glob)
        return {"revision": revision.revision, "files": found, "truncated": False}

    def _names_with_artifacts(self, files, project):
        names = list(files)
        if project is None:
            return sorted(names)
        try:
            extras = ProjectOfficeArtifactStore(self.store).list(
                project.projectId, owner_id=self.owner_id)
        except Exception:
            extras = []
        for item in extras:
            path = item.get("path")
            if isinstance(path, str) and path not in names:
                names.append(path)
        return sorted(names)

    def _read(self, files, revision, args):
        path = source_path(args.path)
        if path not in files:
            raise ProjectNotFound("project_file_not_found")
        text = files[path]
        if not explicit_read_window(args):
            return _pointer_file(path, text, revision)
        if args.offset > len(text):
            raise ValueError("invalid_project_offset")
        result = {"revision": revision.revision, "path": path, "sha256": content_hash(text),
            "offset": args.offset, "nextOffset": args.offset + args.limit, "truncated": True, "totalChars": len(text)}
        # ⚠ `ok` 是**调用方**加的（`return {"ok": True, **self._read(...)}`），
        #   但模型看到的是加完之后那一包。不把它算进来，夹出来的结果就必然
        #   比上限多 12 个字符——2026-09-14 放宽读窗时被
        #   test_literal_search_and_read_cursors_keep_exact_content_under_result_cap
        #   逮到：老判据留了 200 字的富余，正好盖住这笔账。
        result["content"] = _bounded_text({"ok": True, **result}, "content",
            text[args.offset:args.offset + args.limit], cap=PROJECT_READ_MAX_RESULT_CHARS)
        result["nextOffset"] = args.offset + len(result["content"])
        result["truncated"] = result["nextOffset"] < len(text)
        return result

    def _search(self, files, revision, args):
        query = args.query if args.caseSensitive else args.query.casefold()
        result = {"revision": revision.revision, "matches": [], "nextCursor": args.cursor, "truncated": False}
        index = 0
        for path, content in sorted(files.items()):
            sha = content_hash(content)
            for line, text in enumerate(content.splitlines(), 1):
                haystack = text if args.caseSensitive else text.casefold()
                if query not in haystack:
                    continue
                index += 1
                if index <= args.cursor:
                    continue
                item = {"path": path, "line": line, "sha256": sha, "text": text[:240], "excerptTruncated": len(text) > 240}
                if len(result["matches"]) >= args.limit or _size({**result, "matches": result["matches"] + [item]}) > MAX_RESULT_CHARS:
                    result["truncated"] = True
                    return result
                result["matches"].append(item)
                result["nextCursor"] = index
        if args.cursor > index:
            raise ValueError("invalid_project_cursor")
        return result

    def _logs(self, operation, args):
        events = self.store.list_events(operation.operationId, owner_id=self.owner_id,
            after_seq=args.afterSeq, limit=100)
        if args.offset and not events:
            raise ValueError("invalid_project_log_offset")
        result = {"operationId": operation.operationId, "logs": [], "nextSeq": args.afterSeq,
            "nextOffset": args.offset, "hasMore": False}
        for event in events:
            # PTY 走 runtime.console（data），文件日志走 runtime.log（text）。
            # ⚠ 2026-09-21 13ME64TF8Z：只认 runtime.log → bash 终态后
            #   project_logs 空，模型去 file_read 沙箱里 tee 的文件。
            if event.type in {"runtime.log", "runtime.console"}:
                payload = event.payload if isinstance(event.payload, dict) else {}
                text = str(payload.get("text") or payload.get("data") or "")
                offset = result["nextOffset"]
                if offset > len(text):
                    raise ValueError("invalid_project_log_offset")
                item = {"seq": event.seq, "offset": offset,
                    "providerTruncated": bool(payload.get("truncated"))}
                segment = _bounded_log_text(result, item, text[offset:])
                if text[offset:] and not segment:
                    result["hasMore"] = True
                    return result
                result["logs"].append({**item, "text": segment})
                if offset + len(segment) < len(text):
                    result["nextOffset"] = offset + len(segment)
                    result["hasMore"] = True
                    return result
            elif result["nextOffset"]:
                raise ValueError("invalid_project_log_offset")
            result["nextSeq"] = event.seq
            result["nextOffset"] = 0
        result["hasMore"] = len(events) == 100
        return result
