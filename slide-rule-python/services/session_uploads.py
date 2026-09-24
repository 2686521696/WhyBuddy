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

import hashlib
import os
import re
from pathlib import Path

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_UPLOADS = 8
WORKSPACE_ROOT = "/home/user/workspace"


def upload_blob_dir() -> Path:
    """原件落在磁盘，不进 SQL 正文。

    ⚠ 2026-09-24 sr-20260924130205：2.1MB 的 PNG 整段 base64 走
    db-api，5.8s 后 503 project_runtime_unavailable，表里零行。
    网关正文上限 4MB，语句超时 8s。SQL 只留 blob:<sha256>。
    """
    raw = (os.environ.get("SESSION_UPLOAD_ROOT") or "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent.parent / "data" / "session-uploads"


def _safe_session_dir(session_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", str(session_id or ""))
    if not cleaned or cleaned in {".", ".."}:
        raise ValueError("upload_name_invalid")
    return cleaned


def store_upload_bytes(session_id: str, data: bytes) -> str:
    """写入原件，返回放进 SQL content 列的短指针。"""
    digest = hashlib.sha256(data).hexdigest()
    path = upload_blob_dir() / _safe_session_dir(session_id) / digest
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"blob:{digest}"


def load_upload_bytes(session_id: str, stored: str) -> bytes:
    """blob: 指针读磁盘。旧行仍是 base64，继续能读。"""
    text = str(stored or "")
    if text.startswith("blob:"):
        digest = text[5:]
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("session_upload_corrupt")
        path = upload_blob_dir() / _safe_session_dir(session_id) / digest
        if not path.is_file():
            raise FileNotFoundError(digest)
        return path.read_bytes()
    import base64
    return base64.b64decode(text, validate=True)


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


_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
}


def upload_media_type(name: str) -> str:
    """浏览器回看原件用。图片要能进 <img>，不能一律当附件下载。"""
    ext = os.path.splitext(str(name or ""))[1].lower()
    return _MEDIA_TYPES.get(ext, "application/octet-stream")


def workspace_path(name: str) -> str:
    safe = sanitize_filename(name)
    if not safe:
        raise ValueError("upload_name_invalid")
    return f"{WORKSPACE_ROOT}/{safe}"
