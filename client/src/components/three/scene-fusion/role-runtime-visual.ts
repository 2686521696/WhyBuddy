import type {
  RoleRuntimeKind,
  RoleRuntimeState,
} from "@/lib/blueprint-realtime-store";

export type RoleRuntimeStatusCategory =
  | "working"
  | "thinking"
  | "reviewing"
  | "idle"
  | "done"
  | "error";

export interface RoleRuntimeVisual {
  label: RoleRuntimeKind;
  statusCategory: RoleRuntimeStatusCategory;
  className: string;
  accentColor: string;
}

const VISUAL_BY_KIND: Record<RoleRuntimeKind, RoleRuntimeVisual> = {
  real: {
    label: "real",
    statusCategory: "working",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    accentColor: "#10b981",
  },
  fallback: {
    label: "fallback",
    statusCategory: "reviewing",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    accentColor: "#f59e0b",
  },
  stub: {
    label: "stub",
    statusCategory: "error",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    accentColor: "#f43f5e",
  },
  missing: {
    label: "missing",
    statusCategory: "thinking",
    className: "border-slate-200 bg-slate-50 text-slate-600",
    accentColor: "#94a3b8",
  },
};

export function getRoleRuntimeVisual(
  runtimeState: RoleRuntimeState | undefined | null
): RoleRuntimeVisual | null {
  if (!runtimeState) return null;
  if (runtimeState.status === "failed") {
    return VISUAL_BY_KIND.stub;
  }
  return VISUAL_BY_KIND[runtimeState.runtimeKind] ?? VISUAL_BY_KIND.missing;
}
