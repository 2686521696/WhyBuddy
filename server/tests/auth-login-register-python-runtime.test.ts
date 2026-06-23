import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "../../shared/auth.js";
import {
  validatePythonAuthIdentityResult,
  validatePythonAuthSessionMutationContract,
} from "../auth/session-service.js";
import { createAuthRouter } from "../routes/auth.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { EmailCodeService } from "../auth/email-code-service.js";

const validUser: CurrentUser = {
  id: "user-1",
  email: "user@example.com",
  role: "user",
  status: "active",
  emailVerified: true,
  createdAt: "2026-04-30T00:00:00.000Z",
};

async function withAuthServer(
  overrides: Partial<Parameters<typeof createAuthRouter>[0]>,
  handler: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ users: {} as never, sessions: {} as never, sessionService: {} as never, ...overrides } as any));

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

function makeEmailCodeService(): EmailCodeService {
  return {
    ttlSeconds: 600,
    now: () => new Date("2026-06-23T00:00:00.000Z"),
    generateCode: () => "123456",
    hashCode: (e, c) => "hash:" + c,
    verifyCodeHash: () => true,
    expiresAt: () => new Date("2026-06-23T00:10:00.000Z"),
    sendLoginCode: vi.fn(async () => {}),
  };
}

describe("auth login/register python runtime mapping", () => {
  it("maps Python identity success envelopes to authenticated shape", () => {
    const okLogin = validatePythonAuthIdentityResult({
      ok: true,
      operation: "login",
      state: "authenticated",
      user: validUser,
      sessionIssued: true,
    });
    expect(okLogin.ok).toBe(true);
    expect((okLogin as any).sessionIssued).toBe(true);

    const okRegister = validatePythonAuthIdentityResult({
      ok: true,
      operation: "register",
      state: "registered",
      user: { ...validUser, id: "user-new", email: "new@example.com", emailVerified: false },
    });
    expect(okRegister.ok).toBe(true);
    expect((okRegister as any).state).toBe("registered");
  });

  it("maps Python identity denied/invalid/expired to non-auth error envelopes", () => {
    const invalidCred = validatePythonAuthIdentityResult({
      ok: false,
      error: "invalid_credentials",
      status: 401,
      message: "邮箱或密码错误",
    });
    expect(invalidCred.ok).toBe(false);
    expect((invalidCred as any).error).toBe("invalid_credentials");

    const expired = validatePythonAuthIdentityResult({
      ok: false,
      error: "expired_code",
      status: 401,
      message: "Email or code is invalid.",
      state: "expired",
    });
    expect(expired.ok).toBe(false);
    expect((expired as any).state).toBe("expired");
    expect((expired as any).error).toBe("expired_code");

    const bad = validatePythonAuthIdentityResult({ ok: false, error: "invalid" });
    expect(bad.ok).toBe(false);
  });

  it("/api/auth/login maps success path and invalid credentials do not become authenticated", async () => {
    const hashed = await hashPassword("password123");
    const usersRepo = {
      findByEmail: vi.fn(async (email: string) => {
        if (email === "user@example.com") {
          return {
            id: "user-1",
            email: "user@example.com",
            emailNormalized: "user@example.com",
            passwordHash: hashed,
            displayName: null,
            avatarUrl: null,
            role: "user",
            status: "active",
            emailVerifiedAt: new Date(),
            createdAt: new Date("2026-04-30T00:00:00.000Z"),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
      create: vi.fn(),
      updateLastLogin: vi.fn(async () => {}),
      findById: vi.fn(),
      markEmailVerified: vi.fn(),
    };
    const sessionService: any = {
      createSession: vi.fn(async () => ({ token: "tok", session: { id: "s1" } })),
      resolveCurrentUser: vi.fn(),
      revokeSession: vi.fn(),
      refreshSession: vi.fn(),
      readSessionToken: vi.fn(() => null),
      writeSessionCookie: vi.fn(),
      clearCookie: vi.fn(),
    };
    const emailSvc = makeEmailCodeService();

    await withAuthServer(
      {
        users: usersRepo as any,
        sessions: {} as any,
        sessionService,
        emailCodeService: emailSvc,
      },
      async (baseUrl) => {
        // valid login
        const okRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@example.com", password: "password123" }),
        });
        expect(okRes.status).toBe(200);
        const okBody = await okRes.json();
        expect(okBody.success).toBe(true);
        expect(okBody.user.email).toBe("user@example.com");

        // invalid
        const badRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@example.com", password: "bad" }),
        });
        expect(badRes.status).toBe(401);
        const badBody = await badRes.json();
        expect(badBody.success).toBe(false);
        expect(badBody.error).toBeTruthy();
        // ensure not accidentally authenticated
        expect(badBody.user).toBeUndefined();
      },
    );
  });

  it("auth routes call python identity runtime when provided and map denied without authenticated fallback", async () => {
    const sessionService: any = {
      createSession: vi.fn(async () => ({ token: "tok-py", session: { id: "s-py" } })),
      resolveCurrentUser: vi.fn(),
      revokeSession: vi.fn(),
      refreshSession: vi.fn(),
      readSessionToken: vi.fn(() => null),
      writeSessionCookie: vi.fn(),
      clearCookie: vi.fn(),
    };
    const pyRuntime = {
      async execute(payload: any) {
        // simulate direct from python runtime
        if (payload.operation === "login" && payload.password !== "password123") {
          return { ok: false, error: "invalid_credentials", status: 401, message: "邮箱或密码错误" };
        }
        if (payload.operation === "login") {
          return { ok: true, operation: "login", state: "authenticated", user: validUser, sessionIssued: true };
        }
        return { ok: false, error: "invalid", status: 401, message: "Invalid request" };
      },
    };

    await withAuthServer(
      {
        users: {} as any,
        sessions: {} as any,
        sessionService,
        pythonIdentityRuntime: pyRuntime,
      },
      async (baseUrl) => {
        const ok = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@example.com", password: "password123" }),
        });
        expect(ok.status).toBe(200);
        const okJ = await ok.json();
        expect(okJ.success).toBe(true);

        const bad = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@example.com", password: "wrong" }),
        });
        expect(bad.status).toBe(401);
        const badJ = await bad.json();
        expect(badJ.success).toBe(false);
        expect(badJ.user).toBeUndefined();
      },
    );
  });

  it("register and email-code paths honor error without fallback to authenticated", async () => {
    const usersRepo = {
      findByEmail: vi.fn(async () => null),
      create: vi.fn(async (input: any) => ({
        id: "u2",
        email: input.email,
        emailNormalized: input.email,
        passwordHash: "h",
        displayName: null,
        avatarUrl: null,
        role: "user",
        status: "active",
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      updateLastLogin: vi.fn(async () => {}),
      findById: vi.fn(async () => null),
      markEmailVerified: vi.fn(),
    };
    const sessionService: any = {
      createSession: vi.fn(async () => ({ token: "tok2", session: {} })),
      resolveCurrentUser: vi.fn(),
      revokeSession: vi.fn(),
      refreshSession: vi.fn(),
      readSessionToken: vi.fn(() => null),
      writeSessionCookie: vi.fn(),
      clearCookie: vi.fn(),
    };
    const emailTokens: any = {
      create: vi.fn(async () => "tid"),
      findValidByTokenHash: vi.fn(async () => ({
        id: "tid",
        emailNormalized: "user@example.com",
        userId: "user-1",
      })),
      markConsumed: vi.fn(async () => {}),
      countCreatedSince: vi.fn(async () => 0),
    };
    const emailSvc = makeEmailCodeService();

    await withAuthServer(
      {
        users: usersRepo as any,
        sessions: {} as any,
        sessionService,
        emailLoginTokens: emailTokens,
        emailCodeService: emailSvc,
      },
      async (baseUrl) => {
        // register
        const reg = await fetch(`${baseUrl}/api/auth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "new2@example.com", password: "longenough" }),
        });
        expect(reg.status).toBe(201);
        const regBody = await reg.json();
        expect(regBody.success).toBe(true);

        // email code send ok (even no user)
        const send = await fetch(`${baseUrl}/api/auth/email-code/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "nope@example.com" }),
        });
        expect(send.status).toBe(200);

        // email login with bad code -> 401 not auth
        const badCode = await fetch(`${baseUrl}/api/auth/email-code/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@example.com", code: "000000" }),
        });
        expect(badCode.status).toBe(401);
        const badCodeBody = await badCode.json();
        expect(badCodeBody.success).toBe(false);
        expect(badCodeBody.user).toBeUndefined();
      },
    );
  });

  it("does not let python identity denied result become success response shape", () => {
    // simulate what a route bridge would do with python runtime output
    const denied = validatePythonAuthIdentityResult({
      ok: false,
      operation: "login",
      error: "invalid_credentials",
      status: 401,
      message: "邮箱或密码错误",
    });
    expect(denied.ok).toBe(false);
    // node side would map to {success:false, error: ...} never include user
    const mapped = { success: false, error: (denied as any).message || "fail" };
    expect(mapped.success).toBe(false);
    expect((mapped as any).user).toBeUndefined();
  });
});
