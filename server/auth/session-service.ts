import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";

import type { CurrentUser } from "../../shared/auth.js";
import type { SessionRecord, UserRecord } from "../persistence/repositories.js";

export interface SessionLookupResult {
  sessionId: string;
  user: CurrentUser;
}

export type PythonAuthSessionError = "missing" | "expired" | "invalid";

export interface PythonAuthSessionValidContract {
  valid: true;
  sessionId: string;
  user: CurrentUser;
}

export interface PythonAuthSessionErrorContract {
  valid: false;
  error: PythonAuthSessionError;
  status: 401;
  message: string;
}

export type PythonAuthSessionContract = PythonAuthSessionValidContract | PythonAuthSessionErrorContract;

export interface SessionRepositories {
  sessions: {
    create(input: {
      userId: string;
      tokenHash: string;
      ip?: string | null;
      userAgent?: string | null;
      expiresAt: Date;
    }): Promise<SessionRecord>;
    findActiveByTokenHash(tokenHash: string, now?: Date): Promise<SessionRecord | null>;
    refreshLastSeen(sessionId: string, expiresAt?: Date): Promise<void>;
    revoke(sessionId: string): Promise<void>;
  };
  users: {
    findById(userId: string): Promise<UserRecord | null>;
  };
}

export interface SessionService {
  createSession(input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ token: string; session: SessionRecord }>;
  resolveCurrentUser(token: string | null | undefined): Promise<SessionLookupResult | null>;
  revokeSession(sessionId: string): Promise<void>;
  refreshSession(sessionId: string): Promise<void>;
  readSessionToken(request: Request): string | null;
  writeSessionCookie(response: Response, token: string): void;
  clearCookie(response: Response): void;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function toCurrentUser(user: UserRecord): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt.toISOString(),
  };
}

const pythonAuthSessionMessages: Record<PythonAuthSessionError, string> = {
  missing: "Authentication required",
  expired: "Session expired",
  invalid: "Invalid session",
};

function pythonAuthSessionError(error: PythonAuthSessionError): PythonAuthSessionErrorContract {
  return {
    valid: false,
    error,
    status: 401,
    message: pythonAuthSessionMessages[error],
  };
}

function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretKey(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.toLowerCase();
    return (
      normalized.includes("token") ||
      normalized.includes("cookie") ||
      normalized.includes("password") ||
      normalized.includes("secret") ||
      containsSecretKey(child)
    );
  });
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const user = value as Partial<CurrentUser>;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.role === "string" &&
    typeof user.status === "string" &&
    typeof user.emailVerified === "boolean" &&
    typeof user.createdAt === "string"
  );
}

export function validatePythonAuthSessionContract(payload: unknown): PythonAuthSessionContract {
  if (!payload) {
    return pythonAuthSessionError("missing");
  }
  if (typeof payload !== "object") {
    return pythonAuthSessionError("invalid");
  }

  const candidate = payload as Partial<PythonAuthSessionContract> & {
    sessionId?: unknown;
    user?: unknown;
    error?: unknown;
  };
  if (candidate.error === "missing" || candidate.error === "expired" || candidate.error === "invalid") {
    return pythonAuthSessionError(candidate.error);
  }
  if (containsSecretKey(payload)) {
    return pythonAuthSessionError("invalid");
  }
  if (candidate.valid === true && typeof candidate.sessionId === "string" && isCurrentUser(candidate.user)) {
    return {
      valid: true,
      sessionId: candidate.sessionId,
      user: candidate.user,
    };
  }
  return pythonAuthSessionError("invalid");
}

export function toPythonAuthSessionContract(
  result: SessionLookupResult | null | undefined,
): PythonAuthSessionContract {
  if (!result) {
    return pythonAuthSessionError("missing");
  }
  return validatePythonAuthSessionContract({
    valid: true,
    sessionId: result.sessionId,
    user: result.user,
  });
}

export function createSessionService(options: {
  repositories: SessionRepositories;
  cookieName: string;
  ttlDays: number;
  secureCookie?: boolean;
  now?: () => Date;
}): SessionService {
  const now = options.now ?? (() => new Date());

  function expiresAt(): Date {
    return new Date(now().getTime() + options.ttlDays * 24 * 60 * 60 * 1000);
  }

  return {
    async createSession(input) {
      const token = randomBytes(32).toString("base64url");
      const session = await options.repositories.sessions.create({
        userId: input.userId,
        tokenHash: hashSessionToken(token),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: expiresAt(),
      });
      return { token, session };
    },

    async resolveCurrentUser(token) {
      if (!token) return null;

      const session = await options.repositories.sessions.findActiveByTokenHash(hashSessionToken(token), now());
      if (!session) return null;

      const user = await options.repositories.users.findById(session.userId);
      if (!user || user.status !== "active") return null;

      return {
        sessionId: session.id,
        user: toCurrentUser(user),
      };
    },

    async revokeSession(sessionId) {
      await options.repositories.sessions.revoke(sessionId);
    },

    async refreshSession(sessionId) {
      await options.repositories.sessions.refreshLastSeen(sessionId, expiresAt());
    },

    readSessionToken(request) {
      const rawCookie = request.headers.cookie ?? "";
      const prefix = `${options.cookieName}=`;
      const match = rawCookie
        .split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(prefix));

      return match ? decodeURIComponent(match.slice(prefix.length)) : null;
    },

    writeSessionCookie(response, token) {
      response.cookie(options.cookieName, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookie ?? false,
        path: "/",
        maxAge: options.ttlDays * 24 * 60 * 60 * 1000,
      });
    },

    clearCookie(response) {
      response.clearCookie(options.cookieName, { path: "/" });
    },
  };
}
