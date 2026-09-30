"""Word 的实况要量「目录域里一条条目都没有」：用户在预览里看到的是「目录」下面一片空白。

⚠ 2026-09-30 隔离真机第 162 轮（咖啡店店员培训手册）：「目录」标题下面是一个 TOC 域，域结果只有一句
  「右键单击此处并选择“更新域”」（还写进了 fldChar 里面，渲染器一个字都不画）。右栏预览、结果卡缩略图
  的第 2 页「目录」下面直接是页脚。隔离库 61 份 Word 里 17 份有目录域，17 份全是空的。

回执里给的补法（章节标题作为 TOC1 段落写进域的 separate 与 end 之间）先拿 @silurus/ooxml 0.88 的无头
渲染核过：原样第 2 页文字是「目录|内部培训资料…」，补过的是「目录|第一章 品牌介绍|第二章 岗位职责|…」。
反向判据用的就是那份补法（在夹具字节上原样做同一个替换）。

把 office_facts 里 tocEmpty 那行删掉，第一条变红；把「有条目就不算空」那半句删掉，补过那条变红。
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer

FIXTURES = Path(__file__).parent / "fixtures"
EMPTY = FIXTURES / "round162_coffee_handbook_empty_toc.docx"
NAME = "output/栖木咖啡店员培训手册.docx"
HEADS = ["第一章 品牌介绍", "第二章 岗位职责", "第三章 新人导师制度", "第四章 出品标准"]


def _filled() -> bytes:
    """回执建议的补法：章节标题作为 TOC1 段落写进域结果（已用无头渲染核过看得见）。"""
    with zipfile.ZipFile(EMPTY) as src:
        body = src.read("word/document.xml").decode()
        field = re.search(r'<w:p><w:r><w:fldChar w:fldCharType="begin"/>.*?<w:fldChar w:fldCharType="end"/></w:r></w:p>',
                          body, re.S).group(0)
        toc = ('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u '
               '</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>')
        end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
        paras = [f'<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>{toc if i == 0 else ""}<w:r><w:t>{h}</w:t></w:r>'
                 f'{end if i == len(HEADS) - 1 else ""}</w:p>'
                 for i, h in enumerate(HEADS)]
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as dst:
            for item in src.infolist():
                data = src.read(item.filename)
                if item.filename == "word/document.xml":
                    data = body.replace(field, "".join(paras), 1).encode()
                dst.writestr(item, data)
    return out.getvalue()


def test_the_round162_handbook_reports_its_empty_toc():
    facts = office_facts(EMPTY.read_bytes(), NAME)
    assert facts["tocEmpty"] == 1
    sentence = office_facts_sentence(NAME, facts)
    assert "「目录」下面是空的" in sentence and "TOC1" in sentence and "交付前" in sentence


def test_the_sentence_reaches_the_command_receipt():
    """接在链路上：收回这份 Word 的回执里，模型读得到这句（§三）。"""
    facts = office_facts(EMPTY.read_bytes(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 generate_manual.py"}, "ok")
    assert "目录是一个还没生成条目的 Word 域" in receipt["hint"]


def test_a_toc_with_entries_is_not_reported():
    """反向：同一份字节按回执的补法写进条目——不报。"""
    facts = office_facts(_filled(), NAME)
    assert facts["tocEmpty"] == 0
    assert "目录是一个" not in office_facts_sentence(NAME, facts)


def test_a_document_without_a_toc_is_not_reported():
    """反向（真文件）：没有目录域的 Word（第 151 轮门店报告）不报。"""
    facts = office_facts((FIXTURES / "round151_store_report_double_markers.docx").read_bytes(), "a.docx")
    assert facts["tocEmpty"] == 0


def test_entries_stuffed_inside_the_fldchar_do_not_count():
    """⚠ 第 163 轮（扫地机器人说明书）：模型照回执补了 TOC1/TOC2 段落，却整段塞进了
    <w:fldChar w:fldCharType="separate">…</w:fldChar> 里面。无头渲染第 2 页：「目录|提示：……更新域……|第 2 页」，
    一条条目都没画。第一版只数 TOC 样式段落在不在，这份报成了「不空」。"""
    stuffed = FIXTURES / "round163_manual_toc_inside_fldchar.docx"
    with zipfile.ZipFile(stuffed) as archive:
        assert b'<w:pStyle w:val="TOC1"/>' in archive.read("word/document.xml")    # 条目确实写了
    facts = office_facts(stuffed.read_bytes(), "output/智能扫地机器人产品使用说明书.docx")
    assert facts["tocEmpty"] == 1
    assert "是空元素" in office_facts_sentence("a.docx", facts)                    # 回执点名这个错法
