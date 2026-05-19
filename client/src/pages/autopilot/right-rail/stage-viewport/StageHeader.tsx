/**
 * 阶段仪式感标题区组件
 *
 * 固定在 StageViewport 顶部，展示当前阶段的步骤编号（英文）与中文大标题。
 * 使用 sticky 定位，不随内容滚动；浅色背景与内容区形成视觉分层。
 *
 * 2026-05-19：移除内嵌的 StageProgressIndicator (6 圆点 + 进度条)。
 * - 该指示器与 StreamingDocRenderer 头部的"生成中"指示器、以及右栏
 *   StageHeader 的 STEP 编号 + 中文大标题视觉重复。
 * - props 上 `completedStages` / `activeStage` / `stageProgress` /
 *   `isIndeterminate` 仍然保留为可选字段以维持向后兼容（既有测试与
 *   外部调用签名不变），但 header 内部不再渲染指示器。
 *
 * @example
 * ```tsx
 * <StageHeader
 *   stageIndex={0}
 *   englishLabel="INPUT"
 *   chineseTitle="需求输入"
 *   isActive={true}
 * />
 * ```
 *
 * 对应需求: 3.1, 3.2, 3.3, 3.4
 */

import type { FC } from "react";

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
   * @deprecated 2026-05-19：StageProgressIndicator 已从 header 移除。
   * 字段保留以避免破坏既有调用方签名，但不再被消费。
   */
  completedStages?: ReadonlySet<WorkbenchStage>;
  /** @deprecated 2026-05-19：见 `completedStages` 注释。 */
  activeStage?: WorkbenchStage;
  /** @deprecated 2026-05-19：见 `completedStages` 注释。 */
  stageProgress?: number;
  /** @deprecated 2026-05-19：见 `completedStages` 注释。 */
  isIndeterminate?: boolean;
}

/**
 * 阶段仪式感标题区。
 *
 * 渲染结构（已简化为两行）：
 * ```
 * <header sticky top-0 bg-slate-50 border-b px-3 py-2>
 *   <p>STEP 01 · INPUT</p>           // font-mono, 低对比度
 *   <h2>需求输入</h2>                 // text-sm font-semibold, 高对比度
 * </header>
 * ```
 */
const StageHeader: FC<StageHeaderProps> = ({
  stageIndex,
  englishLabel,
  chineseTitle,
  isActive,
}) => {
  // 生成两位数步骤编号：0 -> "01", 5 -> "06"
  const stepNumber = String(stageIndex + 1).padStart(2, "0");

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
    </header>
  );
};

export default StageHeader;
