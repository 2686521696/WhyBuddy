"""自动续跑：该续的续，**该收手的一定收手**。

## 这份判据的重心全在反向

「目标没做完就自己接着跑」写出来很容易，危险的是它停不下来：模型说一句
「我这就去做」不调任何工具，再叫醒它只会得到同一句话——不设防就是拿用户的
额度空转。所以四条护栏每条都配一条反向判据，变异（去掉任一条）都要变红。

⚠ `should_continue` 是纯函数，判据直接跑它，不重抄一份规则（重抄的判据只能
  证明「我抄对了」）。服务层那边只负责「按判断结果落库」。
"""

from services.control_goal_continuation import (
    MAX_CONTINUATIONS,
    continuation_budget_left,
    continuation_notice,
    progress_mark,
    should_continue,
    tool_result_count,
)


def goal(**over):
    base = {"kind": "project", "status": "active", "continuations": 0, "progressMark": ""}
    base.update(over)
    return base


def events(tool_results=1, text=2):
    out = [{"type": "control_text", "text": f"说话 {i}"} for i in range(text)]
    out += [{"type": "control_tool_result", "tool": "project_patch"} for _ in range(tool_results)]
    return out


def test_正向_工程目标没做完就接着跑():
    ok, reason = should_continue(
        status="completed", goal=goal(), events=events(), goal_done=False
    )
    assert ok is True and reason is None


def test_反向_目标已达可交付就收手():
    ok, reason = should_continue(
        status="completed", goal=goal(), events=events(), goal_done=True
    )
    assert ok is False and reason == "goal_done"


def test_反向_对话目标一律不续():
    """没有可验证的「做完了」。判没完 = 无限续，判做完 = 编。不猜。"""
    ok, reason = should_continue(
        status="completed", goal=goal(kind="conversation"), events=events(), goal_done=False
    )
    assert ok is False and reason == "not_a_project_goal"


def test_反向_问过用户的不许自己替他回答():
    ok, reason = should_continue(
        status="waiting_user", goal=goal(), events=events(), goal_done=False
    )
    assert ok is False and reason == "terminal_waiting_user"


def test_反向_失败和取消不许自己重试掩盖过去():
    for status in ("failed", "cancelled", "interrupted"):
        ok, reason = should_continue(
            status=status, goal=goal(), events=events(), goal_done=False
        )
        assert ok is False and reason == f"terminal_{status}", status


def test_反向_没进展就不再叫醒():
    """最重要的一条：上一次交出去之后一个工具都没跑成。

    模型说「我这就去实现」然后什么都不调——再叫一次只会拿到同一句话。
    """
    spent = events(tool_results=3)
    mark = progress_mark(spent)
    ok, reason = should_continue(
        status="completed", goal=goal(progressMark=mark), events=spent, goal_done=False
    )
    assert ok is False and reason == "no_progress"


def test_正向_真的动了就还能续():
    before = events(tool_results=3)
    after = events(tool_results=4)  # 又跑成了一个工具
    ok, reason = should_continue(
        status="completed",
        goal=goal(progressMark=progress_mark(before)),
        events=after,
        goal_done=False,
    )
    assert ok is True and reason is None


def test_反向_预算烧完就停下来问人():
    ok, reason = should_continue(
        status="completed",
        goal=goal(continuations=MAX_CONTINUATIONS),
        events=events(),
        goal_done=False,
    )
    assert ok is False and reason == "budget_exhausted"
    assert continuation_budget_left(goal(continuations=MAX_CONTINUATIONS)) == 0
    assert continuation_budget_left(goal(continuations=MAX_CONTINUATIONS + 5)) == 0


def test_预算按真实续跑次数递减():
    assert continuation_budget_left(goal()) == MAX_CONTINUATIONS
    assert continuation_budget_left(goal(continuations=3)) == MAX_CONTINUATIONS - 3
    # 旧行没有这个字段 → 当成一次都没续过
    assert continuation_budget_left({"kind": "project"}) == MAX_CONTINUATIONS
    assert continuation_budget_left(None) == MAX_CONTINUATIONS


def test_进展指纹只数工具结果不数说话():
    """光说话也会让事件变多。只有工具结果代表真的动了什么。"""
    assert tool_result_count(events(tool_results=0, text=9)) == 0
    assert tool_result_count(events(tool_results=2, text=9)) == 2
    assert progress_mark(events(tool_results=0, text=1)) == progress_mark(
        events(tool_results=0, text=7)
    )
    assert progress_mark(events(tool_results=1)) != progress_mark(events(tool_results=2))
    assert tool_result_count(None) == 0


def test_续跑提示词从服务端缺项生成不是请继续():
    text = continuation_notice(
        ["project_verification_required", "project_plan_approval_required"], 2
    )
    assert "第 2 次" in text
    assert "project_verification_required" in text
    assert "project_plan_approval_required" in text


def test_反向_拿不到缺项时不编原因():
    text = continuation_notice([], 1)
    assert "没有给出具体缺项" in text
    # 不许出现一个看起来像服务端判定的假缺项
    assert "required" not in text
