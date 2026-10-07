"""技能正文里用插件命名空间点名另一份技能（Claude Code 写法 `插件:技能`），装着就得打得开。

⚠ 2026-10-07 全量扫描 24 份种子技能：systematic-debugging 写「Use the `superpowers:verification-before-completion` skill
  before claiming success」。verification-before-completion 装着，normalize 把冒号换成连字符，查成
  superpowers-verification-before-completion → skill_not_found（control_skills.normalize_skill_name 头注）。
名字从真种子正文里抠，回合走真 HTTP（ControlHarness），看模型拿到的回执。
"""

from __future__ import annotations

import copy
import re

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.skill_catalog_store import local_seed_files, local_seed_skill_info

INSTALLED = ["systematic-debugging", "verification-before-completion"]
TOPIC = "@systematic-debugging 我的购物车合计偶尔多算一分钱，帮我查"


def _named_in_the_real_body() -> str:
    body = local_seed_skill_info("systematic-debugging").body
    names = re.findall(r"`(superpowers:[a-z-]+)`", body)
    assert "superpowers:verification-before-completion" in names     # 前提：正文真是这么写的
    return "superpowers:verification-before-completion"


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [local_seed_skill_info(n) for n in INSTALLED])
    monkeypatch.setattr(control, "installed_skill_files",
                        lambda owner, slug: local_seed_files(slug) if slug in INSTALLED else None)
    return ControlHarness(monkeypatch)


def _back(harness, name):
    seen, it = [], iter([llm_tool("skill", {"name": name}, call_id="s-1"), llm_text("好。")])

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return next(it)
    harness.llm_impl = impl
    sid = new_sid("ns-skill")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    harness.post(six_fields(sid, TOPIC))
    return next(m for m in seen[-1] if m.get("role") == "tool" and m.get("tool_call_id") == "s-1")["content"]


def test_the_namespaced_name_from_the_body_opens_the_installed_skill(harness):
    back = _back(harness, _named_in_the_real_body())
    assert "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE" in back    # 真的是那份正文
    assert "skill_not_found" not in back


def test_a_namespaced_skill_that_is_not_installed_still_says_so(harness):
    """反向：命名空间不是万能钥匙——没装的照旧说没装，不许打开别的。"""
    back = _back(harness, "superpowers:test-driven-development")
    assert "skill_not_found" in back and "NO COMPLETION CLAIMS" not in back
