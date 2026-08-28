"""协作式暂停：在安全点上停下来等人（2026-08-28 验证件，第二版）。

⚠ **这仍是验证件（spike），没接进流水线。** 它证明"停在半路"机制上成立，
  不代表产品已经决定要拦。接线之前先读「还没解决的」那一段。

## 为什么需要它

伴随式澄清目前不拦路，理由写在 spec-assumptions 模块头：「工厂中途停下来
等回答会撞上闭环的 fail-closed 语义」。2026-08-28 把这句话拆开实测：

  ① 闭环判据（v5_publish_closure_response）**纯看状态、时间无关**。拿真会话
     sr-20260827191954 把 capabilityRuns 逐条截断实测：截到 8 条
     blocked=False，截到 7 条及以下一律 fail-closed。判据只认最后那条
     ``appbundle.runtimeClosure`` 有没有产出报告，前七条零贡献。

  ② 真机把一轮跑到 75 秒掐掉：runtimePhase=awaiting / awaitReason=no_progress，
     前 7 条有产出，第 8 条 execution 闸 failed、result 为空，
     publishClosure=null，modelVersions=0。

所以"中途停 = 白烧一轮"是真的，但病根是**今天唯一的停法是终止性取消**，
不是"停"本身。只要这一轮最后还走得到 runtimeClosure，闸就认。

## 第二版改了什么（照 grok-build 的 AskUserQuestion 重写）

第一版是**线程里 `threading.Event.wait()` 干等**，于是自带一个约束：
暂停期间占住 event-loop executor 的一个槽（启动日志：64 个，一组流式推演
占 5 槽）。那个约束是**第一版自己造出来的**，不是问题固有的。

grok 的做法（`xai-grok-tools/.../ask_user_question/mod.rs:458`）：

    let outcome = match wait {
        Some(dur) => tokio::time::timeout(dur, result_rx).await,
        None      => Ok(result_rx.await),
    };

**异步 await 一个通道，一个工作线程都不占。**

对应到这里：安全点提到**异步那一层**——引擎每一步是
``await asyncio.to_thread(...)``，暂停放在**两次 to_thread 之间**的协程里等。
这跟 run_cancel 头注那句「安全点放在步与步之间，别放进循环内层」本来就是
同一句话，只是那时没意识到它同时解决了占槽。

⚠ 代价与取消一样：一步有多大，暂停就最多迟到多久（真机单步量到过 918 秒）。
  这是协作式模型的固有取舍，run_cancel 头注已经论证过，不在这里重复权衡。

## 超时**不是失败**——这条是要害

grok 的模块头：

    Default max time to wait for the user to answer: 30 minutes.
    On expiry the tool returns the same skipped/cancel text as a user
    dismiss, **not a tool failure**.

所以"关掉页面 600 秒后被看门狗收掉"那个约束，正解不是"把 600 秒调大"，
而是**超时按「用户跳过」处理**：推演继续往下跑，走到最后一步，闭环照样绿。

这跟本仓现成的语义严丝合缝——spec-assumptions 头注写着「不点 = 就按模型
定的做，**这是个合法结局**」。等的就是同一件事，超时就按那个合法结局走。

三个细节一并照抄：
  · ``enabled=False`` = 永远等；**``seconds=0`` 明确不表示"永远等"**，
    那是另一个开关的活（grok 对 0 专门打警告并回落默认预算）。
  · 一次问一批共用**一个**计时器，不是每题一个。
  · ``non_interactive``：**没人在场**（页面关了 / 无头跑）时报的是
    "没有操作员"，不是"用户拒绝"。两者对下游是不同的事实，别揉成一个。

## 没人答怎么办：照 claw-code 的恢复配方

claw-code 把「问了人没人答」列成**六个已知故障场景之一**
（`runtime/src/recovery_recipes.rs` 的 ``TrustPromptUnresolved``）：

    RecoveryRecipe {
        steps: vec![RecoveryStep::AcceptTrustPrompt],   // 先自动按默认走一次
        max_attempts: 1,                                 // 只自动一次
        escalation_policy: EscalationPolicy::AlertHuman, // 再不行才喊人
    }

要害是**「没人答」是要预先设计的正常场景，不是异常**：自动按默认继续一次，
只走一次，还不行才升级喊人，每次尝试都留一条结构化事件。见
`unresolved_recovery` 与 `RecoveryLedger`。

## 还没解决的（接线之前）

  - **接线本身**：安全点要插进驱动器的异步循环；卡片要长出"拦路"的形态；
    答案要有一条送回正在跑的那一轮的路。这三样都还没有。
  - **产品判断**：哪些澄清值得拦。2026-08-28 复查发现 `_ASSUMPTIONS_ASK`
    的入选门槛本来就是「改了产品会长得不一样」，能上卡的**本来就全是结构
    性的**，再分一档收益很小。倾向于不做，等人拍板。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from contextvars import ContextVar
from typing import Any, Dict, Optional, Tuple

from .run_cancel import RunCancelled, is_cancelled

#: 醒来查一次取消的间隔。异步等待没有线程成本，所以这个值只影响取消的
#: 响应快慢：必须**明显小于** run_registry 的 5 秒硬取消宽限，否则硬取消
#: 会先于协作式退出发生，退回"停没停不知道"。
_POLL_SECONDS = 0.25

#: 默认等多久。照 grok 的 30 分钟——它是"人去倒杯咖啡回来还来得及"的量级，
#: 而不是"网络超时"的量级。等人跟等机器不是一回事。
DEFAULT_WAIT_SECONDS = 30 * 60.0


class PauseOutcome(str, Enum):
    """一次「停下来问人」的结局。**四种都是如实的事实，没有一种是异常。**

    ⚠ 别把 SKIPPED 和 NO_OPERATOR 揉成一个。前者是"人在，看了，没选"，
      后者是"根本没人在场"——对下游是不同的事实（要不要在收口句里提这件事、
      要不要下一轮再问一遍，两种答案不一样）。grok 为此专门有
      `non_interactive` 一档，报的是 NO_OPERATOR_TEXT 而不是用户拒绝。
    """

    #: 人答了
    ANSWERED = "answered"
    #: 超时，或人明确跳过 —— 按模型定的做，**合法结局**，不是失败
    SKIPPED = "skipped"
    #: 没人在场（页面关了 / 无头跑）
    NO_OPERATOR = "no_operator"
    #: 整轮被取消（取消赢过暂停）
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class PauseBudget:
    """等多久、以及场上有没有人。

    ⚠ ``seconds=0`` **不表示"永远等"**——那是 ``enabled=False`` 的活。
      0 一律回落默认预算并留一行告警（照 grok：「0 must never mean
      'wait forever' — that is timeout_enabled's job」）。把"不限时"和
      "限时 0 秒"塞进同一个字段，读的人分不出来，写的人迟早写错。
    """

    enabled: bool = True
    seconds: float = DEFAULT_WAIT_SECONDS
    #: 没有操作员在场（页面关了 / 无头跑）。结局报 NO_OPERATOR。
    non_interactive: bool = False

    def wait_budget(self) -> Optional[float]:
        """None = 永远等；否则是秒数。"""
        if not self.enabled:
            return None
        if self.seconds and self.seconds > 0:
            return float(self.seconds)
        return DEFAULT_WAIT_SECONDS


@dataclass(frozen=True)
class PauseResult:
    outcome: PauseOutcome
    where: str
    waited_seconds: float
    #: 人答了什么。只有 ANSWERED 时有值。
    answer: Optional[Any] = None

    @property
    def answered(self) -> bool:
        return self.outcome is PauseOutcome.ANSWERED

    @property
    def proceed_with_default(self) -> bool:
        """该按模型自己定的往下走吗。

        SKIPPED / NO_OPERATOR 都是——**这两种都不许把这一轮判死**。
        """
        return self.outcome in (PauseOutcome.SKIPPED, PauseOutcome.NO_OPERATOR)


class PauseGate:
    """一次「停下来问人」。**异步等，不占执行槽。**

    用法（在驱动器的协程里，两次 to_thread 之间）::

        gate = PauseGate(PauseBudget(non_interactive=no_subscribers))
        ...把问题推给前端，前端答完调 gate.answer(...)...
        result = await gate.wait("第4.5步 改键前")
        if result.answered:
            ...按人选的走...
        # 其余一律往下跑：超时/没人在场都是合法结局，不许拦死这一轮
    """

    def __init__(self, budget: Optional[PauseBudget] = None) -> None:
        self._budget = budget or PauseBudget()
        self._event = asyncio.Event()
        self._answer: Optional[Any] = None
        self._skipped = False

    # —— 外部（前端回调 / 控制面）调的三个 ——
    def answer(self, payload: Any) -> None:
        """人答了。"""
        self._answer = payload
        self._event.set()

    def skip(self) -> None:
        """人明确说"就这样"。跟超时同一个结局。"""
        self._skipped = True
        self._event.set()

    @property
    def budget(self) -> PauseBudget:
        return self._budget

    async def wait(self, where: str) -> PauseResult:
        """停在这儿等。**不抛异常**——四种结局都由返回值如实说出来。

        ⚠ 只有一种情况抛：整轮被取消。那时候语义上取消赢，且必须跟
          `raise_if_cancelled` 同一个异常类型，否则沿途 `except Exception`
          的 fail-open 兜底层会把它当成"这一步失败了"接住（见 RunCancelled
          的头注：特意不继承 CancelledError 就是为了能被接住，这里要的是
          同一套行为）。
        """
        started = time.monotonic()
        budget = self._budget.wait_budget()
        deadline = None if budget is None else started + budget

        while True:
            if is_cancelled():
                raise RunCancelled(f"已请求取消，停在 {where} 的暂停闸上")
            if self._event.is_set():
                break
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                return self._settle(PauseOutcome.SKIPPED, where, started)
            slice_s = _POLL_SECONDS
            if deadline is not None:
                slice_s = min(slice_s, max(deadline - now, 0.0))
            try:
                await asyncio.wait_for(self._event.wait(), timeout=slice_s or _POLL_SECONDS)
            except asyncio.TimeoutError:
                continue  # 醒来查一次取消/截止，再接着等

        if self._skipped or self._answer is None:
            return self._settle(PauseOutcome.SKIPPED, where, started)
        return self._settle(PauseOutcome.ANSWERED, where, started, self._answer)

    def _settle(
        self,
        outcome: PauseOutcome,
        where: str,
        started: float,
        answer: Any = None,
    ) -> PauseResult:
        # 没人在场时，"没答"报的是 NO_OPERATOR 而不是"用户跳过"——
        # 那不是用户的选择，是压根没有用户（照 grok 的 non_interactive）。
        if outcome is PauseOutcome.SKIPPED and self._budget.non_interactive:
            outcome = PauseOutcome.NO_OPERATOR
        return PauseResult(
            outcome=outcome,
            where=where,
            waited_seconds=round(time.monotonic() - started, 3),
            answer=answer,
        )


# ── 没人答怎么办：照 claw-code 的恢复配方 ────────────────────────────


@dataclass(frozen=True)
class RecoveryRecipe:
    """一个已知故障场景的自动恢复配方。

    照 claw-code `runtime/src/recovery_recipes.rs`：**「问了人没人答」是六个
    已知故障场景之一，不是异常**。自动按默认走一次，只走一次，还不行才升级
    喊人，每次尝试留一条结构化事件。
    """

    scenario: str
    steps: Tuple[str, ...]
    max_attempts: int
    escalation: str


#: 「停下来问了，但没人答」的配方。
#: steps 只有一步："按模型自己定的往下走"——那正是 spec-assumptions 头注
#: 认定的合法结局，所以自动执行它不需要额外授权。
UNRESOLVED_RECOVERY = RecoveryRecipe(
    scenario="pause_unresolved",
    steps=("按模型自己定的往下走",),
    max_attempts=1,
    escalation="alert_human",
)


@dataclass
class RecoveryAttempt:
    scenario: str
    attempted: bool
    attempts_remaining: int
    escalate: bool
    reason: str
    #: 结构化事件：留痕用，一次尝试一条（claw-code 的 recovery event）
    event: Dict[str, Any] = field(default_factory=dict)


class RecoveryLedger:
    """记每个场景自动恢复过几次。超了配方的次数就升级，不再默默重试。

    ⚠ 「只自动一次」是配方的一部分，不是可调的旋钮：自动重试第二次意味着
      同一个没人理的问题会把这一轮拖两遍，而人还是没来。第二次该做的是
      喊人，不是再试。
    """

    def __init__(self) -> None:
        self._used: Dict[str, int] = {}

    def attempt(
        self, recipe: RecoveryRecipe = UNRESOLVED_RECOVERY, *, detail: str = ""
    ) -> RecoveryAttempt:
        used = self._used.get(recipe.scenario, 0)
        remaining = max(recipe.max_attempts - used, 0)
        if remaining <= 0:
            return RecoveryAttempt(
                scenario=recipe.scenario,
                attempted=False,
                attempts_remaining=0,
                escalate=True,
                reason=f"自动恢复已用满 {recipe.max_attempts} 次，升级：{recipe.escalation}",
                event={
                    "kind": "recovery_escalated",
                    "scenario": recipe.scenario,
                    "policy": recipe.escalation,
                    "detail": detail,
                },
            )
        self._used[recipe.scenario] = used + 1
        return RecoveryAttempt(
            scenario=recipe.scenario,
            attempted=True,
            attempts_remaining=remaining - 1,
            escalate=False,
            reason=f"自动恢复：{'、'.join(recipe.steps)}",
            event={
                "kind": "recovery_attempted",
                "scenario": recipe.scenario,
                "steps": list(recipe.steps),
                "attempt": used + 1,
                "detail": detail,
            },
        )


def recover_from(
    result: PauseResult, ledger: RecoveryLedger
) -> Optional[RecoveryAttempt]:
    """人答了就不需要恢复；没答就按配方走一次。

    ⚠ 返回 None 只表示"这次不需要恢复"，**不表示出错**。调用方拿到
      `attempted=True` 就照默认往下跑，拿到 `escalate=True` 才喊人。
    """
    if result.answered:
        return None
    return ledger.attempt(detail=f"{result.outcome.value}@{result.where}")


# ── 接线：一个 run 的暂停位 ──────────────────────────────────────────
#
# 形状照 run_cancel：run_registry 起跑前把位子绑进 ContextVar，驱动器在安全点
# 读它，路由通过 run_id 找到同一个位子往里放 gate。
#
# ⚠ 为什么绑「位子」而不是绑 gate：gate 是**用户按下暂停那一刻**才造出来的，
#   而绑定必须发生在**起跑之前**（asyncio.to_thread 复制的是那一刻的 Context，
#   绑晚了读到的就是 None——run_cancel 头注为此专门写过一段）。所以绑一个
#   可变的位子，事后往里放东西。


@dataclass
class PauseSlot:
    """一个 run 的暂停位。

    ⚠ 两格，不是一格（2026-08-28 真机咬出来的）。第一版只有一格、
      `take_hold` 把闸**取走**——于是驱动器一开始等，路由按 run_id 就再也
      找不到那个闸，`release` 恒返回 released=false，这一轮永远停在那儿。
      真机实测：按暂停 → 停住 ✅ → 放行 → `{"released":false}`、15 秒零新
      事件。而单测全绿，因为它直接拿着 gate 对象调 answer，**绕过了位子
      查找**——正向判据齐全、反向判据缺失（CLAUDE.md §3）。

    pending 是"按了还没到安全点"，active 是"正在等"。放行两格都认：用户
    可能在安全点到达之前就答了，那时闸还在 pending 里（路由头注说的那个
    正常竞态）。
    """

    pending: Optional["PauseGate"] = None
    active: Optional["PauseGate"] = None


_SLOT: ContextVar[Optional[PauseSlot]] = ContextVar(
    "sliderule_run_pause_slot", default=None
)


def _slot_var() -> ContextVar:
    return _SLOT


def new_slot() -> PauseSlot:
    return PauseSlot()


def bind(slot: Optional[PauseSlot]) -> None:
    """绑到当前上下文。**必须在起跑前调用**（理由同 run_cancel.bind）。"""
    _slot_var().set(slot)


def pause_enabled() -> bool:
    """`SLIDERULE_RUN_PAUSE_ENABLED=0` 关掉整条暂停线路。默认开。

    ⚠ 默认开是安全的：**不按暂停就一个字都不变**——安全点只多一次字典读取，
      没有任何人放 gate 进来时立刻返回。关掉的开关留着，是因为它能停住一条
      跑了两分钟的推演，出事时要有一根总闸。
    """
    import os

    raw = str(os.environ.get("SLIDERULE_RUN_PAUSE_ENABLED", "1")).strip().lower()
    return raw not in ("0", "false", "no", "off")


def request_hold(slot: Optional[PauseSlot], budget: Optional[PauseBudget] = None) -> Optional[PauseGate]:
    """用户按了「先别往下跑」。下一个安全点会停住。

    已经有一个在等就返回原来那个——重复按不该开出第二道闸。
    """
    if slot is None or not pause_enabled():
        return None
    existing = slot.active or slot.pending
    if existing is not None:
        return existing
    slot.pending = PauseGate(budget)
    return slot.pending


def take_hold() -> Optional[PauseGate]:
    """驱动器在安全点调：有人按过暂停就把闸转成"正在等"，没有就 None（零成本）。

    ⚠ **转成 active，不是取走**。取走的话路由就找不到它了——见 PauseSlot
      头注里那次真机。
    """
    slot = _slot_var().get()
    if slot is None or slot.pending is None:
        return None
    gate = slot.pending
    slot.pending = None
    slot.active = gate
    return gate


def finish_hold() -> None:
    """等完了：把"正在等"清掉。不清的话下一轮的 release 会打到一个已经
    结束的闸上，返回 released=true 却什么也没发生。"""
    slot = _slot_var().get()
    if slot is not None:
        slot.active = None


async def pause_here(where: str) -> Optional[PauseResult]:
    """安全点。没人按暂停就立刻返回 None——**正常路径上就是一次字典读取**。

    ⚠ 放在**步与步之间**（驱动器循环的开头），不要放进循环内层：这一层的
      意义是"别再开始下一件大活儿"，跟 run_cancel.raise_if_cancelled 同一条
      纪律、同一批位置。
    """
    gate = take_hold()
    if gate is None:
        return None
    return await gate.wait(where)
