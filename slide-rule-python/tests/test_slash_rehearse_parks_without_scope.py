"""`/推演` 与「开始推演」：有真产品直接点火，没有才 park。

## 2026-09-09：这道闸拆了（用户裁决）

本文件原来的主张是「空会话 /推演 必须 park；停泊中 /推演 不是确认按钮，
还要再 park」——把范围卡建模成 grok 的 `NeedPermission`、把按钮建模成
`Permission{decision}`。

回去读 grok-build 的原件，`PermissionRequest` 是按**破坏性**问的：

    pub struct PermissionRequest {
        pub tool_name: String,
        pub input_json: String,
        pub destructive: bool,   // 允许这次会不会改动外部状态
    }

改生产库、跑危险命令、进计划模式才走它。「按用户自己说的那句话造一个新
应用」不改动任何外部状态，在 grok 那边根本不触发 NeedPermission。
我们却拿它当「你确认要开工吗」的确认框——那不是权限，是门禁，
代价就是漫画第 5/7 格那句：人话进环还要先点一次按钮。

## 现在钉的是什么

判据换成「这一轮手上有没有一个真产品」（`_turn_has_real_product`）：

  · 有真产品        → 直接点火，不要求再点一次（本文件前半）
  · 没有产品        → 仍然 park，一次火都不点（本文件后半，反向条）

后半是这次改动的**安全网**：拆闸不等于什么都烧。问候、`/推演` 裸指令、
先改范围之后的空会话，都必须停在卡上。少了这几条，「你好点着工厂」
那类事故就没人挡了（2026-09-08 真机，见
`test_created_session_goal_is_not_a_product.py`）。

变异：把 `may_ignite` 改回 `_scope_confirmed(state)` → 前半红。
      把它改成恒真 → 后半红。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    goal_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


# ── 有真产品：直接进环 ──────────────────────────────────────────────
def test_slash_rehearse_with_a_real_product_ignites(harness):
    """`/推演 请假系统`：这句里就有产品，不要求再点一次按钮。"""
    sid = new_sid("slash-product")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(six_fields(sid, "/推演 请假系统"))
    types = event_types(events)
    assert len(harness.helper_calls) == 1, f"有真产品的 /推演 没点火：{types}"
    assert "control_handoff_factory" in types
    # 卡照出——它是「我认成了什么」的回执，只是不再当门禁。
    assert "control_scope_card" in types


def test_forced_rehearse_with_a_real_product_ignites(harness):
    """「开始推演」按钮（forcedTool=rehearse）+ 真产品：同样直接点火。"""
    sid = new_sid("forced-product")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(
        six_fields(sid, "做一个请假系统", forcedTool="rehearse")
    )
    types = event_types(events)
    assert len(harness.helper_calls) == 1, f"没点火：{types}"
    assert "control_handoff_factory" in types


def test_goal_is_persisted_before_the_factory_loads(monkeypatch):
    """点火前必须把复述句写进 goal 并 persist，工厂才读得到。

    反向：跳过 persist → goals_at_handoff / driver_goals 空。
    这条跟闸拆不拆无关，是**顺序**约束，所以照旧钉着。
    """
    harness = ControlHarness(monkeypatch, live_factory=True)
    sid = new_sid("goal-before-load")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(six_fields(sid, "/推演 请假系统"))
    assert len(harness.helper_calls) == 1
    assert harness.goals_at_handoff == ["请假系统"], harness.goals_at_handoff
    assert harness.driver_goals == ["请假系统"]
    assert "control_handoff_factory" in event_types(events)
    assert goal_text(load_session(sid)) == "请假系统"


# ── 没有真产品：仍然 park（拆闸的安全网）────────────────────────────
def test_bare_slash_on_empty_session_still_parks(harness):
    """`/推演` 裸指令、空会话：没有产品可认，一次火都不点。"""
    sid = new_sid("slash-empty")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    _, events = harness.post(six_fields(sid, "/推演"))
    types = event_types(events)
    assert harness.helper_calls == [], f"裸 /推演 点着了工厂：{types}"
    assert harness.llm_calls == []
    assert "control_scope_card" in types
    assert "control_handoff_factory" not in types
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason == "control_scope"


def test_greeting_then_bare_slash_still_parks(harness):
    """问候之后裸 `/推演`：问候不是产品，仍然停在卡上。

    这条是 2026-09-08「你好点着工厂」那次事故的近邻——那次是占位串 goal
    把问候变成了产品，这次确认拆闸之后问候仍然进不了环。
    """
    sid = new_sid("greet-slash")
    seed_session(
        sid,
        goal={"text": "", "status": "needs_refinement"},
        controlTranscript=[{"role": "user", "kind": "turn", "text": "你好"}],
    )
    _, events = harness.post(six_fields(sid, "/推演"))
    types = event_types(events)
    assert harness.helper_calls == [], f"问候会话被 /推演 点着了：{types}"
    assert "control_handoff_factory" not in types


def test_dismiss_then_bare_slash_parks_again(harness):
    """先改范围 persist-clear 之后，裸 `/推演` 不得跳卡点火。"""
    sid = new_sid("dismiss-then-slash")
    seed_session(sid, goal={"text": "", "status": "needs_refinement"})
    harness.post(six_fields(sid, "/推演"))
    _, dismissed = harness.post(
        six_fields(sid, "先改范围", forcedTool="dismiss_scope")
    )
    assert harness.helper_calls == []
    loaded = load_session(sid)
    assert loaded is not None
    assert loaded.awaitReason != "control_scope"
    _, second = harness.post(six_fields(sid, "/推演"))
    types = event_types(second)
    assert harness.helper_calls == [], f"先改范围之后被点着了：{types}"
    assert "control_scope_card" in types
    assert "control_handoff_factory" not in types
