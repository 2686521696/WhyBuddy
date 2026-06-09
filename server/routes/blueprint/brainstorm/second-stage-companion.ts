/**
 * @description Second-stage brainstorm companion — CONSERVATIVE side-channel.
 *
 * Task 6 of `autopilot-brainstorm-companion-runtime`. Wires the multi-agent
 * brainstorm companion so it can be triggered at the start of the second stage
 * (SPEC tree / SPEC docs) WITHOUT ever replacing the deterministic spec-document
 * generation.
 *
 * Design intent (conservative / side-channel):
 * - When `BLUEPRINT_BRAINSTORM_ENABLED === "true"` AND the per-stage config
 *   allows (see {@link isStageEnabled}), assemble the brainstorm context (the
 *   primary-model caller drives synthesis/audit; the pool-backed aux caller is
 *   auto-selected inside `assembleBrainstormContext`) and run
 *   {@link executeStageWithBrainstorm}.
 * - The synthesis result is treated as ADDITIVE context + wall projection ONLY.
 *   The single-agent fallback supplied here returns an empty string and the
 *   returned `StageResult.output` is intentionally discarded by the caller — the
 *   deterministic `generateSpecDocuments` path remains the source of truth and is
 *   never overwritten (Req 4.3; design Non-Goals: 不强制把辩论结论覆盖确定性生成).
 * - Any failure degrades silently: the helper never throws and never blocks the
 *   job (Req 6.1, 6.2). Callers fire it best-effort (fire-and-forget) so the
 *   deterministic 201 response is unaffected.
 * - With the flag off (or in `BUILD_TARGET=test` where the context is not
 *   assembled), this is a no-op and behavior is byte-for-byte unchanged (Req 4.4,
 *   6.2).
 *
 * @see .kiro/specs/autopilot-brainstorm-companion-runtime/design.md §"4. 第二阶段接线"
 * Requirements: 4.1, 4.2, 4.3, 4.4, 6.2
 */

import type { BrainstormEligibleStage } from "./stage-config.js";
import type {
  BrainstormServiceContext,
  StageContext,
  StageResult,
} from "./pipeline-integration.js";
import type { BlueprintLlmBridge } from "./llm-adapter.js";
import type { BrainstormReasoningGraphArtifactPayload } from "../../../../shared/blueprint/brainstorm-reasoning-graph.js";

import { isStageEnabled } from "./stage-config.js";
import { createLlmCallerAdapter } from "./llm-adapter.js";
import { createEventEmitterAdapter } from "./event-emitter-adapter.js";
import { executeStageWithBrainstorm } from "./pipeline-integration.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the conservative second-stage brainstorm companion. */
export interface SecondStageCompanionOptions {
  /**
   * Pre-assembled brainstorm service context (from `ctx.brainstormContext`).
   * Null/undefined when the master switch is off or assembly was skipped
   * (e.g. `BUILD_TARGET=test`) — in which case the companion no-ops.
   */
  brainstormContext: BrainstormServiceContext | null;
  /** LLM bridge for the brainstorm subsystem (primary-model caller source). */
  llm: BlueprintLlmBridge;
  /** Event bus used to project the reasoning graph + lifecycle events. */
  eventBus: { emit(event: Record<string, unknown>): void };
  /** Minimal logger; only used for best-effort debug/warn observability. */
  logger: {
    warn(msg: string, meta?: Record<string, unknown>): void;
    debug?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Current blueprint job ID. */
  jobId: string;
  /** Project ID for event metadata (optional). */
  projectId?: string;
  /**
   * The second-stage identifier. Defaults to `spec_docs` (SPEC document
   * generation) — the realistic driver entry for the second stage.
   */
  stageId?: BrainstormEligibleStage;
  /** Human-readable description of the stage (used as the central question). */
  stageDescription: string;
  /** Current job status for event metadata (optional). */
  jobStatus?: string;
  /** Summaries from prior completed stages (optional upstream context). */
  previousStageOutputs?: string[];
  /** Currently degraded capability bridges (optional). */
  degradedBridges?: string[];
  /**
   * Optional durable sink for the projected reasoning graph. When provided, the
   * companion persists the `brainstorm_reasoning_graph` payload as a job
   * artifact so the client's `readBrainstormReasoningGraphs(job)` path can
   * render the debate on the 3D wall. The ephemeral event is still emitted
   * regardless. Never-throw (Req 6.1) — persist failures are swallowed.
   */
  onReasoningGraph?: (payload: BrainstormReasoningGraphArtifactPayload) => void;
}

/** Result of attempting to run the second-stage companion. */
export interface SecondStageCompanionResult {
  /** True when the brainstorm session was actually triggered. */
  triggered: boolean;
  /**
   * The raw `StageResult` from `executeStageWithBrainstorm` when triggered.
   * Provided for additive/upstream-context use ONLY — callers MUST NOT use it
   * to replace the deterministic spec-document output.
   */
  stageResult?: StageResult;
  /** Why the companion did not trigger (for diagnostics / tests). */
  reason?: "stage-disabled" | "no-context" | "error";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the conservative second-stage brainstorm companion.
 *
 * Returns immediately (no trigger) when the per-stage config is disabled or the
 * brainstorm context is unavailable. Otherwise runs `executeStageWithBrainstorm`
 * with an empty single-agent fallback whose output is discarded — the debate is
 * projected to the 3D wall and audited, but never replaces deterministic
 * generation.
 *
 * NEVER throws: any error is caught and reported as `{ triggered: false }`.
 */
export async function runSecondStageBrainstormCompanion(
  options: SecondStageCompanionOptions,
): Promise<SecondStageCompanionResult> {
  const stageId: BrainstormEligibleStage = options.stageId ?? "spec_docs";

  // Gate 1: per-stage config (master `BLUEPRINT_BRAINSTORM_ENABLED` AND the
  // per-stage `BRAINSTORM_STAGE_*_ENABLED` flag). When the master switch is off
  // this is always false, so the flag-off path is a guaranteed no-op (Req 4.4).
  if (!isStageEnabled(stageId)) {
    return { triggered: false, reason: "stage-disabled" };
  }

  // Gate 2: the brainstorm context must be assembled and enabled. In
  // `BUILD_TARGET=test` the context is not assembled (Req 4.4), so this no-ops.
  if (!options.brainstormContext || !options.brainstormContext.enabled) {
    return { triggered: false, reason: "no-context" };
  }

  try {
    const stageCtx: StageContext = {
      jobId: options.jobId,
      stageId,
      stageDescription: options.stageDescription,
      degradedBridges: options.degradedBridges ?? [],
      previousStageOutputs: options.previousStageOutputs,
    };

    const llmCaller = createLlmCallerAdapter(options.llm);
    const emitEvent = createEventEmitterAdapter({
      eventBus: options.eventBus,
      logger: options.logger,
      jobId: options.jobId,
      stage: stageId,
      projectId: options.projectId,
      jobStatus: options.jobStatus,
    });

    // CONSERVATIVE: the single-agent fallback returns an empty string and the
    // returned StageResult.output is discarded by the caller. The deterministic
    // spec-doc generation is the source of truth and is never replaced — the
    // synthesis result is additive context + wall projection only (Req 4.3).
    const stageResult = await executeStageWithBrainstorm(
      stageCtx,
      options.brainstormContext,
      llmCaller,
      emitEvent,
      async () => "",
      options.onReasoningGraph,
    );

    // (brainstorm-debate-integrity-observability task 2.3): For side-channel
    // stages (intake/clarification/spec_docs) the "did a real synthesis/debate
    // happen" signal is provided by the writeEvidenceToLedger call that happens
    // inside executeStageWithBrainstorm (see pipeline-integration.ts).
    // The existence of a `brainstorm_deliberation` ledger entry (with
    // deliberationSummary counts) for these stages serves as the lightweight
    // "synthesisProduced" marker. No extra per-stage impact is needed here
    // because the output is intentionally discarded (conservative side-channel).

    return { triggered: true, stageResult };
  } catch (err) {
    // Best-effort: brainstorm errors must never block or break the job
    // (Req 6.1, 6.2). `executeStageWithBrainstorm` already degrades internally,
    // but we guard defensively so the companion never rejects.
    options.logger.warn(
      `[brainstorm] second-stage companion failed for "${stageId}": ${
        err instanceof Error ? err.message : String(err)
      }`,
      { jobId: options.jobId, stageId },
    );
    return { triggered: false, reason: "error" };
  }
}
