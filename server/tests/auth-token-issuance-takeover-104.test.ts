import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  validateAuthTokenIssuanceTakeover,
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

describe("auth-token-issuance-takeover-104 - node consumption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates python token issuance takeover decision and distinguishes ownership", () => {
    const owned = validateAuthTokenIssuanceTakeover({
      status: "python-owned",
      contractVersion: "auth-token-issuance-takeover.v1",
      provenance: "python-auth-token-issuance-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "token_issuance_takeover" },
      ownership: {
        tokenIssuance: "python-owned",
        operation: "issue",
      },
      productionTakeover: false,
      metadata: { traceId: "t-104" },
    });
    expect(owned.status).toBe("python-owned");
    expect(owned.ok).toBe(true);
    expect(owned.ownership?.tokenIssuance).toBe("python-owned");
    expect(owned.productionTakeover).toBe(false);

    const retained = validateAuthTokenIssuanceTakeover({ status: "node-retained" });
    expect(retained.status).toBe("node-retained");
    expect(retained.ok).toBe(false);

    const blocked = validateAuthTokenIssuanceTakeover({ status: "blocked" });
    expect(blocked.status).toBe("blocked");
    expect(blocked.ok).toBe(false);
  });

  it("auth route layer can consume token issuance takeover via pythonAuthTokenIssuanceTakeover dep", async () => {
    const pythonTokenTakeover = {
      execute: vi.fn(async (p: any) => ({
        status: "python-owned",
        contractVersion: "auth-token-issuance-takeover.v1",
        provenance: "python-auth-token-issuance-takeover-104",
        ok: true,
        runtime: { owner: "python", mode: "token_issuance_takeover" },
        ownership: { tokenIssuance: "python-owned", operation: "refresh" },
        productionTakeover: false,
        metadata: { source: p?.metadata?.source },
      })),
    };

    await withAuthServer({ pythonAuthTokenIssuanceTakeover: pythonTokenTakeover }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-token-issuance-takeover`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.takeover.status).toBe("python-owned");
      expect(pythonTokenTakeover.execute).toHaveBeenCalled();
      expect(json.takeover.ownership.tokenIssuance).toBe("python-owned");
      expect(json.takeover.productionTakeover).toBe(false);
    });
  });

  it("falls back to node-retained when no python token issuance wired", async () => {
    await withAuthServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-token-issuance-takeover`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(["node-retained", "skipped-live", "blocked", "out-of-scope"]).toContain(json.takeover.status);
      expect(json.takeover.ok).toBe(false);
    });
  });

  it("token issuance decision preserves retained actual issuance and no production takeover", () => {
    const d = validateAuthTokenIssuanceTakeover({
      status: "python-owned",
      contractVersion: "auth-token-issuance-takeover.v1",
      provenance: "python-auth-token-issuance-takeover-104",
      ok: true,
      runtime: { owner: "python", mode: "token_issuance_takeover" },
      ownership: {
        tokenIssuance: "python-owned",
        operation: "revoke",
      },
      productionTakeover: false,
      metadata: { policy: "decision-only" },
    });
    expect(d.ownership?.tokenIssuance).toBe("python-owned");
    expect(d.productionTakeover).not.toBe(true);
    expect(d.status).toBe("python-owned");
    expect(d.ok).toBe(true);
  });

  it("retaining existing security failure semantics for token issuance", () => {
    const invalid = validateAuthTokenIssuanceTakeover({ foo: "bar" });
    expect(invalid.ok).toBe(false);
    expect(invalid.status).not.toBe("python-owned");

    const secretLike = validateAuthTokenIssuanceTakeover({ tokenIssuance: "python-owned", secret: "a".repeat(30) });
    expect(secretLike.ok).toBe(false);
    expect(secretLike.status).toBe("node-retained");
  });
});
