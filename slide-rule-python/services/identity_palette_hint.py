"""identity_palette_hint — 种子色 → 提示色板（OKLCh 近似，2026-07-30）。

## 这是什么，为什么不是权威实现

真正渲染给用户看的色板只有一处权威实现：前端 `client/src/lib/identity-palette.ts`
的 `deriveIdentityPalette`（用 vendored 的 material-color-utilities，HCT/CAM16
空间派生）。Python 这边不重复实现它——`coloraide` 8.10 不支持 HCT/CAM16
（查过 `Color.CS_MAP`，没有 `hct`/`cam16` 条目），要么手搓约 300 行色彩科学，
要么就近似。既然这个模块的两个消费方（`freeform_block.py` 的 prompt 色板
提示、`palette_guard` 的色相校验参照色）**只关心色相是否一致**、不关心
色调数值跟前端渲染是否逐位精确对齐，就没必要为了数值精确去搬一套 HCT。

这里用 `coloraide` 已经具备的 OKLCh（同样是感知均匀空间，`palette_guard.py`
自己也在用）做同一套"色相不动、明度/彩度按规则挪"的近似派生——常数（tone
表、hover/渐变的偏移量、图表色相旋转量）逐项照抄前端的 HCT tone（0-100）
换算成 OKLCh lightness（0-1，除以 100），色相旋转量原样照搬（旋转角度跟
色彩空间无关）。两边测的不是同一把尺，但方向和意图完全对齐。

## seed 缺失时的兜底

`FALLBACK_SEED` 必须与前端 identity-palette.ts 的同名常量同一个值——不是
因为两边必须像素级一致（本来就不要求），而是"没有任何身份色可用"这件事
两端应该达成同一个判断，而不是各自编一个不同的兜底色。
"""

from __future__ import annotations

import re
from typing import Any

from coloraide import Color

__all__ = ["FALLBACK_SEED", "derive_prompt_palette"]

#: 与 client/src/lib/identity-palette.ts 的 FALLBACK_SEED 同一个值。
FALLBACK_SEED = "#5b6b7c"

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# HCT tone（0-100）→ OKLCh lightness（0-1）的换算：除以 100。逐项抄自
# identity-palette.ts 的 TONE 表。
_TONE = {
    "accentBg": 0.94,
    "accentFg": 0.32,
    "contentBg": 0.97,
    "sidebarBg": 0.22,
    "sidebarText": 0.92,
}
# 2026-07-30：跟前端 identity-palette.ts 同步调轻（人工视觉核对反馈"整体
# 偏重"）——hover/渐变深度收窄，图表色调亮、彩度下限降低并加了上限。
_HOVER_DELTA = -0.06  # HCT -6 / 100
_GRAD_DELTA = -0.14  # HCT -14 / 100
_GRAD_HUE_SHIFT = 12.0
_CHART_HUE_SHIFTS = (0.0, 62.0, 145.0, 210.0, 285.0, 330.0)
_CHART_LIGHTNESS = 0.58  # HCT tone 58 / 100
# 图表色相的彩度下限/上限——OKLCh 尺度下的量级估计，不追求精确复刻前端
# TonalPalette 的 HCT 尺度数值，只要方向一致（下限降低、封了上限）。
_CHART_CHROMA_FLOOR = 0.07
_CHART_CHROMA_CEIL = 0.16
# 强调浅底/强调字的彩度打七折，跟前端 ACCENT_CHROMA_SCALE 同一个值——
# 全彩度铺在大面积浅底上比想要的"水洗"质感重得多。
_ACCENT_CHROMA_SCALE = 0.7


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _to_hex(lightness: float, chroma: float, hue: float) -> str:
    color = Color("oklch", [_clamp01(lightness), max(0.0, chroma), hue % 360.0])
    return color.convert("srgb").fit("srgb").to_string(hex=True).lower()


def _foreground_for(lightness: float) -> str:
    """底色 tone < 60（OKLCh lightness < 0.6）用白字，跟前端同一条判据。"""
    return "#ffffff" if lightness < 0.6 else "#1f1f1f"


def derive_prompt_palette(seed_hex: str, *, id_: str = "generated", label: str = "") -> dict[str, Any]:
    """种子色 → 提示色板（跟前端 IdentityPalette 同形状，供 prompt 拼接/
    palette_guard 参照色使用）。非法种子色落回 FALLBACK_SEED，不抛错——
    这条链路跟整个 experience 层一样是 fail-open 的。
    """
    seed = seed_hex if isinstance(seed_hex, str) and _HEX_RE.match(seed_hex) else FALLBACK_SEED
    seed = seed.lower()
    oklch = Color(seed).convert("oklch")
    hue = oklch["hue"]
    if hue != hue:  # NaN：无色相（纯灰种子）
        hue = 0.0
    chroma = float(oklch["chroma"])
    lightness = float(oklch["lightness"])
    neutral_chroma = chroma * 0.2  # 与前端同一条 scheme_cmf.ts 规则：中性色带种子色相、彩度压两成

    grad_hue = (hue + _GRAD_HUE_SHIFT) % 360.0

    charts = []
    for shift in _CHART_HUE_SHIFTS:
        if shift == 0.0:
            charts.append(seed)  # 第一条必须是主色本身，理由同前端注释
        else:
            chart_chroma = min(max(chroma, _CHART_CHROMA_FLOOR), _CHART_CHROMA_CEIL)
            charts.append(_to_hex(_CHART_LIGHTNESS, chart_chroma, hue + shift))

    accent_chroma = chroma * _ACCENT_CHROMA_SCALE

    return {
        "id": id_,
        "label": label or "",
        "primary": seed,
        "primaryHover": _to_hex(_clamp01(lightness + _HOVER_DELTA), chroma, hue),
        "gradTo": _to_hex(_clamp01(lightness + _GRAD_DELTA), chroma, grad_hue),
        "primaryFg": _foreground_for(lightness),
        "contentBg": _to_hex(_TONE["contentBg"], neutral_chroma, hue),
        "accentBg": _to_hex(_TONE["accentBg"], accent_chroma, hue),
        "accentFg": _to_hex(_TONE["accentFg"], accent_chroma, hue),
        "charts": charts,
        "sidebarBg": _to_hex(_TONE["sidebarBg"], neutral_chroma, hue),
        "sidebarText": _to_hex(_TONE["sidebarText"], neutral_chroma, hue),
    }
