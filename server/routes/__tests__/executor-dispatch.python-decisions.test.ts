/**
 * Node -> Python delegation seam for the executor dispatch / cancel DECISION
 * surface (EXECUTOR_DISPATCH_PYTHON_DECISIONS, default OFF — dispatch is
 * mission-critical, so the wiring lands first and the default flip is a later
 * decision).
 *
 * Style follows executor-events.python-projection.test.ts: stub global fetch,
 * assert delegation url/headers/payload, decision envelope validation
 * (fail-closed fallback to the Node inline derivations), and flag semantics.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXECUTOR_CANCEL_DECISION_ENDPOINT,
  EXECUTOR_DISPATCH_PLAN_ENDPOINT,
  EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG,
  decideExecutorCancelViaPython,
  interpretExecutorCancelDownstreamViaPython,
  isExecutorDispatchPythonDecisionsEnabled,
  planExecutorDispatchViaPython,
} from "../executor-dispatch-python-decisions.js";

const PYTHON_BASE = "http://python-executor-dispatch.test";
const INTERNAL_KEY = "internal-executor-dispatch";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(reply: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) =>
      reply(String(input instanceof Request ? input.url : input), init as RequestInit),
    );
}

function enableFlag() {
  vi.stubEnv(EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG, "true");
  vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", `${PYTHON_BASE}/`);
  vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const PLAN_ENVELOPE = {
  ok: true,
  source: "python",
  provenance: "python-executor-dispatch-decisions",
  missionId: "m-1",
  sourceText: "Build the Q3 report",
  planInputs: {
    missionId: "m-1",
    title: "Build a report",
    sourceText: "Build the Q3 report",
    requestedBy: "brain",
  },
  executionMode: "real",
  dispatch: {
    requestId: "mission_m-1_attempt_2",
    idempotencyKey: "mission:m-1:attempt:2",
  },
  callbackUrl: "http://127.0.0.1:3000/api/executor/events",
  hasFirstJob: true,
  jobPayload: {
    aiEnabled: true,
    aiTaskType: "text-generation",
    command: [],
    env: { MISSION_ID: "m-1", TASK_CONTENT: "Build the Q3 report" },
  },
};

const PLAN_INPUT = {
  mission: {
    missionId: "m-1",
    title: "Build a report",
    sourceText: "Build the Q3 report",
    attempt: 2,
  },
  executionModeEnv: "real",
  hasFirstJob: true,
  firstJobPayload: { env: {} },
  callbackUrl: "http://127.0.0.1:3000/api/executor/events",
};

describe("EXECUTOR_DISPATCH_PYTHON_DECISIONS flag semantics", () => {
  it("is default OFF (dispatch is mission-critical; wiring first, flip later)", () => {
    expect(isExecutorDispatchPythonDecisionsEnabled()).toBe(false);
    vi.stubEnv(EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG, "1");
    expect(isExecutorDispatchPythonDecisionsEnabled()).toBe(false);
  });

  it("explicit true opts in, explicit false opts out", () => {
    vi.stubEnv(EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG, "true");
    expect(isExecutorDispatchPythonDecisionsEnabled()).toBe(true);
    vi.stubEnv(EXECUTOR_DISPATCH_PYTHON_DECISIONS_FLAG, "false");
    expect(isExecutorDispatchPythonDecisionsEnabled()).toBe(false);
  });
});

describe("planExecutorDispatchViaPython", () => {
  it("POSTs the decision inputs with the internal key and consumes the decisions", async () => {
    enableFlag();
    const fetchSpy = stubFetch(async () => jsonResponse(PLAN_ENVELOPE));

    const result = await planExecutorDispatchViaPython(PLAN_INPUT);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${PYTHON_BASE}${EXECUTOR_DISPATCH_PLAN_ENDPOINT}`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Internal-Key"]).toBe(INTERNAL_KEY);
    expect(JSON.parse(String(init?.body))).toEqual(PLAN_INPUT);

    expect(result.delegated).toBe(true);
    if (!result.delegated) throw new Error("expected delegation");
    expect(result.plan).toEqual({
      sourceText: "Build the Q3 report",
      executionMode: "real",
      requestId: "mission_m-1_attempt_2",
      idempotencyKey: "mission:m-1:attempt:2",
      callbackUrl: "http://127.0.0.1:3000/api/executor/events",
      jobPayload: PLAN_ENVELOPE.jobPayload,
    });
  });

  it("fails closed on invalid envelopes (missing keys, bad mode, missing jobPayload)", async () => {
    enableFlag();
    const badEnvelopes = [
      { ...PLAN_ENVELOPE, ok: false },
      { ...PLAN_ENVELOPE, sourceText: undefined },
      { ...PLAN_ENVELOPE, executionMode: "hyper" },
      { ...PLAN_ENVELOPE, dispatch: { requestId: "" , idempotencyKey: "k" } },
      { ...PLAN_ENVELOPE, dispatch: undefined },
      { ...PLAN_ENVELOPE, jobPayload: undefined },
    ];
    for (const envelope of badEnvelopes) {
      stubFetch(async () => jsonResponse(envelope));
      const result = await planExecutorDispatchViaPython(PLAN_INPUT);
      expect(result.delegated).toBe(false);
      vi.restoreAllMocks();
      enableFlag();
    }
  });

  it("treats python 5xx / network failure / business 4xx as not delegated", async () => {
    enableFlag();

    stubFetch(async () => jsonResponse({ detail: "boom" }, 500));
    expect((await planExecutorDispatchViaPython(PLAN_INPUT)).delegated).toBe(false);
    vi.restoreAllMocks();
    enableFlag();

    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect((await planExecutorDispatchViaPython(PLAN_INPUT)).delegated).toBe(false);
    vi.restoreAllMocks();
    enableFlag();

    stubFetch(async () =>
      jsonResponse({ ok: false, error: "mission.missionId must be a non-empty string" }, 400),
    );
    expect((await planExecutorDispatchViaPython(PLAN_INPUT)).delegated).toBe(false);
  });
});

const CANCEL_ENVELOPE = {
  ok: true,
  source: "python",
  provenance: "python-executor-dispatch-decisions",
  missionId: "m-1",
  alreadyFinal: false,
  forward: true,
  reason: "stop now",
  requestedBy: "ops",
  cancelSource: "brain",
  executorCancelSource: "brain",
  executorJobId: "job-9",
  executorBaseUrl: "http://exec.local",
  cancelUrl: "http://exec.local/api/executor/jobs/job-9/cancel",
  requestBody: { source: "brain", reason: "stop now", requestedBy: "ops" },
};

const CANCEL_INPUT = {
  task: {
    id: "m-1",
    status: "running",
    executor: { jobId: "job-9", baseUrl: "http://exec.local" },
  },
  body: { reason: "stop now", requestedBy: "ops", source: "brain" },
  defaultExecutorBaseUrl: "http://127.0.0.1:3031",
};

describe("decideExecutorCancelViaPython", () => {
  it("consumes the forward decision with normalized fields", async () => {
    enableFlag();
    const fetchSpy = stubFetch(async () => jsonResponse(CANCEL_ENVELOPE));

    const result = await decideExecutorCancelViaPython(CANCEL_INPUT);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${PYTHON_BASE}${EXECUTOR_CANCEL_DECISION_ENDPOINT}`);
    expect(JSON.parse(String(init?.body))).toEqual(CANCEL_INPUT);

    expect(result.delegated).toBe(true);
    if (!result.delegated) throw new Error("expected delegation");
    expect(result.decision.forward).toBe(true);
    expect(result.decision.alreadyFinal).toBe(false);
    expect(result.decision.cancelUrl).toBe(
      "http://exec.local/api/executor/jobs/job-9/cancel",
    );
    expect(result.decision.requestBody).toEqual({
      source: "brain",
      reason: "stop now",
      requestedBy: "ops",
    });
    expect(result.decision.cancelSource).toBe("brain");
    expect(result.decision.executorCancelSource).toBe("brain");
  });

  it("consumes already-final and no-forward decisions", async () => {
    enableFlag();
    stubFetch(async () =>
      jsonResponse({
        ...CANCEL_ENVELOPE,
        alreadyFinal: true,
        forward: false,
        cancelUrl: undefined,
        requestBody: undefined,
      }),
    );

    const result = await decideExecutorCancelViaPython(CANCEL_INPUT);
    expect(result.delegated).toBe(true);
    if (!result.delegated) throw new Error("expected delegation");
    expect(result.decision.alreadyFinal).toBe(true);
    expect(result.decision.forward).toBe(false);
  });

  it("fails closed on invalid envelopes (bad sources, forward without cancelUrl)", async () => {
    enableFlag();
    const badEnvelopes = [
      { ...CANCEL_ENVELOPE, alreadyFinal: "yes" },
      { ...CANCEL_ENVELOPE, cancelSource: "robot" },
      { ...CANCEL_ENVELOPE, executorCancelSource: "robot" },
      { ...CANCEL_ENVELOPE, cancelUrl: undefined },
      { ...CANCEL_ENVELOPE, requestBody: undefined },
      { ok: true },
    ];
    for (const envelope of badEnvelopes) {
      stubFetch(async () => jsonResponse(envelope));
      const result = await decideExecutorCancelViaPython(CANCEL_INPUT);
      expect(result.delegated).toBe(false);
      vi.restoreAllMocks();
      enableFlag();
    }
  });
});

describe("interpretExecutorCancelDownstreamViaPython", () => {
  it("consumes forwarded / tolerated-404 / error verdicts", async () => {
    enableFlag();

    stubFetch(async () =>
      jsonResponse({
        ...CANCEL_ENVELOPE,
        outcome: { executorForwarded: true, tolerated404: false, downstreamTerminal: false },
      }),
    );
    let result = await interpretExecutorCancelDownstreamViaPython({
      ...CANCEL_INPUT,
      downstream: { ok: true, status: 200, body: { status: "cancelling" } },
    });
    expect(result.delegated).toBe(true);
    if (!result.delegated) throw new Error("expected delegation");
    expect(result.outcome).toEqual({ executorForwarded: true });
    vi.restoreAllMocks();
    enableFlag();

    stubFetch(async () =>
      jsonResponse({
        ...CANCEL_ENVELOPE,
        outcome: { executorForwarded: false, tolerated404: true },
      }),
    );
    result = await interpretExecutorCancelDownstreamViaPython({
      ...CANCEL_INPUT,
      downstream: { ok: false, status: 404, body: null },
    });
    expect(result.delegated).toBe(true);
    if (!result.delegated) throw new Error("expected delegation");
    expect(result.outcome.executorForwarded).toBe(false);
    expect(result.outcome.error).toBeUndefined();
    vi.restoreAllMocks();
    enableFlag();

    stubFetch(async () =>
      jsonResponse({
        ...CANCEL_ENVELOPE,
        outcome: {
          executorForwarded: false,
          tolerated404: false,
          error: { status: 502, message: "executor exploded" },
        },
      }),
    );
    result = await interpretExecutorCancelDownstreamViaPython({
      ...CANCEL_INPUT,
      downstream: { ok: false, status: 500, body: { error: "executor exploded" } },
    });
    expect(result.delegated).toBe(true);
    if (!result.delegated) throw new Error("expected delegation");
    expect(result.outcome.error).toEqual({ status: 502, message: "executor exploded" });
  });

  it("fails closed when the outcome envelope is missing or malformed", async () => {
    enableFlag();
    for (const outcome of [undefined, { executorForwarded: "yes" }, { error: {} }]) {
      stubFetch(async () => jsonResponse({ ...CANCEL_ENVELOPE, outcome }));
      const result = await interpretExecutorCancelDownstreamViaPython({
        ...CANCEL_INPUT,
        downstream: { ok: true, status: 200, body: null },
      });
      expect(result.delegated).toBe(false);
      vi.restoreAllMocks();
      enableFlag();
    }
  });
});
