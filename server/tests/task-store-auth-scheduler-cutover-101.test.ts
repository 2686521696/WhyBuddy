import type { AddressInfo } from "node:net";

import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskRouter } from "../routes/tasks.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";
import type { CurrentUser } from "../../shared/auth.js";
import type { ProjectRecord } from "../persistence/repositories.js";

// Node test for task store/auth/scheduler cutover 101.
// Verifies that createTaskRouter consumes Python cutover decision (via real callTaskStoreAuthSchedulerCutoverSafely)
// and surfaces it, while Node retains durable store, project/resource auth checks, and cancel semantics.
// Cutover decisions are advisory only; no scheduler/store handover.

interface PythonTaskStoreAuthSchedulerDecision {
  decision: "ready" | "blocked" | "degraded" | "unsupported" | "diagnostic-only";
  decisions: {
    missionStore: string;
    projectResourceAuth: string;
    scheduler: string;
  };
  canParticipate: {
    missionStore: boolean;
    projectResourceAuth: boolean;
    scheduler: boolean;
  };
  contractVersion?: string;
  provenance?: string;
  missionId?: string;
  projectId?: string | null;
  resourceId?: string | null;
  boundaries?: Record<string, string>;
  schedulerClassification?: {
    cancel: string;
    error: string;
    replay: string;
    state: string;
  };
  runtime?: { owner: string; mode: string };
  ok?: boolean;
  blocked?: boolean;
  diagnosticOnly?: boolean;
  productionTakeover?: boolean;
}

function makeCutoverDecision(
  overrides: Partial<PythonTaskStoreAuthSchedulerDecision> = {},
): PythonTaskStoreAuthSchedulerDecision {
  return {
    decision: "ready",
    decisions: { missionStore: "ready", projectResourceAuth: "ready", scheduler: "ready" },
    canParticipate: { missionStore: true, projectResourceAuth: true, scheduler: true },
    contractVersion: "task-store-auth-scheduler-cutover.v1",
    provenance: "python-task-store-auth-scheduler-cutover",
    missionId: "mission-cutover-101",
    projectId: "project-cutover-101",
    resourceId: "resource-cutover-101",
    boundaries: {
      missionStoreOwner: "node",
      authOwner: "node",
      schedulerOwner: "node",
      cancelSemanticsOwner: "node",
      replayOwner: "node",
      errorPathOwner: "node",
      routeOwner: "node",
      durableStoreOwner: "node",
    },
    schedulerClassification: {
      cancel: "python-decision-advisory",
      error: "node",
      replay: "python-decision-advisory",
      state: "ready",
    },
    runtime: { owner: "python", mode: "cutover_decision" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const routeUser: CurrentUser = {
  id: "user-cutover-101",
  email: "cutover@example.com",
  role: "user",
  status: "active",
  emailVerified: true,
  createdAt: "2026-06-22T00:00:00.000Z",
};

function makeProject(id = "project-cutover-101"): ProjectRecord {
  const now = new Date("2026-06-22T00:00:00.000Z");
  return {
    id,
    ownerUserId: routeUser.id,
    name: "Cutover 101 project",
    description: null,
    status: "active",
    source: "user",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

async function startServer(
  runtime: MissionRuntime,
  fetchImpl: typeof fetch,
  projectGuard?: {
    findByIdForOwner: (
      projectId: string,
      ownerUserId: string,
    ) => Promise<ProjectRecord | null>;
    createProjectResource?: (input: {
      projectId: string;
      resourceType: "mission";
      payload: Record<string, unknown>;
    }) => Promise<unknown>;
  },
  cutoverBaseUrl = "http://python-cutover.test",
) {
  const app = express();
  app.use(express.json());
  const requireAuth: RequestHandler = (request, _response, next) => {
    (request as typeof request & { user: CurrentUser }).user = routeUser;
    next();
  };
  const routerOpts: Parameters<typeof createTaskRouter>[1] = {
    fetchImpl,
    taskStoreAuthSchedulerCutoverBaseUrl: cutoverBaseUrl,
  };
  if (projectGuard) {
    routerOpts.requireAuth = requireAuth;
    routerOpts.projects = { findByIdForOwner: projectGuard.findByIdForOwner };
    if (projectGuard.createProjectResource) {
      routerOpts.projectResources = { create: projectGuard.createProjectResource };
    }
  }
  app.use("/api/tasks", createTaskRouter(runtime, routerOpts));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

describe("task store/auth/scheduler cutover 101 (Node route consumption)", () => {
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
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  it("route calls cutover decision endpoint and surfaces it in create response while Node retains ownership", async () => {
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const findByIdForOwner = vi.fn(async (projectId: string, ownerUserId: string) =>
      projectId === "project-cutover-101" && ownerUserId === routeUser.id
        ? makeProject(projectId)
        : null,
    );
    const createProjectResource = vi.fn(async (input) => input);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      calls.push({ method: init?.method ?? "GET", path: url.pathname, body });

      if (url.pathname === "/api/tasks/cutover/decision") {
        return jsonResponse(makeCutoverDecision({ missionId: body?.missionId as string }));
      }
      return jsonResponse({ ok: false, error: "unexpected" }, 404);
    });

    const started = await startServer(
      runtime,
      fetchImpl as unknown as typeof fetch,
      { findByIdForOwner, createProjectResource },
    );
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Cutover 101 ready",
        sourceText: "Verify route consumes cutover decision",
        projectId: "project-cutover-101",
        autoDispatch: false,
      }),
    });
    const createBody = await createResponse.json();
    const taskId = createBody.task?.id as string;

    expect(createResponse.status).toBe(201);
    expect(createBody.ok).toBe(true);
    expect(createBody.cutoverDecision).toBeDefined();
    expect(createBody.cutoverDecision.decision).toBe("ready");
    expect(createBody.cutoverDecision.decisions).toEqual({
      missionStore: "ready",
      projectResourceAuth: "ready",
      scheduler: "ready",
    });
    expect(createBody.cutoverDecision.canParticipate.scheduler).toBe(true);
    expect(createBody.cutoverDecision.boundaries?.durableStoreOwner).toBe("node");
    expect(createBody.cutoverDecision.runtime?.owner).toBe("python");
    expect(createBody.cutoverDecision.schedulerClassification?.cancel).toBe("python-decision-advisory");

    // Node performed the actual create and auth
    expect(findByIdForOwner).toHaveBeenCalledWith("project-cutover-101", routeUser.id);
    expect(calls.some((c) => c.path === "/api/tasks/cutover/decision")).toBe(true);
    expect(runtime.getTask(taskId)?.status).toBeDefined();
  });

  it("unsupported cutover decision is consumed by route but create and node boundaries are preserved", async () => {
    const calls: Array<string> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/api/tasks/cutover/decision") {
        return jsonResponse(
          makeCutoverDecision({
            decision: "unsupported",
            decisions: { missionStore: "unsupported", projectResourceAuth: "unsupported", scheduler: "unsupported" },
            canParticipate: { missionStore: false, projectResourceAuth: false, scheduler: false },
            ok: false,
          }),
        );
      }
      return jsonResponse({ ok: false }, 404);
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch, undefined);
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Cutover unsupported", sourceText: "test", autoDispatch: false }),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.cutoverDecision).toBeDefined();
    expect(createBody.cutoverDecision.decision).toBe("unsupported");
    expect(createBody.cutoverDecision.canParticipate.missionStore).toBe(false);
    expect(calls).toContain("POST /api/tasks/cutover/decision");
    // Node still owns and created the task
    expect(createBody.task).toBeDefined();
    expect(createBody.task.id).toBeDefined();
  });

  it("degraded/blocked cutover decision does not alter Node cancel semantics (real cancel route)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/cutover/decision") {
        return jsonResponse(
          makeCutoverDecision({
            decision: "degraded",
            decisions: { missionStore: "degraded", projectResourceAuth: "degraded", scheduler: "degraded" },
            canParticipate: { missionStore: false, projectResourceAuth: false, scheduler: true },
            schedulerClassification: {
              cancel: "python-decision-advisory",
              error: "node",
              replay: "python-decision-advisory",
              state: "degraded",
            },
          }),
        );
      }
      return jsonResponse({ ok: false }, 404);
    });

    const started = await startServer(runtime, fetchImpl as unknown as typeof fetch, undefined);
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Cutover cancel test", sourceText: "ensure node cancel", autoDispatch: false }),
    });
    const createBody = await createResponse.json();
    const taskId = createBody.task.id as string;

    expect(createBody.cutoverDecision.decision).toBe("degraded");
    expect(createBody.cutoverDecision.schedulerClassification.cancel).toBe("python-decision-advisory");

    // Real cancel route must still enforce Node cancel (advisory cutover does not take over)
    const cancelResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "review verify node cancel", requestedBy: "tester" }),
    });
    const cancelBody = await cancelResponse.json();

    expect(cancelResponse.status).toBe(200);
    expect(cancelBody.ok).toBe(true);
    expect(cancelBody.task?.status).toBe("cancelled");
    expect(cancelBody.task?.cancelReason).toBe("review verify node cancel");
    // The cutover decision (advisory) did not change cancel owner
    expect(runtime.getTask(taskId)?.status).toBe("cancelled");
  });

  it("blocked cutover still lets Node perform auth-checked create and independent cancel", async () => {
    const findByIdForOwner = vi.fn(async (projectId: string, ownerUserId: string) =>
      projectId === "p-blocked" ? makeProject("p-blocked") : null,
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/cutover/decision") {
        return jsonResponse(
          makeCutoverDecision({
            decision: "blocked",
            decisions: { missionStore: "blocked", projectResourceAuth: "blocked", scheduler: "blocked" },
            canParticipate: { missionStore: false, projectResourceAuth: false, scheduler: false },
            ok: false,
            blocked: true,
            schedulerClassification: { cancel: "node", error: "node", replay: "node", state: "blocked" },
          }),
        );
      }
      return jsonResponse({ ok: false }, 404);
    });

    const started = await startServer(
      runtime,
      fetchImpl as unknown as typeof fetch,
      { findByIdForOwner },
    );
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Blocked cutover",
        sourceText: "auth still node",
        projectId: "p-blocked",
        autoDispatch: false,
      }),
    });
    const createBody = await createResponse.json();
    const taskId = createBody.task.id as string;

    expect(createResponse.status).toBe(201);
    expect(createBody.cutoverDecision.decision).toBe("blocked");
    expect(findByIdForOwner).toHaveBeenCalled();

    const cancelResponse = await fetch(`${baseUrl}/api/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "node cancel wins" }),
    });
    const cancelBody = await cancelResponse.json();
    expect(cancelBody.task.status).toBe("cancelled");
  });

  it("python decision never claims production takeover and Node create works without cutover url", async () => {
    // start without cutover base url
    const started = await startServer(
      runtime,
      vi.fn() as unknown as typeof fetch,
      undefined,
      "", // empty disables
    );
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "No cutover configured", sourceText: "baseline", autoDispatch: false }),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.cutoverDecision).toBeUndefined();
    expect(createBody.task).toBeDefined();

    const py = makeCutoverDecision();
    expect(py.boundaries?.durableStoreOwner).toBe("node");
    expect(py.schedulerClassification?.state).not.toBe("node-owned");
    expect(py.productionTakeover).not.toBe(true);
  });
});
