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


def test_ref_image_budget_zero_also_skips_the_theme_image(monkeypatch):
    """SLIDERULE_ENRICH_MAX_REF_IMAGES=0 必须把**主题那张**也关掉。

    .env 写的是"设 0 全关"，但主题路径此前不读这个变量：真机设 0 后
    monitor.sheet 跳过了、主题照生，端点挂着白等 685s。
    """
    from services import identity_theme_gen as itg

    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "0")
    seen = {}

    def fake_generate(app_name, goal_text, datamodel, *, device="", use_reference_image=True, **kw):
        seen["use_reference_image"] = use_reference_image
        return {"label": "测试", "seed": "#1677ff"}

    monkeypatch.setattr(itg, "generate_identity_theme", fake_generate)
    model = {
        "appbundle": {"appIdentity": {"productName": "X", "theme": "azure"}},
        "datamodel": {"entities": []},
    }
    itg.enrich_identity_theme(model, "目标")
    assert seen["use_reference_image"] is False, "设 0 之后主题参照图仍在生成"


def test_ref_image_budget_positive_keeps_the_theme_image(monkeypatch):
    from services import identity_theme_gen as itg

    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "4")
    seen = {}

    def fake_generate(app_name, goal_text, datamodel, *, device="", use_reference_image=True, **kw):
        seen["use_reference_image"] = use_reference_image
        return {"label": "测试", "seed": "#1677ff"}

    monkeypatch.setattr(itg, "generate_identity_theme", fake_generate)
    model = {
        "appbundle": {"appIdentity": {"productName": "X", "theme": "azure"}},
        "datamodel": {"entities": []},
    }
    itg.enrich_identity_theme(model, "目标")
    assert seen["use_reference_image"] is True
