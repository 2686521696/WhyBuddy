/**
 * `@/pages/specs/panels/EngineeringLandingPanel` shim
 *
 * Canonical 组件名是 `EngineeringHandoffPanel`（对齐
 * `AutopilotRailSubStage === "engineering_handoff"` 契约，
 * 对应 `.kiro/specs/autopilot-right-rail-stage-panels/` 的
 * 需求 1.4 / 2.7 / 6.1 / 8.1）。
 *
 * 保留 `EngineeringLandingPanel` 别名导出以兼容历史 import。
 *
 * 对应需求 2.7、6.2。
 */

export { EngineeringHandoffPanel } from "@/pages/autopilot/right-rail/panels/EngineeringHandoffPanel";
export type { EngineeringHandoffPanelProps } from "@/pages/autopilot/right-rail/panels/EngineeringHandoffPanel";

// 兼容历史调用方的别名
export { EngineeringHandoffPanel as EngineeringLandingPanel } from "@/pages/autopilot/right-rail/panels/EngineeringHandoffPanel";
export type { EngineeringHandoffPanelProps as EngineeringLandingPanelProps } from "@/pages/autopilot/right-rail/panels/EngineeringHandoffPanel";
