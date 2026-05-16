/**
 * Autopilot 驾驶舱右栏收敛 — 对外导出 barrel
 *
 * 对应 spec：`.kiro/specs/autopilot-cockpit-right-rail-convergence/`
 * - 需求 3（对外暴露 `AutopilotRightRailProps` 契约与 `resolveRailSubStage` 纯函数）
 *
 * 本文件只做 re-export，不新增运行时行为。消费方应通过
 * `import { AutopilotRightRail, resolveRailSubStage, RAIL_SUB_STAGE_ORDER } from "@/pages/autopilot/right-rail"`
 * 的方式引用，避免直接深链 `./types` 或 `./resolve-rail-sub-stage` 产生多路径漂移。
 */

export { AutopilotRightRail } from "./AutopilotRightRail";
export { resolveRailSubStage } from "./resolve-rail-sub-stage";
export {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
  type ResolveRailSubStageInput,
} from "./types";
export {
  useAutopilotRightRailData,
  type RightRailDataFieldStatus,
  type RightRailDataView,
  type UseAutopilotRightRailDataOptions,
} from "./hooks";
export {
  NULL_CONTEXT_FALLBACK,
  RightRailSubStageContext,
  useRightRailSubStageContext,
  useRightRailSubStageState,
  type RightRailSubStageContextValue,
  type UseRightRailSubStageStateInput,
} from "./hooks";
export {
  resolveViewportTier,
  useViewportTier,
  VIEWPORT_TIER_BREAKPOINT_MD,
  VIEWPORT_TIER_BREAKPOINT_XL,
  type ViewportTier,
} from "./hooks";


/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 barrel re-export。
 *
 * 三个 store-observability 组件 + HUD overlay 包装：
 * - `StoreObservabilityHud` 是首选的跨阶段挂载形式（含三个子组件 + 浅色背景容器）；
 * - 三个底层组件单独导出，便于在 `AutopilotRightRail` fabric 分支等其它位置就地组合。
 */
export { CapabilityRail } from "./CapabilityRail";
export { FleetActivationLog } from "./FleetActivationLog";
export { RoleStatusStrip } from "./RoleStatusStrip";
export { StoreObservabilityHud } from "./StoreObservabilityHud";
