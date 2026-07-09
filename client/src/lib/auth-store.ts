import { create } from "zustand";

import {
  isAdminRole,
  normalizeAuthEmail,
  type AuthErrorResponse,
  type AuthResponse,
  type CurrentUser,
  type LoginRequest,
  type RegisterRequest,
  type SendEmailLoginCodeRequest,
  type SendEmailLoginCodeResponse,
  type VerifyEmailLoginCodeRequest,
} from "@shared/auth";

import {
  fetchJsonSafe,
  type FetchJsonSafeResult,
} from "./api-client";

type AuthApiResponse = AuthResponse | AuthErrorResponse;
type SendEmailCodeApiResponse = SendEmailLoginCodeResponse | AuthErrorResponse;

interface AuthStateSnapshot {
  currentUser: CurrentUser | null;
  loading: boolean;
  error: string | null;
  sessionChecked: boolean;
}

export interface AuthState extends AuthStateSnapshot {
  fetchMe: () => Promise<void>;
  login: (input: LoginRequest) => Promise<boolean>;
  sendEmailLoginCode: (input: SendEmailLoginCodeRequest) => Promise<boolean>;
  loginWithEmailCode: (input: VerifyEmailLoginCodeRequest) => Promise<boolean>;
  register: (input: RegisterRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
  resetForTest: () => void;
}

const initialState: AuthStateSnapshot = {
  currentUser: null,
  loading: false,
  error: null,
  sessionChecked: false,
};

function authErrorMessage<TSuccess extends { success: true }>(
  result: FetchJsonSafeResult<TSuccess | AuthErrorResponse>,
  fallback: string
): string {
  if (result.ok) {
    return result.data.success ? fallback : result.data.error;
  }

  return result.error.message || fallback;
}

function authJsonInit(
  input: LoginRequest | RegisterRequest | SendEmailLoginCodeRequest | VerifyEmailLoginCodeRequest
): RequestInit {
  return {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      email: normalizeAuthEmail(input.email),
    }),
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initialState,

  async fetchMe() {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<AuthApiResponse>("/api/auth/me", {
      credentials: "include",
    });

    if (result.ok && result.data.success) {
      set({
        currentUser: result.data.user,
        loading: false,
        error: null,
        sessionChecked: true,
      });
      return;
    }

    const status = result.ok ? undefined : result.response?.status;
    set({
      currentUser: null,
      loading: false,
      sessionChecked: true,
      error:
        status === 401
          ? null
          : authErrorMessage(result, "Unable to restore the current session."),
    });
  },

  async login(input) {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<AuthApiResponse>(
      "/api/auth/login",
      authJsonInit(input)
    );

    if (result.ok && result.data.success) {
      set({
        currentUser: result.data.user,
        loading: false,
        error: null,
        sessionChecked: true,
      });
      return true;
    }

    set({
      currentUser: null,
      loading: false,
      sessionChecked: true,
      error: authErrorMessage(result, "Unable to sign in."),
    });
    return false;
  },

  async sendEmailLoginCode(input) {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<SendEmailCodeApiResponse>(
      "/api/auth/email-code/send",
      authJsonInit(input)
    );

    set({
      loading: false,
      error: result.ok
        ? result.data.success
          ? null
          : result.data.error
        : authErrorMessage(result, "Unable to send the email code."),
    });

    return result.ok && result.data.success;
  },

  async loginWithEmailCode(input) {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<AuthApiResponse>(
      "/api/auth/email-code/login",
      authJsonInit({
        ...input,
        code: input.code.trim(),
      })
    );

    if (result.ok && result.data.success) {
      set({
        currentUser: result.data.user,
        loading: false,
        error: null,
        sessionChecked: true,
      });
      return true;
    }

    set({
      currentUser: null,
      loading: false,
      sessionChecked: true,
      error: authErrorMessage(result, "Unable to sign in with email code."),
    });
    return false;
  },

  async register(input) {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<AuthApiResponse>(
      "/api/auth/register",
      authJsonInit(input)
    );

    if (result.ok && result.data.success) {
      set({
        currentUser: result.data.user,
        loading: false,
        error: null,
        sessionChecked: true,
      });
      return true;
    }

    set({
      currentUser: null,
      loading: false,
      sessionChecked: true,
      error: authErrorMessage(result, "Unable to create the account."),
    });
    return false;
  },

  async logout() {
    set({ loading: true, error: null });
    const result = await fetchJsonSafe<{ success: true }>("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    set({
      currentUser: null,
      loading: false,
      sessionChecked: true,
      error: result.ok ? null : result.error.message,
    });
  },

  isAuthenticated() {
    return Boolean(get().currentUser);
  },

  isAdmin() {
    return isAdminRole(get().currentUser?.role);
  },

  resetForTest() {
    set(initialState);
  },
}));
