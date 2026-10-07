"""给控制面模型看图：工具把图交到这里，下一次问模型时附上，问完就丢。

⚠ 2026-10-07 全量扫描 24 份种子技能：data-visualization-discipline「走这道闸的前提：先把产物真的渲染出来看」
  （遮字截图 + 从截图上读出的关系），office-skills 的 pptx「QA bắt buộc」（转成图片 → 查重叠 / 溢出 / 对比度），
  sliderule 的截图核对——三份技能的**必查项**都要模型看渲染出来的图。平台上模型一张图都看不到：browser_view 的
  截图只落成结果卡缩略图（project_tools._keep_preview_snapshot），工作区里的 png 没有任何工具能读给它。
  这几步要么被跳过，要么被说成「已检查」。Claude Code 的 Read 读图片就是把图交给模型；这里补的是同一件原语。

为什么不进 messages：控制循环每一步都把 messages 整份存进检查点（rehearsal_control.checkpoint），
一张截图 base64 几百 KB，一回合存十几次。图只附在**紧接着的那一次**模型调用上，模型看完把看到的写进回复——
工具回执也这么告诉它；要再看就再调一次。工作器中途重启丢了图，模型照回执再调一次即可（增强类，§七 fail-open）。

叶子：只吃字节，不 import services 里的其它模块。
"""

from __future__ import annotations

import base64
import io
from contextvars import ContextVar
from typing import Any, Dict, List, Optional

MAX_IMAGE_BYTES = 8 * 1024 * 1024      # 读进来的原图上限；再大多半不是给人看的图
MAX_SIDE = 1600                         # 长边超过就缩：省 token，看排版够了
MAX_PENDING = 4                         # 一次最多附几张，多了只留最新的

_KINDS = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)

_PENDING: ContextVar[Optional[List[Dict[str, str]]]] = ContextVar("model_images_pending", default=None)


def sniff(data: bytes) -> Optional[str]:
    """按文件头认图片类型（不信后缀）。认不出 → None。"""
    head = bytes(data[:16])
    for magic, mime in _KINDS:
        if head.startswith(magic):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _shrink(data: bytes, mime: str) -> tuple[bytes, str, Optional[tuple[int, int]]]:
    """长边超过 MAX_SIDE 就等比缩成 PNG/JPEG。没装 Pillow 或解不开就原样（fail-open）。"""
    try:
        from PIL import Image
    except Exception:
        return data, mime, None
    try:
        with Image.open(io.BytesIO(data)) as img:
            size = img.size
            if max(size) <= MAX_SIDE:
                return data, mime, size
            img.thumbnail((MAX_SIDE, MAX_SIDE))
            out = io.BytesIO()
            if img.mode in ("RGBA", "LA", "P"):
                img.save(out, format="PNG", optimize=True)
                return out.getvalue(), "image/png", img.size
            img.convert("RGB").save(out, format="JPEG", quality=85)
            return out.getvalue(), "image/jpeg", img.size
    except Exception:
        return data, mime, None


def begin() -> Any:
    """一个控制循环开一份待附清单。返回 token，循环结束时 end(token)。"""
    return _PENDING.set([])


def end(token: Any) -> None:
    try:
        _PENDING.reset(token)
    except Exception:
        _PENDING.set(None)


def attach(data: Any, label: str) -> Dict[str, Any]:
    """交一张图，下一次问模型时附上。返回给工具回执用的摘要（不含图本身）。"""
    pending = _PENDING.get()
    if pending is None:
        return {"ok": False, "error": "image_viewer_unavailable"}
    if not isinstance(data, (bytes, bytearray)) or not data:
        return {"ok": False, "error": "image_empty"}
    if len(data) > MAX_IMAGE_BYTES:
        return {"ok": False, "error": "image_too_large", "bytes": len(data)}
    mime = sniff(bytes(data))
    if mime is None:
        return {"ok": False, "error": "not_an_image",
                "human": "这不是 PNG / JPEG / GIF / WEBP 图片。PDF、PPTX 先转成图片（比如每页导出 PNG）再看。"}
    shown, shown_mime, size = _shrink(bytes(data), mime)
    pending.append({"label": str(label or "图片")[:200],
                    "url": f"data:{shown_mime};base64," + base64.b64encode(shown).decode("ascii")})
    del pending[:-MAX_PENDING]
    return {"ok": True, "mime": mime, "bytes": len(data), **({"width": size[0], "height": size[1]} if size else {}),
            "note": "图附在你下一次思考的消息里，只给这一次：看完把看到的写下来；要再看就再调一次。"}


def take() -> List[Dict[str, str]]:
    """取走待附的图（取完就清空）。"""
    pending = _PENDING.get()
    if not pending:
        return []
    out = list(pending)
    pending.clear()
    return out


def image_message(images: List[Dict[str, str]]) -> Dict[str, Any]:
    """附图那一条 user 消息（OpenAI 兼容的 image_url 内容块）。只拼进这一次请求，不进 messages。"""
    parts: List[Dict[str, Any]] = [{"type": "text", "text": "下面是你刚才要看的图（宿主附上的，不是用户说的话）："}]
    for image in images:
        parts.append({"type": "text", "text": f"「{image['label']}」"})
        parts.append({"type": "image_url", "image_url": {"url": image["url"]}})
    return {"role": "user", "content": parts}


def refused_message(images: List[Dict[str, str]]) -> Dict[str, Any]:
    """模型这一发收不了图（比如换到了纯文本的兜底模型）：照实说，别让它以为自己看过了。"""
    names = "、".join(f"「{image['label']}」" for image in images)
    return {"role": "user", "content": f"（宿主说明：{names} 没能给你看——这一发的模型收不了图片。"
                                       "不要描述你没看到的内容；需要看图才能确认的检查，照实说没有看到。）"}
