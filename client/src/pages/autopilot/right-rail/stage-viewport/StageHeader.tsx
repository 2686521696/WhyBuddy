/**
 * 阶段仪式感标题区组件
 *
 * 固定在 StageViewport 顶部，展示当前阶段的步骤编号（英文）与中文大标题。
 * 使用 sticky 定位，不随内容滚动；浅色背景与内容区形成视觉分层。
 *
 * autopilot-stage-progress-indicator（任务 6.1）：
 * - 当上层注入 `completedStages` / `activeStage` / `stageProgress` /
 *   `isIndeterminate` 4 个进度字段时，本组件会在标题区下方挂载
 *   `<StageProgressIndicator>`，让步骤指示器与进度条一并固定在 sticky
 *   header 内部，不随主内容滚动。
 * - 进度指示器与现有「STEP 0N · LABEL + 中文标题」垂直堆叠，整个 header 仍
 *   保持原有 `sticky top-0 z-10 bg-slate-50 border-b border-slate-100 px-4 py-3`
 *   外形约束，避免破坏 StageViewport 三段式布局。
 * - 4 个进度 props 任一缺失（或全部缺失）时，header 退化为旧版「仅展示步骤
 *   编号 + 中文标题」的形态，便于在没有实时 store 注入的场景（例如静态 SSR
 *   或部分单元测试）中复用。
 *
 * @example
 * ```tsx
 * <StageHeader
 *   stageIndex={0}
 *   englishLabel="INPUT"
 *   chineseTitle="需求输入"
 *   isActive={true}
 *   completedStages={completedStages}
 *   activeStage={activeStage}
 *   stageProgress={stageProgress}
 *   isIndeterminate={isIndeterminate}
 * />
 * ```
 *
 * 对应需求: 3.1, 3.2, 3.3, 3.4
 */

import type { FC } from "react";

import StageProgressIndicator from "../stage-progress/StageProgressIndicator";
import type { WorkbenchStage } from "./stage-config";

/** StageHeader 组件 Props */
export interface StageHeaderProps {
  /** 阶段索引（0-5），用于生成 "STEP 01" 格式的步骤编号 */
  stageIndex: number;
  /** 英文标识，如 "INPUT" / "CLARIFICATION" */
  englishLabel: string;
  /** 中文大标题，如 "需求输入" / "智能澄清" */
  chineseTitle: string;
  /** 当前阶段是否处于 active 状态；active 时使用高对比度文字 */
  isActive: boolean;
  /**
   * 已完成的阶段集合（index 严格小于 activeStage 的阶段）。
   *
   * 与下面 3 个进度字段配合，用于在 sticky header 内挂载
   * `<StageProgressIndicator>`；任一字段缺失则不渲染进度指示器。
   */
  completedStages?: ReadonlySet<WorkbenchStage>;
  /** 当前正在执行的阶段（与 `completedStages` 等成组使用）。 */
  activeStage?: WorkbenchStage;
  /** `activeStage` 内部的完成百分比，范围 `[0, 100]`。 */
  stageProgress?: number;
  /** 是否走不确定态扫描动画。 */
  isIndeterminate?: boolean;
}

/**
 * 阶段仪式感标题区。
 *
 * 渲染结构：
 * ```
 * <header sticky top-0 bg-slate-50 border-b px-4 py-3>
 *   <p>STEP 01 · INPUT</p>           // font-mono, 低对比度
 *   <h2>需求输入</h2>                 // text-sm font-semibold, 高对比度
 *   <StageProgressIndicator ... />   // 可选；进度字段齐全时才渲染
 * </header>
 * ```
 *
 * 进度指示器与标题之间使用 `mt-2` 保持节奏感；指示器自身高度受
 * `max-h-[40px]` 约束，整体 header 仍维持紧凑视觉。
 */
const StageHeader: FC<StageHeaderProps> = ({
  stageIndex,
  englishLabel,
  chineseTitle,
  isActive,
  completedStages,
  activeStage,
  stageProgress,
  isIndeterminate,
}) => {
  // 生成两位数步骤编号：0 -> "01", 5 -> "06"
  const stepNumber = String(stageIndex + 1).padStart(2, "0");

  // 仅当 4 个进度字段同时提供时才挂载进度指示器，避免在缺失实时数据的场景
  // （例如部分静态 SSR 测试）下出现 undefined 派生状态。
  const hasProgressData =
    completedStages !== undefined &&
    activeStage !== undefined &&
    stageProgress !== undefined &&
    isIndeterminate !== undefined;

  return (
    <header className="sticky top-0 z-10 bg-slate-50 border-b border-slate-100 px-3 py-2">
      {/* 英文步骤标识 */}
      <p
        className={`font-mono text-[10px] uppercase tracking-wider ${
          isActive ? "text-slate-500" : "text-slate-300"
        }`}
      >
        STEP {stepNumber} · {englishLabel}
      </p>

      {/* 中文大标题 */}
      <h2
        className={`text-sm font-semibold mt-0.5 ${
          isActive ? "text-slate-800" : "text-slate-400"
        }`}
      >
        {chineseTitle}
      </h2>

      {/* 阶段进度指示器（autopilot-stage-progress-indicator 任务 6.1）：
          固定在 sticky header 内部，不随主内容滚动。 */}
      {hasProgressData ? (
        <div className="mt-2">
          <StageProgressIndicator
            completedStages={completedStages}
            activeStage={activeStage}
            stageProgress={stageProgress}
            isIndeterminate={isIndeterminate}
          />
        </div>
      ) : null}
    </header>
  );
};

export default StageHeader;
