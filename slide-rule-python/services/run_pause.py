"""协作式暂停：让跑在线程里的引擎**在安全点上停下来等人**（2026-08-28 验证件）。

⚠ **这是一个验证件（spike），还没接进流水线。** 它证明"停在半路"这件事
  机制上成立，不代表产品已经决定要拦。接线之前先读下面「为什么需要它」和
  「还没解决的」两段。

## 为什么需要它

伴随式澄清目前**不拦路**，那是 spec-assumptions 模块头写死的有意设计：
「工厂中途停下来等回答会撞上闭环的 fail-closed 语义」。

2026-08-28 实测把这句话拆开了，结论跟原来的猜测不一样：

  ① 闭环判据（v5_publish_closure_response）是**纯看状态、时间无关**的。
     拿真会话（sr-20260827191954）把 capabilityRuns 逐条截断实测：

         截到 8 条 → blocked=False skillCount=6   ← 唯一的绿
         截到 7 条及以下 → 一律 fail-closed

     判据只取决于最后那条 ``appbundle.runtimeClosure`` 有没有产出报告，
     前七条对结论零贡献。**它不知道也不在乎中间停过多久。**

  ② 真机把一轮跑到 75 秒掐掉，量到的现场：

         runtimePhase=awaiting / awaitReason=no_progress   ← 停进等待态，不炸
         前 7 条能力有产出，第 8 条 execution 闸 failed、result 为空
         publishClosure=null                               ← fail-closed
         modelVersions=0                                   ← 下一轮复用不了

所以"中途停 = 白烧一轮"是真的，**但病根不是"停"，是今天唯一的停法
（run_cancel）是终止性的**——取消让最后一步失败，于是交不出报告。

换句话说：只要这一轮最后**还能走到** ``appbundle.runtimeClosure``，闸就认。
这就是本模块存在的理由——在同一批安全点上"等"，而不是"抛"。

## 为什么跟 run_cancel 同形

同一个约束：``Task.cancel()`` 打不断已经在线程里跑的同步代码（见 run_cancel
模块头，那里有实测数字）。所以暂停也只能靠**在安全点主动查一下**，用
ContextVar 装一个可变对象（Event），线程读到的是同一个引用。

形状照 .NET / Go / Temporal 那套协作式模型，不引库——一个 Event 加一个
等待函数就是全部。

## ⚠ 暂停必须是可取消的，否则是死锁

最危险的失败形态不是"停不住"，是**停住了就再也出不来**：用户走开了、
标签页关了、看门狗喊了取消，而线程还在 ``Event.wait()`` 上干等到天荒地老，
占着 64 个执行槽里的一个。

所以 ``wait_here_if_paused`` **不是**裸 ``wait()``：它带超时轮询，每一轮
醒来先查取消令牌，被取消就照 run_cancel 的语义抛 RunCancelled。判据
``暂停中被取消不会死锁`` 钉着这条——那是这个模块唯一不许错的地方。

## 安全点放在哪

跟 raise_if_cancelled 同一批位置（步与步之间），理由也同一条：这一层的
意义是"别再开始下一件大活儿"，不是"把当前这件切成碎片"。切太碎既救不了
已经发出去的 LLM 请求，又给每一步都加一处可能抛异常的地方。

## 还没解决的（接线之前必须先想清楚）

  - **占线程**：暂停期间占着 event-loop executor 的一个槽（启动日志：64 个，
    流式推演一组占 5 槽）。同时暂停的人多了会挤掉别人的并发。接线时要么
    限制同时暂停数，要么把安全点改成异步等待。
  - **孤儿看门狗**：run_registry 按「订阅者为 0 超过 600 秒」收掉。页面开着
    就有订阅者、不会被收；关掉页面则 600 秒后被收——那时暂停就变成了取消，
    退回 fail-closed。接线时要么调大宽限，要么在暂停时明确告诉用户别关页面。
  - **产品判断**：哪些澄清值得拦。照 grok-build 的分档，只有"改了就得整个
    重画"的那种才该升格成拦路的；按钮文案那种改了不影响大局，继续摊开就行。
"""

from __future__ import annotations

import threading
from contextvars import ContextVar
from typing import Optional

from .run_cancel import raise_if_cancelled

#: 当前 run 的暂停闸。**未暂停时是 set() 状态**（绿灯放行），
#: 请求暂停时 clear()（红灯）。方向跟取消令牌相反，是因为
#: "常态放行"才能让没暂停的那条路零成本——见 wait_here_if_paused。
_GATE: ContextVar[Optional[threading.Event]] = ContextVar(
    "sliderule_run_pause", default=None
)

#: 醒来查一次取消的间隔。短了空转、长了取消响应迟钝；
#: 取消的硬宽限是 5 秒（run_registry._cancel_hard_grace_seconds），
#: 所以这里必须**明显小于它**，否则硬取消会先于协作式退出发生。
_POLL_SECONDS = 0.25


def new_gate() -> threading.Event:
    """造一个暂停闸。**出厂即放行**——绑上它不改变任何行为。"""
    gate = threading.Event()
    gate.set()
    return gate


def bind(gate: Optional[threading.Event]) -> None:
    """绑到当前上下文。**必须在起跑前调用**，之后才会被复制进线程。"""
    _GATE.set(gate)


def request_pause(gate: threading.Event) -> None:
    """请求暂停。异步侧调用；线程侧下一个安全点会停住。"""
    gate.clear()


def resume(gate: threading.Event) -> None:
    """放行。线程侧最多 _POLL_SECONDS 之后继续往下走。"""
    gate.set()


def is_paused() -> bool:
    gate = _GATE.get()
    return gate is not None and not gate.is_set()


def wait_here_if_paused(where: str) -> None:
    """安全点：暂停中就停在这儿等，等的过程里持续查取消。

    ⚠ 三条不许改的性质，各有判据钉着：

      1. 没暂停时**零阻塞**：常态是 set()，`is_set()` 一次就走人，不进循环。
         这条决定了能不能把安全点撒在每一步之间而不给正常路径加延迟。
      2. 暂停中**仍然可取消**：每 _POLL_SECONDS 醒来查一次取消令牌，
         被取消就抛 RunCancelled（跟 raise_if_cancelled 同一个异常、
         同一个语义）。不这样写就是死锁——用户关了页面、看门狗喊了取消，
         而线程永远醒不过来，占着执行槽。
      3. 放行后**接着往下跑**，不是从头再来。这条是闭环能变绿的全部理由：
         闸只要最后那条 appbundle.runtimeClosure 交得出报告。
    """
    # 先查取消：暂停期间被取消，语义上取消赢——跟安全点原本的顺序一致。
    raise_if_cancelled(where)
    gate = _GATE.get()
    if gate is None or gate.is_set():
        return
    while not gate.wait(_POLL_SECONDS):
        raise_if_cancelled(where)
    raise_if_cancelled(where)
