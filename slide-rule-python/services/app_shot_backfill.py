"""app_shot_backfill —— 落库之后异步补一张 E2B 真截图（2026-08-02）。

## 这一层解决什么

应用中心的卡片有三级来源，靠前的更可信（定义见 app_store 的
PREVIEW_SOURCE_PRIORITY）：

  ① e2b   —— 真浏览器打开这个应用截的图，**就是应用本身**
  ② sheet —— 生成时给设计 LLM 排版式用的那张首页参照板，是"应该长这样"的示意
  ③ 活渲染 —— 前端现挂一个 AppRuntimeScreen（生产构建同屏 14 张卡曾实测
              最长单任务 4106ms，见 client/src/lib/mount-scheduler.ts）

② 在落库那一刻就有了（跟着生成走，钱已经付过）。① 要起一个 E2B 沙盒、装
playwright、开真浏览器、等页面渲染稳定——**一张约 45~60s**，其中现装
playwright+chromium 实测 29.1s（配 SLIDERULE_E2B_TEMPLATE 可省掉）。

那 45~60s 不能加在闭环发布路径上：用户正等着看推演结果，为一张缩略图多等一
分钟是不划算的买卖。所以这里把它挪到落库**之后**、另一个线程里跑，截到了再
回填进库。卡片在回填到达之前显示 ②，回填到了自动升到 ①。

## 为什么默认关

E2B 按用量计费，而这条路径是"每落一个应用烧一个沙盒"。默认关掉，由
SLIDERULE_APP_SHOT_ENABLED 显式打开——同一套纪律见 image_client 的成本笼子。

即使打开，还要 e2b_screenshot_available() 为真（E2B key + 公网可达地址同时
配了）。两个条件任一不满足 → 一个沙盒都不会起，卡片继续用 ②。

## 并发上限为什么是 1

不是为了保护本进程（几个线程而已），是为了**E2B 那边的钱和配额**。一次推演
可能连着落好几个版本，不设上限就是同时开几个沙盒。串行排队意味着最慢也只是
排在后面，而卡片本来就有 ② 兜着，晚几分钟升级没有任何用户可感的代价。

队列有界（_MAX_PENDING）：真出现堆积说明截图比生成还慢，这时丢掉新的排队请
求比无限堆内存正确——丢掉的那一条只是少一张更好的图。
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

_ENABLE_ENV = "SLIDERULE_APP_SHOT_ENABLED"

#: 排队上限。截图约 45~60s 一张，10 张 = 最长约十分钟的积压；再多就说明
#: 生成速度已经压过截图速度，堆下去只会越拖越远。
_MAX_PENDING = 10

_lock = threading.Lock()
_pool: Optional[ThreadPoolExecutor] = None
#: 正在排队或正在跑的 app_id。防的是同一个应用被重复排——幂等落库
#: （save_app_or_version 的 dedup 分支）会对同一个 app_id 反复调用这里。
_inflight: set[str] = set()


def _truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def backfill_enabled() -> bool:
    """开关 + 能力，两个都要真。

    分两层判断而不是合成一个：开关表达的是"要不要花这个钱"，能力表达的是
    "这套环境截不截得了图"。日志里能分清是没开还是没配。
    """
    if not _truthy(os.getenv(_ENABLE_ENV)):
        return False
    try:
        from .app_screenshot import e2b_screenshot_available

        return e2b_screenshot_available()
    except Exception:  # noqa: BLE001 — 探测失败按"不可用"处理
        return False


def _get_pool() -> ThreadPoolExecutor:
    global _pool
    if _pool is None:
        # daemon 线程：进程要退就让它退，一张缩略图不值得阻塞关停。没截完的
        # 那张下次这个应用出新版本时还有机会（或者始终停在 sheet，也是可用状态）。
        _pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="app-shot")
    return _pool


def _run(app_id: str, session_id: str, device: Optional[str]) -> None:
    try:
        from . import app_store
        from .app_screenshot import capture_app_screenshot

        png = capture_app_screenshot(session_id, device=device)
        if not png:
            # 不是异常：沙盒起不来、页面没渲染出来、超时都会走到这里，而正确
            # 的结果就是"这个应用暂时没有真截图"，卡片继续用参照板。
            print(f"[app_shot] {app_id[:8]} 截图未成功，卡片继续用参照板")
            return
        if app_store.save_app_shot(app_id, png):
            print(f"[app_shot] {app_id[:8]} 真截图已回填（{len(png) // 1024}KB）")
    except Exception as exc:  # noqa: BLE001 — 后台线程，抛出去没人接
        print(f"[app_shot] {app_id[:8]} 回填异常: {str(exc)[:160]}")
    finally:
        with _lock:
            _inflight.discard(app_id)


def schedule_app_shot(
    app_id: Optional[str], session_id: Optional[str], device: Optional[str] = None
) -> bool:
    """排一次真截图回填。返回"排上了没有"，**从不抛**——调用方在闭环发布的
    主路径上，这里的任何问题都不该让一次成功的生成看起来像失败了。

    需要 session_id：截图是用真浏览器打开 `/agent-loop/sliderule` 并把
    localStorage 的 active session 设成它，走的是"这个会话当前的应用"。没有
    会话就没有可截的 URL——存量应用按 app_id 直接渲染的路由还不存在，所以
    这条路只覆盖新生成的应用。
    """
    if not app_id or not session_id:
        return False
    if not backfill_enabled():
        return False
    with _lock:
        if app_id in _inflight:
            return False
        if len(_inflight) >= _MAX_PENDING:
            print(f"[app_shot] 队列已满（{_MAX_PENDING}），跳过 {app_id[:8]}")
            return False
        _inflight.add(app_id)
    try:
        _get_pool().submit(_run, app_id, session_id, device)
        return True
    except Exception as exc:  # noqa: BLE001 — 提交失败也不能影响落库
        with _lock:
            _inflight.discard(app_id)
        print(f"[app_shot] 排队失败: {str(exc)[:160]}")
        return False


def _reset_for_tests() -> None:
    """测试用：清空在飞集合与线程池。生产代码不要调。

    `cancel_futures=True` 是必须的：还排在队里的任务如果被放行，会在用例的
    monkeypatch 撤掉之后才跑起来——那时 capture_app_screenshot 已经是真的了，
    测试会去戳真的 E2B。取消排队 + 等当前这个跑完，两件事都得做。
    """
    global _pool
    with _lock:
        _inflight.clear()
    if _pool is not None:
        _pool.shutdown(wait=True, cancel_futures=True)
        _pool = None


def pending_count() -> int:
    """当前排队 + 在跑的条数（诊断/测试用）。"""
    with _lock:
        return len(_inflight)
