"""palette_guard — 配色合规的机械防线。

此前色板约束**只写在 prompt 里**：主色、强调色、类别色都明明白白列了，还专门
写了「主题是暖橙系就不要通篇上蓝紫」。真跑一看，模型一字不差地干了那句话
警告的事——tangerine 主题的应用，主色 `#e05d38` 一次没出现，蓝色系占了 60%，
另外还自己发明了一套色板里没有的绿。参考图也给对了（整张橘橙），文字约束也
给对了，模型两个都没听，而**没有任何一层去查**。

这个模块就是那一层。两条规则，都在 OKLCh 里判——

R1 **色相合规**：每个非中性色的色相必须落在色板某个色相的 ±HUE_TOLERANCE 内。
   之所以只比色相不比整体色差：prompt 明确允许「含深浅/透明度变体」，
   `#fff0eb`（极浅橘底）跟主色的 ΔE 很大但它完全合法，用 ΔE 会把合法的浅色
   变体一起误杀。色相是"这是不是同一个色系"的那一维。

R2 **主色在场**：主色系的用量不得少于任何其他单一色相族。品牌色应该是用得最多
   的那一族——这条直接对着上面那个"主色 0 次、蓝色 24 次"的事故。

用 OKLCh 而不是 HSL：HSL 的色相在感知上不均匀（同样差 30° 在黄绿区和蓝紫区
是两回事），OKLab/OKLCh 是为感知均匀设计的，也是 CSS Color 4 与现代设计系统
的默认选择。实现走 coloraide（成熟库，含完整的 OKLab 转换与色差算法），
不自己手搓矩阵。

近中性色（chroma 很低的灰/白/黑）一律豁免：它们的色相是数值噪声，拿去比对
毫无意义——纯白的"色相"是 0°，判成"橘色系"纯属巧合。
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from coloraide import Color

__all__ = [
    "HUE_TOLERANCE",
    "NEUTRAL_CHROMA",
    "PaletteReport",
    "extract_hex_colors",
    "palette_report",
    "repair_colors",
    "snap_hex_to_palette",
]

_HEX_RE = re.compile(r"#[0-9a-fA-F]{6}\b")

#: 色相容差（度）。25° 是照真实样本标的：合法的深浅变体彼此差 0-3°（主色
#: `#e05d38` 36.4° 与其悬停态 `#c2410c` 38.4°），而跑偏那次自己发明的绿差了
#: 85-88°。25 留足了变体空间又拦得住"另起一个色系"。
HUE_TOLERANCE = 25.0

#: 低于这个 chroma 视为中性色（灰/白/黑/带色调的灰），豁免色相检查。
#:
#: 0.04 是照真实样本标的，并且**修正过一次**：一开始定 0.03，结果
#: `#7A869A`（石板灰蓝，chroma 0.0334）刚好落在线上方、被当成蓝色计入配比。
#: 那类带色调的灰在任何设计系统里都算中性（Tailwind 的 slate 整条色阶就是
#: 这个东西），把它算进"蓝色系用量"会让 R2 误判。真实样本里的暖白
#: `#FFF9F0` 是 0.014，纯灰 `#F5F5F5` 是 0.000，都在线下。
NEUTRAL_CHROMA = 0.04

#: 色相分族的桶宽（度）。R2 统计"哪个色系用得最多"时按这个粒度归并——
#: 不归并的话每个深浅变体都算一族，永远比不出谁占主导。
_FAMILY_BUCKET = 30.0


class PaletteReport:
    """一次配色体检的结果。`ok` 为真表示两条规则都过。"""

    def __init__(
        self,
        *,
        off_palette: list[tuple[str, float]],
        primary_uses: int,
        dominant_uses: int,
        dominant_hue: Optional[float],
        non_neutral: int,
    ) -> None:
        self.off_palette = off_palette
        self.primary_uses = primary_uses
        self.dominant_uses = dominant_uses
        self.dominant_hue = dominant_hue
        self.non_neutral = non_neutral

    @property
    def hue_ok(self) -> bool:
        return not self.off_palette

    @property
    def primary_ok(self) -> bool:
        # 一个非中性色都没有（纯灰白设计）时不苛求主色出场
        if self.non_neutral == 0:
            return True
        return self.primary_uses >= self.dominant_uses

    @property
    def ok(self) -> bool:
        return self.hue_ok and self.primary_ok

    def reask_message(self, palette: list[str], primary: str) -> str:
        """给模型的重问文案——只说事实和要求，不替它做设计决定。"""
        bits: list[str] = []
        if not self.hue_ok:
            listed = "、".join(f"{c}（偏离最近的色板色相 {int(d)}°）" for c, d in self.off_palette[:8])
            bits.append(
                f"这些颜色不在色板的色相范围内：{listed}。"
                f"色板只有这些色相可用：{'、'.join(palette)}（允许调深浅和透明度，"
                "但不能另起一个色系）。请把它们换成色板里的颜色。"
            )
        if not self.primary_ok:
            bits.append(
                f"整份设计里主色 {primary} 所在的色系只用了 {self.primary_uses} 处，"
                f"而另一个色系用了 {self.dominant_uses} 处——品牌主色应该是用得最多的那一族。"
                "请把主要的卡片底色/强调色/图标色改回主色系，其他色系只在真正需要"
                "区分类别的地方用。"
            )
        return "配色不符合这个应用的身份主题：\n" + "\n".join(f"- {b}" for b in bits)


def extract_hex_colors(payload: Any) -> list[str]:
    """从任意结构里把 #RRGGBB 全捞出来（含 linear-gradient 里的）。"""
    import json

    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return _HEX_RE.findall(text)


def _lch(hex_color: str) -> Optional[tuple[float, float, float]]:
    """→ (lightness, chroma, hue)。解析不了返回 None，不抛。"""
    try:
        c = Color(hex_color).convert("oklch")
    except Exception:  # noqa: BLE001 — 坏色值不能拖垮整条生成链
        return None
    hue = c["hue"]
    if hue != hue:  # NaN：无色相（纯灰）
        hue = 0.0
    return float(c["lightness"]), float(c["chroma"]), float(hue)


def _hue_gap(a: float, b: float) -> float:
    """色相的圆环距离（度）。"""
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def palette_report(
    colors: Iterable[str],
    palette: Iterable[str],
    primary: str,
) -> PaletteReport:
    """对一组颜色出体检报告。纯函数，不改任何东西。"""
    pal_hues: list[float] = []
    for p in palette:
        got = _lch(p)
        if got and got[1] >= NEUTRAL_CHROMA:
            pal_hues.append(got[2])
    primary_lch = _lch(primary)
    primary_hue = primary_lch[2] if primary_lch else 0.0

    off: list[tuple[str, float]] = []
    seen_off: set[str] = set()
    primary_uses = 0
    families: dict[float, int] = {}
    non_neutral = 0

    for raw in colors:
        got = _lch(raw)
        if not got:
            continue
        _l, chroma, hue = got
        if chroma < NEUTRAL_CHROMA:
            continue  # 中性色豁免
        non_neutral += 1
        if pal_hues:
            gap = min(_hue_gap(hue, ph) for ph in pal_hues)
            if gap > HUE_TOLERANCE and raw.lower() not in seen_off:
                seen_off.add(raw.lower())
                off.append((raw, gap))
        if _hue_gap(hue, primary_hue) <= HUE_TOLERANCE:
            primary_uses += 1
        bucket = round(hue / _FAMILY_BUCKET) * _FAMILY_BUCKET % 360.0
        families[bucket] = families.get(bucket, 0) + 1

    dominant_hue: Optional[float] = None
    dominant_uses = 0
    if families:
        dominant_hue, dominant_uses = max(families.items(), key=lambda kv: kv[1])

    return PaletteReport(
        off_palette=sorted(off, key=lambda t: -t[1]),
        primary_uses=primary_uses,
        dominant_uses=dominant_uses,
        dominant_hue=dominant_hue,
        non_neutral=non_neutral,
    )


def snap_hex_to_palette(hex_color: str, palette: Iterable[str]) -> str:
    """把一个颜色旋到最近的色板色相，**保留它自己的明度与彩度**。

    保 L/C 是有意的：模型用浅底色做卡片背景、用深色做文字，这些明暗关系是它
    的设计意图，纠偏只该改"色系"，不该把一张浅底卡片变成一块深色砖。

    中性色、解析不了的值、色板为空时原样返回——纠偏是修补，不是重画。
    """
    got = _lch(hex_color)
    if not got:
        return hex_color
    lightness, chroma, hue = got
    if chroma < NEUTRAL_CHROMA:
        return hex_color
    pal_hues = [h for h in (_lch(p) for p in palette) if h and h[1] >= NEUTRAL_CHROMA]
    if not pal_hues:
        return hex_color
    nearest = min((p[2] for p in pal_hues), key=lambda ph: _hue_gap(hue, ph))
    try:
        fixed = Color("oklch", [lightness, chroma, nearest])
        return fixed.convert("srgb").fit("srgb").to_string(hex=True).lower()
    except Exception:  # noqa: BLE001
        return hex_color


def repair_colors(
    payload: str,
    palette: Iterable[str],
    primary: str,
) -> tuple[str, int]:
    """机械纠偏：把跑到色板外的色相整体旋回来。返回 (新文本, 改了几种颜色)。

    只治 R1（色相跑偏）——R2 是配比问题，机械改配比等于替模型重做设计，
    宁可让它带着"主色用得不够多"上线，也不要凭空把 24 处蓝色刷成橘色。
    """
    report = palette_report(extract_hex_colors(payload), palette, primary)
    if report.hue_ok:
        return payload, 0
    fixed_count = 0
    out = payload
    for bad, _gap in report.off_palette:
        good = snap_hex_to_palette(bad, palette)
        if good.lower() == bad.lower():
            continue
        out = re.sub(re.escape(bad), good, out, flags=re.IGNORECASE)
        fixed_count += 1
    return out, fixed_count
