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


# ─────────────────────────────────────────────────────────────────────────────
# 下面两条是 **2026-09-13 真机 `control-continuation-smoke.py` 抓出来的**。
# 纯函数判据全绿、护栏逻辑也对，但真机上续跑一次都成不了 / 或者永远停不下来
# ——两个 bug 都在「逻辑之外」：一个在 checkpoint 形状，一个在落库。
# 这正是 §1 那条「改之前先确认哪条链真的在跑」的反面教材。
# ─────────────────────────────────────────────────────────────────────────────

from services.control_goal_continuation import continuation_checkpoint


def test_真机1_已收尾回合的checkpoint要能转成新一轮的起点():
    """真机第一趟红在 `control_reconciliation_required`。

    resume 守卫只认 `phase in {model, tools}`——那是「回合**中途**被打断」。
    自动续跑面对的是另一种：上一回合**正常收尾**了（rehearsal_control 留下
    `phase="settling"`），要开的是新一轮。不转换就当场被判成需要人工对账，
    模型根本不会被再次调用。
    """
    settled = {
        "schemaVersion": 1, "phase": "settling", "round": 4,
        "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "加截止日期"}],
        "startedAt": 1.0, "cheapTokens": 55_000, "retrySpent": 3, "retryStartedAt": 1.0,
        "operationIds": ["op-1"], "stationarity": {"run_len": 2},
        "stagnantCalls": {"repeats": 3, "seen": {"project_read\x1f{}": ["fp", 3]}},
        "readonlyStreak": {"rounds": 4, "nudged_at": 3},
        "options": {},
        "pendingCalls": [{"id": "x"}], "content": "旧内容",
    }
    out = continuation_checkpoint(settled, "[自动续跑 第 1 次] 还缺验收证据。")
    assert out["phase"] == "model", "不转成 model 就过不了 resume 守卫"
    assert out["messages"][-1]["role"] == "system"
    assert "自动续跑" in out["messages"][-1]["content"]
    # 新一轮：轮数/墙钟/token 重置，否则首轮烧掉的预算会让续跑一睁眼就撞墙
    assert out["round"] == 0 and out["cheapTokens"] == 0 and out["retrySpent"] == 0
    assert out["startedAt"] > settled["startedAt"]
    assert out["pendingCalls"] == [] and out["content"] == ""
    # ⚠ 反向：打转游标**必须**继承——它防的正是模型反复调同一个工具，
    #   每次续跑都重置等于每次都给它一次重新打转的机会。
    assert out["stationarity"] == {"run_len": 2}
    # 同理，第二道闸（同一次调用带回同一份结果）的账也必须继承：
    # 每次续跑都清零 = 每次都白送模型一段重新打转的余地。
    assert out["stagnantCalls"] == {"repeats": 3, "seen": {"project_read\x1f{}": ["fp", 3]}}
    # 第三道同理：每次续跑都清零 = 每次白送它一段「只读不写」的余量。
    assert out["readonlyStreak"] == {"rounds": 4, "nudged_at": 3}
    assert out["operationIds"] == ["op-1"]


def test_真机1反向_没有消息的checkpoint不许硬转():
    assert continuation_checkpoint(None, "x") is None
    assert continuation_checkpoint({}, "x") is None
    assert continuation_checkpoint({"phase": "settling", "messages": []}, "x") is None


def test_真机2_续跑账不许被落库擦掉():
    """真机第二趟：6 条里 5 条绿，`goal.continuations` 是 0。

    `update_goal` 原来**重建** goal 字典，continuations/progressMark 被静静
    抹掉。而它在每次 control_tool_start 时都会被调——于是计数每跑一个工具就
    清零，**目标级预算永远烧不完，续跑会无限循环**。

    判据直接盯产线源码的那段 transform：护栏写对了、落库把它擦了，是本仓
    §3「闸全绿但东西没了」的又一例。
    """
    import pathlib
    src = pathlib.Path(__file__).resolve().parents[1] / "services" / "control_run_store.py"
    text = src.read_text(encoding="utf-8")
    start = text.index("def update_goal")
    body = text[start:start + 2400]
    assert '"continuations": spent' in body, "update_goal 又把续跑次数抹掉了"
    assert '"progressMark"' in body, "update_goal 又把进展指纹抹掉了"


def test_真机3_被闸掐断的回合不许自动续跑():
    """跑控制面回归时抓到：8001 token 撞上 8000 的点火前额度被掐断，

    而续跑会给它一个全新单轮预算再跑一遍——**把预算闸整个绕过去**。
    「被掐断」和「说完了」是两回事，只有后者该续。
    """
    from services.control_goal_continuation import turn_was_capped

    capped = events() + [{"type": "control_text", "text": "额度用完了",
                          "stopReason": "token_budget", "limit": 8000, "used": 8001}]
    assert turn_was_capped(capped) is True
    ok, reason = should_continue(
        status="completed", goal=goal(), events=capped, goal_done=False
    )
    assert ok is False and reason == "capped"


def test_真机3反向_没被掐断的正常收尾照旧能续():
    assert turn_was_capped_import()(events()) is False
    ok, reason = should_continue(
        status="completed", goal=goal(), events=events(), goal_done=False
    )
    assert ok is True and reason is None


def turn_was_capped_import():
    from services.control_goal_continuation import turn_was_capped
    return turn_was_capped
