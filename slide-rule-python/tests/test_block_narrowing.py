"""目录窄化（services/block_narrowing.py）。

要守住的东西，按重要性排：
  1. 默认关，且关着的时候 prompt 与从前**逐字相同**；
  2. 预设点名的区块无条件在集合里、且在最前——漏一个 prompt 就自相矛盾；
  3. 窄化真的窄了**详情段**，不只是名单句（第一版就漏了这个，只省 8%）;
  4. 意图词表与字段权重跟 TS 侧读同一份 JSON，不各写一份。
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import block_narrowing as N
from services import schema_legal as L

GOAL = (
    "做一个告警值班与静默管理系统：告警接入后按标签路由到对应的值班组；"
    "支持配置静默时段；值班表按周排班；未确认的告警按升级策略逐级升级通知。"
)
ENABLED = [b for b in L.EXPERIENCE_BLOCKS if b.get("generationEnabled")]
MANDATORY = N.preset_block_names(L.PAGE_KIND_PRESETS)


# ── 1. 开关 ────────────────────────────────────────────────────────────────


def test_默认关(monkeypatch):
    monkeypatch.delenv("SLIDERULE_BLOCK_CATALOG_NARROWING", raising=False)
    assert N.narrowing_enabled() is False


def test_关着时_prompt_与从前逐字相同():
    """最要紧的一条：不传 blocks 就是原行为。"""
    assert L.experience_block_prompt_block(None) == L.experience_block_prompt_block()


def test_关着时系统指令是同一个对象(monkeypatch):
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION, schema_instruction_for

    monkeypatch.delenv("SLIDERULE_BLOCK_CATALOG_NARROWING", raising=False)
    assert schema_instruction_for(GOAL) is _SCHEMA_INSTRUCTION


def test_空目标退回全量(monkeypatch):
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION, schema_instruction_for

    monkeypatch.setenv("SLIDERULE_BLOCK_CATALOG_NARROWING", "1")
    assert schema_instruction_for("") is _SCHEMA_INSTRUCTION
    assert schema_instruction_for("   ") is _SCHEMA_INSTRUCTION


# ── 2. 保底集合 ─────────────────────────────────────────────────────────────


def test_保底集合从预设派生而非手写():
    """PROVEN LAYOUTS 点名的每一个都得在里面。手写清单会随预设改动而漂。"""
    assert MANDATORY, "预设里应当点名了区块"
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets or []:
            for item in ps.get("blocks") or []:
                assert str(item["type"]) in MANDATORY, f"{kind} 的预设件漏进保底集合"


def test_保底件无条件入选且排在最前():
    picked = [str(b["type"]) for b in N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)]
    assert picked[: len(MANDATORY)] == MANDATORY


def test_额度小于保底数时至少保住保底件():
    picked = [str(b["type"]) for b in N.select_blocks(ENABLED, GOAL, limit=3, mandatory=MANDATORY)]
    assert set(MANDATORY).issubset(set(picked))


def test_窄化后的集合仍能满足预设的每一档():
    """反向验证 prompt 不自相矛盾：预设里每一档的每个件都在注入集合里。"""
    picked = {str(b["type"]) for b in N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)}
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets or []:
            for item in ps.get("blocks") or []:
                assert str(item["type"]) in picked, f"{kind} 预设的 {item['type']} 被筛掉了"


# ── 3. 真的窄，且窄的是详情段 ───────────────────────────────────────────────


def test_窄化后详情段条数跟着降():
    """第一版只窄了名单句、详情段仍是全量 358 条——那等于窄化没生效，
    因为 prompt 明写 "every block type MUST be one of the catalog entries below"，
    below 指的就是详情段。"""
    import re

    full = L.experience_block_prompt_block()
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    narrow = L.experience_block_prompt_block(picked)
    pat = re.compile(r"(?m)^- [A-Z][A-Za-z]+: ")
    n_full, n_narrow = len(pat.findall(full)), len(pat.findall(narrow))
    assert n_narrow < n_full / 3, f"详情段没跟着窄：{n_narrow} vs {n_full}"


def test_未入选的区块不出现在详情段里():
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    names = {str(b["type"]) for b in picked}
    narrow = L.experience_block_prompt_block(picked)
    outsider = next(
        str(b["type"]) for b in ENABLED if str(b["type"]) not in names
    )
    assert f"- {outsider}:" not in narrow


def test_schema_only_禁令仍取全量():
    """渲染器没上线那档是**禁令**，漏一个等于默许模型去 emit 它——不受窄化影响。"""
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    narrow = L.experience_block_prompt_block(picked)
    schema_only = [
        str(b["type"]) for b in L.EXPERIENCE_BLOCKS if not b.get("generationEnabled")
    ]
    for t in schema_only:
        assert t in narrow, f"schema-only 的 {t} 从禁令里消失了"


# ── 4. 召回：对题件要真的被捞进来 ───────────────────────────────────────────


def test_对题件被捞进可达区():
    """这道题的对题件原名次 61~328，全在可达区外。窄化的意义就是把它们捞进来。"""
    on_topic = [
        "AlertSilenceForm",
        "AlertRoutingPolicy",
        "MuteTimingSchedule",
        "OnCallScheduleCalendar",
        "EscalationPolicyPanel",
    ]
    picked = [str(b["type"]) for b in N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)]
    hit = [t for t in on_topic if t in picked]
    assert len(hit) >= 4, f"点名的 5 个只捞到 {hit}"
    for t in hit:
        assert picked.index(t) + 1 <= 50, f"{t} 捞进来了但落在第 {picked.index(t)+1} 位，仍在可达区外"


# ── 5. 与 TS 侧共用同一份词表 ───────────────────────────────────────────────


def test_意图词表来自共享_json():
    p = Path(__file__).resolve().parent.parent / "services" / "data" / "block_intent_lexicon.json"
    raw = json.loads(p.read_text(encoding="utf-8"))
    assert raw["intentLexicon"], "词表不该为空"
    assert raw["fieldWeights"]["name"] == 4
    # 词表条数与运行时编译出来的一致
    assert len(raw["intentLexicon"]) == len(N._LEXICON["rules"])


def test_词表正则只用两边通用语法():
    """JS 与 Python 各自编译同一份 pattern。方言（\\p{...}、命名组、后行断言）
    会让一边静默失配，所以这里挡住。"""
    p = Path(__file__).resolve().parent.parent / "services" / "data" / "block_intent_lexicon.json"
    raw = json.loads(p.read_text(encoding="utf-8"))
    banned = ["\\p{", "(?<", "(?P<", "\\k<"]
    for rule in raw["intentLexicon"]:
        for b in banned:
            assert b not in rule["pattern"], f"{rule['pattern']!r} 用了方言语法 {b}"


def test_查询侧丢单字():
    """索引侧留单字、查询侧丢——TS 侧记的实测：留单字会让「不/存/在」这种
    到处都有的字把整份目录连连看一遍。"""
    assert "告" not in N.tokenize_query("告警值班")
    assert "告警" in N.tokenize_query("告警值班")
    assert "告" in N.tokenize("告警值班"), "索引侧要留单字"


def test_单字查询有兜底():
    assert N.tokenize_query("表") == ["表"]


# ── 6. fail-open ───────────────────────────────────────────────────────────


def test_额度大于全量时原样返回():
    picked = N.select_blocks(ENABLED, GOAL, limit=10_000, mandatory=MANDATORY)
    assert picked == ENABLED


def test_目标为空时原样返回():
    assert N.select_blocks(ENABLED, "", limit=60, mandatory=MANDATORY) == ENABLED


# ── 7. 自适应：目录没覆盖这个域时不窄化 ────────────────────────────────────


PHARMACY_GOAL = (
    "开发医院药房库存管理系统，支持药品入库出库、批号效期预警和处方调剂发药，"
    "药师按处方拣药复核，库管按批号做盘点与补货。"
)


def _confidence_of(goal: str) -> float:
    from rank_bm25 import BM25Okapi

    w = N._LEXICON["fieldWeights"]
    bm = BM25Okapi([N._weighted_tokens(b, w) for b in ENABLED])
    q = N.tokenize_query(N.expand_intent(goal))
    return N.retrieval_confidence(bm.get_scores(q), len(q))


def test_覆盖域的置信度高于阈值():
    assert _confidence_of(GOAL) > N.narrowing_confidence_threshold()


def test_零覆盖域的置信度低于阈值():
    """药房库存：目录里一个对应件都没有（扫过域词，唯一命中是 DevOps 件误命中）。"""
    assert _confidence_of(PHARMACY_GOAL) < N.narrowing_confidence_threshold()


def test_零覆盖域退回全量目录():
    """这条是阴性对照那笔代价的回归哨兵。

    实测：零覆盖域上窄化反而更差——特定场景件被选中 6.33 → 2.67（-58%）、
    去重类型 11 → 8、用到的最远原名次 242 → 23。所以必须退回全量。
    """
    picked = N.select_blocks(ENABLED, PHARMACY_GOAL, limit=60, mandatory=MANDATORY)
    assert picked == ENABLED, "零覆盖域不该被窄化"


def test_覆盖域仍然窄化():
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    assert len(picked) == 60


def test_零覆盖域的系统指令与全量逐字相同(monkeypatch):
    """端到端且不花钱：退回全量意味着注进去的 prompt 应当和全量那份一模一样。"""
    from services.v5_llm_generate import _SCHEMA_INSTRUCTION, schema_instruction_for

    monkeypatch.setenv("SLIDERULE_BLOCK_CATALOG_NARROWING", "1")
    assert schema_instruction_for(PHARMACY_GOAL) == _SCHEMA_INSTRUCTION
    # 反面：覆盖域必须真的变短
    assert len(schema_instruction_for(GOAL)) < len(_SCHEMA_INSTRUCTION)


def test_阈值可用环境变量覆盖(monkeypatch):
    monkeypatch.setenv("SLIDERULE_BLOCK_CATALOG_NARROWING_MIN_CONFIDENCE", "0.0")
    # 阈值降到 0 之后，连零覆盖域也会被窄化（用来在排查时强制对照）
    assert N.select_blocks(ENABLED, PHARMACY_GOAL, limit=60, mandatory=MANDATORY) != ENABLED


def test_置信度对查询长度不敏感():
    """BM25 是各查询词得分之和，会随长度线性涨；除以词数就是为了抵掉这个。

    实测短查询是**往上**跑（告警 5 词 → 1.149），所以阈值对短题只会更安全。
    """
    short = _confidence_of("告警静默值班")
    long = _confidence_of(GOAL + " 另外需要通知联络点管理、告警规则编辑、按标签匹配的路由策略树。")
    thr = N.narrowing_confidence_threshold()
    assert short > thr and long > thr, f"同一域的长短写法都该过阈值: {short:.3f} / {long:.3f}"


# ── 8. 第 2 层：按题意派生预设 ──────────────────────────────────────────────


def _derived():
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    return N.derive_goal_presets(picked, L.PAGE_KIND_PRESETS, L.PAGE_KINDS)


def test_派生预设满足_authored_预设的同一套硬校验():
    """authored 预设启动时按三条硬校验：区块通电、kind∈pageKinds、region∈allowedRegions。
    派生的这批**按构造**满足同样三条——不满足就等于在 prompt 里推荐一个必被门拦的
    组合，而模型会照着抄。"""
    by_type = {str(b["type"]): b for b in L.EXPERIENCE_BLOCKS}
    derived = _derived()
    assert derived, "覆盖域上应当能派生出预设"
    for kind, presets in derived.items():
        assert kind in L.PAGE_KINDS
        for ps in presets:
            assert str(ps.get("id") or "").strip()
            assert str(ps.get("name") or "").strip()
            assert str(ps.get("when") or "").strip()
            assert ps["blocks"], "预设不能空"
            for it in ps["blocks"]:
                entry = by_type[it["type"]]
                assert entry.get("generationEnabled"), f"{it['type']} 未通电"
                assert kind in (entry.get("pageKinds") or []), f"{it['type']} 不允许在 {kind} 页"
                assert it["region"] in (entry.get("allowedRegions") or []), (
                    f"{it['type']} 不允许放在 {it['region']}"
                )


def test_派生预设不重复推荐保底件():
    """保底件就是 authored 预设已经点名的那 10 个，再推一遍没有信息量。"""
    names = set(MANDATORY)
    for presets in _derived().values():
        for ps in presets:
            for it in ps["blocks"]:
                assert it["type"] not in names


def test_派生预设各件占不同区域():
    """都塞 main 会挤成一坨，也体现不出"排好的版面"。"""
    for presets in _derived().values():
        for ps in presets:
            regions = [it["region"] for it in ps["blocks"]]
            assert len(regions) == len(set(regions))


def test_派生预设至少两件():
    for presets in _derived().values():
        for ps in presets:
            assert len(ps["blocks"]) >= 2


def test_authored_预设仍在且排在派生的前面():
    """只加不减：人写的那几档带真实判断，应当先说话。"""
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    text = L.experience_block_prompt_block(picked, extra_presets=_derived())
    for kind, presets in L.PAGE_KIND_PRESETS.items():
        for ps in presets or []:
            assert f"{kind} · {ps['name']}" in text, f"authored 预设 {ps['id']} 不见了"
    # 同一页型内，authored 的行号应当小于派生的
    lines = text.split("\n")
    for kind in L.PAGE_KIND_PRESETS:
        authored = [i for i, ln in enumerate(lines)
                    if ln.strip().startswith(f"{kind} · ") and "按题意 ·" not in ln]
        goalfit = [i for i, ln in enumerate(lines)
                   if ln.strip().startswith(f"{kind} · ") and "按题意 ·" in ln]
        if authored and goalfit:
            assert max(authored) < min(goalfit), f"{kind}: 派生档排到了 authored 前面"


def test_不传_extra_presets_时输出与从前逐字相同():
    picked = N.select_blocks(ENABLED, GOAL, limit=60, mandatory=MANDATORY)
    assert L.experience_block_prompt_block(picked) == L.experience_block_prompt_block(
        picked, extra_presets=None
    )


def test_零覆盖域派生不出错():
    """退回全量的域上，派生仍应安全（可能出、可能不出，但不许抛）。"""
    picked = N.select_blocks(ENABLED, PHARMACY_GOAL, limit=60, mandatory=MANDATORY)
    d = N.derive_goal_presets(picked, L.PAGE_KIND_PRESETS, L.PAGE_KINDS)
    assert isinstance(d, dict)
