"""首页总览的 HTML 载体：校验那一层（2026-08-12）。

## 这个载体存在的理由，以及它必须守住的东西

受限 JSON 树的天花板是词汇表（没有 table/img、图表只有四种、缺 transform）。
换成 HTML 天花板消失——但这条链路最硬的一条纪律不能跟着消失：

    数字不能编。

原型实测过放开会怎样：让 LLM 自己从原始行算数，第一次跑「处理中工单」显示 0，
而同一页的环图从**同一份数据**算出 5。同一页自相矛盾，且没有任何一层能发现。

所以这个载体的设计是 **HTML 里一个数字都不写**——只摆 `data-fact` 占位，
运行时填。下面这些用例守的就是"写了数字必须被打回"这条。
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


def test_switch_is_off_by_default() -> None:
    """默认关 —— 新旧两条路并存，不是单向门。"""
    assert overview_html_enabled() is False


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


# ── 安全 ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "bad",
    [
        '<div class="ov-root"><script>alert(1)</script></div>',
        '<div class="ov-root" onclick="alert(1)"></div>',
        '<div class="ov-root"><iframe src="x"></iframe></div>',
        '<div class="ov-root"><a href="javascript:alert(1)">x</a></div>',
    ],
)
def test_scriptish_is_rejected(bad: str) -> None:
    assert any("script" in p or "javascript" in p for p in validate_overview_html(bad, FACTS, CHARTS))


@pytest.mark.parametrize(
    "bad",
    [
        '<div class="ov-root"><style>@import url(https://fonts.googleapis.com/x);</style></div>',
        '<div class="ov-root"><img src="https://example.com/a.png"></div>',
        '<div class="ov-root"><style>.x{background:url(//cdn.example.com/a.png)}</style></div>',
    ],
)
def test_external_resources_are_rejected(bad: str) -> None:
    """一个外链都不允许：出口策略会挡，而且离线时版式会塌。"""
    assert any("外部资源" in p for p in validate_overview_html(bad, FACTS, CHARTS))


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
