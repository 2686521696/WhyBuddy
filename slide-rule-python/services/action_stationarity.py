# -*- coding: utf-8 -*-
"""原地打转检测：同一件工具、同一份实参，连着调了几轮。

抄的标准答案：grok-build
`crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs`
的 `IdenticalToolCallRun` / `step_signature` / `canonicalize_json`
（连同它头顶那几行事故记录）：

    /// A production turn repeated one `ToolKind::Plan` call (`todo_write`) with
    /// byte-identical arguments 12 times (224 in the turn).
    /// Replaying it showed the model answers the user as soon as it is interrupted.

grok 的主循环每一轮**开头第一件事**就是问这个，问完才去采样——
先判断状态，再花钱问模型。我们原来只数总轮数（MAX_TOOL_ROUNDS=8），
「跑了 8 轮」和「同一件事干了 8 遍」在停因表上是同一句话。

这个模块是叶子（services 里谁都不依赖）：它**不自己查工具权限**，
`problematic` 由调用方算好传进来——跟 grok 一样，
`step_is_problematically_repeating` 在 turn.rs 里，struct 只收一个 bool。
所以它谁都不 import，谁都能安全 import 它。

──────────────────────────────────────────────────────────────────────────
⚠ 阈值是**重新标定过的，不是照抄 grok 的 4/8/8/12**。

grok 的 `max_turns` 默认是 `None`（不限轮），4/8/8/12 是在一个基本无界的
循环里的绝对值。我们的控制面 `MAX_TOOL_ROUNDS = 8` —— 照抄过来，
「连续 12 次相同调用」在真机上**永远不成立**，「连续 8 次」也要烧掉整个预算
才可能碰到一次。那正是 CLAUDE.md §一之二 点名的形态：护栏装在真跑的路上，
条件却永远为假，单测还绿（判据自己构造那个输入）。

所以判据里钉了一条 `test_硬停阈值必须小于总轮数预算`：
阈值一旦被改回 grok 的原值，或者有人把 MAX_TOOL_ROUNDS 调小，立刻红。
──────────────────────────────────────────────────────────────────────────

真机验过（2026-09-09，真 uvicorn + 真 HTTP + 真 SSE）：LLM_BASE_URL 指向一台
复读机网关（每一发都回同一次 `search_evidence`，实参一字不差），
会话先 PUT 成「范围已确认 + 已有模型」——**这一步是必须的**，第一次试忘了，
`search_evidence` 不在本轮清单里被裁掉、calls 为空、第一轮就 return，
什么都没触发：

    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] stationarity_nudge tool='search_evidence' run_len=2 problematic=1 round=2
    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] goal='请假系统' offered=[…'search_evidence'] picked=['search_evidence']
    [control] stationarity_stop  tool='search_evidence' run_len=4 problematic=1 round=4

    STOP: {"stopReason":"stationarity","stoppedBy":"runtime","limit":4,"used":4,
           "text":"我在同一步上打转了，先停下没点火。…"}

反向也在真机上量过：同一天 12 条真话题（16 轮控制面）跑完，
日志里 `stationarity_` 出现 **0** 次——正常流量不许误伤。

没抄的那一档：grok 还有 `MAX_CONSECUTIVE_TRUE_NOOPS`（`command_is_true`——
模型反复跑 `run(cmd="true")` 当保活）。我们的闭集里没有任何一件工具能当
空转保活用，硬造一个判据只会得到又一条真机上永不成立的分支。
以后真出现了再加，别现在替它占位。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

#: READ 档（同一份实参必然回同一份结果）：捅一下 / 硬停。
NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS = 2
MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS = 4

#: 其余（WRITE、以及查不到权限的新工具）：宽一档。
#: 抄 grok 那条理由——「重复也可能是正当的」，所以不用紧档去卡它。
NUDGE_AFTER_IDENTICAL_CALLS = 3
MAX_CONSECUTIVE_IDENTICAL_CALLS = 5

# grok 用 `const _: () = assert!(...)` 在编译期钉住这两条。Python 没有编译期，
# import 期就是最早的时刻——捅一下的阈值必须严格小于硬停，否则「先提醒后掐断」
# 塌成「只掐断」，而那正是这次改造要治的病。
assert (
    NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS < MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
)
assert NUDGE_AFTER_IDENTICAL_CALLS < MAX_CONSECUTIVE_IDENTICAL_CALLS

#: 捅一下时贴给模型的那句话。抄 grok `ACTION_STATIONARITY_NUDGE_TEMPLATE`
#: 的三段结构：说清**观察到了什么**、给一条**出路**、预告**再来就掐**。
#: 只说「别重复了」而不给出路，模型往往换个参数再重复一遍。
NUDGE_TEMPLATE = (
    "你已经连着 {run_len} 轮调用同一件工具（`{tool_name}`），实参一字不差——"
    "这一路在原地打转。别再重复这次调用了。"
    "已经拿到的信息够就直接往下走（该画就画、该问就问）；"
    "还缺东西就换一件工具或者换一份实参；"
    "实在推进不下去，就停下来用一句话告诉用户你卡在哪。"
    "再这么重复下去，这一轮会被自动掐断。"
)


def _canonical(value: Any) -> Any:
    """递归排序对象的键，让同一份实参不因序列化顺序不同而算成两次调用。

    抄 grok `canonicalize_json`：`{"a":1,"b":2}` 与 `{"b":2,"a":1}` 是同一次调用。
    **数组顺序不动**——数组顺序是语义的（一份清单、一批改动），重排是真的改动。
    """
    if isinstance(value, dict):
        return {k: _canonical(value[k]) for k in sorted(value, key=str)}
    if isinstance(value, (list, tuple)):
        return [_canonical(v) for v in value]
    return value


def step_signature(calls: Sequence[Dict[str, Any]]) -> str:
    """一轮采样的签名：这一轮发出的每一次调用，各自规范化后再排序。

    抄 grok `step_signature`：并行调用换个顺序再发一遍**不算进展**。
    实参序列化不了就退回 repr（对应 grok「不是合法 JSON 就用 trim 过的原文」）。
    """
    parts: List[str] = []
    for call in calls:
        name = str((call or {}).get("name") or "")
        args = (call or {}).get("arguments")
        try:
            rendered = json.dumps(
                _canonical(args if isinstance(args, dict) else {}),
                sort_keys=True,
                ensure_ascii=False,
            )
        except (TypeError, ValueError):
            rendered = repr(args)
        parts.append(f"{name}\x1f{rendered}")
    parts.sort()
    return "\x1e".join(parts)


def step_tool_name(calls: Sequence[Dict[str, Any]]) -> str:
    """这一轮报给日志/用户的代表名。抄 grok：取名字里最小的那个，稳定可复现。"""
    names = sorted(str((c or {}).get("name") or "") for c in calls)
    return names[0] if names else ""


class IdenticalToolCallRun:
    """连续相同调用的游标。**一个回合一个**，不许做成模块级单例
    （那会让上一位用户的打转记录漏到下一位身上）。"""

    __slots__ = ("last_signature", "tool_name", "problematic_step", "run_len", "nudged")

    def __init__(self) -> None:
        self.last_signature: Optional[str] = None
        self.tool_name: str = ""
        self.problematic_step: bool = False
        self.run_len: int = 0
        self.nudged: bool = False

    def observe(
        self, signature: str, tool_name: str, problematic_step: bool
    ) -> int:
        """记一轮。签名跟上一轮一样就 +1，不一样就重新起一段（并清掉捅过的标记）。"""
        if self.last_signature == signature:
            self.run_len += 1
        else:
            self.run_len = 1
            self.last_signature = signature
            self.nudged = False
        self.tool_name = tool_name
        self.problematic_step = problematic_step
        return self.run_len

    def is_problematic(self) -> bool:
        return self.problematic_step

    def nudge_threshold(self) -> int:
        return (
            NUDGE_AFTER_IDENTICAL_PROBLEMATIC_CALLS
            if self.is_problematic()
            else NUDGE_AFTER_IDENTICAL_CALLS
        )

    def hard_stop_threshold(self) -> int:
        return (
            MAX_CONSECUTIVE_IDENTICAL_PROBLEMATIC_CALLS
            if self.is_problematic()
            else MAX_CONSECUTIVE_IDENTICAL_CALLS
        )

    def should_hard_stop(self) -> bool:
        return self.run_len >= self.hard_stop_threshold()

    def take_nudge(self) -> bool:
        """一段打转里**只捅一次**。抄 grok `take_nudge`：只在结果已经落进
        对话之后调（我们是在下一轮循环开头调），不然提醒会贴在还没发生的事上。"""
        fire = (not self.nudged) and self.run_len >= self.nudge_threshold()
        self.nudged = self.nudged or fire
        return fire

    def nudge_text(self) -> str:
        return NUDGE_TEMPLATE.format(
            run_len=self.run_len, tool_name=self.tool_name or "（未具名）"
        )

    def telemetry(self) -> Tuple[str, int, bool]:
        """(工具名, 连了几轮, 是不是紧档)。日志和停止信封共用这一份，不各拼各的。"""
        return (self.tool_name, self.run_len, self.is_problematic())
