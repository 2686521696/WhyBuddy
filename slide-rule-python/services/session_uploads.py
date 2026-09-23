"""用户带来的原件放进 Agent 真正执行的工作区。

抄 OpenHands `openhands/server/listen.py`（caa77cf）的
`sanitize_filename` + `copy_to(workspace_mount_path_in_sandbox)`：
只留文件名，原字节进工作区根，不另做一种解析。

他们上传时运行时已经在。这里的工程沙盒要等命令才有，所以字节先按
会话存着，执行器在 `write_files` 之后、命令开始之前再写入。

⚠ 2026-09-22 图片/PDF 只把抽出的文字塞进消息，Word 连字都没有，
  原件没进工程沙盒。这条不改那三种抽取。
"""
from __future__ import annotations

import os
import re

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_UPLOADS = 8
WORKSPACE_ROOT = "/home/user/workspace"


def sanitize_filename(filename: str) -> str:
    """Drop directory components. Keep unicode word characters, dot, dash, underscore."""
    filename = os.path.basename(str(filename or "").replace("\\", "/"))
    filename = re.sub(r"[^\w\-_\.]", "", filename)
    max_length = 255
    if len(filename) > max_length:
        name, ext = os.path.splitext(filename)
        filename = name[: max_length - len(ext)] + ext
    if filename in {"", ".", ".."}:
        return ""
    return filename


def upload_fact(paths: list[str]) -> str | None:
    """One fact for the control prompt. Not a parse recipe."""
    cleaned = [path for path in paths if path]
    if not cleaned:
        return None
    return (
        "用户上传的原件在工程沙盒工作区根目录，命令开始前已经放好：\n"
        + "\n".join(cleaned)
        + "\nfile_read 读不到这些二进制原件。要内容就在沙盒里打开这些路径。"
    )


def workspace_path(name: str) -> str:
    safe = sanitize_filename(name)
    if not safe:
        raise ValueError("upload_name_invalid")
    return f"{WORKSPACE_ROOT}/{safe}"
