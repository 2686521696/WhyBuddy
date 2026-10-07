"""xlsx 存进去的公式结果，要和按公式重算的对得上：右栏预览和缩略图照着存的数画。

⚠ 2026-09-30 隔离真机第 155 轮（小型工作室年度预算 Excel）：第 148 轮之后回执教模型「XlsxWriter
  write_formula 连同算好的值一起写」，于是空白变成了错数——月度明细 M4 写 SUM(E4:L4)，存的却是
  41,900（真算是 23,900），净利润一列全成了亏损；季度汇总按 4 个月切季度，Q4 落到年度合计行、存 0。
  预览里用户看到的是一份「月月亏钱」的预算。模型的校验只数了公式个数。

夹具：
  round155_studio_budget_wrong_cached_results.xlsx —— 那一轮交付的原样（54 处对不上）
  round150_sales_ranking_cached_results.xlsx       —— 第 150 轮 XlsxWriter 写对了的原样（反向：0 处）
  round148_household_budget_uncached.xlsx          —— openpyxl 没存结果的（反向：没有结果不算「错」，那归 formulasUncached）

把比较那一行删掉，第一条变红；把「不认识的函数就跳过」那道拦截删掉，最后一条变红（PRODUCT 被当成别的函数算）。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from services.deliverable_kind import _xlsx_cached_results_that_disagree, office_facts, office_facts_sentence
from services.project_tools import _command_pointer

FIXTURES = Path(__file__).parent / "fixtures"
WRONG = FIXTURES / "round155_studio_budget_wrong_cached_results.xlsx"
NAME = "output/小型工作室年度预算_2025.xlsx"

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _cell(ref, value=None, formula=None):
    f = f"<f>{formula}</f>" if formula is not None else ""
    v = f"<v>{value}</v>" if value is not None else ""
    return f'<c r="{ref}">{f}{v}</c>'


def _book(**sheets):
    """_book(明细=[cells...], 汇总=[cells...])：最小可解析的 xlsx。"""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        entries = "".join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>'
                          for i, name in enumerate(sheets, 1))
        z.writestr("xl/workbook.xml", f'<workbook xmlns="{NS}" xmlns:r="{R}"><sheets>{entries}</sheets></workbook>')
        rels = "".join(f'<Relationship Id="rId{i}" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
        z.writestr("xl/_rels/workbook.xml.rels", f"<Relationships>{rels}</Relationships>")
        for i, cells in enumerate(sheets.values(), 1):
            z.writestr(f"xl/worksheets/sheet{i}.xml",
                       f'<worksheet xmlns="{NS}"><sheetData><row r="1">{"".join(cells)}</row></sheetData></worksheet>')
    return out.getvalue()


def test_the_round155_workbook_reports_its_wrong_results():
    facts = office_facts(WRONG.read_bytes(), NAME)
    assert facts["formulas"] == 104 and facts["formulasUncached"] == 0
    assert facts["formulasWrong"] == 54
    assert facts["formulasWrongSamples"][0] == "月度明细!M4 存的是 41,900，按公式 SUM(E4:L4) 算是 23,900"
    sentence = office_facts_sentence(NAME, facts)
    assert "54 个存的结果和按公式算出来的对不上" in sentence and "交付前核对" in sentence


def test_the_quarter_that_landed_on_the_total_row_is_caught():
    """Q4 = SUM('月度明细'!D16:D19)，存的 0；第 16 行是年度合计，Excel 一重算 Q4 就等于全年。"""
    with zipfile.ZipFile(WRONG) as archive:
        wrong = _xlsx_cached_results_that_disagree(archive, archive.namelist())
    assert any(item.startswith("季度汇总!B7 存的是 0，按公式 SUM('月度明细'!D16:D19)") for item in wrong)


def test_the_sentence_reaches_the_command_receipt():
    """接在链路上：收回这份 Excel 的回执里，模型读得到这句（§三）。"""
    facts = office_facts(WRONG.read_bytes(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 scripts/create_budget.py"}, "ok")
    assert "对不上" in receipt["hint"]


def test_a_workbook_written_right_reports_nothing():
    """反向（真文件）：第 150 轮 XlsxWriter 带值写的 18 个公式（SUM / AVERAGE / RANK.EQ）全对得上。"""
    facts = office_facts((FIXTURES / "round150_sales_ranking_cached_results.xlsx").read_bytes(), "a.xlsx")
    assert facts["formulas"] == 18 and facts["formulasWrong"] == 0
    assert "对不上" not in office_facts_sentence("a.xlsx", facts)


def test_missing_results_are_not_called_wrong():
    """反向（真文件）：openpyxl 没存结果，那是「没算好」，不是「算错」。"""
    facts = office_facts((FIXTURES / "round148_household_budget_uncached.xlsx").read_bytes(), "a.xlsx")
    assert facts["formulasUncached"] == 12 and facts["formulasWrong"] == 0


def test_cross_sheet_quoted_references_are_followed():
    book = _book(**{"月度 明细": [_cell("A1", 5), _cell("B1", 7)],
                    "汇总": [_cell("A1", 12, "SUM('月度 明细'!A1:B1)"), _cell("B1", 99, "A1*2")]})
    facts = office_facts(book, "a.xlsx")
    assert facts["formulasWrong"] == 1                                    # B1 该是 24，存了 99
    assert facts["formulasWrongSamples"] == ["汇总!B1 存的是 99，按公式 A1*2 算是 24"]


def test_formulas_it_cannot_read_are_skipped_not_guessed():
    """反向：不认识的函数、引用了文字、循环引用——一律不报（fail-open）。"""
    # PRODUCT 的参数都读得懂，只有函数名不认识——它存的 42 不许拿别的函数的算法去比
    book = _book(表=[_cell("A1", 3), _cell("B1", 42, "VLOOKUP(A1,C1:D9,2,FALSE)"),
                    _cell("C1", 1, "C1+1"), _cell("D1", 7, "B1+1"), _cell("E1", 42, "PRODUCT(A1,2)")])
    facts = office_facts(book, "a.xlsx")
    assert facts["formulas"] == 4 and facts["formulasWrong"] == 0


# —— 条件统计（2026-10-06 真机 r49 sr-20261007053537-V9SZN2TTQ8，@office-skills 报销记录 Excel）——
# 夹具 reimbursement_r49.xlsx 是那一轮交付的原样：部门汇总「市场部 记录数」=COUNTIF(...) 存 2、实为 3，合计存 5、实为 6；
# 右栏预览画 2，Excel 一重算 3。当时这一道只认 SUM 那一撮、文字一律收成 "text"，COUNTIF 量不了就不报。
R49 = FIXTURES / "reimbursement_r49.xlsx"


def test_the_round_r49_workbook_reports_its_wrong_counts():
    facts = office_facts(R49.read_bytes(), "output/报销记录整理.xlsx")
    assert facts["formulasWrong"] == 2
    assert facts["formulasWrongSamples"] == [
        "02-部门汇总!B2 存的是 2，按公式 COUNTIF('01-报销明细'!$E$2:$E$7,A2) 算是 3",
        "02-部门汇总!B5 存的是 5，按公式 SUM(B2:B4) 算是 6",
    ]


def test_the_r49_sums_that_agree_are_not_reported():
    """反向（同一份真文件）：SUMIF 那一列 4,960 / 356.5 / 89 跟按公式算的一致——数得出来也不许乱报。"""
    with zipfile.ZipFile(R49) as archive:
        wrong = _xlsx_cached_results_that_disagree(archive, archive.namelist())
    assert not any("!C" in item for item in wrong)


def test_conditional_counts_read_text_cells_and_comparison_criteria():
    s = ('<c r="A{r}" t="inlineStr"><is><t>{dept}</t></is></c><c r="B{r}"><v>{amt}</v></c>')
    rows = [("市场部", 1280), ("研发部", 356.5), ("市场部", 2400), ("行政部", 89)]
    book = _book(明细=[s.format(r=i, dept=d, amt=a) for i, (d, a) in enumerate(rows, 1)],
                 汇总=[_cell("A1", 9, 'COUNTIF(明细!A1:A4,"市场部")'),                 # 实为 2
                      _cell("B1", 3680, 'SUMIF(明细!A1:A4,"市场部",明细!B1:B4)'),       # 对
                      _cell("C1", 1, 'COUNTIFS(明细!A1:A4,"&lt;&gt;市场部",明细!B1:B4,"&gt;100")'),  # XML 里转义，同真文件  # 对（研发部 356.5）
                      _cell("D1", 4, "COUNTA(明细!A1:A4)")])                           # 对
    facts = office_facts(book, "a.xlsx")
    assert facts["formulasWrongSamples"] == ['汇总!A1 存的是 9，按公式 COUNTIF(明细!A1:A4,"市场部") 算是 2']


def test_wildcard_criteria_and_text_in_arithmetic_are_skipped():
    """反向：通配符条件、文字参与四则运算——量不准，不报（fail-open）。"""
    s = '<c r="A1" t="inlineStr"><is><t>市场部</t></is></c>'
    book = _book(明细=[s], 汇总=[_cell("A1", 7, 'COUNTIF(明细!A1:A1,"市场*")'), _cell("B1", 7, "明细!A1+1")])
    assert office_facts(book, "a.xlsx")["formulasWrong"] == 0
