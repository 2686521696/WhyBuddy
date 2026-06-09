/**
 * @description Brainstorm Pipeline Integration — standalone module demonstrating
 * how the brainstorm orchestrator integrates with the autopilot pipeline.
 *
 * Exports integration functions for:
 * - Service context assembly (lazy initialization)
 * - Decision Gate invocation at stage start
 * - Routing to orchestrator vs single-agent
 * - Graceful degradation when brainstorm is disabled or fails
 * - Event emission when mode is chosen
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §1, §2
 * Requirements: 1.1, 1.3, 1.4, 3.5, 8.3, 10.1, 10.3
 */

import type {
  BrainstormSession,
  DecisionGateInput,
  DecisionGateOutput,
  SynthesisResult,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  decide,
  routeDecision,
  getGateDecisionStats,
  type LLMCallerFn,
  type EventEmitterFn,
  type RoutingResult,
} from "./decision-gate";
import { BrainstormOrchestrator } from "./orchestrator";
import { BrainstormSynthesizer } from "./synthesizer";
import {
  BrainstormMemoryStore,
  buildSessionArtifact,
} from "./memory-store";
import { resolveStageConfig } from "./stage-config";
import {
  buildBrainstormEvidence,
  writeEvidenceToLedger,
  writeSynthesisAuditToLedger,
} from "./evidence-trail";
import { createPoolBackedBrainstormCaller } from "./pool-llm-caller";
import { parseKeyPoolFromEnv } from "../llm-key-pool";
import { auditSynthesis } from "./synthesis-audit";
import { getTypedStageStats } from "./typed-stage-stats";
import { emitReasoningGraphArtifact } from "./reasoning-graph-emitter";
import type { BrainstormReasoningGraphArtifactPayload } from "../../../../shared/blueprint/brainstorm-reasoning-graph";
import type {
  BrainstormDecisionMarker,
  BrainstormRuntimeGraphEvent,
} from "../../../../shared/blueprint/brainstorm-runtime-graph";
import type { ChecksLedgerService } from "../checks-ledger/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Service context for the brainstorm subsystem. */
export interface BrainstormServiceContext {
  orchestrator: BrainstormOrchestrator;
  synthesizer: BrainstormSynthesizer;
  memoryStore: BrainstormMemoryStore;
  enabled: boolean;
  /**
   * Primary-model caller (gpt-5.5 via `LLM_*`). Used for synthesis, the
   * Decision Gate, and synthesis audit — physically distinct from the
   * pool-backed aux caller that drives the orchestrator's debate.
   */
  primaryCaller: LLMCallerFn;
  checksLedger?: Pick<ChecksLedgerService, "recordCheck">;
}

/** Stage context passed from the autopilot pipeline. */
export interface StageContext {
  jobId: string;
  stageId: string;
  stageDescription: string;
  degradedBridges: string[];
  previousStageOutputs?: string[];
}

/** Result of running a pipeline stage (either single-agent or brainstorm). */
export interface StageResult {
  type: "single-agent" | "brainstorm";
  output: string;
  synthesisResult?: SynthesisResult;
  sessionId?: string;
  /**
   * Set when the primary-model synthesis audit flagged the result as
   * `needs_review` (e.g. unsupported by evidence, too many unresolved
   * challenges). Dissent is surfaced, never silently dropped.
   */
  needsReview?: boolean;
  /** Human-readable reasons from the synthesis audit when `needsReview`. */
  auditReasons?: string[];
}

// ---------------------------------------------------------------------------
// Service Context Assembly (Task 16.1)
// ---------------------------------------------------------------------------

/**
 * Lazily assemble the brainstorm service context.
 * Only initializes when BLUEPRINT_BRAINSTORM_ENABLED is "true".
 *
 * Follows the same pattern as `roleAgentDelegator` assembly in the codebase.
 */
export function assembleBrainstormContext(
  llmCaller: LLMCallerFn,
  emitEvent: EventEmitterFn,
): BrainstormServiceContext | null {
  const enabled = process.env.BLUEPRINT_BRAINSTORM_ENABLED === "true";

  if (!enabled) {
    return null;
  }

  // Model split (Req 1.1, 2.1, 2.4, 8.1, 8.2): the debate (agent claims,
  // Critiques, Rebuttals, votes) runs on the aux pool (ouyi keys, concurrent),
  // while synthesis/audit AND adjudication stay on the primary model (gpt-5.5)
  // passed in as `llmCaller`. When the pool is not configured the aux caller
  // degrades to the primary caller (Req 1.3 / 8.4) — the two are still
  // referentially distinct fields so tests can count which phase used which.
  // Passing the primary `llmCaller` as the orchestrator's third arg wires it as
  // the Adjudicator (R8.2): aux pool drives debate, primary drives adjudication.
  const auxCaller = createPoolBackedBrainstormCaller() ?? llmCaller;
  const orchestrator = new BrainstormOrchestrator(auxCaller, emitEvent, llmCaller);
  const synthesizer = new BrainstormSynthesizer(llmCaller, emitEvent);
  const memoryStore = new BrainstormMemoryStore(emitEvent);

  return {
    orchestrator,
    synthesizer,
    memoryStore,
    enabled: true,
    primaryCaller: llmCaller,
  };
}

// ---------------------------------------------------------------------------
// Pipeline Stage Driver Integration (Task 16.2)
// ---------------------------------------------------------------------------

/**
 * Execute a pipeline stage with brainstorm decision gating.
 *
 * Flow:
 * 1. If brainstorm disabled → skip Decision Gate entirely, return single-agent
 * 2. Invoke Decision Gate
 * 3. If brainstormNeeded=false → continue single-agent path
 * 4. If brainstormNeeded=true → delegate to orchestrator
 * 5. Feed synthesis result back as stage output
 * 6. On any orchestrator error → graceful degradation to single-agent
 */
export async function executeStageWithBrainstorm(
  stageContext: StageContext,
  brainstormCtx: BrainstormServiceContext | null,
  llmCaller: LLMCallerFn,
  emitEvent: EventEmitterFn,
  singleAgentFallback: (context: StageContext) => Promise<string>,
  /**
   * Optional durable sink for the projected reasoning graph. When provided, the
   * companion persists the `brainstorm_reasoning_graph` payload as a job
   * artifact (the channel the client reads) in addition to emitting the
   * ephemeral event. Never-throw: persist failures are swallowed (Req 6.1).
   */
  onReasoningGraph?: (payload: BrainstormReasoningGraphArtifactPayload) => void,
): Promise<StageResult> {
  // When brainstorm is disabled via env, skip Decision Gate entirely (Req 10.1)
  if (!brainstormCtx || !brainstormCtx.enabled) {
    const output = await singleAgentFallback(stageContext);
    return { type: "single-agent", output };
  }

  // Build Decision Gate input
  const gateInput: DecisionGateInput = {
    jobId: stageContext.jobId,
    stageId: stageContext.stageId,
    stageContext: stageContext.stageDescription,
    degradedBridges: stageContext.degradedBridges,
    previousStageOutputs: stageContext.previousStageOutputs,
  };

  // Invoke Decision Gate
  let decision: DecisionGateOutput;
  try {
    decision = await decide(gateInput, llmCaller, emitEvent);
  } catch {
    // Decision Gate itself should never throw (has internal fallback),
    // but guard defensively
    const output = await singleAgentFallback(stageContext);
    return { type: "single-agent", output };
  }

  // Route based on decision
  emitEvent("brainstorm.gate.evaluated", {
    jobId: stageContext.jobId,
    stageId: stageContext.stageId,
    brainstormNeeded: decision.brainstormNeeded,
    recommendedMode: decision.recommendedMode,
    requiredRoles: decision.requiredRoles,
    requiredToolCategories: decision.requiredToolCategories,
    reasoning: decision.reasoning,
  });

  const routing = routeDecision(decision);
  emitDecisionGateRuntimeGraphEvents({
    stageContext,
    decision,
    routeType: routing.type,
    emitEvent,
  });

  if (routing.type === "single-agent") {
    const output = await singleAgentFallback(stageContext);
    return { type: "single-agent", output };
  }

  // Emit mode selected event (Task 16.4, Req 3.5)
  emitEvent("brainstorm.mode.selected", {
    jobId: stageContext.jobId,
    stageId: stageContext.stageId,
    mode: routing.sessionConfig!.mode,
    roles: routing.sessionConfig!.roles,
  });

  // Delegate to orchestrator (Req 1.4)
  try {
    const session = await brainstormCtx.orchestrator.startSession({
      jobId: stageContext.jobId,
      stageId: stageContext.stageId,
      mode: routing.sessionConfig!.mode,
      roles: routing.sessionConfig!.roles,
      toolCategories: routing.sessionConfig!.toolCategories,
      stageContext: stageContext.stageDescription,
    });

    // Wait for session to complete (poll-based for simplicity)
    const completedSession = await waitForSessionCompletion(
      brainstormCtx.orchestrator,
      session.id,
    );

    if (!completedSession) {
      // Session failed or timed out — graceful degradation (Req 10.1)
      emitEvent("brainstorm.degraded", {
        sessionId: session.id,
        reason: "Session did not complete within expected time",
        affectedComponent: "pipeline-integration",
        fallbackAction: "single-agent",
      });
      const output = await singleAgentFallback(stageContext);
      return { type: "single-agent", output };
    }

    if (completedSession.status === "failed") {
      emitEvent("brainstorm.degraded", {
        sessionId: session.id,
        reason: "Session failed before synthesis",
        affectedComponent: "pipeline-integration",
        fallbackAction: "single-agent",
      });
      const output = await singleAgentFallback(stageContext);
      return { type: "single-agent", output };
    }

    let finalSession = completedSession;
    if (completedSession.status === "synthesizing") {
      const synthesisResult = await brainstormCtx.synthesizer.synthesize(
        buildSynthesisInput(completedSession, stageContext.stageDescription),
      );
      finalSession =
        brainstormCtx.orchestrator.completeSynthesis(session.id, synthesisResult) ??
        completedSession;
    }

    // Build and persist artifact (Req 8.4)
    const artifact = buildSessionArtifact(finalSession);
    brainstormCtx.memoryStore.persist(artifact);
    writeEvidenceToLedger({
      checksLedger: brainstormCtx.checksLedger,
      evidence: buildBrainstormEvidence({
        session: finalSession,
        roundCount:
          finalSession.deliberationSummary?.roundCount ??
          countDeliberationRounds(finalSession),
        finalConvergenceScore:
          finalSession.deliberationSummary?.finalConvergenceScore ??
          extractFinalConvergenceScore(finalSession),
      }),
    });
    // Note (brainstorm-debate-integrity-observability 4.2): This write is reached
    // for *all* stages that run a real brainstorm session, whether they came in
    // via wrapTypedBlueprintStage (typed product path) or via
    // runSecondStageBrainstormCompanion (side-channel for intake/clarification/spec_docs).
    // The companion explicitly calls executeStageWithBrainstorm, so evidence +
    // synthesis-audit are written for side-channel stages too.

    // Extract synthesis result as stage output (Req 8.3)
    const synthesisResult = finalSession.synthesisResult;
    const output = synthesisResult?.decision ?? "Brainstorm completed without synthesis.";

    // Project the final session into a brainstorm_reasoning_graph artifact and
    // push it on the existing event channel so the 3D wall renders the debate
    // (Req 3.3). The helper never throws — projection/emit failures are
    // swallowed (logged at debug) and must not affect the job (Req 6.1).
    emitReasoningGraphArtifact({
      session: finalSession,
      centralQuestionTitle: stageContext.stageDescription,
      emitEvent,
      persist: onReasoningGraph,
    });

    // Primary-model synthesis audit (Req 2.2, 2.3, 6.1). Non-blocking: the
    // audit never throws, and any ledger write failure is swallowed. When the
    // audit flags `needs_review` we annotate the StageResult so dissent is
    // surfaced rather than silently dropped.
    let needsReview: boolean | undefined;
    let auditReasons: string[] | undefined;
    if (synthesisResult) {
      try {
        const audit = await auditSynthesis({
          synthesis: synthesisResult,
          session: finalSession,
          primaryCaller: brainstormCtx.primaryCaller,
        });
        writeSynthesisAuditToLedger({
          checksLedger: brainstormCtx.checksLedger,
          jobId: finalSession.jobId,
          stageId: finalSession.stageId,
          sessionId: finalSession.id,
          audit,
        });
        if (audit.status === "needs_review") {
          needsReview = true;
          auditReasons = audit.reasons;
        }
      } catch {
        // Audit/ledger failures must never block stage completion (Req 6.1).
      }
    }

    return {
      type: "brainstorm",
      output,
      synthesisResult: synthesisResult ?? undefined,
      sessionId: session.id,
      needsReview,
      auditReasons,
    };
  } catch (err) {
    // Graceful degradation: on unrecoverable error, fall back to single-agent (Req 10.1, 10.3)
    emitEvent("brainstorm.degraded", {
      sessionId: "",
      reason: `Orchestrator error: ${err instanceof Error ? err.message : String(err)}`,
      affectedComponent: "pipeline-integration",
      fallbackAction: "single-agent",
    });
    const output = await singleAgentFallback(stageContext);
    return { type: "single-agent", output };
  }
}

function emitDecisionGateRuntimeGraphEvents(input: {
  stageContext: StageContext;
  decision: DecisionGateOutput;
  routeType: RoutingResult["type"];
  emitEvent: EventEmitterFn;
}): void {
  const { stageContext, decision, routeType, emitEvent } = input;
  const sessionId = `decision-gate:${stageContext.jobId}:${stageContext.stageId}`;
  const occurredAt = new Date().toISOString();
  const marker: BrainstormDecisionMarker =
    routeType === "brainstorm-session" ? "BRANCH" : "CONTINUE";

  const base = {
    jobId: stageContext.jobId,
    sessionId,
    stage: stageContext.stageId,
    occurredAt,
    roleId: "decision-gate",
    nodeId: "decision-gate",
    summary: decision.reasoning,
  } satisfies Pick<
    BrainstormRuntimeGraphEvent,
    | "jobId"
    | "sessionId"
    | "stage"
    | "occurredAt"
    | "roleId"
    | "nodeId"
    | "summary"
  >;

  emitEvent("decision.marker.emitted", {
    id: `${sessionId}:marker`,
    type: "decision.marker.emitted",
    ...base,
    marker,
    rationale: decision.reasoning,
  } satisfies BrainstormRuntimeGraphEvent);

  emitEvent("edge.condition.evaluated", {
    id: `${sessionId}:edge-evaluated`,
    type: "edge.condition.evaluated",
    ...base,
    edgeId: "decision-gate:brainstorm",
    sourceNodeId: "decision-gate",
    targetNodeId: "brainstorm-orchestrator",
    condition: "brainstormNeeded === true",
    matched: decision.brainstormNeeded,
    reason: decision.reasoning,
  } satisfies BrainstormRuntimeGraphEvent);

  const edgeEvent: BrainstormRuntimeGraphEvent =
    routeType === "brainstorm-session"
      ? {
          id: `${sessionId}:edge-triggered`,
          type: "edge.triggered",
          ...base,
          edgeId: "decision-gate:brainstorm",
          sourceNodeId: "decision-gate",
          targetNodeId: "brainstorm-orchestrator",
          reason: decision.reasoning,
        }
      : {
          id: `${sessionId}:edge-suppressed`,
          type: "edge.suppressed",
          ...base,
          edgeId: "decision-gate:brainstorm",
          sourceNodeId: "decision-gate",
          targetNodeId: "brainstorm-orchestrator",
          reason: decision.reasoning || "Decision Gate kept the stage on single-agent path.",
        };

  emitEvent(edgeEvent.type, { ...edgeEvent });
}

function countDeliberationRounds(session: BrainstormSession): number {
  const seenRounds = new Set<number>();
  for (const node of session.branchNodes) {
    const match = node.title.match(/\bRound\s+(\d+)\b/i);
    if (match) {
      seenRounds.add(Number(match[1]));
    }
  }

  if (seenRounds.size > 0) {
    return seenRounds.size;
  }

  const completedMembers = Array.from(session.crewMembers.values()).filter(
    (member) => member.state === "completed" && member.output,
  ).length;
  const roleCount = Math.max(1, session.crewMembers.size);
  return Math.max(1, Math.floor(session.branchNodes.length / roleCount), completedMembers > 0 ? 1 : 0);
}

function extractFinalConvergenceScore(session: BrainstormSession): number {
  const scoreCandidates = session.branchNodes
    .map((node) => node.confidence)
    .filter((value): value is number => typeof value === "number");
  if (scoreCandidates.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, Math.max(...scoreCandidates)));
}

// ---------------------------------------------------------------------------
// Diagnostics Extension (Task 15.1)
// ---------------------------------------------------------------------------

/**
 * Get brainstorm orchestrator diagnostics for the diagnostics endpoint.
 * Returns null if brainstorm is not enabled.
 */
export function getBrainstormDiagnostics(
  brainstormCtx: BrainstormServiceContext | null,
) {
  const stageConfig = resolveStageConfig();
  const perStageConfig = Object.fromEntries(
    Object.entries(stageConfig.perStage).map(([stage, enabled]) => [
      stage,
      stageConfig.masterEnabled && enabled,
    ]),
  );

  // Pool usage (Req 5.2): surface whether the aux key pool is configured and
  // how many keys it carries, so operators can confirm the pool-backed
  // concurrent debate path is actually wired (vs. degrading to the single
  // primary caller). Read-only: `parseKeyPoolFromEnv` only inspects env, it
  // never starts a session or calls an LLM.
  const poolConfig = parseKeyPoolFromEnv();
  const pool = {
    configured: poolConfig !== undefined,
    keyCount: poolConfig?.keys.length ?? 0,
  };

  // Typed-stage debate impact (autopilot-brainstorm-real-collaboration): does the
  // debate actually change the typed output, or does it parse-fail and fall back
  // to deterministic single-agent? `parseSuccessRate` is the real influence rate.
  const typedStageStats = getTypedStageStats();

  const forceMode = (process.env.BLUEPRINT_BRAINSTORM_FORCE === "true");
  const gateDecisionStats = getGateDecisionStats();

  if (!brainstormCtx) {
    return {
      enabled: false,
      activeSessionsCount: 0,
      totalSessionsCompleted: 0,
      degradationCount: 0,
      averageSessionDurationMs: 0,
      tokenBudget: 0,
      toolCallLimit: 0,
      // Real structured-collaboration counts (R11.2): when brainstorm is
      // disabled / not assembled there is no deliberation, so these are 0.
      // Surfaced here too (additive) so the diagnostics shape is stable across
      // the enabled and disabled branches.
      critiqueCount: 0,
      rebuttalCount: 0,
      unresolvedCount: 0,
      adjudicationCount: 0,
      voteCount: 0,
      perStageConfig,
      pool,
      typedStageStats,
      forceMode,
      gateDecisionStats,
    };
  }

  return {
    ...brainstormCtx.orchestrator.getDiagnostics(),
    perStageConfig,
    pool,
    typedStageStats,
    forceMode,
    gateDecisionStats,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSynthesisInput(
  session: BrainstormSession,
  stageContext: string,
) {
  return {
    sessionId: session.id,
    mode: session.mode,
    stageContext,
    crewOutputs: Array.from(session.crewMembers.entries())
      .filter(([, member]) => member.state === "completed" && member.output)
      .map(([roleId, member]) => ({
        roleId,
        content: member.output!.content,
        confidence: member.output!.confidence,
      })),
    deliberationContext: session.deliberationSummary
      ? {
          challenges: session.deliberationSummary.challenges ?? [],
          rebuttals: session.deliberationSummary.rebuttals ?? [],
          dissentingOpinions:
            session.deliberationSummary.dissentingOpinions ?? [],
        }
      : undefined,
  };
}

/**
 * Wait for a brainstorm session to reach a terminal state.
 * Polls the orchestrator every 100ms, up to 130s total.
 */
async function waitForSessionCompletion(
  orchestrator: BrainstormOrchestrator,
  sessionId: string,
  maxWaitMs = 130_000,
): Promise<BrainstormSession | null> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < maxWaitMs) {
    const session = orchestrator.getSession(sessionId);
    if (!session) return null;

    if (
      session.status === "completed" ||
      session.status === "failed" ||
      session.status === "synthesizing"
    ) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return null;
}
