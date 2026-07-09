/**
 * 角色状态圆点序列组件。
 *
 * 水平排列所有角色的状态圆点，每个圆点下方显示角色简称。
 * 使用 framer-motion `layoutId` 实现位置动画。
 *
 * 窄宽度降级（Task 6.1）：当右栏 < 280px 时隐藏角色名称仅保留圆点。
 * 使用 `hidden sm:block` 实现响应式降级。
 *
 * 对应 `.kiro/specs/autopilot-agent-crew-stage-activation` Task 2.1, 6.1。
 * 需求: 1.1, 4.1, 4.3
 */

import { motion, useReducedMotion } from "framer-motion";

import type { RoleCrewEntry } from "./types";
import { RoleCrewDot } from "./RoleCrewDot";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RoleCrewDotsProps {
  /** 角色列表 */
  roles: RoleCrewEntry[];
  /** 圆点尺寸：sm=6px, md=8px */
  size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// 辅助：从 roleName 提取简称（取首字或首两字母）
// ---------------------------------------------------------------------------

function getShortName(roleName: string): string {
  if (!roleName) return "?";
  // 中文取第一个字，英文取前两个字母大写
  const first = roleName.charAt(0);
  if (/[\u4e00-\u9fff]/.test(first)) return first;
  return roleName.slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 角色状态圆点序列。
 *
 * 水平排列角色圆点，下方显示角色简称。
 * 窄宽度（< 280px / sm 断点以下）时隐藏角色名称仅保留圆点。
 */
export function RoleCrewDots({ roles, size = "sm" }: RoleCrewDotsProps) {
  const shouldReduceMotion = useReducedMotion();

  if (!roles || roles.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      {roles.map((role) => (
        <motion.div
          key={role.roleId}
          layoutId={`crew-dot-${role.roleId}`}
          className="flex flex-col items-center gap-0.5"
          transition={
            shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 25 }
          }
        >
          <RoleCrewDot role={role} size={size} />
          <span className="hidden sm:block text-[10px] leading-tight text-slate-500 select-none whitespace-nowrap">
            {getShortName(role.roleName)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
