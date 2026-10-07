"""技能页、@ 菜单显示的名字 = 技能自己的名字（SKILL.md frontmatter 的 name），不是中文别名。

⚠ 2026-10-07 用户截图（技能页）：卡片标题是「用数据讲清楚」「图表该怎么画」「中文去 AI 腔」……用户 @ 的、模型 skill() 认的、
  包里写的都是 data-storytelling 这种原名，页面上对不上号（skill_catalog_store._package_row 头注）。
"""

from __future__ import annotations

import json
from pathlib import Path

from services.skill_catalog_store import SkillCatalogStore, local_seed_skill_info

ROOT = Path(__file__).resolve().parents[2]


def test_a_row_still_carrying_the_old_alias_shows_the_real_name():
    """线上库里的旧行 name 列还是别名（种子版本没变就不重写）——读出来要是原名。"""
    row = {"id": "pkg-1", "slug": "data-storytelling", "name": "用数据讲清楚", "description": "把洞察写成别人能听懂的故事。",
           "version": "1.0.0", "oss_key": "skills/data-storytelling/1.0.0.zip", "sha256": "x"}
    pkg = SkillCatalogStore._package_row(row)
    assert pkg["name"] == "data-storytelling"
    assert pkg["description"] == "把洞察写成别人能听懂的故事。"          # 中文说明照留


def test_the_seed_list_names_every_skill_by_its_own_name():
    index = json.loads((ROOT / "skills" / "seeds" / "index.json").read_text("utf-8"))["packages"]
    for meta in index:
        info = local_seed_skill_info(meta["slug"])
        assert info is not None and meta["name"] == meta["slug"] == info.name, meta["slug"]
