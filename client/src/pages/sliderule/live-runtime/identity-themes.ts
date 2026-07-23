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
export const DEFAULT_THEME_ID = "azure";

const THEMES: Record<string, IdentityTheme> = {
  azure: {
    id: "azure", label: "湛蓝 · 通用企业",
    primary: "#1677ff", primaryHover: "#0958d9", gradTo: "#69b1ff", primaryFg: "#ffffff",
    contentBg: "#f0f2f5", accentBg: "#e6f4ff", accentFg: "#0958d9",
    charts: ["#1677ff", "#69b1ff", "#003eb3"],
    sidebarBg: "#0f2138", sidebarText: "#c9d6e6",
  },
  forest: {
    id: "forest", label: "松绿 · 生产运营",
    primary: "#2e7d32", primaryHover: "#1b5e20", gradTo: "#81c784", primaryFg: "#ffffff",
    contentBg: "#f4f7f2", accentBg: "#e8f5e9", accentFg: "#1b5e20",
    charts: ["#2e7d32", "#558b2f", "#8bc34a"],
    sidebarBg: "#13241a", sidebarText: "#cbdccf",
  },
  graphite: {
    id: "graphite", label: "石墨 · 专业中性",
    primary: "#525252", primaryHover: "#3d3d3d", gradTo: "#9e9e9e", primaryFg: "#ffffff",
    contentBg: "#f0f0f0", accentBg: "#e5e5e5", accentFg: "#333333",
    charts: ["#606060", "#476780", "#909090"],
    sidebarBg: "#1f1f1f", sidebarText: "#d4d4d4",
  },
  tangerine: {
    id: "tangerine", label: "橘橙 · 消费活力",
    primary: "#e05d38", primaryHover: "#c2410c", gradTo: "#fdba74", primaryFg: "#ffffff",
    contentBg: "#f8fafc", accentBg: "#fff0eb", accentFg: "#b23c17",
    charts: ["#e05d38", "#f59e0b", "#3b82f6"],
    sidebarBg: "#271a15", sidebarText: "#e8d9d1",
  },
  violet: {
    id: "violet", label: "紫罗兰 · 创意智能",
    primary: "#7033ff", primaryHover: "#5b21b6", gradTo: "#c4b5fd", primaryFg: "#ffffff",
    contentBg: "#f7f7f8", accentBg: "#ede9fe", accentFg: "#5b21b6",
    charts: ["#7033ff", "#a78bfa", "#22d3ee"],
    sidebarBg: "#1d1633", sidebarText: "#d9d3ec",
  },
  amber: {
    id: "amber", label: "琥珀 · 财务审计",
    primary: "#d97706", primaryHover: "#b45309", gradTo: "#fcd34d", primaryFg: "#ffffff",
    contentBg: "#fffdf7", accentBg: "#fffbeb", accentFg: "#92400e",
    charts: ["#f59e0b", "#d97706", "#78716c"],
    sidebarBg: "#261d0e", sidebarText: "#e6dcc4",
  },
  clay: {
    id: "clay", label: "陶土 · 温暖人文",
    primary: "#c96442", primaryHover: "#a34a2e", gradTo: "#e7bba4", primaryFg: "#ffffff",
    contentBg: "#faf9f5", accentBg: "#f5e8df", accentFg: "#8d4a2f",
    charts: ["#c96442", "#b8a07a", "#6b8e6f"],
    sidebarBg: "#241812", sidebarText: "#e3d5c8",
  },
  indigo: {
    id: "indigo", label: "靛蓝 · 数据密集",
    primary: "#6366f1", primaryHover: "#4f46e5", gradTo: "#a5b4fc", primaryFg: "#ffffff",
    contentBg: "#f8fafc", accentBg: "#e0e7ff", accentFg: "#3730a3",
    charts: ["#6366f1", "#818cf8", "#38bdf8"],
    sidebarBg: "#171b38", sidebarText: "#d2d6f0",
  },
};

/** 账本里声明的主题 id（parity 测试对照 THEMES 实现清单）。 */
export const LEGAL_THEME_IDS: readonly string[] = legalDomains.identityThemes;

/** 解析主题：未知/缺省 → azure（老模型渲染零变化）。 */
export function resolveIdentityTheme(themeId?: string): IdentityTheme {
  return THEMES[String(themeId || "").trim()] ?? THEMES[DEFAULT_THEME_ID];
}

/** 全部实现的主题（测试/图鉴用）。 */
export function allIdentityThemes(): IdentityTheme[] {
  return Object.values(THEMES);
}
