/**
 * Autopilot 右栏底部叙事 Swiper — 6 个 Stage_Visual_Lane token
 *
 * 本文件定义每个 Stage 的视觉差异化配置，包括：
 * - `backgroundClass`：背景纹理 className（基于 Tailwind / OKLCH 冷灰板）
 * - `cardBorderClass`：卡片边框 className
 * - `enterVariants` / `exitVariants`：framer-motion 入退场 Variants
 * - `decorationIcon`：主装饰图标族 token（lucide-react 图标名）
 * - `dwellTimeMs`：可选 Dwell_Time 覆写
 *
 * 对应 spec：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 1.1：6 个 Stage 各自拥有独立视觉语境
 *   - Requirement 1.2：每个 Lane 包含背景纹理、装饰图标、入退场 motion
 *   - Requirement 1.3：全部派生自 OKLCH 冷灰板
 *   - Requirement 1.4：差异化集中在背景纹理、装饰图标、入退场 motion
 *   - Requirement 1.5：使用 lucide-react 内置图标
 *   - Requirement 1.6：preview lane 的 glow 不超过 glow-button 的 max
 *   - Requirement 1.7：stage 切换时 600ms 渐变过渡
 *   - Requirement 1.8：资源加载失败兜底（CSS class + lucide-react，零网络依赖）
 *   - Requirement 11.1：6 个 Lane 共用同一套字体与色板基底
 *   - Requirement 11.2：差异化集中在背景纹理、装饰图标、入退场 motion
 *   - Requirement 11.3：全部派生自 OKLCH 冷灰板
 *   - Requirement 11.4：preview lane 的 glow 不超过 glow-button 的 max
 *
 * 关键约束：
 * - 不引入新 npm 依赖（Req 10.5）
 * - 不扩大 117 TS 基线（Req 10.6）
 * - 使用 `lucide-react` 内置图标（Mail / Users / Radar / Library / PenTool / Spotlight）
 * - preview lane 的 glow `box-shadow` 不超过 `glow-button` 的 max（20px, 0.5 opacity）
 */

import type { Variants } from "framer-motion";

import type { Stage } from "./narrative-card-types";

// ─── StageVisualLane Interface ─────────────────────────────────────────────

/**
 * 单个 Stage 的视觉语境 token。
 *
 * 每个 Lane 描述该阶段在 NarrativeSwiper 中的背景、边框、入退场动效与装饰图标。
 */
export interface StageVisualLane {
  /** 所属 Stage 标识。 */
  stage: Stage;
  /** 中文 + 英文 i18n 描述键（用于 aria-label）。 */
  ariaLabelKey: string;
  /** 背景纹理 className（基于 Tailwind / 自定义 utility）。 */
  backgroundClass: string;
  /** 卡片边框语言 className。 */
  cardBorderClass: string;
  /** 入场 motion 配置（framer-motion Variants）。 */
  enterVariants: Variants;
  /** 退场 motion 配置。 */
  exitVariants: Variants;
  /** 主装饰图标族 token（lucide-react 图标名）。 */
  decorationIcon: string;
  /** Dwell_Time 覆写（ms），不写则用全局默认 5000。 */
  dwellTimeMs?: number;
}

// ─── Enter / Exit Variants ─────────────────────────────────────────────────

/** 基础 slide-up + fade 入场（input / spec_tree / spec_documents 共用）。 */
const baseEnterVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

/** 基础 slide-down + fade 退场。 */
const baseExitVariants: Variants = {
  exit: { opacity: 0, y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

/** clarification 阶段：对话气泡 scale + fade 入场。 */
const clarifyEnterVariants: Variants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: "easeOut" } },
};

/** clarification 阶段：shrink + fade 退场。 */
const clarifyExitVariants: Variants = {
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.25, ease: "easeIn" } },
};

/** route 阶段：slide-left + fade 入场。 */
const routeEnterVariants: Variants = {
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

/** route 阶段：slide-right + fade 退场。 */
const routeExitVariants: Variants = {
  exit: { opacity: 0, x: 16, transition: { duration: 0.25, ease: "easeIn" } },
};

/** preview 阶段：fade-in + subtle glow 入场。 */
const previewEnterVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.4, ease: "easeOut" } },
};

/** preview 阶段：fade-out + dim 退场。 */
const previewExitVariants: Variants = {
  exit: { opacity: 0, transition: { duration: 0.3, ease: "easeIn" } },
};

// ─── STAGE_VISUAL_LANES ────────────────────────────────────────────────────

/**
 * 6 个 Stage 的视觉 token 常量。
 *
 * 全部派生自 OKLCH 冷灰板（`--background` / `--accent` / `--muted`），
 * 差异化集中在背景纹理、装饰图标、入退场 motion。
 *
 * 设计规则（对应需求 1.3 / 11.2）：
 * - input：单据柜台（细横线纹理）
 * - clarification：圆桌会议（径向暖光）
 * - route：调度台（雷达扫描）
 * - spec_tree：图书馆（书脊竖线）
 * - spec_documents：写作工坊（纸纹）
 * - effect_preview：小剧场（暗场聚光）
 */
export const STAGE_VISUAL_LANES: Record<Stage, StageVisualLane> = {
  input: {
    stage: "input",
    ariaLabelKey: "narrativeSwiper.lane.input",
    backgroundClass:
      "bg-gradient-to-b from-slate-50 to-slate-100/80 dark:from-slate-900/60 dark:to-slate-800/40",
    cardBorderClass: "border-slate-200 dark:border-slate-700",
    enterVariants: baseEnterVariants,
    exitVariants: baseExitVariants,
    decorationIcon: "Mail",
  },
  clarification: {
    stage: "clarification",
    ariaLabelKey: "narrativeSwiper.lane.clarification",
    backgroundClass:
      "bg-gradient-to-b from-amber-50/30 to-slate-50 dark:from-amber-900/10 dark:to-slate-900/60",
    cardBorderClass: "border-amber-200/50 dark:border-amber-700/30",
    enterVariants: clarifyEnterVariants,
    exitVariants: clarifyExitVariants,
    decorationIcon: "Users",
  },
  route: {
    stage: "route",
    ariaLabelKey: "narrativeSwiper.lane.route",
    backgroundClass:
      "bg-gradient-to-b from-emerald-50/30 to-slate-50 dark:from-emerald-900/10 dark:to-slate-900/60",
    cardBorderClass: "border-emerald-200/60 dark:border-emerald-700/30",
    enterVariants: routeEnterVariants,
    exitVariants: routeExitVariants,
    decorationIcon: "Radar",
  },
  spec_tree: {
    stage: "spec_tree",
    ariaLabelKey: "narrativeSwiper.lane.specTree",
    backgroundClass:
      "bg-gradient-to-b from-slate-100/60 to-slate-50 dark:from-slate-800/50 dark:to-slate-900/60",
    cardBorderClass: "border-slate-300 dark:border-slate-600",
    enterVariants: baseEnterVariants,
    exitVariants: baseExitVariants,
    decorationIcon: "Library",
  },
  spec_documents: {
    stage: "spec_documents",
    ariaLabelKey: "narrativeSwiper.lane.specDocuments",
    backgroundClass:
      "bg-gradient-to-b from-stone-50/50 to-slate-50 dark:from-stone-900/10 dark:to-slate-900/60",
    cardBorderClass: "border-slate-200 dark:border-slate-700",
    enterVariants: baseEnterVariants,
    exitVariants: baseExitVariants,
    decorationIcon: "PenTool",
  },
  effect_preview: {
    stage: "effect_preview",
    ariaLabelKey: "narrativeSwiper.lane.effectPreview",
    backgroundClass:
      "bg-gradient-to-b from-violet-50/20 to-slate-50 dark:from-slate-950/80 dark:to-slate-900/60",
    cardBorderClass: "border-violet-200/40 dark:border-violet-700/30",
    enterVariants: previewEnterVariants,
    exitVariants: previewExitVariants,
    decorationIcon: "Spotlight",
    dwellTimeMs: 6000,
  },
} as const;
