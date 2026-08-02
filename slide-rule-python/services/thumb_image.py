"""缩略图编码（2026-08-02）——把卡片缩略图从 PNG 换成 WebP。

## 为什么

实测：一张卡片缩略图 **805~857KB PNG**，而卡片只有 309px 宽。应用中心一次首屏
23 张卡 ≈ 10.7MB；在 5Mbps 出口上，**一个用户冷启动要 17 秒**，三个人同时进就是
51 秒。而且越用越慢——每多一个应用就多 800KB。

同样的像素换成 WebP（实测本仓库真实缩略图）：

    1280x720  PNG  805KB  →  WebP q82  43KB   （小 19 倍，分辨率一个像素不减）
    720x1280  PNG  857KB  →  WebP q82  60KB   （小 14 倍）

## 三条做法都是抄成熟方案的，不是自己发明的

① **存派生图，不存原图**（thumbor / imgproxy 的核心思路）。原图只在生成期当设计
   参照用，用完即弃；库里留的那份只服务于卡片显示，那就该按显示需求存。
   顺带把库也瘦了——原来每行约 1MB base64。

② **按 Accept 头做格式协商**（thumbor / imgproxy / Next.js Image 都这么干）。
   存 WebP，客户端声明认 WebP 就直接给；不认就现场转回 PNG。WebP 覆盖率已经
   97%+，转码这条是给极老客户端和抓取工具留的，不是主路径。

③ **只换格式、不降分辨率**。这是刻意的保守：降到卡片尺寸能到 20KB（再小一倍），
   但那会引入"看着糊了"的风险，而 19 倍已经把带宽问题解决掉了。要再压的话，
   应该等有人真觉得 43KB 还大的时候再说。

## 质量取值

q=82。参照：Next.js Image 默认 75、thumbor 默认 80、imgproxy 默认 80。取 82 是
因为这些图是**界面截图**——大片纯色加细字，比照片更吃量化噪声，稍高一档更稳。
"""

from __future__ import annotations

from io import BytesIO
from typing import Optional

#: WebP 质量。见模块头注的取值理由。
WEBP_QUALITY = 82

#: 各格式的魔数。库里存量是 PNG，新写入是 WebP，取图时要按实际内容报
#: Content-Type——报错了浏览器可能拒绝渲染，也会让 CDN 缓存错类型。
_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


def sniff_media_type(data: bytes) -> str:
    """按内容判断媒体类型；认不出按 PNG（历史存量就是 PNG）。

    WebP 的魔数是 `RIFF....WEBP`——中间四字节是长度，所以不能整段前缀匹配。
    """
    if not data:
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    for magic, mime in _MAGIC:
        if data.startswith(magic):
            return mime
    return "image/png"


def _pillow() -> Optional[object]:
    """惰性导入：没装 Pillow 时整条压缩链路静默失效、原样存 PNG，
    不让一个"优化"变成新的失败面。"""
    try:
        from PIL import Image

        return Image
    except Exception:  # noqa: BLE001 — 没装/装坏都当"不可用"
        return None


def to_webp(data: bytes, *, quality: int = WEBP_QUALITY) -> bytes:
    """把一张图转成 WebP。**分辨率不动**，只换编码。

    fail-open 返回原始字节：转不动（Pillow 没装、格式不认、图损坏）时保持原样，
    卡片照常显示，只是没省下带宽。缩略图是增强项，绝不能因为压缩失败就没图。

    已经是 WebP 的直接返回——重复编码只会掉画质。
    """
    if not data:
        return data
    if sniff_media_type(data) == "image/webp":
        return data
    Image = _pillow()
    if Image is None:
        return data
    try:
        with Image.open(BytesIO(data)) as im:
            # 截图里可能带 alpha（圆角/阴影）。WebP 支持 alpha，直接留着；
            # 但调色板图（P 模式）要先转出来，否则 WebP 编码器会拒。
            if im.mode in ("P", "LA"):
                im = im.convert("RGBA")
            elif im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            buf = BytesIO()
            im.save(buf, format="WEBP", quality=quality, method=4)
            out = buf.getvalue()
    except Exception:  # noqa: BLE001 — 见 docstring
        return data
    # 反常情况下 WebP 可能比原图还大（极小图/已高度压缩）。那就别换了。
    return out if out and len(out) < len(data) else data


def to_png(data: bytes) -> bytes:
    """转回 PNG——只给不认 WebP 的客户端用（Accept 协商的兜底支）。

    同样 fail-open：转不动就原样返回，让客户端自己决定怎么办。
    """
    if not data or sniff_media_type(data) == "image/png":
        return data
    Image = _pillow()
    if Image is None:
        return data
    try:
        with Image.open(BytesIO(data)) as im:
            buf = BytesIO()
            im.save(buf, format="PNG", optimize=True)
            return buf.getvalue() or data
    except Exception:  # noqa: BLE001
        return data


def client_accepts_webp(accept_header: Optional[str]) -> bool:
    """客户端认不认 WebP。

    缺 Accept 头时按**认**处理：那基本是脚本/抓取工具，给它更小的那份没坏处；
    真不认的浏览器一定会明确列出自己能接的类型（`image/webp` 或 `*/*`）。
    """
    if not accept_header:
        return True
    lowered = accept_header.lower()
    return "image/webp" in lowered or "*/*" in lowered
