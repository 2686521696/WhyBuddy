/**
 * 审计链 / 不可篡改日志 契约
 *
 * 定义审计事件类型、日志条目、验证结果、查询过滤、保留策略、
 * 异常检测、合规映射等核心类型和默认常量。
 */

// ─── 1.1 AuditEventType 枚举 & AuditSeverity / AuditCategory 类型 ──────────

export enum AuditEventType {
  DECISION_MADE = "DECISION_MADE",
  PERMISSION_GRANTED = "PERMISSION_GRANTED",
  PERMISSION_REVOKED = "PERMISSION_REVOKED",
  PERMISSION_CHECKED = "PERMISSION_CHECKED",
  GOVERNANCE_ENFORCED = "GOVERNANCE_ENFORCED",
  DATA_ACCESSED = "DATA_ACCESSED",
  AGENT_EXECUTED = "AGENT_EXECUTED",
  AGENT_FAILED = "AGENT_FAILED",
  CONFIG_CHANGED = "CONFIG_CHANGED",
  USER_LOGIN = "USER_LOGIN",
  USER_LOGOUT = "USER_LOGOUT",
  ESCALATION_REQUESTED = "ESCALATION_REQUESTED",
  ESCALATION_APPROVED = "ESCALATION_APPROVED",
  AUDIT_QUERY = "AUDIT_QUERY",
  AUDIT_EXPORT = "AUDIT_EXPORT",
  AUDIT_ARCHIVE = "AUDIT_ARCHIVE",
  AUDIT_DELETE = "AUDIT_DELETE",
  ANOMALY_DETECTED = "ANOMALY_DETECTED",
}

export type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AuditCategory = "security" | "compliance" | "operational";

export const AUDIT_ACTOR_TYPES = ["user", "agent", "system"] as const;
export const AUDIT_RESULTS = ["success", "failure", "denied", "error"] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export type AuditResult = (typeof AUDIT_RESULTS)[number];

// ─── 1.2 AuditEventTypeDefinition & 默认事件类型注册表 ─────────────────────

export interface AuditEventTypeDefinition {
  type: AuditEventType;
  severity: AuditSeverity;
  category: AuditCategory;
  description: string;
  version: number;
}

export const DEFAULT_EVENT_TYPE_REGISTRY: Record<AuditEventType, AuditEventTypeDefinition> = {
  [AuditEventType.DECISION_MADE]: {
    type: AuditEventType.DECISION_MADE,
    severity: "CRITICAL",
    category: "operational",
    description: "A decision was made in the workflow",
    version: 1,
  },
  [AuditEventType.PERMISSION_GRANTED]: {
    type: AuditEventType.PERMISSION_GRANTED,
    severity: "CRITICAL",
    category: "security",
    description: "Permission was granted to an agent or user",
    version: 1,
  },
  [AuditEventType.PERMISSION_REVOKED]: {
    type: AuditEventType.PERMISSION_REVOKED,
    severity: "CRITICAL",
    category: "security",
    description: "Permission was revoked from an agent or user",
    version: 1,
  },
  [AuditEventType.PERMISSION_CHECKED]: {
    type: AuditEventType.PERMISSION_CHECKED,
    severity: "INFO",
    category: "security",
    description: "A permission check was evaluated",
    version: 1,
  },
  [AuditEventType.GOVERNANCE_ENFORCED]: {
    type: AuditEventType.GOVERNANCE_ENFORCED,
    severity: "CRITICAL",
    category: "security",
    description: "A high-risk governance policy blocked or gated an operation",
    version: 1,
  },
  [AuditEventType.DATA_ACCESSED]: {
    type: AuditEventType.DATA_ACCESSED,
    severity: "CRITICAL",
    category: "compliance",
    description: "Sensitive data was accessed",
    version: 1,
  },
  [AuditEventType.AGENT_EXECUTED]: {
    type: AuditEventType.AGENT_EXECUTED,
    severity: "INFO",
    category: "operational",
    description: "An agent executed a task",
    version: 1,
  },
  [AuditEventType.AGENT_FAILED]: {
    type: AuditEventType.AGENT_FAILED,
    severity: "WARNING",
    category: "operational",
    description: "An agent failed to execute a task",
    version: 1,
  },
  [AuditEventType.CONFIG_CHANGED]: {
    type: AuditEventType.CONFIG_CHANGED,
    severity: "WARNING",
    category: "security",
    description: "System configuration was changed",
    version: 1,
  },
  [AuditEventType.USER_LOGIN]: {
    type: AuditEventType.USER_LOGIN,
    severity: "INFO",
    category: "security",
    description: "A user logged in",
    version: 1,
  },
  [AuditEventType.USER_LOGOUT]: {
    type: AuditEventType.USER_LOGOUT,
    severity: "INFO",
    category: "security",
    description: "A user logged out",
    version: 1,
  },
  [AuditEventType.ESCALATION_REQUESTED]: {
    type: AuditEventType.ESCALATION_REQUESTED,
    severity: "WARNING",
    category: "security",
    description: "A permission escalation was requested",
    version: 1,
  },
  [AuditEventType.ESCALATION_APPROVED]: {
    type: AuditEventType.ESCALATION_APPROVED,
    severity: "CRITICAL",
    category: "security",
    description: "A permission escalation was approved",
    version: 1,
  },
  [AuditEventType.AUDIT_QUERY]: {
    type: AuditEventType.AUDIT_QUERY,
    severity: "INFO",
    category: "compliance",
    description: "Audit log was queried",
    version: 1,
  },
  [AuditEventType.AUDIT_EXPORT]: {
    type: AuditEventType.AUDIT_EXPORT,
    severity: "INFO",
    category: "compliance",
    description: "Audit log was exported",
    version: 1,
  },
  [AuditEventType.AUDIT_ARCHIVE]: {
    type: AuditEventType.AUDIT_ARCHIVE,
    severity: "INFO",
    category: "compliance",
    description: "Audit log was archived",
    version: 1,
  },
  [AuditEventType.AUDIT_DELETE]: {
    type: AuditEventType.AUDIT_DELETE,
    severity: "CRITICAL",
    category: "compliance",
    description: "Audit log entries were deleted",
    version: 1,
  },
  [AuditEventType.ANOMALY_DETECTED]: {
    type: AuditEventType.ANOMALY_DETECTED,
    severity: "WARNING",
    category: "security",
    description: "An anomaly was detected in audit events",
    version: 1,
  },
};

// ─── 1.3 AuditEvent 接口 ───────────────────────────────────────────────────

export interface AuditEvent {
  eventId: string;
  eventType: AuditEventType;
  timestamp: number;
  actor: {
    type: AuditActorType;
    id: string;
    name?: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    name?: string;
  };
  result: AuditResult;
  context: {
    sessionId?: string;
    requestId?: string;
    sourceIp?: string;
    userAgent?: string;
    organizationId?: string;
  };
  metadata?: Record<string, unknown>;
  lineageId?: string;
}

export type AuditEventDraft = Omit<AuditEvent, "eventId" | "timestamp" | "context"> & {
  context?: AuditEvent["context"];
};

export interface AuditEventValidationResult {
  valid: boolean;
  errors: string[];
}

const AUDIT_EVENT_TYPES = Object.values(AuditEventType);
const AUDIT_CONTEXT_KEYS = [
  "sessionId",
  "requestId",
  "sourceIp",
  "userAgent",
  "organizationId",
] as const;

const AUDIT_ACTOR_KEYS = ["type", "id", "name"] as const;
const AUDIT_RESOURCE_KEYS = ["type", "id", "name"] as const;

export function validateAuditEventDraft(input: unknown): AuditEventValidationResult {
  const errors: string[] = [];
  validateAuditEventCore(input, { requireEnvelope: false, errors });
  return { valid: errors.length === 0, errors };
}

export function validateAuditEvent(input: unknown): AuditEventValidationResult {
  const errors: string[] = [];
  validateAuditEventCore(input, { requireEnvelope: true, errors });
  return { valid: errors.length === 0, errors };
}

export function assertValidAuditEventDraft(input: unknown): asserts input is AuditEventDraft {
  const result = validateAuditEventDraft(input);
  if (!result.valid) {
    throw new Error(`Invalid audit event: ${result.errors.join("; ")}`);
  }
}

function validateAuditEventCore(
  input: unknown,
  options: { requireEnvelope: boolean; errors: string[] },
): void {
  const { requireEnvelope, errors } = options;
  if (!isPlainRecord(input)) {
    errors.push("event must be an object");
    return;
  }

  if (requireEnvelope) {
    if (!isNonEmptyString(input.eventId)) {
      errors.push("eventId must be a non-empty string");
    }
    if (!isNonNegativeFiniteNumber(input.timestamp)) {
      errors.push("timestamp must be a non-negative finite number");
    }
  }

  if (!AUDIT_EVENT_TYPES.includes(input.eventType as AuditEventType)) {
    errors.push("eventType must be a known AuditEventType");
  }

  validateActor(input.actor, errors);

  if (!isNonEmptyString(input.action)) {
    errors.push("action must be a non-empty string");
  }

  validateResource(input.resource, errors);

  if (!AUDIT_RESULTS.includes(input.result as AuditResult)) {
    errors.push("result must be one of success, failure, denied, error");
  }

  if (input.context === undefined) {
    if (requireEnvelope) {
      errors.push("context must be an object");
    }
  } else {
    validateContext(input.context, errors);
  }

  if (input.metadata !== undefined && !isPlainRecord(input.metadata)) {
    errors.push("metadata must be an object when provided");
  }

  if (input.lineageId !== undefined && typeof input.lineageId !== "string") {
    errors.push("lineageId must be a string when provided");
  }
}

function validateActor(actor: unknown, errors: string[]): void {
  if (!isPlainRecord(actor)) {
    errors.push("actor must be an object");
    return;
  }

  rejectUnknownKeys(actor, AUDIT_ACTOR_KEYS, "actor", errors);

  if (!AUDIT_ACTOR_TYPES.includes(actor.type as AuditActorType)) {
    errors.push("actor.type must be one of user, agent, system");
  }

  if (!isNonEmptyString(actor.id)) {
    errors.push("actor.id must be a non-empty string");
  }

  if (actor.name !== undefined && typeof actor.name !== "string") {
    errors.push("actor.name must be a string when provided");
  }
}

function validateResource(resource: unknown, errors: string[]): void {
  if (!isPlainRecord(resource)) {
    errors.push("resource must be an object");
    return;
  }

  rejectUnknownKeys(resource, AUDIT_RESOURCE_KEYS, "resource", errors);

  if (!isNonEmptyString(resource.type)) {
    errors.push("resource.type must be a non-empty string");
  }

  if (!isNonEmptyString(resource.id)) {
    errors.push("resource.id must be a non-empty string");
  }

  if (resource.name !== undefined && typeof resource.name !== "string") {
    errors.push("resource.name must be a string when provided");
  }
}

function validateContext(context: unknown, errors: string[]): void {
  if (!isPlainRecord(context)) {
    errors.push("context must be an object");
    return;
  }

  rejectUnknownKeys(context, AUDIT_CONTEXT_KEYS, "context", errors);

  for (const key of AUDIT_CONTEXT_KEYS) {
    if (context[key] !== undefined && typeof context[key] !== "string") {
      errors.push(`context.${key} must be a string when provided`);
    }
  }
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  pathName: string,
  errors: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(`${pathName}.${key} is not part of the audit event contract`);
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// ─── 1.4 AuditLogEntry 接口 ────────────────────────────────────────────────

export interface AuditLogEntry {
  entryId: string;
  sequenceNumber: number;
  eventId: string;
  event: AuditEvent;
  previousHash: string;
  currentHash: string;
  nonce: string;
  timestamp: {
    system: number;
    trusted?: number;
    skew?: number;
  };
  signature: string;
}

// ─── 1.5 VerificationResult & VerificationError ────────────────────────────

export interface VerificationResult {
  valid: boolean;
  checkedRange: { start: number; end: number };
  totalEntries: number;
  errors: VerificationError[];
  verifiedAt: number;
}

export interface VerificationError {
  entryId: string;
  sequenceNumber: number;
  errorType:
    | "hash_mismatch"
    | "chain_break"
    | "signature_invalid"
    | "timestamp_regression"
    | "sequence_gap"
    | "entry_missing";
  expected?: string;
  actual?: string;
  message: string;
}

// ─── 1.6 AuditQueryFilters / PageOptions / AuditQueryResult ────────────────

export interface AuditQueryFilters {
  eventType?: AuditEventType | AuditEventType[];
  actorId?: string;
  actorType?: "user" | "agent" | "system";
  resourceType?: string;
  resourceId?: string;
  result?: "success" | "failure" | "denied" | "error";
  severity?: AuditSeverity;
  category?: AuditCategory;
  timeRange?: { start: number; end: number };
  keyword?: string;
}

export interface PageOptions {
  pageSize: number;
  pageNum: number;
}

export interface AuditQueryResult {
  entries: AuditLogEntry[];
  total: number;
  page: PageOptions;
  chainValid?: boolean;
}

export interface AuditQueryProxySuccess extends AuditQueryResult {
  status: "ok";
}

export type AuditQueryProxyErrorCode = "forbidden" | "audit_query_error";

export interface AuditQueryProxyFailure {
  status: "forbidden" | "error";
  error: {
    code: AuditQueryProxyErrorCode;
    message: string;
  };
  page: PageOptions;
}

export type AuditQueryProxyResult = AuditQueryProxySuccess | AuditQueryProxyFailure;

// ─── 1.7 RetentionPolicy & 默认保留策略 ────────────────────────────────────

export interface RetentionPolicy {
  severity: AuditSeverity;
  retentionDays: number;
  archiveAfterDays: number;
  deleteAfterDays: number;
}

export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  { severity: "CRITICAL", retentionDays: 2555, archiveAfterDays: 365, deleteAfterDays: 2555 },
  { severity: "WARNING", retentionDays: 1095, archiveAfterDays: 180, deleteAfterDays: 1095 },
  { severity: "INFO", retentionDays: 365, archiveAfterDays: 90, deleteAfterDays: 365 },
];

// ─── 1.8 AnomalyAlert & AnomalyRule ────────────────────────────────────────

export interface AnomalyAlert {
  alertId: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  anomalyType: string;
  description: string;
  affectedEvents: string[];
  suggestedActions: string[];
  detectedAt: number;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
}

export interface AnomalyRule {
  ruleId: string;
  name: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  threshold: number;
  timeWindowMs: number;
  eventTypes: AuditEventType[];
  enabled: boolean;
}

// ─── 1.9 ComplianceFramework / ComplianceRequirement / ComplianceReport / ComplianceGap ─

export type ComplianceFramework = "SOC2" | "GDPR" | "PCI-DSS" | "HIPAA" | "ISO27001";

export interface ComplianceRequirement {
  requirementId: string;
  description: string;
  requiredEventTypes: AuditEventType[];
  minimumRetentionDays: number;
}

export interface ComplianceReport {
  framework: ComplianceFramework;
  timeRange: { start: number; end: number };
  generatedAt: number;
  coverageScore: number;
  totalRequirements: number;
  coveredRequirements: number;
  gaps: ComplianceGap[];
  eventStatistics: Record<AuditEventType, number>;
  riskEvents: AuditLogEntry[];
  reportHash: string;
}

export interface ComplianceGap {
  requirementId: string;
  description: string;
  missingEventTypes: AuditEventType[];
  recommendation: string;
}
