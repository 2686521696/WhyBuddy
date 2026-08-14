"""spec-first 画出来的页面必须活到交付（2026-08-14）。

## 这条防的是"交付那一刻蒸发"

此前主轴只取 `run_spec_first(...)["model"]`，**`res["pages"]` 整个扔掉**。
表现是：推演**过程中**右侧能看到新链路的 HTML（spec_page 事件逐页推），
一跑完就换回老 ENRICH 区块路径。用户原话「最后执行完，我发现变成老链路了」。

18 分钟画出来的五页，在收口那一刻没了。而且没有一处会报错——模型是好的、
闸是绿的、闭环是成的，只是交付物换了一个。**又一次"闸全绿但东西没了"。**

## 两条纪律，缺一条就变成"东西看着在，其实是旧的"

  ① `take_last_pages` 是**取走**语义（读一次就清）
  ② 暂存只在整条链**跑成之后**才写（中途抛异常时那行根本不执行）

合起来保证：新链路挂了、老路兜住的那一轮，state.specFirstPages 是空的，
而不是上一轮的旧页面。这个形状本仓数过太多次，所以两条都单独有用例。
"""

import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_stash():
    sfp._last_pages_var.set(None)
    yield
    sfp._last_pages_var.set(None)


class Test暂存的取用语义:
    def test_没跑过就是空的(self):
        assert sfp.take_last_pages() is None

    def test_取走一次就清(self):
        """⚠ 这条是"东西看着在其实是旧的"的唯一防线。

        留在原地的话：这一轮新链路挂了 → 回落老路 → 调用方照样读到
        **上一轮**的页面，当成这一轮的产出落库。用户看到的是一份跟当前
        话题无关的界面，而没有一处会报错。
        """
        sfp._last_pages_var.set({"pages": {"p1": "<html></html>"}})
        assert sfp.take_last_pages() is not None
        assert sfp.take_last_pages() is None, "第二次必须是空的"

    def test_只在整条链跑成之后才写入(self):
        """判据钉在源码顺序上：写暂存那行必须在最后的 return 之前、
        且在所有可能抛 SpecFirstError 的步骤之后。

        中途抛异常时它根本不执行——于是暂存里不会留下半份产物冒充成品。
        """
        src = inspect.getsource(sfp.run_spec_first)
        set_at = src.index("_last_pages_var.set(")
        # 第 3 步那道"一页都没出来就抛"必须在写入之前
        raise_at = src.index("第 3 步一页都没出来")
        assert raise_at < set_at, "写暂存不能早于失败判定"
        assert "return result" in src[set_at:], "写入之后才 return"


class Test落库那一处:
    def test_主轴真的调了落库(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex)
        assert "_cache_spec_first_pages(state)" in src, "主轴没落库——页面还是会蒸发"
        # 两处 llm_result 分支都要落，漏一处就是"某些路径下页面没了"
        assert src.count("_cache_spec_first_pages(state)") == 2, (
            "两个 llm_result 分支都要落库"
        )

    def test_落库失败不打死推演(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._cache_spec_first_pages)
        assert "except Exception" in src
        assert "不影响推演" in src

    def test_空产物不写脏数据(self, monkeypatch):
        """一页都没有时不该写一个空壳上去——空壳会让前端判成"有新链路产物"
        然后渲染出一片空白，比掉回老链路更糟。"""
        from services import v5_capability_executor as ex

        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        sfp._last_pages_var.set({"pages": {}})
        ex._cache_spec_first_pages(state)
        assert state.specFirstPages is None

    def test_有产物就落到状态上(self):
        from services import v5_capability_executor as ex

        state = V5SessionState(sessionId="s2", goal={"text": "x"}, artifacts=[])
        sfp._last_pages_var.set({
            "version": "spec-first-pipeline-v1",
            "pages": {"p1": "<html>甲</html>", "p2": "<html>乙</html>"},
            "navItems": [{"id": "p1"}],
            "boundPages": 2,
        })
        ex._cache_spec_first_pages(state)
        assert state.specFirstPages is not None
        assert set(state.specFirstPages["pages"]) == {"p1", "p2"}
        assert state.specFirstPages["boundPages"] == 2

    def test_回落老链路的那一轮状态上不该有页面(self):
        """把两条纪律合起来验一次：这是真正会烧到用户的那个场景。"""
        from services import v5_capability_executor as ex

        # 上一轮成功，产物被取走
        sfp._last_pages_var.set({"pages": {"p1": "<html>上一轮</html>"}})
        prev = V5SessionState(sessionId="s3", goal={"text": "上一个话题"}, artifacts=[])
        ex._cache_spec_first_pages(prev)
        assert prev.specFirstPages is not None

        # 这一轮新链路挂了 → 暂存里什么都没有 → 新状态上不许出现上一轮的页面
        now = V5SessionState(sessionId="s3", goal={"text": "新话题"}, artifacts=[])
        ex._cache_spec_first_pages(now)
        assert now.specFirstPages is None, "读到了上一轮的页面——东西看着在，其实是旧的"


class Test状态字段本身:
    def test_字段在_且默认为空(self):
        state = V5SessionState(sessionId="s4", goal={"text": "x"}, artifacts=[])
        assert state.specFirstPages is None

    def test_能被序列化带走(self):
        """会话要落盘、要过 SSE、要在刷新之后重放。序列化不掉才算数。"""
        state = V5SessionState(sessionId="s5", goal={"text": "x"}, artifacts=[])
        state.specFirstPages = {"pages": {"p1": "<html>甲</html>"}, "boundPages": 1}
        dumped = state.model_dump(mode="json")
        assert dumped["specFirstPages"]["pages"]["p1"] == "<html>甲</html>"

    def test_前端存回去那一侧也带着它(self):
        """⚠ 跨端判据。前端 preservePythonEvidenceProjection 是"存回去"那一侧，
        漏列一个键 = **存一次丢一次**，而且不会有任何一处报错：
        推演完看得见，刷新一下就没了。
        """
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[2]
        text = (root / "client/src/pages/sliderule/useSlideRuleSession.ts").read_text(
            encoding="utf-8"
        )
        block = text[text.index("function preservePythonEvidenceProjection"):]
        block = block[: block.index("\n}")]
        assert "specFirstPages" in block, "前端存回去时会把它丢掉"


class Test页面跟着版本一起回退:
    """回退不带页面 = **说谎**：指针回到 v1，右侧还是 v3 的页面。

    这跟 restore 那条 D8 修复（"UI 显示回到 v1、实际跑的还是 v3"）是同一个病，
    只是发生在交付物上而不是模型上。
    """

    def _snap(self, state, model, pages, instruction="改一版"):
        from services.v5_full_driver import record_model_snapshot

        state.specFirstPages = pages
        record_model_snapshot(state, model, instruction)

    def test_快照带上当时的页面(self):
        state = V5SessionState(sessionId="v1", goal={"text": "x"}, artifacts=[])
        self._snap(state, {"datamodel": {"entities": [1]}}, {"pages": {"p1": "<html>甲</html>"}})
        assert state.modelVersions[-1]["specFirstPages"]["pages"]["p1"] == "<html>甲</html>"

    def test_每版记各自那份_不串(self):
        state = V5SessionState(sessionId="v2", goal={"text": "x"}, artifacts=[])
        self._snap(state, {"datamodel": {"entities": [1]}}, {"pages": {"p1": "<html>一版</html>"}})
        self._snap(state, {"datamodel": {"entities": [2]}}, {"pages": {"p1": "<html>二版</html>"}})
        got = [v["specFirstPages"]["pages"]["p1"] for v in state.modelVersions]
        assert got == ["<html>一版</html>", "<html>二版</html>"]

    def test_只有最近几版带页面_更早的抹掉(self):
        """⚠ 容量闸。实测单页 19~28KB、五页一版约 125KB，20 版全带 = 2.5MB
        的会话 blob，而它每次存盘都要过一遍。"""
        from services.v5_full_driver import _PAGES_KEPT_VERSIONS

        state = V5SessionState(sessionId="v3", goal={"text": "x"}, artifacts=[])
        for i in range(_PAGES_KEPT_VERSIONS + 3):
            self._snap(state, {"datamodel": {"entities": [i]}},
                       {"pages": {"p1": f"<html>第{i}版</html>"}})
        carried = [v for v in state.modelVersions if v.get("specFirstPages")]
        assert len(carried) == _PAGES_KEPT_VERSIONS
        # 留下的必须是**最近的**那几版，不是最早的
        assert carried[-1]["specFirstPages"]["pages"]["p1"].endswith(
            f"第{_PAGES_KEPT_VERSIONS + 2}版</html>")

    def test_抹掉的是页面_不是整条版本(self):
        """版本记录本身要留着——◀▶ 还得能回退到那一版的模型，
        只是那一版**如实没有页面**（右侧回落老区块渲染）。"""
        from services.v5_full_driver import _PAGES_KEPT_VERSIONS

        state = V5SessionState(sessionId="v4", goal={"text": "x"}, artifacts=[])
        for i in range(_PAGES_KEPT_VERSIONS + 2):
            self._snap(state, {"datamodel": {"entities": [i]}},
                       {"pages": {"p1": f"<html>第{i}版</html>"}})
        oldest = state.modelVersions[0]
        assert oldest["specFirstPages"] is None
        assert isinstance(oldest.get("model"), dict), "模型不许跟着页面一起没了"

    def test_回退那一处真的会换页面(self):
        """判据钉在路由源码上：这条线断了不会有任何用例变红
        （回退照常成功、模型照常正确，只有页面是上一版的）。"""
        import pathlib

        src = (pathlib.Path(__file__).resolve().parents[1]
               / "routes/sliderule_full.py").read_text(encoding="utf-8")
        block = src[src.index("def restore_model_version"):]
        block = block[: block.index("\n@router")] if "\n@router" in block else block
        assert 'state.specFirstPages = target.get("specFirstPages") or None' in block, (
            "回退没换页面——指针回到 v1，右侧还是 v3 的页"
        )
        # ⚠ `or None` 是关键：目标版本没有页面时要**置空**，
        #   保留当前的等于拿另一版的页面冒充这一版的
        assert "or None" in block


class Test循环的进展判据:
    """「执行闭环不了，都执行 9 轮了」——2026-08-14 真机。

    查下来闭环**是成的**（blocked=False、证据 6/6），卡住的是覆盖门里一条
    `gap-evidence-turn-1`：外部证据缺口，`capabilityId=None`，**没有任何能力
    负责解它**。而每轮 evidence.search 都产出新产物，于是"产物变多"这个
    进展信号恒为真、计数器每轮清零，"没进展就停"那道兜底一次都没触发过。

    判据查的是"有没有在干活"，不是"有没有在向门前进"。
    """

    def test_产物变多不再算进展(self):
        import inspect

        from services import v5_full_driver as drv

        src = inspect.getsource(drv.drive_full_v5_session_stream)
        block = src[src.index("# progress tracking"):]
        block = block[: block.index("if no_progress_streak >= 2")]
        assert "if now_res > prev_resolved:" in block, "进展判据没收严"
        assert "now_art > prev_art_count" not in block, (
            "产物数还在当进展信号——外部证据缺口那种解不掉的场景会一直跑到 max_loops"
        )

    def test_缺口有新解决仍然算进展(self):
        """收严不能收成"永远不重置"——那样正常推进的轮次也会被两轮判死。"""
        import inspect

        from services import v5_full_driver as drv

        src = inspect.getsource(drv.drive_full_v5_session_stream)
        assert "no_progress_streak = 0" in src

    def test_兜底仍然是两轮(self):
        import inspect

        from services import v5_full_driver as drv

        src = inspect.getsource(drv.drive_full_v5_session_stream)
        assert "no_progress_streak >= 2" in src
