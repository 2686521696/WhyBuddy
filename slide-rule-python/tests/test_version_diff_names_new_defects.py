"""「和上一版比」要把这次改出来的毛病点名，别说成「一个都没变」。

⚠ 2026-10-07 真机 r55 sr-20261007062152-HKXEC83K48（报销 Excel 追问：只改两格说明，其他不要动）：模型 openpyxl
  load→改两格→save，汇总页 12 个公式的结果全丢。回执前半句「12 个没有算好的结果」，后半句「和上一版比：这些数一个都
  没变」（_FACT_NAMES 里没有 formulasUncached）。模型信了后半句，收尾「其他单元格、公式及格式均未变化」。

夹具是那个工程的两版原样：r51 交付的（12 个公式都带结果）和 r55 改完的（12 个都空）。
"""

from __future__ import annotations

from pathlib import Path

from services.deliverable_kind import office_facts
from services.project_tools import _DEFECT_FACTS, _FACT_NAMES, _facts_delta

FIXTURES = Path(__file__).parent / "fixtures"
BEFORE = office_facts((FIXTURES / "reimbursement_r51_cached.xlsx").read_bytes(), "output/报销记录整理.xlsx")
AFTER = office_facts((FIXTURES / "reimbursement_r55_resaved_uncached.xlsx").read_bytes(), "output/报销记录整理.xlsx")


def test_precondition_the_resave_really_lost_the_results():
    assert (BEFORE["formulas"], BEFORE["formulasUncached"]) == (12, 0)
    assert (AFTER["formulas"], AFTER["formulasUncached"]) == (12, 12)


def test_the_lost_results_are_named_as_made_by_this_edit():
    delta = _facts_delta(BEFORE, AFTER)
    assert "没有算好结果的公式 0→12" in delta and "这次改出来的" in delta
    assert "一个都没变" not in delta


def test_an_identical_version_still_says_nothing_changed():
    """反向：真没变就还是「一个都没变」；毛病变少不算「改出来的」。"""
    assert "一个都没变" in _facts_delta(BEFORE, BEFORE)
    fixed = _facts_delta(AFTER, BEFORE)
    assert "没有算好结果的公式 12→0" in fixed and "这次改出来的" not in fixed


def test_every_defect_kind_is_compared_at_all():
    """名单自己的前提：点名的毛病都在比较清单里，不然比都不比（这次就是漏了这一项）。"""
    assert _DEFECT_FACTS <= {key for key, _name in _FACT_NAMES}
