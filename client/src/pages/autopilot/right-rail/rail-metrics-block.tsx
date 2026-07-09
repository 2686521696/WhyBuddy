/**
 * Rail bottom metrics block — Spec 5 布局校准(2026-05-11)
 *
 * 对应需求:把原本挂在 <AutopilotMissionHud>(3D 场景右上角浮层) 的 4 个指标卡
 * (3D 场景 / AgentCrewFabric / RouteSet / 证据)搬到 <AutopilotRightRail> 底部,
 * 让 HUD 浮层仅保留主标题 + 摘要叙事,避免场景右上角遮挡 3D 画面。
 *
 * 硬性约束:
 * - 不修改 Spec 1 冻结的 `AutopilotRightRailProps` 契约;所有数据直接从已有 props 派生
 * - 不依赖 `AutopilotRoutePage.tsx` 内部 helper(避免循环依赖);内联最小 `MetricBox`
 *   与 `countLabel` / `readRoleStateCount` 等效函数,样式与原版 MetricBox 保持一致
 * - 所有 stage 都渲染(Q3 选 a):不局限于 fabric;非 fabric 阶段仅数据占位不同
 */

import type { FC } from "react";

import { useMirofishTheme } from "@/hooks/useMirofishTheme";
import type { AppLocale } from "@/lib/locale";
import type {
  BlueprintCapabilityEvidence,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type {
  BlueprintAgentCrewSnapshot,
  BlueprintEffectPreviewSnapshot,
} from "@/lib/blueprint-api";
import { cn } from "@/lib/utils";

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/**
 * 可复数标签助手。与 `AutopilotRoutePage.tsx` 中的 `countLabel` 语义保持一致,
 * 但为避免跨文件循环依赖,在本文件内独立实现。
 */
function countLabel(
  locale: AppLocale,
  count: number,
  zh: string,
  enSingular: string,
  enPlural: string,
): string {
  if (locale === "zh-CN") {
    return `${count} ${zh}`;
  }
  return `${count} ${count === 1 ? enSingular : enPlural}`;
}

function readRoleStateCount(
  agentCrew: BlueprintAgentCrewSnapshot | null,
  state: string,
): number {
  if (!agentCrew) {
    return 0;
  }
  const agents = (agentCrew as unknown as { agents?: { state?: string }[] })
    .agents;
  if (!Array.isArray(agents)) {
    return 0;
  }
  return agents.filter(agent => agent?.state === state).length;
}

/**
 * 极简 MetricBox 样式,与 `AutopilotRoutePage.tsx` 的 `MetricBox` 视觉一致
 * (label 小 + value 大 + tone 着色)。dark 模式适配 rail 容器的深色语义。
 */
function MetricBox({
  label,
  value,
  tone = "neutral",
  dark = false,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn";
  dark?: boolean;
}) {
  const isMirofish = useMirofishTheme();

  if (isMirofish) {
    return (
      <div
        data-mf-card
        className="min-w-0 border border-[--mf-color-border] bg-[--mf-color-bg] px-3 py-2"
      >
        <div className="truncate font-[family-name:var(--mf-font-mono)] text-[10px] font-bold uppercase tracking-widest opacity-70">
          {label}
        </div>
        <div className="mt-1 truncate font-[family-name:var(--mf-font-mono)] text-sm font-bold">
          {value}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 rounded-[8px] border px-3 py-2",
        dark
          ? tone === "good"
            ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"
            : tone === "warn"
              ? "border-amber-300/20 bg-amber-400/10 text-amber-50"
              : "border-white/10 bg-white/5 text-white"
          : tone === "good"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-white text-slate-700",
      )}
    >
      <div className="truncate text-[10px] font-black uppercase tracking-normal opacity-70">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black">{value}</div>
    </div>
  );
}

export interface RailMetricsBlockProps {
  locale: AppLocale;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  /**
   * rail 的 scroll container 是浅色背景;默认 `dark=false` 走浅色版本 MetricBox。
   * 如果未来 rail 底部挂到深色浮层,可传 `dark` 切换。
   */
  dark?: boolean;
}

/**
 * <AutopilotRightRail> 底部的 4 指标卡 block。
 *
 * 渲染顺序与原 HUD 版本保持一致:3D 场景 / AgentCrewFabric / RouteSet / 证据。
 * 2 列网格 + 紧凑间距,视觉与 HUD 版本等效。
 */
export const RailMetricsBlock: FC<RailMetricsBlockProps> = props => {
  const {
    locale,
    routeSet,
    selection,
    specTree,
    agentCrew,
    effectPreviews,
    capabilityEvidence,
    dark = false,
  } = props;

  const preview = effectPreviews[0] ?? null;
  const activeRoles = readRoleStateCount(agentCrew, "active");
  const reviewingRoles = readRoleStateCount(agentCrew, "reviewing");

  return (
    <div
      className="grid grid-cols-4 gap-2 border-t border-border bg-background/95 px-3 py-3"
      data-testid="autopilot-right-rail-metrics"
    >
      <MetricBox
        label={t(locale, "3D 场景", "3D scene")}
        value={
          preview?.runtimeProjection?.sceneSnapshotId ||
          (specTree
            ? countLabel(locale, specTree.nodes.length, "个节点", "node", "nodes")
            : t(locale, "待同步", "Pending"))
        }
        tone={specTree ? "good" : "neutral"}
        dark={dark}
      />
      <MetricBox
        label="AgentCrewFabric"
        value={
          agentCrew
            ? t(
                locale,
                `${activeRoles} 活跃 / ${reviewingRoles} 评审`,
                `${activeRoles} active / ${reviewingRoles} reviewing`,
              )
            : t(locale, "待初始化", "Pending")
        }
        tone={agentCrew ? "good" : "neutral"}
        dark={dark}
      />
      <MetricBox
        label="RouteSet"
        value={
          selection
            ? t(locale, "已选择", "Selected")
            : routeSet
              ? countLabel(
                  locale,
                  routeSet.routes.length,
                  "条路线",
                  "route",
                  "routes",
                )
              : t(locale, "待生成", "Pending")
        }
        tone={routeSet ? "good" : "neutral"}
        dark={dark}
      />
      <MetricBox
        label={t(locale, "证据", "Evidence")}
        value={
          capabilityEvidence.length > 0
            ? countLabel(
                locale,
                capabilityEvidence.length,
                "条证据",
                "evidence item",
                "evidence items",
              )
            : countLabel(
                locale,
                effectPreviews.length,
                "个预演",
                "preview",
                "previews",
              )
        }
        tone={
          capabilityEvidence.length || effectPreviews.length ? "good" : "neutral"
        }
        dark={dark}
      />
    </div>
  );
};
