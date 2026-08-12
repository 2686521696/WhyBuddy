"""monitor（首页/运营总览）的积木预设不能只有一套（2026-08-12）。

## 为什么补这个

`_load_page_kind_presets` 的说明里写着预设是"每种页面的 **2~3 套**已经排好的
积木组合"，思路照 alibaba/lowcode-engine 的 `snippets`——拖进来的不是裸组件，
是一段排好的片段，让模型从"发明"降级成"挑选"。

但实际数据里 **monitor 只有 1 套**（workbench 3 套、kanban 2 套、wizard 2 套）。
只有一套等于没得挑：两趟真实产出（线上「采购智审」、本地「退费审批」）的首页
积木**完全一样**，都是 ApprovalQueue + ActivityFeed——两个毫不相干的业务域。

而首页恰恰是最需要多样性的那一页：它是用户打开应用第一眼看到的东西。

## 判据：不是"套数够"，是**形状真的不同**

补三套换皮的列表页没有意义。这里要求四套的 main 位彼此不同——单列队列 /
多列泳道 / 日历网格 / 横向流程条，是四种一眼能分辨的骨架。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.schema_legal import PAGE_KIND_PRESETS, block_placement_problem


def test_monitor_至少三套预设() -> None:
    presets = PAGE_KIND_PRESETS.get("monitor") or ()
    assert len(presets) >= 3, [p.get("id") for p in presets]


def test_每套预设的_main_骨架彼此不同() -> None:
    """套数够但都长一样，等于没补。"""
    presets = PAGE_KIND_PRESETS.get("monitor") or ()
    mains = []
    for p in presets:
        main = [b["type"] for b in p["blocks"] if b.get("region") == "main"]
        assert main, f"{p['id']} 没有 main 位的积木——首页得有个主视图"
        mains.append(tuple(main))
    assert len(set(mains)) == len(mains), f"main 骨架有重复: {mains}"


def test_预设里每个位置都合法() -> None:
    """跟启动自检同一条判据，但这里能指名道姓说是哪一套坏了。

    自检在服务启动时会直接抛异常（"不带病进入 Prompt"），这条测试是为了让
    改坏的时候**测试先红**，而不是等启动失败才发现。
    """
    for kind, presets in PAGE_KIND_PRESETS.items():
        for p in presets:
            for b in p["blocks"]:
                problem = block_placement_problem(b["type"], kind, b["region"])
                assert problem is None, f"{kind}.{p['id']}: {problem}"


def test_每套都写清了什么时候用它() -> None:
    """`when` 是模型挑预设的唯一依据。空话或雷同都会让它退回第一套。"""
    presets = PAGE_KIND_PRESETS.get("monitor") or ()
    whens = [str(p.get("when") or "").strip() for p in presets]
    assert all(len(w) >= 15 for w in whens), whens
    assert len(set(whens)) == len(whens), "有两套的 when 一模一样"


def test_首页那套不许退回单套() -> None:
    """反向哨兵：这条护栏就是为「monitor 只剩一套」这个具体状态设的。

    哪天有人把新增的三套删掉（或把它们挪到别的 kind 下），上面几条会红，
    这一条说明为什么不能这么做。
    """
    ids = {p["id"] for p in (PAGE_KIND_PRESETS.get("monitor") or ())}
    assert "act-flow-feed" in ids, "原有那套不该被删掉"
    assert len(ids - {"act-flow-feed"}) >= 2, (
        "除了原有那套，至少还要有两套别的骨架——只有一套时模型没得挑，"
        "两个不相干的业务域会产出同一个首页"
    )
