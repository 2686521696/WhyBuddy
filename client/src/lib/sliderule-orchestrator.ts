import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { V5CapabilityId } from "@shared/blueprint/contracts";

export type OrchestratePlanFallbackReason =
  | "no_api_key"
  | "llm_error"
  | "empty_response"
  | "invalid_proposal"
  | "planner_timeout"
  | "planner_config_missing"
  | "planner_error";

export type OrchestratePlanRequest = {
  state: V5SessionState;
  turnId: string;
  userText: string;
  intervention?: {
    intent?: string;
    targetArtifactId?: string;
    targetDecisionId?: string;
  } | null;
};

export type OrchestratePlanResponse = {
  selected: Array<{
    capabilityId: V5CapabilityId;
    roleId: string;
    why?: string;
  }>;
  rationale: string;
  source:
    | "llm"
    | "heuristic_fallback"
    | "python-rag"
    | "python-fullpath"
    | "python-llm";
  /** Mechanical convergence (empty selected + converged true) — still a valid llm response. */
  converged?: boolean;
  dropped?: Array<{ capabilityId: string; reason: string }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
  reason?: OrchestratePlanFallbackReason;
  // Python-owned degraded/error/timeout states (task 16) must be returned and visible, not nulled to heuristic
  degraded?: boolean;
  error?: string;
  message?: string;
  fallbackAvailable?: boolean;
  backend?: string;
  provenance?: string;
};

/** Server orchestrate LLM cap is 30s — client must wait longer than that + network. */
const DEFAULT_TIMEOUT_MS = 40_000;

export async function fetchOrchestratePlan(
  req: OrchestratePlanRequest,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<OrchestratePlanResponse | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options?.signal;
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch("/api/sliderule/orchestrate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OrchestratePlanResponse;
    if (!body || !Array.isArray(body.selected)) {
      // allow Python degraded even if shape partial
      // scope note (review finding 4 remediation): this file is the shared fetch impl for /orchestrate-plan used by runtime + pages/sliderule; edit required to ensure Python {degraded,error,backend,provenance} reaches UI not swallowed to heuristic. Boundary extension documented in task+status md.
      if (
        body &&
        (body.degraded === true ||
          body.error ||
          (body as any).provenance?.startsWith?.("python"))
      ) {
        return body;
      }
      return null;
    }
    // F0.1 / task 2.3: preserve LLM convergence signals (source=llm, empty selected).
    if (
      body.source === "llm" &&
      body.converged === true &&
      body.selected.length === 0
    ) {
      return body;
    }
    if (body.selected.length === 0) {
      // Python returns selected:[] + degraded:true for timeout/config/error (must not be treated as null)
      if (
        body.degraded === true ||
        body.error ||
        body.source?.includes("python") ||
        (body as any).provenance?.includes("python")
      ) {
        return body;
      }
      return null;
    }
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
