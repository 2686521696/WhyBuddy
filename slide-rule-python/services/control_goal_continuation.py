"""目标没做完就自己接着跑——**但要有人管住它**。

## 修的是什么（2026-09-13）

`control_run_service._produce` 里这五行决定了一个回合的下场：

    if any(event.get("type") == "complete" for event in record["events"]):
        status = "waiting_user" if 问过用户 else "completed"

两个都在 TERMINAL 里，没人叫得醒。于是模型说一句「好的，我这就去实现截止
日期功能」然后没调工具，目标八字没一撇，run 却被判成「完成了」——用户只能
自己打「继续」。§27 列的第一条体验差距就是这个。

叫醒机制本身已经有了（`_requeue_settled_goals`：等的 operation 一结束就把
run CAS 翻回 queued，由原 producer 从 checkpoint 接着跑，不新建 Agent）。
缺的是**第三个叫醒理由**：模型不说话了，但事没干完。

## 四条护栏，一条都不能省

**一、只有工程目标能自动续跑。**
    对话目标没有可验证的「做完了」——判它没完就等于无限续跑，判它做完了
    就是编。没有证据的地方不猜（§7：闭环类 fail-closed）。

**二、没进展就不再叫醒。** 这是最重要的一条。
    一次续跑如果一个工具都没调（纯说话），再叫一次只会得到同样的一句话。
    没有这条，模型说「我这就去做」就能把额度烧干而什么都没有。

**三、目标级预算。**
    跟单轮预算是两码事：单轮墙钟每次续跑都会重置（`run_control_turn` 每次
    都新起一轮），所以拦不住无限续跑。这里数的是**这个目标一共自动续了
    几次**。

**四、问过用户的、失败的、被取消的，一律不续。**
    等人回答就是真的要等人；失败要让人看见，不许自己重试掩盖过去。

⚠ 判据 `test_control_goal_continuation.py` 对每条护栏都有反向判据，
  变异（去掉任一条）都要变红。
"""

from __future__ import annotations

import time

from typing import Any, Dict, List, Optional

#: 一个目标最多自动续跑几次。超了就停下来问人，不是继续烧。
#:
#: ⚠ 标定说明：真机一次「加截止日期 + 逾期筛选」大致是
#: read → patch → exec → status → verify 五步，模型偶尔多看一次源码。
#: 8 次留了余量又不至于失控。改这个数要连同真机样本一起重估，别拍脑袋。
MAX_CONTINUATIONS = 8

#: 这些终态不许自动续：等人回答是真的要等人；失败/取消要让人看见。
_NEVER_CONTINUE = frozenset({"waiting_user", "failed", "cancelled", "interrupted"})


def tool_result_count(events: Any) -> int:
    """这一 run 至今真的跑完过几次工具。

    进展指纹用它而不用「事件总数」：事件每轮都会涨（光说话也涨），
    只有工具结果代表**真的动了什么**。
    """
    if not isinstance(events, list):
        return 0
    return sum(
        1
        for event in events
        if isinstance(event, dict) and event.get("type") == "control_tool_result"
    )


def progress_mark(events: Any) -> str:
    """把「到目前为止的进展」压成一个可比较的指纹。"""
    return f"tools:{tool_result_count(events)}"


def turn_was_capped(events: Any) -> bool:
    """这一轮是**被闸掐断**的，不是模型自己说完了。

    ⚠ 2026-09-13 真机 `control-continuation-smoke` 之后、跑控制面回归时抓到：
      `test_legacy_8001_tokens_still_prevent_project_creation[client-forged-policy]`
      当场变红。那一轮是 8001 token 撞上 8000 的点火前额度被掐断的，而我的
      续跑会**给它一个全新的单轮预算再跑一遍**——等于把预算闸整个绕过去。

      「被掐断」和「说完了」是两回事：前者是我们不让它继续，后者是它自己
      停下。只有后者才该自动续跑。同理，provider 挂了（llm_unavailable）
      也要让人看见，不许自己重试掩盖。
    """
    if not isinstance(events, list):
        return False
    return any(
        isinstance(event, dict) and str(event.get("stopReason") or "").strip()
        for event in events
    )


def continuation_budget_left(goal: Any) -> int:
    spent = 0
    if isinstance(goal, dict):
        raw = goal.get("continuations")
        if isinstance(raw, int) and raw > 0:
            spent = raw
    return max(MAX_CONTINUATIONS - spent, 0)


def should_continue(
    *,
    status: str,
    goal: Any,
    events: Any,
    goal_done: bool,
) -> tuple[bool, Optional[str]]:
    """这一回合结束之后，要不要自己接着跑。

    返回 ``(要不要续, 不续的原因)``。原因是给人看的诊断，不是给模型的提示词；
    续跑时为 ``None``。

    ⚠ 调用方必须已经确认过 rollout 开着、租约还在。这里只做纯判断，
      不碰存储、不发事件。
    """
    if status in _NEVER_CONTINUE:
        return False, f"terminal_{status}"
    if status != "completed":
        return False, f"not_settled_{status}"
    goal_dict: Dict[str, Any] = goal if isinstance(goal, dict) else {}
    if goal_dict.get("kind") != "project":
        # 对话目标没有可验证的「做完了」。不猜。
        return False, "not_a_project_goal"
    if goal_done:
        return False, "goal_done"
    if turn_was_capped(events):
        # 闸掐断的不许自己再要一份预算。见 turn_was_capped 头注。
        return False, "capped"
    if continuation_budget_left(goal_dict) <= 0:
        return False, "budget_exhausted"
    mark = progress_mark(events)
    if goal_dict.get("progressMark") == mark:
        # 上一次续跑之后一个工具都没跑成——再叫一次只会拿到同一句话。
        return False, "no_progress"
    return True, None


def continuation_checkpoint(checkpoint: Any, notice: str) -> Optional[Dict[str, Any]]:
    """把「已经收尾的那一轮」的 checkpoint 改造成「新一轮的起点」。

    ## 为什么必须转换（2026-09-13 真机 control-continuation-smoke 第一趟）

    第一趟真机直接红在这里：`error: control_reconciliation_required`。

    `_produce` 的 resume 守卫只认 `phase in {"model","tools"}`——那是「回合**中途**
    被打断」的形态。而自动续跑面对的是另一种：**上一回合已经正常收尾了**
    （text-only 结束，`rehearsal_control` 留下 `phase="settling"`），我们要开的是
    **新一轮**，不是接着上一轮的半截。守卫于是当场把它判成需要人工对账。

    转换做三件事：
      · phase → "model"：新一轮从「准备采样」开始
      · 把续跑说明追进 messages：模型得知道自己为什么又醒了
      · **重置这一轮的预算计量**（见下）

    ## 预算：这一轮重置，总量由续跑次数管

    resume 会把 `startedAt` / `cheapTokens` 一起还原——那是「同一轮被打断后
    接着算」的语义。续跑不是同一轮：不重置的话，首轮烧掉 100 秒，续跑一睁眼
    就只剩 80 秒，基本立刻撞墙钟，续跑等于白做。

    所以这里给新一轮**干净的单轮预算**，总量改由 `MAX_CONTINUATIONS` 兜底：
    最坏情况是 8 轮完整预算，而「没进展就收手」通常在第 1~2 次就把它掐掉。

    ⚠ `stationarity`（原地打转游标）**故意保留**：它防的正是模型反复调同一个
      工具，跨轮次继承才有意义，重置了等于每次续跑都给它一次重新打转的机会。
    """
    if not isinstance(checkpoint, dict):
        return None
    messages = checkpoint.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    text = str(notice or "").strip()
    return {
        **checkpoint,
        "phase": "model",
        "messages": [*messages, {"role": "system", "content": text}] if text else list(messages),
        # 新一轮：轮数、墙钟、token 从头算。
        "round": 0,
        "startedAt": time.time(),
        "cheapTokens": 0,
        "retrySpent": 0,
        "retryStartedAt": time.time(),
        "pendingCalls": [],
        "content": "",
    }


def continuation_notice(blocked_reasons: Any, attempt: int) -> str:
    """续跑时追加给模型的那句话。

    ⚠ 内容**从服务端算出来的 blockedReasons 生成**，不是「请继续」这种空话，
      也不是重放用户原来那条 POST——模块头注写着：过期的派发意图是不确定性
      的证据，不是重放的许可。拿不到具体原因时只说状态，不编。
    """
    reasons: List[str] = []
    if isinstance(blocked_reasons, list):
        for item in blocked_reasons:
            text = str(item or "").strip()
            if text and text not in reasons:
                reasons.append(text[:120])
            if len(reasons) >= 6:
                break
    head = f"[自动续跑 第 {attempt} 次] 这个目标还没达到可交付状态。"
    if not reasons:
        return head + "服务端没有给出具体缺项；先用 project_status 查清当前状态再决定下一步。"
    return head + "服务端判定仍缺：" + "；".join(reasons) + "。请据此继续，不要重复已经完成的步骤。"
