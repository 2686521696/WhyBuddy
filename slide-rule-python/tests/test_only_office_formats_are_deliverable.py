"""只有收集器认的格式会收回交付——在模型动手之前就告诉它。

⚠ 2026-09-27 隔离真机第 54 轮 sr-20260927161624-5NYX20NY9W（产品报价单 Word + 追问
  「再帮我导出一份 PDF 版本」）：沙盒没有 LibreOffice，模型改用 reportlab 生成 PDF，
  装库、换字体、装 pypdf 核验、再 base64 进日志，折腾 5 分钟，最后才说「文件收集器
  只收到了 Word 文件」。收集器从来只收三种格式（deliverable_kind.OFFICE_EXTENSIONS），
  这是事实，不是它能绕过的东西。

判据量的是模型实际拿到的工具说明（project_tool_definitions 渲染出来的那份），
而且那句话里的格式要跟收集器认的格式是同一份——收集器哪天多收一种，这里就该红。

⚠ 2026-10-05 真机 sr-20261005020827-S5QKFNYMDQ（@doc-coauthoring 周会制度，用户点名要 Markdown）：收集器多收了
  .md / .txt / .csv（deliverable_kind.TEXT_DELIVERABLE_EXTENSIONS），这条说明还写着「只有三种、CSV 交不出去」。
  模型照说明判断写不了文件，把整篇正文贴进对话里两遍，说「当前工作区没有可用的文件写入工具」。
  这正是本文件当初要挡的那种不同步——上一版只盯了 OFFICE_EXTENSIONS，文本那一半没被盯住。
"""

from __future__ import annotations

from services.deliverable_kind import DELIVERABLE_EXTENSIONS, OFFICE_EXTENSIONS
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
    for ext in DELIVERABLE_EXTENSIONS:
        assert ext in text
    assert OFFICE_EXTENSIONS == frozenset({".pptx", ".docx", ".xlsx"})
    # 「交不出去」那半句里不许点名收集器其实会收的格式（上一版写着 CSV）
    refused = text[text.index("cannot be delivered") - 120: text.index("cannot be delivered")]
    for ext in DELIVERABLE_EXTENSIONS:
        assert ext.lstrip(".").upper() not in refused.upper().replace("PDF", "")
