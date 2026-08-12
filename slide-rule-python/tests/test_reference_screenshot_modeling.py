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
