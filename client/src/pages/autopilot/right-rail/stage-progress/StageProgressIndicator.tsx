/**
 * Autopilot 进度节奏可视化 — 进度指示器主容器（StageProgressIndicator）
 *
 * 本组件是 `.kiro/specs/autopilot-stage-progress-indicator/` 任务 4.1 / 4.2 的
 * 落地点：
 * - 把 `StepIndicator`（6 圆点 + 连接线 + 阶段简称标签）与 `ProgressBar`
 *   （阶段内 2px 线性进度条）组合在同一容器内，作为 `StageHeader` 的固定
 *   组成部分。
 * - 通过 props 接收派生进度状态：`completedStages` / `activeStage` /
 *   `stageProgress` / `isIndeterminate`，本组件不直接读 store；上层使用
 *   `useStageProgress()` hook 注入即可，便于在 SSR 与 PBT 中独立验证。
 *
 * 视觉硬性约束（与 design.md / requirements.md 对齐）：
 * - 右栏整体为白色背景，所有颜色必须使用 light-theme 调色板：
 *   - 容器背景：`bg-slate-50`（**不允许** `bg-black/20 backdrop-blur-sm` 这类
 *     深色主题色）
 *   - 容器圆角与内边距：`rounded-md`、左右 16px (`px-4`)、上下 8px (`py-2`)
 * - 容器总高度受 `max-h-[40px]` 限制，避免压缩 `StageContent` 视口。
 * - 内层使用 `flex flex-col items-center gap-1.5`，让 StepIndicator 与
 *   ProgressBar 垂直堆叠并水平居中。
 *
 * 响应式策略（任务 4.2）：
 * - 大屏（`≥ 640px`）展示完整 StepDot + StepLabel + ProgressBar。
 * - 小屏（`< 640px`）由 `StepIndicator` 内部通过 `hidden sm:grid` 隐藏阶段简称
 *   标签行，仅保留 StepDot 序列与 ProgressBar；本组件容器自身无需改变高度，
 *   `max-h-[40px]` 在两种断点下均成立。
 *
 * 无障碍约束：
 * - 容器添加 `aria-label="阶段进度指示器"`，让屏幕阅读器在跳转到本区域时能给
 *   出整体语义；具体 `role="list"` / `role="progressbar"` 等语义由
 *   `StepIndicator` / `ProgressBar` 内部承担。
 */

import type { FC } from "react";

import ProgressBar from "./ProgressBar";
import StepIndicator from "./StepIndicator";
import type { AppLocale } from "@/lib/locale";
import type { WorkbenchStage } from "../stage-viewport/stage-config";

/** StageProgressIndicator 组件 Props。 */
export interface StageProgressIndicatorProps {
  /** 已完成的阶段集合（index 严格小于 activeStage 的阶段）。 */
  completedStages: ReadonlySet<WorkbenchStage>;
  /** 当前正在执行的阶段。 */
  activeStage: WorkbenchStage;
  /** `activeStage` 内部的完成百分比，范围 `[0, 100]`。 */
  stageProgress: number;
  /** 是否走不确定态扫描动画。 */
  isIndeterminate: boolean;
  /**
   * 当前界面语言（可选）。
   *
   * MVP 阶段 `StepIndicator` 仅展示中文阶段简称；保留 `locale` 入参是为后续
   * i18n 切换预留接口，避免上层每次都改组件契约。
   */
  locale?: AppLocale;
}

/**
 * 进度节奏可视化主容器。
 *
 * 渲染结构：
 * ```
 * <div bg-slate-50 rounded-md px-4 py-2 max-h-[40px]>
 *   <StepIndicator />     // 6 圆点 + 连接线 + 阶段简称（小屏隐藏标签）
 *   <ProgressBar />       // 阶段内 2px 线性进度条
 * </div>
 * ```
 *
 * 不接管动画与状态推导：
 * - 圆点 active 脉冲、completed 填充等视觉由 `StepDot` 内部处理。
 * - 进度条的确定 / 不确定 / 完成闪光分支由 `ProgressBar` 自行决定。
 * - 本组件只负责布局、容器视觉与 props 透传，保持单一职责。
 */
const StageProgressIndicator: FC<StageProgressIndicatorProps> = ({
  completedStages,
  activeStage,
  stageProgress,
  isIndeterminate,
  // locale 暂不在本组件内消费，仅作为 i18n 占位入参；显式忽略以避免 lint 警告。
  locale: _locale,
}) => {
  // 阶段「是否刚完成」由调用方通过 completedStages.has(activeStage) 判断；
  // 在 MVP 中只要 activeStage 仍在集合内，进度条就走完成闪光分支。
  const isComplete = completedStages.has(activeStage);

  return (
    <div
      className="flex max-h-[40px] w-full flex-col items-center gap-1.5 rounded-md bg-slate-50 px-4 py-2"
      aria-label="阶段进度指示器"
    >
      <StepIndicator
        completedStages={completedStages}
        activeStage={activeStage}
      />
      <ProgressBar
        progress={stageProgress}
        isIndeterminate={isIndeterminate}
        isComplete={isComplete}
      />
    </div>
  );
};

export default StageProgressIndicator;
