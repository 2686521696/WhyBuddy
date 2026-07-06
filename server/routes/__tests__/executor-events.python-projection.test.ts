/**
 * Node -> Python delegation seam for the POST /api/executor/events
 * event->action projection (EXECUTOR_EVENTS_PYTHON_PROJECTION, default ON,
 * vitest stays on the Node inline path unless the flag is explicitly "true").
 *
 * Style follows tasks.python-proxy.test.ts: stub global fetch, assert
 * delegation url/headers/payload, action applied from the Python response,
 * infra-failure fallback to the inline mapper, flag-off inline path, and that
 * streaming events are never delegated.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG,
  EXECUTOR_EVENTS_PROJECT_ENDPOINT,
  EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG,
  applyPythonProjectedExecutorAction,
  isExecutorEventsDedupEnforcementEnabled,
  isExecutorEventsPythonProjectionEnabled,
  isStateChangingExecutorCallbackEvent,
  maybeProjectExecutorEventViaPython,
  projectExecutorEventViaPython,
  runExecutorEventPythonProjection,
  type ExecutorProjectionApplyDeps,
  type ExecutorProjectionEventInput,
} from "../executor-events-python-projection.js";

const PYTHON_BASE = "http://python-executor-events.test";
const INTERNAL_KEY = "internal-executor-events";

function makeDeps() {
  return {
    markMissionRunning: vi.fn(),
    waitOnMission: vi.fn(),
    finishMission: vi.fn(),
    failMission: vi.fn(),
    cancelMission: vi.fn(),
    clearHeartbeat: vi.fn(),
  } satisfies ExecutorProjectionApplyDeps;
}

const baseEvent: ExecutorProjectionEventInput = {
  version: "2026-03-28",
  eventId: "evt-1",
  missionId: "mission-1",
  jobId: "job-1",
  executor: "lobster-executor",
  type: "job.completed",
  status: "completed",
  occurredAt: "2026-07-06T10:00:00.000Z",
  progress: 100,
  summary: "All work finished.",
};

const mission = { currentProgress: 42, stageLabel: "收尾" };
const ctx = {
  missionId: "mission-1",
  stageKey: "finalize",
  executorName: "lobster-executor",
  decision: undefined,
};

function pythonEnvelope(apply: Record<string, unknown>) {
  return {
    ok: true,
    source: "python",
    provenance: "python-executor-event-projection",
    action: { action: "done", summary: "All work finished." },
    routing: { route: "mission", terminal: true },
    apply,
  };
}

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
  vi.stubEnv(EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG, "true");
  vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", `${PYTHON_BASE}/`);
  vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("EXECUTOR_EVENTS_PYTHON_PROJECTION flag semantics", () => {
  it("stays on the Node inline path under vitest when unset (default-ON guard)", () => {
    expect(isExecutorEventsPythonProjectionEnabled()).toBe(false);
  });

  it("explicit true opts in, explicit false opts out", () => {
    vi.stubEnv(EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG, "true");
    expect(isExecutorEventsPythonProjectionEnabled()).toBe(true);
    vi.stubEnv(EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG, "false");
    expect(isExecutorEventsPythonProjectionEnabled()).toBe(false);
  });
});

describe("state-changing event predicate", () => {
  it("delegates the six state-changing types", () => {
    for (const type of [
      "job.started",
      "job.progress",
      "job.waiting",
      "job.completed",
      "job.failed",
      "job.cancelled",
    ]) {
      expect(isStateChangingExecutorCallbackEvent(type)).toBe(true);
    }
  });

  it("never delegates streaming events, even with a terminal status", () => {
    for (const type of ["job.log", "job.log_stream", "job.screenshot"]) {
      expect(isStateChangingExecutorCallbackEvent(type)).toBe(false);
      expect(isStateChangingExecutorCallbackEvent(type, "completed")).toBe(false);
      expect(isStateChangingExecutorCallbackEvent(type, "failed")).toBe(false);
    }
  });

  it("delegates status-based fallbacks and keeps pure heartbeats inline", () => {
    expect(isStateChangingExecutorCallbackEvent("job.heartbeat", "completed")).toBe(true);
    expect(isStateChangingExecutorCallbackEvent("job.accepted", "waiting")).toBe(true);
    expect(isStateChangingExecutorCallbackEvent("job.heartbeat", "running")).toBe(false);
    expect(isStateChangingExecutorCallbackEvent("job.accepted")).toBe(false);
    expect(isStateChangingExecutorCallbackEvent(undefined)).toBe(false);
  });
});

describe("projectExecutorEventViaPython delegation", () => {
  it("POSTs the delivery envelope + mission context with the internal key", async () => {
    enableFlag();
    const fetchSpy = stubFetch(async () =>
      jsonResponse(
        pythonEnvelope({
          kind: "done",
          progress: 100,
          detail: "All work finished.",
          message: "All work finished.",
          clearHeartbeat: true,
        }),
      ),
    );

    const result = await projectExecutorEventViaPython({ event: baseEvent, mission });
    expect(result.delegated).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`${PYTHON_BASE}${EXECUTOR_EVENTS_PROJECT_ENDPOINT}`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Internal-Key"]).toBe(INTERNAL_KEY);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      event: baseEvent,
      mission,
    });
  });

  it("treats python 5xx, network failure, business 4xx and invalid envelopes as not delegated", async () => {
    enableFlag();

    stubFetch(async () => jsonResponse({ detail: "boom" }, 500));
    expect((await projectExecutorEventViaPython({ event: baseEvent, mission })).delegated).toBe(
      false,
    );
    vi.restoreAllMocks();

    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect((await projectExecutorEventViaPython({ event: baseEvent, mission })).delegated).toBe(
      false,
    );
    vi.restoreAllMocks();

    // Fail-closed business 400 from Python never yields an action to apply.
    stubFetch(async () =>
      jsonResponse({ ok: false, error: "event.missionId must be a non-empty string" }, 400),
    );
    expect((await projectExecutorEventViaPython({ event: baseEvent, mission })).delegated).toBe(
      false,
    );
    vi.restoreAllMocks();

    // ok envelope with an unrecognized apply kind is rejected (fail closed).
    stubFetch(async () =>
      jsonResponse(pythonEnvelope({ kind: "explode", progress: 1, detail: "d" })),
    );
    expect((await projectExecutorEventViaPython({ event: baseEvent, mission })).delegated).toBe(
      false,
    );
  });
});

describe("runExecutorEventPythonProjection", () => {
  it("applies the terminal action returned by Python via the runtime deps", async () => {
    enableFlag();
    stubFetch(async () =>
      jsonResponse(
        pythonEnvelope({
          kind: "done",
          progress: 100,
          detail: "All work finished.",
          message: "All work finished.",
          clearHeartbeat: true,
        }),
      ),
    );
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: baseEvent,
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.markMissionRunning).toHaveBeenCalledWith(
      "mission-1",
      "finalize",
      "All work finished.",
      100,
      "executor",
    );
    expect(deps.finishMission).toHaveBeenCalledWith(
      "mission-1",
      "All work finished.",
      "executor",
    );
    expect(deps.clearHeartbeat).toHaveBeenCalledWith("mission-1");
    expect(deps.failMission).not.toHaveBeenCalled();
    expect(deps.cancelMission).not.toHaveBeenCalled();
  });

  it("the decision comes from Python: a cancelled verdict cancels even for a job.failed event", async () => {
    enableFlag();
    stubFetch(async () =>
      jsonResponse(
        pythonEnvelope({
          kind: "cancelled",
          progress: 73,
          detail: "operator stop",
          reason: "operator stop",
          clearHeartbeat: true,
        }),
      ),
    );
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: { ...baseEvent, type: "job.failed", status: "cancelled" },
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.cancelMission).toHaveBeenCalledWith("mission-1", {
      reason: "operator stop",
      requestedBy: "lobster-executor",
      source: "executor",
    });
    expect(deps.failMission).not.toHaveBeenCalled();
    expect(deps.clearHeartbeat).toHaveBeenCalledWith("mission-1");
  });

  it("applies waiting actions with the Node-normalized decision passthrough", async () => {
    enableFlag();
    stubFetch(async () =>
      jsonResponse(
        pythonEnvelope({
          kind: "waiting",
          progress: 42,
          detail: "needs approval",
          waitingFor: "approval",
          clearHeartbeat: false,
        }),
      ),
    );
    const deps = makeDeps();
    const decision = { prompt: "continue?", options: [{ id: "yes", label: "Yes" }] };

    const handled = await runExecutorEventPythonProjection({
      event: { ...baseEvent, type: "job.waiting", status: "waiting" },
      mission,
      ctx: { ...ctx, decision },
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.waitOnMission).toHaveBeenCalledWith(
      "mission-1",
      "approval",
      "needs approval",
      42,
      decision,
      "executor",
    );
    expect(deps.clearHeartbeat).not.toHaveBeenCalled();
  });

  it("falls back to the inline mapper on Python infra failure (no runtime writes)", async () => {
    enableFlag();
    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: baseEvent,
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.markMissionRunning).not.toHaveBeenCalled();
    expect(deps.finishMission).not.toHaveBeenCalled();
    expect(deps.clearHeartbeat).not.toHaveBeenCalled();
  });

  it("flag off keeps the inline path: fetch is never called", async () => {
    vi.stubEnv(EXECUTOR_EVENTS_PYTHON_PROJECTION_FLAG, "false");
    const fetchSpy = stubFetch(async () => jsonResponse({}));
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: baseEvent,
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deps.markMissionRunning).not.toHaveBeenCalled();
  });

  it("streaming events are never delegated even with the flag on", async () => {
    enableFlag();
    const fetchSpy = stubFetch(async () => jsonResponse({}));
    const deps = makeDeps();

    for (const type of ["job.log", "job.log_stream", "job.screenshot"] as const) {
      const handled = await runExecutorEventPythonProjection({
        event: { ...baseEvent, type, status: "running" },
        mission,
        ctx,
        deps,
      });
      expect(handled).toBe(false);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deps.markMissionRunning).not.toHaveBeenCalled();
  });
});

describe("EXECUTOR_EVENTS_DEDUP_ENFORCED dedup landing (slice 2)", () => {
  const duplicateEnvelope = {
    ...pythonEnvelope({
      kind: "done",
      progress: 100,
      detail: "All work finished.",
      message: "All work finished.",
      clearHeartbeat: true,
    }),
    action: { action: "duplicate", reason: "duplicate" },
    dedup: { duplicate: true, reason: "duplicate" },
  };

  it("is default OFF: only an explicit true enables enforcement", () => {
    expect(isExecutorEventsDedupEnforcementEnabled()).toBe(false);
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "1");
    expect(isExecutorEventsDedupEnforcementEnabled()).toBe(false);
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "true");
    expect(isExecutorEventsDedupEnforcementEnabled()).toBe(true);
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "false");
    expect(isExecutorEventsDedupEnforcementEnabled()).toBe(false);
  });

  it("flag on: a forged terminal replay (duplicate verdict) is blocked — no runtime writes", async () => {
    enableFlag();
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "true");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => jsonResponse(duplicateEnvelope));
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: {
        ...baseEvent,
        delivery: { sequence: 8, attempt: 2, duplicate: true, outOfOrder: false },
      },
      mission,
      ctx,
      deps,
    });

    // Handled (the route answers ok) but nothing was applied.
    expect(handled).toBe(true);
    expect(deps.markMissionRunning).not.toHaveBeenCalled();
    expect(deps.finishMission).not.toHaveBeenCalled();
    expect(deps.failMission).not.toHaveBeenCalled();
    expect(deps.cancelMission).not.toHaveBeenCalled();
    expect(deps.clearHeartbeat).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EXECUTOR_EVENTS_DEDUP_ENFORCED"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("mission-1"));
  });

  it("flag on: an out_of_order verdict is blocked too", async () => {
    enableFlag();
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "true");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () =>
      jsonResponse({
        ...duplicateEnvelope,
        action: { action: "duplicate", reason: "out_of_order" },
        dedup: { duplicate: true, reason: "out_of_order" },
      }),
    );
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: { ...baseEvent, delivery: { outOfOrder: true } },
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.finishMission).not.toHaveBeenCalled();
  });

  it("flag off (default): the duplicate delivery still lands, unchanged behavior", async () => {
    enableFlag();
    stubFetch(async () => jsonResponse(duplicateEnvelope));
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: { ...baseEvent, delivery: { duplicate: true } },
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.markMissionRunning).toHaveBeenCalled();
    expect(deps.finishMission).toHaveBeenCalledWith(
      "mission-1",
      "All work finished.",
      "executor",
    );
    expect(deps.clearHeartbeat).toHaveBeenCalledWith("mission-1");
  });

  it("older python envelopes without dedup: the mapper duplicate action is honored", async () => {
    enableFlag();
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "true");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dedup: _dedup, ...withoutDedup } = duplicateEnvelope;
    stubFetch(async () => jsonResponse(withoutDedup));
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: { ...baseEvent, delivery: { duplicate: true } },
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.finishMission).not.toHaveBeenCalled();
  });

  it("flag on but no duplicate verdict: applies normally", async () => {
    enableFlag();
    vi.stubEnv(EXECUTOR_EVENTS_DEDUP_ENFORCED_FLAG, "true");
    stubFetch(async () =>
      jsonResponse({
        ...pythonEnvelope({
          kind: "done",
          progress: 100,
          detail: "All work finished.",
          clearHeartbeat: true,
        }),
        dedup: { duplicate: false },
      }),
    );
    const deps = makeDeps();

    const handled = await runExecutorEventPythonProjection({
      event: baseEvent,
      mission,
      ctx,
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.finishMission).toHaveBeenCalled();
  });
});

describe("python-normalized artifacts consumption (slice 2)", () => {
  const applyPlan = {
    kind: "done",
    progress: 100,
    detail: "All work finished.",
    clearHeartbeat: true,
  };

  it("consumes a valid normalized artifacts list", async () => {
    enableFlag();
    stubFetch(async () =>
      jsonResponse({
        ...pythonEnvelope(applyPlan),
        artifacts: [
          {
            kind: "file",
            name: "report.json",
            path: "out/report.json",
            mimeType: "application/json",
            previewType: "json",
            size: 128,
          },
        ],
      }),
    );

    const result = await maybeProjectExecutorEventViaPython({
      event: { ...baseEvent, artifacts: [{ kind: "file", name: "report.json" }] },
      mission,
    });

    expect(result).not.toBeNull();
    expect(result!.artifactsProvided).toBe(true);
    expect(result!.artifacts).toEqual([
      {
        kind: "file",
        name: "report.json",
        path: "out/report.json",
        mimeType: "application/json",
        previewType: "json",
        size: 128,
        id: undefined,
        url: undefined,
        description: undefined,
      },
    ]);
  });

  it("an empty python list collapses to undefined but still claims the decision", async () => {
    enableFlag();
    stubFetch(async () =>
      jsonResponse({ ...pythonEnvelope(applyPlan), artifacts: [] }),
    );

    const result = await maybeProjectExecutorEventViaPython({
      event: {
        ...baseEvent,
        artifacts: [{ kind: "file", name: "evil", path: "../../etc/passwd" }],
      },
      mission,
    });

    expect(result).not.toBeNull();
    expect(result!.artifactsProvided).toBe(true);
    expect(result!.artifacts).toBeUndefined();
  });

  it("rejects traversal paths and malformed entries wholesale (fallback discipline)", async () => {
    enableFlag();
    for (const artifacts of [
      [{ kind: "file", name: "evil", path: "../../etc/passwd" }],
      [{ kind: "file", name: "evil", path: "ok/../../secret" }],
      [{ kind: "hologram", name: "x" }],
      [{ kind: "file", name: "" }],
      ["not-an-object"],
      "not-an-array",
    ]) {
      stubFetch(async () =>
        jsonResponse({ ...pythonEnvelope(applyPlan), artifacts }),
      );
      const result = await maybeProjectExecutorEventViaPython({
        event: baseEvent,
        mission,
      });
      expect(result).not.toBeNull();
      // Whole decision rejected -> Node keeps its own normalization.
      expect(result!.artifactsProvided).toBe(false);
      expect(result!.artifacts).toBeUndefined();
      vi.restoreAllMocks();
      enableFlag();
    }
  });

  it("absent artifacts field leaves the decision with Node", async () => {
    enableFlag();
    stubFetch(async () => jsonResponse(pythonEnvelope(applyPlan)));

    const result = await maybeProjectExecutorEventViaPython({
      event: baseEvent,
      mission,
    });

    expect(result).not.toBeNull();
    expect(result!.artifactsProvided).toBe(false);
  });
});

describe("applyPythonProjectedExecutorAction", () => {
  it("running/failed kinds mirror the inline runtime calls", () => {
    const deps = makeDeps();
    applyPythonProjectedExecutorAction(
      { kind: "running", progress: 55, detail: "working" },
      ctx,
      deps,
    );
    expect(deps.markMissionRunning).toHaveBeenCalledWith(
      "mission-1",
      "finalize",
      "working",
      55,
      "executor",
    );
    expect(deps.clearHeartbeat).not.toHaveBeenCalled();

    applyPythonProjectedExecutorAction(
      { kind: "failed", progress: 10, detail: "boom", error: "boom" },
      ctx,
      deps,
    );
    expect(deps.failMission).toHaveBeenCalledWith("mission-1", "boom", "executor");
    expect(deps.clearHeartbeat).toHaveBeenCalledWith("mission-1");
  });
});
