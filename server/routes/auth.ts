import express, { type Request, type Response } from "express";

import {
  normalizeAuthEmail,
  type AuthErrorResponse,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
  type SendEmailLoginCodeRequest,
  type SendEmailLoginCodeResponse,
  type VerifyEmailLoginCodeRequest,
} from "../../shared/auth.js";
import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import type { EmailCodeService } from "../auth/email-code-service.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type {
  PythonAuthIdentityResult,
  PythonAuthSessionMutationContract,
  SessionService,
} from "../auth/session-service.js";
import {
  toCurrentUser,
  validatePythonAuthIdentityResult,
  validateAuthAuditProductionClosure,
  validateAuthTokenMailerSessionCutover,
  validateAuthSessionTokenBoundary,
  validateAuthProductionOwnershipClosure,
  validateAuthSessionRepositoryTakeover,
  validateAuthTokenIssuanceTakeover,
} from "../auth/session-service.js";
import type {
  EmailLoginTokenPurpose,
  SessionRecord,
  UserRecord,
  UserRole,
  UserStatus,
} from "../persistence/repositories.js";
import {
  delegateToPythonThinProxy,
  isPythonThinProxyEnabled,
} from "./python-thin-proxy.js";

type AuthJson = AuthResponse | SendEmailLoginCodeResponse | AuthErrorResponse;

export interface AuthUsersRepository {
  findById(userId: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: {
    email: string;
    passwordHash?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    role?: UserRole;
    status?: UserStatus;
    emailVerifiedAt?: Date | null;
  }): Promise<UserRecord>;
  updateLastLogin(userId: string, ip?: string | null): Promise<void>;
  markEmailVerified?(userId: string, verifiedAt?: Date): Promise<void>;
}

export interface AuthSessionsRepository {
  create(input: {
    userId: string;
    tokenHash: string;
    ip?: string | null;
    userAgent?: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord>;
}

export interface AuthEmailLoginTokensRepository {
  create(input: {
    email: string;
    userId?: string | null;
    purpose?: EmailLoginTokenPurpose;
    tokenHash: string;
    requestIp?: string | null;
    userAgent?: string | null;
    expiresAt: Date;
  }): Promise<string>;
  findValidByTokenHash(
    tokenHash: string,
    purpose: EmailLoginTokenPurpose,
    now?: Date,
  ): Promise<{ id: string; emailNormalized: string; userId: string | null } | null>;
  markConsumed(tokenId: string): Promise<void>;
  countCreatedSince?(email: string, purpose: EmailLoginTokenPurpose, since: Date): Promise<number>;
}

export interface AuthRouterDeps {
  users: AuthUsersRepository;
  sessions: AuthSessionsRepository;
  sessionService: SessionService;
  emailLoginTokens?: AuthEmailLoginTokensRepository;
  emailCodeService?: EmailCodeService;
  // thin python runtime bridge for auth identity (login/register/email-code) without changing prod user system
  pythonIdentityRuntime?: {
    execute(payload: Record<string, unknown>): PythonAuthIdentityResult | Promise<PythonAuthIdentityResult>;
  };
  // python auth/audit/permission production closure summary (thin, Node consumes for posture; no secrets or external side effects)
  pythonAuthAuditClosure?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
  // thin python token/mailer/session cutover readiness (101 advisory; node keeps real issuance/mailer/store/policy)
  pythonTokenMailerSessionCutover?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
  // python session token boundary decision (103); node-retained for real repo/issuance; python provides decision envelope
  pythonAuthSessionTokenBoundary?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
  // python auth production ownership closure (102); explicit retained decisions
  pythonAuthProductionOwnershipClosure?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
  // python auth session repository takeover 104; bounded deterministic create/read/revoke ops slice;
  // takeover flag only for proven slice; node retains prod repo responsibility otherwise
  pythonAuthSessionRepositoryTakeover?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
  // python auth token issuance takeover 104; bounded decision for issue/refresh/revoke slice only
  // (python returns lifecycle decision with safe metadata; node retains actual token issuance)
  pythonAuthTokenIssuanceTakeover?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
  // python auth mailer and user store scope 104: formal node-retained classification for emailCodeMailer/userRepository
  // (intentionally retained; python only thin scope decision evidence; no prod email or user store claim)
  pythonAuthMailerUserStoreScope?: {
    execute(payload: Record<string, unknown>): any | Promise<any>;
  };
}

function jsonError(error: string): AuthErrorResponse {
  return { success: false, error };
}

// Python thin-proxy delegation for the auth surfaces served endpoint-for-endpoint
// by slide-rule-python routes/auth.py (/register, /login, /email-code/login and
// the seven GET /__internal/* closure/takeover surfaces). Security-sensitive:
// flag default OFF (AUTH_PYTHON_PROXY, explicit "true" opts in) — the wiring
// exists, flipping the default is a later decision. Node keeps cookie issuance
// and the production user repository (Python identity is a bounded decision
// envelope); infra failures (connect failure / 5xx / key rejection) fall back
// to the existing Node implementation, business 4xx envelopes pass through.
// Node-retained endpoints (/email-code/send real mailer, /me, /refresh,
// /logout cookie/session semantics) are intentionally NOT delegated.
const AUTH_PYTHON_PROXY_FLAG = "AUTH_PYTHON_PROXY";

function isAuthPythonProxyEnabled(): boolean {
  return isPythonThinProxyEnabled(AUTH_PYTHON_PROXY_FLAG, { defaultEnabled: false });
}

async function delegateAuthIdentityToPython(
  endpoint: "/register" | "/login" | "/email-code/login",
  payload: Record<string, unknown>,
): Promise<PythonAuthIdentityResult | null> {
  if (!isAuthPythonProxyEnabled()) return null;
  const delegated = await delegateToPythonThinProxy({
    endpoint: `/api/auth${endpoint}`,
    method: "POST",
    payload,
  });
  if (!delegated.delegated) {
    console.warn(
      `[auth] python identity delegation unavailable for ${endpoint}; falling back to Node implementation: ${delegated.reason}`,
    );
    return null;
  }
  return validatePythonAuthIdentityResult(delegated.body);
}

async function delegateAuthInternalToPython(name: string): Promise<unknown | null> {
  if (!isAuthPythonProxyEnabled()) return null;
  const delegated = await delegateToPythonThinProxy({
    endpoint: `/api/auth/__internal/${name}`,
    method: "POST",
    payload: { metadata: { source: "node-python-proxy" } },
  });
  if (!delegated.delegated || delegated.status >= 400) {
    console.warn(
      `[auth] python __internal/${name} delegation unavailable; using Node fallback envelope${
        delegated.delegated ? ` (python http ${delegated.status})` : `: ${delegated.reason}`
      }`,
    );
    return null;
  }
  return delegated.body;
}

function authMutationStatus(status: PythonAuthSessionMutationContract["status"]): 401 | 503 {
  return status === 503 ? 503 : 401;
}

function authMutationMessage(result: PythonAuthSessionMutationContract): string {
  if (result.message) return result.message;
  if (result.error === "expired") return "Session expired";
  if (result.error === "invalid") return "Invalid session";
  if (result.error === "store_failure") return "Auth session persistence failed.";
  if (result.error === "missing_config") return "Auth session persistence is not configured.";
  return "Authentication required";
}

function maybeRejectAuthMutation(
  result: PythonAuthSessionMutationContract,
  response: Response,
  clearCookie: () => void,
): boolean {
  if (result.success) {
    return false;
  }
  if (result.status === 401) {
    clearCookie();
  }
  response.status(authMutationStatus(result.status)).json(jsonError(authMutationMessage(result)));
  return true;
}

function mapPythonIdentityError(result: PythonAuthIdentityResult): { status: number; error: string } {
  const r = result as any;
  const msg = r.message || (r.error === "invalid_credentials" ? "邮箱或密码错误" : "Email or code is invalid.");
  const status = r.status || 401;
  return { status, error: msg };
}

async function runPythonIdentity(
  deps: AuthRouterDeps,
  payload: Record<string, unknown>,
): Promise<PythonAuthIdentityResult | null> {
  if (!deps.pythonIdentityRuntime) return null;
  try {
    const raw = await Promise.resolve(deps.pythonIdentityRuntime.execute(payload));
    return validatePythonAuthIdentityResult(raw);
  } catch {
    return { ok: false, error: "invalid", status: 401, message: "Authentication failed" } as any;
  }
}

async function runPythonAuthAuditClosure(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonAuthAuditClosure) return null;
  try {
    const raw = await Promise.resolve(deps.pythonAuthAuditClosure.execute(payload));
    return validateAuthAuditProductionClosure(raw);
  } catch {
    return {
      status: "failed",
      contractVersion: "auth-audit-production-closure.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      closureSummary: { status: "failed", components: {}, metadata: {} },
      error: { code: "bridge_error", message: "Auth audit closure fetch failed" },
    };
  }
}

async function runPythonTokenMailerSessionCutover(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonTokenMailerSessionCutover) return null;
  try {
    const raw = await Promise.resolve(deps.pythonTokenMailerSessionCutover.execute(payload));
    return validateAuthTokenMailerSessionCutover(raw);
  } catch {
    return {
      status: "skipped-live",
      contractVersion: "auth-token-mailer-session-cutover.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      cutoverSummary: { status: "skipped-live", components: {}, metadata: {} },
      error: { code: "bridge_error", message: "Auth token/mailer/session cutover fetch failed" },
    };
  }
}

async function runPythonAuthSessionTokenBoundary(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonAuthSessionTokenBoundary) return null;
  try {
    const raw = await Promise.resolve(deps.pythonAuthSessionTokenBoundary.execute(payload));
    return validateAuthSessionTokenBoundary(raw);
  } catch {
    return {
      status: "node-retained",
      contractVersion: "auth-session-token-boundary.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      ownership: { sessionRepository: "node-retained", tokenIssuance: "node-retained", sessionTokenDecision: "node-retained" },
      error: { code: "bridge_error", message: "Auth session token boundary fetch failed" },
    };
  }
}

async function runPythonAuthProductionOwnershipClosure(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonAuthProductionOwnershipClosure) return null;
  try {
    const raw = await Promise.resolve(deps.pythonAuthProductionOwnershipClosure.execute(payload));
    return validateAuthProductionOwnershipClosure(raw);
  } catch {
    return {
      status: "node-fallback",
      contractVersion: "auth.production-ownership-closure.v1",
      provenance: "node-fallback",
      ok: false,
      productionTakeover: false,
      runtime: { owner: "node", mode: "local_fallback" },
      ownership: { sessionRepository: "node-retained" },
      error: { code: "bridge_error", message: "Auth production ownership fetch failed" },
    };
  }
}

async function runPythonAuthSessionRepositoryTakeover(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonAuthSessionRepositoryTakeover) return null;
  try {
    const raw = await Promise.resolve(deps.pythonAuthSessionRepositoryTakeover.execute(payload));
    return validateAuthSessionRepositoryTakeover(raw);
  } catch {
    return {
      status: "node-retained",
      contractVersion: "auth-session-repository-takeover.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      ownership: { sessionRepository: "node-retained" },
      productionTakeover: false,
      error: { code: "bridge_error", message: "Auth session repository takeover fetch failed" },
    };
  }
}

async function runPythonAuthTokenIssuanceTakeover(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonAuthTokenIssuanceTakeover) return null;
  try {
    const raw = await Promise.resolve(deps.pythonAuthTokenIssuanceTakeover.execute(payload));
    return validateAuthTokenIssuanceTakeover(raw);
  } catch {
    return {
      status: "node-retained",
      contractVersion: "auth-token-issuance-takeover.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      ownership: { tokenIssuance: "node-retained" },
      productionTakeover: false,
      error: { code: "bridge_error", message: "Auth token issuance takeover fetch failed" },
    };
  }
}

async function runPythonAuthMailerUserStoreScope(deps: AuthRouterDeps, payload: Record<string, unknown>): Promise<any | null> {
  if (!deps.pythonAuthMailerUserStoreScope) return null;
  try {
    const raw = await Promise.resolve(deps.pythonAuthMailerUserStoreScope.execute(payload));
    return raw;
  } catch {
    return {
      status: "node-retained",
      contractVersion: "auth-mailer-user-store-scope.v1",
      provenance: "node-fallback",
      ok: false,
      runtime: { owner: "node", mode: "local_fallback" },
      ownership: { emailCodeMailer: "node-retained", userRepository: "node-retained" },
      productionTakeover: false,
      metadata: { note: "python not wired" },
    };
  }
}

function isDuplicateEmailError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; errno?: number; message?: string };
  return value.code === "ER_DUP_ENTRY" || value.errno === 1062 || /duplicate/i.test(value.message ?? "");
}

function getClientIp(request: Request): string | null {
  const forwardedFor = request.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.ip || null;
}

function getUserAgent(request: Request): string | null {
  return request.header("user-agent")?.slice(0, 512) ?? null;
}

function parseDisplayName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = normalizeAuthEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validatePassword(value: unknown): string | null {
  return typeof value === "string" && value.length >= 8 ? value : null;
}

function validateEmailCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  return /^\d{6}$/.test(code) ? code : null;
}

export function createAuthRouter(deps: AuthRouterDeps) {
  const router = express.Router();
  const auth = createAuthMiddleware(deps.sessionService);

  router.post("/register", async (request, response) => {
    const body = (request.body ?? {}) as Partial<RegisterRequest>;
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);

    if (!email || !password) {
      response.status(400).json(jsonError("邮箱格式无效或密码长度不足"));
      return;
    }

    // python identity runtime bridge (thin): injected dep first, then the
    // flag-gated HTTP thin proxy to slide-rule-python (AUTH_PYTHON_PROXY).
    const pyReg =
      (await runPythonIdentity(deps, { operation: "register", email, password, displayName: body.displayName })) ??
      (await delegateAuthIdentityToPython("/register", {
        operation: "register",
        email,
        password,
        displayName: body.displayName,
      }));
    if (pyReg) {
      if (!pyReg.ok) {
        const mapped = mapPythonIdentityError(pyReg);
        response.status(mapped.status).json(jsonError(mapped.error));
        return;
      }
      const pyUser = (pyReg as any).user;
      const { token } = await deps.sessionService.createSession({
        userId: pyUser.id,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
      });
      deps.sessionService.writeSessionCookie(response, token);
      response.status(201).json({ success: true, user: pyUser } satisfies AuthJson);
      return;
    }

    const existing = await deps.users.findByEmail(email);
    if (existing) {
      response.status(409).json(jsonError("邮箱已注册"));
      return;
    }

    try {
      const user = await deps.users.create({
        email,
        passwordHash: await hashPassword(password),
        displayName: parseDisplayName(body.displayName),
        emailVerifiedAt: null,
      });
      const { token } = await deps.sessionService.createSession({
        userId: user.id,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
      });

      deps.sessionService.writeSessionCookie(response, token);
      response.status(201).json({ success: true, user: toCurrentUser(user) } satisfies AuthJson);
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        response.status(409).json(jsonError("邮箱已注册"));
        return;
      }
      throw error;
    }
  });

  router.post("/login", async (request, response) => {
    const body = (request.body ?? {}) as Partial<LoginRequest>;
    const email = validateEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const loginError = jsonError("邮箱或密码错误");

    if (!email || !password) {
      response.status(401).json(loginError);
      return;
    }

    // python identity runtime bridge (thin): if provided, delegate decision envelope;
    // otherwise the flag-gated HTTP thin proxy (AUTH_PYTHON_PROXY, default off).
    const pyLogin =
      (await runPythonIdentity(deps, { operation: "login", email, password })) ??
      (await delegateAuthIdentityToPython("/login", { operation: "login", email, password }));
    if (pyLogin) {
      if (!pyLogin.ok) {
        const mapped = mapPythonIdentityError(pyLogin);
        response.status(mapped.status).json(jsonError(mapped.error));
        return;
      }
      // success from python: issue session using provided user (retains metadata path)
      const pyUser = (pyLogin as any).user;
      const { token } = await deps.sessionService.createSession({
        userId: pyUser.id,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
      });
      deps.sessionService.writeSessionCookie(response, token);
      response.json({ success: true, user: pyUser } satisfies AuthJson);
      return;
    }

    const user = await deps.users.findByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json(loginError);
      return;
    }

    if (user.status !== "active") {
      response.status(403).json(jsonError("账号已禁用"));
      return;
    }

    const { token } = await deps.sessionService.createSession({
      userId: user.id,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });
    await deps.users.updateLastLogin(user.id, getClientIp(request));

    deps.sessionService.writeSessionCookie(response, token);
    response.json({ success: true, user: toCurrentUser(user) } satisfies AuthJson);
  });

  router.post("/email-code/send", async (request, response) => {
    if (!deps.emailLoginTokens || !deps.emailCodeService) {
      response.status(503).json(jsonError("Email code login is not enabled."));
      return;
    }

    const body = (request.body ?? {}) as Partial<SendEmailLoginCodeRequest>;
    const email = validateEmail(body.email);

    if (!email) {
      response.status(400).json(jsonError("Email format is invalid."));
      return;
    }

    const user = await deps.users.findByEmail(email);
    if (!user || user.status !== "active") {
      response.json({
        success: true,
        expiresInSeconds: deps.emailCodeService.ttlSeconds,
      } satisfies AuthJson);
      return;
    }

    const recentCount = await deps.emailLoginTokens.countCreatedSince?.(
      email,
      "login",
      new Date(deps.emailCodeService.now().getTime() - 10 * 60 * 1000),
    );
    if (recentCount != null && recentCount >= 5) {
      response.json({
        success: true,
        expiresInSeconds: deps.emailCodeService.ttlSeconds,
      } satisfies AuthJson);
      return;
    }

    const code = deps.emailCodeService.generateCode();
    await deps.emailLoginTokens.create({
      email,
      userId: user.id,
      purpose: "login",
      tokenHash: deps.emailCodeService.hashCode(email, code),
      requestIp: getClientIp(request),
      userAgent: getUserAgent(request),
      expiresAt: deps.emailCodeService.expiresAt(),
    });
    await deps.emailCodeService.sendLoginCode({ email: user.email, code });

    response.json({
      success: true,
      expiresInSeconds: deps.emailCodeService.ttlSeconds,
    } satisfies AuthJson);
  });

  router.post("/email-code/login", async (request, response) => {
    if (!deps.emailLoginTokens || !deps.emailCodeService) {
      response.status(503).json(jsonError("Email code login is not enabled."));
      return;
    }

    const body = (request.body ?? {}) as Partial<VerifyEmailLoginCodeRequest>;
    const email = validateEmail(body.email);
    const code = validateEmailCode(body.code);
    const loginError = jsonError("Email or code is invalid.");

    if (!email || !code) {
      response.status(401).json(loginError);
      return;
    }

    // python identity runtime bridge (thin) for email code; injected dep first,
    // then the flag-gated HTTP thin proxy (AUTH_PYTHON_PROXY, default off).
    const pyVerify =
      (await runPythonIdentity(deps, { operation: "verify_email_code", email, code })) ??
      (await delegateAuthIdentityToPython("/email-code/login", {
        operation: "verify_email_code",
        email,
        code,
      }));
    if (pyVerify) {
      if (!pyVerify.ok) {
        const mapped = mapPythonIdentityError(pyVerify);
        response.status(mapped.status).json(jsonError(mapped.error));
        return;
      }
      const pyUser = (pyVerify as any).user;
      const { token: sessionToken } = await deps.sessionService.createSession({
        userId: pyUser.id,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
      });
      deps.sessionService.writeSessionCookie(response, sessionToken);
      response.json({ success: true, user: pyUser } satisfies AuthJson);
      return;
    }

    const token = await deps.emailLoginTokens.findValidByTokenHash(
      deps.emailCodeService.hashCode(email, code),
      "login",
    );
    if (!token || token.emailNormalized !== email) {
      response.status(401).json(loginError);
      return;
    }

    const user = token.userId
      ? await deps.users.findById(token.userId)
      : await deps.users.findByEmail(email);
    if (!user || user.emailNormalized !== email) {
      response.status(401).json(loginError);
      return;
    }

    if (user.status !== "active") {
      await deps.emailLoginTokens.markConsumed(token.id);
      response.status(403).json(jsonError("Account is disabled."));
      return;
    }

    await deps.emailLoginTokens.markConsumed(token.id);
    const emailVerifiedAt = user.emailVerifiedAt ?? deps.emailCodeService.now();
    if (!user.emailVerifiedAt) {
      await deps.users.markEmailVerified?.(user.id, emailVerifiedAt);
    }
    const { token: sessionToken } = await deps.sessionService.createSession({
      userId: user.id,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });
    await deps.users.updateLastLogin(user.id, getClientIp(request));

    deps.sessionService.writeSessionCookie(response, sessionToken);
    response.json({
      success: true,
      user: toCurrentUser({ ...user, emailVerifiedAt }),
    } satisfies AuthJson);
  });

  router.get("/me", auth.requireAuth, (request, response) => {
    const authRequest = request as AuthenticatedRequest;
    response.json({ success: true, user: authRequest.user } satisfies AuthJson);
  });

  router.post("/refresh", auth.requireAuth, async (request, response) => {
    const authRequest = request as AuthenticatedRequest;
    const result = await deps.sessionService.refreshSession(authRequest.sessionId);
    if (maybeRejectAuthMutation(result, response, () => deps.sessionService.clearCookie(response))) {
      return;
    }
    response.json({ success: true, user: authRequest.user } satisfies AuthJson);
  });

  router.post("/logout", auth.requireAuth, async (request, response) => {
    const authRequest = request as AuthenticatedRequest;
    const result = await deps.sessionService.revokeSession(authRequest.sessionId);
    if (maybeRejectAuthMutation(result, response, () => deps.sessionService.clearCookie(response))) {
      return;
    }
    deps.sessionService.clearCookie(response);
    response.json({ success: true });
  });

  // thin consumption of python auth/audit production closure summary (for migration evidence only)
  // Node retains password/email/session/policy/risk/audit metadata boundaries
  router.get("/__internal/auth-audit-closure", async (request, response) => {
    let closure = await runPythonAuthAuditClosure(deps, { metadata: { source: "node-consume" } });
    if (!closure) {
      const proxied = await delegateAuthInternalToPython("auth-audit-closure");
      if (proxied) closure = validateAuthAuditProductionClosure(proxied);
    }
    if (closure) {
      response.json({ success: true, closure });
      return;
    }
    // fallback when no python provided - explicit non-healthy
    response.json({
      success: true,
      closure: validateAuthAuditProductionClosure({
        status: "config_missing",
        contractVersion: "auth-audit-production-closure.v1",
        provenance: "node-fallback",
        ok: false,
        runtime: { owner: "node", mode: "local_fallback" },
        closureSummary: { status: "config_missing", components: {}, metadata: { note: "python not wired" } },
      }),
    });
  });

  // thin consumption of python token/mailer/session cutover readiness (101)
  // Node retains real token issuance, email delivery, session repo, password policy
  router.get("/__internal/auth-token-mailer-session-cutover", async (request, response) => {
    let cutover = await runPythonTokenMailerSessionCutover(deps, { metadata: { source: "node-consume" } });
    if (!cutover) {
      const proxied = await delegateAuthInternalToPython("auth-token-mailer-session-cutover");
      if (proxied) cutover = validateAuthTokenMailerSessionCutover(proxied);
    }
    if (cutover) {
      response.json({ success: true, cutover });
      return;
    }
    // fallback explicit non-ready
    response.json({
      success: true,
      cutover: validateAuthTokenMailerSessionCutover({
        status: "skipped-live",
        contractVersion: "auth-token-mailer-session-cutover.v1",
        provenance: "node-fallback",
        ok: false,
        runtime: { owner: "node", mode: "local_fallback" },
        cutoverSummary: { status: "skipped-live", components: { tokenIssuance: "node", emailCodeMailer: "node", sessionRepository: "node" }, metadata: { note: "python not wired" } },
      }),
    });
  });

  // thin consumption of python auth session token boundary 103
  // Node retains production session/token; python decision boundary only
  router.get("/__internal/auth-session-token-boundary", async (request, response) => {
    let boundary = await runPythonAuthSessionTokenBoundary(deps, { metadata: { source: "node-consume" } });
    if (!boundary) {
      const proxied = await delegateAuthInternalToPython("auth-session-token-boundary");
      if (proxied) boundary = validateAuthSessionTokenBoundary(proxied);
    }
    if (boundary) {
      response.json({ success: true, boundary });
      return;
    }
    // fallback explicit retained
    response.json({
      success: true,
      boundary: validateAuthSessionTokenBoundary({
        status: "node-retained",
        contractVersion: "auth-session-token-boundary.v1",
        provenance: "node-fallback",
        ok: false,
        runtime: { owner: "node", mode: "local_fallback" },
        ownership: {
          sessionRepository: "node-retained",
          tokenIssuance: "node-retained",
          passwordPolicy: "node-retained",
          emailCodeMailer: "node-retained",
          userRepository: "node-retained",
          sessionTokenDecision: "node-retained",
        },
        metadata: { note: "python not wired" },
      }),
    });
  });

  // thin consumption of python auth production ownership closure 102
  router.get("/__internal/auth-production-ownership-closure", async (request, response) => {
    let closure = await runPythonAuthProductionOwnershipClosure(deps, { metadata: { source: "node-consume" } });
    if (!closure) {
      const proxied = await delegateAuthInternalToPython("auth-production-ownership-closure");
      if (proxied) closure = validateAuthProductionOwnershipClosure(proxied);
    }
    if (closure) {
      response.json({ success: true, closure });
      return;
    }
    response.json({
      success: true,
      closure: validateAuthProductionOwnershipClosure({
        status: "node-fallback",
        contractVersion: "auth.production-ownership-closure.v1",
        provenance: "node-fallback",
        ok: false,
        productionTakeover: false,
        runtime: { owner: "node", mode: "local_fallback" },
        ownership: { sessionRepository: "node-retained", tokenIssuance: "node-retained" },
        metadata: { note: "python not wired" },
      }),
    });
  });

  // thin consumption of python auth session repository takeover 104
  // bounded create/read/revoke evidence; takeover flag only for proven slice; retained otherwise
  router.get("/__internal/auth-session-repository-takeover", async (request, response) => {
    let takeover = await runPythonAuthSessionRepositoryTakeover(deps, { metadata: { source: "node-consume" } });
    if (!takeover) {
      const proxied = await delegateAuthInternalToPython("auth-session-repository-takeover");
      if (proxied) takeover = validateAuthSessionRepositoryTakeover(proxied);
    }
    if (takeover) {
      response.json({ success: true, takeover });
      return;
    }
    response.json({
      success: true,
      takeover: validateAuthSessionRepositoryTakeover({
        status: "node-retained",
        contractVersion: "auth-session-repository-takeover.v1",
        provenance: "node-fallback",
        ok: false,
        runtime: { owner: "node", mode: "local_fallback" },
        ownership: { sessionRepository: "node-retained" },
        productionTakeover: false,
        metadata: { note: "python not wired" },
      }),
    });
  });

  // thin consumption of python auth token issuance takeover 104
  // decision for issue/refresh/revoke slice; node retains real token issuance
  router.get("/__internal/auth-token-issuance-takeover", async (request, response) => {
    let takeover = await runPythonAuthTokenIssuanceTakeover(deps, { metadata: { source: "node-consume" } });
    if (!takeover) {
      const proxied = await delegateAuthInternalToPython("auth-token-issuance-takeover");
      if (proxied) takeover = validateAuthTokenIssuanceTakeover(proxied);
    }
    if (takeover) {
      response.json({ success: true, takeover });
      return;
    }
    response.json({
      success: true,
      takeover: validateAuthTokenIssuanceTakeover({
        status: "node-retained",
        contractVersion: "auth-token-issuance-takeover.v1",
        provenance: "node-fallback",
        ok: false,
        runtime: { owner: "node", mode: "local_fallback" },
        ownership: { tokenIssuance: "node-retained" },
        productionTakeover: false,
        metadata: { note: "python not wired" },
      }),
    });
  });

  // thin consumption of python auth mailer user store scope 104
  // classifies emailCodeMailer/userRepository as node-retained (retained surfaces + reason/denom)
  router.get("/__internal/auth-mailer-user-store-scope", async (request, response) => {
    let scope = await runPythonAuthMailerUserStoreScope(deps, { metadata: { source: "node-consume" } });
    if (!scope) {
      scope = await delegateAuthInternalToPython("auth-mailer-user-store-scope");
    }
    if (scope) {
      response.json({ success: true, scope });
      return;
    }
    // fallback explicit retained (no validate call for new scope to keep scope minimal)
    response.json({
      success: true,
      scope: {
        status: "node-retained",
        contractVersion: "auth-mailer-user-store-scope.v1",
        provenance: "node-fallback",
        ok: false,
        runtime: { owner: "node", mode: "local_fallback" },
        ownership: {
          emailCodeMailer: "node-retained",
          userRepository: "node-retained",
          mailerUserStoreScopeDecision: "node-retained",
        },
        productionTakeover: false,
        metadata: { note: "python not wired" },
      },
    });
  });

  return router;
}
