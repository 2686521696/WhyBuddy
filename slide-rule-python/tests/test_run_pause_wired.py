"""暂停真的接在跑的那条链上了吗（2026-08-28 接线）。

## 这个文件跟 test_run_cooperative_pause 的分工

那个验的是**机制**（等得住、放行接着跑、取消出得来、超时按跳过）。
这个验的是**接线**——机制写对了 ≠ 它被接上了（CLAUDE.md §3）。

## ⚠ 只接了流式那条循环

`while loop < max_loops:` 在 v5_full_driver 里有**两处**：1386 行是同步驱动器
（脚本/测试入口），2200 行附近是流式驱动器（前端主路径）。写这段时第一次
替换就因为 `count == 2` 当场断言失败——那正是本仓「同步/流式改一半」那个坑
（CLAUDE.md §4）在这次接线上的现形。

这次**有意只接流式**：同步入口没有"前端按暂停"这回事。所以下面既钉住
"流式那条有"，也钉住"这个选择是明写的"，免得下一个人以为是漏了。
"""

import asyncio
import os
import re
import sys

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
    os.environ.pop("SLIDERULE_RUN_PAUSE_ENABLED", None)


class Test安全点接在驱动器上:
    def test_没人按暂停时零成本(self):
        """正常路径上只多一次字典读取——这条决定了敢不敢把它放进主循环。"""

        async def scenario():
            run_pause.bind(run_pause.new_slot())
            assert await run_pause.pause_here("loop-0") is None

        asyncio.run(scenario())

    def test_没绑位子也不炸(self):
        """老调用点 / 脚本入口没绑过位子，行为必须跟从前一模一样。"""

        async def scenario():
            run_pause.bind(None)
            assert await run_pause.pause_here("loop-0") is None

        asyncio.run(scenario())

    def test_按了暂停就停住_放行后拿到答案(self):
        async def scenario():
            slot = run_pause.new_slot()
            run_pause.bind(slot)
            gate = run_pause.request_hold(slot)
            assert gate is not None
            asyncio.get_running_loop().call_later(0.05, gate.answer, {"选了": "工号"})
            res = await run_pause.pause_here("loop-1")
            assert res is not None and res.answered
            assert res.answer == {"选了": "工号"}
            # 取走之后位子空了：一次按下只停一次，不会下一轮又停
            assert await run_pause.pause_here("loop-2") is None

        asyncio.run(scenario())

    def test_正在等的时候_路由按run_id还找得到那个闸(self):
        """⚠ 2026-08-28 真机咬出来的洞，单测当时全绿。

        第一版 `take_hold` 把闸从位子里**取走**，于是驱动器一开始等，路由就
        再也找不到它——`release` 恒 released=false，这一轮永远停在那儿。
        真机：按暂停 → 停住 ✅ → 放行 → {"released":false}、15 秒零新事件。

        单测没咬住，是因为它直接拿着 gate 对象调 answer，**绕过了位子查找**
        ——正向判据齐全、反向判据缺失（CLAUDE.md §3）。这条走的就是路由那条路。
        """

        async def scenario():
            slot = run_pause.new_slot()
            run_pause.bind(slot)
            run_pause.request_hold(slot)

            async def releaser():
                await asyncio.sleep(0.05)
                # 路由手上只有位子，没有 gate 对象——必须从这儿找得到
                gate = slot.active or slot.pending
                assert gate is not None, "正在等的时候位子里空了，路由找不到闸"
                gate.answer({"选了": "工号"})

            res, _ = await asyncio.gather(
                run_pause.pause_here("loop-1"), releaser()
            )
            assert res is not None and res.answered

        asyncio.run(scenario())

    def test_等完了要把正在等清掉(self):
        """不清的话下一轮的 release 会打到一个已经结束的闸上，
        返回 released=true 却什么也没发生——又一个"闸绿了东西没动"。"""

        async def scenario():
            slot = run_pause.new_slot()
            run_pause.bind(slot)
            gate = run_pause.request_hold(slot)
            gate.skip()
            await run_pause.pause_here("loop-1")
            run_pause.finish_hold()
            assert slot.active is None and slot.pending is None

        asyncio.run(scenario())

    def test_重复按不开第二道闸(self):
        slot = run_pause.new_slot()
        run_pause.bind(slot)
        a = run_pause.request_hold(slot)
        b = run_pause.request_hold(slot)
        assert a is b

    def test_总闸关掉时按不动(self):
        """⚠ 它能停住一条跑了两分钟的推演，出事时要有一根总闸。"""
        os.environ["SLIDERULE_RUN_PAUSE_ENABLED"] = "0"
        slot = run_pause.new_slot()
        run_pause.bind(slot)
        assert run_pause.request_hold(slot) is None


class Test接在流式那条链上:
    def _driver_code(self) -> str:
        import services.v5_full_driver as d

        with open(d.__file__, encoding="utf-8") as fh:
            body = fh.read()
        # 剥注释再找：本仓踩过"判据 grep 到的词其实在注释里"
        return "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )

    def _hold_fn_code(self) -> str:
        """`_drain_assumption_hold` 那个函数的代码（去注释、去 docstring）。

        ⚠ 2026-09-06 从"`take_hold()` 之后固定 N 字符的窗口"改成按 AST 切函数。
          原因：那个窗口是个魔数。这一轮在通知和 `await` 之间补了"停泊态落库"
          （SSE 只服务当前连着的客户端，刷新回来读的是 state），代码长了
          二十来行，`.wait(` 就掉到 600 字符窗口外面 —— 判据报的是
          `ValueError: substring not found`，**不是**"顺序错了"。
          魔数窗口每次隔壁加几行就得回来调一次，而调它的人不知道该调多少。
        """
        import ast

        import services.v5_full_driver as d

        src = open(d.__file__, encoding="utf-8").read()
        tree = ast.parse(src, filename=d.__file__)
        for node in ast.walk(tree):
            if (
                isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
                and node.name == "_drain_assumption_hold"
            ):
                body = node.body
                if (
                    body
                    and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)
                ):
                    body = body[1:]  # docstring 里逐字引了修复前的写法
                lines = src.splitlines(keepends=True)
                code = "".join(
                    lines[body[0].lineno - 1 : max(n.end_lineno or n.lineno for n in body)]
                )
                return "\n".join(
                    ln for ln in code.splitlines() if not ln.lstrip().startswith("#")
                )
        raise AssertionError("驱动器里找不到 _drain_assumption_hold —— 接线被拆了")

    def test_停住之前先报一声_前端才变得了形态(self):
        """⚠ 必须在**开始等之前** yield：等上了才报，卡片在整段等待期间都是
        旧样子，用户不知道自己按的那下生效了没有。

        真机（2026-09-06 sr-20260906045441）：`run_pause_started` 迟到 3 秒，
        前端 `runPaused` 点不亮，假设卡上单条的两个按钮点了不放行。
        更细的同款判据见 tests/test_pause_visibility.py（按 AST 认 yield，
        防"退化成普通赋值时字面量还在原地"）。
        """
        code = self._hold_fn_code()
        started = code.index("run_pause_started")
        waited = code.index("gate.wait(")
        assert started < waited, "先等上了才报「已暂停」——中间那段前端是懵的"

    def test_流式循环里真的调了安全点(self):
        """⚠ 反向判据：机制写对了 ≠ 它被调用了。

        删掉调用点这条会红，而 test_run_cooperative_pause 那一整个文件照样
        全绿——那正是本仓数过十次以上的形状。
        """
        code = self._driver_code()
        assert "take_hold()" in code, "驱动器里没有安全点调用——机制没接上"

    def test_安全点在流式那条循环里_不是同步那条(self):
        code = self._driver_code()
        loops = [m.start() for m in re.finditer(r"while loop < max_loops:", code)]
        assert len(loops) == 2, f"驱动器里的主循环数量变了（{len(loops)}），接线位置要重认"
        holds = [m.start() for m in re.finditer(r"take_hold\(\)", code)]
        assert holds, "驱动器里没有安全点调用——机制没接上"
        assert all(h > loops[0] for h in holds), "有安全点插在了同步驱动器上"
        assert any(h > loops[1] for h in holds), "流式循环里没有安全点"

    def test_安全点在最贵的活开始之前(self):
        """位置照 run_cancel 的纪律：别再开始下一件大活儿。

        插在 orchestrate_plan / pick 之后就等于"这一轮已经烧起来了才停"。
        """
        code = self._driver_code()
        at = code.index("take_hold()")
        nxt = code.index("orchestrate_plan", at)
        assert at < nxt

    def test_假设出口之后还有一道安全点(self):
        """2026-09-03：spec-first 在 to_thread 里出卡。循环开头那道闸
        已经过了（max_loops=1 的 hop 甚至没有下一圈）。必须在 execute
        返回后再等，否则卡出来工厂还在跑。

        变异：把 `_drain_assumption_hold` 的调用点删掉 → 本条红。
        """
        code = self._driver_code()
        loops = [m.start() for m in re.finditer(r"while loop < max_loops:", code)]
        stream = code[loops[1] :]
        # ⚠ 2026-09-06 改成认 `async for`。`_drain_assumption_hold` 从"返回 list
        #   的协程"改成了 async generator —— 停泊通知必须在 `await` 之前就流到
        #   前端，攒成 list 再交等于等完了才通知（真机迟到 3 秒，前端 runPaused
        #   点不亮）。原判据认的是 `await _drain_assumption_hold()`，改完之后
        #   量到 0 个调用点，报的是"两条 execute 都要接"而不是"形式变了"。
        calls = list(
            re.finditer(r"async for \w+ in _drain_assumption_hold\(\)", stream)
        )
        assert len(calls) >= 2, "并行批和串行两条 execute 都要在返回后等假设闸"
        for match in calls:
            window = stream[max(0, match.start() - 500) : match.start()]
            assert ".result()" in window, "假设闸没接在 to_thread 返回之后——卡出来停不住"

    def test_三种没答的结局都不许把这一轮判死(self):
        """暂停不是取消。真机实测取消 → publishClosure=null、白烧一轮；
        暂停的三种结局都要接着跑到最后一步。"""
        # ⚠ 同上：从"`take_hold()` 之后 1400 字符"改成整个函数体。
        #   魔数窗口在隔壁加几行之后就把要找的东西挤出去了，而它报的错
        #   （断言 recover_from 不在窗口里）看起来像"恢复配方被删了"。
        code = self._hold_fn_code()
        # 没答时走恢复配方继续，而不是 break / raise
        assert "recover_from" in code
        assert "break" not in code.split("recover_from")[0][-200:]


class Test注册表把闸和run对上:
    def test_run上有位子且起跑时绑过(self):
        """⚠ 绑定必须在起跑**之前**——Context 是那一刻复制的，绑晚了线程里
        读到 None，整条线路静默失效（run_cancel 头注为此专门写过一段）。"""
        import services.run_registry as rr

        with open(rr.__file__, encoding="utf-8") as fh:
            code = "\n".join(
                l for l in fh.read().splitlines() if not l.lstrip().startswith("#")
            )
        assert "self.pause_slot = run_pause.new_slot()" in code
        # 跟 cancel 的绑定挨在一起，且都在 _drive 的开头
        at_cancel = code.index("run_cancel.bind(run.cancel_token)")
        at_pause = code.index("run_pause.bind(run.pause_slot)")
        assert 0 < at_pause - at_cancel < 200, "暂停的绑定没跟取消的绑在同一处"

    def test_孤儿看门狗对暂停中的run放手(self):
        """⚠ 关页面十分钟变成取消，就是看门狗没认暂停闸。

        删掉 is_holding / orphan_exempt 这两道判断，这条红。
        """
        import services.run_registry as rr

        with open(rr.__file__, encoding="utf-8") as fh:
            code = "\n".join(
                l for l in fh.read().splitlines() if not l.lstrip().startswith("#")
            )
        assert "is_holding" in code
        assert "is_orphan_exempt" in code
        assert "mark_unattended" in code

    def test_暂停和取消是两个操作_没有被合并(self):
        """⚠ 取消是终止、暂停是停住等人，两者不是同一件事的两个力度。"""
        import services.run_registry as rr

        assert hasattr(rr, "hold_run") and hasattr(rr, "release_run")
        assert hasattr(rr, "cancel_run")

    def test_路由开了两个口子(self):
        import routes.sliderule_full as r

        paths = {getattr(x, "path", "") for x in r.router.routes}
        assert "/runs/{run_id}/hold" in paths
        assert "/runs/{run_id}/release" in paths
