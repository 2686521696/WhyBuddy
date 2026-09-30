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
import shlex
import time
import uuid
from contextvars import ContextVar
from difflib import SequenceMatcher, unified_diff
from urllib.parse import urlsplit
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
from services.project_store import MAX_REVISIONS, ProjectConflict, ProjectNotFound, ProjectStoreUnavailable
from services.project_source_operations import ProjectSourceOperations
from services.project_browser_interact import local_playwright_available, run_browser_action
from services.project_tool_contracts import (
    BROWSER_INTERACT_TOOLS, FILE_READ_EXCERPT_CHARS, FILE_READ_EXCERPT_LINES,
    LEAKED_UNAVAILABLE, PROJECT_ARGUMENTS, PROJECT_KERNEL_WRITE_TOOLS,
    PROJECT_READ_MAX_RESULT_CHARS, PROJECT_WRITE_TOOLS, PatchArguments,
    classify_shell_command, compile_browser_action, explicit_read_window,
    leaked_browser_url_allowed,
    sandbox_shell_script, shell_exec_subdir,
    SHELL_EXEC_FOREGROUND_BLOCK_SECONDS,
)
from services.deliverable_kind import (
    OFFICE_START_NOT_APPLICABLE, OFFICE_VERIFY_NOT_APPLICABLE,
    WORKSPACE_TEMPLATE_VERSION,
    idle_office_exec_allows_source_write,
    operation_left_on_lease,
    is_office_artifact_path, is_office_file_plan,
    office_facts_sentence,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore, decode_office_write
from services.control_skills import catalog_skill_file, catalog_skill_slug, normalize_skill_name
from services import skill_catalog_store as _skill_catalog
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


def _indentation_error_note(changes) -> dict | None:
    """改完的 .py 缩进坏了：当场说，不用跑一趟沙盒才知道。

    ⚠ 2026-09-28 隔离真机第 86 轮 sr-20260928043335-9AKXXGY0WB（电商月度经营 Excel，追问「加一个 KPI 仪表盘工作表」）：
      模型用 file_str_replace 往生成脚本里插一段，接着跑 → IndentationError（第 260 行），再改、
      再跑……9 次失败里 8 次是 IndentationError，同一行报了两三遍，8 分钟。每一发都要走一趟
      沙盒控制台；而改完的全文宿主手里就有。
    只报 IndentationError / TabError：宿主是 3.11、沙盒是 3.13，其它 SyntaxError 可能是新语法
    （3.12 起 f-string 放宽），宿主判错就是假警报。缩进规则各版本一致。只 compile 不执行。
    增强类：判不了就不说（§七）。
    """
    for change in changes or []:
        path = str((change or {}).get("path") or "")
        text = (change or {}).get("content")
        if not path.endswith(".py") or not isinstance(text, str):
            continue
        try:
            compile(text, path, "exec", dont_inherit=True)
        except IndentationError as exc:
            kind = type(exc).__name__
            return {
                "syntaxError": {"path": path, "line": exc.lineno, "message": f"{kind}: {exc.msg}"},
                "hint": (f"改完之后 {path} 第 {exc.lineno} 行缩进不对（{kind}: {exc.msg}），"
                         "这个文件现在跑不起来。先修这一处再运行。"),
            }
        except Exception:
            continue
    return None


def _skill_package_files(slug: str, owner_id: str | None) -> dict[str, str] | None:
    """这个账号装了的那份技能包开箱后的文本文件（相对技能根）。没装 / 取不到 → None。

    ⚠ 2026-09-28 隔离真机第 82 轮 sr-20260928024607-KCH4NABCBH（记账网页装了 webapp-testing，追问「把添加、修改、删除
      点一遍」）：模型 file_read `.sliderule/skills/webapp-testing/examples/element_discovery.py`、
      `console_logging.py` → project_file_not_found，没有提示。上面只给 SKILL.md 开了口子；其余
      文件在沙盒里（开箱写进去的），不在源码树。跟开箱走同一个展开（catalog.unpack_package——
      skill_hydrate.files_for_package 就是它加路径前缀），两边不会说两套。增强类，取不到就按没有处理（§七）。
    """
    if not slug or not owner_id:
        return None
    try:
        catalog = _skill_catalog.get_skill_catalog_store()
        for pkg in catalog.list_installed(owner_id):
            if normalize_skill_name(str(pkg.get("slug") or "")) == slug:
                return dict(catalog.unpack_package(pkg))
    except Exception:
        return None
    return None



def _skill_files_near(package: dict[str, str], wanted: str, *, cap: int = 30) -> str:
    """技能里没有 wanted 时给它看的清单：离它最近的在前，大堆的同目录文件收成一行。

    ⚠ 2026-09-29 隔离真机第 116 轮 sr-20260929103821-XA38NTEQSB（社区读书会志愿者招募方案 Word）：两轮追问都
      file_read `standards/structure/docx-structure.md`。office-skills 有 100 个文件，按字母序截前
      30 个，被 scripts/office/schemas/ 底下的 .xsd 占满——standards/ 排在第 72 个，它要的
      standards/structure/docx-*.md 一个都没出现，于是下一轮照猜。
    """
    wanted_parts = wanted.split("/")[:-1]

    def shared(path: str) -> int:
        depth = 0
        for mine, theirs in zip(path.split("/")[:-1], wanted_parts):
            if mine != theirs:
                break
            depth += 1
        return depth

    ordered = sorted(package, key=lambda path: (-shared(path), path))
    folder_of = lambda path: path.rsplit("/", 1)[0] if "/" in path else ""
    wanted_dir = "/".join(wanted_parts)
    sizes: dict[str, int] = {}
    for path in package:
        sizes[folder_of(path)] = sizes.get(folder_of(path), 0) + 1
    listed: list[str] = []
    folded: set[str] = set()
    for path in ordered:
        folder = folder_of(path)
        # 它要找的那个目录一个不收；别处一个目录超过 6 个，只留一行
        if folder and folder != wanted_dir and sizes[folder] > 6:
            if folder not in folded:
                folded.add(folder)
                listed.append(f"{folder}/（{sizes[folder]} 个文件）")
            continue
        listed.append(path)
    shown = ", ".join(listed[:cap])
    return shown + (f" ……另 {len(listed) - cap} 项" if len(listed) > cap else "")


# 这一轮（一次 control run）开始时的源码版本。rehearsal_control 在点火时设；只读不写。
TURN_START_REVISION: ContextVar[str | None] = ContextVar("project_turn_start_revision", default=None)


def _net_change_sentence(before: dict, after: dict, *, limit: int = 6) -> str:
    changed = sorted(path for path in set(before) | set(after) if before.get(path) != after.get(path))
    if not changed:
        return ("和这一轮开始时比，源码净改动为零（逐字节相同）：这轮的改动互相抵消了。"
                "对用户别说新增或修好了什么；要的东西原来就有，就照实说原来就有。")
    parts = []
    for path in changed[:limit]:
        old, new = before.get(path), after.get(path)
        if old is None:
            parts.append(f"{path}（新文件）")
        elif new is None:
            parts.append(f"{path}（删掉）")
        else:
            lines = list(unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0))
            plus = sum(1 for line in lines if line.startswith("+") and not line.startswith("+++"))
            minus = sum(1 for line in lines if line.startswith("-") and not line.startswith("---"))
            parts.append(f"{path} +{plus}/−{minus} 行")
    more = f" 等 {len(changed)} 个文件" if len(changed) > limit else ""
    return f"和这一轮开始时比的净改动：{'，'.join(parts)}{more}。对用户说改了什么，以这个为准。"

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


def _window_cut_hint(stopped: int, wanted: int, prefix: str = "") -> str:
    return (prefix + f"这个窗口超过一次能回的字数，只回到第 {stopped} 行（不含），不是你要的第 {wanted} 行。"
            f"接着读带 start_line={stopped}；想一次少读点就把窗口开小。")


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


# browser_* 的错误码 → 一句话。写法同下面的 VERIFICATION_ERROR_TEXT。
# ⚠ 2026-09-25 QGT6D76EYV：browser_view 只回 project_browser_action_failed，
#   真因是这台主机的页面浏览器没装好。
BROWSER_ERROR_TEXT = {
    "project_browser_driver_unavailable": "这台主机上的页面浏览器起不来（浏览器组件没装好）。这是运行环境的问题，不是应用代码；"
        "别反复调 browser_*，也别为此改代码或重启服务。开发服务器是否在跑看 runtime 状态，交付以 project_verify 的独立验收为准。",
    "project_browser_preview_unreachable": "打不开预览地址（网络或预览网关不通）。开发服务器可能仍在正常运行；这是环境问题，"
        "不是代码错误，别为此重启服务或改代码。",
    "project_browser_preview_forbidden": "预览网关拒绝了这台主机的访问（401/403），访问票不被认。这是环境问题，不是应用自己的登录；"
        "改代码解决不了。",
}


PREVIEW_NOTE = "用户在界面右侧的预览面板里看这一页。给用户的回复里不要写预览地址或主机名，说「在右侧预览里看」。"


def model_page_path(url) -> str | None:
    """给模型的页面地址只留路径，不留主机。

    ⚠ 2026-09-25 隔离真机 sr-20260925075204-ZNC56623QH：browser_view 把
      runtime.previewUrl（internal 模式下工人记下的 E2B 公开主机
      `5173-*.e2b.app`，中继拨不通时的后备）原样交给模型，模型写成「私有预览服务
      已启动：[打开记账网页](https://5173-….e2b.app/)」给了用户——绕开了服务器
      配置的预览网关（WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE）。线上 allowlist
      模式下同一个链接是缺访问令牌的死链。查询串也不留（网关票据走 query）。
    """
    if not isinstance(url, str) or not url.strip():
        return None
    try:
        path = urlsplit(url.strip()).path or "/"
    except ValueError:
        return None
    return path if path.startswith("/") else "/" + path


def _strip_preview_host(result: dict) -> dict:
    if "url" in result:
        result["url"] = model_page_path(result.get("url"))
    return result


# 多行命令不再拒（见 e2b_workspace_provider.pty_line），原先那条「改成一行」的提示随之删掉。
SHELL_ERROR_TEXT: dict[str, str] = {}

#: 建工程回执里列出的路径上限。模板 9～30 个文件；再多就只给前面这些。
CREATED_FILE_LIST_MAX = 60
# operationId 是 pop- + 32 位十六进制：漏一位 ≈0.99、换两对 ≈0.94；两条不相干的
# id 随机两万对实测最高 0.56（前缀 pop- 与偶然的公共子串）。0.9 把两者分开，不会把别的那条递出去。
OPERATION_ID_TYPO_RATIO = 0.9


def missing_file(files, path) -> ProjectNotFound:
    """读不到的文件：错误码不变，附上旁边**真有**的东西。

    ⚠ 2026-09-27 隔离真机网页第 23 / 26 / 30 轮：模型建完工程，跟 project_list 同一批
      就去读 Vite 默认的 `src/App.tsx`、`src/index.css`——这个模板是 `src/main.tsx`、
      `src/style.css`。回执只有 project_file_not_found，每一轮都是两发白读，再靠
      下一轮的列表纠正。读一个目录（`src`）也是同一个错误码，没说那是目录。
      只列事实（同目录下有哪些），不猜「你是不是想读 X」。
    """
    exc = ProjectNotFound("project_file_not_found")
    target = str(path or "").strip().strip("/")
    names = [str(name) for name in (files or {})]
    inside = sorted({name[len(target) + 1:].split("/", 1)[0] + ("/" if "/" in name[len(target) + 1:] else "")
                     for name in names if target and name.startswith(target + "/")})
    if inside:
        exc.hint = f"{target} 是目录，里面有：{', '.join(inside[:12])}。读文件要给完整路径。"
        return exc
    parent = target.rsplit("/", 1)[0] if "/" in target else ""
    prefix = parent + "/" if parent else ""
    siblings = sorted({name[len(prefix):].split("/", 1)[0] + ("/" if "/" in name[len(prefix):] else "")
                       for name in names if name.startswith(prefix)})
    if siblings:
        exc.hint = f"{target} 不存在。{parent or '工程根目录'} 下现有：{', '.join(siblings[:12])}。"
    elif parent:
        # ⚠ 2026-09-28 隔离真机第 103 轮 sr-20260928122121-2XPBK8TS8R（家长会 PPT）：生成脚本在沙盒里顺手写了
        #   output/…_qa.json、…_sources.json，模型再 file_read 它们——两发 project_file_not_found，
        #   一句提示都没有（源码里连 output/ 都没有，列不出同目录）。全库同形的还有 build_record.json、
        #   deck_spec.json、source_manifest.json、layout_check.txt。file_read 读的是工程源码，
        #   命令写在沙盒里的东西不在这儿。
        exc.hint = (f"{target} 不存在，工程源码里也没有 {parent}/ 这个目录。命令在沙盒里写出的文件"
                    "（收回的 .pptx/.docx/.xlsx 除外）不进工程源码，file_read 读不到；"
                    f"要看就在沙盒里用 shell_exec 打出来（cat {target}）。")
    return exc


def arguments_invalid(exc: ValidationError) -> dict:
    """参数没过校验：说清是哪个参数、给了什么、要求是什么。

    ⚠ 2026-09-27 隔离真机 sr-20260927070207-AQFP20YTVE（网页第 26 轮）：模型读
      `src/main.tsx` 给了 `"limit": 10000`，上限是 8000。回执只有
      `project_tool_arguments_invalid`，没说哪错——同样形状又撞一次，然后改用
      file_read 绕过去。同一个工具再也没用对。错误信息要能照着改（抄 grok 的
      工具参数错误：带字段名和约束）。
    给回来的值截短：file_write 的内容可能很长，不许整段回喂。
    """
    rows = []
    for error in exc.errors()[:4]:
        field = ".".join(str(part) for part in error.get("loc") or ()) or "参数"
        value = error.get("input")
        shown = "" if isinstance(value, dict) else f"={str(value)[:60]!s}"
        rows.append(f"{field}{shown}（{error.get('msg')}）")
    return {"ok": False, "error": "project_tool_arguments_invalid",
            "hint": "参数不合法：" + "；".join(rows) + "。按要求改了再调。"}


def tool_error(code: str) -> dict:
    """工具失败的回执：错误码，认得的再附一句人话。"""
    body = {"ok": False, "error": code[:240]}
    hint = BROWSER_ERROR_TEXT.get(code) or SHELL_ERROR_TEXT.get(code)
    if hint:
        body["hint"] = hint
    return body


# 独立验收的错误码 → 模型读得懂的一句话：是什么、不是什么、该怎么办。
# ⚠ 2026-09-25 隔离真机 sr-20260925053053-T4TJXXCW0Z：回执只有
#   project_browser_auth_failed，模型收尾写成「被模板登录鉴权阻断」——当成了应用
#   自己的登录。其实是验收浏览器拿不到预览访问票。写法抄 minimax-code 的
#   cronUnsupportedHostError：先说不是什么，再说别做什么，最后说该做什么。
VERIFICATION_ERROR_TEXT = {
    "project_browser_auth_failed": "验收浏览器拿不到这台预览的访问票：预览网关不认这台主机发的票。"
        "这是运行环境的问题，不是应用自己的登录，也不是代码错误；改代码、重启服务、重复验收都解决不了。"
        "如实告诉用户验收没能在这个环境里跑起来。",
    "project_browser_not_configured": "这个环境没有配置独立验收浏览器。不是代码错误，重复验收没有用；如实告诉用户。",
    "project_browser_key_missing": "这个环境缺少验收浏览器的凭据。不是代码错误，重复验收没有用；如实告诉用户。",
    "project_browser_unavailable": "验收浏览器这次没能启动，是运行环境的问题，不是代码错误。可以稍后再验收一次；仍然失败就如实告诉用户。",
    "project_browser_assertion_failed": "验收跑完了，有断言没通过——这是应用本身的问题。看 assertions 里 failed 的那几条，改代码后对新版本重新验收。",
}


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
    # ⚠ 2026-09-28 隔离真机第 89 轮 sr-20260928060820-HRBKWESVYY（习惯打卡网页，追问「刷新后完成的习惯变回未完成」）：
    #   browser_restart 先 cancel 在跑的那台、再 submit 一台新的。新那台的回执拿到「已经有开发服务器
    #   fbcc… 在跑，这条启动是多余的…这条排队的取消掉」——而 fbcc 正是这次重启刚叫停的那台。
    #   模型照做，取消了替补，两台都没了，下一发 project_verify → workspace_lease_lost，再 project_start
    #   多花 70 秒。挡路的已经在停，就不是「常驻」「多余」，排着的这条是替补，它停下就轮到。
    stopping = bool(holder.cancelRequested) or holder.status == "cancelling"
    return {"operationId": holder.operationId, "kind": holder.kind, "status": holder.status,
        "stopping": stopping,
        # 开发服务器 running 就是常驻：等它结束等于等到租约过期。
        "neverYields": holder.kind == "runtime.start" and holder.status not in _TERMINAL and not stopping,
        "duplicateStart": operation.kind == "runtime.start" and holder.kind == "runtime.start" and not stopping,
        "buildCheck": operation.kind == "runtime.exec" and _is_build_check(operation.input),
        "inspection": operation.kind == "runtime.exec" and _is_inspection(operation.input)}


#: 纯查看的一段命令：打印 / 搜索文件、列目录、看脚本用法。
_INSPECT_SEGMENT = re.compile(
    r"^\s*(?:(?:sed|cat|head|tail|nl|less|more|grep|egrep|rg|ls|find|tree|wc|file|stat)\b"
    r"|[\w./-]+\s.*--help\b|(?:python3?|node|bash|sh)\s+[\w./-]+\s+(?:--help|-h)\s*$)")
#: 任何一处像是会写东西的，就不算纯查看。
_WRITES_SOMETHING = re.compile(r">|\btee\b|\bsed\s+-i\b|\b(?:rm|mv|cp|mkdir|touch|chmod|pip3?|npm|npx|pnpm|yarn)\b|<<")


def _is_inspection(data) -> bool:
    """排队的这条是不是只在「看」：每一段都是查看命令，且没有一处会写。

    ⚠ 2026-09-28 隔离真机第 102 轮 sr-20260928114738-JX5ZDCBK5Z（团队任务看板网页，追问「图表下面加一个导出 CSV 的按钮」）：
      `python3 .sliderule/skills/webapp-testing/scripts/with_server.py --help` 排在开发服务器后面——
      网页工程的命令都要拿租约，服务器在就永远轮不到。回执只会说「先停掉服务器」，为看一眼用法去停
      服务器不值，模型就把它丢在队里。全库那 37 次排队里另有五六次是这类（技能脚本 --help、
      sed -n 翻源码）。看文件本来就有不排队的路：file_read / file_find_in_content（技能文件也能读）。
    """
    if not isinstance(data, dict):
        return False
    script = str(data.get("script") or "").strip()
    if not script or _WRITES_SOMETHING.search(script):
        return False
    segments = [part for part in re.split(r"&&|\|\||;|\|", script) if part.strip()]
    return bool(segments) and all(_INSPECT_SEGMENT.search(part) for part in segments)


def _is_build_check(data) -> bool:
    """排队的这条是不是「看看能不能构建」：受管 build/check，或 shell 里跑 npm run build / tsc。"""
    if not isinstance(data, dict):
        return False
    if data.get("command") in {"build", "check"}:
        return True
    script = str(data.get("script") or "")
    return bool(re.search(r"\bnpm run (?:build|check)\b|\btsc\b|\bvite build\b", script))


def withdraw_unrunnable_build(adapter, body):
    """排在常驻开发服务器后面的「看看能不能构建」，宿主当场撤回，不留在队里。

    ⚠ 2026-09-28 隔离真机第 92 轮 sr-20260928071407-JS538JZTFK（时间记录网页，四轮追问）：
      三轮追问里都是 `shell_exec npm run build` → queued（排在开发服务器后面）→ 照回执提示
      shell_kill_process → project_verify，一次确认要三发；同一轮里还犯了两遍。翻全库：
      这种排队 37 次，26 次是 npm run build、4 次 npm run check；只有 18 次被模型取消，
      剩下的烂在队里——服务器一停，一条过期的构建先占住工程。
      它在服务器停之前永远不会开始，开始时对的也不再是模型想确认的那一版。
      所以这一种（且只有这一种：挡路的是没在停的开发服务器、排的是构建检查）当场撤回，
      回执说清撤了、为什么、该走 project_verify。别的命令排队照旧只解释，不替模型做主。
    """
    if not isinstance(body, dict) or body.get("status") != "queued" or not body.get("operationId"):
        return body
    blocker = queue_blocker(adapter, body["operationId"])
    if blocker is None or not (blocker["neverYields"] and (blocker["buildCheck"] or blocker["inspection"])):
        return body
    try:
        if adapter.supervisor is None:
            adapter.store.request_operation_cancel(body["operationId"], owner_id=adapter.owner_id)
        else:
            adapter.supervisor.cancel(body["operationId"], owner_id=adapter.owner_id)
        status = adapter.store.get_operation(body["operationId"], owner_id=adapter.owner_id).status
    except Exception:
        return body  # 撤不掉就照旧排队 + 解释（增强类，fail-open）
    hid = blocker["operationId"]
    if blocker["buildCheck"]:
        hint = (f"这条构建没有跑，宿主已经把它撤回：开发服务器 {hid} 在跑，占着工程，服务器不停它永远不会开始。"
                "确认能不能构建不用停服务器：用 project_verify，它在服务器旁边对当前版本跑 npm run build"
                "（含类型检查），回执 verification.build 里有 buildExitCode。不用再 shell_kill_process 这一条。")
    else:
        hint = (f"这条只是看文件的命令，没有跑，宿主已经把它撤回：开发服务器 {hid} 在跑，占着工程，"
                "服务器不停，任何命令都排在它后面、永远轮不到。看文件不用排队：file_read 带 start_line/end_line，"
                "搜内容用 file_find_in_content；.sliderule/skills/ 下的技能文件也能这样读，"
                "脚本怎么用看它的源码（参数解析那段）。不用再 shell_kill_process 这一条。")
    return {**body, "status": status, "withdrawn": True, "commandFinished": False,
        "blockedBy": {k: blocker[k] for k in ("operationId", "kind", "status")},
        "hint": hint}


def explain_queue(adapter, body):
    """queued 的回执说清被谁挡住、该怎么办。见 queue_blocker。"""
    if not isinstance(body, dict) or body.get("status") != "queued" or not body.get("operationId"):
        return body
    blocker = queue_blocker(adapter, body["operationId"])
    if blocker is None:
        return body
    hid = blocker["operationId"]
    if blocker.get("stopping"):
        hint = (f"这条排在 {hid}（{blocker['kind']}）后面，而 {hid} 已经在停（取消已发出）。它一停下这条就开始——"
                f"这条是替补，不要取消它。用 project_status 带 {body['operationId']} 看它起来没有。")
    elif blocker["duplicateStart"]:
        # ⚠ 2026-09-25 K1N7JX1FPS：这里原来也劝「先停掉挡路的」。模型照做，
        #   停掉在跑的那台，排队的旧启动顶上来，它再发一个——6 起 4 停。
        hint = (f"已经有开发服务器 {hid} 在跑，这条启动是多余的。预览、浏览器、验收都直接用 {hid}，"
                f"不要停它；这条排队的用 shell_kill_process 带 {body['operationId']} 取消掉。")
    elif blocker["neverYields"] and blocker["buildCheck"]:
        # ⚠ 2026-09-27 隔离真机第 33/36/37/38/41 轮：网页追问改完代码发 build，排在开发
        #   服务器后面；照上面那句去停服务器 → 构建 → 再起服务器，每轮多三四步，第 33 轮
        #   没停还干等了 4 分多钟。而 project_verify 本来就在服务器旁边对当前版本跑
        #   `npm run build`（含 tsc），回执里有 buildExitCode——第 41 轮模型取消了排队的
        #   build 改走验收，拿到的就是这个。确认能不能构建，指它去那条路。
        hint = (f"这条排在 {hid}（runtime.start，开发服务器，正在运行）后面，服务器不停它不会开始。"
                "只是想确认能构建的话，不用停服务器：用 project_verify，它在服务器旁边对当前版本跑 "
                "npm run build（含类型检查），回执 verification.build 里有 buildExitCode。"
                f"这条排队的用 shell_kill_process 带 {body['operationId']} 取消掉。")
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
    siblings = saved.get("officeSiblings")
    if isinstance(siblings, dict) and siblings:
        result["officeSiblings"] = {str(k)[:240]: str(v)[:240] for k, v in list(siblings.items())[:8]}
    for name in ("officeFiles", "officeFilesHeld", "sandboxOnlyEdits"):
        files = saved.get(name)
        if isinstance(files, list) and files:
            result[name] = [str(item)[:240] for item in files[:8] if isinstance(item, str)]
    for key in ("officeFacts", "officeFactsBefore"):
        measured = saved.get(key)
        if isinstance(measured, dict) and measured:
            result[key] = {
                str(path)[:240]: {k: v for k, v in facts.items() if isinstance(v, int)}
                for path, facts in list(measured.items())[:8]
                if isinstance(path, str) and isinstance(facts, dict)
            }
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
    if operation.kind == "runtime.exec" and operation.status in _TERMINAL and not saved.get("keepSandbox"):
        # 网页工程每条命令一台新沙盒，跑完就回收（worker：「Vite 工程仍拆掉」）。见 _command_pointer。
        result["sandboxReclaimed"] = True
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
    # ⚠ 2026-09-27 统计隔离真机第 6～37 轮的无窗读：10 次里 5 次紧跟着带窗重读同一个
    #   文件，其中 3 次是 476 字的 package.json——摘要已经是全文，回执却写
    #   truncated=true、「这是路径和摘要，不是全文」。短文件就说是全文，别逼它再读一遍。
    #   长文件照旧只给摘要（上下文预算，见 test_manus_context_load）。
    whole = excerpt == text
    return {
        "revision": revision.revision,
        "path": path,
        "sha256": content_hash(text),
        "totalChars": len(text),
        "lineCount": len(lines),
        "excerpt": excerpt,
        "content": "",
        "nextOffset": 0,
        "truncated": not whole,
        "hint": (
            "文件不长，excerpt 就是全文，不用再读。" if whole else
            "这是路径和摘要，不是全文。"
            "要原文带 offset/limit 或 start_line/end_line；搜内容用 file_find_in_content。"
        ),
    }


_OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def _terminal_text(raw: str) -> str:
    """PTY 字节 → 人看到的屏幕文字：去控制码，回车覆盖只留最后一版。

    终端在第 80 列折行时回显「空格 + \r」，那不是覆盖，是续行，拼回去。
    """
    text = _OSC.sub("", _ANSI_CSI.sub("", raw or "")).replace(" \r", "")
    lines = []
    for line in text.split("\n"):
        parts = [part for part in line.split("\r") if part]
        lines.append(parts[-1] if parts else "")
    return "\n".join(lines)


#: npm 跑脚本时固定先打这一行：`> whybuddy-project@0.1.0 build`。
_NPM_BUILD_HEADER = re.compile(r"(?m)^> \S+ build\s*$")
BUILD_LOG_TAIL_CHARS = 1500


def _build_log_tail(store, runtime_operation_id, owner_id, *, since=None, until=None) -> str:
    """验收里那次 `npm run build` 失败时的输出尾巴（tsc 报错就在这里）。

    ⚠ 2026-09-27 隔离真机第 50 轮（民宿预订管理 + 追问按房型和日期筛空房）：
      project_verify 回 project_build_failed，回执只有 buildExitCode=2，一行报错都没有。
      模型去 project_logs 翻开发服务器那条操作的日志——一个字符一个事件、夹着 ANSI，
      还混着开发服务器重启的输出——翻了两页才看到 tsc 的错。
    构建进程的输出以 runtime.log 记在开发服务器那条操作上，带 processId；
    认 npm 固定的脚本头，取最后一个跑 build 的进程，按屏幕文字给尾巴。
    同一条开发服务器操作上会有好几次验收构建（第 50 轮：一次过、一次挂、一次过），
    只看这次验收构建证据的起止时间窗（since/until，同为 ISO 串）里的日志。
    """
    if store is None or not runtime_operation_id:
        return ""
    by_pid: dict[str, list[str]] = {}
    order: list[str] = []
    after = 0
    try:
        while True:
            page = store.list_events(runtime_operation_id, owner_id=owner_id, after_seq=after, limit=1000)
            for event in page:
                payload = event.payload if isinstance(getattr(event, "payload", None), dict) else {}
                pid = str(payload.get("processId") or "")
                stamp = str(getattr(event, "timestamp", "") or "")
                if (since and stamp < since) or (until and stamp > until):
                    continue
                if event.type == "runtime.log" and pid:
                    if pid not in by_pid:
                        by_pid[pid] = []
                        order.append(pid)
                    by_pid[pid].append(str(payload.get("text") or ""))
            if len(page) < 1000:
                break
            after = page[-1].seq
    except Exception:
        return ""
    for pid in reversed(order):
        text = _terminal_text("".join(by_pid[pid])).strip("\n")
        if _NPM_BUILD_HEADER.search(text):
            return text[-BUILD_LOG_TAIL_CHARS:]
    return ""


# 分组口径与工作台「版本」页同一份（revision_turns 模块头）。
from services.revision_turns import REVISION_TURNS_HINT, revisions_by_turn, user_turns  # noqa: E402,F401


def _command_log_excerpt(store, operation_id, owner_id, last_seq=None) -> str:
    """操作日志**末尾**，按屏幕文字。bash 写出的文本不进源码树，file_read 找不到。

    ⚠ 2026-09-25 隔离真机 sr-20260925111249-E1Y12175TS：python3 generate_deck.py
      缺 pptx 退出码 1，回执 excerpt 只有回显的那半行命令加控制码，报错一个字
      没有；提示「完整输出在操作日志，用 project_logs 再取」，模型照做两次拿回
      同一段——这里从 seq 0 读前 100 条，而 PTY 回显是一字节一个事件，前 100 条
      全是回显。模型最后靠猜 pip install 才修好。现在从 lastSeq 往回读尾巴。
    """
    op_id = str(operation_id or "").strip()
    if not op_id or store is None:
        return ""
    try:
        after = max(0, int(last_seq) - 1000) if last_seq is not None else 0
    except (TypeError, ValueError):
        after = 0
    events = store.list_events(op_id, owner_id=owner_id, after_seq=after, limit=1000)
    parts: list[str] = []
    for event in events:
        payload = event.payload if getattr(event, "payload", None) else {}
        if not isinstance(payload, dict):
            continue
        if event.type == "runtime.log":
            parts.append(str(payload.get("text") or ""))
        elif event.type == "runtime.console":
            parts.append(str(payload.get("data") or payload.get("text") or ""))
    text = _terminal_text("".join(parts)).strip("\n")
    if len(text) > FILE_READ_EXCERPT_CHARS:
        return _Tail(text[-FILE_READ_EXCERPT_CHARS:], len(text))
    return _Tail(text, len(text))


class _Tail(str):
    """日志尾：它本身就是那段字（调用方照旧当 str 用），另外记着全长。"""

    def __new__(cls, text, total):
        obj = super().__new__(cls, text)
        obj.total = total
        return obj


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


#: 只装依赖、不产出交付物的命令。每一段（&& ; || 隔开）都得是它才算。
_INSTALL_SEGMENT = re.compile(
    r"^(?:sudo\s+)?(?:"
    r"(?:python3?\s+-m\s+)?pip3?\s+install"
    r"|uv\s+pip\s+install"
    r"|npm\s+(?:i|install|ci|add)"
    r"|pnpm\s+(?:i|install|add)"
    r"|yarn(?:\s+(?:install|add))?"
    r"|apt(?:-get)?\s+(?:-\S+\s+)*install"
    # 浏览器也是「装」：第 81 轮 `python3 -m playwright install chromium`。
    r"|(?:python3?\s+-m\s+)?playwright\s+install"
    r"|npx\s+(?:-y\s+)?playwright\s+install"
    r")(?:\s|$)"
)


def _only_installs(command) -> bool:
    """这条命令是不是只在装依赖。

    ⚠ 2026-09-26 隔离真机 sr-20260926043506-7B49NNSE1M：`pip install python-pptx`
      和前一条失败的 `python3 create_ppt.py` 的回执都挂着「这次扫描没有合格的
      办公文件」。装依赖本来就不产出文件，失败的命令失败本身才是消息——
      这句话在那两处只是噪声。它该出现的地方是：命令成功跑完、本该产出东西、
      却什么都没收回（3d9bfd12 加它时就是为这个）。
      `pip install X && python3 gen.py` 不算只装依赖——后半段是要产出的。
    """
    segments = [seg.strip() for seg in re.split(r"&&|\|\||;", str(command or "")) if seg.strip()]
    return bool(segments) and all(_INSTALL_SEGMENT.match(seg) for seg in segments)


#: 只看不写的程序。sed（-i）、cp、mv、tee 这类会写的不在里面。
_INSPECT_PROGRAMS = frozenset({
    "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "df", "tree",
    "grep", "egrep", "rg", "find", "zipinfo", "md5sum", "sha1sum", "sha256sum",
    "echo", "printf", "pwd", "which", "test", "true", "[",
})
_SHELL_OPERATORS = frozenset({"&&", "||", ";", "|", "&", "\n"})
_PY_WRITES = re.compile(r"\.save\(|write|unlink|remove|rename|shutil|makedirs|mkdir|to_excel|savefig")


_SED_WRITES = re.compile(r"(^|[;{}\s/0-9$])[wWe](\s|$)")


def _inspect_segment(tokens: list[str]) -> bool:
    if not tokens:
        return True
    program = tokens[0].rsplit("/", 1)[-1]
    if program in {"python", "python3"}:
        # python3 -c "from pptx import Presentation; print(len(...))"：读页数的那种。
        return (len(tokens) >= 3 and tokens[1] == "-c"
                and not _PY_WRITES.search(" ".join(tokens[2:])))
    if program == "unzip":
        # -t/-l/-v/-Z 只看；-p/-c 解到标准输出（第 24 轮 `unzip -p x.docx word/document.xml | python3 -c …`）。
        # 解到标准输出再重定向进办公文件的，重定向那条规则会拦下。
        return any(re.fullmatch(r"-[A-Za-z]*[tlvZpc][A-Za-z]*", t) for t in tokens[1:])
    if program == "find":
        return not {"-delete", "-exec", "-execdir", "-ok"} & set(tokens)
    if program == "sed":
        # ⚠ 2026-09-27 第 31 轮：`sed -n '1,260p' generate_budget.py` 翻脚本，回执挂着
        #   「那次生成没有写出文件」那一长段。不带 -i 的 sed 只往标准输出写；
        #   脚本里的 w/W（写文件）、e（执行）一样不算只在看。
        args = tokens[1:]
        # -f 从文件读脚本：看不见里面有没有 w，不算。
        if any(t.startswith(("--in-place", "--file")) or re.fullmatch(r"-[A-Za-z]*[if].*", t)
               for t in args):
            return False
        return not any(_SED_WRITES.search(t) for t in args if not t.startswith("-"))
    return program in _INSPECT_PROGRAMS


def _only_inspects(command) -> bool:
    """这条命令是不是只在看、不会产出或改动文件。

    ⚠ 2026-09-27 隔离真机 sr-20260927013213-9JXJJJ3RKY：生成那条已经收回 pptx，
      模型再跑 `unzip -t 复盘.pptx >/tmp/pptx_check.txt && tail -n 2 /tmp/pptx_check.txt`
      核对包结构。回执挂着「如果这条命令本该重新生成它，那次生成没有写出文件，
      库里仍是旧版。不要往源码树写占位……」——一条检查命令，本来就没打算生成。
    ⚠ 那一段是 2026-09-24 review 为「重新生成静默失败」加的，不能丢：
      跑脚本（python3 x.py）、认不出的程序、解析不了的命令（截断、引号不配对）
      一律**不算**只在看，照旧说全。宁可多说一句，不许把失败的重生成放过去。
    重定向写进办公文件（> deck.pptx）也不算只在看。
    """
    text = str(command or "").strip()
    if not text:
        return False
    try:
        lexer = shlex.shlex(text, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return False
    segment: list[str] = []
    segments = [segment]
    pending = ""  # 上一个 token 是重定向符时，下一个 token 是它的目标 / 来源，不是参数
    for token in tokens:
        if pending:
            writes, pending = pending.startswith(">"), ""
            if writes and token.lower().endswith((".pptx", ".docx", ".xlsx")):
                return False
            continue
        if token in _SHELL_OPERATORS:
            segment = []
            segments.append(segment)
        elif set(token) <= {">", "<"}:
            pending = token
        elif segment or not re.fullmatch(r"\d+", token):  # 2>/dev/null 里的 2
            segment.append(token)
    return all(_inspect_segment(seg) for seg in segments)


def _office_facts_sentence(result) -> str:
    """宿主从收回的文件字节里量出来的结构（deliverable_kind.office_facts 头注）。

    ⚠ 只陈述数字，外加一条真实性边界：向用户描述文件时以这些数为准——
      跟「排队≠完成」同一类，不是教模型下一步做什么。
    """
    measured = result.get("officeFacts") if isinstance(result, dict) else None
    if not isinstance(measured, dict) or not measured:
        return ""
    before = result.get("officeFactsBefore") if isinstance(result, dict) else None
    before = before if isinstance(before, dict) else {}
    rows = "；".join(
        office_facts_sentence(path, facts) + _facts_delta(before.get(path), facts)
        for path, facts in list(measured.items())[:8]
        if isinstance(facts, dict)
    )
    return f"文件实况（宿主从文件里量的）：{rows}。向用户描述这份文件时以这些数为准。"


_FACT_NAMES = (("slides", "页数"), ("sheets", "工作表"), ("charts", "原生图表"), ("pictures", "图片"),
               ("tables", "原生表格"), ("pivotTables", "数据透视表"),
               ("listDoubleMarked", "带双重记号的列表段落"), ("textInvisible", "和底色同色的文字"),
               ("formulasWrong", "结果对不上的公式"))


def _facts_delta(previous, current) -> str:
    """和覆盖前那一版比，哪些数变了（第 112 轮 sr-20260929090856-0GZ9EPV769：图表 2 → 2，收尾却说「已加入」一张）。"""
    if not isinstance(previous, dict) or not isinstance(current, dict):
        return ""
    moved = [f"{name} {previous.get(key, 0)}→{current.get(key, 0)}" for key, name in _FACT_NAMES
             if (key in previous or key in current) and previous.get(key, 0) != current.get(key, 0)]
    if moved:
        return "（和上一版比：" + "，".join(moved) + "；其余没变）"
    return "（和上一版比：这些数一个都没变——没多出来的东西别说成新增）"


#: 把一个文件打到屏幕上的命令：sed -n / cat / head / tail / nl / awk 带一个像文件名的参数。
_PRINTS_A_FILE = re.compile(
    r"(?:^|[;&|]\s*)(?:sed|cat|head|tail|nl|awk|less|more)\b[^;&|]*\s[\w./-]+\.[A-Za-z0-9]{1,8}(?:\s|$|[;&|])")
#: 在一个像文件名的参数上跑 grep / egrep / rg。
_GREPS_A_FILE = re.compile(
    r"(?:^|[;&|]\s*)(?:grep|egrep|rg)\b[^;&|]*\s[\w./-]+\.[A-Za-z0-9]{1,8}(?:\s|$|[;&|])")
_NOT_FOUND = re.compile(r"(?:^|\n)(?:[\w/.-]+: )?(?:line \d+: )?([\w.+-]{1,40}): command not found")


def _missing_program(excerpt, exit_code):
    """exit 127：说出来是哪个程序不在沙盒里。

    ⚠ 2026-09-27 隔离真机第 32、36、39 轮：模型三次拿 `rg --files` 找文件，都是
      exit 127，回执只有 project_command_failed。它每次都要再花一步才改用别的。
    """
    match = _NOT_FOUND.search(_terminal_text(str(excerpt or "")))
    if match is None:
        return ""
    if exit_code in (127, "127"):
        return (f"沙盒里没有 {match.group(1)} 这个程序（exit 127）。"
                "换一个装好的（grep、find、python3），或先装它再用。")
    # ⚠ 2026-09-27 隔离真机第 72 轮 sr-20260927205053-CRAS63F0NQ（家庭开支 Excel，追问撤掉
    #   备注列）：`rg -n '备注|E2|…' create_monthly_expenses.py || true` 再接重新生成——想先查
    #   脚本里还有没有残留引用。rg 不在，`|| true` 把 127 吞成 0，回执一个字没提；模型当作
    #   「查过了」往下走。第 32、36、39 轮也是 rg。退出码被盖住，输出里的那句还在。
    return (f"沙盒里没有 {match.group(1)} 这个程序，这条里用它的那一段没跑"
            "（退出码被 || true 或后面的命令盖住了）。换 grep / find / python3 重做那一步。")


LOG_POINTER_HINT = "完整输出在操作日志，用 project_logs 或 shell_view 带 operationId 再取。"


def _command_pointer(result, excerpt="", full_command=None):
    """bash / shell_exec：exit + operationId + 日志尾。完整 stdout 留在操作日志。

    ⚠ 2026-09-20 真机：excerpt 写成 errorCode，模型只看见
      project_command_failed，去 file_read run.log 又是 project_file_not_found。
      摘要必须是日志尾，再取带同一个 operationId。
    """
    if not isinstance(result, dict):
        return result
    hint = LOG_POINTER_HINT
    # ⚠ 2026-09-22 BABCJGGB44：回执没有文件路径，模型把 pptx base64 进日志。
    #   收回的路径必须写在模型看得见的这句话里，不能只藏在字段名里。
    command_text = full_command if isinstance(full_command, str) else result.get("command")
    inspects = _only_inspects(command_text)
    files = result.get("officeFiles")
    failed_run = result.get("exitCode") not in (0, "0", None)
    if isinstance(files, list) and files and failed_run:
        # ⚠ 2026-09-27 隔离真机第 39 轮（项目进度 Excel，追问改成工作日工期）：生成脚本
        #   写完 xlsx 后自检断言失败，exit 1。收回照旧（worker 头注：失败也可能已写出
        #   文件，fail-open），可回执写的是「办公文件已收回……这就是交付」——一次失败的
        #   运行被说成交付。那一轮模型没上当；下一次脚本在保存中途崩掉就未必。
        named = ", ".join(str(item) for item in files[:8])
        hint = (
            f"命令失败了，但写出了新版：{named}，已替换库里的旧版。"
            "它可能不完整：修好命令重跑，成功之前别对用户说它是交付。"
            "不要把文件 base64 进日志或 file_write。"
            + _office_facts_sentence(result)
            + hint
        )
    elif isinstance(files, list) and files:
        named = ", ".join(str(item) for item in files[:8])
        hint = (
            f"办公文件已收回：{named}。"
            "这就是交付，不要再把文件 base64 进日志或 file_write。"
            "同一个沙盒留给下一条命令，已安装的包还在。"
            + _office_facts_sentence(result)
            + _download_sentence(result)
            + hint
        )
    elif (isinstance(result.get("officeFilesHeld"), list) and result["officeFilesHeld"]
          and inspects):
        # 只是在看（unzip -t / ls / python3 -c 读页数）：本来就不产出文件，
        # 「本该重新生成」「不要写占位」那一段对它是噪声（_only_inspects 头注）。
        # 库里有什么、链接在哪，照样说——sr-20260924190011 缺的就是这个。
        named = ", ".join(str(item) for item in result["officeFilesHeld"][:8])
        hint = f"库里的办公文件没有变：{named}。" + _download_sentence(result) + hint
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
    siblings = result.get("officeSiblings")
    if isinstance(siblings, dict) and siblings:
        # ⚠ 2026-09-29 第 114 轮 sr-20260929095131-9A7P8RP51X：脚本「已存在就换名」，同一份文件变成两份（worker _numbered_sibling 头注）。
        pairs = "；".join(f"{new}（旧的 {old} 还在）" for new, old in list(siblings.items())[:4])
        hint = (f"这次写成了新文件：{pairs}。用户那边现在是两份。要改的是同一份，就写回原来的文件名"
                "（去掉脚本里「已存在就换个名字」那段）；下面的「和上一版比」是跟旧的那份比的。" + hint)
    drifted = result.get("sandboxOnlyEdits")
    if isinstance(drifted, list) and drifted:
        # ⚠ 2026-09-29 第 107 轮 sr-20260929070420-W29Y3BK1EP：沙盒里改的源码下一条命令就被还原（worker _note_sandbox_only_edits 头注）。
        named = ", ".join(str(item) for item in drifted[:8])
        hint = (f"这条命令在沙盒里改了工程源码文件：{named}。改动只在沙盒里，工程源码还是旧版；"
                "下一条命令开跑前会按工程源码把它们重写回去，这次的改动就没了。"
                "要留住：用 file_write 把改后的完整内容写回（或者改用 file_str_replace 改源码再跑）。" + hint)
    if (result.get("sandboxReclaimed") and result.get("exitCode") in (0, "0")
            and _only_installs(command_text)):
        # ⚠ 2026-09-28 隔离真机第 81 轮 sr-20260928021545-B6CQ0CM50T（番茄钟网页，追问「用 webapp-testing 把添加、完成、删除
        #   点一遍」）：`python3 -m pip install playwright && python3 -m playwright install chromium`
        #   成功、Chromium 下载完；五分钟后 `import playwright` → ModuleNotFoundError，下一条的日志
        #   里又是一遍 npm ci。网页工程每条命令一台新沙盒（源码树 + npm ci），跑完回收——装的东西
        #   活不过这一条。模型当成办公工作区那样「装一次一直在」，15 分钟没点成一下。
        hint = (
            "这台沙盒在命令结束时已经回收：网页工程每条命令都是一台新沙盒（源码树 + npm ci），"
            "这条装的东西下一条命令里不在。要用它，就把安装和使用写进同一条命令（装 && 跑）。"
            + hint
        )
    hidden = _hidden_command_failure(excerpt, result.get("exitCode"), result.get("command"))
    # 只在看的命令本来就不产出文件：第 24 轮 `python3 -c "import docx; print('python-docx ok')"`
    # 退出码 0，回执照样挂「没有合格的办公文件」。
    empty_scan_is_news = (
        result.get("officeScan") == "empty"
        and result.get("exitCode") in (0, "0")
        and not hidden
        and not _only_installs(command_text)
        and not inspects
    )
    if empty_scan_is_news:
        hint = "这次扫描没有合格的办公文件。" + hint
    elif result.get("officeScan") == "failed":
        hint = "这次没能扫办公文件。" + hint
    if hidden:
        hint = hidden + hint
    missing = _missing_program(excerpt, result.get("exitCode"))
    if missing:
        hint = missing + hint
    total = getattr(excerpt, "total", None)
    cut = isinstance(total, int) and total > len(str(excerpt or ""))
    if cut:
        # ⚠ 2026-09-27 隔离真机第 48 轮（关西旅行 PPT + 追问配图）：模型用
        #   `sed -n '1,260p' generate_ppt.py`、`'241,520p'`、`'1,180p'`、`'180,380p'`……
        #   把同一个脚本翻了近十遍。回执只留屏幕最后 800 字、不说被截了，它以为
        #   窗口开大了没打出来，就一遍遍缩小重来。截了就说截了、全长多少、该用什么。
        note = f"输出共 {total} 字，excerpt 只有最后 {len(str(excerpt))} 字。"
        # ⚠ 第 49 轮：`python3 -c "…核对…"` 输出 1215 字也挂了这句——那不是在翻文件，
        #   劝它 file_read 是噪声。只对「打印一个文件」的命令说。
        # 引号里的正则（'押金|签字'）不是管道：先把引号内容抹掉再认命令形状。
        bare = re.sub(r"'[^']*'|\"[^\"]*\"", "''", str(command_text or ""))
        if _PRINTS_A_FILE.search(bare):
            note += "要看源码文件用 file_read 带 start_line/end_line（一次最多 8000 字），别用 sed/cat 分段打印。"
        elif _GREPS_A_FILE.search(bare):
            # ⚠ 2026-09-27 第 63 轮（租赁合同 Word）：`grep -n -C 5 -E '押金|签字|…' generate_contract.py`
            #   超了 800 字，模型接着 project_logs、sed、再 grep、最后 file_read，绕了四步。
            note += "在源码里搜用 file_find_in_content（按文件、正则，返回行号和原文），别用 grep 翻屏。"
        hint = note + hint
    out = {
        **result,
        "excerpt": str(excerpt or "")[:FILE_READ_EXCERPT_CHARS],
        "hint": hint,
    }
    if hint == LOG_POINTER_HINT and not str(excerpt or "").strip() and (
            result.get("kind") == "runtime.patch" or result.get("status") == "queued"):
        # ⚠ 2026-09-27 隔离真机第 65 轮：追问里 1 次 file_write + 5 次 file_str_replace，
        #   每张回执都挂「完整输出在操作日志，用 project_logs 或 shell_view 再取」——改文件
        #   没有输出；排在服务器后面的 build 还没开始，也没有。叫模型去翻一个空日志是噪声。
        #   只剩这一句时整句不挂；有别的话（失败、办公文件）照旧整段交回。
        out.pop("hint")
    if cut:
        out["excerptTruncated"] = True
        out["outputChars"] = total
    if hidden:
        out["commandOk"] = False
    if result.get("officeScan") == "empty" and not empty_scan_is_news:
        out.pop("officeScan", None)
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
    command = _saved_command(store, operation_id, owner)
    receipt = _command_pointer(
        snap,
        _command_log_excerpt(store, operation_id, owner, snap.get("lastSeq")),
        full_command=command,
    )
    missing = _missing_skill_files_sentence(command or snap.get("command"), snap.get("exitCode"), owner)
    if missing and isinstance(receipt, dict):
        receipt["hint"] = missing + str(receipt.get("hint") or "")
    unlocked = _lockfile_out_of_sync_sentence(store, operation_id, owner, snap.get("errorCode"))
    if unlocked and isinstance(receipt, dict):
        receipt["hint"] = unlocked + str(receipt.get("hint") or "")
    return receipt


_LOCK_OUT_OF_SYNC = re.compile(r"can only install packages when your package\.json and package-lock\.json")
_LOCK_MISSING = re.compile(r"Missing: ((?:@[\w.-]+/)?[\w.-]+)@\S+ from lock file")


def _lockfile_out_of_sync_sentence(store, operation_id, owner, error_code) -> str:
    """装依赖失败、原因是 package.json 跟锁文件对不上：说清楚，说清后果。只读日志，不改任何东西。

    ⚠ 2026-09-30 隔离真机第 135 轮 sr-20260930014337-TAFH3SE2SD（体重记录网页，追问「用 Chart.js 加一个最近 7 天的折线图」）：
      模型往 package.json 加了 chart.js。网页工程每条命令先跑 `npm ci`，它只按锁文件装——锁里没有就 EUSAGE，
      连用来更新锁文件的 `npm install --package-lock-only` 也跑不到。回执只有「输出共 1534 字，excerpt 只有最后
      800 字」，npm 那句原因在日志开头、被截掉了。模型去手改 package-lock.json 五次，最后悄悄删掉 chart.js、
      自己用 canvas 画，收尾写「使用 Chart.js 绘制折线图」——工程里一行 chart.js 都没有。
    """
    if error_code != "project_dependency_install_failed" or store is None:
        return ""
    events, after = [], 0
    try:
        for _ in range(5):                       # PTY 回显可能一字节一个事件；npm 那句原因在开头
            page = store.list_events(str(operation_id), owner_id=owner, after_seq=after, limit=1000)
            events += page
            if len(page) < 1000:
                break
            after = page[-1].seq
    except Exception:
        return ""
    text = _terminal_text("".join(
        str((event.payload or {}).get("text") or (event.payload or {}).get("data") or "")
        for event in events if getattr(event, "type", "") in {"runtime.log", "runtime.console"}))
    if not _LOCK_OUT_OF_SYNC.search(text):
        return ""
    names = list(dict.fromkeys(_LOCK_MISSING.findall(text)))[:6]
    named = "、".join(names) if names else "新加的依赖"
    return (f"依赖没装上：package.json 里的 {named} 不在 package-lock.json 里。网页工程每条命令先跑 npm ci，它只按锁文件装，"
            "对不上就拒装——这条命令本身没跑，之后每条也都会卡在这一步；npm install 同样要先过这一步，这里更新不了锁文件。"
            "要让工程能跑，把 package.json 里这几项改回去；这个库用不上，就照实告诉用户没装上、用什么代替了，别说用了它。")


_SKILL_PATH_IN_COMMAND = re.compile(r"\.sliderule/skills/[A-Za-z0-9][\w.-]{0,63}/[^\s'\"`;|&<>()]+")


def _missing_skill_files_sentence(command, exit_code, owner) -> str:
    """失败的命令点了技能里没有的文件：跟 file_read 同一句话、同一份就近清单（§四）。

    ⚠ 2026-09-29 隔离真机第 116 轮 sr-20260929103821-XA38NTEQSB：file_read 猜错
      standards/structure/docx-structure.md 之后，下一轮改用 `bash sed -n … docx-structure.md`
      再猜一次，exit 2，回执只有 sed 的「No such file」。只在命令失败时看；通配符不猜。
    """
    if exit_code in (0, "0", None) or not isinstance(command, str):
        return ""
    notes, seen = [], set()
    for match in _SKILL_PATH_IN_COMMAND.finditer(command):
        located = catalog_skill_file(match.group(0))
        if located is None or located in seen or any(ch in located[1] for ch in "*?[{$"):
            continue
        seen.add(located)
        package = _skill_package_files(located[0], owner)
        folder = located[1].rstrip("/") + "/"
        if package is None or located[1] in package or any(path.startswith(folder) for path in package):
            continue
        notes.append(f"技能 {located[0]} 里没有 {located[1]}。它的文件（相对技能目录）："
                     f"{_skill_files_near(package, located[1])}。")
        if len(notes) == 2:
            break
    return "".join(notes)


def _saved_command(store, operation_id, owner):
    """操作记录里**没截断**的那条命令。

    ⚠ 2026-09-27 隔离真机 sr-20260927052041-2V6K4Z5SPY：快照给模型的 command 截在
      240 字（operation_snapshot），而核对用的 `python3 -c "…读页数、查关键字…"` 有
      397 字——截断处引号不配对，_only_inspects 解析失败，照规矩退回全段警告。
      第一版判据只喂了短命令，修复在真机上最常见的那种核对命令上一次都没生效
      （本仓 §一之二）。判断要用全文；全文只在这儿用，不加进快照——快照是白名单，
      project_status 直接把它交给模型。
    """
    try:
        operation = store.snapshot_operation(operation_id, owner_id=owner)["operation"]
    except Exception:
        return None
    command = (getattr(operation, "result", None) or {}).get("command")
    return command if isinstance(command, str) else None


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

    def source_file_listing(self, project_id: str | None, limit: int = 40) -> dict | None:
        """当前版本有哪些源码文件，给系统提示用。增强类：读不到就 None（fail-open）。

        ⚠ 2026-09-28 隔离真机第 94 轮 sr-20260928081512-PXESY6QGRA（单词卡片网页，追问「加暗色模式」）：追问一开口
          同一批并行去读 `src/App.tsx`、`src/App.css`、`src/index.css`——Vite 默认名，这个模板
          是 `src/main.tsx` + `src/style.css`。三发全是 project_file_not_found。回执里那句
          「src 下现有：…」救不了同一批里的另外两发。全库 48 次 file_not_found，36 次是这三个名字。
          猜之前就该知道有什么，所以在提示里给出当前版本的清单（锁文件和宿主注入的不列）。
        """
        if not project_id:
            return None
        try:
            revision = self.store.get_revision(project_id, owner_id=self.owner_id)
        except Exception:
            return None
        paths = [entry.path for entry in revision.manifest.files
                 if entry.path not in {"package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
                 and not entry.path.startswith(("public/_whybuddy/", ".sliderule/", "bridge/"))
                 and entry.path != "public/__whybuddy_revision.json"]
        return {"revision": revision.revision, "paths": paths[:limit], "total": len(paths)}

    def running_dev_server(self, project_id: str | None) -> str | None:
        """这一轮开口时，占着工程的常驻开发服务器（它的 operationId），给系统提示用。

        ⚠ 2026-09-30 隔离真机第 141 轮 sr-20260930035424-BJ13TVNV0V（小组作业分工看板网页，两轮追问）：
          三次运行各自一开口就并行发 project_exec check + build，两条都被 withdraw_unrunnable_build
          当场撤回（开发服务器 pop-5a2d… 从第一轮一直在跑）。撤回回执说得对，可它只进那一轮的上下文，
          下一轮照犯一遍。全库 56 次撤回分布在 46 轮里——几乎每轮追问都要先撞这一下才知道。
          判据与 queue_blocker 同一条：租约 processRefs 指向一条没在停的 runtime.start。
          增强类，查不到就 None（fail-open）。
        """
        if not project_id:
            return None
        try:
            lease = self.store.get_lease(project_id, owner_id=self.owner_id)
            holder_id = lease.processRefs.get("operationId") if lease else None
            if not holder_id:
                return None
            holder = self.store.get_operation(holder_id, owner_id=self.owner_id)
        except Exception:
            return None
        if (holder.kind != "runtime.start" or holder.status in _TERMINAL
                or holder.cancelRequested or holder.status == "cancelling"):
            return None
        return holder.operationId

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
            if "approvalRef" in type(parsed).model_fields and parsed.approvalRef is None:
                # 没传 approvalRef：绑定会话里当前已批准的那一版（WriteArguments 头注，第 132 轮）。没批准照旧拒。
                bound = load_authorized_session(session_id, owner_id=self.owner_id)
                if not plan_execution_authorized(bound):
                    raise PermissionError("project_plan_approval_required")
                parsed = parsed.model_copy(update={"approvalRef": approved_reference(bound)})
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
                # ⚠ 2026-09-27 隔离真机第 33/36/37 轮：回执只有 fileCount=9，模型建完
                #   工程第一件事是并行猜读 src/App.tsx、src/index.css、src/main.jsx……
                #   每轮 2～3 次 project_file_not_found。模板就 9 个文件，直接列出来。
                paths = [item.path for item in self.store.get_revision(
                    project.projectId, owner_id=self.owner_id).manifest.files]
                created["files"] = paths[:CREATED_FILE_LIST_MAX]
                if len(paths) > CREATED_FILE_LIST_MAX:
                    created["filesTruncated"] = True
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
                listed = ProjectSourceOperations(self.store, self.supervisor, self.owner_id).revisions(
                    project.projectId, parsed.cursor, parsed.limit)
                turns = self._revisions_by_turn(project, state)
                if turns:
                    listed["turns"] = turns
                    listed["hint"] = REVISION_TURNS_HINT
                return {"ok": True, **listed}
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
                return {"ok": True, **self._settled_receipt(operation)}
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
        except ValidationError as exc:
            return arguments_invalid(exc)
        except PersistClosedError as exc:
            return {"ok": False, "error": str(exc.reason)[:240]}
        except (ProjectConflict, ProjectNotFound, ProjectStoreUnavailable, PermissionError, ValueError) as exc:
            body = tool_error(str(exc))
            if isinstance(getattr(exc, "hint", None), str):
                body["hint"] = exc.hint
            elif str(exc) == "project_plan_approval_required":
                fix = self._approval_ref_mismatch(state, args)
                if fix:
                    body["hint"] = fix
            elif str(exc) == "project_operation_not_found":
                fix = self._mistyped_operation_id(state, args)
                if fix:
                    body["hint"] = fix
            elif str(exc) in {"project_revision_conflict", "project_runtime_patch_unavailable"}:
                fix = self._stale_revision_hint(state, args, str(exc))
                if fix:
                    body["hint"] = fix
            elif str(exc) == "project_revision_not_found":
                fix = self._unknown_revision_hint(state, args)
                if fix:
                    body["hint"] = fix
            return body

    def _stale_revision_hint(self, state, args, code) -> str:
        """版本号对不上：说清工程现在是哪一版、你传的是哪一版。闸不放松，照旧拒。

        ⚠ 2026-09-29 隔离真机第 113 轮 sr-20260929092634-ZNB4YGA34R（植物养护网页，追问「逾期没浇水的标红并排到最前面」）：
          project_start 复用了在跑的服务器，回执 revision 是它当初起来时那一版（prv-7a7b…）；之后的
          编辑已经实时同步，工程当前是 prv-7ad3…。模型拿旧的当 expectedRevision：project_verify →
          project_runtime_patch_unavailable，project_exec → project_revision_conflict，两发都没有提示。
          它读成「验收被拦」，没验就把「验证」待办勾成了完成。
        """
        passed = args.get("expectedRevision") if isinstance(args, dict) else None
        try:
            project = self.store.get_project_for_session(
                str(getattr(state, "sessionId", "") or ""), owner_id=self.owner_id)
            head = self.store.get_revision(project.projectId, owner_id=self.owner_id).revision
        except Exception:
            return ""
        if isinstance(passed, str) and passed.strip() and passed != head:
            return (f"你传的 expectedRevision 是 {passed}，工程当前是 {head}"
                    "（之后的编辑已经同步进在跑的服务器，旧号是服务器当初起来时那一版）。"
                    f"用当前这个再调：expectedRevision={head}。")
        if code == "project_runtime_patch_unavailable":
            return ("版本号是对的，是在跑的开发服务器此刻接不了验收（还在同步刚才的编辑、没就绪或已过期）。"
                    "用 project_status 看 runtime.status，到 ready 再调；服务器没了就先 project_start。")
        return ""

    def _unknown_revision_hint(self, state, args) -> str:
        """传的 revision 查无此版：说当前是哪一版、不传就是读当前；只差几个字符的那一版点名。闸不放松。

        ⚠ 2026-09-29 隔离真机第 128 轮 sr-20260929153009-SV45EX6FHQ（书签网页，追问「深色模式不要了，恢复成之前的样子」）：
          模型三发 project_list / project_search 带 revision=prv-f82aea105e78b2ac53cdbcc2882bb90b0——33 位，
          真的那版是 32 位（多抄了一个字符），回执只有 project_revision_not_found。它读成「版本号跟上下文不一致」，
          放弃按版本找回，改成手工删深色代码；结束时的源码跟加深色之前并不逐字相同。
        """
        if not isinstance(args, dict):
            return ""
        passed = next((args[key] for key in ("revision", "expectedRevision", "baseRevision")
                       if isinstance(args.get(key), str) and args[key].strip()), "")
        if not passed:
            return ""
        try:
            project = self.store.get_project_for_session(
                str(getattr(state, "sessionId", "") or ""), owner_id=self.owner_id)
            head = project.currentRevision
            known, cursor = [], head
            while cursor and len(known) < MAX_REVISIONS:
                known.append(cursor)
                cursor = self.store.get_revision(project.projectId, cursor, owner_id=self.owner_id).parentRevision
        except Exception:
            return ""
        if passed in known:
            return ""
        close = [item for item in known if SequenceMatcher(None, passed, item).ratio() >= OPERATION_ID_TYPO_RATIO]
        named = (f"本工程的 {close[0]} 跟它只差几个字符，多半是抄错了（一个字符都不能差），要那一版就原样用它。"
                 if len(close) == 1 else "")
        return (f"本工程没有 {passed} 这一版。{named}工程当前是 {head}；不传 revision 就是读当前版本，"
                "要看有哪些版本用 project_revisions。")

    def _mistyped_operation_id(self, state, args) -> str:
        """传的 operationId 查无此条、却跟本会话某条只差一两个字符：说是抄错了，给原样那串。

        ⚠ 2026-09-27 隔离真机第 65 轮 sr-20260927190013-AJ2QM1WR1Y（Markdown 笔记追问
          「按标签筛选 + 置顶」）：npm run build 排在开发服务器后面，回执叫它用
          shell_kill_process 带 pop-50d9…e985cf8d 取消。模型抄成 …e985cf8（漏了最后一个 d），
          回执只有 project_operation_not_found。它没再试，收尾交了——那条 build 一直排在
          队里，等服务器过期才会跑。跟第 47 轮 approvalRef 抄错是同一个病（见上）。
          查不到照旧报错（错误码不变）；只在唯一一条足够接近时点名，不猜。
        """
        if not isinstance(args, dict):
            return ""
        passed = next((args[key] for key in ("id", "operationId", "runtimeOperationId")
                       if isinstance(args.get(key), str) and args[key].strip()), "")
        if not passed:
            return ""
        session_id = str(getattr(state, "sessionId", "") or "")
        try:
            project = self.store.get_project_for_session(session_id, owner_id=self.owner_id)
            operations, after = [], ""
            while True:
                page = self.store.list_project_operations(project.projectId, owner_id=self.owner_id,
                    after_id=after, limit=100)
                operations += [op for op in page if op.sessionId == session_id]
                if len(page) < 100:
                    break
                after = page[-1].operationId
        except Exception:
            return ""
        if any(op.operationId == passed for op in operations):
            return ""
        close = [op for op in operations
                 if SequenceMatcher(None, passed, op.operationId).ratio() >= OPERATION_ID_TYPO_RATIO]
        if len(close) != 1:
            return ""
        match = close[0]
        return (f"没有 {passed} 这条。本会话的 {match.operationId}（{match.kind}，{match.status}）"
                f"跟它只差几个字符，多半是抄错了（一个字符都不能差）。原样用这个：{match.operationId}")

    def _approval_ref_mismatch(self, state, args) -> str:
        """计划其实批准了、只是模型回传的 approvalRef 对不上：说清楚，给出原样那串。

        ⚠ 2026-09-27 隔离真机第 47 轮（团队周报网页）：计划 14:20:15 批准；模型发
          project_exec、project_verify 时把 64 位摘要抄错了四个字符（…21c9dc… → …21d9cd…），
          回执只有 project_plan_approval_required。模型读成「还没批准 / 不许验收」，
          放弃验收，这一轮停在「还没通过交付验收」。第 33 轮也撞过一次。
          闸不放松：对不上照旧拒；只是把「没批准」和「抄错了」分开说。正确那串本来就
          在 project_status 回执里给模型看（approvalRef），这里不多泄露什么。
        """
        passed = args.get("approvalRef") if isinstance(args, dict) else None
        if not isinstance(passed, str) or not passed.strip():
            return ""
        try:
            authority = load_authorized_session(
                str(getattr(state, "sessionId", "") or ""), owner_id=self.owner_id)
        except Exception:
            return ""
        if not plan_execution_authorized(authority):
            return ""
        expected = approved_reference(authority)
        if passed == expected:
            return ""
        return (f"计划已经批准，是你传的 approvalRef 对不上（多半是抄错了，一个字符都不能差）。"
                f"原样用这个：{expected}")

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

    def _revisions_by_turn(self, project, state):
        """每一轮用户的话各自改出了哪些版本、开始时是哪一版（撤销「那一轮」就回到它）。"""
        chain = []
        current = project.currentRevision
        try:
            for _ in range(MAX_REVISIONS):
                if current is None:
                    break
                saved = self.store.get_revision(project.projectId, current, owner_id=self.owner_id)
                chain.append((saved.revision, str(saved.createdAt or "")))
                current = saved.parentRevision
        except Exception:
            return []
        return revisions_by_turn(list(reversed(chain)), user_turns(getattr(state, "controlTranscript", None)))

    def _settled_receipt(self, operation):
        """等完 / 查状态时，跑完的命令交回**带输出的**回执，不是裸快照。

        ⚠ 2026-09-27 隔离真机第 34 轮（信息安全培训 PPT，追问「检查每页有没有文字
          超出页面」）：shell_exec 前台等满返回 running，模型改用 shell_wait 等——
          回执只有 exitCode / lastSeq，一行输出都没有。模型判断「受管日志把逐字符
          回显截断了」，接着 shell_wait ×4、project_logs ×4、shell_view ×2、再改写
          成一行输出重跑，3 分半钟都在找自己那条命令的输出。
          shell_exec 自己等完走的是 command_receipt_from（日志尾 + 提示）；
          shell_wait / project_status 是同一件事的另外两个入口（§四），同一份回执。
        """
        if operation.kind == "runtime.exec" and operation.status in _TERMINAL:
            return command_receipt_from(self, operation.operationId)
        return self._snapshot(operation.operationId)

    def _current_screen(self, operation):
        """shell_view：终端此刻的最后一屏，不是日志第一页。

        ⚠ 2026-09-28 隔离真机第 83 轮 sr-20260928031857-QGV5XCJ4GS（稍后阅读网页，追问「用 webapp-testing 点一遍」）：
          `pip install playwright && playwright install chromium && with_server.py … -- python3 flow.py`
          跑着，模型 shell_view 三次拿回同一段——日志开头 npm ci 的 npm notice（从 seq 0 起翻、
          页满即止）。它只好猜「耗时在 Chromium 下载」；真实的尾巴是 Chromium 起不来
          （libnspr4.so 缺失）、服务已停、回到提示符。跟 2026-09-25 _command_log_excerpt 修的是
          同一个病（读头不读尾），那次只修了跑完的回执，看「正在跑的」这条入口没跟上（§四）。
          跑完的交回跟 shell_wait 同一份回执；还在跑的给快照 + 尾屏。从头翻用 project_logs。
        """
        if operation.status in _TERMINAL and operation.kind == "runtime.exec":
            return command_receipt_from(self, operation.operationId)
        snap = self._snapshot(operation.operationId)
        tail = _command_log_excerpt(self.store, operation.operationId, self.owner_id, snap.get("lastSeq"))
        snap["screen"] = str(tail or "")[:FILE_READ_EXCERPT_CHARS]
        total = getattr(tail, "total", None)
        snap["hint"] = (
            "screen 是终端此刻的最后一屏"
            + (f"（共 {total} 字，只给最后 {len(snap['screen'])} 字）" if isinstance(total, int) and total > len(snap["screen"]) else "")
            + "。从头翻用 project_logs。")
        return snap

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
                    **({"errorHint": VERIFICATION_ERROR_TEXT[record.errorCode]}
                       if record.errorCode in VERIFICATION_ERROR_TEXT else {}),
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
                if record.build is not None and record.build.status == "failed" and record.build.buildExitCode:
                    tail = _build_log_tail(self.store, record.runtimeOperationId, self.owner_id,
                                           since=record.build.startedAt, until=record.build.completedAt)
                    if tail:
                        result["verification"]["buildLogTail"] = tail
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
        return self.store.active_runtime_start(project.projectId, owner_id=self.owner_id)

    def _runtime_for_view(self, project, params, port):
        """看页面 / 开端口 / 启动：交给 supervisor.submit，它会复用现成的那台。"""
        operation = self.supervisor.submit(project.projectId, **params, port=port)
        result = self._snapshot(operation.operationId)
        if operation.idempotencyKey != params["idempotency_key"]:
            result["runtimeReused"] = True
        return result

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
            subdir = shell_exec_subdir(getattr(parsed, "exec_dir", None)) if name == "shell_exec" else ""
            if subdir is None:
                raise ValueError("project_shell_exec_dir_not_supported")
            if name == "bash":
                params["idempotency_key"] = str(uuid.uuid4())
            managed, script = classify_shell_command(parsed.command)
            if subdir:
                # 子目录里跑：交成普通 shell，先 cd 进去（受管的 check/build/test
                # 只在根上跑，不能换目录）。
                managed, script = "shell", f"cd {shlex.quote(subdir)} && {sandbox_shell_script(parsed.command)}"
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
            return {**self._runtime_for_view(project, params, 5173), "url": model_page_path(parsed.url),
                    "previewPrivate": True, "previewNote": PREVIEW_NOTE}
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
                result["previewNote"] = PREVIEW_NOTE
                interactor = getattr(self.supervisor, "browser_interactor", None)
                # 观察类，fail-open（§7）：拿不到页面快照也把开发服务器状态交回去，
                # 附上为什么拿不到。原来整条 browser_view 报错，runtime 状态一起丢了。
                try:
                    if callable(interactor):
                        observed = interactor({"op": "snapshot"}, page)
                        if isinstance(observed, dict):
                            result.update(observed)
                    elif local_playwright_available():
                        result.update(run_browser_action(page["url"], {"op": "snapshot"}))
                    else:
                        raise ValueError("project_browser_driver_unavailable")
                except ValueError as exc:
                    code = str(exc)[:240]
                    result["interactive"] = False
                    result["browserError"] = code
                    if code in BROWSER_ERROR_TEXT:
                        result["hint"] = BROWSER_ERROR_TEXT[code]
            return _strip_preview_host(result)
        # ⚠ 2026-09-30 隔离真机第 133 轮 sr-20260930004940-9GDY1QZGS4（月度预算网页，追问「加一个按类别统计支出的饼图」）：
        #   browser_console_view 的参数是 BrowserEmptyArguments（没有 id），这里读 parsed.id——AttributeError
        #   不在工具层接住的错误里，整轮 run 当场挂掉，用户看见「这一轮没跑完……（AttributeError）」。
        #   它的说明本来就是「读最近那条命令的日志」：没有 id 就是最近那条。
        operation = self._operation_by_id(project, session_id, getattr(parsed, "id", None))
        if name == "shell_kill_process":
            if self.supervisor is None:
                self.store.request_operation_cancel(operation.operationId, owner_id=self.owner_id)
            else:
                self.supervisor.cancel(operation.operationId, owner_id=self.owner_id)
            return self._snapshot(operation.operationId)
        if name == "shell_wait":
            wait = parsed.seconds if parsed.seconds is not None else 2
            operation = self._poll_operation(operation, wait)
            return self._settled_receipt(operation)
        if name == "shell_view" and operation.kind in {"runtime.exec", "runtime.start"}:
            return self._current_screen(operation)
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
            return _strip_preview_host({"interactive": True, **observed})
        if local_playwright_available():
            return _strip_preview_host(run_browser_action(page["url"], action))
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
            edits = getattr(parsed, "edits", None)
            if edits:
                changes = _str_replace_edits_changes(files, path, edits)
            else:
                old = getattr(parsed, "old_str", None) or getattr(parsed, "old_string", None) or parsed.oldStr
                if getattr(parsed, "new_str", None) is not None:
                    new = parsed.new_str
                elif hasattr(parsed, "new_string"):
                    new = parsed.new_string
                else:
                    new = parsed.newStr
                replace_all = bool(getattr(parsed, "replace_all", False) or getattr(parsed, "replaceAll", False))
                changes = kernel_str_replace_changes(files, path, old, new, replace_all=replace_all)
        result = self._patch(project, PatchArguments.model_validate({
            "approvalRef": approved_reference(authority),
            "expectedRevision": current.revision,
            "changes": changes,
        }))
        note = _indentation_error_note(changes)
        if note:
            result = {**result, "syntaxError": note["syntaxError"],
                      "hint": note["hint"] + str(result.get("hint") or "")}
        net = self._net_change_since_turn_start(project, current.revision, files, changes)
        if net:
            result = {**result, "hint": str(result.get("hint") or "") + net}
        return result

    def _net_change_since_turn_start(self, project, current_revision, files, changes) -> str:
        """这一轮开始以来源码的净改动，宿主量的（增强类：量不到就不说，§七）。

        ⚠ 2026-09-29 隔离真机第 118 轮 sr-20260929111945-BCHHHHSVVS（读书清单网页，追问「每本书后面加一个删除按钮」）：
          按钮第一轮就有。模型说了句「删除按钮其实已经在了」，又说 Hook 导入不完整、补了一行重复 import，
          构建挂掉再删回去——treeHash 和这轮开始时一模一样。收尾写「每本书后新增删除按钮（×）……已修复
          重复导入问题」。第 117 轮 sr-20260929105530-CZYB2ZSN44 同一个样子：原有的下拉框只加了个可见标签，报成「已加上」。
          提示词里那句「原来就有就照实说」（test_control_project_prompt）挡不住，它看不见自己改了多少。
          办公文件有「和上一版比」（_facts_delta）；这里给源码同样的一把尺子：只在这一轮已经动过之后
          才说（第一笔改动的净改动就是它自己，不必唠叨）。
        """
        start = TURN_START_REVISION.get()
        if not start or start == current_revision:
            return ""
        try:
            before = self.store.read_files(project.projectId, start, owner_id=self.owner_id)
        except Exception:
            return ""
        after = dict(files)
        for change in changes:
            if change.get("content") is None:
                after.pop(change["path"], None)
            else:
                after[change["path"]] = change["content"]
        return _net_change_sentence(before, after)

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
        skill_file_note = ""
        if path not in files:
            # ⚠ 2026-09-22 BABCJGGB44：file_read .sliderule/skills/.../SKILL.md
            #   得到 project_file_not_found，模型接着 bash `find /`。
            skill_body = _skill_body_for_catalog_path(path, self.owner_id)
            if skill_body is not None:
                files = {**files, path: skill_body}
                skill_read = True
            else:
                located = catalog_skill_file(path)
                package = _skill_package_files(located[0], self.owner_id) if located else None
                if package is None:
                    raise missing_file(files, path)
                if located[1] not in package:
                    listed = _skill_files_near(package, located[1])
                    missing = ProjectNotFound("project_file_not_found")
                    missing.hint = f"技能 {located[0]} 里没有 {located[1]}。它的文件（相对技能目录）：{listed}"
                    raise missing
                files = {**files, path: package[located[1]]}
                skill_file_note = (
                    f"这是已装技能 {located[0]} 的文件，不在工程源码里；沙盒里在 "
                    f".sliderule/skills/{located[0]}/{located[1]}，脚本用 shell_exec 跑那个路径。")
        if not explicit_read_window(args):
            pointer = _pointer_file(path, files[path], revision)
            if skill_read:
                pointer["hint"] = (
                    "这是技能正文的摘要，不是工程文件。"
                    "全文已经在 skill 回执里。不要在沙盒里 find .sliderule/skills。"
                )
            elif skill_file_note:
                pointer["hint"] = skill_file_note + str(pointer.get("hint") or "")
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
            # ⚠ 2026-09-28 隔离真机第 101 轮 sr-20260928112521-2KQWFPNSG7（保温杯推广方案 Word，追问「每章末尾加小结框」）：
            #   file_read generate_plan.py 260..430，文件没那么长，回执只有裸错误码，不说有几行。
            exc = ValueError("invalid_project_offset")
            exc.hint = (f"{path} 一共 {len(lines)} 行（行号从 0 起，end_line 不含）。"
                        f"start_line 要在 0..{len(lines)} 之间，end_line 不能小于 start_line。")
            raise exc
        text = "".join(lines[start:end])
        result = {"revision": revision.revision, "path": path, "sha256": content_hash(files[path]),
            "start_line": start, "end_line": start + text.count("\n") + (0 if text.endswith("\n") or not text else 1),
            "truncated": False, "totalChars": len(files[path])}
        result["content"] = _bounded_text({"ok": True, **result}, "content", text,
            cap=PROJECT_READ_MAX_RESULT_CHARS)
        result["truncated"] = result["content"] != text
        if result["truncated"]:
            # ⚠ 2026-09-28 隔离真机第 95 轮 sr-20260928090643-EN9AKT1A92（信息安全培训 PPT，追问「第 3 页拆成两页」）：
            #   file_read build_deck.py 0..256 被字数上限截在 ~170 行，回执却写 end_line=256、
            #   只多一个 truncated=true——没说停在哪。模型接着要 0..180、180..256（中间静静漏掉
            #   一截），又换 project_read 把整份读了三遍：改一处之前 11 次读同一个文件。
            #   截断时退回到整行，end_line 报真的，给出 nextStartLine 和一句接着读的话。
            #   先按带着提示的体积重新量一次，别让提示把结果顶过上限。
            sample = {"ok": True, **result, "nextStartLine": 10 ** 7,
                      "hint": _window_cut_hint(10 ** 7, 10 ** 7, skill_file_note)}
            cut = _bounded_text(sample, "content", text, cap=PROJECT_READ_MAX_RESULT_CHARS)
            whole = cut[:cut.rfind("\n") + 1] if "\n" in cut else cut
            result["content"] = whole
            result["end_line"] = start + whole.count("\n") + (0 if whole.endswith("\n") or not whole else 1)
            result["nextStartLine"] = result["end_line"]
            result["hint"] = _window_cut_hint(result["end_line"], min(end, len(lines)), skill_file_note)
        elif skill_file_note:
            result["hint"] = skill_file_note
        return result

    def _file_find_in_content(self, files, revision, args):
        if args.sudo:
            raise ValueError("project_sudo_forbidden")
        path = workspace_file_path(args.file, files)
        if path not in files:
            raise missing_file(files, path)
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
            raise missing_file(files, path)
        text = files[path]
        if not explicit_read_window(args):
            return _pointer_file(path, text, revision)
        if args.offset > len(text):
            exc = ValueError("invalid_project_offset")
            exc.hint = f"{path} 一共 {len(text)} 字；offset 是字数偏移，要在 0..{len(text)} 之间。"
            raise exc
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


def _str_replace_edits_changes(files, path, edits) -> list[dict]:
    """file_str_replace 的 edits：同一个文件依次套用，全成才出一份改动（第 161 轮，见 FileStrReplaceArguments 头注）。

    每一项照单处的规矩走（0 处、多处都拒，replace_all 明说才全换）；哪一项对不上就整批不落，
    回执说第几项、为什么——跟单处的提示同一套话，只在前面加上「第 k 项」。
    """
    working = dict(files)
    target = None
    for index, edit in enumerate(edits, 1):
        try:
            step = kernel_str_replace_changes(working, path, edit.old_str, edit.new_str,
                                              replace_all=bool(edit.replace_all))
        except ValueError as exc:
            failure = ValueError(str(exc))
            failure.hint = (f"edits 第 {index} 项（共 {len(edits)} 项）没对上，整批一处都没改（全部成功才落盘）。"
                            + (str(getattr(exc, "hint", "") or "")))
            raise failure from exc
        target = step[0]["path"]
        working[target] = step[0]["content"]
    return [{"path": target, "content": working[target], "expectedSha256": content_hash(files[target])}]
