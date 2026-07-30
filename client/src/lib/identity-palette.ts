/**
 * 身份色板派生：**一个种子色 → 完整的 12 个字段**（2026-07-30）。
 *
 * ## 这件事之前是怎么做的、为什么要换
 *
 * 之前 8 套预设主题的 12 个字段全是手挑的（8 × 12 = 96 个写死的十六进制），
 * 而生成主题那条路也只是"生图取一个主色、其余 11 个照手推的规则算"。两个问题：
 *
 *  1. **中性底色的色相是拍的**。`contentBg #f0f2f5` 这种灰在橘色主题里显脏，
 *     因为它本该带一点主色的色相。Radix 是靠人工调了 warm/cool 两套灰解决，
 *     我们连那个都没有。
 *  2. **一格对比度保证都没有**。深色侧栏上的文字、浅底上的强调色，能不能读
 *     全靠肉眼过。
 *
 * 现在改成：LLM 只给**一个种子色**（它读 prompt 里的行业与调性来定），
 * 其余全部由 MCU 的 HCT / TonalPalette 算出来。手工色值从 96 个降到 1 个
 * （FALLBACK_SEED，见下）。
 *
 * ## 派生规则抄自哪里
 *
 * material-color-utilities 的 `scheme/scheme_cmf.ts`（vendored 子集见 ./mcu）：
 *
 *     primaryPalette   = fromHueAndChroma(h, c)
 *     secondaryPalette = fromHueAndChroma(h, c * 0.5)
 *     tertiaryPalette  = fromHueAndChroma(h, c * 0.75)
 *     neutralPalette   = fromHueAndChroma(h, c * 0.2)   ← 关键那一行
 *
 * 最后一行是整件事的支点：**中性色用主色的色相、彩度压到两成**。绿色应用的
 * 灰会偏绿、橘色应用的灰会偏暖——这正是手挑灰永远挑不准的那个量。
 *
 * MCU 的 `scheme/*` 与 `dynamiccolor/*` 刻意没 vendor：那是 Material Design 3
 * 自己的角色命名（primaryContainer / onSurfaceVariant …），跟 antd 的 token
 * 命名对不上，硬套只会多一层翻译。这里只借"种子色 → 色阶"这块地基，
 * 角色映射按**我们自己的 12 个字段**在下面做。
 */

import { Hct } from "./mcu/hct/hct";
import { TonalPalette } from "./mcu/palettes/tonal_palette";

/** 与 identity_theme_presets.json 的单套主题同形（消费方不用改）。 */
export interface IdentityPalette {
  id: string;
  label: string;
  primary: string;
  primaryHover: string;
  gradTo: string;
  primaryFg: string;
  contentBg: string;
  accentBg: string;
  accentFg: string;
  charts: string[];
  sidebarBg: string;
  sidebarText: string;
}

/**
 * 唯一一个手工色值。
 *
 * 为什么还留一个：整个体验层是 fail-open 的（ADR / 架构图：任一步失败静默降级，
 * **绝不拦闭环发布**）。生图挂了、视觉取色返回不合法、网关超时——这些时候必须
 * 还有东西可用。删掉最后的兜底等于把 fail-open 改成 fail-closed，那是另一个
 * 决定，不能顺手做掉。
 *
 * 但它**只是个种子色**，不是一套手写主题：兜底同样走下面这条派生管道，
 * 出来的 12 个字段跟正常路径同一套算法。手工定义的色值总数 = 1。
 *
 * 取值是中性偏蓝的石板灰——不带明显行业倾向，降级时不会让人误以为"这个应用
 * 的品牌色就是这个"。
 */
export const FALLBACK_SEED = "#5b6b7c";

/** tone 取值表。都在 0~100，light 档。 */
const TONE = {
  /** 强调浅底：主色系高 tone，够浅但仍看得出色相 */
  accentBg: 94,
  /** 强调浅底上的文字 */
  accentFg: 32,
  /** 内容区底色：中性色系接近白 */
  contentBg: 97,
  /** 深色侧栏 */
  sidebarBg: 22,
  /** 侧栏文字 */
  sidebarText: 92,
} as const;

/**
 * 主色系上做 hover：往**更深**走一档。
 *
 * 不用"更浅"：浅色底上的按钮 hover 变浅会看起来像失效（disabled 的通行视觉
 * 就是变浅）。antd 自己的 colorPrimaryHover 也是往深走。
 */
const HOVER_TONE_DELTA = -8;
/** 渐变终点：再深一档 + 色相微旋，避免纯明度渐变显得脏 */
const GRAD_TONE_DELTA = -18;
const GRAD_HUE_SHIFT = 12;

/**
 * 图表分类色的色相旋转量。
 *
 * 分类色要**彼此可辨**，所以按色相环大跨度分开；但第一个必须是主色本身，
 * 否则图表跟应用的身份色脱节（这条是实测教训：色板合规校验 R2 就是在查
 * "主色用量不得少于任何其他色系"，图表不带主色最容易触发它）。
 *
 * 只旋色相不动 tone/chroma：同 tone 的分类色在一起才不会有"某一条特别跳"。
 */
const CHART_HUE_SHIFTS = [0, 62, 145, 210, 285, 330];
const CHART_TONE = 48;

const hex = (argb: number): string =>
  `#${(argb & 0x00ffffff).toString(16).padStart(6, "0")}`;

/**
 * 前景色选黑还是白。
 *
 * MCU 的 tone 本身就是感知亮度（L*），所以判据可以很简单：tone < 60 的底色
 * 上用白字。60 是 M3 的惯例分界，不是我拍的——它对应 sRGB 上大约 4.5:1 的
 * 对比度拐点。
 */
const foregroundFor = (tone: number): string => (tone < 60 ? "#ffffff" : "#1f1f1f");

export interface DeriveOptions {
  /** 主题 id（透传，不参与计算） */
  id?: string;
  /** 人看的标签（透传） */
  label?: string;
}

/**
 * 种子色 → 12 个字段。**纯函数、确定性**：同一个种子色永远出同一套色板。
 *
 * 种子色不合法（空串、非 hex、带 alpha 等）时落回 FALLBACK_SEED，不抛错
 * ——这条链路的纪律是 fail-open。
 */
export function deriveIdentityPalette(
  seed: string,
  opts: DeriveOptions = {}
): IdentityPalette {
  const argb = parseHexToArgb(seed) ?? parseHexToArgb(FALLBACK_SEED)!;
  const src = Hct.fromInt(argb);

  const primaryP = TonalPalette.fromHueAndChroma(src.hue, src.chroma);
  // ← scheme_cmf.ts 的那一行：中性色带主色色相、彩度压两成
  const neutralP = TonalPalette.fromHueAndChroma(src.hue, src.chroma * 0.2);

  const primaryTone = src.tone;
  const hoverTone = clampTone(primaryTone + HOVER_TONE_DELTA);
  const gradTone = clampTone(primaryTone + GRAD_TONE_DELTA);
  const gradP = TonalPalette.fromHueAndChroma(
    (src.hue + GRAD_HUE_SHIFT + 360) % 360,
    src.chroma
  );

  return {
    id: opts.id ?? "generated",
    label: opts.label ?? "",
    // 主色**原样保留**：那是 LLM 为这个应用选的身份色，不能被算法改掉
    primary: hex(argb),
    primaryHover: hex(primaryP.tone(hoverTone)),
    gradTo: hex(gradP.tone(gradTone)),
    primaryFg: foregroundFor(primaryTone),
    contentBg: hex(neutralP.tone(TONE.contentBg)),
    accentBg: hex(primaryP.tone(TONE.accentBg)),
    accentFg: hex(primaryP.tone(TONE.accentFg)),
    charts: CHART_HUE_SHIFTS.map(shift =>
      shift === 0
        ? hex(argb) // 第一条必须是主色本身（见 CHART_HUE_SHIFTS 的说明）
        : hex(
            TonalPalette.fromHueAndChroma(
              (src.hue + shift) % 360,
              Math.max(src.chroma, 36)
            ).tone(CHART_TONE)
          )
    ),
    sidebarBg: hex(neutralP.tone(TONE.sidebarBg)),
    sidebarText: hex(neutralP.tone(TONE.sidebarText)),
  };
}

function clampTone(t: number): number {
  return Math.min(100, Math.max(0, t));
}

/** 只认 #rgb / #rrggbb。带 alpha 或格式不对一律返回 null（由调用方兜底）。 */
export function parseHexToArgb(value: string): number | null {
  const s = String(value ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  let r: number;
  let g: number;
  let b: number;
  if (s.length === 3) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
  } else if (s.length === 6) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
  } else {
    return null;
  }
  return (0xff << 24) | (r << 16) | (g << 8) | b;
}

/** 兜底色板。降级路径与正常路径走同一条派生管道（见 FALLBACK_SEED）。 */
export function fallbackIdentityPalette(): IdentityPalette {
  return deriveIdentityPalette(FALLBACK_SEED, { id: "fallback", label: "中性 · 降级" });
}
