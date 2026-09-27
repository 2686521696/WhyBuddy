"""只有 .pptx / .docx / .xlsx 会收回交付——在模型动手之前就告诉它。

⚠ 2026-09-27 隔离真机第 54 轮 sr-20260927161624-5NYX20NY9W（产品报价单 Word + 追问
  「再帮我导出一份 PDF 版本」）：沙盒没有 LibreOffice，模型改用 reportlab 生成 PDF，
  装库、换字体、装 pypdf 核验、再 base64 进日志，折腾 5 分钟，最后才说「文件收集器
  只收到了 Word 文件」。收集器从来只收三种格式（deliverable_kind.OFFICE_EXTENSIONS），
  这是事实，不是它能绕过的东西。

判据量的是模型实际拿到的工具说明（project_tool_definitions 渲染出来的那份），
而且那句话里的格式要跟收集器认的格式是同一份——收集器哪天多收一种，这里就该红。
"""

from __future__ import annotations

from services.deliverable_kind import OFFICE_EXTENSIONS
from services.project_tool_contracts import project_tool_definitions


def _create_description() -> str:
    for item in project_tool_definitions():
        fn = item.get("function", item)
        if fn.get("name") == "project_create":
            return str(fn.get("description") or "")
    raise AssertionError("project_create not offered")


def test_the_model_is_told_other_formats_never_reach_the_user():
    text = _create_description()
    assert "PDF" in text and "cannot be delivered" in text


def test_the_named_formats_are_exactly_what_the_collector_takes():
    """反向：说明里点名的格式跟收集器是同一份，不许说多或说少。"""
    text = _create_description()
    for ext in OFFICE_EXTENSIONS:
        assert ext in text
    assert OFFICE_EXTENSIONS == frozenset({".pptx", ".docx", ".xlsx"})
