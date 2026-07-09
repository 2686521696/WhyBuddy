/**
 * `@/pages/specs/panels/AgentCrewFabricPanel` shim
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 4（Shim_File 单行 re-export 固化）
 *
 * Canonical 位置在 `@/pages/autopilot/right-rail/panels/AgentCrewFabricPanel`。
 * 本文件历史上不存在（不像 `EffectPreviewPanel.tsx` 等有占位），本次新建为纯 re-export
 * 以保持 `@/pages/specs/panels` 作为统一消费入口。
 */

export {
  AgentCrewFabricPanel,
} from "@/pages/autopilot/right-rail/panels/AgentCrewFabricPanel";
export type {
  AgentCrewFabricPanelProps,
} from "@/pages/autopilot/right-rail/panels/AgentCrewFabricPanel";
