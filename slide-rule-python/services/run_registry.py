"""E25 推演断线重生：run 与连接解耦 + 可续播事件日志。

用户实测缺陷（2026-07-16）：drive-full-stream 的引擎推演内联在 SSE 请求
生成器里——浏览器刷新/跳页即断连，FastAPI 取消协程，推演在服务端中途
死亡，且无任何重新接上的入口。推演的生命周期被绑在一根网线上。

设计（用户确认「开抄」）：
- 契约抄 Vercel resumable-stream：POST 发起 → run 后台跑 → 按会话可续接；
- 生命周期对齐 LangGraph：running/complete/error/cancelled，
  断连语义 = continue（on_disconnect 的行业默认）；
- 序号语义遵循 SSE Last-Event-ID：事件带单调 seq，续播从 since 补起。

治理三件套（防孤儿 run 白烧 LLM）：
- 无人观看宽限：run 无订阅者超过 SLIDERULE_RUN_ORPHAN_GRACE_SECONDS
  （默认 600s）自动中止；半成品照常留在轮边界已落库的进度上；
- 防重复发起：同会话已有活跃 run 时 start_run 返回既有 run（附着，
  不并行双跑双烧钱）；
- 显式取消：cancel_run 真正杀掉引擎任务（停止按钮的新语义）。

单进程内存实现（uvicorn 单实例部署形态）；完结 run 的日志保留
SLIDERULE_RUN_FINISHED_TTL_SECONDS（默认 1800s）供迟到的续播读尾。
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional


def _orphan_grace_seconds() -> float:
    return float(os.getenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "600"))


def _finished_ttl_seconds() -> float:
    return float(os.getenv("SLIDERULE_RUN_FINISHED_TTL_SECONDS", "1800"))


class Run:
    def __init__(self, run_id: str, session_id: str):
        self.run_id = run_id
        self.session_id = session_id
        self.status = "running"  # running | complete | error | cancelled
        self.events: List[Dict[str, Any]] = []
        self.cond = asyncio.Condition()
        self.task: Optional[asyncio.Task] = None
        self.subscribers = 0
        self.last_subscriber_seen = time.monotonic()
        self.finished_at: Optional[float] = None

    def snapshot(self) -> Dict[str, Any]:
        return {
            "runId": self.run_id,
            "sessionId": self.session_id,
            "status": self.status,
            "seq": len(self.events),
        }


_runs: Dict[str, Run] = {}
_active_by_session: Dict[str, str] = {}


def get_run(run_id: str) -> Optional[Run]:
    return _runs.get(run_id)


def get_active_run(session_id: str) -> Optional[Run]:
    run_id = _active_by_session.get(session_id)
    if not run_id:
        return None
    run = _runs.get(run_id)
    if run is None or run.status != "running":
        _active_by_session.pop(session_id, None)
        return None
    return run


def _sweep_finished() -> None:
    now = time.monotonic()
    ttl = _finished_ttl_seconds()
    stale = [
        rid
        for rid, r in _runs.items()
        if r.finished_at is not None and now - r.finished_at > ttl
    ]
    for rid in stale:
        _runs.pop(rid, None)


async def _append(run: Run, event: Dict[str, Any]) -> None:
    async with run.cond:
        stamped = {**event, "seq": len(run.events), "runId": run.run_id}
        run.events.append(stamped)
        run.cond.notify_all()


async def _finish(run: Run, status: str) -> None:
    run.status = status
    run.finished_at = time.monotonic()
    if _active_by_session.get(run.session_id) == run.run_id:
        _active_by_session.pop(run.session_id, None)
    async with run.cond:
        run.cond.notify_all()


async def start_run(
    session_id: str,
    stream_factory: Callable[[], AsyncIterator[Dict[str, Any]]],
    on_complete: Optional[
        Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]
    ] = None,
    *,
    user_text: str = "",
) -> Run:
    """启动（或附着）一个后台推演 run。

    同会话已有活跃 run → 返回既有 run（防重复发起）。
    on_complete 在后台任务内对 complete 事件做持久化改写——落库必须
    发生在 run 任务里而不是响应生成器里，否则无人观看时跑完也白跑。
    """
    _sweep_finished()
    existing = get_active_run(session_id)
    if existing is not None:
        return existing

    run = Run(uuid.uuid4().hex[:16], session_id)
    _runs[run.run_id] = run
    _active_by_session[session_id] = run.run_id

    async def _drive() -> None:
        await _append(
            run,
            {"type": "run_started", "sessionId": session_id, "userText": user_text},
        )
        try:
            async for event in stream_factory():
                if (
                    on_complete is not None
                    and isinstance(event, dict)
                    and event.get("type") == "complete"
                ):
                    event = await on_complete(event)
                await _append(run, event)
            await _finish(run, "complete")
        except asyncio.CancelledError:
            await _append(run, {"type": "run_cancelled"})
            await _finish(run, "cancelled")
        except Exception as exc:  # noqa: BLE001 —— 错误如实进日志，不静默
            await _append(run, {"type": "error", "message": str(exc)[:300]})
            await _finish(run, "error")

    async def _orphan_watchdog() -> None:
        while run.status == "running":
            await asyncio.sleep(min(15.0, _orphan_grace_seconds() / 2 or 1.0))
            if run.status != "running":
                return
            idle = time.monotonic() - run.last_subscriber_seen
            if run.subscribers == 0 and idle > _orphan_grace_seconds():
                if run.task is not None:
                    run.task.cancel()
                return

    run.task = asyncio.create_task(_drive())
    asyncio.create_task(_orphan_watchdog())
    return run


async def subscribe(run: Run, since: int = 0) -> AsyncIterator[Dict[str, Any]]:
    """从 since 序号起补播日志，追平后跟实时流；run 完结且读尽即止。"""
    run.subscribers += 1
    run.last_subscriber_seen = time.monotonic()
    try:
        i = max(0, int(since))
        while True:
            async with run.cond:
                while i >= len(run.events) and run.status == "running":
                    await run.cond.wait()
                batch = list(run.events[i:])
            for event in batch:
                yield event
            i += len(batch)
            if run.status != "running" and i >= len(run.events):
                return
    finally:
        run.subscribers -= 1
        run.last_subscriber_seen = time.monotonic()


def cancel_run(run_id: str) -> bool:
    run = _runs.get(run_id)
    if run is None or run.status != "running" or run.task is None:
        return False
    run.task.cancel()
    return True


def _reset_for_tests() -> None:
    _runs.clear()
    _active_by_session.clear()
