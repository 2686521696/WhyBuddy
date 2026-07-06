/**
 * Node -> Python thin proxy for the auth surfaces served endpoint-for-endpoint
 * by slide-rule-python routes/auth.py, behind AUTH_PYTHON_PROXY
 * (security-sensitive, default OFF — explicit "true" opts in).
 *
 * Covered: identity delegation (/login) with Node-retained cookie issuance,
 * business-4xx passthrough, infra-failure fallback to the Node implementation,
 * flag-off Node path, and the GET /__internal/* closure/takeover surfaces.
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "../../auth/password.js";
import { createSessionService } from "../../auth/session-service.js";
import type {
  SessionRecord,
  UserRecord,
  UserRole,
  UserStatus,
} from "../../persistence/repositories.js";
import { createAuthRouter } from "../auth.js";

const PYTHON_BASE = "http://python-auth.test";
const INTERNAL_KEY = "internal-auth";
const COOKIE_NAME = "cube_proxy_session";

class MemoryUsersRepository {
  users = new Map<string, UserRecord>();
  nextId = 1;

  async findById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    return (
      [...this.users.values()].find((user) => user.emailNormalized === normalized) ?? null
    );
  }

  async create(input: {
    email: string;
    passwordHash?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    role?: UserRole;
    status?: UserStatus;
    emailVerifiedAt?: Date | null;
  }): Promise<UserRecord> {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const user: UserRecord = {
      id: `user-${this.nextId++}`,
      email: input.email.trim(),
      emailNormalized: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash ?? null,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role ?? "user",
      status: input.status ?? "active",
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateLastLogin(): Promise<void> {}
}

class MemorySessionsRepository {
  sessions = new Map<string, SessionRecord>();
  nextId = 1;

  async create(input: {
    userId: string;
    tokenHash: string;
    ip?: string | null;
    userAgent?: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const now = new Date("2026-06-20T00:00:00.000Z");
    const session: SessionRecord = {
      id: `session-${this.nextId++}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      lastSeenAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findActiveByTokenHash(): Promise<SessionRecord | null> {
    return null;
  }

  async refreshLastSeen(): Promise<void> {}

  async revoke(): Promise<void> {}
}

async function withAuthServer(
  handler: (context: {
    baseUrl: string;
    users: MemoryUsersRepository;
    sessions: MemorySessionsRepository;
  }) => Promise<void>,
): Promise<void> {
  const users = new MemoryUsersRepository();
  const sessions = new MemorySessionsRepository();
  const sessionService = createSessionService({
    repositories: { users, sessions },
    cookieName: COOKIE_NAME,
    ttlDays: 30,
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });

  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ users, sessions, sessionService }));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => (error ? reject(error) : resolve()));
  });
  const address = server.address() as AddressInfo;
  try {
    await handler({ baseUrl: `http://127.0.0.1:${address.port}`, users, sessions });
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

const PYTHON_USER = {
  id: "user-py-1",
  email: "valid@example.com",
  role: "user",
  status: "active",
  emailVerified: true,
  createdAt: "2026-04-30T00:00:00.000Z",
};

describe("auth Python thin proxy (AUTH_PYTHON_PROXY)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates /login to Python and keeps cookie issuance in Node when enabled", async () => {
    vi.stubEnv("AUTH_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", `${PYTHON_BASE}/`);
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
    const fetchSpy = stubPythonFetch(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            operation: "login",
            state: "authenticated",
            user: PYTHON_USER,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await withAuthServer(async ({ baseUrl, sessions }) => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "valid@example.com", password: "correct-password" }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(body.success).toBe(true);
      expect(body.user.id).toBe("user-py-1");
      // Cookie issuance stays Node-owned.
      expect(response.headers.get("set-cookie")).toContain(COOKIE_NAME);
      expect(sessions.sessions.size).toBe(1);
      expect([...sessions.sessions.values()][0].userId).toBe("user-py-1");
    });

    const calls = pythonCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(String(url)).toBe(`${PYTHON_BASE}/api/auth/login`);
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Key": INTERNAL_KEY,
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      operation: "login",
      email: "valid@example.com",
      password: "correct-password",
    });
  });

  it("passes Python business 401 decisions through instead of consulting the Node user store", async () => {
    vi.stubEnv("AUTH_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    stubPythonFetch(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            operation: "login",
            error: "invalid_credentials",
            status: 401,
            message: "邮箱或密码错误",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    );

    await withAuthServer(async ({ baseUrl, users, sessions }) => {
      // Node-side user exists with this exact password; Python decision must win.
      await users.create({
        email: "valid@example.com",
        passwordHash: await hashPassword("correct-password"),
      });
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "valid@example.com", password: "correct-password" }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ success: false, error: "邮箱或密码错误" });
      expect(sessions.sessions.size).toBe(0);
    });
  });

  it("falls back to the Node login implementation when Python is unreachable", async () => {
    vi.stubEnv("AUTH_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    const fetchSpy = stubPythonFetch(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9700");
    });

    await withAuthServer(async ({ baseUrl, users }) => {
      await users.create({
        email: "valid@example.com",
        passwordHash: await hashPassword("correct-password"),
      });
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "valid@example.com", password: "correct-password" }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(body.success).toBe(true);
      expect(body.user.email).toBe("valid@example.com");
    });
    expect(pythonCalls(fetchSpy)).toHaveLength(1);
  });

  it("never calls Python when the flag is off (default) — Node path only", async () => {
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    const fetchSpy = stubPythonFetch(async () => {
      throw new Error("python must not be called when AUTH_PYTHON_PROXY is off");
    });

    await withAuthServer(async ({ baseUrl, users }) => {
      await users.create({
        email: "valid@example.com",
        passwordHash: await hashPassword("correct-password"),
      });
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "valid@example.com", password: "correct-password" }),
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as Record<string, any>).success).toBe(true);
    });
    expect(pythonCalls(fetchSpy)).toHaveLength(0);
  });

  it("delegates the __internal closure surfaces to Python when enabled", async () => {
    vi.stubEnv("AUTH_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    vi.stubEnv("PYTHON_SLIDE_RULE_INTERNAL_KEY", INTERNAL_KEY);
    const pythonClosure = {
      status: "ready",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "python-auth-audit-closure",
      ok: true,
      runtime: { owner: "python", mode: "http" },
      closureSummary: { status: "ready", components: {}, metadata: {} },
    };
    const fetchSpy = stubPythonFetch(async (url) => {
      expect(url).toBe(`${PYTHON_BASE}/api/auth/__internal/auth-audit-closure`);
      return new Response(JSON.stringify(pythonClosure), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await withAuthServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/auth/__internal/auth-audit-closure`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(body.success).toBe(true);
      expect(body.closure.status).toBe("ready");
      expect(body.closure.ok).toBe(true);
      expect(body.closure.provenance).toBe("python-auth-audit-closure");
    });

    const calls = pythonCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as RequestInit).headers).toMatchObject({
      "X-Internal-Key": INTERNAL_KEY,
    });
  });

  it("uses the explicit Node fallback envelope for __internal surfaces when Python is unreachable", async () => {
    vi.stubEnv("AUTH_PYTHON_PROXY", "true");
    vi.stubEnv("PYTHON_SLIDE_RULE_BASE_URL", PYTHON_BASE);
    stubPythonFetch(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9700");
    });

    await withAuthServer(async ({ baseUrl }) => {
      const response = await fetch(
        `${baseUrl}/api/auth/__internal/auth-mailer-user-store-scope`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(body.success).toBe(true);
      expect(body.scope.provenance).toBe("node-fallback");
      expect(body.scope.ownership.emailCodeMailer).toBe("node-retained");
    });
  });
});
