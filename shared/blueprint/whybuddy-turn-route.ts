/**
 * S9: Deterministic turn-route projection from runtime-recorded facts.
 * Zero LLM, zero V5SessionState writes.
 */

export type GoalStatusValue = "clear" | "needs_refinement" | "not_recommended" | undefined;

export type PlanSourceValue = "llm" | "heuristic_fallback" | "local_heuristic" | null | undefined;

export type TurnRouteFacts = {
  turnId: string;
  timestamp?: string;
  interventionIntent?: string | null;
  challengeTargetLabel?: string | null;

  staleArtifactIdsBefore?: string[];
  staleArtifactIdsAfter?: string[];
  goalStatusBefore?: GoalStatusValue;
  /** Post-invalidate status (challenge turns) — drives stale-cascade downgrade copy. */
  goalStatusAfterInvalidate?: GoalStatusValue;
  goalStatusAfter?: GoalStatusValue;

  planReason?: string;
  planSelectedCount?: number;
  planSource?: PlanSourceValue;
  dledgerDecisionId?: string | null;

  committedCount?: number;
  trustPassedCount?: number;
  trustTotalCount?: number;

  runtimePhase?: "awaiting" | "orchestrating" | "idle" | "failed";
};

export type RouteStationKind =
  | "intake"
  | "stale_cascade"
  | "plan"
  | "budget_block"
  | "execution"
  | "trust_gate"
  | "verdict"
  | "await";

export type RouteStationTone =
  | "process"
  | "reconverge"
  | "pass"
  | "partial"
  | "fail"
  | "pending"
  | "active";

export type RouteStation = {
  id: string;
  kind: RouteStationKind;
  title: string;
  detail?: string;
  tone: RouteStationTone;
  timestamp?: string;
  sessionId?: string;
  dledgerDecisionId?: string;
  summaryToken?: string;
};

const FORBIDDEN_TERMS =
  /\b(stale|artifact|capability|provenance|orchestrator|upstream|gate)\b|intent\.|risk\.analyze|report\.write/i;

export function goalStatusUserLabel(status: GoalStatusValue): string {
  if (status === "clear") return "已收敛";
  if (status === "not_recommended") return "不建议";
  return "待细化";
}

function planSourceUserLabel(source: PlanSourceValue): string | null {
  if (!source) return null;
  if (source === "llm") return "智能调度";
  return "规则调度";
}

export function staleAddedCount(facts: TurnRouteFacts): number {
  const before = new Set(facts.staleArtifactIdsBefore || []);
  const after = facts.staleArtifactIdsAfter || [];
  return after.filter((id) => !before.has(id)).length;
}

function isBudgetBlocked(facts: TurnRouteFacts): boolean {
  return String(facts.planReason || "").startsWith("BUDGET_EXCEEDED");
}

function hasPlanData(facts: TurnRouteFacts): boolean {
  return (
    facts.planSource != null &&
    typeof facts.planSelectedCount === "number" &&
    Boolean(facts.dledgerDecisionId)
  );
}

function trustCounts(facts: TurnRouteFacts): { passed: number; total: number } | null {
  if (typeof facts.trustTotalCount !== "number" || facts.trustTotalCount <= 0) return null;
  const total = facts.trustTotalCount;
  const passed = Math.min(total, Math.max(0, facts.trustPassedCount ?? 0));
  return { passed, total };
}

export function deriveTurnRoute(facts: TurnRouteFacts): RouteStation[] {
  const stations: RouteStation[] = [];
  const challenged = facts.interventionIntent === "challenge";
  const budgetBlocked = isBudgetBlocked(facts);

  stations.push({
    id: `${facts.turnId}-intake`,
    kind: "intake",
    title: challenged ? "收到质疑" : "收到",
    detail: challenged && facts.challengeTargetLabel
      ? `针对「${facts.challengeTargetLabel}」`
      : undefined,
    tone: challenged ? "reconverge" : "process",
    timestamp: facts.timestamp,
    summaryToken: challenged ? "收到质疑" : "收到",
  });

  const delta = staleAddedCount(facts);
  if (challenged && delta > 0) {
    const before = goalStatusUserLabel(facts.goalStatusBefore);
    const after = goalStatusUserLabel(
      facts.goalStatusAfterInvalidate ?? facts.goalStatusAfter ?? "needs_refinement"
    );
    stations.push({
      id: `${facts.turnId}-stale`,
      kind: "stale_cascade",
      title: "撤回级联",
      detail: `${delta} 个产物已过期 · 结论从「${before}」降级为「${after}」`,
      tone: "reconverge",
      summaryToken: `撤回 ${delta}`,
    });
  }

  if (hasPlanData(facts)) {
    const n = facts.planSelectedCount ?? 0;
    const src = planSourceUserLabel(facts.planSource);
    stations.push({
      id: `${facts.turnId}-plan`,
      kind: "plan",
      title: "规划",
      detail: `选定 ${n} 个动作${budgetBlocked ? "" : "回补缺口"}${src ? ` · ${src}` : ""}`,
      tone: "process",
      dledgerDecisionId: facts.dledgerDecisionId || undefined,
      summaryToken: "规划",
    });
  }

  if (budgetBlocked) {
    stations.push({
      id: `${facts.turnId}-budget`,
      kind: "budget_block",
      title: "预算拦截",
      detail: "本轮推演已暂停，未调度新动作",
      tone: "fail",
      summaryToken: "预算拦截",
    });
  } else if (typeof facts.planSelectedCount === "number" && facts.planSelectedCount > 0) {
    stations.push({
      id: `${facts.turnId}-exec`,
      kind: "execution",
      title: "推演",
      tone: "process",
      summaryToken: `推演 ${facts.planSelectedCount}`,
    });
  }

  if (!budgetBlocked) {
    const trust = trustCounts(facts);
    if (trust) {
      const allPass = trust.passed === trust.total;
      stations.push({
        id: `${facts.turnId}-trust`,
        kind: "trust_gate",
        title: "信任校验",
        detail: allPass
          ? `${trust.passed}/${trust.total} 通过信任门`
          : `${trust.passed}/${trust.total} 通过信任门`,
        tone: allPass ? "pass" : "partial",
        summaryToken: `校验 ${trust.passed}/${trust.total}`,
      });
    }

    const before = facts.goalStatusBefore;
    const after = facts.goalStatusAfter ?? before;
    const beforeLabel = goalStatusUserLabel(before);
    const afterLabel = goalStatusUserLabel(after);
    const changed = before !== after && after != null;
    const notRec = after === "not_recommended";

    stations.push({
      id: `${facts.turnId}-verdict`,
      kind: "verdict",
      title: "裁决",
      detail: changed
        ? `${beforeLabel} → ${afterLabel}(机械裁决)`
        : `${afterLabel}(机械裁决)`,
      tone: notRec ? "fail" : after === "clear" ? "pass" : "process",
      summaryToken: afterLabel,
    });
  }

  stations.push({
    id: `${facts.turnId}-await`,
    kind: "await",
    title: "等待你",
    detail: facts.runtimePhase === "awaiting" ? undefined : undefined,
    tone: "pending",
    summaryToken: "等待你",
  });

  return stations;
}

/** One-line collapsed summary — same tokens as expanded route (S9-A5). */
export function buildRouteSummary(stations: RouteStation[]): string {
  const tokens = stations
    .map((s) => s.summaryToken)
    .filter((t): t is string => Boolean(t) && t !== "等待你" && t !== "收到");
  const head = stations.find((s) => s.kind === "intake")?.summaryToken || "收到";
  const tail = stations.find((s) => s.kind === "verdict")?.summaryToken;
  const middle = tokens.filter((t) => t !== head && t !== tail);
  const parts = [head, ...middle, ...(tail ? [tail] : [])];
  return `${parts.join(" → ")} ▸`;
}

export function assertRouteCopySanitized(stations: RouteStation[]): void {
  for (const s of stations) {
    const blob = `${s.title} ${s.detail || ""}`;
    if (FORBIDDEN_TERMS.test(blob)) {
      throw new Error(`Route copy contains forbidden term: ${blob}`);
    }
  }
}