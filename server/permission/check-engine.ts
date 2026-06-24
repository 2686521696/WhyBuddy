/**
 * PermissionCheckEngine — 运行时权限检查引擎
 *
 * 检查流程：
 * 1. 验证 JWT 令牌签名和有效期
 * 2. 从令牌 payload 提取权限矩阵
 * 3. 查找 LRU 缓存
 * 4. 匹配 deny 规则（优先级最高）
 * 5. 匹配 allow 规则
 * 6. 应用约束条件（委托给对应的 ResourceChecker）
 * 7. 记录审计日志
 * 8. 缓存并返回结果
 */

import type {
  Action,
  GovernanceDecision,
  PermissionCheckContractResponse,
  PermissionCheckResult,
  PermissionMatrixEntry,
  ResourceType,
} from "../../shared/permission/contracts.js";
import { normalizePermissionCheckContractResponse } from "../../shared/permission/contracts.js";
import type { ResourceChecker } from "./checkers/filesystem-checker.js";
import type { TokenService } from "./token-service.js";
import { InvalidTokenError, TokenExpiredError } from "./token-service.js";
import {
  evaluateGovernanceDecision,
  isGovernanceBlockingDecision,
} from "./governance-policy.js";

// ─── AuditLogger interface (optional dependency) ────────────────────────────

export interface AuditLogger {
  log(entry: {
    agentId: string;
    operation: string;
    resourceType: ResourceType;
    action: Action;
    resource: string;
    result: "allowed" | "denied" | "approval_required" | "error";
    reason?: string;
    governance?: GovernanceDecision;
    metadata?: Record<string, unknown>;
  }): void;
}

// ─── LRU Cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  result: PermissionCheckResult;
  createdAt: number;
}

const DEFAULT_CACHE_SIZE = 10_000;
const DEFAULT_CACHE_TTL_MS = 60_000; // 60 seconds

function getCacheSize(): number {
  const envVal = typeof process !== "undefined"
    ? process.env.PERMISSION_CACHE_SIZE
    : undefined;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_SIZE;
}

function getCacheTtlMs(): number {
  const envVal = typeof process !== "undefined"
    ? process.env.PERMISSION_CACHE_TTL_MS
    : undefined;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_TTL_MS;
}

/**
 * Simple LRU cache backed by a Map (insertion-order iteration).
 * Supports TTL-based expiration and capacity eviction.
 */
export class LRUCache {
  private cache = new Map<string, CacheEntry>();
  readonly capacity: number;
  readonly ttlMs: number;

  constructor(capacity?: number, ttlMs?: number) {
    this.capacity = capacity ?? getCacheSize();
    this.ttlMs = ttlMs ?? getCacheTtlMs();
  }

  get(key: string): PermissionCheckResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // TTL check
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  set(key: string, result: PermissionCheckResult): void {
    // If key exists, delete first to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.capacity) {
      let oldest: string | undefined;
      this.cache.forEach((_, k) => {
        if (oldest === undefined) oldest = k;
      });
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { result, createdAt: Date.now() });
  }

  /** Remove all entries whose key starts with the given prefix */
  invalidateByPrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── PermissionCheckEngine ──────────────────────────────────────────────────

export class PermissionCheckEngine {
  private cache: LRUCache;

  constructor(
    private tokenService: TokenService,
    private auditLogger?: AuditLogger,
    private checkers: Map<ResourceType, ResourceChecker> = new Map(),
  ) {
    this.cache = new LRUCache();
  }

  /**
   * Core permission check.
   *
   * Flow: JWT verify → extract matrix → cache lookup → deny-first match →
   *       allow match → constraint check → audit log → cache & return
   */
  checkPermission(
    agentId: string,
    resourceType: ResourceType,
    action: Action,
    resource: string,
    token: string,
  ): PermissionCheckResult {
    // 1. Verify JWT token
    let matrix: PermissionMatrixEntry[];
    try {
      const payload = this.tokenService.verifyToken(token);
      // Ensure token belongs to the requesting agent
      if (payload.agentId !== agentId) {
        const result: PermissionCheckResult = {
          allowed: false,
          reason: "Token agentId mismatch",
          suggestion: "Use a token issued for this agent",
        };
        this.audit(agentId, resourceType, action, resource, "denied", result.reason);
        return result;
      }
      matrix = payload.permissionMatrix;
    } catch (err) {
      const reason =
        err instanceof TokenExpiredError
          ? "Token expired"
          : err instanceof InvalidTokenError
            ? "Invalid token"
            : "Token verification failed";
      const suggestion =
        err instanceof TokenExpiredError
          ? "Refresh the token using tokenService.refreshToken()"
          : "Provide a valid capability token";
      const result: PermissionCheckResult = { allowed: false, reason, suggestion };
      this.audit(agentId, resourceType, action, resource, "denied", reason);
      return result;
    }

    // 2. Cache lookup
    const cacheKey = `${agentId}:${resourceType}:${action}:${resource}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // 3. Deny-first matching — highest priority
    const denyEntries = matrix.filter(
      (e) => e.effect === "deny" && e.resourceType === resourceType,
    );
    for (const deny of denyEntries) {
      if (deny.actions.includes(action)) {
        const result: PermissionCheckResult = {
          allowed: false,
          reason: `Denied by explicit deny rule for ${resourceType}:${action}`,
          matchedRule: {
            resourceType: deny.resourceType,
            action,
            constraints: deny.constraints,
            effect: "deny",
          },
        };
        this.cache.set(cacheKey, result);
        this.audit(agentId, resourceType, action, resource, "denied", result.reason);
        return result;
      }
    }

    // 4. Allow matching
    const allowEntries = matrix.filter(
      (e) => e.effect === "allow" && e.resourceType === resourceType,
    );
    const matchedAllow = allowEntries.find((e) => e.actions.includes(action));

    if (!matchedAllow) {
      const result: PermissionCheckResult = {
        allowed: false,
        reason: `No allow rule found for ${resourceType}:${action}`,
        suggestion: `Request permission for ${resourceType}:${action}`,
      };
      this.cache.set(cacheKey, result);
      this.audit(agentId, resourceType, action, resource, "denied", result.reason);
      return result;
    }

    // 5. Constraint checking via ResourceChecker
    const checker = this.checkers.get(resourceType);
    if (checker) {
      const constraintsPassed = checker.checkConstraints(action, resource, matchedAllow.constraints);
      if (!constraintsPassed) {
        const result: PermissionCheckResult = {
          allowed: false,
          reason: `Constraint check failed for ${resourceType}:${action} on "${resource}"`,
          suggestion: "Verify the resource matches the allowed constraints",
          matchedRule: {
            resourceType: matchedAllow.resourceType,
            action,
            constraints: matchedAllow.constraints,
            effect: "allow",
          },
        };
        this.cache.set(cacheKey, result);
        this.audit(agentId, resourceType, action, resource, "denied", result.reason);
        return result;
      }
    }

    const governance = evaluateGovernanceDecision(resourceType, action, resource);
    if (governance && isGovernanceBlockingDecision(governance)) {
      const blockingGovernance = governance;
      const result: PermissionCheckResult = {
        allowed: false,
        reason: blockingGovernance.rationale,
        suggestion: "Submit the operation for manual approval or use a lower-risk path",
        matchedRule: {
          resourceType: matchedAllow.resourceType,
          action,
          constraints: matchedAllow.constraints,
          effect: "allow",
        },
        governance: blockingGovernance,
      };
      this.cache.set(cacheKey, result);
      this.audit(agentId, resourceType, action, resource, "denied", result.reason, blockingGovernance, {
        governancePolicyId: blockingGovernance.policyId,
      });
      return result;
    }

    // 6. Allowed
    const result: PermissionCheckResult = {
      allowed: true,
      matchedRule: {
        resourceType: matchedAllow.resourceType,
        action,
        constraints: matchedAllow.constraints,
        effect: "allow",
      },
    };
    this.cache.set(cacheKey, result);
    this.audit(agentId, resourceType, action, resource, "allowed");
    return result;
  }

  /**
   * Batch permission check. Calls checkPermission for each request.
   */
  checkPermissions(
    checks: Array<{
      agentId: string;
      resourceType: ResourceType;
      action: Action;
      resource: string;
    }>,
    token: string,
  ): PermissionCheckResult[] {
    return checks.map((c) =>
      this.checkPermission(c.agentId, c.resourceType, c.action, c.resource, token),
    );
  }

  /**
   * Invalidate all cache entries for a given agent.
   */
  invalidateCache(agentId: string): void {
    this.cache.invalidateByPrefix(`${agentId}:`);
  }

  /** Expose cache for testing */
  getCacheSize(): number {
    return this.cache.size;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private audit(
    agentId: string,
    resourceType: ResourceType,
    action: Action,
    resource: string,
    result: "allowed" | "denied" | "error",
    reason?: string,
    governance?: GovernanceDecision,
    metadata?: Record<string, unknown>,
  ): void {
    if (!this.auditLogger) return;
    try {
      this.auditLogger.log({
        agentId,
        operation: "check",
        resourceType,
        action,
        resource,
        result,
        reason,
        governance,
        metadata,
      });
    } catch {
      // Audit failures must not block permission checks
    }
  }
}

export function toPermissionCheckContractResponse(
  result: PermissionCheckResult,
): PermissionCheckContractResponse {
  return normalizePermissionCheckContractResponse(
    {
      source: "node",
      allowed: result.allowed,
      decision: result.allowed ? "allow" : "deny",
      reason: result.reason ?? null,
      suggestion: result.suggestion,
      matchedRule: result.matchedRule,
      governance: result.governance,
    },
    "node",
  );
}

export function toPermissionCheckResultFromContractResponse(
  value: unknown,
): PermissionCheckResult {
  const response = normalizePermissionCheckContractResponse(value, "python_runtime");
  const result: PermissionCheckResult = {
    allowed: response.allowed,
  };

  if (response.reason !== null) {
    result.reason = response.reason;
  }
  if (response.suggestion) {
    result.suggestion = response.suggestion;
  }
  if (response.matchedRule) {
    result.matchedRule = response.matchedRule;
  }
  if (response.governance) {
    result.governance = response.governance;
  }

  return result;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function toPermissionAuditFromPythonHook(
  value: unknown,
): {
  agentId: string;
  operation: string;
  resourceType: ResourceType;
  action: Action;
  resource: string;
  result: "allowed" | "denied" | "approval_required" | "error";
  reason?: string;
  governance?: GovernanceDecision;
  metadata?: Record<string, unknown>;
} | null {
  if (!isRecord(value)) return null;
  const res = value.result;
  if (res !== "allowed" && res !== "denied" && res !== "approval_required" && res !== "error") {
    return null;
  }
  return {
    agentId: typeof value.actor === "string" ? value.actor : typeof value.agentId === "string" ? value.agentId : "unknown",
    operation: "check",
    resourceType: (value.resourceType as ResourceType) || ("filesystem" as ResourceType),
    action: (value.action as Action) || ("read" as Action),
    resource: typeof value.resource === "string" ? value.resource : "",
    result: res as any,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    governance: isRecord(value.governance) ? (value.governance as unknown as GovernanceDecision) : undefined,
    metadata: { pythonSource: value.source, policy: value.policy, risk: value.risk },
  };
}

// ─── Permission/Audit Policy Store Cutover 101 (thin Node bridge, advisory only) ─────────────────
// Python supplies decision envelope. Node owns durable policy store, audit store,
// external audit platform, route auth, retention, enforcement. Never promotes memory to durable.

export type PermissionAuditPolicyStoreCutoverDecision =
  | "ready"
  | "blocked"
  | "degraded"
  | "unsupported"
  | "diagnostic-only";

export interface PermissionAuditPolicyStoreCutoverResult {
  decision: PermissionAuditPolicyStoreCutoverDecision;
  decisions: { policyStore: string; auditStore: string; externalAudit: string };
  canParticipate: { policyStore: boolean; auditStore: boolean; externalAudit: boolean };
  contractVersion?: string;
  provenance?: string;
  area?: string;
  boundaries?: Record<string, string>;
  runtime?: { owner: string; mode: string; [k: string]: string };
  ok?: boolean;
  blocked?: boolean;
  productionTakeover?: boolean;
  diagnostics?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export function validatePermissionAuditPolicyStoreCutover(
  payload: unknown,
): PermissionAuditPolicyStoreCutoverResult {
  if (!payload || typeof payload !== "object") {
    return {
      decision: "unsupported",
      decisions: { policyStore: "unsupported", auditStore: "unsupported", externalAudit: "unsupported" },
      canParticipate: { policyStore: false, auditStore: false, externalAudit: false },
      contractVersion: "permission-audit-policy-store-cutover.v1",
      provenance: "node-fallback",
      ok: false,
      error: { code: "invalid", message: "Invalid cutover payload" },
    };
  }
  const p = payload as Record<string, unknown>;
  const rawDecision = (p.decision as string) || "unsupported";
  const normalized: PermissionAuditPolicyStoreCutoverDecision =
    rawDecision === "ready" ||
    rawDecision === "blocked" ||
    rawDecision === "degraded" ||
    rawDecision === "unsupported" ||
    rawDecision === "diagnostic-only"
      ? (rawDecision as PermissionAuditPolicyStoreCutoverDecision)
      : "unsupported";
  const decisions = (p.decisions as any) || {
    policyStore: "unsupported",
    auditStore: "unsupported",
    externalAudit: "unsupported",
  };
  const canParticipate = (p.canParticipate as any) || {
    policyStore: false,
    auditStore: false,
    externalAudit: false,
  };
  return {
    decision: normalized,
    decisions,
    canParticipate,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : "permission-audit-policy-store-cutover.v1",
    provenance: typeof p.provenance === "string" ? p.provenance : "python-permission-audit-policy-store-cutover",
    area: typeof p.area === "string" ? p.area : undefined,
    boundaries: (p.boundaries as Record<string, string>) || undefined,
    runtime: (p.runtime as any) || { owner: "node", mode: "local_fallback" },
    ok: p.ok === true || normalized === "ready",
    ...(p.blocked ? { blocked: true } : {}),
    ...(p.productionTakeover !== undefined ? { productionTakeover: !!p.productionTakeover } : { productionTakeover: false }),
    ...(p.diagnostics ? { diagnostics: p.diagnostics as Record<string, unknown> } : {}),
    ...(p.error ? { error: p.error as { code: string; message: string } } : {}),
  };
}

// ─── Permission/Audit Durable Store Boundary 103 (thin Node bridge, advisory only) ─────────────────
// Python supplies boundary decision classifying python-owned (decision slice only),
// node-retained (durable stores/retention), external-owned (audit platform).
// Node retains all durable audit/policy stores. Do not treat hooks/sink/export as durable ownership.

export type PermissionAuditDurableBoundaryStatus =
  | "ready"
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope"
  | "blocked"
  | "skipped-live";

export interface PermissionAuditDurableStoreBoundaryResult {
  status: PermissionAuditDurableBoundaryStatus;
  contractVersion?: string;
  provenance?: string;
  ok?: boolean;
  productionTakeover?: boolean;
  ownership?: Record<string, string>;
  boundaries?: Record<string, string>;
  runtime?: { owner: string; mode: string; [k: string]: unknown };
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export function validatePermissionAuditDurableStoreBoundary(
  payload: unknown,
): PermissionAuditDurableStoreBoundaryResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "blocked",
      contractVersion: "permission-audit-durable-store-boundary.v1",
      provenance: "node-fallback",
      ok: false,
      productionTakeover: false,
      ownership: {
        policyStore: "node-retained",
        auditDurableStore: "node-retained",
        externalAuditPlatform: "external-owned",
        durableDecision: "blocked",
      },
      error: { code: "invalid", message: "Invalid durable boundary payload" },
    };
  }
  const p = payload as Record<string, unknown>;
  const rawStatus = (p.status as string) || "unsupported";
  const status = (
    ["ready", "python-owned", "node-retained", "external-owned", "out-of-scope", "blocked", "skipped-live"].includes(rawStatus)
      ? rawStatus
      : "blocked"
  ) as PermissionAuditDurableBoundaryStatus;

  const ownership = (p.ownership as Record<string, string>) || {
    policyStore: "node-retained",
    auditDurableStore: "node-retained",
    externalAuditPlatform: "external-owned",
    retention: "node-retained",
    durableDecision: status === "python-owned" ? "python-owned" : "node-retained",
  };

  return {
    status,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : "permission-audit-durable-store-boundary.v1",
    provenance: typeof p.provenance === "string" ? p.provenance : "python-permission-audit-durable-store-boundary-103",
    ok: p.ok === true || status === "python-owned" || status === "ready",
    productionTakeover: p.productionTakeover === true ? true : false,
    ownership,
    boundaries: (p.boundaries as Record<string, string>) || undefined,
    runtime: (p.runtime as any) || { owner: "node", mode: "local_fallback" },
    ...(p.error ? { error: p.error as { code: string; message: string } } : {}),
    ...(p.metadata ? { metadata: p.metadata as Record<string, unknown> } : {}),
  };
}

// ─── Permission/Audit Production Ownership Closure 102 ─────────────────────────────────────────────
// Consumes python ownership classification for durable boundary context. Node/external retain stores.

export type PermissionAuditOwnershipStatus = "success" | "failed" | "degraded" | "node-fallback";

export interface PermissionAuditProductionOwnershipClosureResult {
  status: PermissionAuditOwnershipStatus;
  contractVersion?: string;
  provenance?: string;
  ok?: boolean;
  productionTakeover?: boolean;
  ownership?: Record<string, string>;
  nodeBoundaries?: Record<string, string>;
  area?: string;
  simulate?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export function validatePermissionAuditProductionOwnershipClosure(
  payload: unknown,
): PermissionAuditProductionOwnershipClosureResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "node-fallback",
      contractVersion: "permission-audit.production-ownership-closure.v1",
      provenance: "node-fallback",
      ok: true,
      productionTakeover: false,
      ownership: {
        policyStore: "node-retained",
        auditDurableStore: "node-retained",
        externalAuditPlatform: "external-owned",
        durableDecision: "python-owned",
      },
    };
  }
  const p = payload as Record<string, unknown>;
  const rawStatus = (p.status as string) || "success";
  const status: PermissionAuditOwnershipStatus =
    rawStatus === "success" || rawStatus === "failed" || rawStatus === "degraded"
      ? (rawStatus as PermissionAuditOwnershipStatus)
      : "node-fallback";

  return {
    status,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : "permission-audit.production-ownership-closure.v1",
    provenance: typeof p.provenance === "string" ? p.provenance : "python-permission-audit-production-ownership-closure-102",
    ok: p.ok === true || status === "success" || status === "node-fallback",
    productionTakeover: !!p.productionTakeover,
    ownership: (p.ownership as Record<string, string>) || undefined,
    nodeBoundaries: (p.nodeBoundaries as Record<string, string>) || undefined,
    area: typeof p.area === "string" ? p.area : undefined,
    ...(p.simulate ? { simulate: p.simulate as Record<string, unknown> } : {}),
    ...(p.error ? { error: p.error as { code: string; message: string } } : {}),
  };
}

// ─── Permission Policy Store Takeover 104 (thin Node bridge, advisory only) ─────────────────
// Python supplies policy ownership classification and one deterministic policy decision/read slice.
// policyStore (durable CRUD, versioning, history, retention) remains node-retained.
// Only bounded decision/read slice advisory from python; never durable store ownership.
// Retained policy store responsibilities remain explicitly named in envelopes.

export type PermissionPolicyStoreTakeoverStatus =
  | "ready"
  | "python-owned"
  | "node-retained"
  | "external-owned"
  | "out-of-scope"
  | "blocked"
  | "skipped-live";

export interface PermissionPolicyStoreTakeoverResult {
  status: PermissionPolicyStoreTakeoverStatus;
  contractVersion?: string;
  provenance?: string;
  ok?: boolean;
  productionTakeover?: boolean;
  ownership?: Record<string, string>;
  boundaries?: Record<string, string>;
  runtime?: { owner: string; mode: string; [k: string]: unknown };
  error?: { code: string; message: string };
  retainedResponsibilities?: string[];
  area?: string;
  reason?: string;
  fallback?: string;
}

export function validatePermissionPolicyStoreTakeover(
  payload: unknown,
): PermissionPolicyStoreTakeoverResult {
  if (!payload || typeof payload !== "object") {
    return {
      status: "blocked",
      contractVersion: "permission-policy-store-takeover.v1",
      provenance: "node-fallback",
      ok: false,
      productionTakeover: false,
      ownership: {
        policyStore: "node-retained",
        policyDecisionSlice: "node-retained",
        durablePolicyRead: "node-retained",
      },
      error: { code: "invalid", message: "Invalid policy store takeover payload" },
    };
  }
  const p = payload as Record<string, unknown>;
  const rawStatus = (p.status as string) || "ready";
  const status = (
    ["ready", "python-owned", "node-retained", "external-owned", "out-of-scope", "blocked", "skipped-live"].includes(rawStatus)
      ? rawStatus
      : "blocked"
  ) as PermissionPolicyStoreTakeoverStatus;

  const ownership = (p.ownership as Record<string, string>) || {
    policyStore: "node-retained",
    policyDecisionSlice: status === "python-owned" ? "python-owned" : "node-retained",
    durablePolicyRead: "node-retained",
  };

  return {
    status,
    contractVersion: typeof p.contractVersion === "string" ? p.contractVersion : "permission-policy-store-takeover.v1",
    provenance: typeof p.provenance === "string" ? p.provenance : "python-permission-policy-store-takeover-104",
    ok: p.ok === true || status === "python-owned" || status === "ready",
    productionTakeover: p.productionTakeover === true ? true : false,
    ownership,
    boundaries: (p.boundaries as Record<string, string>) || undefined,
    runtime: (p.runtime as any) || { owner: "node", mode: "local_fallback" },
    ...(p.error ? { error: p.error as { code: string; message: string } } : {}),
    ...(p.retainedResponsibilities ? { retainedResponsibilities: p.retainedResponsibilities as string[] } : {}),
    ...(typeof p.area === "string" ? { area: p.area } : {}),
    ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
    ...(typeof p.fallback === "string" ? { fallback: p.fallback } : {}),
  };
}
