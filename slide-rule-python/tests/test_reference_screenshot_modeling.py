"""目标界面截图进**建模**那一步（2026-08-12）。

## 这条线是怎么来的

先在**设计**那一步验过：把用户那张「日历排期与内容槽位管理」的截图当参照板喂进去，
取色读对了（`#1677ff`/`#f59e0b`/`#16a34a`/`#e53935` 四个语义色跟图上一致）、字体也
跟着引了 Noto Sans SC，但出来的仍然是「KPI 行 + 图表 + 列表」那套通用后台总览——
**月历那个核心控件根本没出现**，而那是这个应用的全部意义。

根因是顺序：`model.generate` 先跑，那时候图还不存在，所以"这个应用有哪些页、首页
放什么"完全由文字话题决定；图只能影响"既定内容怎么摆"。而那张图真正携带的信息是
**「日历就是首页」**——那是产品形状，不是排版。

⚠ 能往前挪的只有**用户给的**图。自己生的参照板是从 brief 生的、brief 来自模型，
天然不可能更早——这也正是 abi/screenshot-to-code 的原形态与我们的分岔点。
"""

import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import v5_llm_generate as gen  # noqa: E402

B64 = "iVBORw0KGgoAAAANSUhEUg=="


@pytest.fixture(autouse=True)
def _clear() -> Any:
    gen.set_reference_screenshot(None)
    yield
    gen.set_reference_screenshot(None)


def _capture_messages(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """截下真正发出去的 messages。"""
    seen: dict[str, Any] = {}

    def fake(messages: list, **kwargs: Any) -> tuple[dict, Any]:
        seen["messages"] = messages
        seen["kwargs"] = kwargs
        return ({k: {} for k in gen._REQUIRED_SECTIONS}, object())

    import sliderule_llm.client as client

    monkeypatch.setattr(client, "call_llm_json_with_shape", fake)
    # 结构化通道会先跑并直接返回，那样就截不到；关掉它逼走 call_llm_json_with_shape
    monkeypatch.setattr(gen, "_structured_llm_json_fn", lambda _m: None)
    return seen


def test_没给截图时_请求形状与从前逐字节一致(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认路径不能因为加了这条线而改变——user content 仍是**纯字符串**。"""
    seen = _capture_messages(monkeypatch)
    gen._default_llm_json_fn("做一个排期系统")
    content = seen["messages"][1]["content"]
    assert isinstance(content, str), "没给图却把 content 变成了多模态数组"
    assert "目标产品界面截图" not in content


def test_给了截图_图与指令一起进_user_消息(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_messages(monkeypatch)
    gen.set_reference_screenshot(B64)
    gen._default_llm_json_fn("做一个排期系统")
    content = seen["messages"][1]["content"]
    assert isinstance(content, list) and len(content) == 2
    text, image = content
    assert text["type"] == "text" and "目标产品界面截图" in text["text"]
    assert image["type"] == "image_url"
    assert image["image_url"]["url"].endswith(B64)
    # detail=high 是照 abi/screenshot-to-code 来的：要它照图还原，就不能给降采样的图
    assert image["image_url"]["detail"] == "high"
    # 系统提示词那一条不动（契约 schema 与图无关）
    assert isinstance(seen["messages"][0]["content"], str)


def test_指令说的是形状_不是配色() -> None:
    """图是产品形状的依据。这条用例钉的是那份指令的**语义**别被改跑偏。"""
    ins = gen._REFERENCE_SHOT_INSTRUCTION
    for must in ("页面构成与类型", "landingPageRef", "kind", "datamodel", "workflow"):
        assert must in ins, must
    # 首页那条最容易被模型的习惯盖过去，必须明说
    assert "不要因为习惯而另造一个 KPI 总览页当首页" in ins
    # 数字仍然不许抄——这跟整条链路"数字不能编"是同一条
    assert "一个都不要抄" in ins


def test_有截图时不走并发DAG(monkeypatch: pytest.MonkeyPatch) -> None:
    """整份契约要跟同一张图对齐；分段并发各看一次图既贵又容易各自解读。"""
    calls: list[str] = []

    monkeypatch.setattr(
        gen, "_default_llm_json_fn",
        lambda g, gate_feedback=None: (calls.append("single"), {k: {} for k in gen._REQUIRED_SECTIONS})[1],
    )
    import services.v5_parallel_generate as par

    monkeypatch.setattr(par, "parallel_generation_enabled", lambda: True)
    monkeypatch.setattr(
        par, "generate_parallel_five_system_model",
        lambda *a, **k: (calls.append("parallel"), {k2: {} for k2 in gen._REQUIRED_SECTIONS})[1],
    )

    gen.set_reference_screenshot(B64)
    gen.generate_five_system_model("做一个排期系统")
    assert calls == ["single"], f"有截图却走了并发：{calls}"

    calls.clear()
    gen.set_reference_screenshot(None)
    gen.generate_five_system_model("做一个排期系统")
    assert calls == ["parallel"], f"没截图时不该改变原有选路：{calls}"


def test_空串当没给(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_messages(monkeypatch)
    gen.set_reference_screenshot("   ")
    gen._default_llm_json_fn("做一个排期系统")
    assert isinstance(seen["messages"][1]["content"], str)


# ── 有真图就"直接照着图画"：四步短路（2026-08-12 傍晚，用户裁决）──────────

def test_四步短路的判据都挂在同一个信号上() -> None:
    """有用户给的截图时，这四步一律不跑——它们的产物要么已经有真的、要么没人消费：

        monitor.sheet          生图 + 写出图提示词   实测 120~140s   → 手上已有真图
        monitor.brief          LLM 写设计任务书      实测 13~70s     → 图直接告诉设计模型
        monitor.reconstruction 参照图 → 结构契约     实测 81~236s    → **零消费方**
        monitor.palette        参照图取色            实测 19~118s    → 用户裁决去掉

    合计 230~500s。判据全挂在 `user_shot` 这一个信号上（同一个 contextvar 也喂给建模），
    所以"开没开"只有一处可看、不会两处漂。
    """
    import inspect

    from services import freeform_block as fb

    src = inspect.getsource(fb._enrich_monitor_page_overviews_inner)
    assert "user_shot = get_reference_screenshot()" in src, "信号没接上"
    # 四处各自的短路
    assert 'elif user_shot:\n                # 用户给了目标界面截图' in src, "sheet 没短路"
    assert "if not is_marketing_landing and not user_shot:" in src, "brief 没短路"
    assert src.count('skippedReason"] = "user_shot"') >= 3, "短路要留痕，别静默跳过"


def test_跳过也要留痕_不许静默() -> None:
    """静默跳过的后果今天见过太多次：现象只是"某一步没花时间"，没人知道为什么。

    所以四处短路都记 `skippedReason=user_shot`——跟 deadline / app_unreachable
    那几处同一套口径。
    """
    import inspect

    from services import freeform_block as fb

    src = inspect.getsource(fb._enrich_monitor_page_overviews_inner)
    for stage in ("monitor.brief", "monitor.reconstruction", "monitor.palette"):
        i = src.index(stage)
        assert "user_shot" in src[i : i + 900], f"{stage} 的短路没留痕"


def test_取色被跳过的代价写在代码里() -> None:
    """图表画在 canvas 上、颜色由 identity.chartColors 决定，HTML 的 CSS 管不到它
    ——所以不取色就意味着图表用账本默认色序、跟页面用色不再自动一致。这个代价必须
    写在跳过它的地方，否则下一个人会以为"跳过它没有损失"。"""
    import inspect

    from services import freeform_block as fb

    src = inspect.getsource(fb._enrich_monitor_page_overviews_inner)
    # 按取色那一段定位（第一处 skippedReason 是 brief 的，不是它）
    i = src.index("if user_shot and not _existing_chart_colors(model):")
    window = src[i : i + 1200]
    assert "canvas" in window, "没写清图表颜色管不到的原因"
    assert "账本默认色序" in window, "没写清跳过之后颜色会退回哪里"
