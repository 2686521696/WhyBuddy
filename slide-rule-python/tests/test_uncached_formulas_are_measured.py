"""xlsx 的实况要量「公式有没有算好的结果」：没有的话，界面上那些格子是空白。

⚠ 2026-09-30 隔离真机第 148 轮（家庭月度开支 Excel，追问「加一列同比增长率」「给汇总表加一个柱状图」）：
  openpyxl 写的 12 个 SUM 全是 <v></v>。Excel 打开会重算，可右栏预览（@silurus/ooxml 只读缓存结果）和
  结果卡缩略图里「总计」一整行空白、柱状图绑的也是空。模型说「合计均使用公式」没说错，用户看到的却是空。
  沙盒和生产镜像都没有 LibreOffice 可以替它重算——宿主能做的是把这件事量出来放进回执。

夹具 `fixtures/round148_household_budget_uncached.xlsx` 是那一轮交付的文件原样（sha256 1c2c…之外无改动）。
反向用同一份字节把 <v></v> 填上结果，只证明「算好了就不报」。把 office_facts 里 formulasUncached 那段删掉，
前两条变红。
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer

FIXTURE = Path(__file__).parent / "fixtures" / "round148_household_budget_uncached.xlsx"
NAME = "output/家庭月度开支.xlsx"


def test_the_round148_workbook_reports_its_empty_formula_results():
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    assert facts["formulas"] == 12 and facts["formulasUncached"] == 12
    sentence = office_facts_sentence(NAME, facts)
    assert "12 个没有算好的结果" in sentence and "空白" in sentence


def test_the_sentence_asks_for_a_fix_instead_of_excusing_it():
    """⚠ 第 149 轮：第一版这句带着「用户在 Excel 里打开会重算」，模型两轮都读到了、两轮都照旧收尾。
    盯语义：要求交付前补上、给出能带值写公式的做法；不许再出现替空白开脱的「打开会重算」。"""
    sentence = office_facts_sentence(NAME, office_facts(FIXTURE.read_bytes(), NAME))
    assert "交付前补上" in sentence and "write_formula" in sentence and "算好的值" in sentence
    assert "打开会重算" not in sentence


def test_the_sentence_reaches_the_command_receipt():
    """接在链路上：收回办公文件那张回执里，模型读得到这句（§三）。"""
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 scripts/build_budget.py"}, "ok")
    assert "没有算好的结果" in receipt["hint"]


def test_formulas_with_cached_results_are_not_reported():
    """反向：同一份字节把结果填上，只数公式、不挂那句提醒。"""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(FIXTURE.read_bytes())) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            body = src.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet"):
                body = re.sub(rb"<v></v>", b"<v>0</v>", body)
            dst.writestr(item, body)
    facts = office_facts(out.getvalue(), NAME)
    assert facts["formulas"] == 12 and facts["formulasUncached"] == 0
    assert "没有算好的结果" not in office_facts_sentence(NAME, facts)
