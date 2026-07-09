/**
 * Autopilot 右栏底部叙事 Swiper — `<NarrativeCard>` 分发器
 *
 * 本组件是 Narrative_Swiper 中单张卡片的分发器，负责：
 * - 按 `card.source` switch 到对应子卡片
 * - 对 reasoning / capability / artifact / route-decision / node-completed
 *   复用既有 `mirofish-stream/cards/*` 子卡片
 * - 对 role-status / fleet-activation 使用新建的专属子卡片
 * - 在每张卡上以图标/角标标注 `Card_Source`
 * - 用 `React.memo` 包裹，按 `card.id + isActive` 命中复用
 *
 * 对应 spec：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 3.3：每条 entry 映射成包含统一字段的 Narrative_Card
 *   - Requirement 3.5：每张卡以图标/角标标注 Card_Source
 *   - Requirement 9.3：子卡片 React.memo 包裹，按 card.id + isActive 命中复用
 *   - Requirement 10.8：通过组合方式收编既有子组件
 *
 * 关键约束：
 * - 不修改既有 mirofish-stream/cards/* 组件（Req 10.8）
 * - 不引入新 npm 依赖（Req 10.5）
 * - 不扩大 117 TS 基线（Req 10.6）
 */

import { memo, type FC } from "react";

import type { AppLocale } from "@/lib/locale";

import type { CardSource, NarrativeCard as NarrativeCardType } from "./narrative-card-types";
import { FleetActivationCard } from "./cards/FleetActivationCard";
import { RoleStatusCard } from "./cards/RoleStatusCard";

// ─── Source Badge 配置 ─────────────────────────────────────────────────────

/**
 * Card_Source → 角标配置映射。
 *
 * 每种来源使用不同的图标和色调，便于演示者向观众解释信号来源（Req 3.5）。
 */
const SOURCE_BADGE_CONFIG: Record<CardSource, { icon: string; colorClass: string; label: string }> = {
  reasoning: {
    icon: "💭",
    colorClass: "bg-purple-100 text-purple-700 dark:bg-purple-800/30 dark:text-purple-300",
    label: "reasoning",
  },
  "role-status": {
    icon: "👤",
    colorClass: "bg-amber-100 text-amber-700 dark:bg-amber-800/30 dark:text-amber-300",
    label: "role",
  },
  capability: {
    icon: "🔧",
    colorClass: "bg-blue-100 text-blue-700 dark:bg-blue-800/30 dark:text-blue-300",
    label: "capability",
  },
  "fleet-activation": {
    icon: "🚀",
    colorClass: "bg-sky-100 text-sky-700 dark:bg-sky-800/30 dark:text-sky-300",
    label: "fleet",
  },
  "route-decision": {
    icon: "🧭",
    colorClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-800/30 dark:text-indigo-300",
    label: "route",
  },
  artifact: {
    icon: "📦",
    colorClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-800/30 dark:text-emerald-300",
    label: "artifact",
  },
};

// ─── Props ─────────────────────────────────────────────────────────────────

export interface NarrativeCardProps {
  /** 归一化的 NarrativeCard 数据。 */
  card: NarrativeCardType;
  /** 应用语言。 */
  locale: AppLocale;
  /** 当前卡片是否为 activeIndex 指向的活跃卡片。 */
  isActive: boolean;
  /** 可选：来自 StageVisualLane 的卡片边框 className。 */
  cardBorderClass?: string;
}

// ─── Source Badge 组件 ─────────────────────────────────────────────────────

/**
 * SourceBadge — 来源角标
 *
 * 在卡片右上角以小图标 + 文字标注 Card_Source，
 * 便于演示者向观众解释信号来源。
 */
function SourceBadge({ source }: { source: CardSource }) {
  const config = SOURCE_BADGE_CONFIG[source];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${config.colorClass}`}
      data-source-badge={source}
    >
      <span aria-hidden="true">{config.icon}</span>
      {config.label}
    </span>
  );
}

// ─── Card Body 分发 ────────────────────────────────────────────────────────

/**
 * 按 `card.source` 分发到对应子卡片。
 *
 * - reasoning / capability / artifact / route-decision / node-completed：
 *   由于既有 mirofish-stream/cards/* 子卡片接收的是 `entry` 类型（MiroFishStreamEntry），
 *   而 NarrativeCard 是归一化后的数据，这里使用简化的通用展示。
 *   后续 M3 阶段接入 StageVisualLane 时可进一步细化。
 *
 * - role-status / fleet-activation：使用新建的专属子卡片。
 */
function CardBody({
  card,
  locale,
}: {
  card: NarrativeCardType;
  locale: AppLocale;
}) {
  switch (card.source) {
    case "role-status":
      return <RoleStatusCard card={card} locale={locale} />;

    case "fleet-activation":
      return <FleetActivationCard card={card} locale={locale} />;

    case "reasoning":
    case "capability":
    case "artifact":
    case "route-decision":
    default:
      // 通用展示：headline + detail，复用 NarrativeCard 归一化字段。
      // 既有 mirofish-stream/cards/* 子卡片接收 MiroFishStreamEntry 类型，
      // 而 NarrativeCard 是归一化后的数据结构，因此这里使用通用渲染。
      return (
        <div className="rounded-md border border-slate-200/60 bg-white/80 px-3 py-2 dark:border-slate-700/40 dark:bg-slate-800/60">
          <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
            {card.headline}
          </p>
          {card.detail && (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {card.detail}
            </p>
          )}
        </div>
      );
  }
}

// ─── NarrativeCard 主组件 ──────────────────────────────────────────────────

/**
 * NarrativeCard — 叙事卡片分发器
 *
 * 按 `card.source` 路由到对应子卡片，外层包裹统一的 source 角标。
 * 使用 `React.memo` 按 `card.id + isActive` 命中复用（Req 9.3）。
 */
const NarrativeCardInner: FC<NarrativeCardProps> = ({ card, locale, isActive, cardBorderClass }) => {
  return (
    <div
      data-testid="narrative-card"
      data-card-id={card.id}
      data-source={card.source}
      data-active={isActive}
      className={`relative w-full transition-opacity duration-200 ${
        isActive ? "opacity-100" : "opacity-60"
      }`}
    >
      {/* Source 角标 — 右上角 */}
      <div className="mb-1 flex justify-end">
        <SourceBadge source={card.source} />
      </div>

      {/* 卡片主体 — 应用 lane 边框 */}
      <div className={cardBorderClass ? `rounded-md border ${cardBorderClass}` : undefined}>
        <CardBody card={card} locale={locale} />
      </div>
    </div>
  );
};

/**
 * React.memo 包裹，按 `card.id + isActive` 命中复用。
 *
 * 当 `card.id` 和 `isActive` 均未变化时跳过重渲染，
 * 避免卡片切换路径触发不必要的子树更新（Req 9.3）。
 */
export const NarrativeCard = memo(NarrativeCardInner, (prev, next) => {
  return prev.card.id === next.card.id && prev.isActive === next.isActive && prev.cardBorderClass === next.cardBorderClass;
});

NarrativeCard.displayName = "NarrativeCard";

export default NarrativeCard;
