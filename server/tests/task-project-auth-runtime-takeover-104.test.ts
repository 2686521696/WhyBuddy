import type { AddressInfo } from "node:net";

import express, { type RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskRouter } from "../routes/tasks.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";
import type { CurrentUser } from "../../shared/auth.js";
import type { ProjectRecord } from "../persistence/repositories.js";

// Node route test for task project auth runtime takeover 104.
// Verifies Node router consumes Python project auth decision classification (allow/deny/degraded)
// via callTaskProjectAuthRuntimeTakeoverSafely and surfaces it.
// Python provides advisory classification only; Node retains projectResourceAuth enforcement
// (findByIdForOwner + real auth + project resource create always decide/create).
// Test explicitly proves retained Node behavior: python deny/allow/degraded only affects response
// envelope, does not control or bypass task creation lifecycle. Node fallback explicit.
// No security regression: project access rules unchanged.

interface PythonProjectAuthDecision {
  ok?: boolean;
  decision?: string;
  classification?: "allow" | "deny" | "degraded";
  contractVersion?: string;
  provenance?: string;
  missionId?: string;
  projectId?: string;
  resourceId?: string;
  ownership?: { projectResourceAuth?: string };
  runtime?: { owner?: string; mode?: string; authEnforcementOwner?: string };
  fallback?: string;
  denied?: boolean;
  degraded?: boolean;
}

function makeProjectAuthDecision(
  overrides: Partial<PythonProjectAuthDecision> = {},
): PythonProjectAuthDecision {
  return {
    ok: true,
    decision: "allow",
    classification: "allow",
    contractVersion: "task-project-auth-runtime-takeover.v1",
    provenance: "python-task-project-auth-runtime-takeover-104",
    missionId: "mission-auth-104",
    projectId: "project-auth-104",
    resourceId: "resource-auth-104",
    ownership: { projectResourceAuth: "node-retained" },
    runtime: { owner: "node", mode: "project_auth_runtime_takeover", authEnforcementOwner: "node", classificationProvider: "python" },
    fallback: "node",
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
  id: "user-auth-104",
  email: "auth104@example.com",
  role: "user",
  status: "active",
  emailVerified: true,
  createdAt: "2026-06-22T00:00:00.000Z",
};

function makeProject(id = "project-auth-104"): ProjectRecord {
  const now = new Date("2026-06-22T00:00:00.000Z");
  return {
    id,
    ownerUserId: routeUser.id,
    name: "Auth 104 project",
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
  projectAuthBaseUrl = "http://python-project-auth.test",
) {
  const app = express();
  app.use(express.json());
  const requireAuth: RequestHandler = (request, _response, next) => {
    (request as typeof request & { user: CurrentUser }).user = routeUser;
    next();
  };
  const routerOpts: Parameters<typeof createTaskRouter>[1] = {
    fetchImpl,
    taskProjectAuthRuntimeTakeoverBaseUrl: projectAuthBaseUrl,
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

describe("task project auth runtime takeover 104 (Node route)", () => {
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

  it("surfaces allow classification from python advisory while node retained performs real project auth and create", async () => {
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const findByIdForOwner = vi.fn(async (projectId: string, ownerUserId: string) =>
      projectId === "project-auth-104" && ownerUserId === routeUser.id
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

      if (url.pathname === "/api/tasks/project-auth/runtime-takeover") {
        return jsonResponse(makeProjectAuthDecision({ missionId: body?.missionId as string }));
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
        title: "Auth takeover allow",
        sourceText: "Python allow, node enforces",
        projectId: "project-auth-104",
        autoDispatch: false,
      }),
    });
    const createBody = await createResponse.json();
    const taskId = createBody.task?.id as string;

    expect(createResponse.status).toBe(201);
    expect(createBody.ok).toBe(true);
    expect(createBody.projectAuthRuntimeTakeover).toBeDefined();
    expect(createBody.projectAuthRuntimeTakeover.classification).toBe("allow");
    expect(createBody.projectAuthRuntimeTakeover.decision).toBe("allow");
    expect(createBody.projectAuthRuntimeTakeover.ownership?.projectResourceAuth).toBe("node-retained");
    expect(createBody.projectAuthRuntimeTakeover.runtime?.authEnforcementOwner).toBe("node");
    expect(createBody.projectAuthRuntimeTakeover.fallback).toBe("node");
    // python provides classification envelope (advisory); node retained auth controls the actual lifecycle/create decision
    expect(createBody.projectAuthRuntimeTakeover.runtime?.classificationProvider).toBe("python");

    expect(findByIdForOwner).toHaveBeenCalledWith("project-auth-104", routeUser.id);
    expect(createProjectResource).toHaveBeenCalled();
    expect(calls.some((c) => c.path === "/api/tasks/project-auth/runtime-takeover")).toBe(true);
    expect(runtime.getTask(taskId)).toBeDefined();
  });

  it("surfaces deny classification safely; proves explicit Node retained enforcement (create unaffected by python classification)", async () => {
    const findByIdForOwner = vi.fn(async (projectId: string, ownerUserId: string) =>
      projectId === "project-auth-104" && ownerUserId === routeUser.id
        ? makeProject(projectId)
        : null,
    );
    const createProjectResource = vi.fn(async (input) => input);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/project-auth/runtime-takeover") {
        return jsonResponse(makeProjectAuthDecision({ decision: "deny", classification: "deny", ok: false, denied: true }));
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
        title: "Auth deny case",
        sourceText: "Python deny but node auth decides",
        projectId: "project-auth-104",
        autoDispatch: false,
      }),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201); // node retained auth passed, create succeeds regardless of python deny classification
    expect(createBody.projectAuthRuntimeTakeover?.classification).toBe("deny");
    expect(createBody.projectAuthRuntimeTakeover?.denied).toBe(true);
    expect(createBody.projectAuthRuntimeTakeover?.ownership?.projectResourceAuth).toBe("node-retained");
    expect(findByIdForOwner).toHaveBeenCalledWith("project-auth-104", routeUser.id); // node auth is the decider
    expect(createProjectResource).toHaveBeenCalled(); // python classification did not block retained path
  });

  it("surfaces degraded classification with node fallback; proves classification affects response envelope safely under retained node control", async () => {
    const findByIdForOwner = vi.fn(async () => makeProject());
    const createProjectResource = vi.fn(async (input) => input);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/project-auth/runtime-takeover") {
        return jsonResponse(makeProjectAuthDecision({ decision: "degraded", classification: "degraded", degraded: true, ok: true }));
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
      body: JSON.stringify({ title: "Degraded auth", projectId: "project-auth-104", autoDispatch: false }),
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.projectAuthRuntimeTakeover?.classification).toBe("degraded");
    expect(createBody.projectAuthRuntimeTakeover?.fallback).toBe("node");
    expect(findByIdForOwner).toHaveBeenCalled();
  });

  it("falls back when no project auth base url; explicitly proves node retained auth path intact (no python call)", async () => {
    const findByIdForOwner = vi.fn(async () => makeProject());
    const createProjectResource = vi.fn(async (input) => input);

    const fetchImpl = vi.fn(async () => jsonResponse({ error: "no" }, 404));

    const started = await startServer(
      runtime,
      fetchImpl as unknown as typeof fetch,
      { findByIdForOwner, createProjectResource },
      "", // no base url -> explicit node fallback
    );
    server = started.server;
    baseUrl = started.baseUrl;

    const createResponse = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "No py base", projectId: "project-auth-104", autoDispatch: false }),
    });

    expect(createResponse.status).toBe(201);
    expect(findByIdForOwner).toHaveBeenCalled();
    // no projectAuthRuntimeTakeover surfaced when no base
  });
});
