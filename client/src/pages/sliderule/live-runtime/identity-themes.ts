/**
 * identity-themes — 应用身份段的 8 套主题 token（E40.2）。
 *
 * 千人千面的第一层：同一套运行时组件，换一份 token = 完全不同的产品气质
 * （机制参照 tweakcn 的 design token 层，Apache-2.0，数值提炼自其预设并按企业
 * 应用调校：主色对比度达标、色相彼此拉开、radius 收敛到企业档）。
 * 主题 id 的合法域在 @legal（identityThemes）——门/修复器/生成契约同账，
 * parity 测试锁死这里的实现清单与账本一致。
 */

import legalDomains from "@legal";
import themePresets from "@identity-themes";

export interface IdentityTheme {
  id: string;
  /** 中文气质名（帮助文档/调试用） */
  label: string;
  /** 主色（按钮/选中态/品牌区） */
  primary: string;
  /** 主色 hover 加深 */
  primaryHover: string;
  /** 品牌方块渐变的浅端 */
  gradTo: string;
  /** 主色上的前景色 */
  primaryFg: string;
  /** 内容区底色 */
  contentBg: string;
  /** 强调底（选中菜单浅底/高亮块） */
  accentBg: string;
  /** 强调底上的前景 */
  accentFg: string;
  /** 图表序列色 */
  charts: [string, string, string];
  /** 侧边栏/顶栏底色（深色，按主题色调分别调校——此前 8 套主题全部复用 antd
   * 默认深蓝 #001529，是应用中心卡片"千人一面"的根因；侧栏选中态直接复用
   * primary/primaryFg，做法对齐 tweakcn 真实预设的 sidebar-primary 惯例）。 */
  sidebarBg: string;
  /** 侧边栏文字色（未选中态） */
  sidebarText: string;
}

/** 缺省主题：与历史渲染完全一致的品牌蓝（老模型/无身份段零变化）。 */
export const DEFAULT_THEME_ID: string = themePresets.defaultThemeId;

/** 2026-07-26 起 8 套预设不再在 TS 手写——与 Python 侧同读
 * slide-rule-python/services/data/identity_theme_presets.json（@identity-themes
 * alias 直读同一份文件；此前 Python freeform_block.py 手抄这份色板、"两边
 * 独立维护要记得同步"，现在物理上只有一份）。 */
const THEMES: Record<string, IdentityTheme> = Object.fromEntries(
  Object.entries(themePresets.themes).map(([id, theme]) => [
    id,
    theme as unknown as IdentityTheme,
  ])
);

/** 账本里声明的主题 id（parity 测试对照 THEMES 实现清单）。 */
export const LEGAL_THEME_IDS: readonly string[] = legalDomains.identityThemes;

// 生成主题合格契约——与 Python identity_theme_gen.py（格式正则）、
// freeform_block.is_valid_generated_theme（使用判定）同读 presets JSON 里的
// generatedThemeContract，判定规则只此一处，不存在两端标准打架的窗口。
const THEME_CONTRACT = themePresets.generatedThemeContract;
const HEX_RE = new RegExp(THEME_CONTRACT.hexPattern);
const GRADIENT_RE = new RegExp(THEME_CONTRACT.sidebarBgGradientPattern);
const GENERATED_THEME_HEX_KEYS: readonly string[] = THEME_CONTRACT.hexKeys;
const GENERATED_THEME_CHARTS_LENGTH: number = THEME_CONTRACT.chartsLength;

/** 生图驱动生成的身份主题（2026-07-24）——Python 侧 identity_theme_gen.py
 * 已经过 Pydantic 十六进制格式 + WCAG 对比度校验，这里仍然二次校验，不
 * 单方面信任上游（跟 FreeformNode 的"不单方面信任"是同一个原则）。 */
export type GeneratedIdentityTheme = Partial<IdentityTheme> & { charts?: unknown };

function isValidGeneratedTheme(v: unknown): v is IdentityTheme {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  for (const key of GENERATED_THEME_HEX_KEYS) {
    if (typeof t[key] !== "string" || !HEX_RE.test(t[key] as string)) return false;
  }
  if (
    typeof t.sidebarBg !== "string" ||
    !(HEX_RE.test(t.sidebarBg) || GRADIENT_RE.test(t.sidebarBg))
  ) {
    return false;
  }
  if (
    !Array.isArray(t.charts) ||
    t.charts.length !== GENERATED_THEME_CHARTS_LENGTH ||
    !t.charts.every((c) => typeof c === "string" && HEX_RE.test(c))
  ) {
    return false;
  }
  return true;
}

/** 解析主题：优先用生图生成的主题（校验通过才用），否则按 themeId 查 8 套
 * 预设，未知/缺省 → azure（老模型渲染零变化）。generatedTheme 校验不通过
 * 时静默降级到预设，不抛错、不让一套坏配色拖垮渲染。 */
export function resolveIdentityTheme(
  themeId?: string,
  generatedTheme?: unknown
): IdentityTheme {
  if (isValidGeneratedTheme(generatedTheme)) {
    return { ...generatedTheme, id: "generated" };
  }
  return THEMES[String(themeId || "").trim()] ?? THEMES[DEFAULT_THEME_ID];
}

/** 全部实现的主题（测试/图鉴用）。 */
export function allIdentityThemes(): IdentityTheme[] {
  return Object.values(THEMES);
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
