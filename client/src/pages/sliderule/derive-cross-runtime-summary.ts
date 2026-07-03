import type { CrossRuntimeGraph } from "@/lib/skills/orchestrator";
import type { AppBundleRuntimeClosureReport } from "@/lib/skills/appbundle/appBundleSkill";
import type {
  AppBundleClosureTier,
  AppBundleRollbackClosureDiffEvidence,
} from "@/lib/skills/appbundle/appBundleModel";

export type CrossRuntimeGraphSummary = {
  edgeCount: number;
  allowedCount: number;
  blockedCount: number;
  skillCount: number;
  evidenceCount: number;
  examples: Array<{
    sourceSkill: string;
    targetSkill: string;
    state: string;
    evidenceKey?: string;
  }>;
};

export type PublishClosureSummary = {
  blocked: boolean;
  blockerCount: number;
  evidencePresentCount: number;
  skillCount: number;
  versionPinsChecked: boolean;
  closureId?: string;
  closureHash?: string;
  generatedAt?: string;
  stableDigest?: string;
  tierCounts: Record<AppBundleClosureTier, number>;
  topBlockers: Array<{
    code: string;
    path: string;
    affectedSkill?: string;
    ref?: string;
  }>;
  perSkillEvidence?: Record<
    "datamodel" | "rbac" | "workflow" | "page" | "aigc" | "appbundle",
    { evidencePresent?: boolean } | undefined
  >;
};

export type RollbackClosureDiffSummary = {
  digestMatch: boolean;
  changedRefCount: number;
  evidencePresentCountCurrent?: number;
  evidencePresentCountTarget?: number;
  degraded?: boolean;
  currentVersion?: string;
  targetVersion?: string;
  currentStableDigest?: string;
  targetStableDigest?: string;
};

export function normalizeBlockerForRender(
  blocker: { code?: string; path?: string; affectedSkill?: string; ref?: string } | null | undefined
): {
  code: string;
  path: string;
  affectedSkill?: string;
  ref?: string;
} {
  return {
    code: String(blocker?.code || "UNKNOWN_BLOCKER"),
    path: String(blocker?.path || ""),
    affectedSkill: blocker?.affectedSkill,
    ref: blocker?.ref,
  };
}

export function renderPublishClosureBlocker(
  blocker: { code?: string; path?: string; affectedSkill?: string; ref?: string } | null | undefined
): string {
  const b = normalizeBlockerForRender(blocker);
  const skill = b.affectedSkill ? ` skill=${b.affectedSkill}` : "";
  const path = b.path ? ` path=${b.path}` : "";
  const ref = b.ref ? ` ref=${b.ref}` : "";
  return `${b.code}${skill}${path}${ref}`;
}

export function deriveCrossRuntimeGraphSummary(
  graph: CrossRuntimeGraph | null | undefined,
  options: { exampleLimit?: number } = {}
): CrossRuntimeGraphSummary | null {
  const edges = graph?.edges ?? [];
  if (edges.length === 0) return null;

  const exampleLimit = options.exampleLimit ?? 4;
  const allowedCount = edges.filter((edge) => edge.state === "allowed").length;
  const blockedCount = edges.length - allowedCount;
  const skillIds = new Set<string>();
  for (const edge of edges) {
    skillIds.add(edge.sourceSkill);
    skillIds.add(edge.targetSkill);
  }

  const evidenceCount = Object.values(graph?.evidenceBySkill ?? {}).reduce(
    (sum, keys) => sum + keys.length,
    0
  );

  return {
    edgeCount: edges.length,
    allowedCount,
    blockedCount,
    skillCount: skillIds.size,
    evidenceCount,
    examples: edges.slice(0, exampleLimit).map((edge) => ({
      sourceSkill: edge.sourceSkill,
      targetSkill: edge.targetSkill,
      state: edge.state,
      evidenceKey: edge.evidenceKey,
    })),
  };
}

export function derivePublishClosureSummary(
  report: AppBundleRuntimeClosureReport | null | undefined,
  options: { blockerLimit?: number } = {}
): PublishClosureSummary | null {
  if (!report?.runtimeClosure) return null;

  const blockerLimit = options.blockerLimit ?? 3;
  const perSkillEvidence = Object.values(report.perSkillEvidence ?? {});
  const evidencePresentCount = perSkillEvidence.filter((entry) => entry.evidencePresent).length;
  const findingsByTier = report.findingsByTier ?? {
    hard_blocker: [],
    warning: [],
    info: [],
  };

  return {
    blocked: report.blocked,
    blockerCount: report.blockers.length,
    evidencePresentCount,
    skillCount: report.runtimeClosure.skillsChecked.length,
    versionPinsChecked: report.runtimeClosure.versionPinsChecked,
    closureId: report.closureId,
    closureHash: report.closureHash,
    generatedAt: report.generatedAt,
    stableDigest: report.stableDigest,
    tierCounts: {
      hard_blocker: findingsByTier.hard_blocker?.length ?? 0,
      warning: findingsByTier.warning?.length ?? 0,
      info: findingsByTier.info?.length ?? 0,
    },
    topBlockers: report.blockers.slice(0, blockerLimit).map((blocker) => {
      const normalized = normalizeBlockerForRender(blocker);
      return {
        code: normalized.code,
        path: normalized.path,
        affectedSkill: normalized.affectedSkill,
        ref: normalized.ref,
      };
    }),
    perSkillEvidence: report.perSkillEvidence as PublishClosureSummary["perSkillEvidence"],
  };
}

export function selectPublishClosureSummary(
  pythonClosure: PublishClosureSummary | null | undefined,
  previewClosure: PublishClosureSummary | null | undefined
): PublishClosureSummary | null {
  return pythonClosure ?? previewClosure ?? null;
}

export function deriveRollbackClosureDiffSummary(
  diff: AppBundleRollbackClosureDiffEvidence | null | undefined
): RollbackClosureDiffSummary | null {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return null;

  const raw = diff as Partial<AppBundleRollbackClosureDiffEvidence>;
  const changedRefCount = Array.isArray(raw.changedPerSkillRefs)
    ? raw.changedPerSkillRefs.length
    : 0;
  const hasDigestDecision = typeof raw.digestMatch === "boolean";

  return {
    digestMatch: hasDigestDecision ? raw.digestMatch === true : false,
    changedRefCount,
    evidencePresentCountCurrent: raw.evidencePresentCountCurrent,
    evidencePresentCountTarget: raw.evidencePresentCountTarget,
    degraded: hasDigestDecision ? raw.degraded === true : true,
    currentVersion: raw.currentVersion,
    targetVersion: raw.targetVersion,
    currentStableDigest: raw.currentStableDigest,
    targetStableDigest: raw.targetStableDigest,
  };
}

export function selectRollbackClosureDiffSummary(
  primary: RollbackClosureDiffSummary | null | undefined,
  fallback: RollbackClosureDiffSummary | null | undefined
): RollbackClosureDiffSummary | null {
  return primary ?? fallback ?? null;
}

/**
 * Produces compact closure status and top blockers text for inclusion
 * in AgentLoop final report text. Deterministic, no side effects.
 * Supports both closed (positive) and blocked (fail-closed negative) cases.
 */
export function formatClosureStatusAndTopBlockersForFinalReport(
  summary: PublishClosureSummary | null | undefined
): string {
  if (!summary) {
    return "closure status: unknown\ntop blockers: n/a";
  }
  const status = summary.blocked ? "blocked" : "closed";
  const topBlockersText =
    Array.isArray(summary.topBlockers) && summary.topBlockers.length > 0
      ? summary.topBlockers
          .map((b: any) => `${String(b.code || "UNKNOWN")}${b.path ? "@" + b.path : ""}`)
          .join("; ")
      : "none";
  return [
    `closure status: ${status}`,
    `top blockers: ${topBlockersText}`,
    `evidence: ${summary.evidencePresentCount}/${summary.skillCount}`,
    `pinsChecked: ${summary.versionPinsChecked}`,
    `closureHash: ${summary.closureHash ?? "n/a"}`,
  ].join("\n");
}

// Baseline-safe fixtures for frontend typecheck post-closure integration (119 precheck-03).
// These typed constants ensure PublishClosureSummary schema and closure fields (blocked/evidence/tiers) are exercised by tsc --noEmit.
// Positive evidence case (clean closure) and fail-closed negative case (blocked) included for deterministic coverage.
export const BASELINE_SAFE_PUBLISH_CLOSURE_SUMMARY: PublishClosureSummary = {
  blocked: false,
  blockerCount: 0,
  evidencePresentCount: 6,
  skillCount: 6,
  versionPinsChecked: true,
  closureId: "appbundle-closure-119-baseline",
  closureHash: "sha256-closure-baseline-000",
  stableDigest: "digest-119-frontend-precheck",
  tierCounts: { hard_blocker: 0, warning: 1, info: 3 },
  topBlockers: [],
};

export const BASELINE_SAFE_PUBLISH_CLOSURE_BLOCKED: PublishClosureSummary = {
  blocked: true,
  blockerCount: 2,
  evidencePresentCount: 2,
  skillCount: 6,
  versionPinsChecked: true,
  closureId: "appbundle-closure-119-blocked",
  closureHash: "sha256-closure-blocked-001",
  stableDigest: "digest-119-blocked",
  tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
  topBlockers: [
    { code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", path: "versionPins.datamodel", affectedSkill: "datamodel", ref: undefined },
    { code: "APPBUNDLE_REF_MISSING_ENTITY", path: "entityRefs[0]", affectedSkill: "datamodel", ref: "Order" },
  ],
};
