import { describe, expect, it, vi } from "vitest";

import {
  ExecutorClient,
  ExecutorClientError,
} from "../core/executor-client.js";
import type {
  CancelExecutorJobRequest,
  CancelExecutorJobResponse,
  CreateExecutorJobResponse,
  ExecutorApiErrorResponse,
  ExecutorJobDetailResponse,
} from "../../shared/executor/api.js";
import type { ExecutionPlan } from "../../shared/executor/contracts.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createPlan(): ExecutionPlan {
  return {
    version: "2026-03-28",
    missionId: "mission-python-proxy",
    summary: "Run task executor proxy contract",
    objective: "Validate start/status/cancel/error shapes",
    requestedBy: "brain",
    mode: "managed",
    steps: [
      {
        key: "task.execute",
        label: "Execute task",
        description: "Run a task executor contract slice",
      },
    ],
    jobs: [
      {
        id: "job-python-proxy",
        key: "task.execute",
        label: "Execute task",
        description: "Run task executor contract slice",
        kind: "execute",
      },
    ],
  };
}

function createJobDetail(status: "running" | "failed" | "cancelled"): ExecutorJobDetailResponse {
  const eventType = status === "running"
    ? "job.progress"
    : status === "failed"
      ? "job.failed"
      : "job.cancelled";
  return {
    ok: true,
    job: {
      requestId: "request-python-proxy",
      missionId: "mission-python-proxy",
      jobId: "job-python-proxy",
      jobKey: "task.execute",
      jobLabel: "Execute task",
      kind: "execute",
      status,
      progress: status === "running" ? 45 : 100,
      message: status === "running" ? "Job is running" : `Job ${status}`,
      receivedAt: "2026-06-20T00:00:00.000Z",
      finishedAt: status === "running" ? undefined : "2026-06-20T00:00:05.000Z",
      errorCode: status === "failed" ? "TASK_EXECUTOR_FAILED" : undefined,
      errorMessage: status === "failed" ? "Task executor failed" : undefined,
      callbackMode: "pending",
      artifactCount: 0,
      artifacts: [],
      events: [
        {
          version: "2026-03-28",
          eventId: `event-${status}`,
          missionId: "mission-python-proxy",
          jobId: "job-python-proxy",
          executor: "lobster",
          type: eventType,
          status,
          occurredAt: "2026-06-20T00:00:01.000Z",
          message: status === "running" ? "Job is running" : `Job ${status}`,
          errorCode: status === "failed" ? "TASK_EXECUTOR_FAILED" : undefined,
        },
      ],
      dataDirectory: "executor-data/jobs/mission-python-proxy/job-python-proxy",
      logFile: "executor-data/jobs/mission-python-proxy/job-python-proxy/executor.log",
    },
  };
}

describe("ExecutorClient Python task executor proxy contract", () => {
  it("maps Python start, status, and cancel shapes without local executor side effects", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const startResponse: CreateExecutorJobResponse = {
      ok: true,
      accepted: true,
      requestId: "request-python-proxy",
      missionId: "mission-python-proxy",
      jobId: "job-python-proxy",
      receivedAt: "2026-06-20T00:00:00.000Z",
    };
    const cancelResponse: CancelExecutorJobResponse = {
      ok: true,
      accepted: true,
      cancelRequested: false,
      alreadyFinal: true,
      missionId: "mission-python-proxy",
      jobId: "job-python-proxy",
      status: "cancelled",
      message: "Job was already cancelled",
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: url.pathname, body });

      if (method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }
      if (method === "POST" && url.pathname === "/api/executor/jobs") {
        return jsonResponse(startResponse);
      }
      if (method === "GET" && url.pathname === "/api/executor/jobs/job-python-proxy") {
        return jsonResponse(createJobDetail("running"));
      }
      if (method === "POST" && url.pathname === "/api/executor/jobs/job-python-proxy/cancel") {
        expect(body).toEqual({
          reason: "operator cancel",
          requestedBy: "contract-test",
          source: "user",
        } satisfies CancelExecutorJobRequest);
        return jsonResponse(cancelResponse);
      }

      return jsonResponse({ ok: false, error: `unexpected ${method} ${url.pathname}` }, 404);
    });
    const client = new ExecutorClient({
      baseUrl: "http://python-proxy.test",
      callbackUrl: "http://node.test/api/executor/events",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-06-20T00:00:00.000Z"),
      createId: () => "generated-id",
    });

    const start = await client.dispatchPlan(createPlan(), {
      requestId: "request-python-proxy",
      jobId: "job-python-proxy",
    });
    const status = await client.getJob("job-python-proxy");
    const cancel = await client.cancelJob("job-python-proxy", {
      reason: "operator cancel",
      requestedBy: "contract-test",
      source: "user",
    });

    expect(start.response).toEqual(startResponse);
    expect(start.response).not.toHaveProperty("containerId");
    expect(status).toMatchObject({
      jobId: "job-python-proxy",
      status: "running",
      progress: 45,
      callbackMode: "pending",
    });
    expect(cancel).toEqual(cancelResponse);
    expect(cancel.status).toBe("cancelled");
    expect(cancel.status).not.toBe("completed");
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /health",
      "POST /api/executor/jobs",
      "GET /api/executor/jobs/job-python-proxy",
      "POST /api/executor/jobs/job-python-proxy/cancel",
    ]);
  });

  it("preserves failed and cancelled status responses instead of coercing them to success", async () => {
    const client = new ExecutorClient({
      baseUrl: "http://python-proxy.test",
      callbackUrl: "http://node.test/api/executor/events",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/failed-job")) {
          return jsonResponse(createJobDetail("failed"));
        }
        return jsonResponse(createJobDetail("cancelled"));
      },
    });

    await expect(client.getJob("failed-job")).resolves.toMatchObject({
      status: "failed",
      errorCode: "TASK_EXECUTOR_FAILED",
    });
    await expect(client.getJob("cancelled-job")).resolves.toMatchObject({
      status: "cancelled",
      events: [
        expect.objectContaining({
          type: "job.cancelled",
          status: "cancelled",
        }),
      ],
    });
  });

  it("maps Python executor error payloads to rejected client errors", async () => {
    const errorResponse: ExecutorApiErrorResponse = {
      ok: false,
      error: "Task executor request timed out",
      code: "TASK_EXECUTOR_TIMEOUT",
      hint: "Treat this as unavailable/rejected; do not mark the task completed.",
    };
    const client = new ExecutorClient({
      baseUrl: "http://python-proxy.test",
      callbackUrl: "http://node.test/api/executor/events",
      fetchImpl: async () => jsonResponse(errorResponse, 504),
    });

    await expect(client.cancelJob("job-python-proxy", {
      reason: "operator cancel",
    })).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "rejected",
      statusCode: 504,
      details: {
        code: "TASK_EXECUTOR_TIMEOUT",
        hint: "Treat this as unavailable/rejected; do not mark the task completed.",
      },
    } satisfies Partial<ExecutorClientError>);
  });

  it("does not treat aborted Python cancel requests as successful cancellation", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const client = new ExecutorClient({
      baseUrl: "http://python-proxy.test",
      callbackUrl: "http://node.test/api/executor/events",
      fetchImpl: async () => {
        throw abortError;
      },
    });

    await expect(client.cancelJob("job-python-proxy", {
      reason: "operator cancel",
    })).rejects.toMatchObject({
      name: "ExecutorClientError",
      kind: "unavailable",
    } satisfies Partial<ExecutorClientError>);
  });
});
