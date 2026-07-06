/**
 * Node -> Python delegation seam for the executor dispatch / cancel DECISION
 * surface (slide-rule-python routes/executor_dispatch.py,
 * services/executor_dispatch_decisions.py) — executor migration slice 2.
 *
 * Flag: EXECUTOR_DISPATCH_PYTHON_DECISIONS, **default OFF** (dispatch is
 * mission-critical: wiring lands first, the default flip is a later
 * decision). Explicit "true" opts in — including under vitest, so proxy
 * tests can exercise the seam.
 *
 * Scope (pure decisions only):
 * - POST /api/executor/dispatch/plan: sourceText derivation,
 *   buildExecutionPlan inputs, execution-mode resolution
 *   (LOBSTER_EXECUTION_MODE), first-job payload patching
 *   (applyMissionDispatchPayload), requestId / idempotencyKey derivation,
 *   callback URL composition.
 * - POST /api/executor/cancel/decision: already-final short-circuit,
 *   reason/requestedBy/source normalization, forward-to-executor verdict,
 *   cancel URL + downstream request body, downstream outcome interpretation.
 *
 * Node keeps: buildExecutionPlan itself, the ExecutorClient HTTP transport /
 * retries / capability probe, traceId generation (randomUUID), heartbeat
 * monitoring, missionRuntime writes, and the lifecycle/store/scheduler
 * advisory calls around cancel. On any infra failure or invalid decision
 * envelope this seam reports "not delegated" and the caller falls back to
 * the identical inline Node derivations — byte-identical behavior with the
 * flag off or Python down.
 */

import {
  delegateToPythonThinProxy,
  isPythonThinProxyEnabled,
  type PythonThinProxyTarget,
} from "./python-thin-proxy.js";

export const EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG =
  "EXECUTOR_DISPATCH_PYTHON_DECISIONS";

export const EXECUTOR_DISPATCH_PLAN_ENDPOINT = "/api/executor/dispatch/plan";
export const EXECUTOR_CANCEL_DECISION_ENDPOINT = "/api/executor/cancel/decision";

export function isExecutorDispatchPythonDecisionsEnabled(): boolean {
  return isPythonThinProxyEnabled(EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG, {
    defaultEnabled: false,
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ── Dispatch plan ────────────────────────────────────────────────────────────

export interface ExecutorDispatchPlanMissionInput {
  missionId: string;
  title: string;
  sourceText?: string;
  attempt?: number;
  topicId?: string;
}

export interface ExecutorDispatchPlanDecisions {
  sourceText: string;
  executionMode: "mock" | "real";
  requestId: string;
  idempotencyKey: string;
  /** Composed / passthrough callback URL (absent when Python had no input). */
  callbackUrl?: string;
  /** Patched plan.jobs[0].payload (present when hasFirstJob). */
  jobPayload?: Record<string, unknown>;
}

export interface ExecutorDispatchPlanDelegated {
  delegated: true;
  plan: ExecutorDispatchPlanDecisions;
}

export interface ExecutorDispatchDecisionUnavailable {
  delegated: false;
  reason: string;
}

export type ExecutorDispatchPlanResult =
  | ExecutorDispatchPlanDelegated
  | ExecutorDispatchDecisionUnavailable;

export async function planExecutorDispatchViaPython(input: {
  mission: ExecutorDispatchPlanMissionInput;
  executionModeEnv?: string;
  hasFirstJob: boolean;
  firstJobPayload?: Record<string, unknown>;
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}): Promise<ExecutorDispatchPlanResult> {
  const result = await delegateToPythonThinProxy({
    endpoint: EXECUTOR_DISPATCH_PLAN_ENDPOINT,
    method: "POST",
    payload: {
      mission: input.mission,
      executionModeEnv: input.executionModeEnv,
      hasFirstJob: input.hasFirstJob,
      firstJobPayload: input.firstJobPayload,
      callbackUrl: input.callbackUrl,
    },
    fetchImpl: input.fetchImpl,
    target: input.target,
  });
  if (!result.delegated) {
    return { delegated: false, reason: result.reason };
  }
  if (result.status !== 200) {
    return { delegated: false, reason: `python http ${result.status}` };
  }
  const body = result.body;
  if (!isPlainRecord(body) || body.ok !== true) {
    return { delegated: false, reason: "python dispatch envelope not ok" };
  }
  if (typeof body.sourceText !== "string") {
    return { delegated: false, reason: "python dispatch plan missing sourceText" };
  }
  if (body.executionMode !== "mock" && body.executionMode !== "real") {
    return { delegated: false, reason: "python dispatch plan has an invalid executionMode" };
  }
  const dispatch = body.dispatch;
  if (
    !isPlainRecord(dispatch) ||
    !nonEmptyString(dispatch.requestId) ||
    !nonEmptyString(dispatch.idempotencyKey)
  ) {
    return {
      delegated: false,
      reason: "python dispatch plan missing requestId/idempotencyKey",
    };
  }
  const jobPayload = body.jobPayload;
  if (input.hasFirstJob && !isPlainRecord(jobPayload)) {
    return { delegated: false, reason: "python dispatch plan missing jobPayload" };
  }
  const callbackUrl = nonEmptyString(body.callbackUrl) ? body.callbackUrl : undefined;
  return {
    delegated: true,
    plan: {
      sourceText: body.sourceText,
      executionMode: body.executionMode,
      requestId: dispatch.requestId,
      idempotencyKey: dispatch.idempotencyKey,
      callbackUrl,
      jobPayload: isPlainRecord(jobPayload) ? jobPayload : undefined,
    },
  };
}

// ── Cancel decision ──────────────────────────────────────────────────────────

const MISSION_CANCEL_SOURCES = [
  "brain",
  "executor",
  "feishu",
  "mission-core",
  "user",
] as const;

export type ExecutorCancelMissionSource = (typeof MISSION_CANCEL_SOURCES)[number];

const EXECUTOR_CANCEL_SOURCES = ["user", "brain", "feishu", "system"] as const;

export type ExecutorCancelDownstreamSource =
  (typeof EXECUTOR_CANCEL_SOURCES)[number];

export interface ExecutorCancelTaskInput {
  id: string;
  status: string;
  executor?: { jobId?: string; baseUrl?: string };
}

export interface ExecutorCancelBodyInput {
  reason?: unknown;
  requestedBy?: unknown;
  source?: unknown;
}

export interface ExecutorCancelPythonDecision {
  alreadyFinal: boolean;
  forward: boolean;
  reason?: string;
  requestedBy?: string;
  cancelSource: ExecutorCancelMissionSource;
  executorCancelSource: ExecutorCancelDownstreamSource;
  executorJobId?: string;
  /** Present when forward. */
  cancelUrl?: string;
  requestBody?: Record<string, unknown>;
}

export interface ExecutorCancelDecisionDelegated {
  delegated: true;
  decision: ExecutorCancelPythonDecision;
}

export type ExecutorCancelDecisionResult =
  | ExecutorCancelDecisionDelegated
  | ExecutorDispatchDecisionUnavailable;

export interface ExecutorCancelDownstreamInput {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface ExecutorCancelOutcome {
  executorForwarded: boolean;
  /** When set, Node must answer the cancel request with this error. */
  error?: { status: number; message: string };
}

export interface ExecutorCancelOutcomeDelegated {
  delegated: true;
  outcome: ExecutorCancelOutcome;
}

export type ExecutorCancelOutcomeResult =
  | ExecutorCancelOutcomeDelegated
  | ExecutorDispatchDecisionUnavailable;

interface CancelDecisionCallInput {
  task: ExecutorCancelTaskInput;
  body: ExecutorCancelBodyInput;
  defaultExecutorBaseUrl?: string;
  downstream?: ExecutorCancelDownstreamInput;
  fetchImpl?: typeof fetch;
  target?: PythonThinProxyTarget;
}

async function callCancelDecision(
  input: CancelDecisionCallInput,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: string }> {
  const result = await delegateToPythonThinProxy({
    endpoint: EXECUTOR_CANCEL_DECISION_ENDPOINT,
    method: "POST",
    payload: {
      task: input.task,
      body: {
        reason: input.body.reason,
        requestedBy: input.body.requestedBy,
        source: input.body.source,
      },
      defaultExecutorBaseUrl: input.defaultExecutorBaseUrl,
      downstream: input.downstream,
    },
    fetchImpl: input.fetchImpl,
    target: input.target,
  });
  if (!result.delegated) return { ok: false, reason: result.reason };
  if (result.status !== 200) {
    return { ok: false, reason: `python http ${result.status}` };
  }
  const body = result.body;
  if (!isPlainRecord(body) || body.ok !== true) {
    return { ok: false, reason: "python cancel decision envelope not ok" };
  }
  return { ok: true, body };
}

function parseCancelDecision(
  body: Record<string, unknown>,
): ExecutorCancelPythonDecision | null {
  if (typeof body.alreadyFinal !== "boolean") return null;
  if (typeof body.forward !== "boolean") return null;
  const cancelSource = body.cancelSource;
  if (
    typeof cancelSource !== "string" ||
    !(MISSION_CANCEL_SOURCES as readonly string[]).includes(cancelSource)
  ) {
    return null;
  }
  const executorCancelSource = body.executorCancelSource;
  if (
    typeof executorCancelSource !== "string" ||
    !(EXECUTOR_CANCEL_SOURCES as readonly string[]).includes(executorCancelSource)
  ) {
    return null;
  }
  const optionalString = (value: unknown): string | undefined =>
    nonEmptyString(value) ? value : undefined;
  const decision: ExecutorCancelPythonDecision = {
    alreadyFinal: body.alreadyFinal,
    forward: body.forward,
    reason: optionalString(body.reason),
    requestedBy: optionalString(body.requestedBy),
    cancelSource: cancelSource as ExecutorCancelMissionSource,
    executorCancelSource: executorCancelSource as ExecutorCancelDownstreamSource,
    executorJobId: optionalString(body.executorJobId),
    cancelUrl: optionalString(body.cancelUrl),
    requestBody: isPlainRecord(body.requestBody) ? body.requestBody : undefined,
  };
  if (decision.forward && (!decision.cancelUrl || !decision.requestBody)) {
    // A forward verdict without an executable decision is unusable.
    return null;
  }
  return decision;
}

export async function decideExecutorCancelViaPython(
  input: Omit<CancelDecisionCallInput, "downstream">,
): Promise<ExecutorCancelDecisionResult> {
  const call = await callCancelDecision(input);
  if (!call.ok) return { delegated: false, reason: call.reason };
  const decision = parseCancelDecision(call.body);
  if (!decision) {
    return { delegated: false, reason: "python cancel decision envelope is invalid" };
  }
  return { delegated: true, decision };
}

export async function interpretExecutorCancelDownstreamViaPython(
  input: CancelDecisionCallInput & { downstream: ExecutorCancelDownstreamInput },
): Promise<ExecutorCancelOutcomeResult> {
  const call = await callCancelDecision(input);
  if (!call.ok) return { delegated: false, reason: call.reason };
  const outcome = call.body.outcome;
  if (!isPlainRecord(outcome) || typeof outcome.executorForwarded !== "boolean") {
    return { delegated: false, reason: "python cancel outcome envelope is invalid" };
  }
  const error = outcome.error;
  if (error !== undefined && error !== null) {
    if (
      !isPlainRecord(error) ||
      typeof error.status !== "number" ||
      !nonEmptyString(error.message)
    ) {
      return { delegated: false, reason: "python cancel outcome error is invalid" };
    }
    return {
      delegated: true,
      outcome: {
        executorForwarded: outcome.executorForwarded,
        error: { status: error.status, message: error.message },
      },
    };
  }
  return {
    delegated: true,
    outcome: { executorForwarded: outcome.executorForwarded },
  };
}
