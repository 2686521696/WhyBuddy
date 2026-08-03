"""生图总时长预算与成本笼子的行为锁定（2026-08-01）。"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if False else '.')

import pytest
from sliderule_llm import image_client as ic


def _cfg(monkeypatch, timeout=600):
    monkeypatch.setenv("IMAGE_API_URL", "http://example.invalid/v1/images")
    monkeypatch.setenv("IMAGE_MODEL", "m")
    monkeypatch.setenv("IMAGE_API_KEY", "k")
    monkeypatch.setenv("IMAGE_TIMEOUT_S", str(timeout))


def test_total_budget_stops_retrying(monkeypatch):
    """端点持续失败时，整段耗时受总预算约束，而不是 重试次数 × 单次超时。

    真机吃过：503 时白等 788s / 686s，理论最坏 30 分钟一张。
    """
    _cfg(monkeypatch)
    monkeypatch.setenv("IMAGE_TOTAL_BUDGET_S", "1")

    def slow_fail(*a, **k):
        # 必须是**可重试**的错误（_transient 只认 HTTPError 的 429/5xx），
        # 否则第一次就 break、根本走不到重试与退避——那样这条用例会在预算
        # 失效时也照样通过（第一版就踩了这个空，靠反向验证才发现）。
        time.sleep(0.4)
        raise ic.urllib.error.HTTPError("http://x", 503, "Service Unavailable", {}, None)

    monkeypatch.setattr(ic.urllib.request, "urlopen", slow_fail)
    t0 = time.monotonic()
    with pytest.raises(ic.ImageGenError):
        ic.generate_image_png("p")
    spent = time.monotonic() - t0
    assert spent < 3, f"总预算 1s 却花了 {spent:.1f}s——预算没生效"


def test_budget_zero_means_unlimited(monkeypatch):
    """显式设 0 = 回到老行为（不限），保留逃生口。"""
    _cfg(monkeypatch)
    monkeypatch.setenv("IMAGE_TOTAL_BUDGET_S", "0")
    assert ic._total_budget_s() == 0


def test_budget_defaults_when_unset_or_garbage(monkeypatch):
    monkeypatch.delenv("IMAGE_TOTAL_BUDGET_S", raising=False)
    assert ic._total_budget_s() == float(ic.DEFAULT_TOTAL_BUDGET_S)
    monkeypatch.setenv("IMAGE_TOTAL_BUDGET_S", "不是数字")
    assert ic._total_budget_s() == float(ic.DEFAULT_TOTAL_BUDGET_S)


def test_default_budget_leaves_room_for_a_slow_success():
    """默认预算不能切掉正常的慢出图——实测最慢一张 107s。"""
    assert ic.DEFAULT_TOTAL_BUDGET_S >= 2 * 107


def test_theme_never_asks_for_a_reference_image(monkeypatch):
    """主题选色**永远不生参照图**（2026-08-03，用户裁决）。

    原来的做法是花 ~74s 生一整张 PNG 喂给视觉 LLM，只为取回 {label, seed}
    两个字段——那张图从不展示给任何人，是整条链路上性价比最低的一步。

    这条测试锁死"不管环境变量怎么设都不生"：此前它挂在
    SLIDERULE_ENRICH_MAX_REF_IMAGES 上，于是"全系统只有首页生图"这条约定
    取决于有没有人记得去设那个变量——约定就不成其为约定了。
    """
    from services import identity_theme_gen as itg

    seen = {}

    def fake_generate(app_name, goal_text, datamodel, *, device="", use_reference_image=False, **kw):
        seen["use_reference_image"] = use_reference_image
        return {"label": "测试", "seed": "#1677ff"}

    monkeypatch.setattr(itg, "generate_identity_theme", fake_generate)
    model = {
        "appbundle": {"appIdentity": {"productName": "X", "theme": "azure"}},
        "datamodel": {"entities": []},
    }

    for budget in ("0", "4", "9"):
        seen.clear()
        monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", budget)
        model["appbundle"]["appIdentity"].pop("generatedTheme", None)
        itg.enrich_identity_theme(model, "目标")
        assert seen["use_reference_image"] is False, f"预算={budget} 时主题仍在生参照图"


def test_theme_generation_defaults_to_no_reference_image():
    """默认参数本身就得是 False——调用方漏传时不能悄悄退回生图。"""
    import inspect

    from services.identity_theme_gen import generate_identity_theme

    sig = inspect.signature(generate_identity_theme)
    assert sig.parameters["use_reference_image"].default is False
