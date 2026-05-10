/**
 * `@/pages/specs/panels/ArtifactMemoryPanel` shim
 *
 * Canonical 位置在 `@/pages/autopilot/right-rail/panels/ArtifactMemoryPanel`。
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1.4 / 6.1 / 8.1（canonical re-export；shim identity 对齐）
 * - 需求 2.8（`ArtifactMemoryPanel` 只接受 `{ jobId, locale }` + 面板私有字段
 *   `initialEntries / initialReplays / initialFeedback`）
 */

export { ArtifactMemoryPanel } from "@/pages/autopilot/right-rail/panels/ArtifactMemoryPanel";
export type { ArtifactMemoryPanelProps } from "@/pages/autopilot/right-rail/panels/ArtifactMemoryPanel";
