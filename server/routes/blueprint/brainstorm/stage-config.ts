/**
 * @description Per-stage configuration resolver for brainstorm Decision Gate.
 *
 * Resolves environment variables to determine whether brainstorm is enabled
 * for a given pipeline stage. Pure synchronous function — no LLM calls, no
 * network I/O. All reads come from process.env (or an injected env object).
 *
 * @see .kiro/specs/brainstorm-pipeline-hookup/design.md §1
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * ---------------------------------------------------------------------------
 * CUT PRINCIPLE / WIRING DISCIPLINE (brainstorm-debate-integrity-observability)
 * ---------------------------------------------------------------------------
 * "确定性必须赢的地方走 side-channel；辩论能安全改进产物的地方走 typed-stage。"
 *
 * - **Typed-Stage** (debate output can influence the formal stage product):
 *   Route the stage through `wrapTypedBlueprintStage` (in blueprint.ts).
 *   The brainstorm synthesis goes through stage-output-mapper + parse.
 *   On parse failure it safely falls back to the deterministic single-agent result.
 *   These stages: route_generation, spec_tree, effect_preview,
 *   prompt_packaging, engineering_handoff.
 *
 * - **Side-Channel / Companion** (debate runs for wall, audit, provenance only;
 *   output is intentionally discarded; deterministic path is always the single
 *   source of truth):
 *   Use `runSecondStageBrainstormCompanion` (fire-and-forget, never blocks,
 *   single-agent fallback returns empty string whose result is thrown away).
 *   These stages: intake, clarification, spec_docs.
 *
 *   Reasons (documented for "敢信" discipline — we do not lie to ourselves via flags):
 *   - intake: Too early (pre-job), raw input normalization. Debate (if enabled)
 *     only interrogates intent and projects to the 3D wall / ledger. No typed
 *     product artifact is produced by this stage that debate could improve.
 *   - clarification: Interactive (user directly answers questions). Debate runs
 *     as companion for wall/audit but does not rewrite the clarification session
 *     or its generated questions.
 *   - spec_docs: Core conservative constraint (see blueprint.ts around the
 *     generateSpecDocuments call). Deterministic generation is the ONLY truth
 *     source. Brainstorm is strictly additive side-channel for the wall and
 *     checks_ledger. This was an explicit design decision to "保下限不保上限".
 *
 * The per-stage BRAINSTORM_STAGE_*_ENABLED flags control whether the
 * corresponding wiring (typed or side-channel) actually runs the debate.
 * A flag being true for a side-channel-only stage does NOT mean "debate
 * improves the product output for that stage".
 *
 * When adding a new BrainstormEligibleStage, it MUST be classified above
 * first, then wired accordingly. See also:
 *   .kiro/specs/brainstorm-debate-integrity-observability/design.md
 *   .kiro/specs/brainstorm-debate-integrity-observability/requirements.md (Req 5)
 *
 * This file + the call sites in blueprint.ts are the single source of truth
 * for "what the flags actually mean in practice".
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The pipeline stages eligible for brainstorm decision gating. */
export type BrainstormEligibleStage =
  | "intake"
  | "clarification"
  | "route_generation"
  | "spec_tree"
  | "spec_docs"
  | "effect_preview"
  | "prompt_packaging"
  | "engineering_handoff";

/** Resolved brainstorm configuration. */
export interface BrainstormStageConfig {
  masterEnabled: boolean;
  perStage: Record<BrainstormEligibleStage, boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mapping from eligible stage to its corresponding environment variable.
 * Each per-stage var must equal exactly `"true"` (case-sensitive) to be enabled.
 */
const STAGE_ENV_MAP: Record<BrainstormEligibleStage, string> = {
  intake: "BRAINSTORM_STAGE_INTAKE_ENABLED",
  clarification: "BRAINSTORM_STAGE_CLARIFICATION_ENABLED",
  route_generation: "BRAINSTORM_STAGE_ROUTE_GENERATION_ENABLED",
  spec_tree: "BRAINSTORM_STAGE_SPEC_TREE_ENABLED",
  spec_docs: "BRAINSTORM_STAGE_SPEC_DOCS_ENABLED",
  effect_preview: "BRAINSTORM_STAGE_EFFECT_PREVIEW_ENABLED",
  prompt_packaging: "BRAINSTORM_STAGE_PROMPT_PACKAGING_ENABLED",
  engineering_handoff: "BRAINSTORM_STAGE_ENGINEERING_HANDOFF_ENABLED",
};

/** All eligible stage identifiers. */
export const ELIGIBLE_STAGES: BrainstormEligibleStage[] = Object.keys(
  STAGE_ENV_MAP,
) as BrainstormEligibleStage[];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves brainstorm configuration from environment variables.
 *
 * Master switch: `BLUEPRINT_BRAINSTORM_ENABLED` must equal `"true"`.
 * Per-stage: `BRAINSTORM_STAGE_{STAGE}_ENABLED` must equal `"true"`.
 *
 * @param env - Optional env object for testability. Defaults to `process.env`.
 * @returns Resolved configuration with master and per-stage booleans.
 */
export function resolveStageConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrainstormStageConfig {
  const masterEnabled = env.BLUEPRINT_BRAINSTORM_ENABLED === "true";

  const perStage = {} as Record<BrainstormEligibleStage, boolean>;
  for (const stage of ELIGIBLE_STAGES) {
    const envVar = STAGE_ENV_MAP[stage];
    perStage[stage] = env[envVar] === "true";
  }

  return { masterEnabled, perStage };
}

/**
 * Checks whether brainstorm is enabled for a specific stage.
 *
 * Returns `true` only when BOTH the master switch AND the per-stage switch
 * are set to exactly `"true"`. This is a logical AND — either switch being
 * off disables brainstorm for the stage.
 *
 * @param stageId - The pipeline stage to check.
 * @param env - Optional env object for testability. Defaults to `process.env`.
 */
export function isStageEnabled(
  stageId: BrainstormEligibleStage,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const config = resolveStageConfig(env);
  return config.masterEnabled && config.perStage[stageId];
}
