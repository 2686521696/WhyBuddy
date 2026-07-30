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
    两处上限（图表/动态行）跟画布尺寸是一组，不能只改一个。
    （图标样例那条上限随「样式风格」区一起去掉了，见
    test_sheet_prompt_draws_only_real_layouts_no_style_tile。）
    """
    from services.freeform_block import _build_overview_sheet_prompt

    prompt = _build_overview_sheet_prompt("测试", {"entities": []}, theme_id="tangerine")
    assert "最多 2 张图" in prompt      # 桌面图表区
    assert "最多 3 行" in prompt        # 手机动态列表
    assert "上限不是目标" in prompt
    assert "1.5%" in prompt             # 字高下限——密度换清晰度的判定线


def test_sheet_prompt_draws_only_real_layouts_no_style_tile():
    """参照板不再画「样式风格」区（色板色块/图标样例/字号层级示意）。

    Style Tile（Samantha Warren 2011）那套交付物是给**人**看的——先定调性
    再谈页面。但这张图的读者是设计 LLM，而调性信息它已经以**文字**形式拿到
    了（build_freeform_prompt 里 _theme_prompt_fragment 直接把主色/背景/图表
    色列给它），图上再画一遍色块是重复信息，却实打实吃掉画布面积和密度预算。
    参照一份已验证过的第三方技能包提示词写法：整张只画一页真实界面，没有任何
    色板拼贴（同一结论也是 c425911 改单区块参照图的依据）。

    三档都要干净——只要有一档漏了，那一档的画布就又被样例吃回去。
    """
    from services.freeform_block import _build_overview_sheet_prompt

    for device in ("desktop", "phone", ""):
        prompt = _build_overview_sheet_prompt(
            "测试", {"entities": []}, theme_id="tangerine", device=device
        )
        assert "样式风格" not in prompt, f"{device!r} 档还在画样式风格区"
        assert "色板色块" not in prompt, f"{device!r} 档还在画色板样例"
        assert "字号层级" not in prompt, f"{device!r} 档还在画字号层级示意"
        # "style sheet" 这个词本身就在把模型往色板拼贴上引，一并去掉。
        assert "style sheet" not in prompt, f"{device!r} 档措辞还在自称 style sheet"
        assert "不是色板拼贴" in prompt, f"{device!r} 档缺少明令：不要画成色板拼贴"


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


def test_sheet_prompt_drops_the_unused_zone_when_device_is_declared():
    """07-30 补漏：明说 desktop/phone 时参照板不该再画那个不会用到的档。

    `enrich_monitor_page_overviews` 判定 preferredDevice 明说桌面时，压根
    不会再跑手机档那次 freeform 设计生成（见上面 test_declared_desktop_
    skips_the_phone_design），但参照板 prompt 此前没接 device 参数，一直
    无条件画所有档——等于让生图模型白画一块永远用不到的 mockup，还挤占了
    真正要用的那档的画布份额。这里钉住：明说哪档就只画哪档。
    """
    from services.freeform_block import _build_overview_sheet_prompt

    # 只查"版式区"这个概念本身在不在，不要用「手机」/「桌面」这种裸词做
    # not-in 断言——占位文案示例里正当地出现过「手机号写成 138-…」，裸词一撞
    # 就误判（2026-07-30 真踩过一次）。
    desktop_prompt = _build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    for phone_zone_marker in ("手机首页", "手机屏", "手机端总览界面", "手机轮廓"):
        assert phone_zone_marker not in desktop_prompt, \
            f"明说桌面档，参照板不该再画手机 mockup（命中「{phone_zone_marker}」）"
    assert "桌面端后台界面" in desktop_prompt

    phone_prompt = _build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="phone"
    )
    for desktop_zone_marker in ("桌面首页", "PC 内容区", "桌面端的总览版式"):
        assert desktop_zone_marker not in phone_prompt, \
            f"明说手机档，参照板不该再画桌面 mockup（命中「{desktop_zone_marker}」）"
    assert "手机端总览界面" in phone_prompt

    unspecified_prompt = _build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device=""
    )
    assert "桌面首页" in unspecified_prompt and "手机首页" in unspecified_prompt, \
        "判不出来时仍要保守地两档都画（同一条只在明确时才砍的纪律）"


def test_declared_desktop_skips_the_phone_design(monkeypatch):
    """明说 preferredDevice=desktop 时不再多花一次调用去设计手机版式。

    这是 07-30 的省时点。此前是无条件两档都生成，而扫过真实数据后发现 9 个
    应用的 preferredDevice **全是 desktop**——不是它们真都是桌面应用，是生成
    契约里这个字段只声明了合法域、没给判据，模型无从选择。于是那次调用几乎
    每轮都在为一个没人做过的判断买单（约 67s/总览页）。契约补了姿态判据之后
    这个字段有意义了，就该用它省掉这次调用。
    """
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(kwargs.get("device"))
        return {"root": {"tag": "div", "style": {}, "children": []}}

    monkeypatch.setattr("services.freeform_block.generate_freeform_block", fake_generate)
    monkeypatch.setattr("services.freeform_block._generate_overview_sheet_b64", lambda *a, **k: None)
    model = {
        "datamodel": _datamodel(),
        "appbundle": {"appIdentity": {"theme": "forest"}, "preferredDevice": "desktop"},
        "page": {"pages": [_monitor_page()]},
    }
    result = enrich_monitor_page_overviews(model)
    assert calls == ["desktop"], f"明说桌面档却还生成了别的档: {calls}"
    assert "mobile" not in result["page"]["pages"][0]["freeformOverview"], \
        "桌面档不该挂 mobile 键——挂了前端会去渲一个没设计过的档"


def test_desktop_sheet_draws_the_shell_and_design_llm_is_told_it_is_background():
    """参照图画完整外壳（方案 A），但必须同时告诉设计 LLM 那是背景。

    A/B 实测（同一份 brief，只换固定尾巴）：照第三方技能包那样把外壳件逐个
    点名（顶部导航 + 主操作区 + 列表/卡片/侧栏），出图是一个**完整产品**；
    我们原来那句"不要画侧边栏和顶栏"出的是光秃秃一块内容区。人工反馈的
    "整体质量高一大截"，很大一部分就是这个"有壳"。

    但外壳在真实运行时是 AppRuntimeScreen 用 antd 画的固定壳，不归 freeform
    设计管。**这两处必须成对存在**：参照图里有壳、而图片说明里没写"壳是背景"，
    设计 LLM 就会照着图把导航搭进内容树，等于在内容区里又画一遍侧栏。
    这条测试就是钉住这一对，防止将来只改一处。
    """
    import inspect

    from services.freeform_block import _build_overview_sheet_prompt, generate_freeform_block

    sheet = _build_overview_sheet_prompt(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    assert "左侧一条竖向导航栏" in sheet, "参照图该画外壳了"
    assert "主内容区是画面的主角" in sheet, "外壳不能喧宾夺主"
    assert "不要画左侧侧边栏和顶栏" not in sheet, "旧的禁画外壳措辞该撤掉"

    # 配套那半：图片说明里必须写清楚外壳是背景、不归设计 LLM 管。
    src = inspect.getsource(generate_freeform_block)
    assert "只是背景" in src, "参照图画了壳，就必须告诉设计 LLM 那是背景"
    assert "不要在你的内容树里搭导航菜单" in src, "要明令禁止把外壳搭进内容树"


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
