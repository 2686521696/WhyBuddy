"""文字里的字面「\\n」要量出来：用户在预览里看到的是反斜杠加 n 夹在句子中间。

⚠ 2026-10-01 隔离真机第 179 轮（市场部预算执行 Excel，追问「再加一页给领导看的结论」）：「领导结论」页的管理建议
  「1. 重点复盘……等原因。\\n2. 对超预算月份……\\n3. ……」。模型收尾「领导结论页已确认存在」——它回读的是页在不在。

夹具是那一轮交付的文件原样。走真快照 → 真回执（§一之二）。把 office_facts 里 literalNewlines 那段删掉，前两条变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer, operation_snapshot

FIXTURE = Path(__file__).parent / "fixtures" / "round179_budget_literal_newline.xlsx"
NAME = "市场部2025年预算执行分析.xlsx"


def _rewrite(data: bytes, part: str, old: bytes, new: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename == part:
                assert old in body
                body = body.replace(old, new)
            dst.writestr(item, body)
    return out.getvalue()


def _doc(part: str, xml: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(part, xml)
    return out.getvalue()


def test_the_round179_leader_page_reports_its_literal_newline():
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    assert facts["literalNewlines"] == 1
    assert facts["literalNewlinesSamples"] == ["体采买和项目节奏等原因。\\n"]
    sentence = office_facts_sentence(NAME, facts)
    assert "字面的反斜杠加 n" in sentence and "wrap_text" in sentence


def test_the_sentence_reaches_the_receipt_through_the_snapshot():
    """接在链路上：worker 记下的 facts 过快照白名单、进回执（第 170 轮吃过「快照把举例扔了」的亏）。"""
    saved = {"exitCode": 0, "officeFiles": [NAME], "officeFacts": {NAME: office_facts(FIXTURE.read_bytes(), NAME)}}
    operation = SimpleNamespace(operationId="pop-1", kind="runtime.exec", status="completed",
                                expectedRevision="prv-1", cancelRequested=False, result=saved)
    hint = _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 3}), "ok")["hint"]
    assert "比如「体采买和项目节奏等原因。\\n」" in hint


def test_a_real_line_break_is_not_reported():
    """反向：同一份字节把字面 \\n 换成真换行——不报。"""
    fixed = _rewrite(FIXTURE.read_bytes(), "xl/sharedStrings.xml", "\\n".encode(), b"\n")
    facts = office_facts(fixed, NAME)
    assert facts["literalNewlines"] == 0 and "literalNewlinesSamples" not in facts
    assert "反斜杠加 n" not in office_facts_sentence(NAME, facts)


def test_a_windows_path_is_not_a_line_break():
    """反向：C:\\new folder 是路径，不是换行。"""
    doc = _doc("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>存放在 C:\\new folder 下</w:t></w:r></w:p></w:body></w:document>')
    assert office_facts(doc, "a.docx")["literalNewlines"] == 0


def test_word_and_powerpoint_text_are_measured_too():
    doc = _doc("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>第一条。\\n第二条。</w:t></w:r></w:p></w:body></w:document>")
    deck = _doc("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>要点一\\n要点二</a:t></a:r></a:p></p:sld>")
    assert office_facts(doc, "a.docx")["literalNewlines"] == 1
    assert office_facts(deck, "a.pptx")["literalNewlines"] == 1
