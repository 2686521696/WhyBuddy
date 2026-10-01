"""图表里被同轴大数压成平线的系列要量出来：用户看到的是一条贴着 0 的线。

⚠ 2026-10-01 隔离真机第 180 轮（门店月度复盘 PPT）：第 4 页组合图，客流 2350～2760、转化率 17.8～19.5 同一根数值轴，
  转化率画成贴底的平线；模型在图下补注「转化率与客流共用主坐标轴，重点读趋势变化」。

夹具是那一轮交付的原样文件。阈值（同轴最大值的 2%）在隔离库 111 份真机交付（30 份带图表）上标定：只报这一份。
把 office_facts 里 chartSeriesFlat 那段删掉，前两条变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer, operation_snapshot

FIXTURES = Path(__file__).parent / "fixtures"
DECK = FIXTURES / "round180_store_review_flat_conversion_line.pptx"
NAME = "output/星河生活馆_门店月度复盘.pptx"


def test_the_round180_combo_chart_reports_its_flat_line():
    facts = office_facts(DECK.read_bytes(), NAME)
    assert facts["chartSeriesFlat"] == 1
    assert facts["chartSeriesFlatSamples"] == ["第 4 页「转化率」最大 19.5，同一根轴上最大 2,760"]
    sentence = office_facts_sentence(NAME, facts)
    assert "贴着 0 的平线" in sentence and "拆成两张图" in sentence and "不要在图下面加一行注解" in sentence


def test_the_sample_reaches_the_receipt_through_the_snapshot():
    saved = {"exitCode": 0, "officeFiles": [NAME], "officeFacts": {NAME: office_facts(DECK.read_bytes(), NAME)}}
    operation = SimpleNamespace(operationId="pop-1", kind="runtime.exec", status="completed",
                                expectedRevision="prv-1", cancelRequested=False, result=saved)
    hint = _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 3}), "ok")["hint"]
    assert "第 4 页「转化率」最大 19.5" in hint


def test_real_charts_with_comparable_series_are_not_reported():
    """反向（真文件）：第 179 轮预算 vs 实际、第 153 轮发布会图表——量级相当，不报。"""
    for name in ("round179_budget_literal_newline.xlsx", "round153_watch_launch_same_color_labels.pptx"):
        facts = office_facts((FIXTURES / name).read_bytes(), name)
        assert facts["charts"] >= 1 and facts["chartSeriesFlat"] == 0, name


C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'


def _ser(name: str, values: list[float]) -> str:
    pts = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(values))
    return (f"<c:ser><c:tx><c:strRef><c:strCache><c:pt idx=\"0\"><c:v>{name}</c:v></c:pt></c:strCache></c:strRef></c:tx>"
            f"<c:val><c:numRef><c:numCache>{pts}</c:numCache></c:numRef></c:val></c:ser>")


def _chart_deck(line_axis: str) -> bytes:
    xml = (f"<c:chartSpace {C}><c:chart><c:plotArea>"
           f'<c:barChart>{_ser("客流", [2350, 2760])}<c:axId val="1"/><c:axId val="2"/></c:barChart>'
           f'<c:lineChart>{_ser("转化率", [17.8, 19.5])}<c:axId val="3"/><c:axId val="{line_axis}"/></c:lineChart>'
           '<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx>'
           '<c:catAx><c:axId val="3"/></c:catAx><c:valAx><c:axId val="4"/></c:valAx>'
           "</c:plotArea></c:chart></c:chartSpace>")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("ppt/slides/slide1.xml", "<p:sld/>")
        z.writestr("ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Target="../charts/chart1.xml"/></Relationships>')
        z.writestr("ppt/charts/chart1.xml", xml)
    return out.getvalue()


def test_a_secondary_axis_is_the_fix_not_a_finding():
    """反向：小系列放在自己的次坐标轴上（valAx 4）——那正是回执建议的改法之一，不报；同一份放回主轴（2）就报。"""
    assert office_facts(_chart_deck("4"), "a.pptx")["chartSeriesFlat"] == 0
    assert office_facts(_chart_deck("2"), "a.pptx")["chartSeriesFlat"] == 1
