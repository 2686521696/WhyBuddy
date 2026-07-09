/**
 * autopilot-mirofish-card-diversity / Task 2.2 — CapabilityCard
 *
 * 独立的能力调用卡片组件，展示 Docker / MCP / AIGC / Role 等能力的调用状态。
 *
 * 视觉特征：
 * - 横向紧凑布局：图标(16×16) + 能力名称 + 状态徽章
 * - 差异化图标（Docker 🐳, MCP 🔌, AIGC 🧩, Role 👤）
 * - invoking 态图标 animate-spin
 * - failed 态红色边框
 * - py-1.5 紧凑内边距
 */

import type { FC } from "react";

import type { MiroFishCapabilityInvocationEntry } from "../mirofish-stream-types";

/** 能力类型 → 图标映射 */
const CAPABILITY_ICON: Record<string, string> = {
  docker: "🐳",
  mcp: "🔌",
  aigc_node: "🧩",
  role_system: "👤",
};

/** 状态 → 徽章样式映射 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  invoking: "bg-blue-500/20 text-blue-300",
  completed: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-red-500/20 text-red-300",
};

/** 状态 → 徽章文本 */
const STATUS_LABEL: Record<string, string> = {
  invoking: "invoking",
  completed: "success",
  failed: "failed",
};

export interface CapabilityCardProps {
  entry: MiroFishCapabilityInvocationEntry;
}

/**
 * CapabilityCard — 能力调用卡片
 *
 * 横向紧凑布局展示能力调用状态，invoking 时图标旋转，
 * failed 时容器使用红色边框高亮。
 */
export const CapabilityCard: FC<CapabilityCardProps> = ({ entry }) => {
  // 从 capabilityId 推断能力类型（取第一段作为 key）
  const capType = entry.capabilityId.split(/[-_./]/)[0]?.toLowerCase() ?? "";
  const icon = CAPABILITY_ICON[capType] ?? "🔧";
  const badgeClass = STATUS_BADGE_CLASS[entry.status] ?? STATUS_BADGE_CLASS.completed;
  const statusText = STATUS_LABEL[entry.status] ?? entry.status;

  const isFailed = entry.status === "failed";
  const isInvoking = entry.status === "invoking";

  const containerClass = [
    "flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 border",
    isFailed ? "border-red-300" : "border-slate-200",
  ].join(" ");

  return (
    <div
      data-testid="mirofish-card-capability"
      data-tone={entry.tone}
      data-capability-id={entry.capabilityId}
      data-capability-status={entry.status}
      className={containerClass}
    >
      {/* 图标 16×16 */}
      <span
        className={`w-4 h-4 flex-shrink-0 flex items-center justify-center text-sm ${isInvoking ? "animate-spin" : ""}`}
        aria-hidden="true"
      >
        {icon}
      </span>

      {/* 能力名称 */}
      <span className="text-[11px] font-medium text-slate-700 truncate flex-1">
        {entry.capabilityId}
      </span>

      {/* 状态标签（兼容旧测试断言 "capability · {status}"） */}
      <span className="sr-only">
        {`capability · ${statusText}`}
      </span>

      {/* 状态徽章 */}
      <span
        className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${badgeClass}`}
      >
        {statusText}
      </span>
    </div>
  );
};

export default CapabilityCard;
