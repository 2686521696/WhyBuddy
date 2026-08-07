"""页面形态预设：给模型"已经排好的组合"，而不是一堆散积木。

## 这批预设为什么存在

2026-08-07 用户的判断：「首先让 AI 去设计，感觉有点不现实，因为他也搞不出来
很好的组件」。症结不在积木不够（当时已有 13 个），在于**从零编排**这件事对
模型太难，而且每次结果都不一样。

对照阿里 lowcode-engine 的物料协议，它比我们多的正是这一样：`snippets`——
"用户从组件面板拖入组件时会向页面 schema 中插入 snippets 中定义的低代码
schema"，也就是**拖进来的不是裸组件，是一段排好的片段**。这里照这个思路做
成页面级：模型先挑一套，再把每个积木绑到真实实体/字段上。选型从"发明"降级
成"挑选"，绑定那一步本来就有 bindingSchema 与门禁把关。

## 这组测试钉的是"预设不能骗人"

预设是手写的，而它引用的每个 (type, slot) 都得同时满足三件事：区块放开了
生成、这种页面允许它、这个槽位允许它。手写的东西会漂——今天改了某个区块的
allowedSlots，明天预设就在推荐一个门禁必拦的组合，而模型会照着抄。

那种失败特别难查：模型"照做了"，每次却都被门禁打回，日志里看到的是模型不
听话，实际是我们给的示范本身违规。所以坏预设必须在**服务启动时**就炸，
跟 bindingSchema 自检同一条纪律。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import schema_legal as L


def test_every_preset_block_is_legal_where_it_is_placed():
    """预设推荐的每个 (type, slot) 都必须过契约——这是这批预设的全部价值。

    推荐一个门禁会拦的组合，比不推荐更糟：模型照做，然后被打回，两边都以为
    是对方的问题。
    """
    by_type = {str(b["type"]): b for b in L.EXPERIENCE_BLOCKS}
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets:
            for it in ps["blocks"]:
                t, slot = it["type"], it["slot"]
                entry = by_type[t]
                assert entry.get("generationEnabled"), f"{kind}/{ps['id']}: {t} 未放开生成"
                assert kind in entry["pageKinds"], (
                    f"{kind}/{ps['id']}: {t} 不允许出现在 {kind} 页"
                )
                assert slot in entry["allowedSlots"], (
                    f"{kind}/{ps['id']}: {t} 不允许放在 {slot}"
                )


def test_monitor_presets_respect_the_forbidden_four():
    """总览页那四个禁用区块，预设里一个都不许出现。

    MetricGrid / TrendChart / DataTable / FilterBar 在总览页是**惰性的**
    （理由见 experience_block_prompt_block 里那段：前两个会把同一批数字画
    第二遍，DataTable 要全宽，FilterBar 筛不动任何东西）。prompt 里已经有
    一条硬禁令，预设要是又把它们摆出来，就是自己打自己。
    """
    forbidden = {"MetricGrid", "TrendChart", "DataTable", "FilterBar"}
    for kind in ("monitor", "dashboard"):
        for ps in L.PAGE_KIND_PRESETS.get(kind, ()):
            used = {it["type"] for it in ps["blocks"]}
            assert not (used & forbidden), (
                f"{kind}/{ps['id']} 用了总览页禁用区块: {sorted(used & forbidden)}"
            )


def test_bad_preset_fails_at_startup_not_at_runtime():
    """坏预设必须当场炸，不能带病进 Prompt。

    分三种坏法各验一次——它们是真会发生的三种漂移：改了 generationEnabled、
    改了 pageKinds、改了 allowedSlots，而预设没跟着改。
    """
    blocks = L.EXPERIENCE_BLOCKS
    cases = {
        "槽位不合法": {"workbench": [{"id": "x", "name": "n", "when": "w",
                                   "blocks": [{"type": "DataTable", "slot": "summary"}]}]},
        "页面形态不合法": {"wizard": [{"id": "x", "name": "n", "when": "w",
                                   "blocks": [{"type": "DataTable", "slot": "primary"}]}]},
        "未放开生成": {"monitor": [{"id": "x", "name": "n", "when": "w",
                                 "blocks": [{"type": "FreeformInsight", "slot": "primary"}]}]},
    }
    for label, bad in cases.items():
        original = L._BLOCK_CATALOG.get("pageKindPresets")
        L._BLOCK_CATALOG["pageKindPresets"] = bad
        try:
            with pytest.raises(ValueError):
                L._load_page_kind_presets(blocks)
        finally:
            if original is None:
                L._BLOCK_CATALOG.pop("pageKindPresets", None)
            else:
                L._BLOCK_CATALOG["pageKindPresets"] = original


def test_presets_reach_the_prompt_with_the_reason_attached():
    """预设要进 prompt，而且**每条都得带上"什么时候用"**。

    只丢一张组合表，模型无从判断该挑哪一套，会退回按直觉猜——本仓库反复
    验证过措辞与理由决定行为（许可式让七个通电区块一次都没被用；
    WorkflowTimeline 被摆进窄栏 5 次是因为只给了 slots 表没给理由）。
    """
    prompt = L.experience_block_prompt_block()
    assert "PROVEN LAYOUTS" in prompt
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets:
            assert ps["name"] in prompt, f"{kind}/{ps['id']} 没进 prompt"
            assert ps["when"] in prompt, f"{kind}/{ps['id']} 进了 prompt 但没带理由"
            for it in ps["blocks"]:
                assert f"{it['type']}@{it['slot']}" in prompt


def test_prompt_says_presets_are_a_starting_point_not_a_cage():
    """必须明说"业务需要时照常自己排"。

    只给预设不给这句话，会把模型逼进另一个极端：只会抄这几套，遇到真正
    不一样的业务也硬套。这跟"从零发明"是同一枚硬币的两面。
    """
    prompt = L.experience_block_prompt_block()
    assert "Composing your own set is allowed and expected" in prompt


def test_every_live_page_kind_has_at_least_one_preset():
    """六种页面形态都得有预设——漏掉的那种就退回从零发明了。

    这条会在新增 pageKind 时红，逼着补预设，而不是让新形态悄悄没有起点。
    """
    for kind in L.PAGE_KINDS:
        assert L.PAGE_KIND_PRESETS.get(kind), f"页面形态 {kind} 没有任何预设"
