/**
 * Node -> Python thin proxy for the permission runtime surfaces served by
 * slide-rule-python routes/permissions.py (check / audit-hook / rate-limit /
 * policy decision), behind PERMISSIONS_PYTHON_PROXY (security-sensitive,
 * default OFF — explicit "true" opts in).
 *
 * These endpoints have no Node business implementation: flag off keeps the
 * existing Node surface (404 on these paths, management CRUD untouched);
 * infra failures surface as an explicit 502 python_unavailable.
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPermissionRouter, type PermissionRouterDeps } from "../permissions.js";

const PYTHON_BASE = "http://python-permissions.test";
const INTERNAL_KEY = "internal-permissions";

function makeDeps(): PermissionRouterDeps {
  return {
    roleStore: {
      listRoles: vi.fn(() => [{ roleId: "viewer" }]),
      getRole: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      listTemplates: vi.fn(() => []),
      getTemplate: vi.fn(),
      createTemplate: vi.fn(),
    } as unknown as PermissionRouterDeps["roleStore"],
    policyStore: {} as PermissionRouterDeps["policyStore"],
    tokenService: {} as PermissionRouterDeps["tokenService"],
    dynamicManager: {} as PermissionRouterDeps["dynamicManager"],
    conflictDetector: {} as PermissionRouterDeps["conflictDetector"],
    auditLogger: {} as PermissionRouterDeps["auditLogger"],
  };
}

async function withServer(handler: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/permissions", createPermissionRouter(makeDeps()));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  const address = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function stubPythonFetch(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1:")) {
      return originalFetch(input as RequestInfo, init);
    }
    return reply(url, init as RequestInit);
  });
}

function pythonCalls(fetchSpy: ReturnType<typeof stubPythonFetch>) {
  return fetchSpy.mock.calls.filter(
    ([url]) => !String(url instanceof Request ? url.url : url).startsWith("http://127.0.0.1:"),
  );
}

describe("permissions Python thin proxy (PERMISSIONS_PYTHON_PROXY)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates check / rate-limit / policy decision to Python when enabled", async () => {
    vi.stubEnv("PERMISSIONS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", `${PYTHON_BASE}/`);
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
    const replies: Record<string, unknown> = {
      [`${PYTHON_BASE}/api/permissions/check`]: {
        allowed: false,
        reason: "deny-first: no matching grant",
        provenance: "python-permission-check",
      },
      [`${PYTHON_BASE}/api/permissions/rate-limit/check`]: {
        allowed: true,
        remaining: 4,
      },
      [`${PYTHON_BASE}/api/permissions/policy/decision`]: {
        ok: true,
        decision: "deny",
        provenance: "python-policy-decision",
      },
    };
    const fetchSpy = stubPythonFetch(async (url) => {
      const body = replies[url];
      if (!body) throw new Error(`unexpected python call: ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await withServer(async (baseUrl) => {
      const checkResponse = await fetch(`${baseUrl}/api/permissions/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", operation: "select", resource: "db" }),
      });
      expect(checkResponse.status).toBe(200);
      expect(((await checkResponse.json()) as Record<string, any>).provenance).toBe(
        "python-permission-check",
      );

      const rateResponse = await fetch(`${baseUrl}/api/permissions/rate-limit/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "agent-1", maxPerMinute: 5 }),
      });
      expect(rateResponse.status).toBe(200);
      expect(((await rateResponse.json()) as Record<string, any>).remaining).toBe(4);

      const decisionResponse = await fetch(`${baseUrl}/api/permissions/policy/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });
      expect(decisionResponse.status).toBe(200);
      expect(((await decisionResponse.json()) as Record<string, any>).decision).toBe("deny");
    });

    const calls = pythonCalls(fetchSpy);
    expect(calls).toHaveLength(3);
    const [checkUrl, checkInit] = calls[0];
    expect(String(checkUrl)).toBe(`${PYTHON_BASE}/api/permissions/check`);
    expect((checkInit as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": INTERNAL_KEY,
    });
    expect(JSON.parse(String((checkInit as RequestInit).body))).toEqual({
      agentId: "agent-1",
      operation: "select",
      resource: "db",
    });
  });

  it("passes Python business 400 responses through verbatim", async () => {
    vi.stubEnv("PERMISSIONS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    stubPythonFetch(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "invalid_payload", message: "key is required" },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/permissions/rate-limit/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        error: { code: "invalid_payload", message: "key is required" },
      });
    });
  });

  it("returns an explicit 502 python_unavailable on infra failure (no Node business exists)", async () => {
    vi.stubEnv("PERMISSIONS_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    stubPythonFetch(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9700");
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/permissions/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "python_unavailable",
        backend: "python",
        endpoint: "/api/permissions/check",
      });
    });
  });

  it("keeps the existing Node surface when the flag is off (default)", async () => {
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    const fetchSpy = stubPythonFetch(async () => {
      throw new Error("python must not be called when PERMISSIONS_PYTHON_PROXY is off");
    });

    await withServer(async (baseUrl) => {
      // Delegated paths fall through to the existing Node surface: 404.
      const checkResponse = await fetch(`${baseUrl}/api/permissions/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });
      expect(checkResponse.status).toBe(404);

      // Node-owned management surface keeps working untouched.
      const rolesResponse = await fetch(`${baseUrl}/api/permissions/roles`);
      expect(rolesResponse.status).toBe(200);
      expect(((await rolesResponse.json()) as Record<string, any>).roles).toEqual([
        { roleId: "viewer" },
      ]);
    });
    expect(pythonCalls(fetchSpy)).toHaveLength(0);
  });
});
