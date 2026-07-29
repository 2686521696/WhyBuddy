"""monitor 页面总览区块交给 FreeformInsight 设计（2026-07-24）的单测覆盖。

只测新增的两个函数本身：
- _monitor_overview_design_brief：把页面已声明的 stats/charts 翻译成自然语言
  需求文案，覆盖率/措辞正确，不依赖真实 LLM。故意不包含 rankings/feeds——
  真机测试过一次，FreeformInsight 的 dataRef 只能表达聚合值，没法引用"第 N
  行真实记录"，让 LLM 画排行榜/动态流只会画出表头+空表身，比留白还难看，
  所以这两类内容明确排除在设计文案之外，继续走原有的动态行渲染。
- enrich_monitor_page_overviews：编排逻辑本身——只处理 kind=monitor 且声明
  了 stats/charts 的页面（只有 rankings/feeds 没有 stats/charts 时，没东西
  可画，直接跳过），生成成功写回 freeformOverview，生成失败 fail-open 保留
  原有固定骨架不炸、不删数据。generate_freeform_block 本身在这里打桩，不
  发真实网络请求。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.freeform_block import (  # noqa: E402
    FreeformGenerationError,
    _monitor_overview_design_brief,
    enrich_monitor_page_overviews,
)


def _datamodel():
    return {
        "entities": [
            {
                "id": "order",
                "name": "订单",
                "fields": [
                    {"id": "amount", "name": "金额", "type": "number"},
                    {
                        "id": "status",
                        "name": "状态",
                        "type": "enum",
                        "options": [{"id": "open", "label": "进行中"}, {"id": "done", "label": "已完成"}],
                    },
                ],
            },
            {
                "id": "ticket",
                "name": "工单",
                "fields": [{"id": "created_at", "name": "创建时间", "type": "date"}],
            },
        ]
    }


def _monitor_page():
    return {
        "id": "home",
        "name": "运营总览",
        "kind": "monitor",
        "stats": [
            {"id": "s1", "name": "订单总数", "entity": "order", "metric": "count"},
            {"id": "s2", "name": "总金额", "entity": "order", "metric": "sum:order.amount"},
        ],
        "charts": [
            {"id": "c1", "name": "状态分布", "type": "bar", "dimension": "order.status", "metric": "count"},
        ],
        "rankings": [
            {"id": "r1", "name": "金额排行", "entity": "order", "sortBy": "order.amount", "limit": 5},
        ],
        "feeds": [
            {"id": "f1", "name": "工单动态", "entity": "ticket", "timeField": "ticket.created_at"},
        ],
    }


def test_design_brief_covers_stats_and_charts():
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    assert "订单总数" in brief
    assert "总金额" in brief
    assert "状态分布" in brief
    # 字段/实体用中文标签，不是裸 id——这是喂给 LLM 的自然语言线索
    assert "金额" in brief
    assert "状态" in brief


def test_design_brief_excludes_rankings_and_feeds():
    """rankings/feeds 不进「必须包含」清单——身份是"可摆的积木"，不是"必须画的内容"。

    2026-07-29 语义分成了两层，这条断言也跟着分层：
    - **不在**必须清单里：dataRef 表达不了逐行记录，把它们写成"必须画出来"
      只会逼模型画空表身（这一条没变，是这个函数原本的用意）；
    - **在**可选的 blockRef 候选清单里：见下一个用例。
    """
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    required_section = brief.split("这一页还声明了下面这些")[0]
    assert "金额排行" not in required_section
    assert "工单动态" not in required_section


def test_design_brief_offers_row_content_as_blockref_candidates():
    """逐行内容以**现成绑定**的形式给出来，模型照抄就能摆。

    第一版只写了一句泛泛的"适合的话就摆一个"，真跑生成出来 blockRef 一个都
    没有——模型压根不知道这一页有哪些逐行内容可摆（必须清单里刻意只放了
    stats/charts）。补上具体清单和现成 binding 之后，同一个模型立刻摆了两个。
    """
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    assert "这一页还声明了下面这些" in brief
    # 给的是可直接照抄的 blockRef 形状，不是自然语言描述
    assert '"type": "RankedList"' in brief
    assert '"type": "ActivityFeed"' in brief
    assert '"entityRef": "order"' in brief
    assert '"sortByRef": "amount"' in brief


def test_design_brief_dedupes_row_content_candidates():
    """同一份逐行内容常被 feeds 和 blocks 各声明一遍（真跑逮到过）——
    喂给模型之前先按内容指纹去重，否则等于让它把同一张卡摆两次。"""
    page = _monitor_page()
    page["blocks"] = [
        {
            "id": "dup_feed",
            "type": "ActivityFeed",
            # 与 feeds[0] 绑定逐字段相同，只有 id/名字不同
            "binding": {"entityRef": "ticket", "timeFieldRef": "created_at"},
        }
    ]
    brief = _monitor_overview_design_brief(page, _datamodel())
    candidates = [l for l in brief.split("\n") if l.startswith("- ")]
    assert sum(1 for l in candidates if "ActivityFeed" in l) == 1, candidates


def test_design_brief_points_row_content_at_blockref():
    """2026-07-29：这里原来断言的是一句硬禁令「不要画排行榜/动态流」。

    禁令本身没错（模型确实画不了逐行），但代价是那些内容被赶到设计之外
    单独渲染成外挂卡，首页变成"AI 设计区 + 两张外挂卡"，主次和留白都由不得
    设计者。有了 blockRef 之后语义改成：逐行内容仍然不由它画，但**由它决定
    摆在哪、占多大**，渲染交给积木自己的真渲染器。所以断言从"不许"改成
    "指向 blockRef"。
    """
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    assert "blockRef" in brief
    # 仍然要拦住"自己用 CSS 画"这条歧路
    assert "不要自己用 CSS 去画这类内容" in brief
    # 可选语义：用不上就别凑数
    assert "用不上就完全不用" in brief


def test_design_brief_omits_empty_sections():
    page = {"id": "home", "name": "首页", "kind": "monitor", "stats": [], "charts": [], "rankings": [], "feeds": []}
    brief = _monitor_overview_design_brief(page, _datamodel())
    assert "必须包含的 KPI 统计卡" not in brief
    assert "必须包含的图表" not in brief


def test_enrich_skips_non_monitor_pages(monkeypatch):
    called = []

    def fake_generate(*args, **kwargs):
        called.append(True)
        return {"root": {"tag": "div", "style": {}, "children": []}}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [{"id": "p1", "kind": "workbench", "stats": [{"id": "s"}]}]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == []
    assert "freeformOverview" not in result["page"]["pages"][0]


def test_enrich_skips_monitor_page_with_no_declared_content(monkeypatch):
    called = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda *a, **k: called.append(True) or {"root": {"tag": "div", "style": {}, "children": []}},
    )
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [{"id": "home", "kind": "monitor"}]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == []
    assert "freeformOverview" not in result["page"]["pages"][0]


def test_enrich_skips_monitor_page_with_only_rankings_or_feeds(monkeypatch):
    called = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda *a, **k: called.append(True) or {"root": {"tag": "div", "style": {}, "children": []}},
    )
    page = {
        "id": "home",
        "kind": "monitor",
        "rankings": [{"id": "r1", "name": "金额排行", "entity": "order", "sortBy": "order.amount", "limit": 5}],
        "feeds": [{"id": "f1", "name": "工单动态", "entity": "ticket", "timeField": "ticket.created_at"}],
    }
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [page]},
    }
    result = enrich_monitor_page_overviews(model)
    assert called == []
    assert "freeformOverview" not in result["page"]["pages"][0]


def test_enrich_writes_freeform_overview_on_success(monkeypatch):
    fake_content = {"root": {"tag": "div", "style": {}, "children": []}}
    captured_kwargs = {}

    # 2026-07-29（方案 B）：一个总览页现在设计两版——先按 preferredDevice
    # 那一档，再补一版 phone。所以这里逐次记录，不能只看最后一次的 kwargs。
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        captured_kwargs.update(kwargs)
        calls.append(kwargs.get("device"))
        assert "订单总数" in brief
        # 每次返回**新对象**：返回同一个 dict 的话，挂 mobile 时会造出自引用
        return {"root": dict(fake_content["root"])}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "desktop"},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    overview = result["page"]["pages"][0]["freeformOverview"]
    # 默认那份仍是 preferredDevice 档的设计
    assert overview["root"] == fake_content["root"]
    # 手机档另挂一份（形状照 react-grid-layout 的 layouts 键控回退）
    assert overview["mobile"]["root"] == fake_content["root"]
    assert calls == ["desktop", "phone"]
    assert captured_kwargs["theme_id"] == "forest"
    # 原有固定骨架字段必须原样保留——freeformOverview 是追加，不是替换
    assert result["page"]["pages"][0]["stats"]


def test_enrich_fails_open_on_generation_error(monkeypatch):
    def fake_generate(*args, **kwargs):
        raise FreeformGenerationError("boom")

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    page = result["page"]["pages"][0]
    assert "freeformOverview" not in page
    assert page["stats"]  # 固定骨架数据没被动过


def test_enrich_covers_dashboard_pages(monkeypatch):
    """2026-07-27:dashboard 页也纳入设计版式——此前只认 monitor,LLM 把总览
    页写成 dashboard 或夹具用 dashboard 时,首页恒回固定骨架(用户实测)。"""
    called = []

    def fake_generate(*args, **kwargs):
        called.append(kwargs.get("device"))
        return {"root": {"tag": "div", "style": {}, "children": []}}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {"pages": [{"id": "d1", "kind": "dashboard", "stats": [{"id": "s"}]}]},
    }
    result = enrich_monitor_page_overviews(model)
    # 一页两次：默认档（未声明 preferredDevice → 空串）+ 手机档（方案 B）
    assert called == ["", "phone"]
    assert "freeformOverview" in result["page"]["pages"][0]


# ── 参照板尺寸与密度预算（2026-07-29 从 4K 改回 1672x941）──────────────


def test_sheet_size_matches_prompt_canvas():
    """请求尺寸与 prompt 里写的画布尺寸必须对得上。

    这两处分开写在两个地方（常量 + prompt 文案），改一处忘一处的话，模型会
    按一个尺寸构图、实际画布是另一个尺寸，比例直接歪掉。这里钉住它们同步。

    注意端点会**降档**：传 1792x1024 实收 1672x941（活体探针记录见
    _SHEET_IMAGE_SIZE 上方）。prompt 里要写的是**实收**尺寸——模型按它构图。
    """
    from services.freeform_block import _SHEET_IMAGE_SIZE, _build_overview_sheet_prompt

    assert _SHEET_IMAGE_SIZE == "1792x1024"
    prompt = _build_overview_sheet_prompt("测试", {"entities": []}, theme_id="tangerine")
    assert "1672x941" in prompt
    assert "3840" not in prompt


def test_sheet_prompt_carries_density_budget():
    """降分辨率必须同步收密度，否则元素挤成一团、中文糊掉。

    真正让参照失效的不是像素总数不够，是**每个元素分到的像素**不够——
    所以三处上限（图表/动态行/图标）跟画布尺寸是一组，不能只改一个。
    """
    from services.freeform_block import _build_overview_sheet_prompt

    prompt = _build_overview_sheet_prompt("测试", {"entities": []}, theme_id="tangerine")
    assert "最多 2 张图" in prompt      # 桌面图表区
    assert "最多 3 行" in prompt        # 手机动态列表
    assert "6 个就够" in prompt         # 图标样例
    assert "宁可留白也不要塞满" in prompt


def test_sheet_prompt_anchors_component_look_to_the_real_libraries():
    """参照板的控件长相要锚到**真实渲染用的那两个库**。

    此前只写「卡片白底细边框、图标简洁线性」这类形容词，模型每次自己发挥一版，
    而运行时是拿 antd / antd-mobile 渲染的——参照图画个大圆角胶囊按钮、真实
    渲染是小圆角方按钮，设计 LLM 照图排版就会算错尺寸。

    配色必须**明令排除**：Ant Design 的品牌蓝跟这个词绑得太死，不写这句实测
    会把整张板画成蓝的，主题色板白给。
    """
    from services.freeform_block import _build_overview_sheet_prompt

    prompt = _build_overview_sheet_prompt("测试", {"entities": []}, theme_id="tangerine")
    assert "Ant Design" in prompt and "Ant Design Mobile" in prompt
    assert "不要用 Ant Design 默认的蓝色" in prompt
    assert "不许出现 Ant Design / antd 字样" in prompt


def test_sheet_prompt_has_a_checkable_min_glyph_height():
    """密度约束必须是**能判定的下限**，不能只写「宁可留白」这种形容词。

    实测：加了 Ant Design 形态指令后模型画得更充实（表格 6 列 + 进度条 +
    多一张 KPI 卡），密度预算被抵消，小字糊成乱码（「按钮样例」→「栎钮样例」、
    手机区环图图例整片认不出）。改成字高下限之后，模型自己砍密度换清晰度，
    同一档画布上小字恢复可读。
    """
    from services.freeform_block import _build_overview_sheet_prompt

    prompt = _build_overview_sheet_prompt("测试", {"entities": []}, theme_id="tangerine")
    assert "1.5%" in prompt
    assert "不许靠缩小字号" in prompt
