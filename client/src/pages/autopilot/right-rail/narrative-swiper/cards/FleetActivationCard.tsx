/**
 * Autopilot 右栏底部叙事 Swiper — `<FleetActivationCard>` 子卡片
 *
 * 渲染车队激活信息：激活 chip + 动作摘要。
 * 数据来源为 `agentProgress` 派生的 NarrativeCard（source = 'fleet-activation'）。
 *
 * 对应 spec：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 3.3：每条 entry 映射成包含统一字段的 Narrative_Card
 *   - Requirement 3.5：每张卡以图标/角标标注 Card_Source
 *
 * 关键约束：
 * - 纯展示组件，不引入新 npm 依赖（Req 10.5）
 * - 不修改既有 FleetActivationLog 组件（Req 10.8）
 */

import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";

import type { NarrativeCard } from "../narrative-card-types";

// ─── Props ─────────────────────────────────────────────────────────────────

export interface FleetActivationCardProps {
  /** 归一化的 NarrativeCard 数据。 */
  card: NarrativeCard;
  /** 应用语言。 */
  locale: AppLocale;
}

// ─── Severity → chip 样式映射 ──────────────────────────────────────────────

const SEVERITY_CHIP_CLASS: Record<string, string> = {
  info: "bg-sky-100 text-sky-700 dark:bg-sky-800/30 dark:text-sky-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-800/30 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-800/30 dark:text-amber-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-800/30 dark:text-red-300",
};

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * FleetActivationCard — 车队激活子卡片
 *
 * 渲染激活 chip（带 severity 色调）+ 动作摘要文本。
 * 从 `card.headline` 取激活标题，`card.detail` 取动作摘要，
 * `card.severity` 决定 chip 色调。
 */
export const FleetActivationCard: FC<FleetActivationCardProps> = ({ card, locale }) => {
  const severity = card.severity ?? "info";
  const chipClass = SEVERITY_CHIP_CLASS[severity] ?? SEVERITY_CHIP_CLASS.info;
  const chipLabel = locale === "zh-CN" ? "激活" : "Activated";

  return (
    <div
      data-testid="narrative-card-fleet-activation"
      data-source={card.source}
      className="flex items-start gap-2.5 rounded-md border border-sky-200/50 bg-sky-50/30 px-3 py-2 dark:border-sky-700/30 dark:bg-sky-900/10"
    >
      {/* 激活 chip */}
      <span
        className={`mt-0.5 flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${chipClass}`}
      >
        {chipLabel}
      </span>

      {/* 标题 + 动作摘要 */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
          {card.headline}
        </p>
        {card.detail && (
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {card.detail}
          </p>
        )}
      </div>
    </div>
  );
};

export default FleetActivationCard;
