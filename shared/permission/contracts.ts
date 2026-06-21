/**
 * Agent 细粒度权限模型契约
 *
 * 定义 Agent-Resource-Action 三维权限矩阵的核心类型。
 * 在 secure-sandbox 的 Docker 容器物理隔离之上，提供治理层权限控制。
 */

// ─── 资源类型与操作 ─────────────────────────────────────────────────────────

export const RESOURCE_TYPES = ["filesystem", "network", "api", "database", "mcp_tool"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACTIONS = ["read", "write", "execute", "delete", "connect", "call", "select", "insert", "update"] as const;
export type Action = (typeof ACTIONS)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ─── 约束条件 ───────────────────────────────────────────────────────────────

export interface PermissionConstraints {
  pathPatterns?: string[];
  domainPatterns?: string[];
  cidrRanges?: string[];
  ports?: PortRange[];
  rateLimit?: RateLimitConfig;
  endpoints?: string[];
  methods?: string[];
  parameterConstraints?: Record<string, string>;
  tables?: string[];
  rowLevelFilter?: string;
  forbiddenOperations?: string[];
  maxResultRows?: number;
  queryTimeoutMs?: number;
}

export interface PortRange {
  from: number;
  to: number;
}

export interface RateLimitConfig {
  maxPerMinute: number;
  maxBandwidthBytesPerMinute?: number;
}

export type PermissionRateLimitDecisionReason = "allowed" | "rate_limit_exceeded" | "invalid_limit";

export interface PermissionRateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAtMs: number | null;
  reason: PermissionRateLimitDecisionReason;
}

// ─── 权限定义 ───────────────────────────────────────────────────────────────

export interface Permission {
  resourceType: ResourceType;
  action: Action;
  constraints: PermissionConstraints;
  effect: "allow" | "deny";
}

// ─── 角色 ───────────────────────────────────────────────────────────────────

export interface AgentRole {
  roleId: string;
  roleName: string;
  description: string;
  permissions: Permission[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Agent 权限策略 ─────────────────────────────────────────────────────────

export interface AgentPermissionPolicy {
  agentId: string;
  assignedRoles: string[];
  customPermissions: Permission[];
  deniedPermissions: Permission[];
  effectiveAt: string;
  expiresAt: string | null;
  templateId?: string;
  organizationId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── CapabilityToken ────────────────────────────────────────────────────────

export interface CapabilityTokenPayload {
  agentId: string;
  permissionMatrix: PermissionMatrixEntry[];
  iat: number;
  exp: number;
}

export interface PermissionMatrixEntry {
  resourceType: ResourceType;
  actions: Action[];
  constraints: PermissionConstraints;
  effect: "allow" | "deny";
}

export interface CapabilityToken {
  token: string;
  agentId: string;
  issuedAt: string;
  expiresAt: string;
}

// ─── 权限检查结果 ───────────────────────────────────────────────────────────

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  suggestion?: string;
  matchedRule?: Permission;
  governance?: GovernanceDecision;
}

export const PERMISSION_CHECK_CONTRACT_VERSION = "permission-check.v1" as const;

export type PermissionCheckContractDecision = "allow" | "deny";
export type PermissionCheckContractSource = "node" | "python_contract" | "python_runtime";
export type PermissionCheckContractErrorCode =
  | "agent_mismatch"
  | "constraint_failed"
  | "explicit_deny"
  | "governance_blocked"
  | "invalid_policy"
  | "invalid_response"
  | "missing_context"
  | "no_allow"
  | "token_expired"
  | "token_invalid";

export interface PermissionCheckContractContext {
  agentId: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionCheckContractPolicy {
  permissionMatrix: PermissionMatrixEntry[];
}

export interface PermissionCheckContractRequest {
  agentId: string;
  resourceType: ResourceType;
  action: Action;
  resource: string;
  context: PermissionCheckContractContext;
  policy: PermissionCheckContractPolicy;
}

export interface PermissionCheckContractError {
  code: PermissionCheckContractErrorCode;
  message: string;
}

export interface PermissionCheckContractResponse {
  contractVersion: typeof PERMISSION_CHECK_CONTRACT_VERSION;
  source: PermissionCheckContractSource;
  allowed: boolean;
  decision: PermissionCheckContractDecision;
  reason: string | null;
  suggestion?: string;
  matchedRule?: Permission;
  governance?: GovernanceDecision;
  error?: PermissionCheckContractError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asPermissionCheckContractSource(
  source: unknown,
  fallback: PermissionCheckContractSource,
): PermissionCheckContractSource {
  return source === "node" || source === "python_contract" || source === "python_runtime"
    ? source
    : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function deniedPermissionCheckContractResponse(
  reason: string,
  code: PermissionCheckContractErrorCode,
  source: PermissionCheckContractSource,
): PermissionCheckContractResponse {
  return {
    contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
    source,
    allowed: false,
    decision: "deny",
    reason,
    error: {
      code,
      message: reason,
    },
  };
}

export function normalizePermissionCheckContractResponse(
  value: unknown,
  fallbackSource: PermissionCheckContractSource = "python_contract",
): PermissionCheckContractResponse {
  if (!isRecord(value)) {
    return deniedPermissionCheckContractResponse(
      "Invalid permission check contract response",
      "invalid_response",
      fallbackSource,
    );
  }

  const source = asPermissionCheckContractSource(value.source, fallbackSource);
  if (value.decision !== "allow" && value.decision !== "deny") {
    return deniedPermissionCheckContractResponse(
      "Invalid permission check contract response",
      "invalid_response",
      source,
    );
  }

  const reason = asOptionalString(value.reason) ?? null;
  const response: PermissionCheckContractResponse = {
    contractVersion: PERMISSION_CHECK_CONTRACT_VERSION,
    source,
    allowed: value.allowed === true && value.decision === "allow",
    decision: value.allowed === true && value.decision === "allow" ? "allow" : "deny",
    reason,
  };

  if (value.allowed !== true || value.decision === "deny") {
    response.allowed = false;
    response.decision = "deny";
    response.reason = reason ?? "Permission check denied";
  }

  if (typeof value.suggestion === "string") {
    response.suggestion = value.suggestion;
  }
  if (isRecord(value.matchedRule)) {
    response.matchedRule = value.matchedRule as unknown as Permission;
  }
  if (isRecord(value.governance)) {
    response.governance = value.governance as unknown as GovernanceDecision;
  }
  if (isRecord(value.error)) {
    const code =
      typeof value.error.code === "string"
        ? (value.error.code as PermissionCheckContractErrorCode)
        : "invalid_response";
    const message = asOptionalString(value.error.message) ?? response.reason ?? code;
    response.error = { code, message };
  }

  return response;
}

// ─── 审计日志 ───────────────────────────────────────────────────────────────

export const PERMISSION_MANAGEMENT_CONTRACT_VERSION = "permission-management.v1" as const;

export type PermissionManagementBoundaryOperation =
  | "role.list"
  | "role.get"
  | "role.create"
  | "role.update"
  | "policy.get"
  | "policy.assign"
  | "policy.update"
  | "token.issue"
  | "token.verify";

export type PermissionManagementBoundaryDomain = "role" | "policy" | "token" | "unknown";
export type PermissionManagementBoundarySource = "node" | "python_boundary";
export type PermissionManagementBoundaryStatus =
  | "supported"
  | "unsupported"
  | "conflict"
  | "error";
export type PermissionManagementBoundaryErrorCode =
  | "conflict"
  | "invalid_operation"
  | "invalid_request"
  | "invalid_response"
  | "node_owned"
  | "unsupported";

export interface PermissionManagementBoundaryRequest {
  operation: PermissionManagementBoundaryOperation;
  payload?: Record<string, unknown>;
}

export interface PermissionManagementBoundaryError {
  code: PermissionManagementBoundaryErrorCode;
  message: string;
}

export interface PermissionManagementBoundaryResponse {
  contractVersion: typeof PERMISSION_MANAGEMENT_CONTRACT_VERSION;
  source: PermissionManagementBoundarySource;
  operation: PermissionManagementBoundaryOperation | string | null;
  domain: PermissionManagementBoundaryDomain;
  ok: boolean;
  status: PermissionManagementBoundaryStatus;
  reason: string;
  error?: PermissionManagementBoundaryError;
}

function asPermissionManagementBoundarySource(
  source: unknown,
  fallback: PermissionManagementBoundarySource,
): PermissionManagementBoundarySource {
  return source === "node" || source === "python_boundary" ? source : fallback;
}

function asPermissionManagementBoundaryDomain(
  domain: unknown,
): PermissionManagementBoundaryDomain {
  return domain === "role" || domain === "policy" || domain === "token" || domain === "unknown"
    ? domain
    : "unknown";
}

function asPermissionManagementBoundaryStatus(
  status: unknown,
): PermissionManagementBoundaryStatus | undefined {
  return status === "supported" ||
    status === "unsupported" ||
    status === "conflict" ||
    status === "error"
    ? status
    : undefined;
}

function failedPermissionManagementBoundaryResponse(
  reason: string,
  code: PermissionManagementBoundaryErrorCode,
  source: PermissionManagementBoundarySource,
  operation: string | null = null,
  domain: PermissionManagementBoundaryDomain = "unknown",
): PermissionManagementBoundaryResponse {
  return {
    contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
    source,
    operation,
    domain,
    ok: false,
    status: code === "conflict" ? "conflict" : "error",
    reason,
    error: {
      code,
      message: reason,
    },
  };
}

export function normalizePermissionManagementBoundaryResponse(
  value: unknown,
  fallbackSource: PermissionManagementBoundarySource = "python_boundary",
): PermissionManagementBoundaryResponse {
  if (!isRecord(value)) {
    return failedPermissionManagementBoundaryResponse(
      "Invalid permission management boundary response",
      "invalid_response",
      fallbackSource,
    );
  }

  const source = asPermissionManagementBoundarySource(value.source, fallbackSource);
  const operation = typeof value.operation === "string" ? value.operation : null;
  const domain = asPermissionManagementBoundaryDomain(value.domain);
  const status = asPermissionManagementBoundaryStatus(value.status);
  const reason = asOptionalString(value.reason);

  if (!status || !reason) {
    return failedPermissionManagementBoundaryResponse(
      "Invalid permission management boundary response",
      "invalid_response",
      source,
      operation,
      domain,
    );
  }

  const ok = value.ok === true && status === "supported";
  if (value.ok === true && status !== "supported") {
    return failedPermissionManagementBoundaryResponse(
      "Invalid permission management boundary response",
      "invalid_response",
      source,
      operation,
      domain,
    );
  }

  const response: PermissionManagementBoundaryResponse = {
    contractVersion: PERMISSION_MANAGEMENT_CONTRACT_VERSION,
    source,
    operation,
    domain,
    ok,
    status: ok ? "supported" : status,
    reason,
  };

  if (!ok) {
    if (isRecord(value.error)) {
      const code =
        typeof value.error.code === "string"
          ? (value.error.code as PermissionManagementBoundaryErrorCode)
          : "invalid_response";
      const message = asOptionalString(value.error.message) ?? reason;
      response.error = { code, message };
    } else {
      response.error = {
        code: status === "unsupported" ? "unsupported" : status === "conflict" ? "conflict" : "invalid_response",
        message: reason,
      };
    }
  }

  return response;
}

export interface PermissionAuditEntry {
  id: string;
  timestamp: string;
  agentId: string;
  operation: string;
  resourceType: ResourceType;
  action: Action;
  resource: string;
  result: "allowed" | "denied" | "error";
  reason?: string;
  operator?: string;
  metadata?: Record<string, unknown>;
  governance?: GovernanceDecision;
}

export interface GovernanceDecision {
  outcome: "allowed" | "blocked" | "approval_required";
  riskLevel: RiskLevel;
  policyId: string;
  rationale: string;
  requiresAudit: boolean;
  specRefs?: string[];
}

// ─── 权限模板 ───────────────────────────────────────────────────────────────

export interface PermissionTemplate {
  templateId: string;
  templateName: string;
  description: string;
  targetRole: string;
  permissions: Permission[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── 风险评估 ───────────────────────────────────────────────────────────────

export interface RiskAssessment {
  agentId: string;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  timestamp: string;
}

export interface RiskFactor {
  category: string;
  description: string;
  severity: RiskLevel;
}

// ─── 权限冲突 ───────────────────────────────────────────────────────────────

export interface PermissionConflict {
  agentId: string;
  conflictType: "allow_deny_overlap" | "excessive_scope" | "dangerous_combination";
  permissions: Permission[];
  description: string;
  suggestion: string;
}

// ─── 权限提升请求 ─────────────────────────────────────────────────────────

export interface PermissionEscalation {
  id: string;
  agentId: string;
  reason: string;
  requestedPermissions: Permission[];
  approverList: string[];
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ─── 权限使用报告 ───────────────────────────────────────────────────────────

export interface PermissionUsageReport {
  agentId: string;
  timeRange: { from: string; to: string };
  totalChecks: number;
  allowedCount: number;
  deniedCount: number;
  resourceBreakdown: Record<ResourceType, { allowed: number; denied: number }>;
}
