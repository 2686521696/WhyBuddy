"""首页总览的 HTML 载体：校验那一层（2026-08-12）。

## 这个载体存在的理由，以及它必须守住的东西

受限 JSON 树的天花板是词汇表（没有 table/img、图表只有四种、缺 transform）。
换成 HTML 天花板消失——但这条链路最硬的一条纪律不能跟着消失：

    数字不能编。

原型实测过放开会怎样：让 LLM 自己从原始行算数，第一次跑「处理中工单」显示 0，
而同一页的环图从**同一份数据**算出 5。同一页自相矛盾，且没有任何一层能发现。

所以这个载体的设计是 **HTML 里一个数字都不写**——只摆 `data-fact`（整页的聚合）、
`data-field`（逐行的值）、`data-chart` 占位，运行时填。下面这些用例守的就是
"写了数字必须被打回"这条。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.overview_html import (  # noqa: E402
    MAX_HTML_BYTES,
    build_overview_charts,
    build_overview_facts,
    overview_html_enabled,
    validate_overview_html,
)

DATAMODEL = {
    "entities": [{
        "id": "appointment",
        "name": "预约",
        "fields": [
            {"id": "patient", "name": "患者", "type": "string"},
            {"id": "status", "name": "状态", "type": "enum"},
            {"id": "rate", "name": "到诊率", "type": "number", "format": "percent"},
        ],
    }]
}
PAGE = {
    "id": "clinic_monitor",
    "stats": [
        {"id": "today_total", "name": "今日预约", "entity": "appointment", "metric": "count"},
        {"id": "avg_rate", "name": "平均到诊率", "entity": "appointment",
         "metric": "avg:appointment.rate"},
    ],
    "charts": [{
        "id": "c_status", "name": "状态分布", "type": "donut",
        "dimension": "appointment.status", "metric": "count",
    }],
}

FACTS = build_overview_facts(PAGE, DATAMODEL)
CHARTS = build_overview_charts(PAGE, DATAMODEL)

GOOD = """<div class="ov-root"><style>.ov-kpi{display:flex;gap:12px}</style>
<div class="ov-kpi"><span>今日预约</span><span data-fact="today_total"></span></div>
<div class="ov-kpi"><span>平均到诊率</span><span data-fact="avg_rate"></span></div>
<div data-chart="c_status" style="height:260px"></div></div>"""


def test_declarations_carry_format_from_the_field() -> None:
    """事实清单要把被聚合字段的 format 带上——运行时靠它补 %。"""
    by_id = {f["id"]: f for f in FACTS}
    assert by_id["today_total"]["aggregate"] == "count"
    assert by_id["today_total"]["format"] == ""  # count 没有被聚合字段
    assert by_id["avg_rate"]["aggregate"] == "avg:rate"
    assert by_id["avg_rate"]["format"] == "percent", "百分比格式没带过来，运行时又会丢单位"


def test_a_clean_page_passes() -> None:
    assert validate_overview_html(GOOD, FACTS, CHARTS) == []


def test_switch_is_on_by_default_but_can_be_turned_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """**默认开**（2026-08-12 傍晚翻的），但必须留得住那扇门。

    翻默认值的依据是三趟真话题：HTML 69.6s / 9KB，受限树 162.7s 与 225.7s，且
    圆环分数、月历、标签页这些受限树做不出来的东西都出来了。

    受限树没删：HTML 没过校验退回它，`=0` 一关完全回到老行为。这条用例钉的是
    "翻的是默认值，不是拆了老路"——两个方向都验，只验一边等于没验。
    """
    monkeypatch.delenv("SLIDERULE_OVERVIEW_HTML", raising=False)
    assert overview_html_enabled() is True
    for off in ("0", "false", "no", "off", "OFF"):
        monkeypatch.setenv("SLIDERULE_OVERVIEW_HTML", off)
        assert overview_html_enabled() is False, off


# ── 数字不能编 ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "text",
    [
        "今日预约 128 单",
        "平均到诊率 91.4%",
        "本月收入 ¥12,800",
    ],
)
def test_hardcoded_numbers_are_rejected(text: str) -> None:
    """把数字写进文字里就必须被打回 —— 这是这个载体的立身之本。"""
    markup = GOOD.replace("<span>今日预约</span>", f"<span>{text}</span>")
    problems = validate_overview_html(markup, FACTS, CHARTS)
    assert any("写死了数据声明" in p for p in problems), f"「{text}」没被拦住"


@pytest.mark.parametrize("text", ["近 7 天趋势", "Top 5 门店", "2026 年度目标"])
def test_structural_numbers_are_not_false_positives(text: str) -> None:
    """结构性数字放过 —— 判据复用受限树那条路调过的那一个，不另起炉灶。"""
    markup = GOOD.replace("<span>今日预约</span>", f"<span>{text}</span>")
    problems = validate_overview_html(markup, FACTS, CHARTS)
    assert not any("写死了数据声明" in p for p in problems), f"「{text}」被误伤"


def test_css_numbers_are_not_data_claims() -> None:
    """<style> 里的 12px / 0.06 不是数据声明 —— 整段挖掉再判。"""
    markup = GOOD.replace(
        "<style>.ov-kpi{display:flex;gap:12px}</style>",
        "<style>.ov-kpi{gap:12px;padding:18px;box-shadow:0 2px 8px rgba(0,0,0,.06)}</style>",
    )
    assert not any("写死了数据声明" in p for p in validate_overview_html(markup, FACTS, CHARTS))


# ── 视觉限制已撤（2026-08-12 傍晚，用户裁决"不要加任何禁止"）──────────────
#
# 这里原先有两组用例：`test_scriptish_is_rejected` 与
# `test_external_resources_are_rejected`——它们钉的是"一个外链都不允许"和"不许
# script"。前者是自伤：平台 CSP 明写 `img-src … https:` 与 Google Fonts 放通，
# **是我们自己的校验把平台允许的东西挡在门外**，而页面观感一半在图像/图标/字体上
# （对照 abi/screenshot-to-code：它出效果靠的正是这些）。
#
# 所以判据反过来钉：这些**必须放行**。可执行内容那条不在生成侧拦，改由渲染端
# DOMPurify 负责（宿主安全，不是对设计的限制；见 OverviewHtmlSurface 头注）。


@pytest.mark.parametrize(
    "rich",
    [
        '<img src="https://images.example.com/cover.jpg" alt="封面">',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
        '<style>@import url(https://fonts.googleapis.com/css2?family=Inter);</style>',
        '<style>.hero{background:url(https://cdn.example.com/bg.png) center/cover}</style>',
        '<img src="https://placehold.co/640x360" alt="占位">',
        '<a href="https://miantuan.ai" target="_blank" rel="noreferrer">外部链接</a>',
    ],
)
def test_图像字体外链一律放行(rich: str) -> None:
    """撤禁令之后这些是**材料**，不是违规。挡住它们等于把观感天花板焊死。"""
    markup = GOOD.replace('<div class="ov-kpi">', f'{rich}<div class="ov-kpi">', 1)
    assert validate_overview_html(markup, FACTS, CHARTS) == []


def test_生成侧不再拦脚本_那一层交给渲染端的消毒() -> None:
    """脚本不在这儿拦，但**不等于它会被渲染**——渲染端 DOMPurify 照旧剥掉。

    分工：生成侧管"内容对不对"（数字不能编、占位契约、引用真实存在），
    渲染端管"宿主安不安全"。两件事混在一处的后果就是刚撤掉的那种自伤禁令。
    """
    with_script = GOOD.replace(
        '<div class="ov-kpi">', '<script>alert(1)</script><div class="ov-kpi">', 1
    )
    assert validate_overview_html(with_script, FACTS, CHARTS) == []


# ── 占位契约 ────────────────────────────────────────────────────────────

def test_unknown_placeholder_is_rejected_with_the_valid_list() -> None:
    """报错要带上"可用的是哪些"——只说"不认识"的话模型只能瞎猜，白烧一轮。"""
    markup = GOOD.replace('data-fact="today_total"', 'data-fact="made_up"')
    problems = validate_overview_html(markup, FACTS, CHARTS)
    assert any("made_up" in p and "today_total" in p for p in problems)


def test_missing_declared_content_is_rejected() -> None:
    """清单里的 KPI/图表不能漏 —— 那份清单是过了门禁的内容范围。"""
    markup = GOOD.replace('<div data-chart="c_status" style="height:260px"></div>', "")
    assert any("c_status" in p and "没画" in p for p in validate_overview_html(markup, FACTS, CHARTS))


def test_oversized_output_is_rejected() -> None:
    fat = GOOD + "<div>" + ("填充" * MAX_HTML_BYTES) + "</div>"
    assert any("上限" in p for p in validate_overview_html(fat, FACTS, CHARTS))


def test_empty_is_rejected() -> None:
    assert validate_overview_html("   ", FACTS, CHARTS) == ["产物为空"]


# ── 逐行（data-rows / data-field）─────────────────────────────────────────
#
# 这是这个载体相对受限树**唯一的功能倒退**，2026-08-12 傍晚补上。倒退的样子在
# 真跑里很具体：拿参照图还原那版三张选题卡的分数全是同一个「76.8 分」——没有
# 逐行能力，模型只能把同一个聚合 data-fact 复制三份充当列表。
#
# 判据跟受限树的 rowsRef 一条一条对齐（实体/字段/排序字段必须真实存在、limit
# 共用同一个预算常量），所以这些用例也是那条纪律在新载体上的复刻。

ROWS_GOOD = """<div class="ov-root">
<div class="ov-kpi"><span>今日预约</span><span data-fact="today_total"></span></div>
<div class="ov-kpi"><span>平均到诊率</span><span data-fact="avg_rate"></span></div>
<div class="ov-list" data-rows="appointment" data-sort="rate" data-order="desc" data-limit="5">
  <div class="ov-item"><span data-field="patient"></span><span data-field="rate"></span></div>
</div>
<div data-chart="c_status" style="height:260px"></div></div>"""


def test_逐行的正常写法通过() -> None:
    assert validate_overview_html(ROWS_GOOD, FACTS, CHARTS, DATAMODEL) == []


def test_逐行引用的实体和字段必须真实存在() -> None:
    bad_entity = ROWS_GOOD.replace('data-rows="appointment"', 'data-rows="ghost"')
    problems = validate_overview_html(bad_entity, FACTS, CHARTS, DATAMODEL)
    assert any("ghost" in p and "appointment" in p for p in problems), "报错得带上可用清单"

    bad_field = ROWS_GOOD.replace('data-field="patient"', 'data-field="made_up"')
    problems = validate_overview_html(bad_field, FACTS, CHARTS, DATAMODEL)
    assert any("made_up" in p and "patient" in p for p in problems)

    bad_sort = ROWS_GOOD.replace('data-sort="rate"', 'data-sort="nope"')
    assert any("nope" in p for p in validate_overview_html(bad_sort, FACTS, CHARTS, DATAMODEL))


def test_data_field_必须在_data_rows_里面() -> None:
    """这是**结构**判据，正则看不见——`data-field` 取的是"当前这一行"，
    不在任何列表容器里就没有"当前行"，渲染出来只会是一片空白。"""
    loose = ROWS_GOOD.replace(
        '<div data-chart="c_status" style="height:260px"></div>',
        '<span data-field="patient"></span>',
    )
    problems = validate_overview_html(loose, FACTS, CHARTS, DATAMODEL)
    assert any("不在任何 data-rows 里面" in p for p in problems)


def test_聚合数字不许放进逐行模板() -> None:
    """真跑那个「76.8 分 ×3」就是这么来的：把整页的聚合摆进每行。"""
    inside = ROWS_GOOD.replace(
        '<span data-field="rate"></span>',
        '<span data-field="rate"></span><span data-fact="avg_rate"></span>',
    )
    problems = validate_overview_html(inside, FACTS, CHARTS, DATAMODEL)
    assert any("avg_rate" in p and "data-rows 里面" in p for p in problems)


def test_同一个聚合摆两遍要被拦() -> None:
    """看着像列表、其实是一个总数复制了 N 份 —— 拦的时候要指路到 data-rows。"""
    twice = ROWS_GOOD.replace(
        '<div class="ov-list"',
        '<div><span data-fact="avg_rate"></span></div><div class="ov-list"',
    )
    problems = validate_overview_html(twice, FACTS, CHARTS, DATAMODEL)
    assert any("avg_rate" in p and "data-rows" in p for p in problems)


def test_图表不许每行挂一张() -> None:
    per_row = ROWS_GOOD.replace(
        '<span data-field="rate"></span>',
        '<span data-field="rate"></span><div data-chart="c_status"></div>',
    )
    problems = validate_overview_html(per_row, FACTS, CHARTS, DATAMODEL)
    assert any("c_status" in p and "每行" in p for p in problems)


def test_limit_夹在受限树同一个预算里() -> None:
    """预算跟 rowsRef 共用同一个常量——换载体不换预算。"""
    from services.freeform_block import ROWS_REF_DEFAULT_LIMIT, ROWS_REF_MAX_LIMIT

    over = ROWS_GOOD.replace('data-limit="5"', f'data-limit="{ROWS_REF_MAX_LIMIT + 1}"')
    problems = validate_overview_html(over, FACTS, CHARTS, DATAMODEL)
    assert any(str(ROWS_REF_MAX_LIMIT) in p for p in problems)
    # 不写 limit 是合法的（走默认），报错文案里要把默认值说出来
    assert validate_overview_html(
        ROWS_GOOD.replace(' data-limit="5"', ""), FACTS, CHARTS, DATAMODEL
    ) == []
    assert str(ROWS_REF_DEFAULT_LIMIT) in "".join(problems)

    assert any(
        "整数" in p
        for p in validate_overview_html(
            ROWS_GOOD.replace('data-limit="5"', 'data-limit="五"'), FACTS, CHARTS, DATAMODEL
        )
    )


def test_order_只认_asc_desc() -> None:
    bad = ROWS_GOOD.replace('data-order="desc"', 'data-order="随便"')
    assert any("asc" in p for p in validate_overview_html(bad, FACTS, CHARTS, DATAMODEL))


def test_逐行不许嵌套() -> None:
    nested = ROWS_GOOD.replace(
        '<div class="ov-item">',
        '<div class="ov-item"><div data-rows="appointment"><span data-field="patient"></span></div>',
    )
    problems = validate_overview_html(nested, FACTS, CHARTS, DATAMODEL)
    assert any("只支持一层" in p for p in problems)


def test_空的逐行容器没有意义() -> None:
    empty = ROWS_GOOD.replace(
        '<div class="ov-item"><span data-field="patient"></span><span data-field="rate"></span></div>',
        '<div class="ov-item">占位</div>',
    )
    problems = validate_overview_html(empty, FACTS, CHARTS, DATAMODEL)
    assert any("没有一个 data-field" in p for p in problems)


def test_没有数据模型时逐行一律不放行() -> None:
    """核不了就不许用（fail-closed）。放过去的后果是渲染端得到一片「—」，
    而没有任何一层报过错——那种沉默比报错难查得多。"""
    problems = validate_overview_html(ROWS_GOOD, FACTS, CHARTS, None)
    assert any("没有可核对的数据模型" in p for p in problems)
    # 反向：不用逐行的产物不受影响（老调用方三个参数照旧能用）
    assert validate_overview_html(GOOD, FACTS, CHARTS) == []


# ── 幂等：两种载体都算"已经设计过了" ─────────────────────────────────────

def test_已有HTML总览的页不重复设计() -> None:
    """HTML 成为默认载体之后，幂等判定必须也认它。

    只认受限树的后果：一个已经设计好的 HTML 首页被判成"还没设计"，每次 enrich
    都重跑一遍设计——白烧一次 LLM 调用，还把上一版覆盖掉。这条闸此前只看
    `freeformOverview`。
    """
    from services.freeform_block import _page_has_overview

    assert _page_has_overview({"freeformOverviewHtml": {"html": "<div>x</div>"}}) is True
    assert _page_has_overview({"freeformOverview": {"root": {"tag": "div"}}}) is True
    # 反向：空壳不算（生成失败时留下的空字典不能把这一页永久钉成"已设计"）
    assert _page_has_overview({"freeformOverviewHtml": {"html": ""}}) is False
    assert _page_has_overview({"freeformOverview": {}}) is False
    assert _page_has_overview({}) is False
