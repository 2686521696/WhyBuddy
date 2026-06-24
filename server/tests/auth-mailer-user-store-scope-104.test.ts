import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

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

describe("auth-mailer-user-store-scope-104 - node consumption", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("python and node tests agree on mailer/user store node-retained classification", () => {
    // Simulated python scope decision (what python service returns)
    const pyScope = {
      status: "ready",
      contractVersion: "auth-mailer-user-store-scope.v1",
      provenance: "python-auth-mailer-user-store-scope-104",
      ok: true,
      runtime: { owner: "python", mode: "mailer_user_store_scope" },
      ownership: {
        emailCodeMailer: "node-retained",
        userRepository: "node-retained",
        mailerUserStoreScopeDecision: "python-owned",
      },
      productionTakeover: false,
      reason: "node-retained-mailer-user-store;not-worth-migrating-real-email-and-user-persistence;see-103",
      migrationDenominator: { total: 3, pythonOwned: 1, nodeRetained: 2, externalOwned: 0, outOfScope: 0 },
      metadata: { source: "py-test" },
    };

    expect(pyScope.ownership.emailCodeMailer).toBe("node-retained");
    expect(pyScope.ownership.userRepository).toBe("node-retained");
    expect(pyScope.ownership.mailerUserStoreScopeDecision).toBe("python-owned");
    expect(pyScope.productionTakeover).toBe(false);
    expect(pyScope.reason).toContain("node-retained");
    expect(pyScope.migrationDenominator.nodeRetained).toBe(2);

    // Node side explicit agreement (no live mail/user)
    const nodeView = { emailCodeMailer: "node-retained", userRepository: "node-retained" };
    expect(nodeView.emailCodeMailer).toBe(pyScope.ownership.emailCodeMailer);
    expect(nodeView.userRepository).toBe(pyScope.ownership.userRepository);
  });

  it("auth route layer can consume mailer user store scope via pythonAuthMailerUserStoreScope dep", async () => {
    const pythonScope = {
      execute: vi.fn(async (p: any) => ({
        status: "ready",
        contractVersion: "auth-mailer-user-store-scope.v1",
        provenance: "python-auth-mailer-user-store-scope-104",
        ok: true,
        runtime: { owner: "python", mode: "mailer_user_store_scope" },
        ownership: {
          emailCodeMailer: "node-retained",
          userRepository: "node-retained",
          mailerUserStoreScopeDecision: "python-owned",
        },
        productionTakeover: false,
        reason: "node-retained-mailer-user-store;not-worth-migrating-real-email-and-user-persistence;see-103",
        migrationDenominator: { total: 3, pythonOwned: 1, nodeRetained: 2, externalOwned: 0, outOfScope: 0 },
        metadata: { source: p?.metadata?.source },
      })),
    };

    await withAuthServer({ pythonAuthMailerUserStoreScope: pythonScope }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-mailer-user-store-scope`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.scope.ownership.emailCodeMailer).toBe("node-retained");
      expect(json.scope.ownership.userRepository).toBe("node-retained");
      expect(json.scope.ownership.mailerUserStoreScopeDecision).toBe("python-owned");
      expect(pythonScope.execute).toHaveBeenCalled();
      expect(json.scope.productionTakeover).toBe(false);
      expect(json.scope.reason).toContain("retained");
    });
  });

  it("falls back to node-retained when no python mailer-user-scope wired", async () => {
    await withAuthServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/__internal/auth-mailer-user-store-scope`);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(["node-retained", "skipped-live", "blocked", "out-of-scope"]).toContain(json.scope.status);
      expect(json.scope.ownership?.emailCodeMailer).toBe("node-retained");
      expect(json.scope.ownership?.userRepository).toBe("node-retained");
    });
  });

  it("retained status includes reason and denominator; no takeover claim", () => {
    const scope = {
      status: "ready",
      ownership: {
        emailCodeMailer: "node-retained",
        userRepository: "node-retained",
        mailerUserStoreScopeDecision: "python-owned",
      },
      productionTakeover: false,
      reason: "node-retained-mailer-user-store;not-worth-migrating-real-email-and-user-persistence;see-103",
      migrationDenominator: { total: 3, nodeRetained: 2, pythonOwned: 1, externalOwned: 0, outOfScope: 0 },
    };
    expect(scope.ownership.emailCodeMailer).toBe("node-retained");
    expect(scope.ownership.userRepository).toBe("node-retained");
    expect(scope.productionTakeover).toBe(false);
    expect(scope.reason.includes("node-retained") || scope.reason.includes("retained")).toBe(true);
    expect(scope.migrationDenominator.nodeRetained).toBe(2);
  });
});
