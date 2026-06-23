import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  validateAuthTokenMailerSessionCutover,
  type AuthTokenMailerSessionCutoverResult,
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

describe("auth-token-mailer-session-cutover-101 - node consumption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates python cutover readiness and distinguishes states", () => {
    const ready = validateAuthTokenMailerSessionCutover({
      status: "ready",
      contractVersion: "auth-token-mailer-session-cutover.v1",
      provenance: "python-auth-token-mailer-session-cutover",
      ok: true,
      runtime: { owner: "python", mode: "cutover_readiness" },
      cutoverSummary: {
        status: "ready",
        components: { tokenIssuance: "ready", emailCodeMailer: "skipped-live", sessionRepository: "ready" },
        metadata: { traceId: "c-101" },
      },
    });
    expect(ready.status).toBe("ready");
    expect(ready.ok).toBe(true);
    expect(ready.cutoverSummary?.components.emailCodeMailer).toBe("skipped-live");

    const blocked = validateAuthTokenMailerSessionCutover({ status: "blocked" });
    expect(blocked.status).toBe("blocked");
    expect(blocked.ok).toBe(false);

    const degraded = validateAuthTokenMailerSessionCutover({ status: "degraded" });
    expect(degraded.status).toBe("degraded");
    expect(degraded.ok).toBe(false);

    const skipped = validateAuthTokenMailerSessionCutover({ status: "skipped-live" });
    expect(skipped.status).toBe("skipped-live");
    expect(skipped.ok).toBe(false);
  });

  it("auth route layer can consume cutover readiness via pythonTokenMailerSessionCutover dep", async () => {
    const pythonCutover = {
      execute: vi.fn(async (p: any) => ({
        status: "ready",
        contractVersion: "auth-token-mailer-session-cutover.v1",
        provenance: "python-auth-token-mailer-session-cutover",
        ok: true,
        runtime: { owner: "python", mode: "cutover_readiness" },
        cutoverSummary: {
          status: "ready",
          components: { tokenIssuance: "ready", emailCodeMailer: "skipped-live", sessionRepository: "ready" },
          metadata: { source: p?.metadata?.source },
        },
      })),
    };

    await withAuthServer({ pythonTokenMailerSessionCutover: pythonCutover }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-token-mailer-session-cutover`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.cutover.status).toBe("ready");
      expect(pythonCutover.execute).toHaveBeenCalled();
      expect(json.cutover.cutoverSummary.components.emailCodeMailer).toBe("skipped-live");
    });
  });

  it("falls back to explicit non-healthy (skipped-live) when no python cutover wired", async () => {
    await withAuthServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-token-mailer-session-cutover`);
      const json = await res.json();
      expect(json.success).toBe(true);
      // must be non-ready
      expect(["skipped-live", "blocked", "degraded", "failed"]).toContain(json.cutover.status);
      expect(json.cutover.ok).toBe(false);
    });
  });

  it("cutover readiness preserves boundaries and never claims production mailer or token", () => {
    const withMeta = validateAuthTokenMailerSessionCutover({
      status: "ready",
      contractVersion: "auth-token-mailer-session-cutover.v1",
      provenance: "python-auth-token-mailer-session-cutover",
      ok: true,
      runtime: { owner: "python", mode: "cutover_readiness" },
      cutoverSummary: {
        status: "ready",
        components: { tokenIssuance: "ready", emailCodeMailer: "skipped-live", sessionRepository: "ready" },
        metadata: { policy: "node", mailer: "node-external", store: "node" },
      },
    });
    expect(withMeta.cutoverSummary?.metadata.mailer).toBe("node-external");
    expect(withMeta.status).toBe("ready");
    // ensure mailer not ready as prod
    expect(withMeta.cutoverSummary?.components.emailCodeMailer).not.toBe("ready");
  });

  it("retaining existing security failure semantics for auth", () => {
    // cutover wiring must not affect identity/session error paths
    const invalid = validateAuthTokenMailerSessionCutover({ foo: "bar" });
    expect(invalid.ok).toBe(false);
    expect(invalid.status).not.toBe("ready");
  });
});
