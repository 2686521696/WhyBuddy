import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

export type ConclusionBadgeTone = "idle" | "clear" | "not_recommended";

export type ConclusionBadgeProjection = {
  label: string;
  tone: ConclusionBadgeTone;
  className: string;
};

/**
 * Mechanical projection of sessionState.goal.status (Layer 1 badge).
 * Transcribes only — never adjudicates.
 */
export function projectConclusionBadge(state: V5SessionState): ConclusionBadgeProjection {
  const status = state.goal?.status;

  if (status === "clear") {
    return {
      label: "已收敛 / clear",
      tone: "clear",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    };
  }

  if (status === "not_recommended") {
    return {
      label: "不建议",
      tone: "not_recommended",
      className: "bg-rose-50 text-rose-700 ring-rose-200",
    };
  }

  return {
    label: "待细化",
    tone: "idle",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
  };
}