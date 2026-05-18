/**
 * Autopilot 进度节奏可视化 — 阶段内线性进度条（ProgressBar）
 *
 * 本组件是 `.kiro/specs/autopilot-stage-progress-indicator/` 任务 3.1 / 3.2 / 3.3
 * 的落地点：
 * - 2px 高度的线性进度条，背景轨道 `bg-slate-100`。
 * - 确定态：`bg-gradient-to-r from-indigo-500 to-purple-500` 渐变填充，宽度由
 *   `progress` 驱动；填充端附带 `shadow-[0_0_6px_rgba(99,102,241,0.4)]` 微弱
 *   发光。
 * - 不确定态（`isIndeterminate=true`）：`animate-mirofish-indeterminate` 渐变
 *   扫描条，从 `translateX(-100%)` 滑到 `translateX(300%)`，1.5s 循环。
 * - 完成闪光（`isComplete=true`）：触发 `animate-mirofish-progress-complete`
 *   闪光 600ms，并强制 `progress=100`，保证阶段切换的瞬间能看到「填满」视觉。
 *
 * 视觉硬性约束（与 design.md / requirements.md 对齐）：
 * - 右栏整体为白色背景，所有颜色必须使用 light-theme 调色板：
 *   - 轨道 `bg-slate-100`
 *   - 渐变填充 `from-indigo-500 to-purple-500`
 * - 不允许使用 `bg-white/5` / `text-white/*` 等深色主题色。
 *
 * 无障碍约束：
 * - 容器使用 `role="progressbar"` + `aria-valuenow / aria-valuemin / aria-valuemax`。
 * - 不确定态下不写 `aria-valuenow`（按 ARIA 规范由屏幕阅读器播报为「进行中」）。
 * - `prefers-reduced-motion: reduce` 时，indeterminate / complete 动画在全局
 *   CSS 中被降级为 `animation: none`。
 */

import type { FC } from "react";

/** ProgressBar 组件 Props。 */
export interface ProgressBarProps {
  /** 阶段内进度百分比，范围 `[0, 100]`。 */
  progress: number;
  /** 是否走不确定态扫描动画。 */
  isIndeterminate: boolean;
  /** 是否触发阶段完成闪光（一次性 600ms 动画，并强制填满至 100%）。 */
  isComplete: boolean;
}

/** 把任意输入夹到 `[0, 100]` 闭区间，不依赖外部确保合法值。 */
function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

const TRACK_CLASS =
  "relative w-full h-[2px] rounded-full bg-slate-100 overflow-hidden";

const FILL_GRADIENT_CLASS =
  "h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500";

const FILL_GLOW_CLASS = "shadow-[0_0_6px_rgba(99,102,241,0.4)]";

/**
 * 阶段内线性进度条。
 *
 * 三种渲染分支：
 * 1. `isComplete`：无论入参 progress 多少，强制以 100% 渲染并叠加闪光动画。
 * 2. `isIndeterminate`：渲染 1/3 宽度的渐变扫描条，循环平移；不写
 *    `aria-valuenow`。
 * 3. 默认（确定态）：按 `progress` 填充，附带发光与 300ms 平滑过渡。
 */
const ProgressBar: FC<ProgressBarProps> = ({
  progress,
  isIndeterminate,
  isComplete,
}) => {
  // 完成态优先：填满到 100% 并触发一次性闪光
  if (isComplete) {
    return (
      <div
        className={TRACK_CLASS}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={100}
      >
        <div
          className={`${FILL_GRADIENT_CLASS} ${FILL_GLOW_CLASS} animate-mirofish-progress-complete transition-all duration-300`}
          style={{ width: "100%" }}
          aria-hidden="true"
        />
      </div>
    );
  }

  // 不确定态：1/3 宽度扫描条循环平移
  if (isIndeterminate) {
    return (
      <div
        className={TRACK_CLASS}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`${FILL_GRADIENT_CLASS} w-1/3 animate-mirofish-indeterminate`}
          aria-hidden="true"
        />
      </div>
    );
  }

  // 确定态：按入参渲染填充
  const safeProgress = clampProgress(progress);

  return (
    <div
      className={TRACK_CLASS}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safeProgress)}
    >
      <div
        className={`${FILL_GRADIENT_CLASS} ${FILL_GLOW_CLASS} transition-all duration-300`}
        style={{ width: `${safeProgress}%` }}
        aria-hidden="true"
      />
    </div>
  );
};

export default ProgressBar;
