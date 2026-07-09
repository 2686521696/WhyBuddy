"""技能参考语料（技能库二期）测试。

锁：词面重叠检索（中文 bigram + ASCII 词）、无关意图零命中、
prompt 块的"不复制内容"指示、生成用户消息的按命中装配（无命中
时与原始 prompt 逐字节一致——增强项不改变既有行为）。
"""

from services.v5_llm_generate import _build_user_content
from services.v5_skill_reference import (
    pick_reference_skills,
    reference_prompt_block,
)

FAKE_ITEMS = [
    {
        "name": "网络小说创作技能",
        "description": "长篇小说大纲、章节生成与人物卡管理",
        "url": "https://github.com/x/novel-skill",
        "license": "MIT",
    },
    {
        "name": "股票基本面分析助手",
        "description": "输入股票代码输出基本面研报与风险提示",
        "url": "https://gitee.com/y/stock-skill",
        "license": "Apache-2.0",
    },
    {
        "name": "document-reformatter",
        "description": "Deterministic document layout and formatting pipeline",
        "url": "https://github.com/z/document-reformatter",
        "license": "MIT",
    },
]


def test_pick_by_cjk_bigram_overlap() -> None:
    refs = pick_reference_skills("做一个网络小说连载创作平台", k=2, items=FAKE_ITEMS)
    assert refs and refs[0]["name"] == "网络小说创作技能"
    # 无关领域不混入
    assert all("股票" not in r["name"] for r in refs)


def test_pick_by_ascii_words() -> None:
    refs = pick_reference_skills(
        "build a document formatting reformatter tool", k=3, items=FAKE_ITEMS
    )
    assert refs and refs[0]["name"] == "document-reformatter"


def test_unrelated_intent_yields_empty() -> None:
    assert pick_reference_skills("宠物医院预约挂号", k=4, items=FAKE_ITEMS) == []
    assert pick_reference_skills("", k=4, items=FAKE_ITEMS) == []


def test_prompt_block_has_no_copy_instruction() -> None:
    block = reference_prompt_block("网络小说创作平台")
    # 真语料环境下可能命中也可能不命中；命中时必须带不复制指示
    if block:
        assert "do NOT copy" in block
        assert block.startswith("Industry reference skills")


def test_build_user_content_fallback_identical_when_no_hit() -> None:
    goal = "qqxxyyzz zkqjwp vvbnmr"
    content = _build_user_content(goal)
    # 无命中 → 与历史 prompt 逐字节一致（增强项不改变既有行为）
    assert content == f"Business intent:\n{goal}\n\nProduce the five-system JSON now."


def test_build_user_content_appends_block_between_intent_and_task() -> None:
    goal = "做一个网络小说创作与连载管理系统"
    content = _build_user_content(goal)
    assert content.startswith(f"Business intent:\n{goal}")
    assert content.endswith("Produce the five-system JSON now.")
    if "Industry reference skills" in content:
        assert content.index("Business intent") < content.index("Industry reference skills")
        assert content.index("Industry reference skills") < content.index(
            "Produce the five-system JSON now."
        )
