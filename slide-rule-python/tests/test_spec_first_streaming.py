"""spec-first 各步要把"在想什么"实时推出去（2026-08-14）。

## 这条防的是"左栏只有标题没有正文"

真机一轮量到：884 个 llm_delta **全部**来自老链路的轮内能力，新链路六步
一条都没有。屏幕上的样子是——左栏一行"正在执行 逐页画界面（并发）"，
底下空着，一直空到那一步结束。

用户原话：「左侧只是显示了事件类型，没有真实的流推送过来」。参照
666ghj/BettaFish 的 forum 流：它把每个 Agent **说的话**逐行推成
`{sender, content, timestamp}`。要流的是**内容**，不是"正在执行 X"。

## 为什么只接四步，不是六步都接

  接：spec / structure / semantics / assemble —— 单次调用，输出是给人看的推理
  不接：pages（第 3 步）/ bind（第 6.5 步）—— 逐页并发

不接那两步有两条独立理由，任何一条单独成立：

  ① 五路并发往同一个 label 推，前端拼出来是交织的乱码；
  ② `on_delta` 在场会**关掉对冲**（call_llm_with_retry 边界一），
     而那两步恰恰最慢、最需要对冲治长尾（bind 实测 552 秒）。

而且那两步本来就有更好的进度出口：**页面本身就是逐页交付的**。
"""

import ast
import inspect
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

#: 接了增量的四步：模块名 → label。**这份表是判据的唯一来源**，
#: 下面每条用例都从它派生，不手抄第二遍。
STREAMED = {
    "spec_tree": "specfirst.spec",
    "html_structure": "specfirst.structure",
    "spec_semantics": "specfirst.semantics",
    "model_assembly": "specfirst.assemble",
}

#: 故意不接的两步（逐页并发）。写成显式名单而不是"其余"，
#: 因为"其余"会在新增步骤时把新步骤悄悄算进来。
NOT_STREAMED = ("spec_page_html", "html_bindings")


@pytest.mark.parametrize("mod,label", sorted(STREAMED.items()))
def test_这一步真的接了增量(mod, label):
    """名单里写了不等于接了——判据钉在源码的真实调用上。"""
    src = __import__(f"services.{mod}", fromlist=["*"])
    text = inspect.getsource(src)
    assert "delta_emitter" in text, f"{mod} 没接增量通道"
    assert f'delta_emitter("{label}")' in text, f"{mod} 的 label 不是 {label}"
    assert "on_delta" in text, f"{mod} 拿到了 emitter 却没往 LLM 调用上传"


@pytest.mark.parametrize("mod", NOT_STREAMED)
def test_逐页并发的两步不许接(mod):
    """⚠ 这条是**反向判据**，比上面那四条更容易被将来的人破坏。

    "顺手也给这两步加上"看起来是好事，实际两个后果：多路并发的增量交织成
    乱码，以及对冲被关掉（而这两步是全链最慢的）。所以写成用例挡住。
    """
    src = __import__(f"services.{mod}", fromlist=["*"])
    text = inspect.getsource(src)
    assert "delta_emitter" not in text, (
        f"{mod} 是逐页并发的步骤，接增量会交织并关掉对冲——见文件头"
    )


def test_通道是仓里现成的那条_不新造():
    """复用 capabilities 的 sink，而不是给 spec-first 另开一条。

    另开一条的代价：驱动器要多一个泵、前端要多认一种事件、请求域隔离要再
    做一遍。而这条通道本来就是干这个的。
    """
    from sliderule_llm import capabilities

    assert hasattr(capabilities, "delta_emitter")
    src = inspect.getsource(capabilities.delta_emitter)
    assert "_delta_emitter" in src, "公开口应当直接复用私有实现，不是抄一份"


def test_没装_sink_时不走流式():
    """没人接收就别开流——流式会关掉对冲，白白付出代价换没人看的东西。"""
    from sliderule_llm.capabilities import delta_emitter, set_capability_delta_sink

    set_capability_delta_sink(None)
    assert delta_emitter("specfirst.spec") is None


def test_装了_sink_就能拿到带标签的增量():
    from sliderule_llm.capabilities import delta_emitter, set_capability_delta_sink

    seen = []
    set_capability_delta_sink(lambda label, chunk: seen.append((label, chunk)))
    try:
        emit = delta_emitter("specfirst.structure")
        assert emit is not None
        emit("实体：")
        emit("宠物档案")
    finally:
        set_capability_delta_sink(None)
    assert seen == [("specfirst.structure", "实体："),
                    ("specfirst.structure", "宠物档案")]


def test_sink_自己炸了不打死这一步():
    """增量只是观测钩子。让一次 UI 推送失败去打死已经在跑的 LLM 调用，
    是拿次要的赔主要的。"""
    from sliderule_llm.capabilities import delta_emitter, set_capability_delta_sink

    set_capability_delta_sink(lambda *_a: 1 / 0)
    try:
        emit = delta_emitter("specfirst.spec")
        assert emit is not None
        emit("一段字")  # 不抛就算过
    finally:
        set_capability_delta_sink(None)


def test_前端认得出这四个_label():
    """⚠ 跨端判据：label 是**同一份词汇的两半**，隔着一条 SSE，谁也编译不到谁。

    漏一个的后果不是报错，是左栏冒出 "LLM 正在执行 specfirst.structure"
    ——内部 id 直接漏到用户脸上。所以这里从仓根去读前端那张表，逐个对。
    """
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[2]
    text = (root / "client/src/pages/sliderule/useSlideRuleSession.ts").read_text(
        encoding="utf-8"
    )
    for label in STREAMED.values():
        assert f'"{label}":' in text, f"前端 SPEC_FIRST_LLM_LABELS 缺 {label}"


def test_不接的那两步也不许出现在前端表里():
    """反过来也要对：前端多写一个没人发的 label 不会红，但它是**死条目**，
    下一个人会照着它以为那一步在流式。"""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[2]
    text = (root / "client/src/pages/sliderule/useSlideRuleSession.ts").read_text(
        encoding="utf-8"
    )
    block = re.search(r"SPEC_FIRST_LLM_LABELS[^{]*\{(.*?)\};", text, re.DOTALL)
    assert block, "前端那张表不见了"
    declared = set(re.findall(r'"(specfirst\.[a-z]+)":', block.group(1)))
    assert declared == set(STREAMED.values()), (
        f"两边对不上：前端 {declared}，后端 {set(STREAMED.values())}"
    )


def test_ast_确认没给并发步骤偷偷开流():
    """字符串搜索会被注释骗（本仓在 tenacity 那条判据上栽过一次：
    "不引 tenacity" 这句注释把 `"tenacity" not in src` 判红）。
    所以这条走 AST，只看**真实的函数调用**。
    """
    import pathlib

    here = pathlib.Path(__file__).resolve().parents[1] / "services"
    for mod in NOT_STREAMED:
        tree = ast.parse((here / f"{mod}.py").read_text(encoding="utf-8"))
        called = {
            n.func.id if isinstance(n.func, ast.Name) else getattr(n.func, "attr", "")
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
        }
        assert "delta_emitter" not in called, f"{mod} 真的调了 delta_emitter"
