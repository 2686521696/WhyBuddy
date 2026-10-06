"""skill(name, file=…)：技能包里的文件，没有工作区也读得到。

⚠ 2026-10-06 真机 r38 sr-20261006072036-32XXX4H7TT（@internal-comms 全员搬迁邮件）：技能第 2 步「到 examples/ 读对应的
  格式说明（general-comms.md）再写」，直接回答的回合没有工作区，模型加载完正文就写，这一步静静跳过（_skill_package_file 头注）。
技能包用仓库里真的种子（local_seed_files），走真 HTTP（ControlHarness），看模型实际拿到的回执。
"""

from __future__ import annotations

import copy
import json

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services import rehearsal_control as control
from services.control_skills import build_skill_message
from services.skill_catalog_store import local_seed_files, local_seed_skill_info

TOPIC = ("@internal-comms 帮我写一封全员邮件：下周一起办公室搬到新地址（浦东张江路 88 号 5 楼），周五下午 3 点后停止使用旧办公室，"
         "需要大家周五中午前把个人物品装箱")
# r39 复跑时这个账号在商店里真正装着的 11 份（list_installed 原样）。internal-comms **不在里面**——
# 它是消息里的 @提及 + 仓库种子补进本回合目录的（_skill_turn_catalog）。第一版判据把它塞进「已装」，测的不是真机那一发。
STORE_INSTALLED = ["avoid-ai-writing", "frontend-design", "interaction-design", "office-skills", "pptx-deck-context",
                   "pptx-quality-gates", "pptx-slide-specification", "responsive-design", "sliderule",
                   "verification-before-completion", "visual-design-foundations"]


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setattr(control, "installed_skill_infos",
                        lambda owner: [i for i in map(local_seed_skill_info, STORE_INSTALLED) if i is not None])
    monkeypatch.setattr(control, "installed_skill_files",
                        lambda owner, slug: local_seed_files(slug) if slug in STORE_INSTALLED else None)
    return ControlHarness(monkeypatch)


def _turn(harness, file_arg):
    seen, it = [], iter([llm_tool("skill", {"name": "internal-comms"}, call_id="s-1"),
                         llm_tool("skill", {"name": "internal-comms", "file": file_arg}, call_id="s-2"),
                         llm_text("邮件如下……")])

    def impl(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return next(it)
    harness.llm_impl = impl
    sid = new_sid("skill-file")
    seed_session(sid, goal={"text": TOPIC, "status": "clear"})
    _, events = harness.post(six_fields(sid, TOPIC))
    back = next(m for m in seen[-1] if m.get("role") == "tool" and m.get("tool_call_id") == "s-2")
    return back["content"], events


def test_the_guideline_file_reaches_the_model_without_a_workspace(harness):
    body, events = _turn(harness, "examples/general-comms.md")
    guideline = local_seed_files("internal-comms")["examples/general-comms.md"]
    assert guideline.strip()[:120] in json.loads(body)["skill_message"]       # 真正文，不是一句「已读取」
    start = [e for e in events if e.get("type") == "control_tool_start" and e.get("tool") == "skill"]
    assert any("examples/general-comms.md" in str(e.get("summary")) for e in start)  # 轨迹上看得出读的是哪份


def test_the_base_directory_form_of_the_path_works_too(harness):
    body, _ = _turn(harness, ".sliderule/skills/internal-comms/examples/general-comms.md")
    assert json.loads(body)["ok"] is True


def test_a_missing_file_lists_what_is_there(harness):
    body, _ = _turn(harness, "examples/nope.md")
    out = json.loads(body)
    assert out["ok"] is False and "examples/general-comms.md" in out["human"]


def test_the_store_list_really_lacks_it():
    """判据自己的前提：真机那一发里 internal-comms 不在商店已装行——正文是靠 @提及 + 种子开的。"""
    assert "internal-comms" not in STORE_INSTALLED


def test_a_skill_this_turn_cannot_open_is_not_read(harness):
    """反向：本回合目录里没有的技能（没装、没提及、没随这一发带来），包里的东西不开放。"""
    out = control._skill_package_file(
        seed_session(new_sid("skill-file-x"), goal={"text": "x"}), "humanizer-zh", "SKILL.md")
    assert out == {"ok": False, "error": "skill_not_installed"}


def test_the_skill_message_says_how_to_read_package_files():
    message = build_skill_message(local_seed_skill_info("internal-comms"))
    assert 'skill(name="internal-comms", file=' in message
