"""已安装技能的消费通道与绑定形状（2026-07-27）。

背景：此前所有已安装技能走同一条硬要求——"必须落成一条 aigc.capabilities，
字段绑定到真实实体"。对设计指导类技能（配色/版式/空态）这是必然的门禁失败，
对没验证出绑定的技能则逼模型硬编一张能力卡。128 条逐条判定见
docs/skills-triage.jsonl，判定结果落成 featured-skills.json 里的 channel。

这里锁的是"分流真的发生了"，以及三条降级纪律：
  - 未标注/非法 channel → unbound（不发注定绑不上的硬要求）
  - binding 出现 fieldTypes 闭集外的类型 → 整条形状作废，而不是喂进 prompt
  - 无已安装技能时 prompt 与历史逐字节一致（增强项不改变既有行为）
"""

from services.identity_theme_gen import (
    build_identity_theme_prompt,
    experience_skill_guidance_block,
)
from services.schema_legal import FIELD_TYPES
from services.v5_llm_generate import (
    _build_user_content,
    _clean_binding,
    installed_skills_for_channel,
    set_installed_skills,
)

GOAL = "给咖啡烘焙工坊做生豆库存与烘焙批次管理"

AIGC_SKILL = {
    "name": "需求优先级矩阵",
    "description": "按价值/成本给需求排序",
    "channel": "aigc",
    "binding": {"inputTypes": ["number", "number"], "outputType": "enum"},
}
EXPERIENCE_SKILL = {
    "name": "配色方案",
    "description": "挑一套对比度达标的配色",
    "channel": "experience",
}
UNBOUND_SKILL = {
    "name": "小红书卡片",
    "description": "生成小红书风格图文卡片",
    "channel": "unbound",
}


def teardown_function() -> None:
    set_installed_skills(None)


def test_only_aigc_channel_becomes_a_hard_requirement() -> None:
    set_installed_skills([AIGC_SKILL, EXPERIENCE_SKILL, UNBOUND_SKILL])
    content = _build_user_content(GOAL)
    required, _, rest = content.partition("context only")
    # 硬要求块里只有 aigc 通道那条
    assert "需求优先级矩阵" in required
    assert "小红书卡片" not in required
    # 设计指导类根本不进这条 prompt——它喂的是过门之后的体验层
    assert "配色方案" not in content
    # 未验证绑定的走软参考，且明说别硬造能力卡
    assert "小红书卡片" in rest
    assert "do NOT invent an aigc.capabilities" in content


def test_binding_shape_reaches_the_prompt() -> None:
    set_installed_skills([AIGC_SKILL])
    line = next(
        l for l in _build_user_content(GOAL).splitlines() if "需求优先级矩阵" in l
    )
    assert "[field shape: number + number -> enum]" in line


def test_experience_skills_feed_the_theme_prompt_instead() -> None:
    set_installed_skills([AIGC_SKILL, EXPERIENCE_SKILL])
    theme = build_identity_theme_prompt("咖啡工坊", GOAL, "（摘要）")
    assert "配色方案" in theme
    # 能力类技能不该污染配色 prompt
    assert "需求优先级矩阵" not in theme
    assert installed_skills_for_channel("experience")[0]["name"] == "配色方案"


def test_unknown_channel_degrades_to_unbound() -> None:
    """未标注（存量安装记录）或标了未知值，一律按 unbound——宁可不提要求。"""
    set_installed_skills(
        [
            {"name": "存量技能", "description": "老版本装的，没有 channel 字段"},
            {"name": "未来技能", "description": "后端加了新通道而这版不认识", "channel": "quantum"},
        ]
    )
    assert len(installed_skills_for_channel("unbound")) == 2
    assert installed_skills_for_channel("aigc") == []
    content = _build_user_content(GOAL)
    # 关键：它们不能出现在 REQUIRED 块里
    assert "存量技能" not in content.partition("context only")[0]


def test_binding_outside_the_closed_vocabulary_is_discarded() -> None:
    """类型闭集来自 five_system_legal.json；越界就整条形状作废，不喂 prompt。"""
    assert _clean_binding({"inputTypes": ["number"], "outputType": "enum"})
    assert _clean_binding({"inputTypes": ["json"], "outputType": "enum"}) == ""
    assert _clean_binding({"inputTypes": ["text"], "outputType": "blob"}) == ""
    assert _clean_binding({"inputTypes": [], "outputType": "text"}) == ""
    assert _clean_binding(None) == ""
    for t in FIELD_TYPES:
        assert _clean_binding({"inputTypes": [t], "outputType": t}) == f"{t} -> {t}"

    set_installed_skills(
        [{**AIGC_SKILL, "binding": {"inputTypes": ["json"], "outputType": "enum"}}]
    )
    # 技能仍是硬要求，只是不再带形状提示（而不是带一个非法形状）
    content = _build_user_content(GOAL)
    assert "需求优先级矩阵" in content
    assert "field shape" not in content


def test_no_installed_skills_keeps_prompts_byte_identical() -> None:
    set_installed_skills(None)
    base_user = _build_user_content(GOAL)
    base_theme = build_identity_theme_prompt("咖啡工坊", GOAL, "（摘要）")
    assert experience_skill_guidance_block() == ""

    set_installed_skills([AIGC_SKILL, EXPERIENCE_SKILL])
    assert _build_user_content(GOAL) != base_user

    set_installed_skills(None)
    assert _build_user_content(GOAL) == base_user
    assert build_identity_theme_prompt("咖啡工坊", GOAL, "（摘要）") == base_theme
