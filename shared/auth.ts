export type UserRole = "user" | "admin" | "super_admin";
export type UserStatus = "active" | "disabled";

export interface CurrentUser {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  lastSeenAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface AuthResponse {
  success: true;
  user: CurrentUser;
}

export interface AuthErrorResponse {
  success: false;
  error: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SendEmailLoginCodeRequest {
  email: string;
}

export interface SendEmailLoginCodeResponse {
  success: true;
  expiresInSeconds: number;
}

export interface VerifyEmailLoginCodeRequest {
  email: string;
  code: string;
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

// Python runtime boundary envelope types (auth login/register) for migration contract.
export type PythonAuthIdentityEnvelope = { ok: boolean; operation?: string; error?: string } & Record<string, unknown>;

// Token/mailer/session cutover types for 101 (advisory envelopes; node owns real issuance/mailer/policy)
export type PythonAuthTokenMailerSessionCutoverEnvelope = { status: string; ok?: boolean } & Record<string, unknown>;
