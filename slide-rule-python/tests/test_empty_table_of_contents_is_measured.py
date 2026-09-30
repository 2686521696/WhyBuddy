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
    assert "「目录」下面是空的" in sentence and "add_paragraph" in sentence


def test_the_sentence_reaches_the_command_receipt():
    """接在链路上：收回这份 Word 的回执里，模型读得到这句（§三）。"""
    facts = office_facts(EMPTY.read_bytes(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 generate_manual.py"}, "ok")
    assert "「目录」下面是空的" in receipt["hint"]


def test_a_toc_with_entries_is_not_reported():
    """反向：同一份字节按回执的补法写进条目——不报。"""
    facts = office_facts(_filled(), NAME)
    assert facts["tocEmpty"] == 0
    assert "「目录」下面" not in office_facts_sentence(NAME, facts)


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


def test_entries_written_backwards_on_one_line_are_reported():
    """⚠ 第 164 轮（智能门锁说明书）：条目写在域 end 之后、同一段里、对同一个位置反复插——预览先是 40 行空白，
    页底一行挤着「5.8 … 5.1 第5章 … 第1章」倒着来。第二版只看 TOC 样式，报成「空」；用户看到的是倒序一行。"""
    facts = office_facts((FIXTURES / "round164_lock_manual_toc_reversed.docx").read_bytes(), "a.docx")
    assert facts["tocEmpty"] == 0 and facts["tocDisordered"] == 1
    sentence = office_facts_sentence("a.docx", facts)
    assert "顺序对不上" in sentence and "insert_paragraph_before" in sentence


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _doc(*paras):
    """最小 Word：paras 是 (样式, 文字)。"""
    def ppr(style):
        return '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' if style else ""
    body = "".join(f"<w:p>{ppr(style)}<w:r><w:t>{text}</w:t></w:r></w:p>" for style, text in paras)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')
    return out.getvalue()


CHAPTERS = ["第1章 产品介绍", "第2章 安装准备", "第3章 日常使用"]


def test_a_plain_toc_in_order_is_fine():
    """反向：回执推荐的最稳写法——不用域，「目录」下按顺序一条一段。"""
    doc = _doc(("", "目录"), *[("", c) for c in CHAPTERS], *[("Heading1", c) for c in CHAPTERS])
    facts = office_facts(doc, "a.docx")
    assert facts["tocEmpty"] == 0 and facts["tocDisordered"] == 0


def test_the_same_entries_reversed_or_in_one_paragraph_are_disordered():
    reversed_doc = _doc(("", "目录"), *[("", c) for c in reversed(CHAPTERS)], *[("Heading1", c) for c in CHAPTERS])
    one_line = _doc(("", "目录"), ("", "".join(CHAPTERS)), *[("Heading1", c) for c in CHAPTERS])
    assert office_facts(reversed_doc, "a.docx")["tocDisordered"] == 1
    assert office_facts(one_line, "a.docx")["tocDisordered"] == 1


def test_no_chapter_headings_means_no_opinion():
    """反向：正文没有章节标题样式，量不出「目录该列什么」，不下结论（fail-open）。"""
    doc = _doc(("", "目录"), ("", "随便一段"), ("", "正文"))
    facts = office_facts(doc, "a.docx")
    assert facts["tocEmpty"] == 0 and facts["tocDisordered"] == 0
