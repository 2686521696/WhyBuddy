"""技能包里给人看的文件（PDF / 图片）：模型知道有、能给用户链接、点开真能看。

⚠ 2026-10-07 真机 r65 sr-20261007093401-3HHZ9TCNXZ（@theme-factory 年会邀请函挑主题）：技能第 1 步「把 theme-showcase.pdf
  给用户看，让他挑」。开箱只收文本，这份 PDF 在平台上不存在；模型没东西可给，凭「Golden Hour」这个名字编了「香槟金、暖琥珀、
  深墨黑、衬线标题」让用户确认——themes/golden-hour.md 写的是芥末黄 #f4a900、赤陶、暖米、巧克力棕、FreeSans。
包用仓库里真的种子（theme-factory.zip），回合走真 HTTP（ControlHarness），链接走真路由。
"""

from __future__ import annotations

import copy
import json

import pytest
from fastapi.testclient import TestClient

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.control_skills import build_skill_message, skill_asset_url
from services.skill_catalog_store import local_seed_files, local_seed_skill_info

PDF = "theme-showcase.pdf"
TOPIC = "@theme-factory 帮我做一页 HTML 的公司年会邀请函，先帮我挑一个主题。"


def test_the_receipt_names_the_showcase_with_a_link():
    message = build_skill_message(local_seed_skill_info("theme-factory"))
    assert f"[{PDF}]({skill_asset_url('theme-factory', PDF)})" in message
    assert "不要凭文件名描述" in message


def test_a_skill_without_such_files_gets_no_such_line():
    """反向：纯文本的包不多一句。"""
    message = build_skill_message(local_seed_skill_info("humanizer-zh"))
    assert "给人看的文件" not in message and "/files/" not in message


def test_the_link_opens_the_real_pdf():
    from app import app
    client = TestClient(app)
    response = client.get(skill_asset_url("theme-factory", PDF))
    assert response.status_code == 200 and response.content.startswith(b"%PDF")
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-security-policy"] == "sandbox"


@pytest.mark.parametrize("path", [
    "/api/sliderule/skills/theme-factory/files/themes/golden-hour.md",   # 文本不从这里外流（模型用 skill(file=…) 读）
    "/api/sliderule/skills/theme-factory/files/nope.pdf",                # 包里没有
    "/api/sliderule/skills/no-such-skill/files/theme-showcase.pdf",      # 没这份技能
    "/api/sliderule/skills/theme-factory/files/../theme-factory/theme-showcase.pdf",
])
def test_only_viewable_files_that_exist_are_served(path):
    from app import app
    assert TestClient(app).get(path).status_code == 404


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos", lambda owner: [local_seed_skill_info("theme-factory")])
    monkeypatch.setattr(control, "installed_skill_files",
                        lambda owner, slug: local_seed_files(slug) if slug == "theme-factory" else None)
    return ControlHarness(monkeypatch)


def _file_turn(harness, file_arg):
    seen, it = [], iter([llm_tool("skill", {"name": "theme-factory"}, call_id="s-1"),
                         llm_tool("skill", {"name": "theme-factory", "file": file_arg}, call_id="s-2"),
                         llm_text("主题如下……")])

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return next(it)
    harness.llm_impl = impl
    sid = new_sid("skill-asset")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    harness.post(six_fields(sid, TOPIC))
    opened = next(m for m in seen[1] if m.get("role") == "tool" and m.get("tool_call_id") == "s-1")
    back = next(m for m in seen[-1] if m.get("role") == "tool" and m.get("tool_call_id") == "s-2")
    return opened["content"], back["content"]


def test_in_a_real_turn_the_model_sees_the_link_and_can_ask_for_it(harness):
    opened, back = _file_turn(harness, PDF)
    assert skill_asset_url("theme-factory", PDF) in opened             # 打开技能时就知道有这份、链接是什么
    assert skill_asset_url("theme-factory", PDF) in back and "skill_file_not_found" not in back


def test_a_missing_file_lists_the_viewable_ones_too(harness):
    _opened, back = _file_turn(harness, "showcase.pdf")
    assert "skill_file_not_found" in back and PDF in back


def test_the_line_survives_into_the_next_turn():
    """续跑回合的正文来自会话缓存（_carried_skill_messages）——缓存丢了 assets，下一回合就又不知道有这份 PDF。"""
    from models.v5_state import V5SessionState
    state = V5SessionState(sessionId="sr-asset-carry", ownerId="alice", goal={"text": TOPIC})
    control._remember_skill_infos(state, [local_seed_skill_info("theme-factory")])
    persisted = V5SessionState(**json.loads(json.dumps(state.model_dump(), ensure_ascii=False)))   # 落库再读回
    restored = control._skill_infos_from_cache(persisted)
    assert restored[0].assets == (PDF,)
    assert skill_asset_url("theme-factory", PDF) in build_skill_message(restored[0])
