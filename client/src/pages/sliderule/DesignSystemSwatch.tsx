/**
 * 设计系统色块：一个圆里切四段真实派生色。
 *
 * ⚠ 2026-08-25 用户裁决：作曲家上「没选是图标、选了是多色色块」。所以这里
 *   **不画单色圆点**——单色圆点看不出这套系统长什么样，四段色才能一眼分辨
 *   「森野」和「墨线」。Stitch / TRAE 的设计系统条目也都是多色块。
 *
 * ⚠ 色值走 `deriveIdentityPalette`（MCU / HCT），也就是**真正渲染时用的那份**，
 *   不另外近似一套。色块和真机颜色对不上的话，用户按色块选完会觉得被骗——
 *   而这种不一致只有把两边摆在一起看才发现得了。
 */
import React from "react";

import { deriveIdentityPalette } from "@/lib/identity-palette";

export function designSystemSwatchColors(seed: string): string[] {
  const p = deriveIdentityPalette(seed);
  /**
   * 同色相的深 → 浅四档。
   *
   * ⚠ 2026-08-25：第一版取了 `sidebarBg`，真机上发现**浅色模式下它三套都是
   *   `#ffffff`** —— 白色那一格毫无区分度，色块看起来像个半圆。选色块的格子
   *   不能只按"字段名听着不一样"挑，得看实际值在几套系统之间到底分不分得开。
   *
   * 现在这四档全部来自 deriveIdentityPalette，也就是**真正渲染用的那份**，
   * 不另算近似色：色块和真机颜色对不上的话，用户按色块选完会觉得被骗。
   */
  return [p.gradTo, p.primary, p.accentBg, p.contentBg];
}

export function DesignSystemSwatch({
  seed,
  size = 14,
  className = "",
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const [a, b, c, d] = designSystemSwatchColors(seed);
  return (
    <span
      aria-hidden
      data-testid="sliderule-design-swatch"
      className={`inline-block shrink-0 rounded-full ring-1 ring-black/10 ${className}`}
      style={{
        width: size,
        height: size,
        // conic 四等分：比四个绝对定位的扇形省一层 DOM，且缩放到 14px 时
        // 边界仍然干净（绝对定位那版在小尺寸下会露出反锯齿缝）。
        background: `conic-gradient(${a} 0deg 90deg, ${b} 90deg 180deg, ${c} 180deg 270deg, ${d} 270deg 360deg)`,
      }}
    />
  );
}
