/**
 * autopilot-mirofish-card-diversity / Task 2.3 — RouteDecisionCard
 *
 * 独立的路线决策卡片组件，展示系统选择的路线决策结果。
 *
 * 视觉特征：
 * - 发光边框：shadow-[0_0_8px_rgba(99,102,241,0.15)]
 * - 顶部决策标签：text-[10px] uppercase tracking-wider
 * - 路线名称：text-xs font-medium
 * - 进入动画：animate-mirofish-scale-in
 */

import type { FC } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishRouteDecisionEntry } from "../mirofish-stream-types";

export interface RouteDecisionCardProps {
  entry: MiroFishRouteDecisionEntry;
  locale?: AppLocale;
}

/**
 * RouteDecisionCard — 路线决策卡片
 *
 * 使用发光边框突出决策结果，顶部展示决策标签，
 * 下方展示路线名称与描述。进入时使用 scale-in 动画。
 */
export const RouteDecisionCard: FC<RouteDecisionCardProps> = ({
  entry,
  locale = "zh-CN",
}) => {
  const titleText = blueprintCopy(entry.routeTitle, locale);
  const reasonText = entry.reason ? blueprintCopy(entry.reason, locale) : undefined;
  const kindTag = entry.routeKind ? `· ${entry.routeKind}` : "";
  const primary =
    locale === "zh-CN"
      ? `选择路线：${titleText}`
      : `Selected route: ${titleText}`;

  return (
    <div
      data-testid="mirofish-card-route-decision"
      data-tone={entry.tone}
      data-route-id={entry.routeId}
      data-route-kind={entry.routeKind ?? "unknown"}
      className="animate-mirofish-scale-in rounded-md px-3 py-2.5 bg-indigo-50 border border-indigo-200 shadow-[0_0_8px_rgba(99,102,241,0.15)]"
    >
      {/* 决策标签 */}
      <div className="text-[10px] uppercase tracking-wider text-indigo-600 font-bold">
        {locale === "zh-CN" ? "路线选定" : "ROUTE SELECTED"}
      </div>

      {/* 路线名称（兼容旧格式 "选择路线：{title}"） */}
      <div className="text-xs font-medium text-slate-800 mt-1">
        {primary}
      </div>

      {/* 描述 + 路线类型 */}
      {(reasonText || kindTag) && (
        <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">
          {[reasonText, kindTag].filter(Boolean).join("  ")}
        </div>
      )}
    </div>
  );
};

export default RouteDecisionCard;
