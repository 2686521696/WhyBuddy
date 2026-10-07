# -*- coding: utf-8 -*-
"""完整技能包：zip 开箱、防 zip-slip、必须有 SKILL.md。

叶子：只吃字节，不 import services 里其它模块。
OSS / 表 / 沙盒写入留在调用方。
"""

from __future__ import annotations

import io
import zipfile
from typing import Iterable

MAX_PACKAGE_BYTES = 8 * 1024 * 1024
MAX_PACKAGE_FILES = 200
MAX_FILE_BYTES = 512 * 1024
SKILL_MD = "skill.md"



def _entries(blob: bytes) -> tuple[dict[str, bytes], str]:
    """zip 里的全部文件（防 zip-slip、过上限）与技能根前缀。开箱和取「给人看的文件」共用这一份读法。"""
    if not isinstance(blob, (bytes, bytearray)) or not blob:
        raise ValueError("skill_package_empty")
    if len(blob) > MAX_PACKAGE_BYTES:
        raise ValueError("skill_package_too_large")
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise ValueError("skill_package_not_zip") from exc
    raw: dict[str, bytes] = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = _safe_zip_name(info.filename)
        if name is None:
            continue
        if info.file_size > MAX_FILE_BYTES:
            raise ValueError("skill_package_file_too_large")
        data = archive.read(info)
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("skill_package_file_too_large")
        raw[name] = data
        if len(raw) > MAX_PACKAGE_FILES:
            raise ValueError("skill_package_too_many_files")
    if not raw:
        raise ValueError("skill_package_empty")
    return raw, _skill_root_prefix(raw)


def unpack_skill_zip(blob: bytes) -> dict[str, str]:
    """解开完整包。路径相对技能根（含 SKILL.md 的那一层）。

    二进制略过。没有 SKILL.md、路径逃逸、超上限 → ValueError。
    """
    raw, prefix = _entries(blob)
    files: dict[str, str] = {}
    for name, data in raw.items():
        rel = name[len(prefix):] if prefix and name.startswith(prefix) else name
        if not rel or rel.endswith("/"):
            continue
        if not _looks_text(rel, data):
            continue
        files[rel.replace("\\", "/")] = data.decode("utf-8")
    if not any(path.lower() == SKILL_MD or path.lower().endswith("/" + SKILL_MD) for path in files):
        raise ValueError("skill_package_missing_skill_md")
    # 根上必须能直接读到 SKILL.md（前缀剥完之后）。
    if SKILL_MD not in {path.lower() for path in files}:
        raise ValueError("skill_package_missing_skill_md")
    return {path: text for path, text in files.items()}


def skill_md_text(files: dict[str, str]) -> str:
    for path, text in files.items():
        if path.replace("\\", "/").lower() == SKILL_MD:
            return text
    raise ValueError("skill_package_missing_skill_md")


def _safe_zip_name(filename: str) -> str | None:
    name = (filename or "").replace("\\", "/")
    if name.startswith("/") or name.startswith("../") or "/../" in name or name == "..":
        raise ValueError("skill_package_zip_slip")
    if name.startswith("__MACOSX/") or name.endswith(".ds_store"):
        return None
    parts = [p for p in name.split("/") if p and p not in (".",)]
    if not parts or any(p == ".." for p in parts):
        raise ValueError("skill_package_zip_slip")
    return "/".join(parts)


def _skill_root_prefix(names: Iterable[str]) -> str:
    """zip 常包一层目录 `sliderule/SKILL.md`。剥到 SKILL.md 所在目录。"""
    skill_paths = [
        name for name in names if name.lower() == SKILL_MD or name.lower().endswith("/" + SKILL_MD)
    ]
    if not skill_paths:
        return ""
    skill_paths.sort(key=len)
    chosen = skill_paths[0]
    if "/" not in chosen:
        return ""
    return chosen.rsplit("/", 1)[0] + "/"


def _looks_text(path: str, data: bytes) -> bool:
    """没有 NUL、能按 UTF-8 解开，就是文本——不看后缀。

    ⚠ 2026-09-28 隔离真机第 79 轮 sr-20260928012108-PZDWPXT0K9（office-skills，追问「用 office-skills 自带的校验
      脚本再检查一遍」）：技能文件终于进了沙盒，模型找到 scripts/office/validate.py 去跑，
      失败在「缺 schemas/ecma/fouth-edition/opc-relationships.xsd」。office-skills.zip
      100 个文件只解出 60 个——39 个 .xsd 全被这里丢了：它们是 UTF-8 的 XML，可后缀不在
      白名单、也不在末尾那几个里。上一版还有反面的坑：后缀在白名单就不验 UTF-8，一份
      latin-1 的 .txt 会让下面 decode 抛错、整包开不出来。
    二进制（字体、图片）仍然跳过：沙盒写入走文本。
    """
    if b"\x00" in data:
        return False
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


#: 包里「给人看」的非文本文件：后缀 → 媒体类型。只放浏览器能安全内联打开的；别的二进制（字体等）照旧不出包。
ASSET_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}


def asset_type(path: str) -> str | None:
    name = str(path or "").lower()
    return next((ctype for suffix, ctype in ASSET_TYPES.items() if name.endswith(suffix)), None)


def package_assets(blob: bytes) -> dict[str, bytes]:
    """包里的 PDF / 图片（相对技能根）。文本走 unpack_skill_zip；这里只收文本那边跳过、又能给人看的。

    ⚠ 2026-10-07 真机 r65 sr-20261007093401-3HHZ9TCNXZ（@theme-factory 年会邀请函挑主题）：技能第 1 步「把
      theme-showcase.pdf 给用户看，让他挑」。开箱只收文本，这份 PDF 在平台上根本不存在——模型没东西可给，
      就凭主题名字给用户描述了一套「香槟金、暖琥珀、深墨黑、衬线标题」，而 themes/golden-hour.md 写的是
      芥末黄 #f4a900、赤陶、暖米、巧克力棕、FreeSans 无衬线。用户会照着一份编出来的描述去确认。
    """
    raw, prefix = _entries(blob)
    out: dict[str, bytes] = {}
    for name, data in raw.items():
        rel = name[len(prefix):] if prefix and name.startswith(prefix) else name
        if rel and asset_type(rel) and not _looks_text(rel, data):
            out[rel] = data
    return out
