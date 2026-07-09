/**
 * Autopilot 右栏底部叙事 Swiper — `<RoleStatusCard>` 子卡片
 *
 * 渲染角色状态信息：头像 + 角色名 + 阶段标签。
 * 数据来源为 `rolePhases` 派生的 NarrativeCard（source = 'role-status'）。
 *
 * 对应 spec：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 3.3：每条 entry 映射成包含统一字段的 Narrative_Card
 *   - Requirement 3.5：每张卡以图标/角标标注 Card_Source
 *
 * 关键约束：
 * - 纯展示组件，不引入新 npm 依赖（Req 10.5）
 * - 不修改既有 RoleStatusStrip 组件（Req 10.8）
 */

import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";

import type { NarrativeCard } from "../narrative-card-types";

// ─── Props ─────────────────────────────────────────────────────────────────

export interface RoleStatusCardProps {
  /** 归一化的 NarrativeCard 数据。 */
  card: NarrativeCard;
  /** 应用语言。 */
  locale: AppLocale;
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * RoleStatusCard — 角色状态子卡片
 *
 * 渲染圆桌会议风格的角色状态：头像 + 角色名 + 当前阶段标签。
 * 从 `card.actorAvatar` 取头像，`card.headline` 取角色名，
 * `card.detail` 取阶段描述。
 */
export const RoleStatusCard: FC<RoleStatusCardProps> = ({ card, locale }) => {
  const avatarSrc = card.actorAvatar;
  const roleName = card.headline;
  const stageLabel = card.detail;

  return (
    <div
      data-testid="narrative-card-role-status"
      data-source={card.source}
      className="flex items-center gap-3 rounded-md border border-amber-200/50 bg-amber-50/30 px-3 py-2 dark:border-amber-700/30 dark:bg-amber-900/10"
    >
      {/* 头像 */}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-100 text-sm dark:bg-amber-800/40">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={roleName}
            className="h-full w-full object-cover"
          />
        ) : (
          <span aria-hidden="true">👤</span>
        )}
      </div>

      {/* 角色名 + 阶段标签 */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
          {roleName}
        </p>
        {stageLabel && (
          <span className="mt-0.5 inline-block rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-800/30 dark:text-amber-300">
            {locale === "zh-CN" ? `阶段：${stageLabel}` : `Stage: ${stageLabel}`}
          </span>
        )}
      </div>
    </div>
  );
};

export default RoleStatusCard;
