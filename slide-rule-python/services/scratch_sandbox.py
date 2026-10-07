"""对话档的临时沙盒：没有工程时，也能跑一条命令（技能自带的脚本）。

⚠ 2026-10-06 真机 r41 sr-20261006075045-XT7WJ8NCP5（@ui-ux-pro-max 宠物医院小程序配色）：技能写明「配色 / 字体先跑
  `scripts/search.py --design-system` 查它自带的设计库」。直接回答的回合摆给模型的只有问答 / 计算 / 计划 / 技能 / 记忆，
  **没有任何能执行代码的工具**——模型加载完正文直接凭经验给色值，技能的数据库一行没查。r38 补了「读包里的文件」，这里是
  同一个缺口的另一半：读得到、跑不了。

  Claude / Trae 的每段对话都在沙盒里；我们的沙盒只在「做工程」时才起。用户 2026-10-06 定的方向：**按需起轻沙盒**——
  第一次要跑命令时才起一个 E2B 沙盒，同一会话复用，技能包写进 `.sliderule/skills/<名字>/`（跟工程沙盒同一个位置，
  技能正文里的 Base directory 不用改口）。有工程时不走这里，那边有 shell_exec。

这个模块只管「找 / 起沙盒 → 补写缺的技能包 → 跑 → 收结果」。用哪家沙盒、写哪些技能，由调用方注入（不碰 services 别的模块）。
起不来 / 跑挂了照实报错，不伪造输出（§七：这是证据类，fail-closed）。
"""

from __future__ import annotations

import re
import threading
from typing import Any, Dict, Mapping, Optional

WORKSPACE_PREFIX = "scratch-"
SANDBOX_TIMEOUT_SECONDS = 900       # 沙盒空闲多久回收；每跑一次续一次
MAX_COMMAND_SECONDS = 120
DEFAULT_COMMAND_SECONDS = 60
MAX_OUTPUT_CHARS = 20_000
SKILL_ROOT = ".sliderule/skills"
_SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")


def skill_paths(slug: str, files: Mapping[str, str]) -> Dict[str, str]:
    """技能包（相对技能根）→ 沙盒里的相对路径。跟工程沙盒的 skill_hydrate.sandbox_relpath 同一个位置、同一套校验。"""
    if not _SLUG.fullmatch(slug or ""):
        raise ValueError("skill_slug_invalid")
    out: Dict[str, str] = {}
    for rel, text in files.items():
        name = str(rel or "").replace("\\", "/").lstrip("/")
        if not name or ".." in name.split("/"):
            continue
        out[f"{SKILL_ROOT}/{slug}/{name}"] = text
    return out


def _clip(text: Any) -> tuple[str, bool]:
    value = str(text or "")
    if len(value) <= MAX_OUTPUT_CHARS:
        return value, False
    head = MAX_OUTPUT_CHARS // 2
    return value[:head] + f"\n…（中间省略 {len(value) - MAX_OUTPUT_CHARS} 字）…\n" + value[-head:], True


class ScratchSandboxes:
    """每个会话一个临时沙盒。按会话 id 找（metadata 认 workspace_id），找不到才起新的。"""

    def __init__(self, provider: Any):
        self.provider = provider
        self._handles: Dict[str, Any] = {}
        self._written: Dict[str, set] = {}      # sandbox_id → 已写进去的技能
        self._lock = threading.Lock()

    def _handle(self, session_id: str) -> tuple[Any, bool]:
        workspace_id = WORKSPACE_PREFIX + session_id
        handle = self._handles.get(session_id)
        if handle is not None:
            return handle, False
        found = self.provider.find_workspaces(workspace_id=workspace_id)
        if found:
            handle = self.provider.connect(found[0], timeout_seconds=SANDBOX_TIMEOUT_SECONDS)
            created = False
        else:
            handle = self.provider.create(workspace_id=workspace_id, timeout_seconds=SANDBOX_TIMEOUT_SECONDS)
            created = True
        self._handles[session_id] = handle
        return handle, created

    def read_file(self, session_id: str, path: str, *, max_bytes: int) -> bytes:
        """这个会话的临时沙盒里的一份文件。没起过沙盒就说没有——只为读一个文件不起新沙盒。"""
        with self._lock:
            handle = self._handles.get(session_id)
            if handle is None:
                found = self.provider.find_workspaces(workspace_id=WORKSPACE_PREFIX + session_id)
                if not found:
                    raise FileNotFoundError(path)
                handle = self.provider.connect(found[0], timeout_seconds=SANDBOX_TIMEOUT_SECONDS)
                self._handles[session_id] = handle
        return self.provider.read_file_bytes(handle, path, max_bytes=max_bytes)

    def run(self, session_id: str, command: str, *, skills: Mapping[str, Mapping[str, str]],
            timeout_seconds: Optional[int] = None) -> Dict[str, Any]:
        command = str(command or "").strip()
        if not command:
            return {"ok": False, "error": "command_required"}
        timeout = max(1, min(int(timeout_seconds or DEFAULT_COMMAND_SECONDS), MAX_COMMAND_SECONDS))
        with self._lock:
            try:
                handle, created = self._handle(session_id)
            except Exception:
                return {"ok": False, "error": "sandbox_unavailable"}
            written = self._written.setdefault(handle.sandbox_id, set())
            missing = {slug: files for slug, files in skills.items() if slug not in written}
        files: Dict[str, str] = {}
        if created:
            files[".sliderule/.scratch"] = "这是对话档的临时沙盒（services/scratch_sandbox）。\n"
        for slug, package in missing.items():
            files.update(skill_paths(slug, package))
        try:
            if files:
                self.provider.write_files(handle, files)
                written.update(missing)
            result = self.provider.run(handle, command, timeout_seconds=timeout)
        except Exception as exc:
            # 沙盒被回收了：下次重新找 / 起，别一直拿着死掉的那个。
            with self._lock:
                self._handles.pop(session_id, None)
                self._written.pop(handle.sandbox_id, None)
            code = str(getattr(exc, "code", "") or type(exc).__name__)
            return {"ok": False, "error": "sandbox_command_failed", "detail": code}
        try:
            self.provider.renew(handle, timeout_seconds=SANDBOX_TIMEOUT_SECONDS)
        except Exception:
            pass                                    # 续期失败不影响这一发的结果；下次找不到会重起
        stdout, cut_out = _clip(result.stdout)
        stderr, cut_err = _clip(result.stderr)
        return {"ok": result.exit_code == 0, "exitCode": result.exit_code, "stdout": stdout, "stderr": stderr,
                "command": command[:240], **({"outputTruncated": True} if cut_out or cut_err else {}),
                **({"sandboxStarted": True} if created else {})}


def read_project_file(provider: Any, project_id: str, path: str, *, max_bytes: int) -> bytes:
    """工程沙盒里的一份文件（工作区 id 是 ws-<projectId>，project_store 开租约时这么定的）。只读，没在跑就说没有。"""
    found = provider.find_workspaces(workspace_id="ws-" + str(project_id))
    if not found:
        raise FileNotFoundError(path)
    handle = provider.connect(found[0], timeout_seconds=SANDBOX_TIMEOUT_SECONDS)
    return provider.read_file_bytes(handle, path, max_bytes=max_bytes)
