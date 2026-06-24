import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  validateAuthSessionRepositoryTakeover,
  type AuthSessionRepositoryTakeoverResult,
} from "../auth/session-service.js";
import { createAuthRouter } from "../routes/auth.js";
import type { SessionService } from "../auth/session-service.js";

async function withAuthServer(
  overrides: Partial<Parameters<typeof createAuthRouter>[0]>,
  handler: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  const mockSessionService = {
    createSession: vi.fn(async () => ({ token: "t" })),
    writeSessionCookie: vi.fn(),
    refreshSession: vi.fn(async () => ({ success: true })),
    revokeSession: vi.fn(async () => ({ success: true })),
    clearCookie: vi.fn(),
    requireAuth: (req: any, res: any, next: any) => next(),
  } as unknown as SessionService;

  app.use(
    "/api/auth",
    createAuthRouter({
      users: {} as never,
      sessions: {} as never,
      sessionService: mockSessionService,
      ...overrides,
    } as any),
  );

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

describe("auth-session-repository-takeover-104 - node consumption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates python session repository takeover and distinguishes ownership", () => {
    const ready = validateAuthSessionRepositoryTakeover({
      status: "python-owned",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "python-auth-session-repository-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "session_repository_takeover" },
      ownership: {
        sessionRepository: "python-owned",
      },
      productionTakeover: true,
      metadata: { traceId: "r-104" },
    });
    expect(ready.status).toBe("python-owned");
    expect(ready.ok).toBe(true);
    expect(ready.ownership?.sessionRepository).toBe("python-owned");
    expect(ready.productionTakeover).toBe(true);

    const blocked = validateAuthSessionRepositoryTakeover({ status: "blocked" });
    expect(blocked.status).toBe("blocked");
    expect(blocked.ok).toBe(false);

    const nodeRet = validateAuthSessionRepositoryTakeover({ status: "node-retained" });
    expect(nodeRet.status).toBe("node-retained");
    expect(nodeRet.productionTakeover).toBe(false);
  });

  it("auth route layer can consume takeover via pythonAuthSessionRepositoryTakeover dep", async () => {
    const pythonTakeover = {
      execute: vi.fn(async (p: any) => ({
        status: "python-owned",
        contractVersion: "auth-session-repository-takeover.v1",
        provenance: "python-auth-session-repository-takeover-104",
        ok: true,
        runtime: { owner: "python", mode: "session_repository_takeover" },
        ownership: {
          sessionRepository: "python-owned",
        },
        productionTakeover: true,
        metadata: { source: p?.metadata?.source },
      })),
    };

    await withAuthServer({ pythonAuthSessionRepositoryTakeover: pythonTakeover }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-session-repository-takeover`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.takeover.status).toBe("python-owned");
      expect(pythonTakeover.execute).toHaveBeenCalled();
      expect(json.takeover.ownership.sessionRepository).toBe("python-owned");
      expect(json.takeover.productionTakeover).toBe(true);
    });
  });

  it("falls back to node-retained when no python takeover wired", async () => {
    await withAuthServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-session-repository-takeover`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(["node-retained", "skipped-live", "blocked", "out-of-scope"]).toContain(json.takeover.status);
      expect(json.takeover.productionTakeover).toBe(false);
    });
  });

  it("node tests cover create/read/revoke or fallback behavior", () => {
    const withCreate = validateAuthSessionRepositoryTakeover({
      status: "python-owned",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "python-auth-session-repository-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "session_repository_takeover" },
      ownership: { sessionRepository: "python-owned", operation: "create" },
      productionTakeover: true,
      operationResult: { ok: true, operation: "create", sessionId: "s-c" },
    });
    expect(withCreate.productionTakeover).toBe(true);
    expect(withCreate.operationResult?.operation).toBe("create");

    const withRead = validateAuthSessionRepositoryTakeover({
      status: "python-owned",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "python-auth-session-repository-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "session_repository_takeover" },
      ownership: { sessionRepository: "python-owned", operation: "read" },
      productionTakeover: true,
      operationResult: { valid: true, sessionId: "s-r" },
    });
    expect(withRead.ownership?.operation).toBe("read");

    const withRevoke = validateAuthSessionRepositoryTakeover({
      status: "python-owned",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "python-auth-session-repository-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "session_repository_takeover" },
      ownership: { sessionRepository: "python-owned", operation: "revoke" },
      productionTakeover: true,
      operationResult: { ok: true, state: "logged_out", sessionId: "s-rev" },
    });
    expect(withRevoke.operationResult?.state).toBe("logged_out");

    const fallback = validateAuthSessionRepositoryTakeover({ status: "node-retained" });
    expect(fallback.status).toBe("node-retained");
    expect(fallback.productionTakeover).not.toBe(true);
  });

  it("takeover flag true only for proven slice; retained explicit otherwise", () => {
    const proven = validateAuthSessionRepositoryTakeover({
      status: "python-owned",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "python-auth-session-repository-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "session_repository_takeover" },
      ownership: { sessionRepository: "python-owned" },
      productionTakeover: true,
    });
    expect(proven.productionTakeover).toBe(true);

    const retained = validateAuthSessionRepositoryTakeover({
      status: "node-retained",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      ownership: { sessionRepository: "node-retained" },
      productionTakeover: false,
    });
    expect(retained.productionTakeover).toBe(false);
    expect(retained.ownership?.sessionRepository).toBe("node-retained");
  });

  it("retaining existing security failure semantics", () => {
    const invalid = validateAuthSessionRepositoryTakeover({ foo: "bar" });
    expect(invalid.ok).toBe(false);
    expect(invalid.status).not.toBe("python-owned");
    expect(invalid.productionTakeover).not.toBe(true);
  });
});
