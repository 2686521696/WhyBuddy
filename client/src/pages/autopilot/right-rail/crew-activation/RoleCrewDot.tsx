/**
 * 单个角色状态圆点组件。
 *
 * 四种状态色：active(emerald-500) / watching(amber-400) / reviewing(blue-500) / sleeping(slate-300)。
 * active 态使用 CSS `animate-crew-pulse` 脉冲动画。
 * sleeping→active 使用 framer-motion scale(0.8→1) + opacity(0.4→1) duration 250ms。
 * active→sleeping 使用 framer-motion opacity(1→0.4) duration 200ms。
 *
 * 对应 `.kiro/specs/autopilot-agent-crew-stage-activation` Task 2.2。
 * 需求: 2.1, 2.2, 2.3, 2.4
 */

import { motion, useReducedMotion, type Transition } from "framer-motion";

import type { RoleCrewEntry, RoleCrewStatus } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RoleCrewDotProps {
  /** 角色条目 */
  role: RoleCrewEntry;
  /** 圆点尺寸：sm=6px, md=8px */
  size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// 状态色映射
// ---------------------------------------------------------------------------

const STATUS_COLOR_MAP: Record<RoleCrewStatus, string> = {
  active: "bg-emerald-500",
  watching: "bg-amber-400",
  reviewing: "bg-blue-500",
  sleeping: "bg-slate-300",
};

// ---------------------------------------------------------------------------
// 动画变体
// ---------------------------------------------------------------------------

function getAnimateProps(
  status: RoleCrewStatus,
  reducedMotion: boolean | null
): {
  animate: { scale: number; opacity: number };
  transition: Transition;
} {
  if (reducedMotion) {
    // prefers-reduced-motion：无动画，仅状态色变化
    return {
      animate: {
        scale: 1,
        opacity: status === "sleeping" ? 0.4 : 1,
      },
      transition: { duration: 0 },
    };
  }

  switch (status) {
    case "active":
      return {
        animate: { scale: 1, opacity: 1 },
        transition: { duration: 0.25, ease: "easeOut" },
      };
    case "sleeping":
      return {
        animate: { scale: 1, opacity: 0.4 },
        transition: { duration: 0.2, ease: "easeIn" },
      };
    case "watching":
    case "reviewing":
      return {
        animate: { scale: 1, opacity: 1 },
        transition: { duration: 0.2, ease: "easeOut" },
      };
    default:
      return {
        animate: { scale: 1, opacity: 1 },
        transition: { duration: 0.2 },
      };
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 单个角色状态圆点。
 *
 * 根据角色状态显示不同颜色，active 态附带 CSS 脉冲动画。
 */
export function RoleCrewDot({ role, size = "sm" }: RoleCrewDotProps) {
  const shouldReduceMotion = useReducedMotion();
  const { status } = role;

  const sizeClass = size === "md" ? "w-2 h-2" : "w-1.5 h-1.5";
  const colorClass = STATUS_COLOR_MAP[status] ?? STATUS_COLOR_MAP.sleeping;

  // active 态附加 CSS 脉冲动画（prefers-reduced-motion 已在 CSS 中降级）
  const pulseClass = status === "active" ? "animate-crew-pulse" : "";

  const { animate, transition } = getAnimateProps(status, shouldReduceMotion);

  return (
    <motion.div
      className={`rounded-full ${sizeClass} ${colorClass} ${pulseClass}`}
      initial={{ scale: 0.8, opacity: 0.4 }}
      animate={animate}
      transition={transition}
      aria-label={`${role.roleName}: ${status}`}
    />
  );
}
