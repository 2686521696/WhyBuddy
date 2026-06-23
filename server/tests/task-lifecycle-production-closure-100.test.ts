import type { AddressInfo } from "node:net";

import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskRouter } from "../routes/tasks.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";
import type { CurrentUser } from "../../shared/auth.js";
import type { ProjectRecord } from "../persistence/repositories.js";

const routeUser: CurrentUser = {
  id: "user-1",
  email: "user@example.com",
  role: "user",
  status: "active",
  emailVerified: true,
  createdAt: "2026-06-22T00:00:00.000Z",
};

function makeProject(id = "project-closure-100"): ProjectRecord {
  const now = new Date("2026-06-22T00:00:00.000Z");
  return {
    id,
    ownerUserId: routeUser.id,
    name: "Closure project",
    description: null,
    status: "active",
    source: "user",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function startServerWithClosure(
  runtime: MissionRuntime,
  fetchImpl: typeof fetch,
  closureBaseUrl?: string,
) {
  const app = express();
  app.use(express.json());
  const requireAuth: RequestHandler = (request, _response, next) => {
    (request as typeof request & { user: CurrentUser }).user = routeUser;
    next();
  };
  app.use(
    "/api/tasks",
    createTaskRouter(runtime, {
      fetchImpl,
      executorBaseUrl: "http://python-runtime.test",
      taskLifecycleRuntimeBaseUrl: "http://python-runtime.test",
      ...(closureBaseUrl
        ? {
            taskLifecycleProductionClosureBaseUrl: closureBaseUrl,
          }
        : {}),
      requireAuth,
      projects: {
        findByIdForOwner: async (projectId: string, ownerUserId: string) =>
          projectId === "project-closure-100" && ownerUserId === routeUser.id
            ? makeProject(projectId)
            : null,
      },
      projectResources: {
        create: async (input) => input,
      },
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

describe("task lifecycle production closure 100 - node consumption", () => {
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

  it("Node route consumes Python closure summary on create, preserves mission/project/resource ids and metadata", async () => {
    const closureCalls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/runtime/closure") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
        closureCalls.push(body);
        return jsonResponse({
          ok: true,
          status: "closed",
          action: "create",
          contractVersion: "task-lifecycle.production-closure.v1",
          provenance: "python-task-lifecycle-production-closure",
          missionId: (body.missionId as string) || "mission-closure-100",
          projectId: (body.projectId as string) || "project-closure-100",
          resourceId: "resource-closure-100",
          runtime: { owner: "python", mode: "production_closure", missionStoreOwner: "node" },
          closureSummary: {
            missionId: (body.missionId as string) || "mission-closure-100",
            projectId: (body.projectId as string) || "project-closure-100",
            resourceId: "resource-closure-100",
            actor: { id: "user-closure" },
            decision: "applied",
            projection: { projectId: "project-closure-100", resourceId: "resource-closure-100" },
          },
          metadata: body.metadata,
        });
      }
      // fallback for lifecycle runtime
      return jsonResponse({ ok: true, action: "create", contractVersion: "task-lifecycle.runtime-boundary.v1", runtime: { owner: "python" }, task: { id: "m", status: "started", nodeStatus: "running", progress: 4, message: "ok", updatedAt: "2026-06-22T00:00:00.000Z" } });
    });

    const started = await startServerWithClosure(runtime, fetchImpl as unknown as typeof fetch, "http://python-closure.test");
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Closure create",
        sourceText: "production closure test",
        projectId: "project-closure-100",
        autoDispatch: false,
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.closure).toBeDefined();
    expect(body.closure.ok).toBe(true);
    expect(body.closure.provenance).toBe("python-task-lifecycle-production-closure");
    expect(body.closure.missionId).toBe(body.task.id);
    expect(body.closure.projectId).toBe("project-closure-100");
    expect(body.closure.resourceId).toBe("resource-closure-100");
    expect(body.closure.closureSummary.decision).toBe("applied");
    expect(body.closure.runtime.missionStoreOwner).toBe("node");
    expect(closureCalls.length).toBeGreaterThan(0);
    expect(closureCalls[0]).toMatchObject({ action: "create", projectId: "project-closure-100" });
    // actor and event sequence passed to production closure (per review)
    expect(closureCalls[0].actor).toBeDefined();
    expect((closureCalls[0].actor as any)?.id).toBe(routeUser.id);
    expect(Array.isArray(closureCalls[0].events)).toBe(true);
  });

  it("auth-denied from Python closure is not written as completed", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/runtime/closure") {
        return jsonResponse({
          ok: false,
          status: "denied",
          action: "auth-denied",
          code: "TASK_LIFECYCLE_AUTH_DENIED",
          message: "Project or resource authorization denied.",
          closureSummary: { decision: "denied", missionId: "denied-m" },
        });
      }
      return jsonResponse({ ok: true, action: "create", contractVersion: "v1", task: { id: "denied-m", status: "started", nodeStatus: "running", progress: 4, message: "", updatedAt: "2026-06-22T00:00:00.000Z" } });
    });

    const started = await startServerWithClosure(runtime, fetchImpl as unknown as typeof fetch, "http://python-closure.test");
    server = started.server;
    baseUrl = started.baseUrl;

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Auth denied test",
        sourceText: "denied",
        projectId: "project-closure-100",
        autoDispatch: false,
      }),
    });
    const body = await res.json();

    // route still returns 201 (node owns), but closure reports denied
    expect(res.status).toBe(201);
    expect(body.closure).toBeDefined();
    expect(body.closure.ok).toBe(false);
    expect(body.closure.status).toBe("denied");
    expect(body.closure.code).toBe("TASK_LIFECYCLE_AUTH_DENIED");
    // ensure no coercion to completed
    expect(String(JSON.stringify(body.closure))).not.toContain("completed");
  });

  it("Node project/resource auth denial triggers auth-denied closure at boundary (no mission created, denied not completed)", async () => {
    const closureCalls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/runtime/closure") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
        closureCalls.push(body);
        return jsonResponse({
          ok: false,
          status: "denied",
          action: "auth-denied",
          code: "TASK_LIFECYCLE_AUTH_DENIED",
          message: "Project or resource authorization denied.",
          closureSummary: { decision: "denied", missionId: undefined, projectId: body.projectId },
        });
      }
      // should not reach runtime for denied project
      return jsonResponse({ ok: false, error: "should-not-reach" });
    });

    const started = await startServerWithClosure(runtime, fetchImpl as unknown as typeof fetch, "http://python-closure.test");
    server = started.server;
    baseUrl = started.baseUrl;

    // use a projectId that the finder will reject (only "project-closure-100" is allowed for this user)
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Auth denied by node project",
        sourceText: "node denies auth",
        projectId: "project-denied-by-node-404",
        autoDispatch: false,
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Project not found.");
    // closure must have been invoked from the auth denial boundary
    expect(closureCalls.some((c) => c.action === "auth-denied" && c.projectId === "project-denied-by-node-404")).toBe(true);
    const deniedCall = closureCalls.find((c) => c.action === "auth-denied");
    expect(deniedCall).toBeDefined();
    // ensure no completed written anywhere (no task materialized)
    expect(String(JSON.stringify(deniedCall || body))).not.toContain("completed");
    // actor may be present from middleware
    // verify not created a task id
    expect(body.task).toBeUndefined();
  });

  it("cancel and error paths through closure retain event seq and never drop to completed", async () => {
    const closureCalls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const bodyText = typeof init?.body === "string" ? init.body : "";
      let parsedBody: Record<string, unknown> = {};
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        parsedBody = {};
      }

      if (url.pathname === "/api/tasks/runtime/closure") {
        closureCalls.push(parsedBody);
        const action = parsedBody.action as string;
        const missionId = (parsedBody.missionId as string) || "m-closure";
        if (action === "error" || parsedBody.error) {
          return jsonResponse({
            ok: false,
            status: "failed",
            action: "error",
            code: "EXEC_FAILED",
            message: "simulated error",
            closureSummary: {
              missionId,
              decision: "error",
              taskProjection: { status: "failed" },
            },
          });
        }
        if (action === "cancel") {
          return jsonResponse({
            ok: true,
            status: "closed",
            action: "cancel",
            contractVersion: "task-lifecycle.production-closure.v1",
            provenance: "python-task-lifecycle-production-closure",
            missionId,
            projectId: parsedBody.projectId,
            runtime: { owner: "python", mode: "production_closure", missionStoreOwner: "node" },
            closureSummary: {
              missionId,
              projectId: parsedBody.projectId,
              decision: "applied",
              cancel: { missionId, cancelRequested: true },
              projection: { projectId: parsedBody.projectId },
            },
          });
        }
        if (action === "replay") {
          return jsonResponse({
            ok: true,
            status: "closed",
            action: "replay",
            missionId,
            closureSummary: {
              missionId,
              decision: "applied",
              replay: { eventCount: Array.isArray(parsedBody.events) ? parsedBody.events.length : 0 },
            },
          });
        }
        // default create etc
        return jsonResponse({
          ok: true,
          status: "closed",
          action,
          missionId,
          projectId: parsedBody.projectId,
          resourceId: "resource-closure-100",
          closureSummary: {
            missionId,
            projectId: parsedBody.projectId,
            actor: parsedBody.actor,
            decision: "applied",
          },
        });
      }

      // lifecycle runtime fallback; trigger error for special sourceText to exercise error closure path
      const isRuntime = url.pathname.includes("/api/tasks/runtime/");
      if (isRuntime) {
        const rtAction = parsedBody.action as string;
        const taskIn = (parsedBody.task as Record<string, unknown>) || {};
        const src = typeof taskIn.sourceText === "string" ? taskIn.sourceText : "";
        if (rtAction === "create" && src.includes("trigger-error-lifecycle")) {
          return jsonResponse({
            ok: false,
            action: "create",
            code: "SIM_LIFECYCLE_ERROR",
            error: "simulated",
            message: "lifecycle error to drive error closure",
          });
        }
        // success runtime envelope for create/status etc
        const mId = (taskIn.id as string) || (parsedBody.missionId as string) || "m-rt";
        return jsonResponse({
          ok: true,
          action: rtAction || "create",
          contractVersion: "task-lifecycle.runtime-boundary.v1",
          runtime: { owner: "python" },
          task: { id: mId, status: "started", nodeStatus: "running", progress: 0, message: "ok", updatedAt: "2026-06-22T00:00:00.000Z" },
        });
      }
      return jsonResponse({ ok: true });
    });

    const started = await startServerWithClosure(runtime, fetchImpl as unknown as typeof fetch, "http://python-closure.test");
    server = started.server;
    baseUrl = started.baseUrl;

    // 1. normal create consumes closure (actor present)
    const createRes = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Closure cancel test",
        sourceText: "normal create",
        projectId: "project-closure-100",
        autoDispatch: false,
      }),
    });
    const createBody = await createRes.json();
    expect(createRes.status).toBe(201);
    expect(createBody.closure).toBeDefined();
    expect(createBody.closure.action).toBe("create");
    expect(createBody.closure.closureSummary.actor).toBeDefined();
    expect(closureCalls.some((c) => c.action === "create")).toBe(true);

    const missionId = createBody.task.id;

    // 2. cancel path: calls route + runtime + closure adapter, includes cancel, preserves ids, no completed
    const cancelRes = await fetch(`${baseUrl}/api/tasks/${missionId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "review fix cancel", source: "user" }),
    });
    const cancelBody = await cancelRes.json();
    expect(cancelRes.status).toBe(200);
    expect(cancelBody.closure).toBeDefined();
    expect(cancelBody.closure.action).toBe("cancel");
    expect(cancelBody.closure.closureSummary?.cancel).toBeTruthy();
    expect(cancelBody.closure.missionId).toBe(missionId);
    expect(String(JSON.stringify(cancelBody.closure))).not.toMatch(/completed/);
    expect(closureCalls.some((c) => c.action === "cancel")).toBe(true);

    // 3. replay path via events: consumes closure with events seq
    const eventsRes = await fetch(`${baseUrl}/api/tasks/${missionId}/events`);
    const eventsBody = await eventsRes.json();
    expect(eventsRes.status).toBe(200);
    expect(eventsBody.closure).toBeDefined();
    expect(eventsBody.closure.action).toBe("replay");
    expect(eventsBody.closure.closureSummary?.replay).toBeDefined();
    expect(String(JSON.stringify(eventsBody.closure))).not.toMatch(/completed/);
    expect(closureCalls.some((c) => c.action === "replay")).toBe(true);

    // 4. error path: lifecycle fail leads to error action closure (never completed)
    const errCreateRes = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "nl-command",
        title: "Error closure",
        sourceText: "trigger-error-lifecycle for error path",
        projectId: "project-closure-100",
        autoDispatch: false,
      }),
    });
    const errBody = await errCreateRes.json();
    // create may still 201 or 200? but in error-lifecycle it attaches closure with ok false
    expect(errBody.closure).toBeDefined();
    expect(errBody.closure.ok).toBe(false);
    expect(errBody.closure.action).toBe("error");
    expect(errBody.closure.code).toBe("EXEC_FAILED");
    expect(String(JSON.stringify(errBody.closure))).not.toContain("completed");
    expect(closureCalls.some((c) => c.action === "error")).toBe(true);

    // overall: actor passed on create path
    const createCall = closureCalls.find((c) => c.action === "create");
    expect(createCall).toBeDefined();
    expect(createCall!.actor).toBeDefined();
    expect((createCall!.actor as any)?.id).toBe(routeUser.id);
  });
});
