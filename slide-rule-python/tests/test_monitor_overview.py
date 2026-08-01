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
    _build_overview_sheet_facts,
    _monitor_overview_design_brief,
    _sheet_image_size_for_device,
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


def test_design_brief_demands_placing_every_declared_block():
    """2026-08-01：安置语义从**许可式**改成**祈使式 + 说清代价**。

    此前那句是"如果这一页还适合……就摆一个……用不上就完全不用，不必凑数"，
    读起来是道选择题。但列出来的积木并不是备选项——它们是这一页已经声明、
    一定会被渲染的东西：设计者不安置，它们不会消失，只会掉到设计区外面的固定
    骨架里，首页又变回"AI 设计区 + 几张外挂卡"。

    这个改法有本仓库两次先例撑腰（schema_legal 里许可式让七个通电区块一个都
    没被用、binding 哨兵词 "none" 被当成值），所以这里锁死三件事：说了"必须"、
    说了"不会消失"的代价、且**不再留"用不上就完全不用"那个逃生口**。
    """
    brief = _monitor_overview_design_brief(_monitor_page(), _datamodel())
    assert "不是备选项" in brief
    assert "必须" in brief
    assert "不会消失" in brief
    # 旧的许可式逃生口必须已经拿掉，否则祈使式会被它当场抵消
    assert "用不上就完全不用" not in brief


def test_design_brief_has_no_placement_demand_without_blocks():
    """没有可安置积木的页面不该出现那段祈使话术（否则是对着空气下命令）。"""
    page = {
        "id": "home", "name": "首页", "kind": "monitor",
        "stats": [{"id": "s1", "name": "总数", "metric": "count", "entity": "appointment"}],
        "charts": [], "rankings": [], "feeds": [], "blocks": [],
    }
    brief = _monitor_overview_design_brief(page, _datamodel())
    assert "不是备选项" not in brief


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
        # 2026-07-30：这条测的是「两档都设计」，所以**不能**声明 preferredDevice
        # ——明说 desktop 现在会跳过手机档（那条路径由下面两条新测试覆盖）。
        "appbundle": {"appIdentity": {"theme": "forest"}},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    overview = result["page"]["pages"][0]["freeformOverview"]
    # 默认那份仍是 preferredDevice 档的设计
    assert overview["root"] == fake_content["root"]
    # 手机档另挂一份（形状照 react-grid-layout 的 layouts 键控回退）
    assert overview["mobile"]["root"] == fake_content["root"]
    assert calls == ["", "phone"]  # 未声明设备档 → 默认档 + 手机档
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
    """请求尺寸与 prompt 里写的画布尺寸必须对得上，**逐档对**。

    这两处分开写在两个地方（常量 + prompt 文案），改一处忘一处的话，模型会
    按一个尺寸排布、实际画布是另一个尺寸，比例直接歪掉。这里钉住它们同步。

    2026-07-31 换到 api.xiaoleai.team 之后这条更要紧了：这家**逐像素认 size**
    （传什么回什么，实测记录见 _DEVICE_IMAGE_SIZE 上方），不像上一家那样无论
    传什么都降档回同一个横版尺寸。所以 prompt 里报的必须是真正传出去的那个值，
    而且手机档要跟桌面档报不一样的数——写死一个常量就等于手机档报错尺寸。
    """
    from services.freeform_block import (
        _build_overview_sheet_prompt,
        _sheet_image_size_for_device,
    )

    for device in ("desktop", "phone", ""):
        size = _sheet_image_size_for_device(device)
        prompt = _build_overview_sheet_prompt(
            "测试", {"entities": []}, theme_id="tangerine", device=device
        )
        assert size in prompt, f"{device!r} 档 prompt 里没报出真实画布 {size}"

    # 手机竖、桌面横：形状由 size 参数保证，不再只靠 prompt 措辞掰。
    pw, ph = (int(x) for x in _sheet_image_size_for_device("phone").split("x"))
    dw, dh = (int(x) for x in _sheet_image_size_for_device("desktop").split("x"))
    assert pw < ph, "手机档必须是竖版画布"
    assert dw > dh, "桌面档必须是横版画布"
    # device 没明说时跟桌面档一致——那一支要并排画两块，本身就是横版。
    assert _sheet_image_size_for_device("") == _sheet_image_size_for_device("desktop")


def test_facts_carry_only_what_the_model_cannot_derive():
    """事实清单只装四类事实，**一条做法都不许有**。

    2026-07-31 重构：此前这里钉的是"砍四类留四类"那份写死模板的边界。那套
    模板每一条都有出图证据，问题出在它对每个应用说同一句话——实测两个完全
    不同业务的出图提示词逐字相同 87%，能变的 13% 全是色值/字段名/内容清单，
    没有一个字关于"怎么排"。所以做法整体挪给 refine 那一步按业务现写，这里
    只保留模型自己推不出来的事实。

    这条守的是**边界不许回流**：谁要是图省事又把"顶部一行指标卡"塞回事实里，
    多样性立刻回到写死模板的水平，而且不会有任何报错。
    """
    facts = _build_overview_sheet_facts(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    # 四类事实都在
    assert "画布：" in facts
    assert "设备档：" in facts
    assert "这一页要覆盖的内容范围" in facts
    assert "身份色板" in facts and "主色" in facts

    # 做法一条都不许有
    for banned in (
        "顶部一行", "最多 2 张图", "多列横向排布",     # 版式处方
        "20XX-XX-XX", "138-", "一个真实数据都不许出现",  # 占位写法
        "技术标识", "blockRef",                        # 技术标识禁令
        "水印", "画面撑满画布",                        # 水印/铺满
        "信息层级必须画满", "一项都不许漏",             # 信息层级清单
        "字高", "Ant Design",                          # 密度预算 / 控件形态
    ):
        assert banned not in facts, f"事实清单里混进了做法：{banned}"


def test_facts_state_the_device_tier_and_canvas_consistently():
    """设备档与画布必须同时出现且互相自洽——竖版画布配"桌面端"会让改写 LLM
    按宽屏排布，出图却是竖的。两处分开写就一定会分叉，这里钉住。"""
    for device, is_portrait in (("desktop", False), ("phone", True), ("", False)):
        facts = _build_overview_sheet_facts(
            "测试", {"entities": []}, theme_id="tangerine", device=device
        )
        canvas = _sheet_image_size_for_device(device)
        assert canvas in facts
        w, h = (int(x) for x in canvas.split("x"))
        assert (w < h) is is_portrait
        assert ("竖版画布" in facts) is is_portrait


def test_prompt_falls_back_to_facts_when_refine_fails(monkeypatch):
    """改写失败必须静默退回事实清单——绝不能让"想写得更好"把整条链路弄挂。

    与 _generate_overview_sheet_b64 同一套 fail-open 纪律。测试环境本来就没配
    LLM，但这里显式打桩，免得哪天有了默认 provider 让这条用例失去意义。
    """
    import services.freeform_block as fb

    monkeypatch.setattr(fb, "_refine_sheet_prompt_via_llm", lambda *a, **k: None)
    facts = fb._build_overview_sheet_facts(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    prompt = fb._build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    assert prompt == facts


def test_prompt_uses_the_refined_text_when_refine_succeeds(monkeypatch):
    """改写成功时，最终提示词就是改写结果本身——不再跟旧模板拼接。

    "作为最终内容覆盖"是这次重构的原话：拼接会让写死的做法从后门回来。
    """
    import services.freeform_block as fb

    refined = "改写后的提示词" * 30
    monkeypatch.setattr(fb, "_refine_sheet_prompt_via_llm", lambda *a, **k: refined)
    prompt = fb._build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    assert prompt == refined


def test_refine_meta_prompt_still_guards_the_two_proven_bugs():
    """做法虽然交给改写 LLM，但两条**有出图证据**的坑必须在元提示词里点名。

    减法实验里唯二"砍掉就复发"的：
      · 技术标识 —— 砍后 brief 里的 blockRef JSON 被当代码块画进图
      · 真实数据 —— 砍后编出一组加起来能对上的自洽假数字，比明显的假数据更危险

    这里不要求元提示词给出逐类字段的形状清单（那正是本次拿掉的），只要求它
    **点到这两件事**，让改写 LLM 自己写出对应的守卫。
    """
    from services.freeform_block import _SHEET_PROMPT_REFINE_SYSTEM as sys_prompt

    assert "技术标识" in sys_prompt and "blockRef" in sys_prompt
    assert "不能出现任何真实数据" in sys_prompt
    assert "占位形状" in sys_prompt
    # 版式要交给业务性质决定，且明确反掉通用后台网格
    assert "通用后台网格" in sys_prompt
    # 只出正文，别裹 markdown——裹了会被原样喂给生图模型
    assert "不要 markdown 代码块" in sys_prompt


def test_parallel_refine_preserves_order_and_isolates_failures(monkeypatch):
    """批量改写并发发出，但**返回顺序必须与入参一致**，单个失败不拖垮整批。

    顺序错位是这类改造最容易出的错，而且不会报错——只会让手机档拿到桌面档的
    提示词，出图形状全错。
    """
    import services.freeform_block as fb

    def fake(facts, *, device=""):
        if "坏" in facts:
            raise RuntimeError("boom")
        return facts + "|refined" + str(len(facts) * 4)

    monkeypatch.setattr(fb, "_refine_sheet_prompt_via_llm", fake)
    items = [("A", "desktop"), ("坏", "phone"), ("CCC", "desktop")]
    out = fb.refine_sheet_prompts_parallel(items)
    assert len(out) == 3
    assert out[0].startswith("A|refined")
    assert out[1] is None, "失败位置必须是 None，不能塌缩掉"
    assert out[2].startswith("CCC|refined")


def test_desktop_sheet_no_longer_hardcodes_shell_rules():
    """参照图不画外壳这条**从提示词挪走了**，但设计侧那半必须留着。

    两处原本成对：参照图里说"不要画侧边栏"，generate_freeform_block 里说
    "不要在你的内容树里搭这些"。前一半属于"做法"，归改写 LLM 管了；后一半是
    对设计 LLM 的硬约束，跟参照图画不画壳无关，不能跟着一起消失。
    """
    import inspect

    from services.freeform_block import generate_freeform_block

    src = inspect.getsource(generate_freeform_block)
    assert "不要在你的内容树里搭这些" in src, "要明令禁止把外壳搭进内容树"


def test_sheet_generation_receives_the_declared_device(monkeypatch):
    """`enrich_monitor_page_overviews` 必须把 device 转给参照板生成函数，
    不能只转给版式 JSON 生成——两处漏一处，参照板就会继续白画多余的档。"""
    sheet_calls = []

    def fake_sheet(brief, datamodel, **kwargs):
        sheet_calls.append(kwargs.get("device"))
        return None

    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", fake_sheet)
    monkeypatch.setattr("services.freeform_block._supports_image_content_parts", lambda: True)
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: {"root": {"tag": "div", "children": []}},
    )
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "desktop"},
        "page": {"pages": [_monitor_page()]},
    }
    enrich_monitor_page_overviews(model)
    assert sheet_calls == ["desktop"], f"参照板生成没收到 device: {sheet_calls}"


def test_declared_phone_designs_only_the_phone_layout(monkeypatch):
    """明说手机档时也只生成一次（原本就是这样，这条把它钉住）。"""
    calls = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("device")),
                                        {"root": {"tag": "div", "children": []}})[1],
    )
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "phone"},
        "page": {"pages": [_monitor_page()]},
    }
    enrich_monitor_page_overviews(model)
    assert calls == ["phone"], f"明说手机档却生成了别的档: {calls}"


def test_unspecified_device_still_designs_both(monkeypatch):
    """判不出来时仍然两档都生成——**只在明确的时候才砍**。

    宁可多花一分钟，也不要让用户切到手机档看见一个被 CSS 掰弯的桌面版式。
    这条纪律跟入站判定那侧同源（device 缺省是 unspecified 而不是 desktop）。
    """
    calls = []
    monkeypatch.setattr(
        "services.freeform_block.generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("device")),
                                        {"root": {"tag": "div", "children": []}})[1],
    )
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}},
        "page": {"pages": [_monitor_page()]},
    }
    enrich_monitor_page_overviews(model)
    assert "phone" in calls, f"未声明设备档时应仍设计手机版式: {calls}"


def test_generation_contract_teaches_how_to_pick_the_device():
    """契约里必须有「怎么选 preferredDevice」这段判据，而且必须是姿态口径。

    只声明合法域不给判据的后果是实测出来的：9 个真实应用 9 个 desktop，字段是
    死的，下游那个省时判断（明说桌面就跳过手机档）也就无从做起。两个方向的
    坑也要在正文里——只教一个方向，模型会把所有现场词都往那一边推。
    """
    from services.schema_legal import experience_block_prompt_block

    body = experience_block_prompt_block()
    assert "preferredDevice" in body
    assert "POSTURE" in body.upper(), "判据必须是姿态，不是关键词"
    assert "courier" in body and "dispatcher" in body, "缺「带现场词的后台需求」这一向"
    assert "inspection work order" in body and "walking around" in body, \
        "缺「带后台词的现场需求」这一向"
    assert "OMIT the field" in body, "没告诉模型判不出来就别写——那才是默认两档都生成的入口"


# ── monitor 页放开 page.blocks（2026-07-31）─────────────────────────────


def _monitor_page_with_blocks():
    page = _monitor_page()
    page["blocks"] = [
        {"id": "qa", "type": "QuickActionPanel", "props": {"title": "常用操作", "columns": 3}},
        {"id": "wf", "type": "WorkflowTimeline", "props": {"title": "审批流程", "chainRef": "chain_main"}},
    ]
    return page


def test_brief_lists_binding_free_blocks_without_an_empty_binding():
    """不吃 binding 的积木不能被拼成 "binding": {}。

    QuickActionPanel 的按钮来自 page.actions、WorkflowTimeline 的节点从 workflow
    机械派生（见目录里两者的 bindingSchema.note）。给它们摆一个空 binding，等于
    在提示模型"这里该填点什么"，而它填什么都是错的——下游 blockRef 深校验会以
    unknown key 拒掉，整块设计白生成一轮。
    """
    brief = _monitor_overview_design_brief(_monitor_page_with_blocks(), _datamodel())
    assert '"type": "QuickActionPanel"' in brief
    assert '"type": "WorkflowTimeline"' in brief
    assert '"binding": {}' not in brief
    # chainRef 是 props 不是 binding，要原样带出去，否则模型只能瞎猜画哪条链路
    assert '"chainRef": "chain_main"' in brief
    # 吃 binding 的那一类照旧带 binding
    assert '"type": "ActivityFeed"' in brief
    assert '"entityRef": "ticket"' in brief


def test_brief_separates_row_content_from_action_and_process_blocks():
    """两类积木分段写——「逐行内容」这个说法套不到动作面/流程面上。

    合在一段的代价不是措辞难看：设计 LLM 是按"这是什么内容"决定放哪的，
    把一排操作按钮说成"逐行内容"，它就会照着逐行内容的惯例塞到页面最下面。
    """
    brief = _monitor_overview_design_brief(_monitor_page_with_blocks(), _datamodel())
    assert "非数据面的成品积木" in brief
    row_section = brief.split("这一页还声明了下面这些**非数据面")[0]
    assert "QuickActionPanel" not in row_section, "动作面不该混进逐行内容那一段"
    assert "ActivityFeed" in row_section


def test_generation_contract_no_longer_exempts_monitor_pages_from_blocks():
    """生成契约必须明说 monitor 页也要摆积木。

    此前两处合起来把总览页排除在外——祈使句只点名 workbench/kanban/calendar/
    wizard，CHANNEL OWNERSHIP 又说"monitor 页照常声明 stats/charts"。实测后果：
    19 个真实页面里 page.blocks 声明数 0，QuickActionPanel / WorkflowTimeline
    这两个 generationEnabled=true 的区块从未被生成过。
    """
    from services.schema_legal import experience_block_prompt_block

    text = experience_block_prompt_block()
    assert "monitor / dashboard pages are NOT exempt" in text
    # KPI/趋势区块的禁令仍在，且明确写清它只管这两类，不是禁掉整个 page.blocks
    assert "Do NOT emit MetricGrid or TrendChart blocks there" in text
    assert "not a ban on page.blocks for overview pages" in text
    # 放行名单从目录派生，且不含被 CHANNEL OWNERSHIP 挡掉的三类
    for banned in ("MetricGrid", "TrendChart", "DataTable"):
        seg = text.split("monitor / dashboard pages are NOT exempt")[1].split("\n")[0]
        assert banned not in seg, f"{banned} 不该出现在总览页的放行名单里"


def test_generation_contract_json_skeleton_exposes_blocks():
    """光在说明里讲不够——JSON 骨架里没有 blocks 键，模型不知道往哪写。

    骨架和说明是两处，历史上分叉过（07-28 那次补了说明没补骨架，仍然 0 产出）。
    这条把两处钉在一起。
    """
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    page_section = _SCHEMA_INSTRUCTION.split('"page": {')[1].split('"aigc": {')[0]
    assert '"blocks": [' in page_section, "page 骨架里必须有 blocks 键"
    assert '"type": "<experience block type>"' in page_section


def test_image_audience_brief_carries_no_technical_identifiers():
    """参照板出图的 brief 里不许出现 blockRef/binding/JSON 这类技术标识。

    这份 brief 被 _build_overview_sheet_facts 整段照抄进出图提示词。此前两个
    受众共用一份（blockRef 的技术形态），后果是生图模型读到
    {"type": "ActivityFeed", "binding": {...}} 无从知道该画什么——参照板上
    一直没有这些积木，原因在此，不是它判断"这一页不需要"。架构图那条
    "画面里不许出现 JSON/字段id/blockRef 等技术标识"针对的也是这里。
    """
    page = _monitor_page()
    page["blocks"] = [
        {"id": "acts", "type": "QuickActionPanel", "props": {"title": "常用操作"}},
        {"id": "flow", "type": "WorkflowTimeline", "props": {}},
    ]
    img = _monitor_overview_design_brief(page, _datamodel(), audience="image")
    for forbidden in ("blockRef", "binding", '{"type"', "照抄"):
        assert forbidden not in img, f"出图 brief 混进了技术标识: {forbidden}"


def test_image_audience_brief_describes_blocks_visually():
    """同一批积木要以**画得出来**的形态告诉生图模型，不能只是删掉技术形态。

    只清理不补描述的话，参照板会缺掉这一页真实存在的内容，设计 LLM 拿到的
    参照图就与它自己的 brief 对不上。
    """
    page = _monitor_page()
    page["blocks"] = [
        {"id": "acts", "type": "QuickActionPanel", "props": {"title": "常用操作"}},
        {"id": "flow", "type": "WorkflowTimeline", "props": {}},
    ]
    img = _monitor_overview_design_brief(page, _datamodel(), audience="image")
    assert "一排常用操作按钮" in img
    assert "一条横向流程阶段条" in img


def test_design_audience_keeps_blockref_mechanics():
    """设计 LLM 那一份必须保留技术形态——它的产出要能被渲染器认出来。"""
    page = _monitor_page()
    page["blocks"] = [{"id": "acts", "type": "QuickActionPanel", "props": {"title": "常用操作"}}]
    des = _monitor_overview_design_brief(page, _datamodel())
    assert "blockRef" in des
    assert '{"type"' in des
