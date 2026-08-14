# -*- coding: utf-8 -*-
"""spec-first 七步接主轴。

这组测试钉的不是"链路跑得通"（那要真 LLM，另有跑批脚本），而是**接线本身
不许出错的那几条**：默认关、失败不静默、探针看得见、以及不引编排依赖。
"""

import ast
import inspect

import pytest

from services import spec_first_pipeline as sfp


class Test默认关且开关口径明确:
    def test_缺省不开(self, monkeypatch):
        """一轮 8~9 分钟、烧十几次 LLM。没有对照就翻默认是拿生产当实验台。

        先例：目录窄化攒够 3 覆盖域 × 2 臂 × n=6（p=0.00004）才翻默认；
        agentic pick 十话题 4:0 才转正。
        """
        monkeypatch.delenv("SLIDERULE_SPEC_FIRST", raising=False)
        assert sfp.spec_first_enabled() is False

    @pytest.mark.parametrize("on", ["1", "true", "TRUE", "yes", "on"])
    def test_显式开才开(self, monkeypatch, on):
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", on)
        assert sfp.spec_first_enabled() is True

    @pytest.mark.parametrize("off", ["", "0", "false", "no", "off", "随便写"])
    def test_写别的一律当没开(self, monkeypatch, off):
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", off)
        assert sfp.spec_first_enabled() is False


class Test探针能看出静默失效:
    """rank-bm25 那次的教训：依赖漏了、代码 fail-open，功能一声不吭整个失效，
    而 health、日志、返回值**没有任何一处看得出来**。"""

    def test_七个模块都在时报_effective(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        r = sfp.spec_first_readiness()
        assert r["modules"] == len(sfp._STEP_MODULES)
        assert r["missing"] == []
        assert r["effective"] is True

    def test_开关关着就不算_effective(self, monkeypatch):
        monkeypatch.delenv("SLIDERULE_SPEC_FIRST", raising=False)
        r = sfp.spec_first_readiness()
        assert r["enabled"] is False and r["effective"] is False
        # ⚠ 但模块数照报——「没开」和「开了但缺模块」必须分得出来
        assert r["modules"] == len(sfp._STEP_MODULES)

    def test_模块清单只有一份_不手抄(self):
        """探针与 import 共用 _STEP_MODULES。手抄两份必然漂移——
        本仓在「区块 uses 声明」「前端手抄区域词汇」上踩过两次。"""
        src = inspect.getsource(sfp.spec_first_readiness)
        assert "_STEP_MODULES" in src

    def test_探针不许因为被探的东西坏了而炸(self):
        src = inspect.getsource(sfp.spec_first_readiness)
        assert "except" in src


class Test接主轴那一处:
    def test_主轴先试新链路再回落老路(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._try_llm_generate_evidence)
        assert "spec_first_enabled" in src
        assert "run_spec_first" in src
        # 老路仍在——两条链路并存，⛔1 描述的是老路
        assert "generate_five_system_model(goal, llm_json_fn=llm_json_fn)" in src

    def test_回落必须留痕_不许静默(self):
        """「新链路跑通了」和「新链路挂了但老路兜住了」在外面长得一样，
        正是本仓数到第九次的形状（闸全绿但东西没了）。"""
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._try_llm_generate_evidence)
        assert "spec-first 失败，回落老链路" in src

    def test_新模块缺失不打死老路(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._try_llm_generate_evidence)
        # import 失败要被兜住，否则新链路一个语法错就让整个产品不能生成
        assert "except Exception" in src

    def test_探针进了_ready(self):
        import app

        src = inspect.getsource(app)
        assert '"specFirst": _spec_first_readiness()' in src


class Test不引编排依赖:
    """LangGraph / Burr / Prefect / Temporal / Dagster 逐个看过，一个都不引。

    这条链是**线性的**（只有第 3 步一处扇出），而 checkpoint / 进度 / 预算 /
    重试仓里都有更贴合的：run_registry（SSE Last-Event-ID 续播 + 孤儿看门狗）、
    enrich_timing.stage()、remaining_run_budget_seconds()、call_llm_with_retry。
    引进来会多出**第二套编排模型**，checkpoint 跟现有事件日志各记各的。
    跟第 3 步拒绝 tenacity 是同一个判断：多一个依赖换一个更差的集成。

    ⚠ 判据走 AST 查**真实 import**，不做字符串搜索——上面这段注释里就写着
    那几个名字，字符串搜索会把注释判红。这个坑本仓踩过一次（"tenacity"
    not in src 被自己的墓碑注释判红），AST 里没有注释，正好分得开。
    """

    @pytest.mark.parametrize(
        "lib", ["langgraph", "burr", "prefect", "temporalio", "dagster"]
    )
    def test_没有真的导入它们(self, lib):
        tree = ast.parse(inspect.getsource(sfp))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        assert lib not in imported

    def test_埋点用仓里现成的那套(self):
        src = inspect.getsource(sfp)
        assert "from .enrich_timing import stage" in src


class Test失败不回落占位:
    def test_一页都没出来就抛(self, monkeypatch):
        """第 3 步全挂还继续往下走，等于拿一份空 HTML 去反推结构——
        下游会得到一个"成功"的空模型，而没有一处会发现它是空的。"""
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: {"pages": [{"id": "p1"}], "nodes": []},
        )
        monkeypatch.setattr(
            "services.spec_page_html.generate_pages_parallel",
            lambda *a, **k: {"pages": {}, "failed": {"p1": "网关断了"}},
        )
        with pytest.raises(sfp.SpecFirstError) as exc:
            sfp.run_spec_first("随便一个话题")
        assert "第 3 步" in str(exc.value)

    def test_异常类型自己说清纪律(self):
        assert "不回落老链路" in (sfp.SpecFirstError.__doc__ or "")


class Test页面一出来就往外交:
    """`on_page` 从主轴一路透传到第 3 步。

    这条链一轮 8~9 分钟，第 3 步在第二分钟就有能看的东西。中间任何一环把
    回调丢了，前端就只能等到最后——**而且不会有任何一处报错**（页面照常
    产出、模型照常返回、闸照常绿）。所以这里钉的是"传到了"，不是"没炸"。
    """

    def test_透传到第_3_步(self, monkeypatch):
        seen: dict = {}
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: {"pages": [{"id": "p1"}], "nodes": []},
        )
        def _capture(spec, **kw):
            seen["on_page"] = kw.get("on_page")
            # 第 3 步交白卷 → 抛 SpecFirstError，测试到此为止：
            # 这条只管"回调有没有传到"，不需要把整条链跑完
            return {"pages": {}, "failed": {"p1": "到这里就够了"}}

        monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _capture)

        def sentinel(*_a):
            return None

        with pytest.raises(sfp.SpecFirstError):
            sfp.run_spec_first("随便一个话题", on_page=sentinel)
        assert seen["on_page"] is sentinel, "回调在中间被丢了——前端会一直黑到最后"

    def test_不传也能跑(self):
        """默认 None——老调用方一个字都不用改。"""
        import inspect as _inspect

        sig = _inspect.signature(sfp.run_spec_first)
        assert sig.parameters["on_page"].default is None
        assert sig.parameters["on_page"].kind is _inspect.Parameter.KEYWORD_ONLY
