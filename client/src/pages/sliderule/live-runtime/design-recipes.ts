/**
 * design-recipes — Step 9 视觉配方 token（六套）。
 *
 * 和 identity-themes（8 套配色 identity.themeId）职责分开：配方只管密度/
 * 布局/深浅色开关，不碰主色——两者叠加使用（比如"湛蓝主题 + 深色监控配方"）。
 * 配方 id 的合法域在 schema_legal.DESIGN_RECIPES（Python 侧同账，Gate 校验）。
 *
 * 六套配方的密度/深色/圆角取值来自对一批真实产品原型截图的视觉聚类：
 * 宽松引导式工具、标准后台、内容卡片类、高密度监控类各是一档真实观察到
 * 的样式；深色监控、高对比无障碍是在此基础上的合理外推（原型里没有深色
 * 或高对比样例，但监控/无障碍场景确有需求）。
 */

import { theme as antdTheme } from "antd";

export type DesignRecipeDensity = "compact" | "standard" | "spacious";

export interface DesignRecipe {
  id: string;
  label: string;
  density: DesignRecipeDensity;
  /** 深色模式：canvas 底色与 antd darkAlgorithm 同时切换。 */
  dark: boolean;
  /** antd token.borderRadius（卡片/按钮/输入框统一圆角）。 */
  borderRadius: number;
  /** antd token.padding（卡片/表格内边距统一密度杠杆）。 */
  padding: number;
  /** 高对比：边框加深 + 字号略增，无障碍场景。 */
  highContrast: boolean;
}

export const DEFAULT_DESIGN_RECIPE_ID = "default";

const RECIPES: Record<string, DesignRecipe> = {
  default: {
    id: "default",
    label: "默认 · 跟随主题",
    density: "standard",
    dark: false,
    borderRadius: 6,
    padding: 16,
    highContrast: false,
  },
  "spacious-guided": {
    id: "spacious-guided",
    label: "宽松引导 · 分步工具",
    density: "spacious",
    dark: false,
    borderRadius: 10,
    padding: 20,
    highContrast: false,
  },
  "compact-dense": {
    id: "compact-dense",
    label: "紧凑密集 · 数据监控",
    density: "compact",
    dark: false,
    borderRadius: 4,
    padding: 12,
    highContrast: false,
  },
  "content-cards": {
    id: "content-cards",
    label: "内容卡片 · 创作知识",
    density: "standard",
    dark: false,
    borderRadius: 14,
    padding: 18,
    highContrast: false,
  },
  "dark-monitoring": {
    id: "dark-monitoring",
    label: "深色监控 · 运维大屏",
    density: "compact",
    dark: true,
    borderRadius: 4,
    padding: 12,
    highContrast: false,
  },
  "high-contrast": {
    id: "high-contrast",
    label: "高对比 · 无障碍",
    density: "standard",
    dark: false,
    borderRadius: 4,
    padding: 16,
    highContrast: true,
  },
  /**
   * 深底大圆角（2026-08-12 新增）。
   *
   * 用户拿一组参照图点名要这种观感：近黑画布、20px+ 圆角、巨数字配小标签、
   * 单一浓烈强调色只点在一两处。前面六套里没有一套是它——`dark-monitoring`
   * 虽然也是深色，但 `borderRadius: 4` 是运维大屏的硬朗方脸，跟这个正相反。
   *
   * 取值依据（照参照图量的）：卡片圆角 20~28px 取 20（antd 的 borderRadius 是
   * 基准值，实际卡片会在它之上再放大）；padding 20 对应"卡内宽松、卡间紧凑"
   * 那种呼吸感；density 用 standard 而不是 compact——参照图的密度不高，
   * 密的是**信息层级**不是间距。
   */
  "bold-dark": {
    id: "bold-dark",
    label: "深底大圆角 · 消费级",
    density: "standard",
    dark: true,
    borderRadius: 20,
    padding: 20,
    highContrast: false,
  },
};

/** 全部配方 id（parity 测试/图鉴用，顺序与 Python DESIGN_RECIPES 账本一致）。 */
export const DESIGN_RECIPE_IDS: readonly string[] = [
  "default",
  "spacious-guided",
  "compact-dense",
  "content-cards",
  "dark-monitoring",
  "high-contrast",
  "bold-dark",
];

/** 解析配方：未知/缺省 → default（老模型/无声明零变化）。 */
export function resolveDesignRecipe(recipeId?: string): DesignRecipe {
  return RECIPES[String(recipeId || "").trim()] ?? RECIPES[DEFAULT_DESIGN_RECIPE_ID];
}

/** 全部实现的配方（测试/图鉴用）。 */
export function allDesignRecipes(): DesignRecipe[] {
  return Object.values(RECIPES);
}

/** 配方 → antd theme.algorithm 组合（深色 + 紧凑可叠加）。 */
export function designRecipeAlgorithms(recipe: DesignRecipe, extraCompact: boolean) {
  const algorithms = [];
  if (recipe.dark) algorithms.push(antdTheme.darkAlgorithm);
  if (recipe.density === "compact" || extraCompact) {
    algorithms.push(antdTheme.compactAlgorithm);
  }
  return algorithms;
}

/** 深色配方的 canvas 底色（antd 暗色默认容器底，和 darkAlgorithm 派生的组件底色一致）。 */
export const DARK_CANVAS_BG = "#141414";
