/**
 * StageViewport — 阶段独占视口容器
 *
 * 实现三段式布局：StageHeader（固定顶部）+ StageContent（弹性滚动区）+ StageCTA（固定底部）。
 * 一次只渲染当前阶段的内容，形成"标题 → 内容 → 行动"的阶段节奏。
 *
 * 对应 spec：`.kiro/specs/autopilot-workbench-stage-rhythm/`
 * - 需求 1.1：当前阶段独占视口
 * - 需求 1.2：StageViewport 占满右栏可用高度
 */

import type { FC, ReactNode } from "react";

/**
 * Autopilot 工作台 6 阶段枚举。
 *
 * 顺序固定：input → clarification → route → spec_tree → spec_documents → effect_preview
 */
export type WorkbenchStage =
  | "input"
  | "clarification"
  | "route"
  | "spec_tree"
  | "spec_documents"
  | "effect_preview";

/**
 * StageViewport 组件 Props
 */
export interface StageViewportProps {
  /** 当前阶段索引（0-5） */
  stageIndex: number;
  /** 当前阶段标识 */
  stageKey: WorkbenchStage;
  /** 阶段主内容区（当前阶段的具体内容组件） */
  children: ReactNode;
  /** 顶部标题区插槽 */
  header?: ReactNode;
  /** 底部行动栏插槽 */
  cta?: ReactNode;
}

/**
 * 阶段独占视口容器组件。
 *
 * 使用 flex 纵向布局占满父容器高度，三段式结构：
 * - header：固定顶部标题区（sticky）
 * - content：弹性可滚动内容区（flex-1 overflow-y-auto）
 * - cta：固定底部行动栏（sticky）
 */
const StageViewport: FC<StageViewportProps> = ({
  stageIndex,
  stageKey,
  children,
  header,
  cta,
}) => {
  return (
    <div
      className="flex flex-col h-full"
      data-stage-index={stageIndex}
      data-stage-key={stageKey}
    >
      {/* StageHeader 区域 */}
      {header}

      {/* StageContent 区域 — 弹性可滚动 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>

      {/* StageCTA 区域 */}
      {cta}
    </div>
  );
};

export default StageViewport;
