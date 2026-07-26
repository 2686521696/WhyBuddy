"""体验层成本笼子哨兵（2026-07-26）。

历史问题：每个 FreeformInsight 区块 + 每个 monitor 页都各自独立生一张视觉
参考图、各起一个一次性 E2B 沙盒截图自检——无缓存、无上限、全部串行，区块
多的应用把"过门→发布"拖到分钟级。

修法：每次 enrich 调用带预算（env 可调），超预算的区块退化为纯文字生成
（与未配生图/沙盒时行为一致），命中预算打日志不静默；截图沙盒支持
SLIDERULE_E2B_TEMPLATE 预烤模板跳过现装。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import app_screenshot, freeform_block
from services.freeform_block import enrich_freeform_blocks, enrich_monitor_page_overviews


def _model_with_blocks(n: int) -> dict:
    return {
        "datamodel": {"entities": []},
        "appbundle": {"appIdentity": {"theme": "azure"}, "preferredDevice": "desktop"},
        "page": {
            "pages": [
                {
                    "id": "p1",
                    "kind": "business",
                    "blocks": [
                        {
                            "id": f"b{i}",
                            "type": "FreeformInsight",
                            "props": {"designBrief": f"卡片{i}"},
                        }
                        for i in range(n)
                    ],
                }
            ]
        },
    }


def test_enrich_blocks_budget_flags(monkeypatch):
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(
            (kwargs.get("use_reference_image"), kwargs.get("allow_screenshot_verify"))
        )
        return {"root": {"tag": "div", "text": "ok"}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    enrich_freeform_blocks(_model_with_blocks(6))

    ref_flags = [c[0] for c in calls]
    shot_flags = [c[1] for c in calls]
    # 默认预算：前 4 个生参考图，前 2 个跑截图自检，其余纯文字
    assert ref_flags == [True, True, True, True, False, False]
    assert shot_flags == [True, True, False, False, False, False]


def test_enrich_blocks_budget_env_zero(monkeypatch):
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "0")
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(kwargs.get("use_reference_image"))
        return {"root": {"tag": "div", "text": "ok"}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    enrich_freeform_blocks(_model_with_blocks(3))
    assert calls == [False, False, False]


def test_monitor_overview_budget(monkeypatch):
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(
            (kwargs.get("use_reference_image"), kwargs.get("allow_screenshot_verify"))
        )
        return {"root": {"tag": "div", "text": "ok"}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "1")
    model = {
        "datamodel": {"entities": []},
        "appbundle": {"appIdentity": {"theme": "azure"}},
        "page": {
            "pages": [
                {"id": f"m{i}", "kind": "monitor", "stats": [{"id": "s", "entity": "e"}]}
                for i in range(3)
            ]
        },
    }
    enrich_monitor_page_overviews(model)
    assert [c[0] for c in calls] == [True, False, False]
    for page in model["page"]["pages"]:
        assert page.get("freeformOverview")  # 超预算仍然生成（纯文字），不丢内容


def test_budget_env_garbage_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "not-a-number")
    assert freeform_block._env_budget("SLIDERULE_ENRICH_MAX_REF_IMAGES", 4) == 4
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "-3")
    assert freeform_block._env_budget("SLIDERULE_ENRICH_MAX_REF_IMAGES", 4) == 0


class _FakeSandbox:
    def __init__(self):
        self.ran = []

    def run_code(self, code, timeout=None):
        self.ran.append(code)

        class R:
            error = None

        return R()


def test_ensure_playwright_skips_install_with_template(monkeypatch):
    monkeypatch.setenv("SLIDERULE_E2B_TEMPLATE", "sliderule-playwright")
    sandbox = _FakeSandbox()
    assert app_screenshot._ensure_playwright(sandbox, 90) is True
    assert sandbox.ran == []  # 模板已烤好，零现装


def test_ensure_playwright_installs_without_template(monkeypatch):
    monkeypatch.delenv("SLIDERULE_E2B_TEMPLATE", raising=False)
    sandbox = _FakeSandbox()
    assert app_screenshot._ensure_playwright(sandbox, 90) is True
    assert len(sandbox.ran) == 1
    assert "playwright" in sandbox.ran[0]
