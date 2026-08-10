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
