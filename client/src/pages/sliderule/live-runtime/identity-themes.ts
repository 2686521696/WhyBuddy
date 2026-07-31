/**
 * identity-themes — 应用身份段的颜色解析（E40.2，2026-07-30 起改为路线丙）。
 *
 * 千人千面的第一层：同一套运行时组件，换一个种子色 = 完全不同的产品气质。
 * 此前是 8 套手写死板token（数值来自 tweakcn 预设 + 人工调校，2026-07-26
 * 起改成同读 identity_theme_presets.json 但仍是 96 个手挑色值）；2026-07-30
 * 起彻底改路：手工色值总数收到 1 个（见 ../../../lib/identity-palette.ts 的
 * FALLBACK_SEED），其余全部由 LLM 选的种子色经 material-color-utilities 的
 * HCT 算法（vendored 于 lib/mcu/）派生。
 *
 * appbundle.appIdentity.theme 那个 8 选 1 的分类字段（合法域在 @legal 的
 * identityThemes）仍然存在、仍然被 gate/repair 校验——那是没有改的另一套
 * 机制（分类标签，不是颜色来源）。但它不再对应任何色板：颜色只有两个
 * 来源，appIdentity.generatedTheme.seed（LLM 选的），或者两者都没有时的
 * FALLBACK_SEED。
 */

import legalDomains from "@legal";
import themePresets from "@identity-themes";

import {
  deriveIdentityPalette,
  fallbackIdentityPalette,
  type IdentityPalette,
} from "@/lib/identity-palette";

export type IdentityTheme = IdentityPalette;

/** 8 选 1 分类字段的合法域（@legal identityThemes）——仍然是 gate 校验的
 * 合法值集合，颜色解析不再读它，只在别处（生成契约/门/修复器）继续使用。 */
export const LEGAL_THEME_IDS: readonly string[] = legalDomains.identityThemes;

// 生成主题合格契约——与 Python identity_theme_gen.py（格式正则）、
// freeform_block.is_valid_generated_theme（使用判定）同读 presets JSON 里的
// generatedThemeContract，判定规则只此一处，不存在两端标准打架的窗口。
// 2026-07-30 起契约只剩 seed 一个必填字段。
const THEME_CONTRACT = themePresets.generatedThemeContract;
const HEX_RE = new RegExp(THEME_CONTRACT.hexPattern);

/** 生成的身份主题——LLM 只给种子色 + 气质标签，不再是 11 个字段。 */
export type GeneratedIdentityTheme = { label?: unknown; seed?: unknown };

/**
 * 从生成主题里取出可用的种子色。
 *
 * 除了读新契约的 seed 字段，还兼容一种旧数据：2026-07-30 之前生成的会话
 * 里，generatedTheme 是完整的 11 字段主题（没有 seed 字段，只有 primary）。
 * 这不是专门写的兼容层——deriveIdentityPalette 本身的定义就是"primary
 * 字段 = 原样保留的种子色"（见 identity-palette.ts），所以拿旧主题的
 * primary 当新种子色，语义上就是同一件事，不需要为存量会话写迁移脚本。
 */
function extractSeed(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const t = v as Record<string, unknown>;
  if (typeof t.seed === "string" && HEX_RE.test(t.seed)) return t.seed;
  if (typeof t.primary === "string" && HEX_RE.test(t.primary)) return t.primary;
  return undefined;
}

function extractLabel(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const label = (v as Record<string, unknown>).label;
  return typeof label === "string" ? label : "";
}

/**
 * 解析主题：generatedTheme 里能读出合法种子色就用它派生；读不出来（缺失/
 * 格式不对/生成失败后压根没写这个字段）就落回 FALLBACK_SEED 派生的中性
 * 色板。themeId（8 选 1 分类字段）不参与颜色决定——保留参数只是不动调用
 * 方的签名，函数体内不读它。
 */
export function resolveIdentityTheme(
  _themeId?: string,
  generatedTheme?: unknown
): IdentityTheme {
  const seed = extractSeed(generatedTheme);
  if (seed) {
    return deriveIdentityPalette(seed, {
      id: "generated",
      label: extractLabel(generatedTheme) || "自定义主题",
    });
  }
  return fallbackIdentityPalette();
}

/** 6 位十六进制转 rgba() 字符串——菜单 hover 态要跟主色调一层半透明叠色，
 * 不能像之前那样写死 rgba(255,255,255,0.08)：那个假设侧边栏永远是深色，
 * 生成主题给了浅色侧边栏时，hover 反馈基本看不见。非法输入原样返回，
 * 不抛错（调用方本来就该传合法 hex，这里只是防御）。 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 身份主题 → antd-mobile 的 CSS 变量。
 *
 * 换肤机制两边不是一套：antd v5 走 cssinjs token（ConfigProvider theme），
 * antd-mobile 走 CSS 变量（--adm-*）。所以 ConfigProvider 配好主色，手机档
 * 那些 antd-mobile 组件一个字都吃不到——实测过：生成主题是 #C2410C，
 * adm 按钮实际背景仍是 rgb(22,119,255)，也就是 antd-mobile 自带的默认蓝。
 * 每个生成应用的手机档主色都跟应用主题不搭。
 *
 * 只覆盖跟品牌色相关的几个，中性色（text/border/background）留给
 * antd-mobile 自己 —— 那套是按移动端可读性调过的，没必要跟着主题乱动。
 */
export function admThemeVars(theme: IdentityTheme): Record<string, string> {
  return {
    "--adm-color-primary": theme.primary,
    // 主色上的前景（Button color=primary 的文字、Toast 图标等）
    "--adm-color-text-light-solid": theme.primaryFg,
    // 主色的浅色底（选中项浅底、Tag 底色）—— 用主题自己的强调底，
    // 不用 antd-mobile 默认那个跟蓝色配的 #e7f1ff
    "--adm-color-wathet": theme.accentBg,
    // 徽标底色。默认是 --adm-color-highlight（红），那是"未读/紧急"的语义；
    // 我们挂在 TabBar 上的是**本页行数**（这页有 12 条数据），不是告警。
    // 红色数字会让人以为有 12 件事待处理。桌面侧栏那版本来就用的主题色浅底，
    // 这里跟齐。官方定制入口就是这个变量（见 badge.css 的 --color 链）。
    "--adm-badge-color": theme.primary,
  };
}
