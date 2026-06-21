import type { AddressInfo } from "node:net";

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskRouter } from "../routes/tasks.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function startServer(
  runtime: MissionRuntime,
  fetchImpl: typeof fetch,
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/tasks",
    createTaskRouter(runtime, {
      fetchImpl,
      executorBaseUrl: "http://python-runtime.test",
    }),
  );

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

describe("task lifecycle route with Python runtime boundary envelopes", () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";

  beforeEach(() => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  it("maps Python start and status envelopes through /api/tasks while mission store remains Node-owned", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);

      if (url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }
      if (url.pathname === "/api/executor/jobs") {
        return jsonResponse({
          ok: true,
          accepted: true,
          requestId: "request-python-lifecycle",
          missionId: "mission-from-python-envelope",
          jobId: "job-python-lifecycle",
          receivedAt: "2026-06-22T00:00:00.000Z",
          runtime: {
            owner: "python",
            persistenceOwner: "node",
            missionStoreOwner: "node",
          },
        });
      }

      return jsonResponse({ ok: false, error: "unexpected path" }, 404);
    });
    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Python lifecycle start",
        sourceText: "Run tests with Python lifecycle runtime.",
        autoDispatch: true,
      }),
    });
    const createBody = await createResponse.json();
    const taskId = createBody.task.id as string;
    const statusResponse = await fetch(`${baseUrl}/api/tasks/${taskId}`);
    const statusBody = await statusResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody).toMatchObject({
      ok: true,
      dispatchAccepted: true,
      task: {
        id: taskId,
        status: "running",
        currentStageKey: "execute",
        executor: {
          jobId: "job-python-lifecycle",
          status: "queued",
          baseUrl: "http://python-runtime.test",
        },
      },
    });
    expect(statusResponse.status).toBe(200);
    expect(statusBody).toMatchObject({
      ok: true,
      task: {
        id: taskId,
        status: "running",
        executor: {
          jobId: "job-python-lifecycle",
          status: "queued",
        },
      },
    });
    expect(runtime.getTask(taskId)?.projection?.projectId).toBeUndefined();
    expect(calls).toEqual(["GET /health", "POST /api/executor/jobs"]);
  });

  it("maps Python cancel envelope to cancelled, not completed success", async () => {
    const mission = runtime.createChatTask("Python lifecycle cancel");
    runtime.patchMissionExecution(mission.id, {
      executor: {
        name: "lobster",
        jobId: "job-python-cancel",
        status: "running",
        baseUrl: "http://python-runtime.test",
      },
    });
    runtime.markMissionRunning(mission.id, "execute", "Python runtime running", 50);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/executor/jobs/job-python-cancel/cancel");
      return jsonResponse({
        ok: true,
        accepted: true,
        cancelRequested: true,
        alreadyFinal: false,
        missionId: mission.id,
        jobId: "job-python-cancel",
        status: "cancelled",
        message: "Cancellation requested",
        runtime: {
          owner: "python",
          persistenceOwner: "node",
          missionStoreOwner: "node",
        },
      });
    });
    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "operator cancelled",
        requestedBy: "runtime-test",
        source: "user",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      alreadyFinal: false,
      executorForwarded: true,
      task: {
        id: mission.id,
        status: "cancelled",
        cancelReason: "operator cancelled",
        cancelledBy: "runtime-test",
      },
    });
    expect(body.task.status).not.toBe("done");
    expect(body.task.status).not.toBe("completed");
  });

  it("maps Python runtime error envelope to failed task dispatch instead of success", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }
      if (url.pathname === "/api/executor/jobs") {
        return jsonResponse(
          {
            ok: false,
            error: "Python lifecycle runtime failed.",
            code: "TASK_LIFECYCLE_RUNTIME_ERROR",
            hint: "Do not mark the task completed.",
          },
          500,
        );
      }
      return jsonResponse({ ok: false, error: "unexpected path" }, 404);
    });
    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch);
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Python lifecycle error",
        sourceText: "Run tests and surface Python lifecycle error.",
        autoDispatch: true,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      dispatchAccepted: false,
      task: {
        status: "failed",
        currentStageKey: "provision",
      },
    });
    expect(body.task.status).not.toBe("done");
    expect(body.dispatchError).toContain("TASK_LIFECYCLE_RUNTIME_ERROR");
    expect(body.dispatchError).toContain("Do not mark the task completed.");
  });
});
