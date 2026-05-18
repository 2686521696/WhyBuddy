/**
 * Autopilot 进度节奏可视化 — 单个步骤圆点（StepDot）
 *
 * 本组件是 `.kiro/specs/autopilot-stage-progress-indicator/` 任务 2.2 的落地点：
 * - 通过 `status` 切换三种视觉态：`completed` / `active` / `pending`。
 * - `pending → active` 切换时使用 `animate-mirofish-dot-fill`（300ms 一次性）做填
 *   充过渡。
 * - `active` 态在外层叠加 `animate-mirofish-pulse` 脉冲环（10px 直径，2s 循环）。
 * - `completed` 态在实心圆内绘制白色对勾 SVG。
 *
 * 视觉硬性约束（与 design.md / requirements.md 对齐）：
 * - 右栏整体为白色背景（`bg-white`），所有颜色必须使用 light-theme 调色板：
 *   - pending：`border-slate-300` + `bg-transparent`
 *   - active： `bg-indigo-500` + 外层脉冲环 `border-indigo-400/60`
 *   - completed：`bg-indigo-500` + 白色对勾
 * - 圆点直径 6px（`w-1.5 h-1.5`），脉冲环外径 10px（`inset-[-2px]`）。
 *
 * 无障碍约束：
 * - `prefers-reduced-motion: reduce` 时，`animate-mirofish-pulse` /
 *   `animate-mirofish-dot-fill` 在全局 CSS 中被降级为 `animation: none`。
 * - `aria-current` 在 `active` 态置为 `step`，方便屏幕阅读器播报当前步骤。
 */

import type { FC } from "react";

/** StepDot 三种视觉状态。 */
export type StepDotStatus = "completed" | "active" | "pending";

/** StepDot 组件 Props。 */
export interface StepDotProps {
  /** 当前圆点的视觉状态。 */
  status: StepDotStatus;
  /** 该圆点对应的阶段索引（0-5），用于生成 `aria-label`。 */
  index: number;
}

/**
 * 进度指示器中的单个步骤圆点。
 *
 * 容器尺寸固定为 10px × 10px，留出 2px 给 active 态的脉冲环；圆点本体始终
 * 居中于容器中央，保证三态切换时不会出现位置抖动。
 */
const StepDot: FC<StepDotProps> = ({ status, index }) => {
  const stepNumber = index + 1;
  const ariaLabel = `第 ${stepNumber} 步`;
  const ariaCurrent = status === "active" ? "step" : undefined;

  // 容器：统一占位 10px × 10px，确保 5 个 ConnectorLine 之间的间距稳定
  const containerClass =
    "relative inline-flex h-2.5 w-2.5 items-center justify-center";

  if (status === "pending") {
    return (
      <span
        className={containerClass}
        role="img"
        aria-label={`${ariaLabel}（未开始）`}
      >
        <span
          className="block h-1.5 w-1.5 rounded-full border border-slate-300 bg-transparent"
          aria-hidden="true"
        />
      </span>
    );
  }

  if (status === "active") {
    return (
      <span
        className={containerClass}
        role="img"
        aria-current={ariaCurrent}
        aria-label={`${ariaLabel}（进行中）`}
      >
        {/* 外层脉冲环：10px 直径，2s 循环 scale 1→1.4→1 */}
        <span
          className="absolute inset-0 rounded-full border border-indigo-400/60 animate-mirofish-pulse"
          aria-hidden="true"
        />
        {/* 实心圆点：从 pending 切到 active 时一次性填充动画 */}
        <span
          className="block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-mirofish-dot-fill"
          aria-hidden="true"
        />
      </span>
    );
  }

  // completed：实心圆 + 白色对勾
  return (
    <span
      className={containerClass}
      role="img"
      aria-label={`${ariaLabel}（已完成）`}
    >
      <span
        className="flex h-1.5 w-1.5 items-center justify-center rounded-full bg-indigo-500"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 6 6"
          className="h-[5px] w-[5px] text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1.2 3.2 L2.5 4.4 L4.8 1.8" />
        </svg>
      </span>
    </span>
  );
};

export default StepDot;
