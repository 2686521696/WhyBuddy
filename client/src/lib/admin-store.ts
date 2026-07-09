import { create } from "zustand";

import { fetchJsonSafe, type FetchJsonSafeResult } from "./api-client";

export type AdminUserRole = "user" | "admin" | "super_admin";
export type AdminUserStatus = "active" | "disabled";
export type AdminProjectStatus = "active" | "archived";
export type AdminProjectSource = "user" | "imported_local" | "demo";

export interface AdminSummary {
  users: number;
  projects: number;
  runs: number;
  failures: number;
  audit: number;
}

export interface AdminUser {
  id: string;
  email: string;
  emailNormalized?: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: AdminUserRole;
  status: AdminUserStatus;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminProject {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  status: AdminProjectStatus;
  source: AdminProjectSource;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AdminRun {
  id: string;
  projectId?: string | null;
  userId?: string | null;
  status?: string | null;
  title?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface AdminFailure {
  id: string;
  runId?: string | null;
  projectId?: string | null;
  message?: string | null;
  reason?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface AdminAuditEntry {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

interface AdminSuccessResponse<T> {
  success: true;
  items?: T;
  summary?: AdminSummary;
}

interface AdminErrorResponse {
  success: false;
  error: string;
}

type AdminApiResponse<T> = AdminSuccessResponse<T> | AdminErrorResponse;

interface AdminStateSnapshot {
  summary: AdminSummary | null;
  users: AdminUser[];
  projects: AdminProject[];
  runs: AdminRun[];
  failures: AdminFailure[];
  audit: AdminAuditEntry[];
  loading: boolean;
  error: string | null;
}

export interface AdminState extends AdminStateSnapshot {
  loadSummary: () => Promise<void>;
  loadUsers: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadRuns: () => Promise<void>;
  loadFailures: () => Promise<void>;
  loadAudit: () => Promise<void>;
  loadOverview: () => Promise<void>;
  resetForTest: () => void;
}

const initialState: AdminStateSnapshot = {
  summary: null,
  users: [],
  projects: [],
  runs: [],
  failures: [],
  audit: [],
  loading: false,
  error: null,
};

function adminErrorMessage<T>(
  result: FetchJsonSafeResult<AdminApiResponse<T>>,
  fallback: string
) {
  if (result.ok) {
    return result.data.success ? fallback : result.data.error;
  }

  return result.error.message || fallback;
}

async function fetchAdmin<T>(
  endpoint: string,
  fallback: string
): Promise<{ data: T; summary?: AdminSummary } | { error: string }> {
  const result = await fetchJsonSafe<AdminApiResponse<T>>(endpoint, {
    credentials: "include",
  });

  if (!result.ok || !result.data.success) {
    return { error: adminErrorMessage(result, fallback) };
  }

  return {
    data: (result.data.items ?? ([] as T)) as T,
    summary: result.data.summary,
  };
}

export const useAdminStore = create<AdminState>((set, get) => ({
  ...initialState,

  async loadSummary() {
    set({ loading: true, error: null });
    const result = await fetchAdmin<never[]>(
      "/api/admin/summary",
      "Unable to load admin summary."
    );

    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }

    set({
      summary: result.summary ?? null,
      loading: false,
      error: null,
    });
  },

  async loadUsers() {
    set({ loading: true, error: null });
    const result = await fetchAdmin<AdminUser[]>(
      "/api/admin/users",
      "Unable to load admin users."
    );

    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }

    set({ users: result.data, loading: false, error: null });
  },

  async loadProjects() {
    set({ loading: true, error: null });
    const result = await fetchAdmin<AdminProject[]>(
      "/api/admin/projects",
      "Unable to load admin projects."
    );

    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }

    set({ projects: result.data, loading: false, error: null });
  },

  async loadRuns() {
    set({ loading: true, error: null });
    const result = await fetchAdmin<AdminRun[]>(
      "/api/admin/runs",
      "Unable to load admin runs."
    );

    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }

    set({ runs: result.data, loading: false, error: null });
  },

  async loadFailures() {
    set({ loading: true, error: null });
    const result = await fetchAdmin<AdminFailure[]>(
      "/api/admin/failures",
      "Unable to load admin failures."
    );

    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }

    set({ failures: result.data, loading: false, error: null });
  },

  async loadAudit() {
    set({ loading: true, error: null });
    const result = await fetchAdmin<AdminAuditEntry[]>(
      "/api/admin/audit",
      "Unable to load admin audit log."
    );

    if ("error" in result) {
      set({ loading: false, error: result.error });
      return;
    }

    set({ audit: result.data, loading: false, error: null });
  },

  async loadOverview() {
    set({ loading: true, error: null });
    const [summary, users, projects, runs, failures, audit] = await Promise.all([
      fetchAdmin<never[]>("/api/admin/summary", "Unable to load admin summary."),
      fetchAdmin<AdminUser[]>("/api/admin/users", "Unable to load admin users."),
      fetchAdmin<AdminProject[]>(
        "/api/admin/projects",
        "Unable to load admin projects."
      ),
      fetchAdmin<AdminRun[]>("/api/admin/runs", "Unable to load admin runs."),
      fetchAdmin<AdminFailure[]>(
        "/api/admin/failures",
        "Unable to load admin failures."
      ),
      fetchAdmin<AdminAuditEntry[]>(
        "/api/admin/audit",
        "Unable to load admin audit log."
      ),
    ]);

    const failed = [summary, users, projects, runs, failures, audit].find(
      result => "error" in result
    );

    if (failed && "error" in failed) {
      set({ loading: false, error: failed.error });
      return;
    }

    set({
      summary: "summary" in summary ? summary.summary ?? null : null,
      users: "data" in users ? users.data : get().users,
      projects: "data" in projects ? projects.data : get().projects,
      runs: "data" in runs ? runs.data : get().runs,
      failures: "data" in failures ? failures.data : get().failures,
      audit: "data" in audit ? audit.data : get().audit,
      loading: false,
      error: null,
    });
  },

  resetForTest() {
    set(initialState);
  },
}));
