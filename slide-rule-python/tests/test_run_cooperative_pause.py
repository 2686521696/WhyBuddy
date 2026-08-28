"""能不能"停在半路"——验证件的判据（2026-08-28）。

## 这个文件在回答什么问题

伴随式澄清目前不拦路，理由写在 spec-assumptions 模块头：「工厂中途停下来
等回答会撞上闭环的 fail-closed 语义」。2026-08-28 把这句话拆开实测：

  ① 闭环判据是**纯看状态、时间无关**的。真会话 sr-20260827191954 的
     capabilityRuns 逐条截断实测：截到 8 条 blocked=False，截到 7 条及以下
     一律 fail-closed。判据只认最后那条 appbundle.runtimeClosure 有没有
     产出报告，**不知道也不在乎中间停过多久**。

  ② 真机把一轮跑到 75 秒掐掉：runtimePhase=awaiting、前 7 条有产出、
     第 8 条 execution 闸 failed、publishClosure=null、modelVersions=0。

所以"中途停 = 白烧一轮"是真的，但病根是**今天唯一的停法是终止性取消**，
不是"停"本身。剩下的问题就一个：机制上能不能"停住再接着跑"。这个文件
就是那个问题的判据。

## 为什么判据长这样

照 test_run_cooperative_cancel.py 的形制：起一个假 worker，让它按步走，
在步与步之间过安全点。**不烧 LLM**——要验的是机制，不是模型。

⚠ 判据必须能被变异咬住。四条各钉一件事，把实现改回去任一条都会红：
  停不住 / 放行后不接着跑 / 暂停中取消不了（死锁）/ 常态被加了延迟。
"""

import asyncio
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import run_cancel, run_pause  # noqa: E402


@pytest.fixture(autouse=True)
def _reset():
    run_cancel.bind(None)
    run_pause.bind(None)
    yield
    run_cancel.bind(None)
    run_pause.bind(None)


def _worker(steps, done, *, sink):
    """假引擎：按步走，步与步之间过安全点。跑到哪一步如实记下来。

    ⚠ **必须经 asyncio.to_thread 起**，不能用裸 threading.Thread。
      理由见 Test机制赖以成立的前提 那一条——第一版判据就是栽在这儿。
    """
    try:
        for i in range(steps):
            run_pause.wait_here_if_paused(f"第{i}步")
            sink.append(i)
            time.sleep(0.01)
        done.append("跑完了")
    except run_cancel.RunCancelled as exc:
        done.append(f"停了：{exc}")


def _spawn(steps, done, sink):
    """跟引擎同款的起法：asyncio.to_thread 会把当前 Context 复制进线程。"""
    return asyncio.ensure_future(asyncio.to_thread(_worker, steps, done, sink=sink))


class _Watchdog:
    """判据自己的保险丝。

    ⚠ 2026-08-28 变异验证发现的问题：实现写坏成裸 `gate.wait()`（暂停中
      取消不掉）或者闸出厂即红时，判据**不是判红，是整个挂死**——CI 会卡到
      超时被杀，没人知道红在哪一条。会挂死的判据不合格。

      所以每条依赖闸的用例都挂一根保险丝：到点强行放行并留痕，用例结尾断言
      "保险丝没烧"。坏实现于是在几秒内**判红并说清原因**，而不是卡住。
    """

    def __init__(self, gate, seconds=2.0):
        self.fired = False
        self._gate = gate
        self._t = threading.Timer(seconds, self._blow)
        self._t.daemon = True

    def _blow(self):
        self.fired = True
        self._gate.set()

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *exc):
        self._t.cancel()
        return False


class Test机制赖以成立的前提:
    def test_裸线程收不到闸_必须走asyncio_to_thread(self):
        """⚠ 这条不测我们的代码，测的是**接线时最容易栽的那一脚**。

        ContextVar 只有经 `asyncio.to_thread`（内部走
        `contextvars.copy_context().run`）才会被复制进线程；裸
        `threading.Thread` 起的线程拿到的是一个**全新的空 Context**，
        `_GATE.get()` 返回 None，安全点当场放行——闸像不存在一样。

        2026-08-28 第一版判据就是栽在这儿：红灯挂着，worker 把 20 步
        一步不落跑完了。**实现是对的，判据的起法不对。**
        引擎沿途走的正是 `await asyncio.to_thread(...)`（见 run_cancel
        模块头），所以生产是通的；但谁哪天在别处新起一个裸线程跑同一段，
        暂停会静默失效、没有任何报错。所以把前提钉在这儿。
        """
        gate = run_pause.new_gate()
        run_pause.bind(gate)
        run_cancel.bind(run_cancel.new_token())
        run_pause.request_pause(gate)  # 红灯

        sink, done = [], []
        t = threading.Thread(target=_worker, args=(5, done), kwargs={"sink": sink})
        t.start()
        t.join(timeout=3)
        assert done == ["跑完了"], done
        assert len(sink) == 5, "前提变了：裸线程现在也能继承 ContextVar 了——"
        "那本模块和 run_cancel 的 ContextVar 写法都可以简化，去看一眼"


class Test停得住并且接着跑:
    def test_暂停之后真的不往下走(self):
        """⚠ 判据要盯"它没往前走"，不是"函数被调用了"。

        本仓数过太多次的形状：正向判据齐全、反向判据缺失。这里的反向判据
        就是"过了半秒，步数一步没涨"。
        """
        async def scenario():
            gate = run_pause.new_gate()
            run_pause.bind(gate)
            run_cancel.bind(run_cancel.new_token())
            sink, done = [], []
            run_pause.request_pause(gate)  # 起跑前就红灯
            fut = _spawn(20, done, sink)
            try:
                await asyncio.sleep(0.5)
                assert len(sink) == 0, f"暂停中还走了 {len(sink)} 步——根本没停住"
                assert done == [], "暂停中就已经收场了"

                run_pause.resume(gate)
                await asyncio.wait_for(fut, timeout=5)
                assert done == ["跑完了"], f"放行之后没接着跑完：{done}"
                assert len(sink) == 20
            finally:
                # ⚠ 断言失败时也要放行：否则线程停在红灯上，asyncio.run 关不掉
                #   执行器，判据变成挂死而不是判红。
                run_pause.resume(gate)

        asyncio.run(scenario())

    def test_停在半路放行后从断点继续_不是从头再来(self):
        """闭环能变绿的全部理由：剩下的步骤跑得完，最后一步到得了。"""
        async def scenario():
            gate = run_pause.new_gate()
            run_pause.bind(gate)
            run_cancel.bind(run_cancel.new_token())
            sink, done = [], []
            fut = _spawn(40, done, sink)
            try:
                await asyncio.sleep(0.05)
                run_pause.request_pause(gate)
                await asyncio.sleep(0.4)
                at = len(sink)
                assert 0 < at < 40, f"没停在半路（停在 {at}/40），这条判据没验到该验的"
                await asyncio.sleep(0.3)
                assert len(sink) == at, f"暂停期间还在往前走：{at} → {len(sink)}"

                run_pause.resume(gate)
                await asyncio.wait_for(fut, timeout=10)
                assert done == ["跑完了"], done
                # 从断点续，不是从头重来：每一步恰好走过一次，且是连号
                assert sink == list(range(40)), f"步数不连续或重复了：{sink[:12]}..."
            finally:
                run_pause.resume(gate)  # 理由同上：判据不许挂死

        asyncio.run(scenario())


class Test暂停中必须还能取消:
    def test_暂停中被取消不会死锁(self):
        """⚠ **这个模块唯一不许错的地方。**

        最危险的失败形态不是"停不住"，是"停住了出不来"：用户关了页面、
        看门狗喊了取消，而线程还在 wait() 上干等，占着 64 个执行槽里的一个。
        裸 `gate.wait()` 就是这个下场——判据把它钉死。
        """
        async def scenario():
            gate = run_pause.new_gate()
            token = run_cancel.new_token()
            run_pause.bind(gate)
            run_cancel.bind(token)
            sink, done = [], []
            run_pause.request_pause(gate)
            fut = _spawn(50, done, sink)

            await asyncio.sleep(0.3)
            assert done == [], "还没取消就收场了"

            token.set()  # 暂停中喊取消，闸**不**放行
            with _Watchdog(gate) as fuse:
                try:
                    await asyncio.wait_for(fut, timeout=6)
                finally:
                    run_pause.resume(gate)  # 理由同上：判据不许挂死
            assert not fuse.fired, (
                "暂停中取消不掉——线程卡死在闸上，是保险丝把它放出来的。"
                "这就是死锁：裸 gate.wait() 的下场。"
            )
            assert len(done) == 1 and done[0].startswith("停了："), done
            # 停在哪一步要留痕：排查时最想知道的第一件事
            assert "第0步" in done[0], done[0]

        asyncio.run(scenario())

    def test_取消响应必须快过硬取消的宽限(self):
        """轮询间隔要明显小于 run_registry 的 5 秒硬宽限。

        大于它的话，硬取消会先于协作式退出发生——退回"停没停不知道"，
        协作式那一整套就白做了。
        """
        assert run_pause._POLL_SECONDS <= 1.0


class Test没暂停时不许有代价:
    def test_常态零阻塞(self):
        """安全点要撒在每一步之间，所以正常路径上必须近乎免费。

        ⚠ 没有这条，实现很容易写成"每步都 wait 一个超时"——功能是对的，
          而每一步凭空多出几百毫秒，几十步就是十几秒，没人会发现。
        """
        gate = run_pause.new_gate()  # 出厂即放行
        run_pause.bind(gate)
        run_cancel.bind(run_cancel.new_token())
        t0 = time.monotonic()
        with _Watchdog(gate) as fuse:
            for i in range(2000):
                run_pause.wait_here_if_paused(f"第{i}步")
        spent = time.monotonic() - t0
        assert not fuse.fired, "闸出厂不是放行态——常态路径被挡住了，靠保险丝才走完"
        assert spent < 0.5, f"2000 个安全点花了 {spent:.3f}s——常态被加了延迟"

    def test_没绑闸时原样放行(self):
        """老调用点（没绑过闸）行为必须一模一样，不能因为多了这个模块变慢或变红。"""
        run_pause.bind(None)
        run_cancel.bind(run_cancel.new_token())
        run_pause.wait_here_if_paused("第0步")  # 不抛、不阻塞
        assert run_pause.is_paused() is False
