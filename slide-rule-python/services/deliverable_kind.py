# -*- coding: utf-8 -*-
"""批准计划上的交付物类别。叶子：只吃计划字典，不读会话、不读工程库。

⚠ 2026-09-20 真机 sr-20260920051924-QA0YXX59Q0：用户要做 PPT，自由 Agent
  调了 project_create(react-vite-tasks)。host 提示词把 tasks 写成正经应用，
  完工闸只认任务清单 delivery.eligible，右栏 iframe 就出现「登录任务清单」。

  类别由模型写进 write_plan，host 只执行，不猜用户那句话像不像 PPT。
  缺省 web-app：存量网页会话行为不变。
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Any, Mapping

WEB_APP = "web-app"
OFFICE_FILE = "office-file"
DELIVERABLE_KINDS = frozenset({WEB_APP, OFFICE_FILE})
TASKS_TEMPLATE_ID = "react-vite-tasks"
WRONG_ARTIFACT = "project_template_wrong_artifact"
OFFICE_EXTENSIONS = frozenset({".pptx", ".docx", ".xlsx"})
OFFICE_ZIP_MAGIC = b"PK\x03\x04"
OFFICE_SKIP_DIRS = frozenset({"node_modules", ".venv", "__pycache__", ".git", "dist"})
OFFICE_FILE_NOT_TEXT = "project_office_file_not_text"
OFFICE_VERIFY_NOT_APPLICABLE = "office_file_verify_not_applicable"
OFFICE_START_NOT_APPLICABLE = "office_file_start_not_applicable"
#: 办公计划的源码树必须能过 build_manifest（空 dict 会 invalid_project_file_count）。
#: 只陈述事实，不写「先 pip / 必须先调」。
WORKSPACE_README = (
    "这是空工作区。源码树里没有 Vite。"
    "写文本用 file_write，跑命令用 bash。"
    "办公文件（.pptx / .docx / .xlsx）不进源码树。"
)


def normalize_deliverable_kind(raw: Any) -> str:
    text = str(raw or "").strip()
    return text if text in DELIVERABLE_KINDS else WEB_APP


def plan_deliverable_kind(plan: Any) -> str:
    if not isinstance(plan, Mapping):
        return WEB_APP
    return normalize_deliverable_kind(plan.get("deliverableKind"))


def is_office_file_plan(plan: Any) -> bool:
    return plan_deliverable_kind(plan) == OFFICE_FILE


def office_workspace_files() -> dict[str, str]:
    """办公计划的电脑：能写文件、能跑命令，不灌 Vite。"""
    return {"README.md": WORKSPACE_README}


def reject_tasks_template(kind: Any, template_id: Any) -> str | None:
    """办公文件禁止任务清单模板。返回错误码；放行则 None。"""
    if str(template_id or "").strip() != TASKS_TEMPLATE_ID:
        return None
    if normalize_deliverable_kind(kind) != OFFICE_FILE:
        return None
    return WRONG_ARTIFACT


def office_file_uses_task_delivery(kind: Any) -> bool:
    """办公文件的完工不得问任务应用 eligible。"""
    return normalize_deliverable_kind(kind) == OFFICE_FILE


def office_artifact_suffix(path: Any) -> str | None:
    name = str(path or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    for ext in OFFICE_EXTENSIONS:
        if name.endswith(ext):
            return ext
    return None


def is_office_artifact_path(path: Any) -> bool:
    return office_artifact_suffix(path) is not None


def is_office_zip_bytes(data: Any) -> bool:
    return isinstance(data, (bytes, bytearray)) and bytes(data[:4]) == OFFICE_ZIP_MAGIC


def office_preview_payload(data: bytes, path: Any) -> dict[str, Any] | None:
    """没 soffice 时的可读预览：抽幻灯片/文档正文。失败返回 None，不编绿灯。"""
    suffix = office_artifact_suffix(path)
    if suffix is None or not is_office_zip_bytes(data):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(bytes(data))) as archive:
            names = archive.namelist()
            if suffix == ".pptx":
                slides = []
                for name in sorted(
                    n for n in names
                    if n.startswith("ppt/slides/slide") and n.endswith(".xml")
                )[:40]:
                    xml = archive.read(name).decode("utf-8", "replace")
                    texts = [t for t in re.findall(r"<a:t[^>]*>([^<]*)</a:t>", xml) if t.strip()]
                    slides.append({"text": "\n".join(texts)})
                return {"kind": "slides", "slides": slides} if slides else None
            if suffix == ".docx" and "word/document.xml" in names:
                xml = archive.read("word/document.xml").decode("utf-8", "replace")
                texts = [t for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml) if t.strip()]
                return {"kind": "document", "text": "\n".join(texts)[:12000]} if texts else None
            if suffix == ".xlsx":
                sheets = [n for n in names if n.startswith("xl/worksheets/") and n.endswith(".xml")]
                return {"kind": "workbook", "sheetCount": len(sheets)} if sheets else None
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        return None
    return None
