/**
 * `client/src/pages/specs/panels/` barrel（wt4 任务 1，方案 B）。
 *
 * SpecTreePanel 与 SpecDocumentsPanel 的 canonical 组件位于
 * `@/pages/autopilot/right-rail/panels/`，本 barrel 通过 re-export 指向
 * canonical 路径（对应 `.kiro/specs/autopilot-right-rail-stage-panels/`
 * 的需求 1.4 / 6.1 / 8.1）。
 *
 * 为兼容历史 import，保留 `SpecTreeWorkbenchPanel` / `SpecDocumentWorkbenchPanel`
 * 别名指向原外部组件（需求 9.1 / 9.2）。
 *
 * 其余 panel 因为实物仍内联在 BlueprintProgressPanel.tsx，用占位常量标记。
 *
 * 对应需求 2.6、2.7、6.2。
 */

// Canonical re-export：指向 autopilot/right-rail/panels 下的薄 wrapper
export { SpecTreePanel } from "./SpecTreePanel.js";
export type { SpecTreePanelProps } from "./SpecTreePanel.js";
export { SpecDocumentsPanel } from "./SpecDocumentsPanel.js";
export type { SpecDocumentsPanelProps } from "./SpecDocumentsPanel.js";

// 兼容历史调用方：`SpecTreeWorkbenchPanel` / `SpecDocumentWorkbenchPanel` 仍指向原外部组件
export { SpecTreeWorkbenchPanel } from "./SpecTreePanel.js";
export { SpecDocumentWorkbenchPanel } from "./SpecDocumentsPanel.js";

export { AgentCrewFabricPanel } from "./AgentCrewFabricPanel";
export type { AgentCrewFabricPanelProps } from "./AgentCrewFabricPanel";

export { EffectPreviewPanel } from "./EffectPreviewPanel.js";
export type { EffectPreviewPanelProps } from "./EffectPreviewPanel.js";

export { PromptPackagePanel } from "./PromptPackagePanel.js";
export type { PromptPackagePanelProps } from "./PromptPackagePanel.js";

export { RuntimeCapabilityPanel } from "./RuntimeCapabilityPanel.js";
export type { RuntimeCapabilityPanelProps } from "./RuntimeCapabilityPanel.js";

// Canonical 组件名为 `EngineeringHandoffPanel`；shim 额外导出 `EngineeringLandingPanel`
// 别名以兼容历史 import（需求 2.7 / 6.1）。
export {
  EngineeringHandoffPanel,
  EngineeringLandingPanel,
} from "./EngineeringLandingPanel.js";
export type {
  EngineeringHandoffPanelProps,
  EngineeringLandingPanelProps,
} from "./EngineeringLandingPanel.js";

export { PROGRESS_HEADER_PANEL_PLACEHOLDER } from "./ProgressHeaderPanel.js";
export { JOB_LEDGER_PANEL_PLACEHOLDER } from "./JobLedgerPanel.js";
export { ArtifactMemoryPanel } from "./ArtifactMemoryPanel.js";
export type { ArtifactMemoryPanelProps } from "./ArtifactMemoryPanel.js";
export { ROUTE_CANDIDATE_CARD_PLACEHOLDER } from "./RouteCandidateCard.js";
export { RUNTIME_PROJECTION_CARD_PLACEHOLDER } from "./RuntimeProjectionCard.js";
