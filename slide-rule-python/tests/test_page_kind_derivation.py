"""`pageKinds` 的**可重算依据**——把 scripts/label_block_page_kinds.py 的硬判据接进 CI。

## 这条补的是什么缺口

`test_page_kind_consistency_ratchet.py` 量过：那份声明是手写的，同域同能力的矛盾
一度有 25 对。三批人工放宽降到 9，但那条路到不了底——判据要"同域 + 同能力 +
区域相交"才数得着，只覆盖 41/358 个区块，剩下 317 个没有任何第二来源可以核对。

所以补了 `scripts/label_block_page_kinds.py`，照 `label_block_generality.py` 给
`generality` 做的那样给 `pageKinds` 一份能重跑的依据。那个脚本分两层：

  · **硬判据**：运行时真的会因此丢掉区块或画重复的，加上一条来自已自检预设的正面
    证据。只有 4 条，每条指到具体行号或具体数据来源。
    **这一层就是本文件**——不调模型，进 CI，违反了必须修。
  · **设计建议**：其余全部，模型出初稿、人过一遍再落盘（`--dry-run`）。标错了
    页面不会坏，只是推荐得不好，所以不进 CI。

## 顺带定了「上不上闸」这件事

写那个脚本时把运行时逐处 `page.view.kind` 分支查了一遍，结论是：
**workbench / wizard / kanban / calendar 四种页型，从"区块能不能在这儿干活"的
角度看是可以互换的**——四者都有逐行视图、都走同一条 `businessPageGrid`、吃同一
张区域表（`regionsToGrid` 的几何按 band 走，跟页型无关，只有 kanban/calendar 把
右栏从 4/12 收到 3/12）。页型对区块准入的技术影响，全部集中在"有没有逐行视图"
这一件事上，也就是硬判据那几条。

**所以这个字段不该上结构闸。** 门禁硬拒的前提是"违反了就一定错"，而四种页型
互换在运行时无差别；真该拦的只有硬判据那几条，而它们运行时早就兜死了。

## 第一次跑就抓到 4 处（2026-08-11）

    MetricGrid  monitor/dashboard   目录允许了运行时会丢掉的页型
    TrendChart  monitor/dashboard   同上——而且 TrendChart **只**允许这两种页

`TrendChart` 那两条是真事故：方案 C 的分工是"总览页归 page.stats/charts，业务页
归 MetricGrid/TrendChart 积木"，而它的 `pageKinds` 只写了总览页——正好是它被硬
禁的那两种。**等于这个区块哪儿都摆不了**，跟 2026-08-11 早些时候
`AnalyticsDateScope` / `DashboardParameterBar` 那两个是同一个形状的洞。
两个都已改成 `workbench`。
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services.schema_legal import EXPERIENCE_BLOCKS, PAGE_KINDS

sys.path.insert(0, str(ROOT / "scripts"))
from label_block_page_kinds import (  # noqa: E402
    OVERVIEW_KINDS,
    PAGE_KIND_FACTS,
    audit,
    hard_verdicts,
    needs_model,
    preset_pairs,
)


def test_目录不违反任何硬判据():
    """硬判据 = 运行时真的会丢区块或画重复。违反了不是"标得不好"，是真错。"""
    problems = audit(list(EXPERIENCE_BLOCKS))
    detail = "\n".join(
        f"    {t} @ {k}: {what} —— {why}" for t, k, what, why in problems[:12]
    )
    assert not problems, (
        f"目录违反了 {len(problems)} 处硬判据：\n{detail}\n"
        "跑 .venv/bin/python scripts/label_block_page_kinds.py --check 看全部。"
    )


def test_脚本的页型事实表跟目录的合法页型对得上():
    """事实表要是漏了一种页型，硬判据就会对那种页只字不提，静默放过。

    反过来多写一种也不行——那意味着在给模型讲一种不存在的页。
    """
    assert set(PAGE_KIND_FACTS) == set(PAGE_KINDS), (
        f"脚本的 PAGE_KIND_FACTS 与目录 PAGE_KINDS 不一致："
        f"脚本多 {set(PAGE_KIND_FACTS) - set(PAGE_KINDS)}，"
        f"少 {set(PAGE_KINDS) - set(PAGE_KIND_FACTS)}"
    )
    # 每种页都得写清"提供什么"和出处——那是喂给模型的前提，前提假了最难查
    for kind, facts in PAGE_KIND_FACTS.items():
        assert len(str(facts.get("provides") or "")) >= 20, f"{kind} 的 provides 太空"
        assert facts.get("evidence"), f"{kind} 没写出处"
        assert isinstance(facts.get("row_view"), bool), f"{kind} 没写 row_view"

    # 总览页就是那两种没有逐行视图的——硬判据全从这条事实派生，钉住它
    no_rows = {k for k, v in PAGE_KIND_FACTS.items() if not v["row_view"]}
    assert no_rows == set(OVERVIEW_KINDS), (
        f"没有逐行视图的页型变了（现在是 {sorted(no_rows)}），"
        "硬判据是从这条事实派生的，请一起复核"
    )


def test_硬判据不会把区块判成哪儿都不能去():
    """禁到最后一个页型也不许——那等于悄悄废掉一个渲染器。

    2026-08-11 真出现过两次（`AnalyticsDateScope` / `DashboardParameterBar` 被
    筛选类禁令堵死，`TrendChart` 被 KPI 禁令堵死）。这条把它变成会响的。
    """
    for b in EXPERIENCE_BLOCKS:
        if not b.get("generationEnabled"):
            continue
        forbidden = {
            k for k, (v, _w) in hard_verdicts(b).items() if v == "forbid"
        }
        left = set(PAGE_KIND_FACTS) - forbidden
        assert left, (
            f"{b['type']} 被硬判据禁掉了所有页型，等于废了它——"
            "要么判据错了，要么这个区块该关掉 generationEnabled"
        )
        # 更强一档：目录声明的页型不能被硬判据全禁掉
        declared = set(b.get("pageKinds") or [])
        assert declared - forbidden, (
            f"{b['type']} 声明的页型 {sorted(declared)} 全被硬判据禁掉了——"
            f"它哪儿都摆不了。硬判据禁的是 {sorted(forbidden)}。"
        )


def test_预设用到的组合都被钉成require():
    """硬判据④：`pageKindPresets` 用到的 (区块, 页型) 必须被判成 require。

    **这条在现有数据上永远不会响**——`schema_legal._load_page_kind_presets` 在
    导入时就会为坏预设抛异常，所以目录里不可能存在"预设推荐了但 pageKinds 不许"
    的组合。它的用处在**第二层**：模型提议收窄时，这条把预设用过的页型钉住，
    不让它把一个已自检通过的组合推翻。第一次跑就用上了——模型把 `RecordForm`
    在 wizard 页判成"否"，而 `flow-form` 那套预设正是 RecordForm 摆在 wizard 上。

    所以这里测的是"这条判据还在、还覆盖着全部预设"，不是"它抓到了什么"。
    """
    pairs = preset_pairs()
    assert pairs, "预设一个都没解析出来——判据④已经失效了"
    for btype, kinds in pairs.items():
        verdicts = hard_verdicts({"type": btype, "capability": "", "pageKinds": []})
        for kind in kinds:
            assert verdicts.get(kind, ("", ""))[0] == "require", (
                f"预设在 {kind} 页上用了 {btype}，但硬判据没把它钉成 require"
            )


def test_硬判据不是空判据():
    """反面证明：合成一条违规，audit 必须抓到。

    `audit()` 现在对真实目录返回 0 处，那个 0 有两种可能——数据真干净，或者
    判据根本没在跑。这条把两者分开。
    """
    planted = {
        "type": "合成的筛选区块",
        "capability": "filter",
        "generationEnabled": True,
        # 既允许了被禁的总览页，又没有任何带逐行视图的页 —— 一次踩两条
        "pageKinds": ["monitor"],
        "allowedRegions": ["filters"],
    }
    problems = audit([planted])
    kinds_hit = {p[1] for p in problems}
    assert "monitor" in kinds_hit, f"没抓到「允许了被禁页型」：{problems}"
    assert any("|" in k for k in kinds_hit), f"没抓到「缺了带逐行视图的页」：{problems}"


def test_check_模式可以直接当CI闸用():
    """脚本 `--check` 不调模型、以退出码表态。这条保证它一直是这个契约。

    真起子进程跑：`audit()` 被单元测过了，但"`--check` 不需要 API key、
    退出码 0/1"这件事只有真跑才验得到——而这正是别人接进 CI 时依赖的部分。
    """
    proc = subprocess.run(
        [sys.executable, "scripts/label_block_page_kinds.py", "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        # 故意抹掉 LLM 凭据：--check 一旦偷偷调了模型，CI 就会变成一条要联网、
        # 要花钱、还会因为网关抖动而随机红的闸
        env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
        timeout=120,
    )
    assert proc.returncode == 0, (
        f"--check 非零退出：\n{proc.stdout[-2000:]}\n{proc.stderr[-1000:]}"
    )
    assert "硬判据违反 0 处" in proc.stdout, proc.stdout[-2000:]


def test_记账位的格子会真的被问到模型():
    """`require_any_row` 不是"定死"，必须跟着问——否则筛选整族永远推导不出来。

    ## 这条钉的是什么

    硬判据对筛选类的 `workbench` 格给的是 `require_any_row`（"至少得有一种带
    逐行视图的页，不要求非得是这一格"）。它是**记账位**，本格是 yes 是 no 仍
    由模型判。但 `ask_list` 当初按"verdict 非 None"排除，把它一并当成定死的
    剔掉了，而循环里又把预记的那笔 `asked` 给 discard 掉——两处一夹，这一格
    没有任何地方去问。

    表现是沉默的：区块不会报错，只是 `asked >= set(kinds)` 永远不成立，于是
    每次都被算进"没问全的 N 个（不下结论，重跑）"，`--write` 一次都不给它们
    打标。重跑一百遍也一样。这个脚本的存在意义就是让 `pageKinds` 可重算，而
    筛选整族对它不可达。

    所以这条不测"结果对不对"，测的是**这一格进没进 ask_list**。

    注意别把判据写成"所有筛选区块的 workbench 格都必须被问"——`FilterBar` 那
    一格被硬④（预设正面证据）覆写成了 `require`，已经定死，不问是对的。真正
    的不变量只有一条：**凡是 `require_any_row`，就必须问**。
    """
    any_row = [
        (str(b["type"]), kind)
        for b in EXPERIENCE_BLOCKS
        if b.get("generationEnabled")
        for kind, v in hard_verdicts(b).items()
        if v[0] == "require_any_row"
    ]
    assert any_row, "目录里一个 require_any_row 都没有，这条判据失去意义"

    verdicts = {str(b["type"]): hard_verdicts(b) for b in EXPERIENCE_BLOCKS}
    missed = [(t, k) for t, k in any_row if not needs_model(verdicts[t].get(k))]
    assert not missed, (
        f"{len(missed)}/{len(any_row)} 个记账位格子不会被问模型，"
        f"对应区块永远进不了 complete：{missed[:8]}"
    )


def test_完美模型下每个区块都能推导完整():
    """端到端复现那个沉默失败：模拟一轮"模型有问必答"，看谁进不了 `complete`。

    上一条钉的是单个格子，这条钉的是**账目闭合**——把 `main()` 里那套
    "硬判据定死的直接记账 / 其余问模型"的记账逻辑照抄一遍，喂一个百分百
    答得上的假模型，然后要求 `asked` 覆盖全部页型。

    真实脚本里这一步要调 LLM，所以 CI 跑不到；而 bug 恰恰只在这一步显形
    （`--check` 只跑硬判据那层，一路绿灯）。这条用假模型把那段账补上。
    """
    enabled = [b for b in EXPERIENCE_BLOCKS if b.get("generationEnabled")]
    kinds = list(PAGE_KIND_FACTS)

    asked: dict[str, set[str]] = {str(b["type"]): set() for b in enabled}
    for kind in kinds:
        verdict_of = {str(b["type"]): hard_verdicts(b).get(kind) for b in enabled}
        ask_list = [b for b in enabled if needs_model(verdict_of[str(b["type"])])]
        for b in enabled:
            v = verdict_of[str(b["type"])]
            if v is None:
                continue
            t = str(b["type"])
            asked[t].add(kind)
            if v[0] == "require_any_row":
                asked[t].discard(kind)
        # 假模型：ask_list 里的每一个都答得上（真模型答不上是另一回事，
        # 那种情况脚本本来就该报"没问全"）
        for b in ask_list:
            asked[str(b["type"])].add(kind)

    incomplete = [str(b["type"]) for b in enabled if asked[str(b["type"])] < set(kinds)]
    assert not incomplete, (
        f"完美模型下仍有 {len(incomplete)}/{len(enabled)} 个区块问不全，"
        f"`--write` 永远不会给它们打标：{incomplete[:8]}"
    )
