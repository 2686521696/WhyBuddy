/**
 * @description Decision Gate — LLM-driven decision point for multi-agent brainstorm.
 *
 * Determines whether a given autopilot pipeline stage should use multi-agent
 * brainstorming or continue with single-agent linear execution.
 *
 * Algorithm:
 * 1. Build LLM prompt from stage context, job ID, stage ID, and degradation state
 * 2. If any capability bridge is in fallback → bias toward brainstormNeeded=false
 * 3. Invoke LLM with structured JSON output schema
 * 4. Parse and validate response against DecisionGateOutput schema
 * 5. On failure/timeout → return { brainstormNeeded: false } + emit degraded event
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §1
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 10.3
 */

import type {
  CollaborationMode,
  BrainstormRoleId,
  DecisionGateInput,
  DecisionGateOutput,
  ToolCategory,
} from "../../../../shared/blueprint/brainstorm-contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LLM caller function signature — injectable for testing. */
export type LLMCallerFn = (
  prompt: string,
  options: { signal?: AbortSignal },
) => Promise<string>;

/** Event emitter function signature — injectable for testing. */
export type EventEmitterFn = (
  eventType: string,
  payload: Record<string, unknown>,
) => void;

/** Configuration for the Decision Gate. */
export interface DecisionGateConfig {
  /** Timeout in milliseconds for the LLM call. Defaults to 5000. */
  timeoutMs: number;
  /**
   * Force brainstorm ON for every stage, bypassing the LLM gate entirely.
   * When undefined, `decide()` reads `BLUEPRINT_BRAINSTORM_FORCE === "true"`
   * from the environment.
   *
   * WARNING: This is a **test / data-collection only** escape hatch (see Req 3
   * in brainstorm-debate-integrity-observability). It guarantees full debate
   * cost on every stage. Production runs should rely on the real gate decision.
   *
   * Forced mode guarantees `brainstormNeeded=true` even when capability bridges
   * are degraded (brainstorm only needs the LLM pool, not docker/mcp/github),
   * and skips the gate LLM call to save tokens.
   */
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_COLLABORATION_MODES: CollaborationMode[] = [
  "discussion",
  "vote",
  "division",
  "audit",
];

const VALID_ROLE_IDS: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
  "ui_previewer",
];

const VALID_TOOL_CATEGORIES: ToolCategory[] = [
  "docker",
  "mcp",
  "github",
  "skills",
];

/** Default fallback output when the Decision Gate cannot produce a valid result. */
export const FALLBACK_OUTPUT: DecisionGateOutput = {
  brainstormNeeded: false,
  recommendedMode: "discussion",
  requiredRoles: ["planner"],
  requiredToolCategories: [],
  reasoning: "Decision Gate fallback: single-agent execution.",
};

/**
 * Output used when brainstorm is forced ON for every stage
 * (`BLUEPRINT_BRAINSTORM_FORCE`).
 *
 * WARNING (brainstorm-debate-integrity-observability, Req 3):
 * This mode is intended **only for testing and pilot data collection**.
 * It bypasses the Decision Gate LLM entirely, guarantees brainstorm on every
 * stage (even when bridges are degraded), and forces full multi-role debate.
 *
 * Production / long-running use should leave BLUEPRINT_BRAINSTORM_FORCE unset
 * (or false) so that `decide()` runs the real gate and can produce measurable
 * "with debate vs without" signals.
 *
 * A multi-role discussion is requested so the companion always spins up a real
 * debate on the aux pool.
 */
export const FORCED_OUTPUT: DecisionGateOutput = {
  brainstormNeeded: true,
  recommendedMode: "discussion",
  requiredRoles: ["decider", "planner", "architect", "executor", "auditor"],
  requiredToolCategories: [],
  reasoning:
    "Brainstorm forced ON for every stage (BLUEPRINT_BRAINSTORM_FORCE=true). " +
    "This is a test/pilot mode only — see decision-gate.ts for details.",
};

// ------------------------------------------------------------------------
// Gate decision impact counters (brainstorm-debate-integrity-observability Req 3.2)
// Pure, synchronous, never-throws. Mirrors the style of typed-stage-stats.
// ------------------------------------------------------------------------

type GateDecision = "realTrue" | "realFalse" | "degraded" | "forced" | "degradedOverrideFalse";

const gateCounters = {
  realTrue: 0,
  realFalse: 0,
  degraded: 0,
  forced: 0,
  degradedOverrideFalse: 0,
};

export function recordGateDecision(decision: GateDecision): void {
  if (decision in gateCounters) {
    (gateCounters as any)[decision] += 1;
  }
}

export interface GateDecisionStats {
  realDecidedTrue: number;
  realDecidedFalse: number;
  degraded: number;
  forced: number;
  degradedOverrideFalse: number;
  total: number;
}

export function getGateDecisionStats(): GateDecisionStats {
  const total =
    gateCounters.realTrue +
    gateCounters.realFalse +
    gateCounters.degraded +
    gateCounters.forced +
    gateCounters.degradedOverrideFalse;
  return {
    realDecidedTrue: gateCounters.realTrue,
    realDecidedFalse: gateCounters.realFalse,
    degraded: gateCounters.degraded,
    forced: gateCounters.forced,
    degradedOverrideFalse: gateCounters.degradedOverrideFalse,
    total,
  };
}

/** Test-only reset. */
export function __resetGateDecisionStatsForTest(): void {
  gateCounters.realTrue = 0;
  gateCounters.realFalse = 0;
  gateCounters.degraded = 0;
  gateCounters.forced = 0;
  gateCounters.degradedOverrideFalse = 0;
}

// ---------------------------------------------------------------------------
// Prompt Construction
// ---------------------------------------------------------------------------

/**
 * Builds the LLM prompt for the Decision Gate.
 * Exported for testing.
 */
export function buildDecisionGatePrompt(input: DecisionGateInput): string {
  const degradationWarning =
    input.degradedBridges.length > 0
      ? `\n\nWARNING: The following capability bridges are currently in degraded/fallback state: ${input.degradedBridges.join(", ")}. ` +
        `Consider biasing toward brainstormNeeded=false to reduce resource pressure.`
      : "";

  return (
    `You are the Decision Gate for an autopilot pipeline stage.\n\n` +
    `Job ID: ${input.jobId}\n` +
    `Stage ID: ${input.stageId}\n` +
    `Stage Context:\n${input.stageContext}\n` +
    (input.previousStageOutputs && input.previousStageOutputs.length > 0
      ? `\nPrevious Stage Outputs:\n${input.previousStageOutputs.join("\n---\n")}\n`
      : "") +
    degradationWarning +
    `\n\nDecide whether multi-agent brainstorming is needed for this stage.\n` +
    `Respond with a JSON object containing:\n` +
    `- brainstormNeeded: boolean\n` +
    `- recommendedMode: one of "discussion" | "vote" | "division" | "audit"\n` +
    `- requiredRoles: array of role IDs from ["decider", "planner", "architect", "executor", "auditor", "ui_previewer"]\n` +
    `- requiredToolCategories: array from ["docker", "mcp", "github", "skills"]\n` +
    `- reasoning: brief explanation of your decision`
  );
}

// ---------------------------------------------------------------------------
// JSON Parsing & Validation
// ---------------------------------------------------------------------------

/**
 * Attempts to parse and validate a raw LLM response string into a DecisionGateOutput.
 * Returns the fallback output if parsing or validation fails.
 * Exported for testing.
 */
export function parseDecisionGateResponse(
  raw: string,
): DecisionGateOutput | null {
  try {
    // Try direct JSON parse first
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      // Try extracting JSON from markdown code block
      const jsonBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonBlock) {
        parsed = JSON.parse(jsonBlock[1].trim());
      } else {
        // Try extracting any JSON object
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          return null;
        }
      }
    }

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    // Validate brainstormNeeded
    if (typeof obj.brainstormNeeded !== "boolean") {
      return null;
    }

    // Validate recommendedMode
    if (
      typeof obj.recommendedMode !== "string" ||
      !VALID_COLLABORATION_MODES.includes(
        obj.recommendedMode as CollaborationMode,
      )
    ) {
      return null;
    }

    // Validate requiredRoles
    if (!Array.isArray(obj.requiredRoles) || obj.requiredRoles.length === 0) {
      return null;
    }
    const validatedRoles = obj.requiredRoles.filter((r: unknown) =>
      VALID_ROLE_IDS.includes(r as BrainstormRoleId),
    );
    if (validatedRoles.length === 0) {
      return null;
    }

    // Validate requiredToolCategories
    if (!Array.isArray(obj.requiredToolCategories)) {
      return null;
    }
    const validatedCategories = obj.requiredToolCategories.filter(
      (c: unknown) => VALID_TOOL_CATEGORIES.includes(c as ToolCategory),
    );

    // Validate reasoning
    if (typeof obj.reasoning !== "string") {
      return null;
    }

    return {
      brainstormNeeded: obj.brainstormNeeded,
      recommendedMode: obj.recommendedMode as CollaborationMode,
      requiredRoles: validatedRoles as BrainstormRoleId[],
      requiredToolCategories: validatedCategories as ToolCategory[],
      reasoning: obj.reasoning,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Decision Gate
// ---------------------------------------------------------------------------

/**
 * Executes the Decision Gate logic.
 *
 * 1. Checks degradation state — biases toward false when bridges are degraded.
 * 2. Builds prompt and invokes LLM with timeout via AbortController.
 * 3. Parses and validates the response.
 * 4. On any error or timeout, returns fallback and emits degraded event.
 */
export async function decide(
  input: DecisionGateInput,
  llmCaller: LLMCallerFn,
  emitEvent: EventEmitterFn,
  config: DecisionGateConfig = { timeoutMs: 5000 },
): Promise<DecisionGateOutput> {
  // Force mode (BLUEPRINT_BRAINSTORM_FORCE): brainstorm MUST run at every stage.
  // Skip the gate LLM call entirely (saves tokens + guarantees on) and ignore
  // degraded-bridge biasing — the debate only needs the aux LLM pool.
  //
  // IMPORTANT: Per brainstorm-debate-integrity-observability Req 3, this mode
  // is ONLY for test/pilot data collection. Long-term production use must allow
  // the real Decision Gate to run so we can measure actual value vs cost.
  const forced =
    config.force ?? (process.env.BLUEPRINT_BRAINSTORM_FORCE === "true");
  if (forced) {
    recordGateDecision("forced");
    emitEvent("brainstorm.gate.forced", {
      jobId: input.jobId,
      stageId: input.stageId,
      reasoning: FORCED_OUTPUT.reasoning,
    });
    return FORCED_OUTPUT;
  }

  // If degraded bridges exist, bias toward single-agent execution
  if (input.degradedBridges.length > 0) {
    const prompt = buildDecisionGatePrompt(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const raw = await llmCaller(prompt, { signal: controller.signal });
      clearTimeout(timer);

      const parsed = parseDecisionGateResponse(raw);
      if (!parsed) {
        recordGateDecision("degraded");
        emitEvent("brainstorm.degraded", {
          sessionId: "",
          reason: "Decision Gate failed to parse LLM response (degraded mode)",
          affectedComponent: "decision-gate",
          fallbackAction: "single-agent",
        });
        return FALLBACK_OUTPUT;
      }

      // Record as explicit degraded override, not "realFalse".
      // This keeps "realDecidedFalse" (from the normal path) clean for observability
      // of the actual LLM gate decision vs. policy-based forced single-agent.
      recordGateDecision("degradedOverrideFalse");
      // Override brainstormNeeded to false when bridges are degraded
      return {
        ...parsed,
        brainstormNeeded: false,
        reasoning: `${parsed.reasoning} [Overridden: degraded bridges detected (${input.degradedBridges.join(", ")})]`,
      };
    } catch (error) {
      clearTimeout(timer);
      recordGateDecision("degraded");
      emitEvent("brainstorm.degraded", {
        sessionId: "",
        reason: `Decision Gate LLM call failed in degraded mode: ${error instanceof Error ? error.message : String(error)}`,
        affectedComponent: "decision-gate",
        fallbackAction: "single-agent",
      });
      return FALLBACK_OUTPUT;
    }
  }

  // Normal path: invoke LLM with timeout
  const prompt = buildDecisionGatePrompt(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const raw = await llmCaller(prompt, { signal: controller.signal });
    clearTimeout(timer);

    const parsed = parseDecisionGateResponse(raw);
    if (!parsed) {
      recordGateDecision("degraded");
      emitEvent("brainstorm.degraded", {
        sessionId: "",
        reason: "Decision Gate failed to parse LLM response",
        affectedComponent: "decision-gate",
        fallbackAction: "single-agent",
      });
      return FALLBACK_OUTPUT;
    }

    recordGateDecision(parsed.brainstormNeeded ? "realTrue" : "realFalse");
    return parsed;
  } catch (error) {
    clearTimeout(timer);
    recordGateDecision("degraded");
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "Decision Gate LLM call timed out"
        : `Decision Gate LLM call failed: ${error instanceof Error ? error.message : String(error)}`;

    emitEvent("brainstorm.degraded", {
      sessionId: "",
      reason,
      affectedComponent: "decision-gate",
      fallbackAction: "single-agent",
    });
    return FALLBACK_OUTPUT;
  }
}

// ---------------------------------------------------------------------------
// Routing Helper
// ---------------------------------------------------------------------------

/**
 * Determines the routing action based on a DecisionGateOutput.
 * Returns a routing descriptor indicating whether to use single-agent
 * or spawn a brainstorm session.
 *
 * @see Requirements 1.3, 1.4
 */
export interface RoutingResult {
  type: "single-agent" | "brainstorm-session";
  /** Only present when type is "brainstorm-session". */
  sessionConfig?: {
    mode: CollaborationMode;
    roles: BrainstormRoleId[];
    toolCategories: ToolCategory[];
  };
}

export function routeDecision(output: DecisionGateOutput): RoutingResult {
  if (!output.brainstormNeeded) {
    return { type: "single-agent" };
  }

  return {
    type: "brainstorm-session",
    sessionConfig: {
      mode: output.recommendedMode,
      roles: output.requiredRoles,
      toolCategories: output.requiredToolCategories,
    },
  };
}
