/**
 * @description Typed-stage brainstorm impact stats (autopilot-brainstorm-real-collaboration).
 *
 * Answers the question "is the debate actually changing the product, or just
 * running?" for the typed-stage wiring (route_generation / spec_tree /
 * effect_preview / prompt_packaging / engineering_handoff). At those stages the
 * brainstorm synthesis is parsed into the stage's typed output; if the parse
 * fails the pipeline falls back to the deterministic single-agent output and
 * the debate is effectively discarded.
 *
 * This module is a process-lifetime in-memory counter (same lifetime model as
 * the runtime diagnostics store). It only records outcomes for stages where
 * brainstorm was actually enabled, so `parsed / (parsed + fallback)` is the
 * real "debate influenced the typed output" rate — not diluted by the
 * brainstorm-disabled path.
 *
 * Includes low-impact warning (task 2.4): when overall parseSuccessRate drops
 * below threshold after sufficient samples, the snapshot carries a
 * `lowImpactWarning` object. Callers (e.g. wrapTypedBlueprintStage or
 * diagnostics consumers) can log or surface it.
 *
 * Pure, synchronous, never-throws. No env reads here; the caller decides
 * whether brainstorm was enabled before recording.
 */

export type TypedStageOutcome = "parsed" | "fallback";

interface StageCounter {
  parsed: number;
  fallback: number;
}

/** Thresholds for low debate impact warning (spec task 2.4 / Req 2.4). */
const LOW_RATE_THRESHOLD = 0.5;
const MIN_SAMPLES_FOR_WARNING = 5;

export interface TypedStageStatsSnapshot {
  /** Totals across all typed stages. */
  parsed: number;
  fallback: number;
  /** parsed / (parsed + fallback); 0 when no samples yet. */
  parseSuccessRate: number;
  /** Per-stage breakdown. */
  perStage: Record<string, { parsed: number; fallback: number; parseSuccessRate: number }>;

  /**
   * Populated when overall parseSuccessRate is below LOW_RATE_THRESHOLD
   * and we have at least MIN_SAMPLES_FOR_WARNING. Allows callers to
   * log/warn/surface that debate is frequently not influencing the typed product.
   */
  lowImpactWarning?: {
    rate: number;
    totalSamples: number;
    threshold: number;
    minSamples: number;
  };
}

const counters = new Map<string, StageCounter>();

/**
 * Record one typed-stage outcome. Call ONLY when brainstorm was enabled for the
 * stage, so the rate reflects the debate's real influence on the typed output.
 */
export function recordTypedStageOutcome(stageId: string, outcome: TypedStageOutcome): void {
  let counter = counters.get(stageId);
  if (!counter) {
    counter = { parsed: 0, fallback: 0 };
    counters.set(stageId, counter);
  }
  if (outcome === "parsed") counter.parsed += 1;
  else counter.fallback += 1;
}

function rate(parsed: number, fallback: number): number {
  const total = parsed + fallback;
  return total === 0 ? 0 : parsed / total;
}

/** Read-only snapshot of typed-stage debate-impact counters. */
export function getTypedStageStats(): TypedStageStatsSnapshot {
  let parsed = 0;
  let fallback = 0;
  const perStage: TypedStageStatsSnapshot["perStage"] = {};
  for (const [stageId, counter] of counters.entries()) {
    parsed += counter.parsed;
    fallback += counter.fallback;
    perStage[stageId] = {
      parsed: counter.parsed,
      fallback: counter.fallback,
      parseSuccessRate: rate(counter.parsed, counter.fallback),
    };
  }

  const total = parsed + fallback;
  const parseSuccessRate = rate(parsed, fallback);

  const snapshot: TypedStageStatsSnapshot = {
    parsed,
    fallback,
    parseSuccessRate,
    perStage,
  };

  if (total >= MIN_SAMPLES_FOR_WARNING && parseSuccessRate < LOW_RATE_THRESHOLD) {
    snapshot.lowImpactWarning = {
      rate: parseSuccessRate,
      totalSamples: total,
      threshold: LOW_RATE_THRESHOLD,
      minSamples: MIN_SAMPLES_FOR_WARNING,
    };
  }

  return snapshot;
}

/** Test-only reset. */
export function __resetTypedStageStatsForTest(): void {
  counters.clear();
}
