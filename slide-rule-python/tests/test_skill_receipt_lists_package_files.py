"""技能加载回执列出包里的其它文件：没有沙盒时模型看不见目录，靠这份清单知道能 skill(file=…) 读什么。

⚠ 2026-10-07 真机 r94–r96（@avoid-ai-writing）：第 2、3 步要扫 references/pattern-catalog.md、对 references/word-tiers.md，
  三遍都一份没读（control_skills._files_note 头注）。种子包原样。
"""

from __future__ import annotations

import json

from models.v5_state import V5SessionState
from services import rehearsal_control as control
from services.control_skills import MAX_LISTED_FILES, build_skill_message
from services.skill_catalog_store import local_seed_skill_info


def test_the_receipt_names_the_reference_files_the_body_points_at():
    message = build_skill_message(local_seed_skill_info("avoid-ai-writing"))
    for path in ("references/pattern-catalog.md", "references/word-tiers.md"):
        assert path in message.split("# Avoid AI Writing", 1)[0]          # 在正文之前的清单里，不只是正文提到
    assert 'skill(name="avoid-ai-writing", file=' in message


def test_a_package_with_only_skill_md_gets_no_list():
    message = build_skill_message(local_seed_skill_info("verification-before-completion"))
    assert "包里还有这些文件" not in message


def test_a_big_package_is_capped_with_a_count():
    info = local_seed_skill_info("office-skills")
    message = build_skill_message(info)
    assert len(info.files) > MAX_LISTED_FILES and f"等 {len(info.files)} 个" in message


def test_the_list_survives_into_the_next_turn():
    state = V5SessionState(sessionId="sr-files", ownerId="alice", goal={"text": "x"})
    control._remember_skill_infos(state, [local_seed_skill_info("avoid-ai-writing")])
    persisted = V5SessionState(**json.loads(json.dumps(state.model_dump(), ensure_ascii=False)))
    [restored] = control._skill_infos_from_cache(persisted)
    assert "references/word-tiers.md" in restored.files
    assert "references/word-tiers.md" in build_skill_message(restored).split("# Avoid AI Writing", 1)[0]
