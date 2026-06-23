import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";

import type { CurrentUser } from "../../shared/auth.js";
import type { SessionRecord, UserRecord } from "../persistence/repositories.js";

export interface SessionLookupResult {
  sessionId: string;
  user: CurrentUser;
}

export type PythonAuthSessionError = "missing" | "expired" | "invalid";
export type PythonAuthSessionDiagnosticError = "missing_config" | "store_failure";
export type PythonAuthSessionMutationError = PythonAuthSessionError | PythonAuthSessionDiagnosticError;
export type PythonAuthSessionMutationState = "refreshed" | "logged_out" | "expired" | "invalid" | "error";

export interface PythonAuthSessionValidContract {
  valid: true;
  sessionId: string;
  user: CurrentUser;
}

export interface PythonAuthSessionErrorContract {
  valid: false;
  error: PythonAuthSessionError | PythonAuthSessionDiagnosticError;
  status: 401 | 503;
  message: string;
}

export type PythonAuthSessionContract = PythonAuthSessionValidContract | PythonAuthSessionErrorContract;

export interface PythonAuthSessionMutationContract {
  success: boolean;
  error?: PythonAuthSessionMutationError;
  status?: 200 | 401 | 503;
  message?: string;
  sessionId?: string;
  state?: PythonAuthSessionMutationState;
}

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
  revokeSession(sessionId: string): Promise<PythonAuthSessionMutationContract>;
  refreshSession(sessionId: string): Promise<PythonAuthSessionMutationContract>;
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

const pythonAuthSessionDiagnosticMessages: Record<PythonAuthSessionDiagnosticError, string> = {
  missing_config: "Auth session persistence is not configured.",
  store_failure: "Auth session persistence failed.",
};

function pythonAuthSessionError(error: PythonAuthSessionError): PythonAuthSessionErrorContract {
  return {
    valid: false,
    error,
    status: 401,
    message: pythonAuthSessionMessages[error],
  };
}

function pythonAuthSessionDiagnosticError(error: PythonAuthSessionDiagnosticError): PythonAuthSessionErrorContract {
  return {
    valid: false,
    error,
    status: 503,
    message: pythonAuthSessionDiagnosticMessages[error],
  };
}

function pythonAuthSessionMutationError(
  error: PythonAuthSessionMutationError,
  state?: PythonAuthSessionMutationState,
): PythonAuthSessionMutationContract {
  if (error === "missing_config" || error === "store_failure") {
    return {
      success: false,
      error,
      status: 503,
      message: pythonAuthSessionDiagnosticMessages[error],
      ...(state ? { state } : {}),
    };
  }
  return {
    success: false,
    error,
    status: 401,
    message: pythonAuthSessionMessages[error],
    ...(state ? { state } : {}),
  };
}

function pythonAuthSessionMutationSuccess(
  sessionId: string,
  state?: PythonAuthSessionMutationState,
): PythonAuthSessionMutationContract {
  return {
    success: true,
    status: 200,
    ...(state ? { state } : {}),
    sessionId,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function diagnosticErrorFromPayload(payload: Record<string, unknown>): PythonAuthSessionDiagnosticError | null {
  const error = payload.error;
  if (!isRecord(error)) {
    return null;
  }
  if (error.code === "auth_session_store_missing_config") {
    return "missing_config";
  }
  if (error.code === "auth_session_store_failure") {
    return "store_failure";
  }
  return null;
}

function mutationStateFromPayload(payload: Record<string, unknown>): PythonAuthSessionMutationState | undefined {
  const state = payload.state;
  if (
    state === "refreshed" ||
    state === "logged_out" ||
    state === "expired" ||
    state === "invalid" ||
    state === "error"
  ) {
    return state;
  }
  return undefined;
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
  const diagnosticError = diagnosticErrorFromPayload(payload as Record<string, unknown>);
  if (diagnosticError) {
    return pythonAuthSessionDiagnosticError(diagnosticError);
  }
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

export function validatePythonAuthSessionMutationContract(payload: unknown): PythonAuthSessionMutationContract {
  if (!isRecord(payload)) {
    return pythonAuthSessionMutationError("invalid");
  }
  if (containsSecretKey(payload)) {
    return pythonAuthSessionMutationError("invalid");
  }
  const state = mutationStateFromPayload(payload);

  const diagnosticError = diagnosticErrorFromPayload(payload);
  if (diagnosticError) {
    return pythonAuthSessionMutationError(diagnosticError, state);
  }

  const error = payload.error;
  if (error === "missing" || error === "expired" || error === "invalid") {
    return pythonAuthSessionMutationError(error, state);
  }

  if (payload.ok === true && typeof payload.sessionId === "string" && payload.sessionId) {
    return pythonAuthSessionMutationSuccess(payload.sessionId, state);
  }

  return pythonAuthSessionMutationError("invalid");
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
      return pythonAuthSessionMutationSuccess(sessionId, "logged_out");
    },

    async refreshSession(sessionId) {
      await options.repositories.sessions.refreshLastSeen(sessionId, expiresAt());
      return pythonAuthSessionMutationSuccess(sessionId, "refreshed");
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

export type PythonAuthIdentityOperation = "register" | "login" | "verify_email_code";
export type PythonAuthIdentityState = "registered" | "authenticated" | "expired";
export type PythonAuthIdentityErrorCode = "invalid_credentials" | "expired_code" | "invalid";

export interface PythonAuthIdentitySuccessContract {
  ok: true;
  operation: PythonAuthIdentityOperation;
  state: "registered" | "authenticated";
  user: CurrentUser;
  sessionIssued?: boolean;
}

export interface PythonAuthIdentityErrorContract {
  ok?: false;
  error: PythonAuthIdentityErrorCode;
  status: 401 | 503;
  message: string;
  state?: "expired";
}

export type PythonAuthIdentityResult =
  | PythonAuthIdentitySuccessContract
  | PythonAuthIdentityErrorContract;

function isCurrentUserForIdentity(value: unknown): value is CurrentUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const u = value as Partial<CurrentUser>;
  return (
    typeof u.id === "string" &&
    typeof u.email === "string" &&
    typeof u.role === "string" &&
    typeof u.status === "string" &&
    typeof u.emailVerified === "boolean" &&
    typeof u.createdAt === "string"
  );
}

function containsSecretForIdentity(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretForIdentity(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const n = key.toLowerCase();
    if (
      n.includes("token") ||
      n.includes("cookie") ||
      n.includes("password") ||
      n.includes("secret") ||
      n.includes("hash")
    ) {
      return true;
    }
    return containsSecretForIdentity(child);
  });
}

export function validatePythonAuthIdentityResult(payload: unknown): PythonAuthIdentityResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "invalid", status: 401, message: "Invalid request" };
  }
  if (containsSecretForIdentity(payload)) {
    return { ok: false, error: "invalid", status: 401, message: "Invalid request" };
  }
  const p = payload as Record<string, unknown>;
  const error = p.error as PythonAuthIdentityErrorCode | undefined;
  if (error === "invalid_credentials" || error === "expired_code" || error === "invalid") {
    const state = p.state === "expired" ? "expired" : undefined;
    return {
      ok: false,
      error,
      status: (p.status as 401) || 401,
      message: typeof p.message === "string" ? p.message : "Authentication failed",
      ...(state ? { state } : {}),
    };
  }
  if (p.ok === true && p.operation && isCurrentUserForIdentity(p.user)) {
    const op = p.operation as PythonAuthIdentityOperation;
    if (op === "register" || op === "login" || op === "verify_email_code") {
      const state = (p.state as any) === "registered" ? "registered" : "authenticated";
      return {
        ok: true,
        operation: op,
        state,
        user: p.user,
        ...(typeof p.sessionIssued === "boolean" ? { sessionIssued: p.sessionIssued } : {}),
      };
    }
  }
  // treat non-matching as denied invalid
  return { ok: false, error: "invalid", status: 401, message: "Invalid request" };
}

export type AuthAuditProductionClosureStatus =
  | "ready"
  | "config_missing"
  | "degraded"
  | "denied"
  | "external_missing"
  | "failed";

export interface AuthAuditProductionClosureSummary {
  status: AuthAuditProductionClosureStatus;
  components: Record<string, boolean>;
  metadata: Record<string, unknown>;
}

export interface AuthAuditProductionClosureResult {
  status: AuthAuditProductionClosureStatus;
  contractVersion: string;
  provenance: string;
  ok: boolean;
  runtime: { owner: "python" | "node"; mode: string };
  closureSummary: AuthAuditProductionClosureSummary;
  subEnvelopes?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function containsSecretForClosure(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretForClosure(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const n = key.toLowerCase();
    if (
      n.includes("token") ||
      n.includes("cookie") ||
      n.includes("password") ||
      n.includes("secret") ||
      n.includes("hash") ||
      n.includes("bearer")
    ) {
      return true;
    }
    return containsSecretForClosure(child);
  });
}

export function validateAuthAuditProductionClosure(payload: unknown): AuthAuditProductionClosureResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "failed",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      closureSummary: { status: "failed", components: {}, metadata: {} },
      error: { code: "invalid", message: "Invalid closure payload" },
    };
  }
  if (containsSecretForClosure(payload)) {
    return {
      status: "failed",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      closureSummary: { status: "failed", components: {}, metadata: {} },
      error: { code: "invalid", message: "Invalid closure payload" },
    };
  }
  const p = payload as Record<string, unknown>;
  const status = (p.status as AuthAuditProductionClosureStatus) || "failed";
  const cs = (p.closureSummary as any) || { status, components: {}, metadata: {} };
  const normalizedStatus: AuthAuditProductionClosureStatus =
    status === "ready" ||
    status === "config_missing" ||
    status === "degraded" ||
    status === "denied" ||
    status === "external_missing" ||
    status === "failed"
      ? status
      : "failed";
  return {
    status: normalizedStatus,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : "auth-audit-production-closure.v1",
    provenance: typeof p.provenance === "string" ? p.provenance : "node-fallback",
    ok: normalizedStatus === "ready",
    runtime: (p.runtime as any) || { owner: "node", mode: "local_fallback" },
    closureSummary: {
      status: normalizedStatus,
      components: (cs.components as Record<string, boolean>) || {},
      metadata: (cs.metadata as Record<string, unknown>) || {},
    },
    ...(p.subEnvelopes ? { subEnvelopes: p.subEnvelopes as Record<string, unknown> } : {}),
    ...(p.error ? { error: p.error as { code: string; message: string } } : {}),
  };
}

// Token/mailer/session cutover readiness (101) - advisory only
export type AuthTokenMailerSessionCutoverStatus = "ready" | "blocked" | "degraded" | "skipped-live";

export interface AuthTokenMailerSessionCutoverResult {
  status: AuthTokenMailerSessionCutoverStatus;
  contractVersion: string;
  provenance: string;
  ok: boolean;
  runtime: { owner: "python" | "node"; mode: string };
  cutoverSummary?: { status: string; components: Record<string, string>; metadata: Record<string, unknown> };
  error?: { code: string; message: string };
}

function containsSecretForCutover(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretForCutover(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const n = key.toLowerCase();
    // allow structural component names like tokenIssuance, but block real secret fields
    if (n === "token" || n === "cookie" || n === "password" || n === "secret" || n === "hash" || n === "bearer" || n === "accesstoken" || n === "refreshtoken") {
      return true;
    }
    if ((n.includes("token") || n.includes("cookie") || n.includes("password") || n.includes("secret") || n.includes("hash") || n.includes("bearer")) && typeof child === "string" && child.length > 20) {
      return true;
    }
    return containsSecretForCutover(child);
  });
}

export function validateAuthTokenMailerSessionCutover(payload: unknown): AuthTokenMailerSessionCutoverResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "skipped-live",
      contractVersion: "auth-token-mailer-session-cutover.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      error: { code: "invalid", message: "Invalid cutover payload" },
    };
  }
  if (containsSecretForCutover(payload)) {
    return {
      status: "skipped-live",
      contractVersion: "auth-token-mailer-session-cutover.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      error: { code: "invalid", message: "Invalid cutover payload" },
    };
  }
  const p = payload as Record<string, unknown>;
  const rawStatus = (p.status as string) || "skipped-live";
  const normalizedStatus: AuthTokenMailerSessionCutoverStatus =
    rawStatus === "ready" || rawStatus === "blocked" || rawStatus === "degraded" || rawStatus === "skipped-live"
      ? (rawStatus as AuthTokenMailerSessionCutoverStatus)
      : "skipped-live";
  const cs = (p.cutoverSummary as any) || { status: normalizedStatus, components: {}, metadata: {} };
  return {
    status: normalizedStatus,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : "auth-token-mailer-session-cutover.v1",
    provenance: typeof p.provenance === "string" ? p.provenance : "python-auth-token-mailer-session-cutover",
    ok: normalizedStatus === "ready",
    runtime: (p.runtime as any) || { owner: "node", mode: "local_fallback" },
    cutoverSummary: {
      status: (cs.status as string) || normalizedStatus,
      components: (cs.components as Record<string, string>) || {},
      metadata: (cs.metadata as Record<string, unknown>) || {},
    },
    ...(p.error ? { error: p.error as { code: string; message: string } } : {}),
  };
}
