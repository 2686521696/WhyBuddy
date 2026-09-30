"""Word 的实况要量「列表段落带着自动符号、正文又手写了编号」：用户看到的是「• 1.」两个记号。

⚠ 2026-09-30 隔离真机第 151 轮（门店运营报告 Word，追问「把最后的结论部分改成三条要点」）：
  模型用 python-docx 的 List Bullet 样式写三条要点，正文又写「1. 旗舰店稳规模…」。右栏预览第 4 页
  每条都是「• 1.」。模型的收尾说「3 条要点分别为 19、19、20 个字」——它只量了字数。
  自动圆点挂在样式上（styles.xml 里的 w:numPr），段落里看不出来，所以要连样式一起查。

夹具 `fixtures/round151_store_report_double_markers.docx` 是那一轮交付的文件原样。它里面另有 4 段
「1. 门店经营表现不均衡」是普通段落手写编号——正常写法，不许算进去：答案是 3，不是 7。
把 _docx_double_marked 里「样式带 numPr」那一支删掉，第一条变红（三段都是靠样式挂的圆点）。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer

FIXTURE = Path(__file__).parent / "fixtures" / "round151_store_report_double_markers.docx"
NAME = "output/2026年第三季度门店运营分析报告.docx"


def _rewrite(data: bytes, old: bytes, new: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename == "word/document.xml":
                assert old in body
                body = body.replace(old, new)
            dst.writestr(item, body)
    return out.getvalue()


def test_the_round151_report_counts_its_three_doubled_bullets():
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    assert facts["listDoubleMarked"] == 3
    sentence = office_facts_sentence(NAME, facts)
    assert "3 段列表" in sentence and "「• 1.」" in sentence and "交付前" in sentence


def test_the_sentence_reaches_the_command_receipt():
    """接在链路上：收回这份 Word 的那张回执里，模型读得到这句（§三）。"""
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 generate_report.py"}, "ok")
    assert "正文又手写了" in receipt["hint"]


def test_bullets_without_typed_numbers_are_not_reported():
    """反向：同一份字节把手写的「1. 」去掉，列表照旧挂圆点——不报。"""
    data = FIXTURE.read_bytes()
    for n in (b"1", b"2", b"3"):
        data = _rewrite(data, b">" + n + b". ", b">")
    facts = office_facts(data, NAME)
    assert facts["listDoubleMarked"] == 0
    assert "正文又手写了" not in office_facts_sentence(NAME, facts)


def test_a_list_item_that_starts_with_a_decimal_is_not_a_typed_marker():
    """反向：列表项正文以「1.5 万」这种小数开头，不是手写编号。"""
    data = _rewrite(FIXTURE.read_bytes(), b">1. ", b">1.5 ")
    assert office_facts(data, NAME)["listDoubleMarked"] == 2
