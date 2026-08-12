"""设计模型必须知道外壳是什么配方（2026-08-12）。

## 这条护栏是怎么来的

`recipe` 这个词在 freeform_block.py 里此前出现 **0 次**：设计首页的那个 LLM 根本
不知道外壳是深色还是浅色、圆角是 4 还是 20。它拿着色板里的浅色 `contentBg` 配
深色文字画卡片，而外壳可能是 `dark-monitoring` 的近黑画布——那种情况下整页文字
直接看不见。

这是个一直没被触发的潜伏 bug：模型几乎总选 `compact-dense`（浅色），所以没人撞上。
用户拿参照图点名要"深底大圆角"那种观感、于是新增 `bold-dark` 配方之后，这条就
必须先接上——不接的话新配方一选中就是一页看不见的字。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import _RECIPE_FACTS, _recipe_prompt_fragment
from services.schema_legal import DESIGN_RECIPES, experience_block_prompt_block


def test_每个合法配方都有事实可讲() -> None:
    """账本里加了配方却忘了在这里描述它，等于设计模型又回到"不知道"。"""
    missing = [r for r in DESIGN_RECIPES if r not in _RECIPE_FACTS]
    assert missing == [], missing
    # 反向：这里也不许描述账本外的配方（那种是打错字，永远匹配不上）
    extra = [r for r in _RECIPE_FACTS if r not in DESIGN_RECIPES]
    assert extra == [], extra


def test_深色配方必须明说浅色文字() -> None:
    """深色外壳最致命、也最容易犯的错就是浅底深字。这句话必须在提示词里。"""
    for recipe in DESIGN_RECIPES:
        tone = _RECIPE_FACTS[recipe][0]
        frag = _recipe_prompt_fragment(recipe)
        assert f"明暗：{tone}外壳" in frag, recipe
        if tone == "深色":
            assert "正文/数字用浅色" in frag, recipe
            assert "看不见" in frag, recipe  # 把代价说出来，不只是给规则
        else:
            # 浅色配方不许夹带深色那套指导——那会让它把浅色页画成深的
            assert "正文/数字用浅色" not in frag, recipe


def test_圆角与内边距如实报给设计模型() -> None:
    frag = _recipe_prompt_fragment("bold-dark")
    assert "20px" in frag
    assert "大圆角" in frag
    # compact-dense 是方脸紧凑，不许混进大圆角那套气质
    tight = _recipe_prompt_fragment("compact-dense")
    assert "4px" in tight
    assert "大圆角" not in tight


def test_未知或空配方给空串_不编造() -> None:
    """老模型没有 designRecipeRef，那时候一个字都不该说——不能瞎猜一个外壳。"""
    assert _recipe_prompt_fragment("") == ""
    assert _recipe_prompt_fragment("nope") == ""


def test_bold_dark_进了提示词的可选清单() -> None:
    """模型只从提示词里那句话认识配方；不写进去等于这套配方永远选不中。"""
    block = experience_block_prompt_block()
    assert "bold-dark" in block
    # 而且要说清它跟 dark-monitoring 的区别，否则模型分不清两个深色配方
    assert "dark-monitoring" in block
    assert "consumer" in block.lower()
