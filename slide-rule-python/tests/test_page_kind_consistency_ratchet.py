"""`pageKinds` 声明的自洽性棘轮 —— 核实 ffaf964「那条规则本身还没核实」的结果。

## 核实结论：怀疑成立，这份声明现在**不能上闸**

ffaf964 把页型限制告诉了模型但**故意不上门禁**，理由是"这条约束本身经不起推敲"，
举了 AlertSilenceForm / AlertRuleEditor 同族同能力规则相反作为例子。本文件把那个
怀疑做成可复核的量化判据，结论是**成立的**：

### 一、这份数据没有集中评审

`pageKinds` 没有任何标注脚本（对比 `generality` 有 label_block_generality.py）。
追 git 历史，它是**随每个区块被添加时手写的**（da0be83、9389227 这类"补 XX 区块"
的提交各写各的）。没有中心化审校，也没有一致性检查——正是漂移的温床。

### 二、控制住领域之后，矛盾依然存在（核实时 25 对，A 档执行后 15 对）

只按 family+capability 分组会得出 67% 不一致，但那个数**不能当证据**：
`AlertRuleCommandHeader(monitor)` 与 `DocumentCommandHeader(workbench)` 页型不同是
合理的——告警监控页和文档管理页本来就是不同的页。

所以判据要**控制住领域**：按「名字首词（领域族）+ capability」分组，只数
**严格子集**关系——同域、同能力，一个明确比另一个少允许若干页型。这种情况没有
可辩护的理由。核实时 25 对，最刺眼的几对基本是近亲：

    Alert  form    AlertRuleEditor          dashboard,monitor
                   AlertSilenceForm         dashboard,monitor,workbench
    Alert  filter  AlertMatcherFilter       monitor
                   AlertRuleFilterBar       monitor,workbench
    Alert  action  AlertRuleCommandHeader   monitor
                   AlertGroupCommandHeader   monitor,workbench

而全目录 304/359 都允许 workbench。少数被卡住的更像随手标窄。

**这三对已经在 A 档里放宽掉了**（见下面的"后续"），留在基线里的 15 对都涉及
calendar / kanban / wizard / monitor 这些形状专属或有独立通道纪律的页型。

### 后续：A 档已执行（25 → 15）

docs/page-kinds-widening-proposal.md 里 A 档的 8 个区块已经改了 `pageKinds`，
只沿 workbench / dashboard 两个通用工作面放宽，没伸进 calendar/kanban/wizard。
提案里第 9 条（`HeaderEntitySummary` +dashboard）评审时被否掉——顺带发现它对矛盾
对数**本来就没影响**：加了 dashboard 之后它仍然是 `HeaderProgressSummary` 的严格
子集（缺 monitor），所以否与不否都是 15 对。

### 三、门禁的 `_finding` 没有分级

加进去就是硬拒。拿一条有证据认为标错的规则去拒模型，是把"违规发出去"换成
"合规的也发不出去"。所以 ffaf964 的判断是对的。

## 顺带修正 ffaf964 的一处附带说法

那条提交说页型摆错"不影响渲染"。**对渲染这一半成立**——live-runtime 下没有任何
渲染器读 pageKinds。但"没有任何一处读它"是不准的：
`client/src/pages/sliderule/ComponentsLibraryPage.tsx` 用它做组件库的页型筛选与
计数（3977、4132 行）。所以改这份数据会影响组件库的筛选结果，只是不影响生成的
应用怎么渲染。

## 这个文件守什么

不擅自改目录数据（那 25 对该放宽还是该收紧是产品判断），只上一道**棘轮**：
矛盾对数**只准变少**。要上门禁，先把这个数降到 0，那时这条约束才配得上硬拒。
"""

import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.schema_legal import EXPERIENCE_BLOCKS, PAGE_KINDS

#: 当前基线。**只准变小。** 降到 0 之后才可以考虑让结构闸硬拒页型越界。
#:
#: 25 → 15：docs/page-kinds-widening-proposal.md 的 A 档已执行（8 个区块只加
#: workbench / dashboard 这两个通用工作面）。
#: 15 → 9：B 档里 monitor 那 6 个已定调，但**不是一起放宽**——4 个 action 加
#: monitor（同域近亲已允许、运行时真渲染），2 个 filter 反而收窄了它们更宽的
#: 兄弟（SavedViewTabs / UserEventFilter 撤掉 monitor），因为 filterChange 在
#: 总览页够不到任何东西。详见 docs/page-kinds-widening-proposal.md「B 档 monitor
#: 那 6 个的定调」。剩下的 9 对全部涉及 calendar / kanban / wizard。
_CONTRADICTION_BASELINE = 9


def _domain_of(block_type: str) -> str:
    m = re.match(r"^([A-Z][a-z]+)", block_type)
    return m.group(1) if m else "?"


def _strict_subset_pairs():
    """同【领域族 + capability】内，页型声明成严格子集关系的对。

    严格子集 = 同域、同能力，一个明确比另一个少允许若干页型。这种情况找不到
    可辩护的理由，所以当作"标注不自洽"计数。
    """
    groups = collections.defaultdict(list)
    for b in EXPERIENCE_BLOCKS:
        if not b.get("generationEnabled"):
            continue
        t = str(b["type"])
        key = (_domain_of(t), str(b.get("capability") or b.get("group")))
        groups[key].append((t, frozenset(b.get("pageKinds") or [])))

    out = []
    for (dom, cap), members in groups.items():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b2 = members[i], members[j]
                if a[1] < b2[1] or b2[1] < a[1]:
                    lo, hi = (a, b2) if a[1] < b2[1] else (b2, a)
                    out.append((dom, cap, lo[0], sorted(lo[1]), hi[0], sorted(hi[1])))
    return sorted(out)


def test_页型声明的自洽性只准变好():
    pairs = _strict_subset_pairs()
    detail = "\n".join(
        f"    {d} · {c}: {lo}({','.join(lok)})  ⊂  {hi}({','.join(hik)})"
        for d, c, lo, lok, hi, hik in pairs[:12]
    )
    assert len(pairs) <= _CONTRADICTION_BASELINE, (
        f"同域同能力的页型声明矛盾从 {_CONTRADICTION_BASELINE} 涨到 {len(pairs)}。\n"
        f"新增的矛盾意味着又有人随手标窄了某个区块的 pageKinds：\n{detail}"
    )
    if len(pairs) < _CONTRADICTION_BASELINE:
        # 变好了就要求把基线跟着降——否则棘轮会慢慢失去约束力
        raise AssertionError(
            f"矛盾对数已降到 {len(pairs)}（基线 {_CONTRADICTION_BASELINE}）。"
            f"请把 _CONTRADICTION_BASELINE 改成 {len(pairs)} 锁住这次改善。"
            f"降到 0 之后，页型越界才可以考虑让结构闸硬拒。"
        )


def test_每个通电区块都声明了页型且都合法():
    """这一条与自洽性无关，是基本卫生：声明本身不能缺、不能写目录外的页型。"""
    legal = set(PAGE_KINDS)
    for b in EXPERIENCE_BLOCKS:
        if not b.get("generationEnabled"):
            continue
        kinds = b.get("pageKinds") or []
        assert kinds, f"{b['type']} 没有声明 pageKinds"
        bad = [k for k in kinds if k not in legal]
        assert not bad, f"{b['type']} 声明了目录外的页型: {bad}"


def test_门禁仍然不拦页型越界():
    """路标：只要上面的矛盾还没清零，结构闸就不该硬拒页型越界。

    ffaf964 已经有一条同向的测试；这里再钉一次，并写清解锁条件——将来要上闸，
    先让 test_页型声明的自洽性只准变好 里的基线降到 0，再改这条。
    """
    from services.v5_model_gate import validate_five_system_model

    # 前置断言：先证明这份样例真的越界。放宽 pageKinds 时很容易让它变成合法摆放，
    # 那样下面那条断言就永远成立，路标静默失效。
    declared = {
        str(b["type"]): list(b.get("pageKinds") or []) for b in EXPERIENCE_BLOCKS
    }
    assert "workbench" not in declared["MuteTimingSchedule"], (
        "MuteTimingSchedule 现在允许 workbench 了，这份样例不再越界。"
        "请换一个仍然不允许 workbench 的区块，否则这条路标就是空断言。"
    )

    # MuteTimingSchedule 只允许 monitor/dashboard，这里故意摆进 workbench 页。
    # （原先用的是 AlertRoutingPolicy，A 档放宽后它已经允许 workbench，这条路标会
    #  变成永远为真的空断言，所以换成同族同能力、仍然不允许 workbench 的那个。
    #  下面 _仍然越界 的前置断言就是防止将来再出现这种静默失效。）
    model = {
        "datamodel": {"entities": [{"id": "alert", "name": "告警", "fields": [
            {"id": "title", "name": "标题", "type": "string"},
            {"id": "summary", "name": "摘要", "type": "string"}]}]},
        "rbac": {"roles": [{"id": "ops", "name": "运维"}], "permissions": [], "menus": []},
        "workflow": {"id": "wf", "name": "流程", "nodes": [], "transitions": [], "chains": []},
        "page": {"pages": [{
            "id": "p1", "name": "路由策略管理", "kind": "workbench",
            "blocks": [{"id": "b1", "type": "MuteTimingSchedule",
                        "binding": {"entityRef": "alert"}}],
        }]},
        "aigc": {"capabilities": [{"id": "cap", "name": "摘要",
                                   "inputFields": ["alert.title"],
                                   "outputField": "alert.summary",
                                   "roleRefs": ["ops"]}]},
        "appbundle": {"landingPageRef": "p1"},
    }
    findings = validate_five_system_model(model).get("findings") or []
    page_kind_findings = [
        f for f in findings
        if "pageKind" in str(f.get("path") or "") or "page kind" in str(f.get("message") or "").lower()
    ]
    assert page_kind_findings == [], (
        "结构闸开始拦页型越界了，但那份声明还有 "
        f"{len(_strict_subset_pairs())} 对自相矛盾——先把它清零"
    )
