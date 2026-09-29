"""重新生成的办公文件，回执说清和上一版比哪些数变了——没多出来的东西不许说成新增。

⚠ 2026-09-29 隔离真机第 112 轮 sr-20260929090856-0GZ9EPV769（家庭年度收支 Excel，追问「加一张按月份的收支趋势折线图」）：
  看板里本来就有那张 LineChart。模型只把小标题「月度趋势」改成「按月份的收支趋势折线图」，收尾说
  「已加入按月份的收支趋势折线图」。回执写着原生图表 2 个——和上一版一样，但没人说「和上一版一样」。
  形状照真机：5 张工作表、2 个原生图表；第二版只改了文字。

判据走真 _RuntimeTask._collect_office_artifacts + 产物库 + 快照 + 回执那句话。
把 worker 里量旧版那段删掉，第一条变红。
"""

from __future__ import annotations

from types import SimpleNamespace

from services.project_tools import _command_pointer, operation_snapshot
from test_office_facts_reach_the_model import _collect, _zip  # noqa: F401  （夹具）

PATH = "output/家庭年度收支管理_2025.xlsx"


def _book(title: bytes, charts: int = 2) -> bytes:
    parts = {f"xl/worksheets/sheet{i}.xml": b"<w/>" for i in range(1, 6)}
    parts.update({f"xl/charts/chart{i}.xml": b"<c/>" for i in range(1, charts + 1)})
    parts["xl/sharedStrings.xml"] = title
    return _zip(parts)


def _hint(saved):
    operation = SimpleNamespace(operationId="pop-1", kind="runtime.exec", status="completed",
                                expectedRevision="prv-1", cancelRequested=False, result={"exitCode": 0, **saved})
    return _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 3}), "")["hint"]


def test_the_round112_retitled_chart_is_reported_as_unchanged(tmp_path, monkeypatch):
    _first, second = _collect(tmp_path, monkeypatch, [
        [{"path": PATH, "data": _book("月度趋势".encode())}],
        [{"path": PATH, "data": _book("按月份的收支趋势折线图".encode())}],
    ])
    assert second["officeFactsBefore"][PATH]["charts"] == 2 and second["officeFacts"][PATH]["charts"] == 2
    hint = _hint(second)
    assert "和上一版比" in hint and "一个都没变" in hint and "新增" in hint


def test_a_real_new_chart_is_reported_as_a_change(tmp_path, monkeypatch):
    """反向：真的多了一张图，说的是变化，不挂「别说成新增」。"""
    _first, second = _collect(tmp_path, monkeypatch, [
        [{"path": PATH, "data": _book(b"v1")}],
        [{"path": PATH, "data": _book(b"v2", charts=3)}],
    ])
    hint = _hint(second)
    assert "原生图表 2→3" in hint and "一个都没变" not in hint


def test_a_first_version_has_nothing_to_compare(tmp_path, monkeypatch):
    """反向：第一次收回没有上一版，不编一句对比。"""
    (first,) = _collect(tmp_path, monkeypatch, [[{"path": PATH, "data": _book(b"v1")}]])
    assert "officeFactsBefore" not in first
    assert "和上一版比" not in _hint(first)


# ⚠ 2026-09-29 隔离真机第 114 轮 sr-20260929095131-9A7P8RP51X（小区垃圾分类方案 Word，追问「在第二部分加一个按季度的进度表格」）：
#   脚本自带「已存在就换名」，新版写成 …_1.docx，旧的还在。路径照真机原样。
BASE = "output/小区垃圾分类推广工作方案.docx"
NUMBERED = "output/小区垃圾分类推广工作方案_1.docx"


def _doc(tables: int) -> bytes:
    return _zip({"word/document.xml": b"<w:body>" + b"<w:tbl></w:tbl>" * tables + b"</w:body>"})


def test_the_round114_numbered_copy_is_compared_with_the_original_and_named(tmp_path, monkeypatch):
    _first, second = _collect(tmp_path, monkeypatch, [
        [{"path": BASE, "data": _doc(7)}],
        [{"path": BASE, "data": _doc(7)}, {"path": NUMBERED, "data": _doc(8)}],
    ])
    assert second["officeSiblings"] == {NUMBERED: BASE}
    assert second["officeFactsBefore"][NUMBERED]["tables"] == 7
    hint = _hint(second)
    assert "原生表格 7→8" in hint and "两份" in hint and BASE in hint


def test_two_unrelated_files_are_not_siblings(tmp_path, monkeypatch):
    """反向：不是「同名加编号」的两份文件，各算各的，不挂那句。"""
    _first, second = _collect(tmp_path, monkeypatch, [
        [{"path": "output/方案.docx", "data": _doc(1)}],
        [{"path": "output/预算表.docx", "data": _doc(2)}],
    ])
    assert "officeSiblings" not in second
    assert "两份" not in _hint(second)
