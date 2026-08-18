# -*- coding: utf-8 -*-
"""525 / JSON parse 不许把整条 spec-first 打回 GEN5（2026-08-18 过夜）。

我们只补过「当前页空时去版本史找旧页」。咖啡馆首轮 spec 步撞 parse/525，
宽 except 整条回落 GEN5，mv-1「页面：无」，版本史也空，第一轮精修只能全量。

要堵的是外圈回落，不是再削版本史。删掉 `_block_gen5` 那一针，下面必红。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services.v5_capability_executor import (  # noqa: E402
    spec_first_failure_blocks_gen5,
)


class Test哪些错不许回落:
    def test_parse和525要拦住(self):
        assert spec_first_failure_blocks_gen5(
            RuntimeError("LLM JSON parse failed: not-json")
        )
        assert spec_first_failure_blocks_gen5(
            RuntimeError("spec 生成失败：upstream 525: ssl handshake")
        )
        assert spec_first_failure_blocks_gen5(
            RuntimeError("ConnectTimeout: connection timed out")
        )

    def test_第3步交白卷仍回落(self):
        """别的故障还走老路，enrich 那组反向保险不能被误伤。"""
        assert not spec_first_failure_blocks_gen5(
            RuntimeError("第 3 步一页都没出来：p1 画挂了")
        )

    def test_开关关掉退回一律回落(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST_NO_GEN5_ON_TRANSPORT", "0")
        assert not spec_first_failure_blocks_gen5(
            RuntimeError("LLM JSON parse failed: x")
        )


class Test接线_执行器:
    """纪律一：必须跑 _try_llm_generate_evidence，只测分类函数会假绿。"""

    def _drive(self, monkeypatch, *, spec_fn, gen5_fn=None):
        from services import v5_capability_executor as ex
        from services.v5_llm_generate import set_refine_context

        seen = {"gen5": 0}

        def fake_gen5(*a, **k):
            seen["gen5"] += 1
            return (gen5_fn() if gen5_fn else {"page": {"pages": []}})

        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", spec_fn)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model", fake_gen5
        )
        monkeypatch.setattr(
            "services.v5_model_repair.repair_five_system_model",
            lambda m: {"model": m},
        )
        monkeypatch.setattr(
            "services.v5_model_gate.validate_five_system_model",
            lambda *a, **k: {"passed": True},
        )
        monkeypatch.setattr(
            "services.device_policy.normalize_model_preferred_device",
            lambda g, m: m,
        )
        monkeypatch.setattr(
            "services.v5_llm_generate.model_to_linkage_artifacts",
            lambda *a, **k: [],
        )
        set_refine_context(None)
        try:
            ex._try_llm_generate_evidence("做个工单系统", None)
        finally:
            set_refine_context(None)
        return seen

    def test_525再试成功不走GEN5(self, monkeypatch):
        hits = {"n": 0}

        def flaky(*a, **k):
            hits["n"] += 1
            if hits["n"] == 1:
                raise RuntimeError("upstream 525: ssl handshake failed")
            return {"model": {"page": {"pages": [{"id": "p1", "name": "工单页"}]}}}

        seen = self._drive(monkeypatch, spec_fn=flaky)
        assert hits["n"] == 2, "525 之后没整条再试"
        assert seen["gen5"] == 0, "再试成功了还是打回 GEN5——首轮又会无页"

    def test_parse两次都失败不走GEN5(self, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("LLM JSON parse failed: trailing junk")

        seen = self._drive(monkeypatch, spec_fn=boom)
        assert seen["gen5"] == 0, (
            "parse 仍打回 GEN5——咖啡馆首轮「页面：无」会再来"
        )

    def test_别的故障仍回落GEN5(self, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("第 3 步一页都没出来：p1 画挂了")

        seen = self._drive(monkeypatch, spec_fn=boom)
        assert seen["gen5"] == 1, "非传输故障也被拦住回落——老路安全网没了"
