"""PPT 的实况要量「字色和它下面那层底色几乎一样」：用户在预览里看到的是一块没字的色块。

⚠ 2026-09-30 隔离真机第 153 轮（智能手表发布会 PPT，没点名技能）：封面「CONCEPT 2025」、第 2 页三个
  「查看型号」、第 3 页「FOR ATHLETES」、第 8 页「RESERVE NOW」——亮绿 / 青色胶囊上叠一个同色字的
  文本框，右栏预览是一排空色条。模型的校验说「无越界或浅文本框告警」，它没查颜色。

夹具 `fixtures/round153_watch_launch_same_color_labels.pptx` 是那一轮交付的文件原样：7 处。
阈值 1.5 的标定写在 services/deliverable_kind.py 的 _INVISIBLE_CONTRAST 旁边（74 份真交付，逐页渲染核过）。

反向判据用手搭的最小幻灯片，一条只动一个因素：换深色字、中间隔一张照片、字落在胶囊外面。
把「往下找」那段删掉，第一条变红（7 处全是独立文本框叠在胶囊上）；把图片当遮挡那句删掉，照片那条变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from services.deliverable_kind import office_facts, office_facts_sentence
from services.project_tools import _command_pointer

FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE = FIXTURES / "round153_watch_launch_same_color_labels.pptx"
NAME = "output/nova_watch_product_launch.pptx"

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _shape(x, y, w, h, fill=None, text=None, color=None):
    sppr = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
    body = ""
    if text:
        body = (f'<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1200"><a:solidFill><a:srgbClr val="{color}"/>'
                f"</a:solidFill></a:rPr><a:t>{text}</a:t></a:r></a:p></p:txBody>")
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm>'
            f'<a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>{sppr}</p:spPr>{body}</p:sp>')


def _picture(x, y, w, h):
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="2" name="photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm></p:spPr></p:pic>')


def _deck(*shapes, background="0B1220"):
    slide = (f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{background}"/>'
             f'</a:solidFill></p:bgPr></p:bg><p:spTree>{"".join(shapes)}</p:spTree></p:cSld></p:sld>')
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("ppt/presentation.xml", "<p:presentation/>")
        z.writestr("ppt/slides/slide1.xml", slide)
    return out.getvalue()


PILL = _shape(100, 100, 1000, 300, fill="B7F36B")


def test_the_round153_deck_reports_its_blank_labels():
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    assert facts["textInvisible"] == 7
    assert facts["textInvisibleSamples"][0] == "第 1 页「CONCEPT 2025」"
    assert len(set(facts["textInvisibleSamples"])) == len(facts["textInvisibleSamples"])   # 三个「查看型号」只举一次
    sentence = office_facts_sentence(NAME, facts)
    assert "7 处文字" in sentence and "没字的色块" in sentence and "交付前" in sentence


def test_the_sentence_reaches_the_command_receipt():
    """接在链路上：收回这份 PPT 的回执里，模型读得到这句（§三）。"""
    facts = office_facts(FIXTURE.read_bytes(), NAME)
    receipt = _command_pointer({"exitCode": 0, "status": "completed", "officeFiles": [NAME],
                                "officeFacts": {NAME: facts}, "command": "python3 scripts/build_deck.py"}, "ok")
    assert "底色几乎同色" in receipt["hint"]


def test_a_label_box_on_a_pill_of_its_own_color_is_counted():
    assert office_facts(_deck(PILL, _shape(150, 150, 900, 200, text="RESERVE", color="B7F36B")),
                        "a.pptx")["textInvisible"] == 1


def test_the_same_label_in_a_dark_color_is_not():
    """反向：同一个胶囊、同一个文本框，只把字改成深色。"""
    facts = office_facts(_deck(PILL, _shape(150, 150, 900, 200, text="RESERVE", color="0B1220")), "a.pptx")
    assert facts["textInvisible"] == 0 and "textInvisibleSamples" not in facts
    assert "同色" not in office_facts_sentence("a.pptx", facts)


def test_text_over_a_photo_is_not_judged_against_the_shape_under_the_photo():
    """反向：色块和字中间隔了一张照片，字的底色是照片，量不出来就不报（大阪行程那份的误报）。"""
    deck = _deck(PILL, _picture(100, 100, 1000, 300), _shape(150, 150, 900, 200, text="OSAKA", color="B7F36B"))
    assert office_facts(deck, "a.pptx")["textInvisible"] == 0


def test_text_that_falls_outside_the_pill_is_judged_against_the_background():
    """字的中心落在胶囊外面，底色是页面背景：亮绿字压深色背景，看得见。"""
    deck = _deck(PILL, _shape(2000, 2000, 900, 200, text="NOVA", color="B7F36B"))
    assert office_facts(deck, "a.pptx")["textInvisible"] == 0
    deck = _deck(PILL, _shape(2000, 2000, 900, 200, text="NOVA", color="0B1220"))
    assert office_facts(deck, "a.pptx")["textInvisible"] == 1                  # 深色字压深色背景才算


def test_earlier_real_decks_report_nothing():
    """反向：之前两轮真交付的 PPT（形状拼图表、形状拼表格）字都看得见。"""
    for name in ("q3_review_shapes_not_charts.pptx", "round34_infosec_shape_table.pptx"):
        assert office_facts((FIXTURES / name).read_bytes(), name)["textInvisible"] == 0
