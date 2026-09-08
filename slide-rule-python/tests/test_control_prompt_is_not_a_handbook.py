"""第 2 格：控制面 system 是「把这件事做完」，不是车间规章。

漫画：老师傅被提示词工作手册绑住——先 clarify、再 scope_card、
选项必须带括号。grok 是 complete the request。

变异：把手册句子加回去 → 本条红。
反向：话题、缺维度事实、宪章注入还在。
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.rehearsal_control import _system_prompt  # noqa: E402


HANDBOOK = (
    "选项必须带",
    "直接 scope_card",
    "开范围卡之前",
    "先用 clarify",
    "不要等人点确认",
    "未确认不得 rehearse",
    "问候用 ask_user",
    "请调 pages",
    "精修（refine）",
    "下一跳请挑",
    "在哪用（平台）",
    "已经问过一轮澄清",
)


def test_prompt_is_complete_the_job_not_a_syllabus():
    text = _system_prompt(
        V5SessionState(sessionId="p2", goal={"text": "水果店收银台", "status": "clear"})
    )
    assert "把这件事做完" in text
    assert "水果店收银台" in text
    assert "只能调用给定工具" in text
    assert "禁止开放闲聊" in text
    for banned in HANDBOOK:
        assert banned not in text, banned


def test_missing_dimensions_are_not_a_start_gate():
    """第 7 格：有产品话题就干活。缺维度不许再写进 system 当开工门。"""
    text = _system_prompt(
        V5SessionState(
            sessionId="p2-miss",
            goal={"text": "做一个诊所系统", "status": "needs_refinement"},
        )
    )
    assert "把这件事做完" in text
    assert "还没读到" not in text
    assert "在哪用" not in text
    assert "开范围卡之前" not in text
    assert "最多 3 条" not in text


def test_empty_topic_still_says_none():
    text = _system_prompt(
        V5SessionState(sessionId="p2-empty", goal={"text": "", "status": "needs_refinement"})
    )
    assert "尚无确认的应用目标" in text
    assert "把这件事做完" in text
    assert "还没读到" not in text, "问候空目标还报缺维度，等于暗令先澄清"
    cont = _system_prompt(
        V5SessionState(
            sessionId="p2-cont",
            goal={"text": "继续", "status": "needs_refinement"},
        )
    )
    assert "还没读到" not in cont, "目标是「继续」还报缺维度"


def test_fruit_shop_cashier_is_enough_to_start():
    """漫画第 7 格：做个水果店收银台。不许先问类型/设备。"""
    text = _system_prompt(
        V5SessionState(
            sessionId="p7-fruit",
            goal={"text": "做个水果店收银台", "status": "clear"},
        )
    )
    assert "把这件事做完" in text
    assert "水果店收银台" in text
    assert "还没读到" not in text
    assert "在哪用" not in text
    assert "产品类型" not in text
    assert "请先选择" not in text


def test_scope_card_tool_is_restatement_not_a_gate():
    """工具说明书也不能再教「等用户点开始推演」。"""
    from control_turn_support import PY_ROOT, strip_python

    src = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "等用户点开始推演" not in src
    at = src.find("'name': 'scope_card'")
    if at < 0:
        at = src.find('"name": "scope_card"')
    assert at > 0, "scope_card 工具条目不见了"
    chunk = src[at : at + 500]
    assert "不当门禁" in chunk or "复述" in chunk
