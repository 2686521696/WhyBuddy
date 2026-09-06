# -*- coding: utf-8 -*-
"""停泊要**在开始等之前**就看得见，而且不能只在 SSE 上看得见。

## 事故（2026-09-06 真机 sr-20260906045441）

    [56s] spec_assumption          items=2
          （我在 59s 主动 POST /runs/{id}/release）
    [59s] run_pause_started        where=spec-assumptions   ← 迟到 3 秒
    [59s] run_pause_ended          outcome=skipped  waitedSeconds=3.016

`run_pause_started` 是**等完了才发出去的**：上一版把它 append 进本地 list，
然后 `await gate.wait()` 等最多 30 分钟，等完再 append `run_pause_ended`，
最后 `return events` 两条一起交。

后果不是"少一条日志"。前端 `useSlideRuleSession` 靠这条事件点亮 `runPaused`
（`setRunPaused(phase === "started")`），而假设卡上单条的两个按钮都是
`if (runPaused) void releaseRun(...)` —— 于是「就这样」和「改成 X」**点了
不放行**，用户干等满 30 分钟（`DEFAULT_WAIT_SECONDS = 30 * 60`）。

第二个洞：SSE 只服务**当前连着的**那个客户端。刷新 / 换设备回来读的是
`state` 和 `GET /runs/active`，而那两处停泊期间分别是：

    runtimePhase=orchestrating  awaitReason=null      ← 状态自己都不知道在等人
    {"status":"running", …}                            ← 快照里没有"等人"这一格

停泊期间零事件，于是刷新回来的浏览器拿到一个"在跑"的 run 却再也收不到
任何东西，分不出"在等你答假设卡"和"服务端死了"。

## 抄的是 grok 的哪两处

顺序抄 `xai-grok-tools/src/implementations/grok_build/ask_user_question/mod.rs`
的 Step 4/5/6：请求先交出去 → 通知先发 → **才**开始 await。它那个写法在
结构上不可能出现"等完了才通知"。

"等人是一个相"抄 `xai-grok-session-events` 的
`Phase::{WaitingForModel, StreamingText, StreamingReasoning, ToolExecution,
PermissionPrompt}` —— `PermissionPrompt` 就是这一格。
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from services import run_pause
from services.run_pause import PauseBudget, PauseGate, PauseSlot, hold_state

DRIVER = Path(__file__).parent.parent / "services" / "v5_full_driver.py"


def _driver_src() -> str:
    return DRIVER.read_text(encoding="utf-8")


def _nested_node(name: str):
    """按 AST 取某个（嵌套的）函数节点。顺序类判据用它，不用文本 index——
    文本 index 只能证明"那个字面量还在"，证明不了"它还是一条 yield"。"""
    import ast

    tree = ast.parse(_driver_src(), filename=str(DRIVER))
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
            and node.name == name
        ):
            return node
    raise AssertionError(f"驱动器里找不到 {name} —— 判据自己打空了")


def _nested_src(name: str) -> str:
    """按 AST 切出某个（嵌套的）函数的源码。

    ⚠ 用 AST 而不是"找下一个 `async def`"：`_drain_assumption_hold` 是这一串
      嵌套函数里的**最后一个**，靠文本找下一个定义会 ValueError——第一版就是
      这么写的，7 条判据一起变成 error 而不是有意义的红。
    """
    import ast

    src = _driver_src()
    tree = ast.parse(src, filename=str(DRIVER))
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
            and node.name == name
        ):
            lines = src.splitlines(keepends=True)
            return "".join(lines[node.lineno - 1 : node.end_lineno])
    raise AssertionError(f"驱动器里找不到 {name} —— 判据自己打空了")


def _drain_hold_src() -> str:
    """`_drain_assumption_hold` 的**代码**，不含 docstring。

    ⚠ 必须去掉 docstring。那段头注里逐字引了修复前的写法（`return events`），
      不去掉的话"不许回到攒完一起交"这条判据会被自己的注释咬红——判据查的是
      代码，不是"注释里提到过"。
    """
    return _code_of("_drain_assumption_hold")


def _code_of(name: str) -> str:
    import ast

    src = _driver_src()
    tree = ast.parse(src, filename=str(DRIVER))
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
            and node.name == name
        ):
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body = body[1:]
            assert body, f"{name} 只有 docstring 没有代码？"
            lines = src.splitlines(keepends=True)
            first = body[0].lineno
            last = max(n.end_lineno or n.lineno for n in body)
            return "".join(lines[first - 1 : last])
    raise AssertionError(f"驱动器里找不到 {name} —— 判据自己打空了")


# ── #2a：通知在 await 之前 ────────────────────────────────────────────
class Test通知在开始等之前发出:
    def test_它是async_generator而不是返回list的协程(self):
        """这是整条修复的结构基础。返回 list 的写法**必然**迟到：list 只有
        return 的时候才交出去，而 return 在 await 之后。

        变异：把 `yield {...run_pause_started...}` 改成 append 进 list → 本条红。
        """
        body = _drain_hold_src()
        assert 'yield {\n                "type": "run_pause_started",' in body, (
            "run_pause_started 不是 yield 出去的 —— 又变回攒 list 了"
        )
        assert "return events" not in body, "又回到「攒完一起交」了"

    def test_通知的yield排在await_gate_wait之前(self):
        """顺序就是这条修复的全部内容（照 ask_user_question 的 Step 5 在 Step 6 前）。

        ⚠ 按 **AST** 找，不按文本 index。第一版用 `body.index('"type":
          "run_pause_started"')`，把 yield 换成一个普通赋值（`_late = {...}`）
          时那个字面量还在原地，判据照样绿——变异检查当场证明了它是个假判据。
          现在钉的是"存在一个 **yield** 出 run_pause_started 的语句，且它的
          行号在 `await gate.wait(...)` 之前"。
        """
        import ast

        node = _nested_node("_drain_assumption_hold")
        notify_lines = [
            n.lineno
            for n in ast.walk(node)
            if isinstance(n, ast.Yield)
            and "run_pause_started" in ast.dump(n)
        ]
        assert notify_lines, (
            "找不到 yield 出去的 run_pause_started —— 又变回攒 list / 普通赋值了"
        )
        # ⚠ `ast.dump()` 里没有 "gate.wait" 这个串（它是
        #   `Attribute(value=Name(id='gate'), attr='wait')`），得按结构认。
        wait_lines = [
            n.lineno
            for n in ast.walk(node)
            if isinstance(n, ast.Await)
            and isinstance(n.value, ast.Call)
            and isinstance(n.value.func, ast.Attribute)
            and n.value.func.attr == "wait"
            and isinstance(n.value.func.value, ast.Name)
            and n.value.func.value.id == "gate"
        ]
        assert wait_lines, "判据自己打空了：找不到 await gate.wait(...)"
        assert min(notify_lines) < min(wait_lines), (
            "run_pause_started 又跑到 await 后面去了 —— 前端的 runPaused 点不亮，"
            "假设卡上的按钮点了不放行，用户干等满 30 分钟"
        )

    def test_通知带着最多等多久(self):
        """没有期限的转圈等于让用户猜。None = 不限时，**不是 0**
        （`PauseBudget` 头注引了 grok 那句原话）。"""
        body = _drain_hold_src()
        assert '"budgetSeconds": _budget' in body
        assert "gate.budget.wait_budget()" in body

    def test_读预算失败不许拦住通知(self):
        """增强类 fail-open：预算读不到就少一格，不许让"我在等你"整条发不出去。"""
        body = _drain_hold_src()
        i_budget = body.index("_budget = None")
        i_notify = body.index('"type": "run_pause_started"')
        segment = body[i_budget:i_notify]
        assert "except Exception:" in segment, "预算读取没有兜底，会把通知一起拖死"

    def test_停泊态也落库而不是只发SSE(self):
        """SSE 只服务当前连着的那个客户端。刷新/换设备回来读的是 state。"""
        body = _drain_hold_src()
        assert 'state.runtimePhase = "awaiting"' in body
        assert 'state.awaitReason = "user_input"' in body

    def test_停泊用的awaitReason是词表里已有的(self):
        """⚠ 第一版写的是 `"spec_assumption"`，不在 `AwaitReason` 里。

        pydantic v2 默认不校验赋值 → 写的时候一声不响 → 从库里读回来
        `invalid_session` → `_coerce_many` 把**整条会话跳过** →
        「停在假设卡的会话，重启后从侧栏消失了」。
        比"看不出在等人"严重得多。
        """
        from models.v5_state import AwaitReason

        declared = set(getattr(AwaitReason, "__args__", ()))
        body = _drain_hold_src()
        written = set(re.findall(r'state\.awaitReason\s*=\s*"([^"]+)"', body))
        assert written, "判据自己打空了：一个 awaitReason 赋值都没量到"
        assert written <= declared, f"写了没申报的 awaitReason：{written - declared}"

    def test_等完之后把相恢复回去(self):
        """不恢复的话这一轮后面的步骤全在 awaiting 下跑，而终局判定
        （terminal_phase_decision）会读到一个骗人的相。"""
        body = _drain_hold_src()
        i_wait = body.index("await gate.wait(")
        after = body[i_wait:]
        assert "finally:" in after
        assert "_phase_before or" in after, "等完没把 runtimePhase 恢复回去"
        assert "_reason_before" in after


# ── #2b：快照里有「正在等人」这一格 ──────────────────────────────────
class Test快照里有正在等人这一格:
    def test_没在等人时是None(self):
        assert hold_state(None) is None
        assert hold_state(PauseSlot()) is None, "空位子不许报成在等人"

    def test_按了还没到报pending(self):
        """`pending` = 按了暂停 / 出了假设卡，但还没走到安全点。

        变异：把 pending / waiting 合成一个布尔 → 前端分不出"再等一下就停"
        和"已经停了快答"，本条红。
        """
        slot = PauseSlot()
        slot.pending = PauseGate(PauseBudget())
        st = hold_state(slot)
        assert st is not None
        assert st["phase"] == "pending"

    def test_已经停住报waiting并带上等什么等了多久(self):
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        slot.active = gate

        async def _park():
            task = asyncio.ensure_future(gate.wait("spec-assumptions"))
            # 让 wait() 跑到"已经写下落点、正在等"那一刻
            await asyncio.sleep(0.05)
            st = hold_state(slot)
            gate.skip()
            await task
            return st

        st = asyncio.run(_park())
        assert st is not None
        assert st["phase"] == "waiting"
        assert st["where"] == "spec-assumptions", (
            "等待期间读不到 where —— 落点又写回 wait() 的返回处了"
        )
        assert st["waitedSeconds"] is not None and st["waitedSeconds"] >= 0

    def test_落点写在开始等之前(self):
        """跟 #2a 同一条纪律：写在返回时就只有等完了才可见。

        变异：把 `self._where = ...` / `self._started_at = ...` 挪到
        `_settle` 里 → 上面那条 test_已经停住 会红（等待期间读到空 where）。
        这一条从源码顺序上再钉一次，免得靠 sleep 的时序判据变成偶发。
        """
        src = (
            Path(__file__).parent.parent / "services" / "run_pause.py"
        ).read_text(encoding="utf-8")
        body_start = src.index("    async def wait(self, where: str)")
        body = src[body_start : src.index("\n    def ", body_start + 10)]
        i_set = body.index("self._where = str(where or \"\")")
        i_loop = body.index("while True:")
        assert i_set < i_loop, "落点写在等待循环里面/后面了，等待期间读不到"

    def test_不限时报None而不是0(self):
        """⚠ 0 不表示不限时——那是 `enabled=False` 的活
        （`PauseBudget` 头注直接引了 grok 那句原话）。"""
        slot = PauseSlot()
        slot.pending = PauseGate(PauseBudget(enabled=False))
        st = hold_state(slot)
        assert st is not None
        assert st["budgetSeconds"] is None

    def test_有预算就如实报秒数(self):
        slot = PauseSlot()
        slot.pending = PauseGate(PauseBudget(seconds=90))
        st = hold_state(slot)
        assert st is not None
        assert st["budgetSeconds"] == 90.0

    def test_场上有没有人也报出来(self):
        """超时的结局会因此不同（用户跳过 vs 没有操作员）。"""
        slot = PauseSlot()
        gate = PauseGate(PauseBudget())
        slot.pending = gate
        assert hold_state(slot)["unattended"] is False
        gate.mark_no_operator()
        assert hold_state(slot)["unattended"] is True

    def test_Run快照两格都给(self):
        """布尔给判断、详情给展示。只给 hold 的话调用方得先判 None 再取值；
        只给布尔的话又回到"不知道在等什么"。"""
        from services.run_registry import Run

        run = Run("run-1", "sess-1") if _run_takes_two_args() else Run("run-1")
        snap = run.snapshot()
        assert "held" in snap and "hold" in snap, "快照里没有「正在等人」这一格"
        assert snap["held"] is False and snap["hold"] is None

        run.pause_slot.pending = PauseGate(PauseBudget())
        snap = run.snapshot()
        assert snap["held"] is True
        assert (snap["hold"] or {})["phase"] == "pending"

    def test_快照读不到停泊态也不许抛(self):
        """快照是诊断面。炸了会让 `runs/active` 整个 500，比少一格严重得多。"""
        from services.run_registry import Run

        run = Run("run-2", "sess-2") if _run_takes_two_args() else Run("run-2")

        class _Boom:
            @property
            def active(self):
                raise RuntimeError("炸了")

        run.pause_slot = _Boom()  # type: ignore[assignment]
        snap = run.snapshot()  # 不许抛
        assert snap["held"] is False and snap["hold"] is None


def _run_takes_two_args() -> bool:
    import inspect

    from services.run_registry import Run

    return len(inspect.signature(Run.__init__).parameters) >= 3


# ── 一致性：is_holding 与 hold_state 必须说同一件事 ───────────────────
@pytest.mark.parametrize(
    "setup",
    [
        pytest.param("empty", id="空位子"),
        pytest.param("pending", id="按了还没到"),
        pytest.param("active", id="正在等"),
    ],
)
def test_is_holding与hold_state不许互相打架(setup):
    """两处书写同一个事实。漂了的结果是孤儿看门狗和前端各信一半。

    变异：`hold_state` 只看 `slot.active`（漏 pending）→ "按了还没到" 那档
    两边不一致，本条红。
    """
    slot = PauseSlot()
    if setup == "pending":
        slot.pending = PauseGate(PauseBudget())
    elif setup == "active":
        slot.active = PauseGate(PauseBudget())
    assert run_pause.is_holding(slot) is (hold_state(slot) is not None)
