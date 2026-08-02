"""缩略图编码（PNG → WebP）的覆盖。

背景：实测一张卡片缩略图 805~857KB PNG，而卡片只有 309px 宽。应用中心一次首屏
23 张卡 ≈ 10.7MB，5Mbps 出口上一个用户冷启动 17 秒、三个人 51 秒。同样像素换成
WebP 是 43~60KB。

这份测试盯三件事：
  ① 真的变小了，而且**分辨率一个像素不减**（只换格式是刻意的保守取舍）；
  ② 每一步都 fail-open——压缩是增强项，绝不能因为它失败就没图；
  ③ 取图时按内容报类型 + Accept 协商，历史存量的 PNG 照常能取。
"""

from io import BytesIO

import pytest

from services.thumb_image import (
    WEBP_QUALITY,
    client_accepts_webp,
    sniff_media_type,
    to_png,
    to_webp,
)

PIL = pytest.importorskip("PIL", reason="没装 Pillow 时压缩链路本就静默失效")


def _screenshot_png(w: int = 1280, h: int = 720) -> bytes:
    """造一张**像界面截图**的图：大片纯色 + 细线 + 文字块。

    不用随机噪声——噪声图 PNG 压不动、WebP 也压不动，测出来的比例毫无意义，
    正好把这次改动的收益整个抹平。
    """
    from PIL import Image, ImageDraw

    im = Image.new("RGB", (w, h), (247, 248, 250))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 56], fill=(255, 255, 255))
    d.rectangle([0, 56, 220, h], fill=(32, 41, 55))
    for i in range(6):
        x = 250 + i * 160
        d.rectangle([x, 90, x + 140, 200], fill=(255, 255, 255), outline=(226, 232, 240))
        d.text((x + 12, 120), "12,480", fill=(15, 23, 42))
    for row in range(14):
        y = 240 + row * 32
        d.line([250, y, w - 30, y], fill=(233, 236, 240))
        d.text((260, y - 14), "CM-2026-5993   已完成", fill=(71, 85, 105))
    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


# ────────────────────── ① 真的变小，且分辨率不减 ──────────────────────


def test_webp_conversion_preserves_resolution():
    """转换后**分辨率一个像素不减**——这是这次改动最重要的约束。

    只换格式、不降分辨率是刻意的保守：降到卡片尺寸能再小一半，但会引入"看着
    糊了"的风险，而只换格式已经把带宽问题解决掉了。

    ⚠️ 这里**不断言压缩比**。合成夹具造不出真实缩略图那种体积（本文件的夹具
    才几 KB，真实缩略图 805~857KB），在它上面断言比例是自欺欺人——真实收益
    是在生产图上量的：

        1280x720  PNG 805KB → WebP  43KB   （19 倍）
        1280x720  PNG 808KB → WebP  39KB   （20 倍）
         720x1280 PNG 857KB → WebP  60KB   （14 倍）

    压缩比是内容的经验性质，靠 scripts/thumb_recompress.py 的实跑输出复核，
    不靠单测假装。
    """
    from PIL import Image

    png = _screenshot_png()
    webp = to_webp(png)

    assert sniff_media_type(webp) == "image/webp"
    with Image.open(BytesIO(png)) as a, Image.open(BytesIO(webp)) as b:
        assert a.size == b.size, f"分辨率被改了：{a.size} → {b.size}"


def test_already_webp_is_returned_untouched():
    """已经是 WebP 的直接返回——重复编码只会掉画质。

    这条真会被走到：采集端出的就是 WebP（thumb-capture.ts），而写入路径仍然会
    调 to_webp（那是给参照板和历史存量用的）。
    """
    webp = to_webp(_screenshot_png())
    assert to_webp(webp) is webp


# ────────────────────── ② 每一步都 fail-open ──────────────────────


def test_garbage_bytes_pass_through_unchanged():
    """不是图片 → 原样返回，不抛。

    缩略图是增强项：压不动的正确表现是"没省下带宽"，不是"这张卡没图了"。
    """
    junk = b"this is definitely not an image" * 4
    assert to_webp(junk) == junk
    assert to_png(junk) == junk


def test_empty_input_is_safe():
    assert to_webp(b"") == b""
    assert to_png(b"") == b""


def test_missing_pillow_degrades_silently(monkeypatch):
    """没装 Pillow 时整条链路静默失效、原样存 PNG。

    requirements 里加了 pillow，但部署环境可能装不上（编译失败/精简镜像）。
    那时候功能必须照常，只是不省带宽。
    """
    import services.thumb_image as ti

    monkeypatch.setattr(ti, "_pillow", lambda: None)
    png = _screenshot_png()
    assert ti.to_webp(png) == png
    assert ti.to_png(png) == png


def test_webp_is_skipped_when_it_would_be_bigger():
    """反常情况下 WebP 可能比原图还大（极小图）。那就别换了。"""
    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (2, 2), (255, 255, 255)).save(buf, format="PNG")
    tiny = buf.getvalue()
    out = to_webp(tiny)
    assert len(out) <= len(tiny)


# ────────────────────── ③ 类型嗅探与 Accept 协商 ──────────────────────


def test_sniff_recognizes_both_stored_formats():
    """库里存量是 PNG、新写入是 WebP，取图时得按**内容**报类型。

    报错类型浏览器可能拒绝渲染，CDN 也会缓存错。
    """
    png = _screenshot_png()
    assert sniff_media_type(png) == "image/png"
    assert sniff_media_type(to_webp(png)) == "image/webp"


def test_sniff_falls_back_to_png_for_unknown():
    """认不出按 PNG——历史存量就是 PNG，这个兜底是给它们的。

    ⚠️ 正因为有这个兜底，sniff **不能**单独用来做上传入口校验
    （那会让任意字节流被判成 PNG 放进来）。入口另有一道真魔数检查。
    """
    assert sniff_media_type(b"\x00\x01\x02\x03") == "image/png"


def test_webp_can_be_converted_back_for_old_clients():
    """不认 WebP 的客户端要能拿到 PNG（Accept 协商的兜底支）。"""
    from PIL import Image

    png = _screenshot_png()
    back = to_png(to_webp(png))
    assert sniff_media_type(back) == "image/png"
    with Image.open(BytesIO(back)) as im:
        assert im.size == (1280, 720)


@pytest.mark.parametrize(
    "accept,expected",
    [
        ("image/avif,image/webp,image/apng,*/*", True),
        ("image/webp", True),
        ("*/*", True),
        (None, True),        # 缺 Accept 基本是脚本/抓取工具，给小的没坏处
        ("", True),
        ("image/png", False),
        ("text/html", False),
    ],
)
def test_accept_negotiation(accept, expected):
    assert client_accepts_webp(accept) is expected


def test_quality_matches_the_frontend_constant():
    """服务端与采集端的质量必须一致，否则同一张卡两条来源画质不一样。

    采集端在 client/src/lib/thumb-capture.ts 里是 0~1 的小数。
    """
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "client/src/lib/thumb-capture.ts"
    text = src.read_text(encoding="utf-8")
    assert f"const WEBP_QUALITY = {WEBP_QUALITY / 100}" in text, (
        f"前端质量常量与服务端 {WEBP_QUALITY} 对不上"
    )
