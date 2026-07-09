/**
 * Autopilot 进度节奏可视化 — 步骤圆点序列（StepIndicator）
 *
 * 本组件是 `.kiro/specs/autopilot-stage-progress-indicator/` 任务 2.1 / 2.3 的
 * 落地点：
 * - 水平排列 6 个 `StepDot`，分别对应 6 个 `WorkbenchStage`。
 * - 5 条 `ConnectorLine` 连接相邻圆点（任务 2.3，作为本组件的内部子结构而非
 *   独立文件）。
 * - 每个圆点下方展示阶段简称（`text-[9px] font-mono text-slate-400`），用于让
 *   用户在 6 步全景里理解当前位于哪一段。
 *
 * 视觉硬性约束（与 design.md / requirements.md 对齐）：
 * - 右栏整体为白色背景，所有颜色必须使用 light-theme 调色板：
 *   - completed 段连接线：`bg-indigo-400` 1px 实线
 *   - pending 段连接线：`border-t border-dashed border-slate-200` 1px 虚线
 *   - 阶段简称：`text-slate-400`
 * - 不允许使用 `bg-white/5` / `border-white/*` 等深色主题色。
 *
 * 状态推导规则：
 * - 已经在 `completedStages` 中的阶段渲染为 `completed`；
 * - `activeStage` 渲染为 `active`；
 * - 其余阶段渲染为 `pending`。
 * - 连接线段以「左侧圆点是否 completed」决定 completed / pending 视觉。
 *
 * 布局策略：
 * - 圆点 + 连接线行使用 `flex` 让 5 条连接线段以 `flex-1` 等宽撑满相邻圆点之
 *   间的剩余空间。
 * - 阶段简称标签行使用 grid-cols-6，并与圆点行共享同一外层容器；为了让标签
 *   精确居中于圆点正下方，圆点行也使用 grid-cols-6 + 绝对定位的连接线层级
 *   渲染，确保两行水平坐标完全一致。
 *
 * 无障碍约束：
 * - 容器使用 `role="list"` + 每个 step 容器 `role="listitem"`，让屏幕阅读器
 *   把 6 个步骤识别为有序列表。
 */

import type { FC } from "react";

import StepDot, { type StepDotStatus } from "./StepDot";
import {
  STAGE_ORDER,
  type WorkbenchStage,
} from "../stage-viewport/stage-config";

/** StepIndicator 组件 Props。 */
export interface StepIndicatorProps {
  /** 已完成的阶段集合（index 严格小于 activeStage 的阶段）。 */
  completedStages: ReadonlySet<WorkbenchStage>;
  /** 当前正在执行的阶段。 */
  activeStage: WorkbenchStage;
}

/**
 * 6 个阶段在步骤指示器中的简称（中文），与 `STAGE_ORDER` 一一对应。
 *
 * 设计 doc `STAGE_SHORT_LABELS` 同时定义了 zh / en 两套，但 MVP 阶段只在右栏
 * 展示中文简称即可；后续如需 i18n 切换，可改为读取 `AppLocale`。
 */
const STAGE_SHORT_LABELS_ZH: Record<WorkbenchStage, string> = {
  input: "输入",
  clarification: "澄清",
  route: "路线",
  spec_tree: "树",
  spec_documents: "文档",
  effect_preview: "预览",
};

/**
 * 计算给定 stage 在 6 阶段序列中的视觉状态。
 *
 * - `completedStages` 中存在 → `completed`
 * - 等于 `activeStage` → `active`
 * - 其余 → `pending`
 */
function resolveDotStatus(
  stage: WorkbenchStage,
  activeStage: WorkbenchStage,
  completedStages: ReadonlySet<WorkbenchStage>
): StepDotStatus {
  if (completedStages.has(stage)) return "completed";
  if (stage === activeStage) return "active";
  return "pending";
}

/**
 * 单条连接线段（ConnectorLine）。
 *
 * - `isCompleted=true`：1px 实线，`bg-indigo-400`，表达「左右两端都已经过」。
 * - `isCompleted=false`：1px 虚线，`border-slate-200 border-dashed`。
 */
const ConnectorLine: FC<{ isCompleted: boolean }> = ({ isCompleted }) => {
  if (isCompleted) {
    return (
      <span
        className="block w-full h-px bg-indigo-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="block w-full h-0 border-t border-dashed border-slate-200"
      aria-hidden="true"
    />
  );
};

/**
 * 步骤圆点序列（含连接线与阶段简称标签）。
 *
 * 渲染结构：
 * ```
 * [ Dot1 ─── Dot2 ─── ... ─── Dot6 ]
 *   输入      澄清              预览
 * ```
 *
 * 圆点行使用 `grid-cols-6`，每列固定宽度，圆点居中显示；连接线绘制在每两列
 * 之间，使用 `flex-1` 填满圆点之间的水平间距。标签行同样使用 `grid-cols-6`，
 * 与圆点列对齐。
 */
const StepIndicator: FC<StepIndicatorProps> = ({
  completedStages,
  activeStage,
}) => {
  return (
    <div className="w-full">
      {/* 圆点 + 连接线行（使用 grid-cols-6 锚定列宽，连接线在 cell 之间） */}
      <div
        className="grid grid-cols-6 items-center w-full"
        role="list"
        aria-label="6 阶段步骤指示器"
      >
        {STAGE_ORDER.map((stage, index) => {
          const status = resolveDotStatus(stage, activeStage, completedStages);
          const isLast = index === STAGE_ORDER.length - 1;

          return (
            <span
              key={stage}
              className="relative flex items-center justify-center"
              role="listitem"
            >
              <StepDot status={status} index={index} />
              {/* 连接到下一个圆点的线段：横跨当前 cell 的右半 + 下一 cell 的左半。
                  使用绝对定位让线段精确接在两个圆点之间，避免被圆点宽度切断。 */}
              {!isLast ? (
                <span
                  className="absolute left-1/2 right-[-50%] top-1/2 -translate-y-1/2 px-1.5 pointer-events-none"
                  aria-hidden="true"
                >
                  <ConnectorLine isCompleted={status === "completed"} />
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      {/*
        阶段简称标签行：
        - 与圆点行共享 grid-cols-6，确保水平居中对齐。
        - 小屏（`< 640px`）通过 `hidden sm:grid` 隐藏，避免在窄宽度下挤压
          StepDot 序列与 ProgressBar；这是 spec 任务 4.2 响应式行为的落地点。
      */}
      <div className="hidden sm:grid grid-cols-6 mt-0.5" aria-hidden="true">
        {STAGE_ORDER.map((stage) => (
          <span
            key={stage}
            className="text-[9px] font-mono text-slate-400 text-center"
          >
            {STAGE_SHORT_LABELS_ZH[stage]}
          </span>
        ))}
      </div>
    </div>
  );
};

export default StepIndicator;
