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


def test_installed_skills_injection_and_cleanup() -> None:
    """技能库六期"推演注入"：设置已安装技能 → prompt 出 REQUIRED 块；
    清空后与历史 prompt 逐字节一致（增强项不留残余）。"""
    from services.v5_llm_generate import set_installed_skills

    goal = "qqxxyyzz zkqjwp vvbnmr"
    baseline = _build_user_content(goal)

    set_installed_skills(
        [
            {"name": "网络小说创作技能", "description": "长篇小说大纲与章节生成"},
            {"name": "", "description": "无名跳过"},
            {"name": "X" * 200, "description": "Y" * 500},
        ]
    )
    try:
        content = _build_user_content(goal)
        assert "User-installed skills (REQUIRED" in content
        assert "网络小说创作技能 — 长篇小说大纲与章节生成" in content
        assert "aigc.capabilities" in content
        # 清洗：无名剔除、超长截断（60/160）
        assert "X" * 61 not in content
        assert "Y" * 161 not in content
        # 顺序：意图 → 已安装块 → 任务指令
        assert content.index("Business intent") < content.index("User-installed skills")
        assert content.index("User-installed skills") < content.index("Produce the five-system JSON now.")
    finally:
        set_installed_skills(None)

    assert _build_user_content(goal) == baseline


def test_installed_skills_capped_at_six() -> None:
    from services.v5_llm_generate import set_installed_skills

    set_installed_skills([{"name": f"技能{i}", "description": ""} for i in range(10)])
    try:
        content = _build_user_content("qqxxyyzz zkqjwp")
        assert "技能5" in content and "技能6" not in content
    finally:
        set_installed_skills(None)
