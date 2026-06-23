import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  validateAuthAuditProductionClosure,
  type AuthAuditProductionClosureResult,
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

describe("auth-audit-production-closure-100 - node consumption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates python closure summary and distinguishes states", () => {
    const ready = validateAuthAuditProductionClosure({
      status: "ready",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "python-auth-audit-production-closure",
      ok: true,
      runtime: { owner: "python", mode: "bounded_closure" },
      closureSummary: {
        status: "ready",
        components: { identity: true, sessionPersistence: true, permissionDecisionAudit: true, auditRetentionExport: true, auditSink: true },
        metadata: { traceId: "c-100" },
      },
      subEnvelopes: { identity: { ok: true } },
    });
    expect(ready.status).toBe("ready");
    expect(ready.ok).toBe(true);
    expect(ready.closureSummary.components.identity).toBe(true);

    const configMissing = validateAuthAuditProductionClosure({
      status: "config_missing",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "python-auth-audit-production-closure",
      ok: false,
      runtime: { owner: "python", mode: "bounded_closure" },
      closureSummary: { status: "config_missing", components: {}, metadata: {} },
    });
    expect(configMissing.status).toBe("config_missing");
    expect(configMissing.ok).toBe(false);

    const degraded = validateAuthAuditProductionClosure({ status: "degraded" });
    expect(degraded.status).toBe("degraded");
    expect(degraded.ok).toBe(false);

    const denied = validateAuthAuditProductionClosure({ status: "denied" });
    expect(denied.status).toBe("denied");

    const ext = validateAuthAuditProductionClosure({ status: "external_missing" });
    expect(ext.status).toBe("external_missing");

    const failed = validateAuthAuditProductionClosure({ status: "failed" });
    expect(failed.status).toBe("failed");
  });

  it("auth route layer can consume closure summary via pythonAuthAuditClosure dep", async () => {
    const pythonClosure = {
      execute: vi.fn(async (p: any) => ({
        status: "ready",
        contractVersion: "auth-audit-production-closure.v1",
        provenance: "python-auth-audit-production-closure",
        ok: true,
        runtime: { owner: "python", mode: "bounded_closure" },
        closureSummary: {
          status: "ready",
          components: { identity: true, permissionDecisionAudit: true },
          metadata: { source: p?.metadata?.source },
        },
      })),
    };

    await withAuthServer({ pythonAuthAuditClosure: pythonClosure }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-audit-closure`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.closure.status).toBe("ready");
      expect(pythonClosure.execute).toHaveBeenCalled();
      expect(json.closure.closureSummary.components.identity).toBe(true);
    });
  });

  it("falls back to explicit non-healthy when no python closure wired", async () => {
    await withAuthServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-audit-closure`);
      const json = await res.json();
      expect(json.success).toBe(true);
      // must be config_missing or failed, never ready when not wired
      expect(["config_missing", "failed"]).toContain(json.closure.status);
      expect(json.closure.ok).toBe(false);
    });
  });

  it("closure summary preserves permission/audit metadata for node consumption", () => {
    const withMeta = validateAuthAuditProductionClosure({
      status: "degraded",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "python-auth-audit-production-closure",
      ok: false,
      runtime: { owner: "python", mode: "bounded_closure" },
      closureSummary: {
        status: "degraded",
        components: { permissionDecisionAudit: true, auditSink: false },
        metadata: { policy: "p1", risk: "high", audit: "retained" },
      },
    });
    expect(withMeta.closureSummary.metadata.policy).toBe("p1");
    expect(withMeta.closureSummary.metadata.risk).toBe("high");
    expect(withMeta.status).toBe("degraded");
  });
});
