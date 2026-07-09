/**
 * 能力 Bridge 状态摘要组件
 *
 * 顶部摘要栏，以 4 个紧凑徽章横向排列展示
 * total / running / completed / failed 计数。
 *
 * 对应 spec：`.kiro/specs/autopilot-capability-bridge-runtime-panel/`
 * - 需求 1.1
 */

import type { FC } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BridgeStatusSummaryProps {
  /** 状态摘要统计 */
  summary: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
}

// ---------------------------------------------------------------------------
// 徽章配置
// ---------------------------------------------------------------------------

interface BadgeConfig {
  label: string;
  key: keyof BridgeStatusSummaryProps["summary"];
  className: string;
}

const BADGES: BadgeConfig[] = [
  {
    label: "总计",
    key: "total",
    className: "bg-white/[0.08] text-white/70",
  },
  {
    label: "运行",
    key: "running",
    className: "bg-blue-500/20 text-blue-300",
  },
  {
    label: "完成",
    key: "completed",
    className: "bg-emerald-500/20 text-emerald-300",
  },
  {
    label: "失败",
    key: "failed",
    className: "bg-red-500/20 text-red-300",
  },
];

// ---------------------------------------------------------------------------
// 组件实现
// ---------------------------------------------------------------------------

/**
 * 能力 Bridge 状态摘要栏。
 *
 * 4 个紧凑徽章横向排列，text-[10px] font-mono。
 */
export const BridgeStatusSummary: FC<BridgeStatusSummaryProps> = ({
  summary,
}) => {
  return (
    <div className="flex items-center gap-1.5 px-1">
      {BADGES.map((badge) => (
        <span
          key={badge.key}
          className={cn(
            "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono leading-none",
            badge.className
          )}
        >
          <span className="opacity-70">{badge.label}</span>
          <span className="font-semibold">{summary[badge.key]}</span>
        </span>
      ))}
    </div>
  );
};
