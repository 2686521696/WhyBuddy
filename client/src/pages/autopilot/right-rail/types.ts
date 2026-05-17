/**
 * Autopilot 驾驶舱右栏收敛 — 类型契约与子阶段枚举
 *
 * 本文件是纯类型模块：
 * - 不 import 任何 React 组件；
 * - 不 import `@/lib/blueprint-api` 的任何运行时成员（仅 `type` 引入 Snapshot 类型，因为两个
 *   `*Snapshot` 目前只在 blueprint-api 单体中有规范定义，尚未上提至 `@shared/blueprint/contracts`）；
 * - 不包含任何运行时代码；`resolveRailSubStage` 的实现由任务 2 在 `./resolve-rail-sub-stage.ts`
 *   中落地。
 *
 * 对应 spec：`.kiro/specs/autopilot-cockpit-right-rail-convergence/`
 * - 需求 2（Resolver 纯函数语义）
 * - 需求 3（右栏组件 props 契约）
 * - 需求 6.5（组件仅通过 props 接收数据）
 * - 需求 8.4（scaffolding 通过 tsc，不扩大现有 TS 基线错误数）
 */

import type { AppLocale } from "@/lib/locale";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type {
  BlueprintAgentCrewSnapshot,
  BlueprintEffectPreviewSnapshot,
} from "@/lib/blueprint-api";

/**
 * 左侧 5 阶段时间线的顶层 stage 枚举。
 *
 * 与 `AutopilotWorkflowRail` 当前使用的 `flowSteps[].id` 对齐；`projection` 视觉展示步骤
 * 不计入此枚举，因为它不参与 `AutopilotWorkflowStage` 判定。
 */
export type AutopilotTimelineStage =
  | "input"
  | "clarification"
  | "routeset"
  | "selection"
  | "fabric";

/**
 * `fabric` stage 内部的 7 个子工作台枚举。
 *
 * 仅当 `currentStage === "fabric"` 时才会出现；顺序由 `RAIL_SUB_STAGE_ORDER` 冻结，供 UI
 * 渲染与 PBT 共享。
 *
 * autopilot-spec-tree-workbench 重构（2026-05-17）：
 * - 删除 `"spec_documents"` 子阶段。spec_tree 现在承载 SpecTreeWorkbench
 *   组件，把"按节点生成 requirements / design / tasks"语义合并进同一卡片。
 * - 后端 `BlueprintGenerationStage.spec_docs` 仍然存在，由
 *   `resolveRailSubStage` 映射到 `"spec_tree"` 子阶段。
 */
export type AutopilotRailSubStage =
  | "agent_crew_fabric"
  | "spec_tree"
  | "effect_preview"
  | "prompt_package"
  | "runtime_capability"
  | "engineering_handoff"
  | "artifact_memory";

/**
 * 7 个 `AutopilotRailSubStage` 的声明顺序（只读）。
 *
 * 任何「子阶段是否单调推进」「是否越过某个子阶段」的属性判定都必须以本常量的 index 为准，
 * 禁止在其他文件中复制或派生一份平行的顺序源。
 */
export const RAIL_SUB_STAGE_ORDER: readonly AutopilotRailSubStage[] = [
  "agent_crew_fabric",
  "spec_tree",
  "effect_preview",
  "prompt_package",
  "runtime_capability",
  "engineering_handoff",
  "artifact_memory",
] as const;

/**
 * `<AutopilotRightRail>` 的外部契约。
 *
 * 硬性约束：
 * - 消费方只能通过 props 接收数据；组件内部禁止 `useAppStore` 或直接调用 `@/lib/blueprint-api`。
 * - 当 `currentStage !== "fabric"` 时，`currentSubStage` 必须为 `undefined`。
 * - `effectPreviews / capabilities / capabilityInvocations / capabilityEvidence` 的命名与
 *   `BlueprintProgressPanel` 现有 props 对齐，以降低 Spec 2 的迁移成本。
 */
export interface AutopilotRightRailProps {
  /** 当前 blueprint generation job id；没有 job 时仍需提供空字符串占位 */
  jobId: string;
  /** 左侧时间线当前激活阶段 */
  currentStage: AutopilotTimelineStage;
  /** 仅当 currentStage === "fabric" 时才应为有值，其它阶段必须为 undefined */
  currentSubStage?: AutopilotRailSubStage;
  /** 主数据对象 */
  job: BlueprintGenerationJob | null;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  /** 下游数据插槽（命名与 BlueprintProgressPanel 现有 props 对齐） */
  capabilities: BlueprintRuntimeCapability[];
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  /** i18n */
  locale: AppLocale;
  /** 用户点击子阶段导航时由父组件处理 */
  onSubStageChange: (next: AutopilotRailSubStage) => void;
  /**
   * 可选回调：当右栏中的某个面板（当前仅 `SpecTreePanel` 的"一键推导规格文档"按钮）
   * 触发了后端 `job.stage` 前进时调用。父组件应在此回调里让右栏数据层 hook 重新拉一次
   * W1 snapshot（例如调用 `rightRailView.job.retry()`），以便 `resolveRailSubStage`
   * 感知到 stage 变化并自动切换到下一子阶段面板。
   *
   * 不提供时按钮本身仍可点击并成功调用 API；右栏会在 SSE / polling 通路恢复后
   * 最终感知 stage 变化，只是不会"瞬间切换"。
   */
  onStageAdvanced?: () => void;
  /**
   * 可选回调：SpecTreeWorkbench 调用 `POST /api/blueprint/jobs/:jobId/spec-documents`
   * 成功后通知父组件，让 latestJob / specTree / specDocuments 等状态用新返回值更新。
   *
   * autopilot-spec-tree-workbench（2026-05-17）：与 onStageAdvanced 配合使用。
   * Workbench 内部不写 store、不发 socket，只调一次 API；副作用上抛由父组件
   * `setLatestJob(response.job)` 等承担。
   */
  onSpecDocumentsGenerated?: (
    response: import("@shared/blueprint/contracts").BlueprintSpecDocumentsResponse
  ) => void;
}

/**
 * `resolveRailSubStage` 的输入快照。
 *
 * 纯函数依赖：仅包含推导目标 sub-stage 所需的 5 个字段，不含任何环境引用。
 */
export interface ResolveRailSubStageInput {
  currentStage: AutopilotTimelineStage;
  job: BlueprintGenerationJob | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
}

// Resolver 实现位于 `./resolve-rail-sub-stage.ts`（任务 2 落地）。本文件只持有类型契约，
// 不重复声明 `resolveRailSubStage` 的签名，避免与运行时实现产生合并冲突。
