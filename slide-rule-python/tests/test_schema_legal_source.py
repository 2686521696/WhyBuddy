"""E40.1：合法域单一真相源——四方派生的 parity 锁。

账本 = services/data/five_system_legal.json。这里锁三方（门/修复器/生成
契约）与账本逐字一致；客户端渲染器的 parity 由 vitest 侧
legal-domains-parity.test.ts 锁（同读同一份 JSON）。任何一方私自扩枚举、
或改了账本但没跟上派生，这里当场红——E37 式漏账的机械防线。
"""

from services import schema_legal
from services.v5_model_gate import (
    CHART_TYPES,
    EXPERIENCE_BLOCK_TYPES,
    FIELD_TONES,
    NUMBER_FORMATS,
    PAGE_KINDS,
    STAT_FORMATS,
    STRING_FORMATS,
)


def test_gate_constants_are_the_ledger():
    """门的常量必须就是账本对象本身（re-export，不是抄写）。"""
    assert FIELD_TONES is schema_legal.FIELD_TONES
    assert NUMBER_FORMATS is schema_legal.NUMBER_FORMATS
    assert STRING_FORMATS is schema_legal.STRING_FORMATS
    assert STAT_FORMATS is schema_legal.STAT_FORMATS
    assert PAGE_KINDS is schema_legal.PAGE_KINDS
    assert CHART_TYPES is schema_legal.CHART_TYPES
    assert EXPERIENCE_BLOCK_TYPES is schema_legal.EXPERIENCE_BLOCK_TYPES


def test_loader_matches_json_ledger():
    snap = schema_legal.legal_snapshot()
    assert tuple(snap["fieldTones"]) == schema_legal.FIELD_TONES
    assert tuple(snap["pageKinds"]) == schema_legal.PAGE_KINDS
    assert tuple(snap["chartTypes"]) == schema_legal.CHART_TYPES
    assert tuple(snap["statFormats"]) == schema_legal.STAT_FORMATS
    assert tuple(snap["metricBare"]) == schema_legal.METRIC_BARE
    assert tuple(snap["chartMetricPrefixes"]) == schema_legal.CHART_METRIC_PREFIXES
    assert tuple(snap["statMetricPrefixes"]) == schema_legal.STAT_METRIC_PREFIXES


def test_experience_block_catalog_is_structurally_closed():
    catalog = schema_legal.experience_block_catalog_snapshot()
    blocks = catalog["blocks"]
    assert tuple(block["type"] for block in blocks) == schema_legal.EXPERIENCE_BLOCK_TYPES
    assert tuple(block["rendererKey"] for block in blocks) == schema_legal.EXPERIENCE_BLOCK_RENDERER_KEYS
    assert len(set(schema_legal.EXPERIENCE_BLOCK_TYPES)) == len(blocks)
    assert len(set(schema_legal.EXPERIENCE_BLOCK_RENDERER_KEYS)) == len(blocks)
    for block in blocks:
        assert set(block["dataKinds"]) <= set(catalog["dataKinds"])
        assert set(block["allowedRegions"]) <= set(catalog["pageRegions"])
        assert set(block["events"]) <= set(catalog["eventTypes"])


def test_repair_shares_gate_chart_types():
    from services.v5_model_repair import _CHART_TYPES

    assert _CHART_TYPES is schema_legal.CHART_TYPES


def test_schema_instruction_renders_from_ledger():
    """生成契约的枚举段 = 账本渲染；不残留占位符，不残留手抄串。"""
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION

    assert "__" not in _SCHEMA_INSTRUCTION, "契约中不允许残留 __TOKEN__ 占位"
    assert schema_legal.enum_str("fieldTones") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("numberFormats", "stringFormats") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("pageKinds") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("statFormats") in _SCHEMA_INSTRUCTION
    assert schema_legal.enum_str("chartTypes") in _SCHEMA_INSTRUCTION
    # metric 形态按 bare+前缀拼装（与门/修复器判定同源）
    assert "count|sum:<entity_id>.<field_id>|avg:<entity_id>.<field_id>" in _SCHEMA_INSTRUCTION
    assert '"metric": "count|sum:<entity_id>.<field_id>"' in _SCHEMA_INSTRUCTION
    # page.blocks 的放开名单由目录 generationEnabled 派生（2026-07-27）。
    # 此前这里断言的是一刀切禁令 "DO NOT emit page.blocks for production
    # pages"——那句话在渲染器陆续落地后过期了五天，把已经能用的区块一直
    # 关在门外，所以断言随语义一起换成"名单来自目录"。
    _enabled = [
        str(b["type"]) for b in schema_legal.EXPERIENCE_BLOCKS if b.get("generationEnabled")
    ]
    if _enabled:
        # 2026-07-28：只锁"名单整串来自目录"，不锁包着它的措辞。措辞从许可式
        # 改成祈使式那次（实测：0 个积木 → 8~9 个），这条曾因为钉死了
        # "ONLY these types are renderable today: " 这句话而误报。
        assert ", ".join(_enabled) in _SCHEMA_INSTRUCTION
    else:
        assert "DO NOT emit page.blocks for production pages" in _SCHEMA_INSTRUCTION
    for block_type in schema_legal.EXPERIENCE_BLOCK_TYPES:
        assert f"- {block_type}:" in _SCHEMA_INSTRUCTION


def test_gate_still_blocks_off_ledger_values():
    """接线后语义不变：账本外的值照拦（拿 E37 的 avg: 图表案例回归）。"""
    from services.v5_model_gate import validate_five_system_model

    model = {
        "datamodel": {"entities": [{"id": "t", "name": "T", "fields": [
            {"id": "s", "name": "S", "type": "enum",
             "options": [{"id": "a", "label": "A", "tone": "sparkly"}]},
        ]}]},
        "rbac": {"roles": ["r"], "permissions": ["t:view"],
                 "menus": [{"id": "m", "label": "M", "roleRefs": ["r"], "permissionRefs": ["t:view"]}]},
        "workflow": {"id": "wf", "nodes": [{"id": "n1", "name": "N", "assigneeRole": "r"}],
                     "transitions": []},
        "page": {"pages": [{"id": "p", "name": "P", "kind": "hologram",
                            "fieldBindings": ["t.s"], "actionPermissions": ["t:view"],
                            "charts": [{"id": "c", "type": "sparkline", "dimension": "t.s", "metric": "count"}]}]},
        "aigc": {"capabilities": []},
        "appbundle": {"pageBindings": [{"pageRef": "p", "workflowRef": "wf"}],
                      "roleRefs": ["r"], "dataModelRefs": ["t"]},
    }
    verdict = validate_five_system_model(model)
    assert verdict["passed"] is False
    refs = {f.get("ref") for f in verdict["findings"]}
    assert "sparkly" in refs      # 非法 tone
    assert "hologram" in refs     # 非法页面范式
    assert "sparkline" in refs    # 非法图表形态


def test_monitor_pages_carry_an_explicit_block_prohibition():
    """2026-08-01：总览页的禁用积木必须是**显式禁令**，不能只是"不在推荐清单里"。

    实测教训：先只把 FilterBar 从 monitor_ok 移除，重跑一轮 dashboard 页照样
    声明了 analytics_filters——目录里它仍是通电区块，没有任何一句说总览页不许
    用，模型按语义直觉("总览页该有个筛选条")就补上了。

    所以这里锁三件事：说了 NEVER、该点名的都在**禁令那一句里**、且给了理由
    （本仓库反复验证过只丢名单不给理由时模型会照旧按直觉猜）。

    2026-08-11：判据从"四个名字"换成"三个名字 + capability==filter 整族"。
    原注释自己写过"是同一个洞，只是还没撞上"——撞上了：`filterChange` 在总览页
    够不到任何东西这条理由是**机械的**（KPI/图表/积木/设计树全读未筛全量，只有
    本页的表/看板/日历吃筛过的行），所以 32 个 filter 区块一个不少都得禁，不只
    FilterBar。断言也跟着从"名字在提示词里"改成"名字在禁令句里"——前者太弱，
    这些名字在下面的全目录清单里本来就会出现，禁令句删掉了照样通过。
    """
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    head = "On monitor / dashboard pages, NEVER emit these blocks"
    assert head in prompt
    # 只看禁令那一句，不看整份提示词（区块清单里什么名字都有）
    sentence = prompt[prompt.index(head) : prompt.index(head) + 4000]
    sentence = sentence[: sentence.index("\n")] if "\n" in sentence else sentence

    for t in ("MetricGrid", "TrendChart", "DataTable"):
        assert t in sentence, f"{t} 不在禁令句里"

    # 机械判据：所有 filter 能力的通电区块都必须在禁令句里点名
    filters = [
        str(b["type"])
        for b in schema_legal.EXPERIENCE_BLOCKS
        if b.get("generationEnabled") and str(b.get("capability") or "") == "filter"
    ]
    assert filters, "目录里没有 filter 区块了，这条判据失去意义"
    missing = [t for t in filters if t not in sentence]
    assert not missing, f"这些 filter 区块没被总览页禁令点名：{missing[:8]}"

    # 反面：被禁的不能同时出现在"总览页可以用这些"那句里
    ok_head = "monitor / dashboard pages are NOT exempt"
    ok_sentence = prompt[prompt.index(ok_head) :].split("\n", 1)[0]
    both = [t for t in filters + ["MetricGrid", "DataTable"] if t in ok_sentence]
    assert not both, f"同一份提示词里既禁止又推荐：{both[:8]}"

    # 理由必须在场——筛选那条是最容易被当成"随便定的规矩"的
    assert "cannot filter ANYTHING on an overview" in prompt


#: 总览页禁令与 pageKinds 打架、因而**无处可去**的区块。只准变少，现在是 0。
#:
#: 2026-08-11 把总览页禁令改成机械判据（capability==filter 一律禁）时照出两个：
#: `AnalyticsDateScope` 和 `DashboardParameterBar` 的 pageKinds **只**写了
#: dashboard/monitor，禁令一上就成了"只允许总览页 + 总览页不许用"。
#:
#: 当天收口时按同一条判据修掉了：筛选类区块的归宿是**逐行展示记录的页面**，
#: 所以这两个的 pageKinds 改成 `workbench`——那里 `applyPageFilter` 真的会
#: 收窄表格的行（含 dateRangeField 那条日期范围），控件是活的。
#:
#: 剩下的一句仍然成立：总览页的 KPI/图表照旧不吃 filterState
#: （pageStatDisplay 与 phoneChartNode 都直读 state.entities）。将来若要让
#: 仪表盘像 Grafana 那样"时间范围/模板变量管全页"，那是个功能，届时这条禁令
#: 本身要重新议，不是把这两个区块搬回去。
_OVERVIEW_ONLY_FILTERS_BASELINE = 0


def test_没有更多区块被总览页禁令堵死():
    """禁令是机械判据，可能把"只允许总览页"的区块堵死。这条守住那个数只准变少。

    要让某个 filter 区块重新可用，两条路：给它加一个非总览页型（说明它在
    业务页上确实有用），或者把总览页的 KPI/图表接上 filterState（那时这条
    禁令本身就该重新议）。
    """
    from services import schema_legal

    overview = {"monitor", "dashboard"}
    stranded = sorted(
        str(b["type"])
        for b in schema_legal.EXPERIENCE_BLOCKS
        if b.get("generationEnabled")
        and str(b.get("capability") or "") == "filter"
        and set(b.get("pageKinds") or []) <= overview
    )
    assert len(stranded) <= _OVERVIEW_ONLY_FILTERS_BASELINE, (
        f"又多了被堵死的区块（只允许总览页，而总览页禁止筛选类）：{stranded}。"
        "给它一个非总览页型，或者别把它标成 filter。"
    )
    if len(stranded) < _OVERVIEW_ONLY_FILTERS_BASELINE:
        raise AssertionError(
            f"被堵死的区块降到 {len(stranded)} 个（基线 "
            f"{_OVERVIEW_ONLY_FILTERS_BASELINE}）：{stranded}。"
            "请把 _OVERVIEW_ONLY_FILTERS_BASELINE 改成这个数锁住改善。"
        )


def test_region_restrictions_have_no_unexplained_width_gaps():
    """区域限制的物理依据是宽度——不该出现"窄的能放、宽的能放、中间不能放"。

    2026-08-08 第三轮：旧五槽整套退休，这条跟着换到区域词汇。**顺带纠正上一版
    写错的依据**——旧注释说"secondary=1/3、primary=2/3、activity/content=全宽
    且 className 逐字节相同"，还引了 AppRuntimeScreen.tsx:1490-1532。那句是错的。
    真跑 upgradeLegacySlotsToGrid 量出来（12 栅格）：

        summary / primary    → 12
        secondary / activity → 4
        content              → 仪表盘 12、其它页型 4

    所以 activity 与 content 并不相同，content 还随页型变宽；那个行号如今指向的
    也是无关代码。旧描述停在网格化之前的渲染器上，一直没跟着改——这正是推翻五槽
    的依据之一：五个名字只有两种行为，还有一个是不定项。

    换到区域之后宽度是清楚的：aside 是窄列（4/12），正文侧的都是整行。
    """
    from services import schema_legal

    # 实测宽度档：1=窄列，2=整行
    width = {"aside": 1, "main": 2, "metrics": 2, "charts": 2, "supplement": 2}
    for block in schema_legal.EXPERIENCE_BLOCKS:
        regions = set(block["allowedRegions"])
        ranked = [width[r] for r in regions if r in width]
        if not ranked:
            continue
        lo, hi = min(ranked), max(ranked)
        gaps = [r for r, o in width.items() if lo < o < hi and r not in regions]
        assert not gaps, (
            f"{block['type']} 的宽度区间有洞：允许 {sorted(regions)}，却禁了 {gaps}"
        )


def test_every_region_restriction_ships_its_reason():
    """**凡是限制了区域的类型，都必须说明为什么**——不是只给犯过错的那个补。

    2026-08-01 的教训：给 WorkflowTimeline 补了理由之后它那类违规归零，但同一
    个毛病立刻换主角复发——FilterBar→content ×2、QuickActionPanel→content ×3。
    上一版这条用例只钉了 WorkflowTimeline 一个，所以"补了理由"这件事没有被推广，
    等于修了症状没修这一类。

    2026-08-08 又添一例，说明这条依然在防真事：PageHeader 被装配器放进了
    footerBar——两者能力都是 action，容器侧的 accepts 放行了。区块侧的限制这轮
    才进门禁，理由也就必须在场。

    判据：allowedRegions 不是全集 = 存在限制 = 必须有 regionsRationale。模型推
    不出"为什么不行"时只会按名字的字面意思猜。
    """
    from services import schema_legal

    all_regions = set(schema_legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
    for block in schema_legal.EXPERIENCE_BLOCKS:
        if set(block["allowedRegions"]) >= all_regions:
            continue  # 不限制就不用解释
        assert str(block.get("regionsRationale") or "").strip(), (
            f"{block['type']} 限制了区域（只允许 {sorted(block['allowedRegions'])}）"
            "却没写 regionsRationale——模型无从推断，只会按名字乱猜"
        )


def test_slot_rationales_reach_the_generation_contract():
    """理由必须真的进生成契约，不能只躺在目录里。"""
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    for block in schema_legal.EXPERIENCE_BLOCKS:
        rationale = str(block.get("regionsRationale") or "").strip()
        if rationale:
            assert rationale in prompt, f"{block['type']} 的槽位理由没进 prompt"


def test_contract_explains_what_the_regions_look_like():
    """区域的**渲染形态**要交代清楚——这是那一类违规的根因。

    此前提示词只给名字，从没说过它们渲染成什么样。模型不知道形态就只能按名字
    猜，逐块补理由是治单点，这一句才治这一类。

    2026-08-08 第三轮换到区域词汇，同时补上这轮实测出来的那条最容易错的规则：
    **关键数字放哪儿**——仪表盘用全宽 metrics（IntroduceRow 那一排），列表/详情
    页放 headerExtra（页头右侧，不占正文）。写死一句是因为新区域都是 optional，
    而 optional 在模型眼里约等于"可以不管"（实测：不写这句，detail 页只用
    header/main/aside，把状态和金额丢在主区里；写了之后 headerExtra 就用上了）。
    """
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    assert "What the regions actually look like" in prompt
    # 唯一的窄区域必须点名——这是"别把宽的东西塞进去"的判据
    assert "aside is the ONLY narrow region" in prompt
    # 页头带的阅读顺序
    assert "header / headerExtra / headerContent / filters" in prompt
    # 关键数字的去处
    assert "headerExtra" in prompt
    assert "never open such a page with a full-width band of metric cards" in prompt


def test_contract_teaches_responsive_business_page_grid():
    from services import schema_legal

    prompt = schema_legal.experience_block_prompt_block()
    assert "layout.grid" in prompt
    assert "desktop=12, tablet=8, phone=4" in prompt
    assert "page-content" in prompt
    assert "blockRef/x/y/w/h" in prompt
    assert "one placement per blockRef per breakpoint" in prompt
