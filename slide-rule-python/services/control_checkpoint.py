"""Control-loop checkpoint port; persistence and worker ownership live outside it.

Ownership/cancellation must escape the loop's conversational error fallback.
Otherwise a lost producer can turn a failed checkpoint into a fake completion.
"""

import asyncio
from contextvars import ContextVar
from typing import Any, Protocol


class ControlRunStopped(BaseException):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class CheckpointPort(Protocol):
    checkpoint: dict[str, Any] | None

    def guard(self) -> None: ...

    async def save(self, checkpoint: dict[str, Any]) -> None: ...


current_checkpoint: ContextVar[CheckpointPort | None] = ContextVar(
    "control_run_checkpoint", default=None
)


def guard_control_run() -> None:
    port = current_checkpoint.get()
    if port is not None:
        port.guard()


async def owned_model_sample(awaitable):
    """Only sampling is interruptible; threadpool tool writes must drain."""
    port = current_checkpoint.get()
    if port is None:
        return await awaitable
    task = asyncio.create_task(awaitable)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=0.25)
            await asyncio.to_thread(port.guard)
            if done:
                return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
