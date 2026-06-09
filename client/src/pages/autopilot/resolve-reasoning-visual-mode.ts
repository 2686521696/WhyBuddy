/**
 * Pure resolver for the 2D/3D visual mode decision in the Autopilot visual stage.
 *
 * This encapsulates the core business rules so they can be unit-tested in isolation:
 * - reasoning-heavy stages (including early input/clarification/route_selection for good HUD Flow) with data default to 2D.
 * - explicit user preference ("2d" / "3d") always wins over auto.
 * - "auto" + heavy stage + data → 2D.
 *
 * The caller (AutopilotRoutePage) is responsible for:
 * - Computing the authoritative `activeReasoningStage` (effectiveSubStage ?? fabricSubStage ?? job?.stage).
 * - Computing `hasReasoningData` (structured artifacts OR derived viewModel nodes).
 * - Managing the `visualModePreference` state + reset on job/activeReasoningStage change.
 */

export type VisualModePreference = "auto" | "2d" | "3d";

export function resolveReasoningVisualMode({
  preference,
  activeReasoningStage,
  hasReasoningData,
}: {
  preference: VisualModePreference;
  activeReasoningStage: string | undefined;
  hasReasoningData: boolean;
}): "2d" | "3d" {
  const isReasoningHeavyStage =
    activeReasoningStage === "spec_tree" ||
    activeReasoningStage === "spec_docs" ||
    activeReasoningStage === "effect_preview" ||
    // 早期阶段 (输入、澄清、路线选择) 也默认使用 2D surface 以达到参考图中的成熟 HUD Flow 效果
    activeReasoningStage === "input" ||
    activeReasoningStage === "clarification" ||
    activeReasoningStage === "routeset" ||
    activeReasoningStage === "selection" ||
    activeReasoningStage === "route_generation";

  const shouldAutoUse2D = isReasoningHeavyStage && hasReasoningData;

  return preference === "2d" || (preference === "auto" && shouldAutoUse2D)
    ? "2d"
    : "3d";
}
