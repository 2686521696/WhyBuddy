"""E32 agentic pick 转正：开关默认语义（未设置=开，显式 off 才关）。

背景：F2 实验期默认 off；十话题双模式对比 + LLM judge 内容质量 4:0
胜出后转正。三条不变量（收敛权归规则/词表封闭/fail-open 回落）由
提案函数本身保证，这里只锁默认开关语义不回潮。
"""

import pytest

from services.v5_agentic_pick import agentic_pick_enabled


def test_default_unset_is_enabled(monkeypatch):
    monkeypatch.delenv("SLIDERULE_AGENTIC_PICK", raising=False)
    assert agentic_pick_enabled() is True


@pytest.mark.parametrize("value", ["off", "0", "false", "no", " OFF ", "False"])
def test_explicit_off_disables(monkeypatch, value):
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", value)
    assert agentic_pick_enabled() is False


@pytest.mark.parametrize("value", ["on", "1", "true", "yes", "anything-else"])
def test_explicit_on_stays_enabled(monkeypatch, value):
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", value)
    assert agentic_pick_enabled() is True


def test_disabled_pick_returns_none(monkeypatch):
    """off 时提案函数直接 None（调用方沿用规则版）——不碰 LLM。"""
    monkeypatch.setenv("SLIDERULE_AGENTIC_PICK", "off")
    from services.v5_agentic_pick import agentic_pick_next_capabilities

    assert agentic_pick_next_capabilities(None, "任意话题") is None
