"""生成链路的请求域状态不能是模块级全局 —— 串了会泄漏别人的内容。

## 这组测试为什么存在

2026-08-06 审查并行化改动（8f93d12）时，用并发探针实测出三处模块级全局在
多租户下互相串。并行化本身没错——它用 `copy_context()` 把 ContextVar 传进
worker，与 OpenTelemetry 的 `context.attach()` 同一套语义。错的是它下面压着
的这几个普通全局，`copy_context` 救不了。

实测到的后果，逐条：

  · _delta_sink       两个并发流式推演，后到的把先到的 sink 顶掉 ——
                      **用户 A 生成的内容实时出现在用户 B 的页面上**，
                      A 自己那边一片空白。跨用户内容泄漏。
  · _installed_skills A 装的技能没进 A 的生成，B 的技能进去了。
  · _last_call_error  三个并行 worker 抢同一个格子，报错张冠李戴
                      （datamodel 挂了却报 rbac 挂了）。

## 为什么其中一个必须存「可变容器」

`copy_context()` 复制的是 ContextVar 的**值**——worker 里 `var.set(x)` 不会
回传给父线程。这对 sink / skills 无所谓（父设、子读），但 _last_call_error
恰恰是 worker 写、主线程读，存值会让主线程永远读到空。

所以它存的是一个**可变 dict 的引用**：父子共享同一个 dict，worker 改得动、
主线程看得见；不同请求各拿各的 dict，天然隔离。这一招有两个成熟出处——
OpenTelemetry 的 Span（ContextVar 存 Span 引用，子任务改属性父任务读得到）
与 asgiref.local._CVar（ContextVar 存 _Storage，真数据在 _Storage.data 里）。
"""

import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import v5_llm_generate as G
from sliderule_llm import capabilities as CAPS


def _run_two_requests(body):
    """两个请求同时到达：都设完各自的状态，再各自去读。

    Barrier 保证"都设完"这个时序——这正是原 bug 的触发条件，
    不同步的话第二个请求可能在第一个读完之后才设，测不出来。
    """
    barrier = threading.Barrier(2)
    out = {}

    def one(name):
        # 每个请求跑在自己的 context 里——真实链路是 Starlette 的
        # run_in_threadpool，每次调用一个独立 context。
        ctx = copy_context()
        ctx.run(body, name, barrier, out)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(one, ["A", "B"]))
    return out


def test_generate_delta_sink_does_not_leak_across_requests():
    """最严重的一条：A 的生成内容不能出现在 B 的流里。"""
    received = {"A": [], "B": []}

    def body(name, barrier, _out):
        G.set_generate_delta_sink(lambda chunk, n=name: received[n].append(chunk))
        barrier.wait()
        time.sleep(0.02)
        G._emit_delta(f"{name}-content")

    _run_two_requests(body)
    assert received["A"] == ["A-content"], f"A 的流拿到 {received['A']}"
    assert received["B"] == ["B-content"], f"B 的流拿到 {received['B']}"


def test_capability_delta_sink_does_not_leak_across_requests():
    """能力执行那条链路上的同一个坑（sliderule_llm.capabilities）。"""
    received = {"A": [], "B": []}

    def body(name, barrier, _out):
        CAPS.set_capability_delta_sink(lambda cap, chunk, n=name: received[n].append(chunk))
        barrier.wait()
        time.sleep(0.02)
        emit = CAPS._delta_emitter("cap-1")
        assert emit is not None
        emit(f"{name}-content")

    _run_two_requests(body)
    assert received["A"] == ["A-content"], f"A 的流拿到 {received['A']}"
    assert received["B"] == ["B-content"], f"B 的流拿到 {received['B']}"


def test_installed_skills_do_not_leak_across_requests():
    """A 装的技能必须进 A 的生成，不能被 B 顶掉。"""

    def body(name, barrier, out):
        G.set_installed_skills([{"name": f"skill-{name}", "description": "x", "channel": "aigc"}])
        barrier.wait()
        time.sleep(0.02)
        out[name] = [s.get("name") for s in (G._installed_skills_var.get() or [])]

    out = _run_two_requests(body)
    assert out["A"] == ["skill-A"], f"A 读到 {out['A']}"
    assert out["B"] == ["skill-B"], f"B 读到 {out['B']}"


def test_error_book_keeps_each_section_separate():
    """并行 worker 各记各的，不抢同一个格子。"""
    sections = ["datamodel", "rbac", "workflow"]
    barrier = threading.Barrier(len(sections))

    def worker(section):
        barrier.wait()
        G._record_call_error(f"{section} 挂了", section=section)
        time.sleep(0.01)
        return section

    ctx = copy_context()

    def run_all():
        G._error_book().clear()
        with ThreadPoolExecutor(max_workers=len(sections)) as pool:
            # 照抄 v5_parallel_generate._run_wave 的形状：**在父线程里**逐个
            # copy_context，再 submit(ctx.run, ...)。写成
            # `pool.map(lambda s: copy_context().run(...))` 是错的——那个
            # copy_context() 在工作线程里执行，拿到的是空上下文。
            futures = []
            for section in sections:
                wctx = copy_context()
                futures.append(pool.submit(wctx.run, worker, section))
            for f in futures:
                f.result()
        return G._read_call_error()

    merged = ctx.run(run_all)
    for section in sections:
        assert f"{section} 挂了" in merged, f"{section} 的错误丢了：{merged}"


def test_error_book_is_visible_from_the_parent_thread():
    """worker 写、父线程读——这是 ContextVar 存值会断、存容器才通的那一条。

    如果哪天有人把错误簿从"存 dict 引用"改成"存字符串值"，这条会红。
    """

    def in_worker():
        G._record_call_error("worker 里记的", section="datamodel")

    ctx = copy_context()

    def parent():
        G._error_book().clear()
        with ThreadPoolExecutor(max_workers=1) as pool:
            wctx = copy_context()   # 必须在父线程里复制，见上一条测试的说明
            pool.submit(wctx.run, in_worker).result()
        return G._read_call_error()

    assert "worker 里记的" in ctx.run(parent)


def test_diagnostic_does_not_leak_across_requests():
    """生成诊断（失败原因）也是请求域的。"""

    def body(name, barrier, out):
        G.set_generate_diagnostic({"outcome": "failed", "detail": f"{name} 的失败原因"})
        barrier.wait()
        time.sleep(0.02)
        out[name] = G.get_generate_diagnostic().get("detail")

    out = _run_two_requests(body)
    assert out["A"] == "A 的失败原因"
    assert out["B"] == "B 的失败原因"


def test_no_module_level_mutable_globals_left():
    """守住这次的成果：这几个名字不能再作为模块属性存在。

    照着旧写法加回一个全局，串号就会静悄悄地复发——这条让它变成红灯。
    """
    for name in ("_delta_sink", "_installed_skills", "_last_call_error", "last_generate_diagnostic"):
        assert not hasattr(G, name), f"v5_llm_generate.{name} 又变回模块级全局了"
    assert not hasattr(CAPS, "_delta_sink"), "capabilities._delta_sink 又变回模块级全局了"
