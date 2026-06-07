/**
 * `@/pages/specs/panels/SpecTreePanel` shim
 *
 * Canonical 位置在 `@/pages/autopilot/right-rail/panels/SpecTreePanel`。
 * 同时保留 `SpecTreeWorkbenchPanel` alias 以兼容历史 import。
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1.4 / 6.1 / 8.1（canonical re-export；shim identity 对齐）
 * - 需求 9.1（不修改 `SpecTreeWorkbenchPanel.tsx`，通过 alias re-export 兼容）
 *
 * spec-generation-perceived-performance R3.1 / R3.3 约束：
 * 本文件是纯 re-export 转发 shim，刻意不承载 Generation_State_Machine
 * （`deriveGenerationState`）或 Progress_Feedback_Layer（`SpecTreeProgressLayer`）。
 * 生成感知性能的状态机与进度反馈层只存在于规范实现 `SpecTreeWorkbench`
 * （经 `AutopilotRightRail` 消费），本 shim 完全转发、不维护独立并发标志或乐观状态。
 */

export { SpecTreePanel } from "@/pages/autopilot/right-rail/panels/SpecTreePanel";
export type { SpecTreePanelProps } from "@/pages/autopilot/right-rail/panels/SpecTreePanel";
// 兼容历史调用方：`SpecTreeWorkbenchPanel` 仍指向原外部组件
export { default as SpecTreeWorkbenchPanel } from "../SpecTreeWorkbenchPanel.js";
