"""xlsx 的实况要量数据透视表：公式汇总不是透视表。

⚠ 2026-09-27 隔离真机第 66 轮 sr-20260927192856-9BNQR8C0SD（客户应收账款 Excel，追问
  「再加一个按月份汇总的透视表工作表，并给逾期未付款的行标红」）：openpyxl 写不出
  数据透视表，模型用 SUMIFS 做了一张「按月汇总」，收尾一句没提它不是透视表。回执里的
  文件实况是「工作表 4 张，原生图表 1 个，图片 0 张」——透视表那半句没有任何数撑着。

夹具 `fixtures/round66_receivables_formula_summary.xlsx` 是那一轮交付的文件原样
（sha256 26e4fceb…）。反向用同一份字节加一个 pivotTable 部件，只证明「真有就数得到」。
把 office_facts 里 pivotTables 那一行删掉，前两条变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer

FIXTURE = Path(__file__).parent / "fixtures" / "round66_receivables_formula_summary.xlsx"
NAME = "客户应收账款跟踪.xlsx"


def _real():
    return FIXTURE.read_bytes()


def test_the_round66_workbook_has_no_pivot_table_and_the_sentence_says_so():
    facts = office_facts(_real(), NAME)
    assert facts["pivotTables"] == 0 and facts["sheets"] == 4 and facts["charts"] == 1
    sentence = office_facts_sentence(NAME, facts)
    assert "数据透视表 0 个" in sentence
    assert "不是透视表" in sentence


def test_the_count_reaches_the_command_receipt():
    """接在链路上：收回办公文件那张回执里，模型读得到这句（§三）。"""
    facts = office_facts(_real(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 build_workbook.py"},
                               "ok")
    assert "数据透视表 0 个" in receipt["hint"]


def test_a_real_pivot_table_is_counted_without_the_warning():
    """反向：真有透视表部件就数到，不许再挂「不是透视表」。"""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(_real())) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            dst.writestr(item, src.read(item.filename))
        dst.writestr("xl/pivotTables/pivotTable1.xml", b"<pivotTableDefinition/>")
        dst.writestr("xl/pivotCache/pivotCacheDefinition1.xml", b"<pivotCacheDefinition/>")
    facts = office_facts(out.getvalue(), NAME)
    assert facts["pivotTables"] == 1
    sentence = office_facts_sentence(NAME, facts)
    assert "数据透视表 1 个" in sentence and "不是透视表" not in sentence


def test_pptx_and_docx_do_not_talk_about_pivot_tables():
    """反向：透视表只是 Excel 的事，别的格式不挂这一句。"""
    for name, facts in (("a.pptx", {"slides": 3, "charts": 1, "pictures": 0, "tables": 1}),
                        ("c.docx", {"tables": 2, "charts": 0, "pictures": 0})):
        assert "透视表" not in office_facts_sentence(name, facts)
