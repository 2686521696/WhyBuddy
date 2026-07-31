"""首页参照板的独立端点开关（2026-07-30）。

由来：审查一份第三方技能包的产出时量到，它的图 7.3MP、我们 1.6MP，观感差距
主要来自**端点给的像素档位**而不是提示词——同一 prompt 在我们端点传
3840x2160 也只回 1672x941（85s vs 90s，实测）。于是给首页参照板开一个口子，
可以单独指到出图更大的那家。

只给这一处开的理由：这张图是当前**唯一驱动版式的图**——FreeformInsight 没
放开（experience_block_catalog 里 generationEnabled:false + ssot-parity 哨兵），
单区块参照图只在这张失败时兜底触发。开在这一处 = 最小改动面。

这组测试钉三件事：没配时逐字节回落旧行为、配齐时才启用、两种请求体形态都
装配正确（不同服务商字段名不一样）。**不碰任何真实凭证，全程 monkeypatch。**
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sliderule_llm.image_client import ImageGenConfig, _build_body, get_image_gen_config

_SHEET_ENV = (
    "SHEET_IMAGE_API_URL",
    "SHEET_IMAGE_MODEL",
    "SHEET_IMAGE_API_KEY",
    "SHEET_IMAGE_SIZE",
    "SHEET_IMAGE_BODY_STYLE",
    "SHEET_IMAGE_ASPECT_RATIO",
    "SHEET_IMAGE_TIMEOUT_S",
)


def _clear_sheet_env(monkeypatch):
    for name in _SHEET_ENV:
        monkeypatch.delenv(name, raising=False)


def test_no_sheet_env_means_no_override(monkeypatch):
    """一项都没配 → None，调用方回落默认端点，行为与从前一致。"""
    _clear_sheet_env(monkeypatch)
    assert get_image_gen_config("SHEET_") is None


def test_partial_sheet_env_still_falls_back(monkeypatch):
    """只配了一部分也必须回落——半配状态下打过去只会 401/404，
    不如老老实实用默认那份（跟默认配置同一条 fail-closed 纪律）。"""
    _clear_sheet_env(monkeypatch)
    monkeypatch.setenv("SHEET_IMAGE_API_URL", "https://example.invalid/v1/images/generations")
    assert get_image_gen_config("SHEET_") is None, "缺 model/key 时不能启用"

    monkeypatch.setenv("SHEET_IMAGE_MODEL", "some-model")
    assert get_image_gen_config("SHEET_") is None, "缺 key 时不能启用"


def test_full_sheet_env_enables_override(monkeypatch):
    _clear_sheet_env(monkeypatch)
    monkeypatch.setenv("SHEET_IMAGE_API_URL", "https://example.invalid/v1/images/generations")
    monkeypatch.setenv("SHEET_IMAGE_MODEL", "some-model")
    monkeypatch.setenv("SHEET_IMAGE_API_KEY", "test-key-not-a-real-credential")

    cfg = get_image_gen_config("SHEET_")
    assert cfg is not None
    assert cfg.url.endswith("/v1/images/generations")
    assert cfg.model == "some-model"
    # 默认形态保持 size，不因为新增开关就悄悄改掉既有请求体。
    assert cfg.body_style == "size"


def test_default_config_untouched_by_sheet_env(monkeypatch):
    """带前缀那份不能污染默认那份——两条路必须互不影响。"""
    _clear_sheet_env(monkeypatch)
    monkeypatch.setenv("SHEET_IMAGE_API_URL", "https://sheet.invalid/v1/images/generations")
    monkeypatch.setenv("SHEET_IMAGE_MODEL", "sheet-model")
    monkeypatch.setenv("SHEET_IMAGE_API_KEY", "sheet-key")
    monkeypatch.setenv("IMAGE_API_URL", "https://default.invalid/v1/images/generations")
    monkeypatch.setenv("IMAGE_MODEL", "default-model")
    monkeypatch.setenv("IMAGE_API_KEY", "default-key")

    assert get_image_gen_config().model == "default-model"
    assert get_image_gen_config("SHEET_").model == "sheet-model"


def test_body_style_size_is_the_openai_shape():
    cfg = ImageGenConfig(url="u", model="m", key="k", timeout=600, body_style="size")
    body = _build_body(cfg, "画一张图", "1792x1024")
    assert body["size"] == "1792x1024"
    assert "image_size" not in body and "aspect_ratio" not in body


def test_body_style_image_size_is_the_other_vendor_shape():
    """另一家用 {"image_size":"2K","aspect_ratio":"16:9"}——字段名不同，
    传错了不会报错，只会拿到默认档位的图（这种失败很安静，所以要钉住）。"""
    cfg = ImageGenConfig(
        url="u", model="m", key="k", timeout=600, body_style="image_size", aspect_ratio="16:9"
    )
    body = _build_body(cfg, "画一张图", "2K")
    assert body["image_size"] == "2K"
    assert body["aspect_ratio"] == "16:9"
    assert "size" not in body


def test_unknown_body_style_falls_back_to_size(monkeypatch):
    """配错值不能静默变成一个谁也不认的请求体。"""
    _clear_sheet_env(monkeypatch)
    monkeypatch.setenv("SHEET_IMAGE_API_URL", "https://example.invalid/v1/images/generations")
    monkeypatch.setenv("SHEET_IMAGE_MODEL", "m")
    monkeypatch.setenv("SHEET_IMAGE_API_KEY", "k")
    monkeypatch.setenv("SHEET_IMAGE_BODY_STYLE", "totally-bogus")
    assert get_image_gen_config("SHEET_").body_style == "size"


def test_sheet_generation_uses_the_override_config(monkeypatch):
    """端到端接线：配齐 SHEET_* 时，_generate_overview_sheet_b64 必须把那份
    配置和尺寸传给 generate_image_png，而不是继续用默认端点。"""
    import services.freeform_block as fb

    _clear_sheet_env(monkeypatch)
    monkeypatch.setenv("SHEET_IMAGE_API_URL", "https://sheet.invalid/v1/images/generations")
    monkeypatch.setenv("SHEET_IMAGE_MODEL", "big-image-model")
    monkeypatch.setenv("SHEET_IMAGE_API_KEY", "sheet-key")
    monkeypatch.setenv("SHEET_IMAGE_SIZE", "2K")
    monkeypatch.setenv("SHEET_IMAGE_BODY_STYLE", "image_size")

    seen = {}

    def fake_generate(prompt, *, cfg=None, size="1024x1024"):
        seen["cfg"] = cfg
        seen["size"] = size
        return b"\x89PNG\r\n\x1a\n" + b"0" * 64

    monkeypatch.setattr("sliderule_llm.image_client.generate_image_png", fake_generate)

    out = fb._generate_overview_sheet_b64(
        "测试", {"entities": []}, theme_id="tangerine", device="desktop"
    )
    assert out is not None, "生图成功时应返回 base64"
    assert seen["cfg"] is not None, "配齐 SHEET_* 却没把独立配置传下去"
    assert seen["cfg"].model == "big-image-model"
    assert seen["cfg"].body_style == "image_size"
    assert seen["size"] == "2K", "SHEET_IMAGE_SIZE 没生效"


def test_sheet_generation_without_override_passes_none(monkeypatch):
    """没配 SHEET_* 时必须传 cfg=None + 原来的尺寸——这是"不改变现有行为"的钉子。"""
    import services.freeform_block as fb

    _clear_sheet_env(monkeypatch)
    seen = {}

    def fake_generate(prompt, *, cfg=None, size="1024x1024"):
        seen["cfg"] = cfg
        seen["size"] = size
        return b"\x89PNG\r\n\x1a\n" + b"0" * 64

    monkeypatch.setattr("sliderule_llm.image_client.generate_image_png", fake_generate)

    fb._generate_overview_sheet_b64("测试", {"entities": []}, theme_id="tangerine", device="desktop")
    assert seen["cfg"] is None
    assert seen["size"] == fb._SHEET_IMAGE_SIZE
