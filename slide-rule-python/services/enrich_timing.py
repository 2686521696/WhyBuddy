"""体验层（ENRICH）各阶段的耗时埋点。

## 为什么要有这个模块

在这之前，enrich_identity_theme / enrich_freeform_blocks /
enrich_monitor_page_overviews 三段**只在失败或撞预算时才 print**，成功路径
完全静默。代价是：想知道"一轮推演的 7 分钟花在哪"，只能人肉在本地拿秒表量，
生产环境根本量不到——拉过一次 Render 生产日志核实，1000 行里 902 行是
`GET /health`，应用侧有效日志只有 4 行，各阶段耗时一个数都没有
（见 docs/enrich-pipeline-parallelization-audit-2026-07-31.md「十、2」）。

这直接卡住了并行化改造：没有埋点，就无法验收"并行之后到底快了多少"，
只能靠感觉。所以埋点要排在并行化之前做。

## 输出形态：单行 key=value，一条一个事件

    [enrich-timing] stage=monitor.sheet ms=84702 ok=1 page=p_home device=desktop

选这个形态而不是 JSON 或多行表格，理由是它同时满足三件事：
  · grep 得出来  —— `grep '\\[enrich-timing\\]'` 就是完整的基线数据集
  · 机器解析简单 —— 空格切分再按 `=` 切，不需要 JSON 解析器
  · 人眼扫得动   —— 混在 uvicorn 访问日志里也一眼能认出来

## 纪律：埋点绝不能改变被测链路的行为

这是这个模块最重要的约束，两条：

① **异常必须原样抛出**。ENRICH 全程 fail-open，上游靠 `except
   FreeformGenerationError` 把失败的区块摘掉。计时器如果吞掉异常，
   等于把"这块生成失败了"变成"这块生成成功但内容是空"，比不埋点糟得多。
   所以 `finally` 里只记录，异常照常向上传。

② **记录自身出任何问题都必须静默**。一个测量工具把它measure 的流水线
   搞崩，是最没道理的失败方式。`_emit` 整个包在 try/except 里。

## 并发安全

只做"每个事件打一行"，不做任何累加，因此没有跨线程共享的可变状态——
这是刻意的：下一步就是把这条链路并行化（同上文档「八、7」），任何
"边跑边累加"的计数器到那时都会变成竞态（预算笼子已经踩过这个坑，
见 freeform_block.py 里 ref_used/shot_used 那段注释）。

单行输出用一次 print 完成，并发下最多是行与行之间交错，不会出现半行。
每条事件自带 page/block 字段，交错了也能归位。
"""

from __future__ import annotations

import os
import time
from contextlib import contextmanager
from typing import Any, Iterator

_LOG_PREFIX = "[enrich-timing]"

# 关掉埋点的逃生口。默认**开**——这个模块存在的全部理由就是成功路径原本
# 没有任何输出；默认关掉等于白写。噪音敏感的场景（比如批量跑夹具再生成）
# 可以设 0 关掉。
_ENABLED_ENV = "SLIDERULE_ENRICH_TIMING"


def timing_enabled() -> bool:
    raw = (os.getenv(_ENABLED_ENV) or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    return True


def _fmt_value(v: Any) -> str:
    """字段值扁平化成不含空格的 token——空格会破坏"空格切分"这个解析约定。"""
    s = "" if v is None else str(v)
    s = s.replace(" ", "_").replace("\n", "_").replace("\t", "_")
    return s or "-"


#: 可选的**实时**阶段观察者（2026-08-04）。
#:
#: 埋点原本只在阶段**结束**时 print 一行——做基线够用，但对着屏幕等的人拿不到
#: 任何东西。真机量到：体验层那三段（生参照图 104.9s + 读配色 19.1s + 设计版式
#: 59.5s）在 SSE 上是一个 165.8 秒的洞，比选材那六段加起来还长，而且正好落在
#: 用户最没耐心的位置——已经等了七八分钟、眼看要出结果了，突然黑三分钟。
#:
#: 所以补一条 sink：阶段**开始**时也叫一声，让驱动器能把它转成 SSE。
#: 注册是模块级单例，跟 capability delta sink 同一套约定（本次流注册、
#: finally 注销）。
#:
#: ⚠ 纪律不变：sink 自身出任何问题都必须静默，绝不能把被测流水线搞崩。
_stage_sink: Any = None


def set_stage_sink(fn: Any) -> None:
    """注册/注销阶段观察者。fn(phase, name, fields) —— phase 是 "start"/"end"。"""
    global _stage_sink
    _stage_sink = fn


def _notify(phase: str, name: str, fields: dict[str, Any]) -> None:
    fn = _stage_sink
    if fn is None:
        return
    try:
        fn(phase, name, fields)
    except Exception:  # noqa: BLE001 — 观察者出问题不该影响被观察的链路
        pass


def _emit(stage_name: str, ms: int, ok: bool, fields: dict[str, Any]) -> None:
    """打一行。自身任何异常都吞掉——测量工具不该把被测流水线搞崩。"""
    try:
        if not timing_enabled():
            return
        parts = [f"{_LOG_PREFIX} stage={_fmt_value(stage_name)}", f"ms={ms}", f"ok={1 if ok else 0}"]
        for k, v in fields.items():
            if v is None:
                continue
            parts.append(f"{_fmt_value(k)}={_fmt_value(v)}")
        # 一次 print 打完整行：并发下只会整行之间交错，不会出现半行。
        print(" ".join(parts))
    except Exception:  # noqa: BLE001 — 埋点自身绝不能影响主链路
        pass


@contextmanager
def stage(name: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """给一段耗时操作计时，退出时打一行。

    yield 出来的 dict 可以在块内继续塞字段——有些信息要跑完才知道
    （比如这次到底用没用参照图、命中了几个节点）：

        with stage("monitor.design", page=pid) as st:
            content = generate_freeform_block(...)
            st["nodes"] = count_nodes(content)

    异常照常向上抛（只是顺手记成 ok=0），fail-open 的语义由调用方保持不变。
    """
    started = time.perf_counter()
    extra: dict[str, Any] = {}
    ok = True
    _notify("start", name, dict(fields))
    try:
        yield extra
    except BaseException:
        ok = False
        raise
    finally:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        merged = {**fields, **extra}
        _notify("end", name, {**merged, "ms": elapsed_ms, "ok": ok})
        _emit(name, elapsed_ms, ok, merged)
