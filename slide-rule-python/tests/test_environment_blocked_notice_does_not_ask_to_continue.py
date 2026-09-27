"""只剩验收环境挡着时，收尾通知不许叫用户说「继续」。

⚠ 2026-09-27 隔离真机第 65 轮 sr-20260927190013-AJ2QM1WR1Y、第 67 轮
  sr-20260927194916-EVJ3BK6YWP：两轮四次收尾，通知都是
  「这一轮还没有达到可交付：独立浏览器验收没能在这个环境里跑起来（运行环境的问题，
  不是应用代码）。说「继续」我接着做，或者告诉我先停在这里。」
  而 should_continue 对同一份缺项回 environment_blocked、自己不续——续了只会把同一句话
  再说一遍。宿主不续，却叫用户替它续。

判据喂第 67 轮那份缺项原样，自动续跑与通知走同一条判断（§四）。
把 undelivered_notice 里 environment_only 那支删掉，第一条变红。
"""

from __future__ import annotations

from services.control_goal_continuation import should_continue, undelivered_notice

ROUND67_BLOCKED = ["project_verification_environment_blocked"]


def test_environment_only_notice_does_not_invite_continue():
    text = undelivered_notice(ROUND67_BLOCKED)
    assert "没能在这个环境里跑起来" in text
    assert "说「继续」我接着做" not in text
    assert "环境修好" in text


def test_the_notice_agrees_with_the_continuation_rule():
    """同一份缺项：宿主不续 ⇔ 通知不叫用户续。"""
    goal = {"kind": "project", "text": "喝水打卡网页"}
    go, why = should_continue(status="completed", goal=goal, goal_done=False,
                              blocked_reasons=ROUND67_BLOCKED, events=[])
    assert (go, why) == (False, "environment_blocked")
    assert "继续」我接着做" not in undelivered_notice(ROUND67_BLOCKED)


def test_a_blocker_the_model_can_fix_still_invites_continue():
    """反向：还有模型改得动的缺项（混着环境项也算），照旧请用户说「继续」。"""
    for blocked in (["project_verification_required"],
                    ["project_verification_environment_blocked", "project_acceptance_profile_not_bound"],
                    []):
        assert "说「继续」我接着做" in undelivered_notice(blocked), blocked
