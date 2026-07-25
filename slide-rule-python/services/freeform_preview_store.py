"""
freeform_preview_store — FreeformInsight 生成中途候选内容的临时预览存储
（2026-07-24，自我校验闭环用）。

背景：generate_freeform_block 生成出一份候选 JSON 后，想真实渲染出来看一眼
跟参考图差多少（截图-to-code 那套"生成→截图→自己看→改"的思路），但这份
候选内容在这一步还没写进任何 session，没有 session_id 可用——app_screenshot.py
现成的 capture_app_screenshot 是按 session_id 截"已经落盘的应用"，这里需要
一个更轻的路子：把候选内容临时放一下，给一个随机 id，E2B 沙盒里的浏览器
拿这个 id 去问后端要内容、渲染、截图，用完即弃。

进程内内存字典足够——跟 runtime state「零数据库」是同一个考虑：这些内容本来
就是几分钟内会过期的一次性预览，不需要真正持久化，也不需要跨进程共享
（同一个 uvicorn 进程既生成候选、又服务这个预览接口）。
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Optional

_TTL_SECONDS = 600.0
_lock = threading.Lock()
_store: dict[str, tuple[float, dict[str, Any]]] = {}


def _prune_locked() -> None:
    now = time.time()
    expired = [k for k, (exp, _) in _store.items() if exp < now]
    for k in expired:
        del _store[k]


def put_preview(payload: dict[str, Any]) -> str:
    """存一份预览负载，返回随机 id。到期（_TTL_SECONDS）自动失效。"""
    pid = uuid.uuid4().hex
    with _lock:
        _prune_locked()
        _store[pid] = (time.time() + _TTL_SECONDS, payload)
    return pid


def get_preview(pid: str) -> Optional[dict[str, Any]]:
    """按 id 取预览负载；不存在/已过期 → None（调用方应如实 404，不能伪造内容）。"""
    with _lock:
        _prune_locked()
        entry = _store.get(pid)
    return entry[1] if entry else None
