"""HTML 载体的截图自检闭环（2026-08-12 傍晚）。

## 这个闭环此前的状态：从上线起一次都没跑过

受限树那条路的自检写的是 `if reference_image_b64 and allow_screenshot_verify`
——**必须先有参考图**。而生图三项配置（IMAGE_API_URL / IMAGE_MODEL /
IMAGE_API_KEY）在本机和当前线上都没齐，于是整段永远不触发。日志里
`block.screenshot got=0` 是这么来的。

HTML 这条不挂在参考图上：渲染出来的那张图**本身就是证据**——"这块挤成一团"
"这行字太浅"不需要参照图才看得出来。有参考图就一并喂进去（多一份比对依据）。

## 这些用例守什么

修订是**直接采纳**的，所以护栏比"能跑"重要得多。UICrit（UIST'24）实测
zero-shot 自由评审只有 13.1% 的意见有效，另一面就是它会很自信地删掉不该删的
东西。所以：过不了同一套校验的、把内容改少的、丢了占位的，一律保留原版。
"""

import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import overview_html  # noqa: E402
from services.overview_html import (  # noqa: E402
    build_preview_entity_fields,
    build_preview_seed_rows,
    critique_overview_html,
)

DATAMODEL = {
    "entities": [{
        "id": "case",
        "name": "案件",
        "fields": [
            {"id": "title", "name": "案件名称", "type": "string"},
            {"id": "fee", "name": "收费额", "type": "number", "format": "money"},
            {"id": "rate", "name": "回款率", "type": "number", "format": "percent"},
            {"id": "score", "name": "评分", "type": "number", "format": "score"},
            {"id": "due", "name": "截止日", "type": "date"},
            {"id": "stage", "name": "阶段", "type": "enum",
             "options": [{"id": "draft", "label": "草稿", "tone": "default"},
                         {"id": "live", "label": "进行中", "tone": "success"}]},
        ],
    }]
}
PAGE = {
    "id": "law_home",
    "stats": [{"id": "total", "name": "案件总数", "entity": "case", "metric": "count"}],
    "charts": [{"id": "c_stage", "name": "阶段分布", "type": "donut",
                "dimension": "case.stage", "metric": "count"}],
}
FACTS = overview_html.build_overview_facts(PAGE, DATAMODEL)
CHARTS = overview_html.build_overview_charts(PAGE, DATAMODEL)

ORIGINAL = """<div class="ov-root"><style>.ov-c{padding:12px}</style>
<div class="ov-c"><span>案件总数</span><span data-fact="total"></span></div>
<div class="ov-list" data-rows="case" data-sort="score" data-limit="5">
  <div class="ov-item"><span data-field="title"></span><span data-field="score"></span></div>
</div>
<div data-chart="c_stage" style="height:260px"></div></div>"""


# ── 种子数据：不铺的话截出来是一张空页 ───────────────────────────────────

def test_种子值按字段声明取_不按声明会渲染出_1280百分号() -> None:
    """`format: percent` 的字段塞进 1280，页面上就是「1280%」——评审会去修一个
    数据问题，而那根本不是设计的责任。"""
    rows = build_preview_seed_rows(DATAMODEL)["case"]
    assert len(rows) == overview_html.PREVIEW_SEED_ROWS
    assert all(0 <= r["values"]["rate"] <= 100 for r in rows), "百分比越界了"
    assert all(0 <= r["values"]["score"] <= 100 for r in rows)
    assert rows[0]["values"]["fee"] >= 1000, "金额给的是零钱，看不出千分位版式"
    # 枚举取真实取值、日期是真日期形状、字符串带序号（一眼看出是逐行不同的）
    assert {r["values"]["stage"] for r in rows} == {"draft", "live"}
    assert rows[0]["values"]["due"].count("-") == 2
    assert rows[0]["values"]["title"] != rows[1]["values"]["title"]


def test_种子是确定性的_两次截图必须一样() -> None:
    """随机的话，评审看到的差异分不清是设计变了还是种子变了。"""
    assert build_preview_seed_rows(DATAMODEL) == build_preview_seed_rows(DATAMODEL)


def test_字段声明带着格式和枚举标签过去_逐行的单位靠它() -> None:
    fields = {f["id"]: f for f in build_preview_entity_fields(DATAMODEL)["case"]}
    assert fields["fee"]["format"] == "money"
    assert fields["stage"]["options"][1]["label"] == "进行中"
    assert fields["title"]["label"] == "案件名称"


# ── 评审：护栏优先 ───────────────────────────────────────────────────────

class _Result:
    def __init__(self, content: str) -> None:
        self.content = content


def _fake_llm(monkeypatch: pytest.MonkeyPatch, reply: str) -> dict[str, Any]:
    """把评审 LLM 换成固定回复，并把发出去的 prompt 留给用例检查。"""
    seen: dict[str, Any] = {}

    def fake(convo: list, **kwargs: Any) -> _Result:
        seen["convo"] = convo
        seen["kwargs"] = kwargs
        return _Result(reply)

    import sliderule_llm.client as client

    monkeypatch.setattr(client, "call_llm_with_retry", fake)
    return seen


def _critique(**kw: Any) -> Any:
    return critique_overview_html(
        ORIGINAL, FACTS, CHARTS, DATAMODEL,
        design_brief="律所首页", preview_screenshot_b64="c2hvdA==", **kw
    )


REVISED = ORIGINAL.replace('<style>.ov-c{padding:12px}', '<style>.ov-c{padding:20px}')


def test_修订被采纳_并且意见留痕(monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    _fake_llm(monkeypatch, f"standard: 留白\nobserved: 卡片太挤\n===HTML===\n{REVISED}")
    assert _critique() == REVISED
    out = capsys.readouterr().out
    assert "评审意见" in out, "意见没留痕 —— revised=0 时永远分不清它有没有在看"


def test_说够好就不改(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_llm(monkeypatch, "===GOOD===")
    assert _critique() is None


@pytest.mark.parametrize(
    "reply",
    [
        "",                                    # 空正文
        "这版挺好的，我觉得没什么问题",          # 给了话但没有分隔标记
        "standard: x\nobserved: y\n===HTML===\n",  # 有标记但修订是空的
    ],
)
def test_拿不到修订就保留原版_不当成没问题(
    monkeypatch: pytest.MonkeyPatch, reply: str
) -> None:
    """静默失败会伪装成"评审认为没问题"——受限树那条路实测被这么误判过一次。"""
    _fake_llm(monkeypatch, reply)
    assert _critique() is None


def test_修订过不了同一套校验就保留原版(monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """修订走的是跟生成完全同一个 validate_overview_html —— 换个入口不换判据。"""
    bad = ORIGINAL.replace("<span>案件总数</span>", "<span>案件总数 128 件</span>")
    _fake_llm(monkeypatch, f"standard: x\nobserved: y\n===HTML===\n{bad}")
    assert _critique() is None
    assert "修订没过校验" in capsys.readouterr().out


def test_修订不许把内容改少(monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """UICrit 那 13.1% 的另一面：它会很自信地"精简"掉不该删的东西，
    而这里的修订是直接采纳的。占位就是内容的骨架，少一个就是少一块。"""
    # 把整段逐行列表删掉（KPI 和图表都还在，所以能过 validate 那几条）
    shrunk = (
        '<div class="ov-root"><style>.ov-c{padding:12px}</style>\n'
        '<div class="ov-c"><span>案件总数</span><span data-fact="total"></span></div>\n'
        '<div data-chart="c_stage" style="height:260px"></div></div>'
    )
    assert overview_html.validate_overview_html(shrunk, FACTS, CHARTS, DATAMODEL) == []
    _fake_llm(monkeypatch, f"standard: x\nobserved: y\n===HTML===\n{shrunk}")
    assert _critique() is None
    assert "改少了" in capsys.readouterr().out


def test_逐行里的字段少了也算改少(monkeypatch: pytest.MonkeyPatch) -> None:
    dropped = ORIGINAL.replace('<span data-field="score"></span>', "")
    _fake_llm(monkeypatch, f"standard: x\nobserved: y\n===HTML===\n{dropped}")
    assert _critique() is None


# ── 参考图是可选的 ──────────────────────────────────────────────────────

def test_没有参考图也照跑_这是跟受限树那条路的关键差别(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _fake_llm(monkeypatch, f"standard: x\nobserved: y\n===HTML===\n{REVISED}")
    assert _critique() == REVISED
    content = seen["convo"][0]["content"]
    images = [c for c in content if c.get("type") == "image_url"]
    assert len(images) == 1, "没有参考图时不该凭空多一张图"
    text = content[0]["text"]
    assert "这张图" in text and "第二张图" not in text, "措辞还在说「第二张图」，会让模型找一张不存在的图"


def test_有参考图就一并喂进去_而且顺序是参考图在前(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _fake_llm(monkeypatch, f"standard: x\nobserved: y\n===HTML===\n{REVISED}")
    assert _critique(reference_image_b64="cmVm") == REVISED
    content = seen["convo"][0]["content"]
    images = [c["image_url"]["url"] for c in content if c.get("type") == "image_url"]
    assert len(images) == 2
    assert images[0].endswith("cmVm"), "参考图必须是第一张 —— 提示词按这个顺序讲的"
    assert "第二张图" in content[0]["text"]


# ── 判据与证据 ──────────────────────────────────────────────────────────

def test_评审维度跟受限树共用同一份白名单(monkeypatch: pytest.MonkeyPatch) -> None:
    """换载体不换判据。两边各抄一份迟早漂开。"""
    from services.freeform_block import UICRIT_REVIEW_DIMENSIONS

    seen = _fake_llm(monkeypatch, "===GOOD===")
    _critique()
    assert UICRIT_REVIEW_DIMENSIONS in seen["convo"][0]["content"][0]["text"]


def test_axe_的硬事实进提示词_并且跟主观意见分开讲(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """对比度这类能算准的不该问模型（UICrit：自由评审只有 13.1% 有效）。"""
    seen = _fake_llm(monkeypatch, "===GOOD===")
    _critique(axe_violations=[{
        "id": "color-contrast", "impact": "serious", "count": 3,
        "help": "Elements must have sufficient color contrast",
        "sample": ["contrast 3.95 (foreground #8c8c8c)"],
    }])
    text = seen["convo"][0]["content"][0]["text"]
    assert "已确诊的硬问题" in text
    assert "color-contrast" in text and "3.95" in text


def test_提示词明说演示数据不算问题(monkeypatch: pytest.MonkeyPatch) -> None:
    """截图上的数字是自动铺的种子。不说清楚，模型会去"修"数据。"""
    seen = _fake_llm(monkeypatch, "===GOOD===")
    _critique()
    text = seen["convo"][0]["content"][0]["text"]
    assert "演示数据" in text
    assert "占位契约一个字都不能动" in text


def test_提示词把当前那一版_HTML_原样带过去(monkeypatch: pytest.MonkeyPatch) -> None:
    """只给图不给源码的话，模型只能凭截图重写一遍——那不是修订，是重做。"""
    seen = _fake_llm(monkeypatch, "===GOOD===")
    _critique()
    assert ORIGINAL in seen["convo"][0]["content"][0]["text"]
