import {
  normalizeWebAigcHitlFormData,
  readWebAigcHitlFieldDefinitions,
  type MissionRecord,
} from "../../shared/mission/contracts.js";
import type { SourceType } from "../../shared/rag/contracts.js";
import type {
  StoredWebAigcRuntimeState,
  WebAigcEdgeSchema,
  WebAigcEdgeTransitionRecord,
  WebAigcGraphCheckpoint,
  WebAigcGraphDefinition,
  WebAigcGraphInstance,
  WebAigcNodeRunRecord,
  WebAigcNodeSchema,
} from "../../shared/workflow-domain.js";
import {
  isTerminalWebAigcStatus,
  toCubeWorkflowStatus,
  toWebAigcNodeRunStatus,
  toWebAigcRuntimeStatus,
} from "../../shared/workflow-domain.js";
import type {
  WorkflowNodeAdapter,
  WorkflowNodeAdapterResult,
  WorkflowNodeExecutionContext,
} from "../../shared/workflow-runtime-engine.js";
import type {
  FinalWorkflowReportRecord,
  TaskRecord,
  WorkflowRecord,
  WorkflowRuntime,
} from "../../shared/workflow-runtime.js";
import type {
  WorkflowOrganizationNode,
  WorkflowOrganizationSnapshot,
} from "../../shared/organization-schema.js";
import {
  type ChatNodeAdapterDeps,
  type ChatNodeDocumentSearchInput,
  executeChatNode,
  type ChatNodeMessage,
  type ChatNodeInput,
  type ChatNodeType,
} from "../routes/node-adapters/chat-node-adapter.js";
import {
  evaluateRuntimeConditionExpression,
  evaluateConditionRules,
  type ConditionRule,
  type ConditionRelation,
} from "./web-aigc-controlflow.js";
import { serverRuntime } from "../runtime/server-runtime.js";

function nowIso(): string {
  return new Date().toISOString();
}

function computeDurationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | undefined {
  if (!startedAt || !completedAt) {
    return undefined;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }
  return Math.max(0, end - start);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const WEB_AIGC_RUNTIME_RELATION_LINK_PATHS = [
  "workflowId",
  "missionId",
  "instanceId",
  "sessionId",
  "replayId",
  "auditId",
  "traceId",
  "requestId",
  "lineageId",
  "artifactId",
  "nodeId",
  "edgeId",
  "decisionId",
  "links.workflowId",
  "links.missionId",
  "links.instanceId",
  "links.sessionId",
  "links.replayId",
  "links.auditId",
  "links.traceId",
  "links.requestId",
  "links.lineageId",
  "links.artifactId",
  "links.nodeId",
  "links.edgeId",
  "links.decisionId",
  "metadata.workflowId",
  "metadata.missionId",
  "metadata.instanceId",
  "metadata.sessionId",
  "metadata.replayId",
  "metadata.auditId",
  "metadata.traceId",
  "metadata.requestId",
  "metadata.lineageId",
  "metadata.artifactId",
  "metadata.nodeId",
  "metadata.edgeId",
  "metadata.decisionId",
  "metadata.links.workflowId",
  "metadata.links.missionId",
  "metadata.links.instanceId",
  "metadata.links.sessionId",
  "metadata.links.replayId",
  "metadata.links.auditId",
  "metadata.links.traceId",
  "metadata.links.requestId",
  "metadata.links.lineageId",
  "metadata.links.artifactId",
  "metadata.links.nodeId",
  "metadata.links.edgeId",
  "metadata.links.decisionId",
  "context.workflowId",
  "context.missionId",
  "context.instanceId",
  "context.sessionId",
  "context.replayId",
  "context.auditId",
  "context.traceId",
  "context.requestId",
  "context.lineageId",
  "context.artifactId",
  "context.nodeId",
  "context.edgeId",
  "context.decisionId",
  "context.links.workflowId",
  "context.links.missionId",
  "context.links.instanceId",
  "context.links.sessionId",
  "context.links.replayId",
  "context.links.auditId",
  "context.links.traceId",
  "context.links.requestId",
  "context.links.lineageId",
  "context.links.artifactId",
  "context.links.nodeId",
  "context.links.edgeId",
  "context.links.decisionId",
  "context.inheritedContext.workflowId",
  "context.inheritedContext.missionId",
  "context.inheritedContext.instanceId",
  "context.inheritedContext.sessionId",
  "context.inheritedContext.replayId",
  "context.inheritedContext.auditId",
  "context.inheritedContext.traceId",
  "context.inheritedContext.requestId",
  "context.inheritedContext.lineageId",
  "context.inheritedContext.artifactId",
  "context.inheritedContext.nodeId",
  "context.inheritedContext.edgeId",
  "context.inheritedContext.decisionId",
  "runtime.workflowId",
  "runtime.missionId",
  "runtime.instanceId",
  "runtime.sessionId",
  "runtime.replayId",
  "runtime.auditId",
  "runtime.traceId",
  "runtime.requestId",
  "runtime.lineageId",
  "runtime.artifactId",
  "runtime.nodeId",
  "runtime.edgeId",
  "runtime.decisionId",
  "runtime.links.workflowId",
  "runtime.links.missionId",
  "runtime.links.instanceId",
  "runtime.links.sessionId",
  "runtime.links.replayId",
  "runtime.links.auditId",
  "runtime.links.traceId",
  "runtime.links.requestId",
  "runtime.links.lineageId",
  "runtime.links.artifactId",
  "runtime.links.nodeId",
  "runtime.links.edgeId",
  "runtime.links.decisionId",
  "observability.workflowId",
  "observability.missionId",
  "observability.instanceId",
  "observability.sessionId",
  "observability.replayId",
  "observability.auditId",
  "observability.traceId",
  "observability.requestId",
  "observability.lineageId",
  "observability.artifactId",
  "observability.nodeId",
  "observability.edgeId",
  "observability.decisionId",
  "observability.links.workflowId",
  "observability.links.missionId",
  "observability.links.instanceId",
  "observability.links.sessionId",
  "observability.links.replayId",
  "observability.links.auditId",
  "observability.links.traceId",
  "observability.links.requestId",
  "observability.links.lineageId",
  "observability.links.artifactId",
  "observability.links.nodeId",
  "observability.links.edgeId",
  "observability.links.decisionId",
  "approval.workflowId",
  "approval.missionId",
  "approval.instanceId",
  "approval.sessionId",
  "approval.replayId",
  "approval.auditId",
  "approval.traceId",
  "approval.requestId",
  "approval.lineageId",
  "approval.artifactId",
  "approval.nodeId",
  "approval.edgeId",
  "approval.decisionId",
  "audit.workflowId",
  "audit.missionId",
  "audit.instanceId",
  "audit.sessionId",
  "audit.replayId",
  "audit.auditId",
  "audit.traceId",
  "audit.requestId",
  "audit.lineageId",
  "audit.artifactId",
  "audit.nodeId",
  "audit.edgeId",
  "audit.decisionId",
] as const;

type WebAigcRuntimeRelationLinkKey =
  | "workflowId"
  | "missionId"
  | "instanceId"
  | "sessionId"
  | "replayId"
  | "auditId"
  | "traceId"
  | "requestId"
  | "lineageId"
  | "artifactId"
  | "nodeId"
  | "edgeId"
  | "decisionId";

function readRuntimeRelationLinkValue(
  source: unknown,
  key: WebAigcRuntimeRelationLinkKey,
): string | undefined {
  for (const path of WEB_AIGC_RUNTIME_RELATION_LINK_PATHS) {
    if (!path.endsWith(key)) {
      continue;
    }
    const candidate = getPathValue(source, path);
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function buildRuntimeRelationLinks(input: {
  state: StoredWebAigcRuntimeState;
  node?: WebAigcNodeSchema;
  edge?: {
    edgeId?: string;
    fromNodeId?: string;
    toNodeId?: string;
    kind?: string;
  };
  run?: WebAigcNodeRunRecord;
  metadata?: Record<string, unknown>;
}): Record<string, string> {
  const links: Record<string, string> = {};
  const { state } = input;

  const setLink = (
    key: WebAigcRuntimeRelationLinkKey,
    value: unknown,
  ): void => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    links[key] = normalized;
  };

  setLink(
    "workflowId",
    state.instance.links.workflowId ||
      state.definition.links.workflowId ||
      state.instance.instanceId,
  );
  setLink("missionId", state.instance.links.missionId);
  setLink("instanceId", state.instance.instanceId);
  setLink("sessionId", state.instance.links.sessionId);
  setLink(
    "replayId",
    state.instance.links.replayId ||
      state.definition.links.replayId ||
      state.instance.links.workflowId ||
      state.definition.links.workflowId ||
      state.instance.instanceId,
  );
  setLink("auditId", state.instance.links.auditId);
  setLink("nodeId", input.node?.id || state.instance.currentNodeId || undefined);
  setLink("edgeId", input.edge?.edgeId);

  const relationSources = [
    input.metadata,
    input.run?.output,
    state.instance.output,
    state.instance.variables,
    input.node?.metadata,
  ];

  const relationKeys: WebAigcRuntimeRelationLinkKey[] = [
    "workflowId",
    "missionId",
    "instanceId",
    "sessionId",
    "replayId",
    "auditId",
    "traceId",
    "requestId",
    "lineageId",
    "artifactId",
    "nodeId",
    "edgeId",
    "decisionId",
  ];

  for (const key of relationKeys) {
    for (const source of relationSources) {
      const candidate = readRuntimeRelationLinkValue(source, key);
      if (!candidate) {
        continue;
      }
      setLink(key, candidate);
      break;
    }
  }

  return links;
}

function mergeRuntimeEventMetadata(
  metadata: Record<string, unknown> | undefined,
  relationLinks: Record<string, string>,
): Record<string, unknown> | undefined {
  const baseMetadata = isRecord(metadata) ? clone(metadata) : undefined;
  const baseLinks = isRecord(baseMetadata?.links) ? clone(baseMetadata.links) : undefined;
  const mergedLinks = {
    ...(relationLinks || {}),
    ...(baseLinks || {}),
  };

  if (!baseMetadata && Object.keys(mergedLinks).length === 0) {
    return undefined;
  }

  return {
    ...(baseMetadata || {}),
    ...(Object.keys(mergedLinks).length > 0 ? { links: mergedLinks } : {}),
  };
}

type RuntimeGovernanceRetryMode = "automatic" | "manual";

type RuntimeGovernanceRetryBlockedReason =
  | "automatic_retry_budget_exhausted"
  | "manual_retry_budget_exhausted"
  | "total_retry_budget_exhausted";

interface RuntimeGovernancePolicy {
  maxAutomaticRetries?: number;
  maxManualRetries?: number;
  maxTotalRetries?: number;
  retryDelayMs?: number;
  escalateOnRetryBlocked?: boolean;
}

interface RuntimeGovernanceState {
  automaticRetryCount: number;
  manualRetryCount: number;
  totalRetryCount: number;
  lastRetryMode?: RuntimeGovernanceRetryMode;
  lastNodeId?: string;
  lastRequestedBy?: string;
  lastReason?: string;
  lastRetriedAt?: string;
  lastRetryDelayMs?: number;
  lastBlockedReason?: RuntimeGovernanceRetryBlockedReason;
  lastBlockedAt?: string;
}

interface RuntimeGovernanceSnapshot {
  policy: RuntimeGovernancePolicy;
  state: RuntimeGovernanceState;
  remaining: {
    automaticRetries?: number;
    manualRetries?: number;
    totalRetries?: number;
  };
}

interface RuntimeGovernanceRetryAllowance {
  allowed: boolean;
  blockedReason?: RuntimeGovernanceRetryBlockedReason;
  snapshot: RuntimeGovernanceSnapshot;
}

function normalizeRuntimeGovernanceLimit(value: unknown): number | undefined {
  const normalized = normalizeOptionalNumber(value);
  if (normalized === undefined) {
    return undefined;
  }

  return Math.max(0, Math.floor(normalized));
}

function normalizeRuntimeGovernancePolicy(
  value: unknown,
): RuntimeGovernancePolicy {
  const record = isRecord(value) ? value : {};
  const maxAutomaticRetries = normalizeRuntimeGovernanceLimit(
    record.maxAutomaticRetries,
  );
  const maxManualRetries = normalizeRuntimeGovernanceLimit(
    record.maxManualRetries,
  );
  const maxTotalRetries = normalizeRuntimeGovernanceLimit(record.maxTotalRetries);
  const retryDelayMs = normalizeRuntimeGovernanceLimit(record.retryDelayMs);
  const escalateOnRetryBlocked =
    typeof record.escalateOnRetryBlocked === "boolean"
      ? record.escalateOnRetryBlocked
      : undefined;

  return {
    ...(maxAutomaticRetries !== undefined ? { maxAutomaticRetries } : {}),
    ...(maxManualRetries !== undefined ? { maxManualRetries } : {}),
    ...(maxTotalRetries !== undefined ? { maxTotalRetries } : {}),
    ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    ...(escalateOnRetryBlocked !== undefined
      ? { escalateOnRetryBlocked }
      : {}),
  };
}

function mergeRuntimeGovernancePolicy(
  base: RuntimeGovernancePolicy,
  override?: RuntimeGovernancePolicy,
): RuntimeGovernancePolicy {
  return {
    ...base,
    ...(override || {}),
  };
}

function readRuntimeGovernancePolicy(
  variables: Record<string, unknown>,
): RuntimeGovernancePolicy {
  return normalizeRuntimeGovernancePolicy(variables.runtimeGovernancePolicy);
}

function readRuntimeGovernanceState(
  variables: Record<string, unknown>,
): RuntimeGovernanceState {
  const record = isRecord(variables.runtimeGovernanceState)
    ? variables.runtimeGovernanceState
    : {};

  const automaticRetryCount = normalizeRuntimeGovernanceLimit(
    record.automaticRetryCount,
  );
  const manualRetryCount = normalizeRuntimeGovernanceLimit(
    record.manualRetryCount,
  );
  const totalRetryCount = normalizeRuntimeGovernanceLimit(record.totalRetryCount);
  const lastRetryDelayMs = normalizeRuntimeGovernanceLimit(record.lastRetryDelayMs);

  return {
    automaticRetryCount: automaticRetryCount ?? 0,
    manualRetryCount: manualRetryCount ?? 0,
    totalRetryCount: totalRetryCount ?? 0,
    ...(record.lastRetryMode === "automatic" || record.lastRetryMode === "manual"
      ? { lastRetryMode: record.lastRetryMode }
      : {}),
    ...(typeof record.lastNodeId === "string"
      ? { lastNodeId: record.lastNodeId }
      : {}),
    ...(typeof record.lastRequestedBy === "string"
      ? { lastRequestedBy: record.lastRequestedBy }
      : {}),
    ...(typeof record.lastReason === "string" ? { lastReason: record.lastReason } : {}),
    ...(typeof record.lastRetriedAt === "string"
      ? { lastRetriedAt: record.lastRetriedAt }
      : {}),
    ...(lastRetryDelayMs !== undefined ? { lastRetryDelayMs } : {}),
    ...(record.lastBlockedReason === "automatic_retry_budget_exhausted" ||
    record.lastBlockedReason === "manual_retry_budget_exhausted" ||
    record.lastBlockedReason === "total_retry_budget_exhausted"
      ? { lastBlockedReason: record.lastBlockedReason }
      : {}),
    ...(typeof record.lastBlockedAt === "string"
      ? { lastBlockedAt: record.lastBlockedAt }
      : {}),
  };
}

function buildRuntimeGovernanceSnapshot(
  policy: RuntimeGovernancePolicy,
  state: RuntimeGovernanceState,
): RuntimeGovernanceSnapshot {
  return {
    policy,
    state,
    remaining: {
      ...(typeof policy.maxAutomaticRetries === "number"
        ? {
            automaticRetries: Math.max(
              0,
              policy.maxAutomaticRetries - state.automaticRetryCount,
            ),
          }
        : {}),
      ...(typeof policy.maxManualRetries === "number"
        ? {
            manualRetries: Math.max(
              0,
              policy.maxManualRetries - state.manualRetryCount,
            ),
          }
        : {}),
      ...(typeof policy.maxTotalRetries === "number"
        ? {
            totalRetries: Math.max(
              0,
              policy.maxTotalRetries - state.totalRetryCount,
            ),
          }
        : {}),
    },
  };
}

function applyRuntimeGovernancePolicyOverride(
  variables: Record<string, unknown>,
  override: unknown,
): {
  variables: Record<string, unknown>;
  snapshot: RuntimeGovernanceSnapshot;
} {
  const basePolicy = readRuntimeGovernancePolicy(variables);
  const normalizedOverride = normalizeRuntimeGovernancePolicy(override);
  const policy = mergeRuntimeGovernancePolicy(basePolicy, normalizedOverride);
  const state = readRuntimeGovernanceState(variables);
  const snapshot = buildRuntimeGovernanceSnapshot(policy, state);

  if (Object.keys(policy).length === 0) {
    return {
      variables,
      snapshot,
    };
  }

  return {
    variables: {
      ...variables,
      runtimeGovernancePolicy: policy,
    },
    snapshot,
  };
}

function evaluateRuntimeGovernanceRetryAllowance(
  variables: Record<string, unknown>,
  mode: RuntimeGovernanceRetryMode,
): RuntimeGovernanceRetryAllowance {
  const policy = readRuntimeGovernancePolicy(variables);
  const state = readRuntimeGovernanceState(variables);
  const snapshot = buildRuntimeGovernanceSnapshot(policy, state);

  if (
    mode === "automatic" &&
    typeof snapshot.remaining.automaticRetries === "number" &&
    snapshot.remaining.automaticRetries <= 0
  ) {
    return {
      allowed: false,
      blockedReason: "automatic_retry_budget_exhausted",
      snapshot,
    };
  }

  if (
    mode === "manual" &&
    typeof snapshot.remaining.manualRetries === "number" &&
    snapshot.remaining.manualRetries <= 0
  ) {
    return {
      allowed: false,
      blockedReason: "manual_retry_budget_exhausted",
      snapshot,
    };
  }

  if (
    typeof snapshot.remaining.totalRetries === "number" &&
    snapshot.remaining.totalRetries <= 0
  ) {
    return {
      allowed: false,
      blockedReason: "total_retry_budget_exhausted",
      snapshot,
    };
  }

  return {
    allowed: true,
    snapshot,
  };
}

function recordRuntimeGovernanceRetry(
  variables: Record<string, unknown>,
  input: {
    mode: RuntimeGovernanceRetryMode;
    nodeId: string;
    requestedBy: string;
    reason: string;
    retriedAt: string;
    retryDelayMs?: number;
  },
): {
  variables: Record<string, unknown>;
  snapshot: RuntimeGovernanceSnapshot;
} {
  const policy = readRuntimeGovernancePolicy(variables);
  const currentState = readRuntimeGovernanceState(variables);
  const nextState: RuntimeGovernanceState = {
    automaticRetryCount:
      currentState.automaticRetryCount + (input.mode === "automatic" ? 1 : 0),
    manualRetryCount:
      currentState.manualRetryCount + (input.mode === "manual" ? 1 : 0),
    totalRetryCount: currentState.totalRetryCount + 1,
    lastRetryMode: input.mode,
    lastNodeId: input.nodeId,
    lastRequestedBy: input.requestedBy,
    lastReason: input.reason,
    lastRetriedAt: input.retriedAt,
    ...(input.retryDelayMs !== undefined
      ? { lastRetryDelayMs: input.retryDelayMs }
      : {}),
  };
  const snapshot = buildRuntimeGovernanceSnapshot(policy, nextState);

  return {
    variables: {
      ...variables,
      ...(Object.keys(policy).length > 0 ? { runtimeGovernancePolicy: policy } : {}),
      runtimeGovernanceState: nextState,
    },
    snapshot,
  };
}

function recordRuntimeGovernanceRetryBlocked(
  variables: Record<string, unknown>,
  input: {
    blockedReason: RuntimeGovernanceRetryBlockedReason;
    blockedAt: string;
  },
): {
  variables: Record<string, unknown>;
  snapshot: RuntimeGovernanceSnapshot;
} {
  const policy = readRuntimeGovernancePolicy(variables);
  const currentState = readRuntimeGovernanceState(variables);
  const nextState: RuntimeGovernanceState = {
    ...currentState,
    lastBlockedReason: input.blockedReason,
    lastBlockedAt: input.blockedAt,
  };
  const snapshot = buildRuntimeGovernanceSnapshot(policy, nextState);

  return {
    variables: {
      ...variables,
      ...(Object.keys(policy).length > 0 ? { runtimeGovernancePolicy: policy } : {}),
      runtimeGovernanceState: nextState,
    },
    snapshot,
  };
}

function getPathValue(source: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map(segment => segment.trim())
    .filter(Boolean);
  let current = source;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

interface HitlChoiceOption {
  id: string;
  label: string;
  description?: string;
}

function bestDeliverable(
  task: Pick<TaskRecord, "deliverable" | "deliverable_v2" | "deliverable_v3">,
): string {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || "";
}

function buildFallbackNodeType(node: WorkflowOrganizationNode): string {
  const executionMode = node.execution?.mode;
  if (executionMode === "orchestrate") return "root";
  if (executionMode === "plan") return "plan";
  if (executionMode === "review") return "review";
  if (executionMode === "audit") return "audit";
  if (executionMode === "summary") return "summary";
  return "agent_task";
}

function buildNodeInput(task?: TaskRecord): Record<string, unknown> {
  if (!task) return {};
  return {
    taskId: task.id,
    description: task.description,
    department: task.department,
    version: task.version,
  };
}

function buildNodeOutput(task?: TaskRecord): Record<string, unknown> | undefined {
  if (!task) return undefined;

  const deliverable = bestDeliverable(task);
  const output: Record<string, unknown> = {
    taskStatus: task.status,
  };
  if (deliverable.trim()) {
    output.deliverable = deliverable;
  }
  if (task.total_score !== null) {
    output.totalScore = task.total_score;
  }
  if (task.verify_result) {
    output.verifyResult = task.verify_result;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function getNodeConfigDefaultValue(
  node: Pick<WebAigcNodeSchema, "config">,
  key: string,
): unknown {
  return node.config.find(item => item.key === key)?.defaultValue;
}

function getNodeConfigString(
  node: Pick<WebAigcNodeSchema, "config">,
  key: string,
): string | undefined {
  const value = getNodeConfigDefaultValue(node, key);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function getNodeConfigBoolean(
  node: Pick<WebAigcNodeSchema, "config">,
  key: string,
): boolean | undefined {
  const value = getNodeConfigDefaultValue(node, key);
  return typeof value === "boolean" ? value : undefined;
}

function getNodeConfigNumber(
  node: Pick<WebAigcNodeSchema, "config">,
  key: string,
): number | undefined {
  const value = getNodeConfigDefaultValue(node, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveNodeTemplateValue(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }
    if (trimmed === "@variables") {
      return clone(variables);
    }
    if (trimmed.startsWith("$.")) {
      const resolved = getPathValue(variables, trimmed.slice(2));
      return resolved === undefined ? undefined : clone(resolved);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveNodeTemplateValue(item, variables));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveNodeTemplateValue(item, variables),
      ]),
    );
  }

  return value;
}

type RuntimeVariableAssignmentScope = "global" | "local" | "temp";

interface RuntimeVariableAssignmentChange {
  nodeId: string;
  scope: RuntimeVariableAssignmentScope;
  target: string;
  previousValue: unknown;
  nextValue: unknown;
  assignedAt: string;
}

interface RuntimeVariableAssignmentContext {
  global: Record<string, unknown>;
  local: Record<string, unknown>;
  temp: Record<string, unknown>;
}

function normalizeRuntimeVariableAssignmentScope(
  value: unknown,
): RuntimeVariableAssignmentScope {
  return value === "local" || value === "temp" ? value : "global";
}

function cloneRuntimeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? clone(value) : {};
}

function buildRuntimeVariableAssignmentContext(
  variables: Record<string, unknown>,
): RuntimeVariableAssignmentContext {
  const global = clone(variables);
  delete global.runtimeVariableScopes;

  const scopeSnapshot = isRecord(variables.runtimeVariableScopes)
    ? variables.runtimeVariableScopes
    : {};

  return {
    global: {
      ...global,
      ...cloneRuntimeRecord(scopeSnapshot.global),
    },
    local: cloneRuntimeRecord(scopeSnapshot.local),
    temp: cloneRuntimeRecord(scopeSnapshot.temp),
  };
}

function lookupRuntimeVariableAssignmentValue(
  path: string,
  context: RuntimeVariableAssignmentContext,
): unknown {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return undefined;
  }

  for (const scope of [context.temp, context.local, context.global]) {
    const value = getPathValue(scope, normalizedPath);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function resolveRuntimeVariableAssignmentTokenValue(
  token: string,
  context: RuntimeVariableAssignmentContext,
): unknown {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  const numberValue = Number(trimmed);
  if (Number.isFinite(numberValue) && trimmed !== "") {
    return numberValue;
  }

  if (trimmed.startsWith("$.")) {
    return lookupRuntimeVariableAssignmentValue(trimmed.slice(2), context);
  }

  return lookupRuntimeVariableAssignmentValue(trimmed, context);
}

const RUNTIME_VARIABLE_ASSIGNMENT_OPERATORS = [
  "===",
  "!==",
  ">=",
  "<=",
  "==",
  "!=",
  ">",
  "<",
] as const;

function evaluateRuntimeVariableAssignmentExpression(
  expression: string,
  context: RuntimeVariableAssignmentContext,
): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }

  for (const operator of RUNTIME_VARIABLE_ASSIGNMENT_OPERATORS) {
    const operatorIndex = trimmed.indexOf(operator);
    if (operatorIndex <= 0) {
      continue;
    }

    const leftToken = trimmed.slice(0, operatorIndex);
    const rightToken = trimmed.slice(operatorIndex + operator.length);
    const leftValue = resolveRuntimeVariableAssignmentTokenValue(
      leftToken,
      context,
    );
    const rightValue = resolveRuntimeVariableAssignmentTokenValue(
      rightToken,
      context,
    );

    switch (operator) {
      case "===":
      case "==":
        return leftValue === rightValue;
      case "!==":
      case "!=":
        return leftValue !== rightValue;
      case ">":
        return Number(leftValue) > Number(rightValue);
      case "<":
        return Number(leftValue) < Number(rightValue);
      case ">=":
        return Number(leftValue) >= Number(rightValue);
      case "<=":
        return Number(leftValue) <= Number(rightValue);
      default:
        break;
    }
  }

  return resolveRuntimeVariableAssignmentTokenValue(trimmed, context);
}

function readRuntimeVariableAssignmentChanges(
  variables: Record<string, unknown>,
): RuntimeVariableAssignmentChange[] {
  const changes = variables.runtimeVariableChanges;
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes.flatMap(change => {
    if (
      !isRecord(change) ||
      typeof change.nodeId !== "string" ||
      typeof change.target !== "string"
    ) {
      return [];
    }

    return [
      {
        nodeId: change.nodeId,
        scope: normalizeRuntimeVariableAssignmentScope(change.scope),
        target: change.target,
        previousValue: clone(change.previousValue),
        nextValue: clone(change.nextValue),
        assignedAt:
          typeof change.assignedAt === "string" ? change.assignedAt : nowIso(),
      } satisfies RuntimeVariableAssignmentChange,
    ];
  });
}

function readRuntimeVariableAssignmentChange(
  output?: Record<string, unknown>,
): RuntimeVariableAssignmentChange | undefined {
  if (!output || !isRecord(output.runtimeVariableLastChange)) {
    return undefined;
  }

  const change = output.runtimeVariableLastChange;
  if (typeof change.nodeId !== "string" || typeof change.target !== "string") {
    return undefined;
  }

  return {
    nodeId: change.nodeId,
    scope: normalizeRuntimeVariableAssignmentScope(change.scope),
    target: change.target,
    previousValue: clone(change.previousValue),
    nextValue: clone(change.nextValue),
    assignedAt: typeof change.assignedAt === "string" ? change.assignedAt : nowIso(),
  };
}

function getHitlChoiceOptions(
  node: Pick<WebAigcNodeSchema, "config">,
): HitlChoiceOption[] {
  const value = getNodeConfigDefaultValue(node, "options");
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap(item => {
    if (!isRecord(item)) {
      return [];
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!id || !label) {
      return [];
    }
    return [
      {
        id,
        label,
        description:
          typeof item.description === "string" && item.description.trim()
            ? item.description.trim()
            : undefined,
      },
    ];
  });
}

function isMultiSelectNode(
  node: Pick<WebAigcNodeSchema, "config">,
): boolean {
  const explicitBoolean = getNodeConfigBoolean(node, "multiple");
  if (typeof explicitBoolean === "boolean") {
    return explicitBoolean;
  }

  const mode =
    getNodeConfigString(node, "selectionMode") ||
    getNodeConfigString(node, "mode");
  if (!mode) {
    return false;
  }

  return ["multiple", "multi", "multi-select", "multi-choice"].includes(
    mode.toLowerCase(),
  );
}

function buildChoiceDescription(options: HitlChoiceOption[]): string | undefined {
  if (options.length === 0) {
    return undefined;
  }

  return options
    .map(option =>
      option.description
        ? `${option.id}: ${option.label} (${option.description})`
        : `${option.id}: ${option.label}`,
    )
    .join(" | ");
}

function normalizeSelectionPayload(
  payload: Record<string, unknown> | undefined,
): string[] {
  if (!payload) {
    return [];
  }

  const optionIds = payload.optionIds;
  if (Array.isArray(optionIds)) {
    return optionIds
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean);
  }

  const selectedOptionIds = payload.selectedOptionIds;
  if (Array.isArray(selectedOptionIds)) {
    return selectedOptionIds
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean);
  }

  const optionId =
    typeof payload.optionId === "string"
      ? payload.optionId.trim()
      : typeof payload.branchKey === "string"
        ? payload.branchKey.trim()
        : "";
  return optionId ? [optionId] : [];
}

function getPayloadString(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function buildNodeRunFromSchema(
  node: WebAigcNodeSchema,
  task?: TaskRecord,
): WebAigcNodeRunRecord {
  const waitingFor =
    task?.status === "waiting" || task?.status === "waiting_input"
      ? "task input"
      : undefined;

  return {
    nodeId: node.id,
    status: toWebAigcNodeRunStatus(task?.status, { waitingFor }),
    attempts: task?.version || 0,
    startedAt: task?.created_at || null,
    completedAt:
      task &&
      ["completed", "done", "passed", "failed", "terminated", "cancelled"].includes(task.status)
        ? task.updated_at
        : null,
    input: buildNodeInput(task),
    output: buildNodeOutput(task),
    waitingFor,
    error:
      task?.status === "failed" && typeof task.deliverable === "string"
        ? task.deliverable
        : undefined,
  };
}

function buildEdgeTransitionRecords(
  edges: WebAigcEdgeSchema[],
  nodeRuns: WebAigcNodeRunRecord[],
): WebAigcEdgeTransitionRecord[] {
  const nodeStatusById = new Map(
    nodeRuns.map(nodeRun => [nodeRun.nodeId, nodeRun.status]),
  );

  return edges.map(edge => {
    const fromStatus = nodeStatusById.get(edge.fromNodeId);
    const toStatus = nodeStatusById.get(edge.toNodeId);
    const executed =
      fromStatus && fromStatus !== "PENDING" && fromStatus !== "WAITING_INPUT";
    const blocked =
      toStatus === "PENDING" &&
      (fromStatus === "EXCEPTION" || fromStatus === "FORCE_TERMINATED");

    return {
      edgeId: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
      status: blocked ? "blocked" : executed ? "executed" : "known",
    };
  });
}

export function buildWorkflowGraphDefinition(input: {
  workflow: WorkflowRecord;
  tasks: TaskRecord[];
  mission?: MissionRecord;
}): WebAigcGraphDefinition {
  const { workflow, tasks, mission } = input;
  const organization = workflow.results?.organization as
    | WorkflowOrganizationSnapshot
    | undefined;
  const generatedAt = nowIso();

  if (organization?.nodes?.length) {
    const nodeSchemas: WebAigcNodeSchema[] = organization.nodes.map(node => ({
      id: node.id,
      type: buildFallbackNodeType(node),
      title: node.title || node.name,
      description: node.responsibility,
      agentId: node.agentId,
      stageKey: node.execution?.mode || null,
      inputs: [
        {
          key: "directive",
          label: "Directive",
          valueType: "string",
          required: true,
        },
      ],
      outputs: [
        {
          key: "result",
          label: "Result",
          valueType: "object",
        },
      ],
      config: [
        {
          key: "executionMode",
          label: "Execution mode",
          valueType: "string",
          defaultValue: node.execution?.mode,
        },
        {
          key: "strategy",
          label: "Strategy",
          valueType: "string",
          defaultValue: node.execution?.strategy,
        },
      ],
      metadata: {
        role: node.role,
        departmentId: node.departmentId,
        departmentLabel: node.departmentLabel,
        summaryFocus: node.summaryFocus,
      },
    }));

    const edgeSchemas: WebAigcEdgeSchema[] = organization.nodes
      .filter(node => node.parentId)
      .map(node => ({
        id: `${node.parentId}->${node.id}`,
        fromNodeId: node.parentId as string,
        toNodeId: node.id,
        kind: "success",
      }));

    return {
      kind: "graph_definition",
      version: 1,
      definitionId: workflow.id,
      code: workflow.id,
      name:
        typeof organization.taskProfile === "string" && organization.taskProfile.trim()
          ? organization.taskProfile.trim()
          : normalizeText(workflow.directive).slice(0, 80),
      source: "organization_projection",
      entryNodeId: organization.rootNodeId || organization.nodes[0].id,
      graphVersion: {
        kind: "graph_version",
        version: 1,
        definitionId: workflow.id,
        graphVersion: "v1",
        createdAt: generatedAt,
      },
      links: {
        workflowId: workflow.id,
        missionId: mission?.id,
        sessionId: mission?.topicId,
        replayId: workflow.id,
      },
      nodeSchemas,
      edgeSchemas,
      metadata: {
        departments: organization.departments,
        source: organization.source,
      },
    };
  }

  const nodeSchemas: WebAigcNodeSchema[] =
    tasks.length > 0
      ? tasks.map(task => ({
          id: `task-${task.id}`,
          type: "agent_task",
          title: task.description,
          description: `Assigned to ${task.worker_id}`,
          agentId: task.worker_id,
          stageKey: task.status,
          inputs: [
            {
              key: "description",
              label: "Description",
              valueType: "string",
              required: true,
            },
          ],
          outputs: [
            {
              key: "deliverable",
              label: "Deliverable",
              valueType: "string",
            },
          ],
          config: [],
          metadata: {
            taskId: task.id,
            managerId: task.manager_id,
            department: task.department,
          },
        }))
      : [
          {
            id: "workflow-root",
            type: "root",
            title: normalizeText(workflow.directive).slice(0, 120),
            description: workflow.directive,
            stageKey: workflow.current_stage,
            inputs: [
              {
                key: "directive",
                label: "Directive",
                valueType: "string",
                required: true,
              },
            ],
            outputs: [
              {
                key: "result",
                label: "Result",
                valueType: "object",
              },
            ],
            config: [],
          },
        ];

  const edgeSchemas: WebAigcEdgeSchema[] = nodeSchemas
    .slice(1)
    .map((node, index) => ({
      id: `${nodeSchemas[index].id}->${node.id}`,
      fromNodeId: nodeSchemas[index].id,
      toNodeId: node.id,
      kind: "success",
    }));

  return {
    kind: "graph_definition",
    version: 1,
    definitionId: workflow.id,
    code: workflow.id,
    name: normalizeText(workflow.directive).slice(0, 80),
    source: tasks.length > 0 ? "task_projection" : "inline",
    entryNodeId: nodeSchemas[0].id,
    graphVersion: {
      kind: "graph_version",
      version: 1,
      definitionId: workflow.id,
      graphVersion: "v1",
      createdAt: generatedAt,
    },
    links: {
      workflowId: workflow.id,
      missionId: mission?.id,
      sessionId: mission?.topicId,
      replayId: workflow.id,
    },
    nodeSchemas,
    edgeSchemas,
  };
}

function findDefinitionNodeByStageKey(
  definition: WebAigcGraphDefinition,
  stageKey?: string | null,
): WebAigcNodeSchema | undefined {
  if (!stageKey) return undefined;
  return definition.nodeSchemas.find(node => node.stageKey === stageKey);
}

export function buildWorkflowGraphInstance(input: {
  workflow: WorkflowRecord;
  tasks: TaskRecord[];
  mission?: MissionRecord;
  definition?: WebAigcGraphDefinition;
}): WebAigcGraphInstance {
  const { workflow, tasks, mission } = input;
  const definition =
    input.definition ||
    buildWorkflowGraphDefinition({
      workflow,
      tasks,
      mission,
    });
  const runtimeState = readStoredWebAigcRuntimeState(workflow);
  if (runtimeState?.instance) {
    return runtimeState.instance;
  }

  const taskByAgentId = new Map(tasks.map(task => [task.worker_id, task]));
  const nodeRuns = definition.nodeSchemas.map(node =>
    buildNodeRunFromSchema(
      node,
      node.agentId ? taskByAgentId.get(node.agentId) : undefined,
    ),
  );

  const checkpoint = mission?.waitingFor
    ? ({
        nodeId:
          nodeRuns.find(nodeRun => nodeRun.status === "WAITING_INPUT")?.nodeId ||
          definition.entryNodeId,
        waitingFor: mission.waitingFor,
        createdAt: nowIso(),
        resumeCount: 0,
      } satisfies WebAigcGraphCheckpoint)
    : undefined;

  return {
    kind: "graph_instance",
    version: 1,
    instanceId: workflow.id,
    definitionId: definition.definitionId,
    status: toWebAigcRuntimeStatus(workflow.status, {
      waitingFor: checkpoint?.waitingFor,
    }),
    currentNodeId:
      checkpoint?.nodeId ||
      nodeRuns.find(nodeRun => nodeRun.status === "EXECUTING")?.nodeId ||
      findDefinitionNodeByStageKey(definition, workflow.current_stage)?.id ||
      definition.entryNodeId,
    createdAt: workflow.created_at,
    startedAt: workflow.started_at,
    completedAt: workflow.completed_at,
    links: {
      workflowId: workflow.id,
      missionId: mission?.id,
      sessionId: mission?.topicId,
      replayId: workflow.id,
    },
    variables: {},
    nodeRuns,
    edgeTransitions: buildEdgeTransitionRecords(definition.edgeSchemas, nodeRuns),
    checkpoint,
  };
}

function defaultAdvanceTarget(
  definition: WebAigcGraphDefinition,
  currentNodeId: string,
): string | undefined {
  return definition.edgeSchemas.find(edge => edge.fromNodeId === currentNodeId)?.toNodeId;
}

function ensureNodeRun(
  instance: WebAigcGraphInstance,
  nodeId: string,
): WebAigcNodeRunRecord {
  const existing = instance.nodeRuns.find(nodeRun => nodeRun.nodeId === nodeId);
  if (existing) {
    return existing;
  }

  const created: WebAigcNodeRunRecord = {
    nodeId,
    status: "PENDING",
    attempts: 0,
    startedAt: null,
    completedAt: null,
  };
  instance.nodeRuns.push(created);
  return created;
}

function markEdgeExecuted(
  instance: WebAigcGraphInstance,
  edgeId?: string,
): void {
  if (!edgeId) return;
  const edge = instance.edgeTransitions.find(item => item.edgeId === edgeId);
  if (edge) {
    edge.status = "executed";
    edge.timestamp = nowIso();
  }
}

function markEdgeBlocked(
  instance: WebAigcGraphInstance,
  edgeId?: string,
): void {
  if (!edgeId) return;
  const edge = instance.edgeTransitions.find(item => item.edgeId === edgeId);
  if (edge) {
    edge.status = "blocked";
    edge.timestamp = nowIso();
  }
}

function recordLoopIteration(
  variables: Record<string, unknown>,
  loopKey: string,
): {
  variables: Record<string, unknown>;
  iterationIndex: number;
} {
  const tracker = isRecord(variables.runtimeLoopIterations)
    ? variables.runtimeLoopIterations
    : {};
  const previous = tracker[loopKey];
  const iterationIndex =
    typeof previous === "number" && Number.isFinite(previous) && previous >= 0
      ? Math.floor(previous) + 1
      : 1;

  return {
    variables: {
      ...variables,
      runtimeLoopIterations: {
        ...tracker,
        [loopKey]: iterationIndex,
      },
    },
    iterationIndex,
  };
}

function readLoopIterationCount(
  variables: Record<string, unknown>,
  loopKey: string,
): number {
  const tracker = isRecord(variables.runtimeLoopIterations)
    ? variables.runtimeLoopIterations
    : {};
  const current = tracker[loopKey];
  return typeof current === "number" && Number.isFinite(current) && current >= 0
    ? Math.floor(current)
    : 0;
}

function readLoopEdgeLimitNumber(
  edge: Pick<WebAigcEdgeSchema, "metadata"> | undefined,
  key: string,
): number | undefined {
  const value = edge?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readLoopRuntimeTracker(
  variables: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(variables.runtimeLoopTracking)
    ? variables.runtimeLoopTracking
    : {};
}

function ensureLoopRuntimeTrackerEntry(
  variables: Record<string, unknown>,
  loopKey: string,
): {
  entry: Record<string, unknown>;
  variables: Record<string, unknown>;
} {
  const tracker = readLoopRuntimeTracker(variables);
  const existingEntry = isRecord(tracker[loopKey]) ? tracker[loopKey] : {};
  const startedAt =
    normalizeOptionalString(existingEntry.startedAt) || nowIso();
  const entry = {
    ...existingEntry,
    startedAt,
  };

  return {
    entry,
    variables: {
      ...variables,
      runtimeLoopTracking: {
        ...tracker,
        [loopKey]: entry,
      },
    },
  };
}

function updateLoopRuntimeTracker(
  variables: Record<string, unknown>,
  loopKey: string,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const tracker = readLoopRuntimeTracker(variables);
  const entry = isRecord(tracker[loopKey]) ? tracker[loopKey] : {};
  return {
    ...variables,
    runtimeLoopTracking: {
      ...tracker,
      [loopKey]: {
        ...entry,
        ...updates,
      },
    },
  };
}

function readLatestLoopTrackerContext(
  variables: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const tracker = readLoopRuntimeTracker(variables);
  let best:
    | {
        sortValue: number;
        value: Record<string, unknown>;
      }
    | undefined;

  for (const [loopKey, rawEntry] of Object.entries(tracker)) {
    if (!isRecord(rawEntry)) continue;
    const timestampCandidate =
      normalizeOptionalString(rawEntry.lastBlockedAt) ||
      normalizeOptionalString(rawEntry.lastIteratedAt) ||
      normalizeOptionalString(rawEntry.startedAt);
    const parsedTimestamp = timestampCandidate ? Date.parse(timestampCandidate) : Number.NaN;
    const sortValue = Number.isFinite(parsedTimestamp) ? parsedTimestamp : -1;
    if (!best || sortValue >= best.sortValue) {
      best = {
        sortValue,
        value: {
          loopKey,
          ...rawEntry,
        },
      };
    }
  }

  return best?.value;
}

function resolveNextNodeId(
  definition: WebAigcGraphDefinition,
  currentNodeId: string,
  result: WorkflowNodeAdapterResult,
): { nextNodeId?: string; edgeId?: string } {
  if (result.kind === "complete") {
    return {};
  }

  const nextNodeId =
    result.kind === "advance" && result.nextNodeId
      ? result.nextNodeId
      : defaultAdvanceTarget(definition, currentNodeId);
  if (!nextNodeId) {
    return {};
  }

  const edge = definition.edgeSchemas.find(
    item => item.fromNodeId === currentNodeId && item.toNodeId === nextNodeId,
  );

  return {
    nextNodeId,
    edgeId: edge?.id,
  };
}

export function readStoredWebAigcRuntimeState(
  workflow?: Pick<WorkflowRecord, "results"> | null,
): StoredWebAigcRuntimeState | undefined {
  const state = workflow?.results?.webAigcRuntime;
  if (!state || typeof state !== "object") {
    return undefined;
  }

  const candidate = state as Partial<StoredWebAigcRuntimeState>;
  if (candidate.domainModelVersion !== 1) {
    return undefined;
  }
  if (!candidate.definition || !candidate.instance) {
    return undefined;
  }
  return candidate as StoredWebAigcRuntimeState;
}

export class InMemoryWorkflowNodeAdapterRegistry {
  private readonly adapters = new Map<string, WorkflowNodeAdapter>();

  register(adapter: WorkflowNodeAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): WorkflowNodeAdapter | undefined {
    return this.adapters.get(type);
  }
}

export class EchoWorkflowNodeAdapter implements WorkflowNodeAdapter {
  readonly type = "echo";

  async execute(context: {
    input: Record<string, unknown>;
    node: WebAigcNodeSchema;
  }): Promise<WorkflowNodeAdapterResult> {
    return {
      kind: "advance",
      output: {
        echoedFrom: context.node.id,
        ...context.input,
      },
    };
  }
}

class ProjectionPassThroughAdapter implements WorkflowNodeAdapter {
  constructor(readonly type: string) {}

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    return {
      kind: "advance",
      output: {
        lastNodeId: context.node.id,
        lastNodeType: context.node.type,
        ...context.input,
      },
    };
  }
}

function resolveChatNodeConfigValue(
  node: Pick<WebAigcNodeSchema, "config">,
  variables: Record<string, unknown>,
  key: string,
): unknown {
  return resolveNodeTemplateValue(
    getNodeConfigDefaultValue(node, key),
    variables,
  );
}

function isRuntimeChatNodeMessage(value: unknown): value is ChatNodeMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.role === "system" ||
      value.role === "user" ||
      value.role === "assistant") &&
    typeof value.content === "string"
  );
}

function normalizeRuntimeChatMessages(value: unknown): ChatNodeMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.filter(isRuntimeChatNodeMessage).map(message => ({
    role: message.role,
    content: message.content,
  }));

  return normalized.length > 0 ? normalized : undefined;
}

function isRuntimeSourceType(value: string): value is SourceType {
  return [
    "task_result",
    "code_snippet",
    "conversation",
    "mission_log",
    "document",
    "architecture_decision",
    "bug_report",
  ].includes(value);
}

function normalizeRuntimeChatDocumentSearchInput(
  value: unknown,
): ChatNodeDocumentSearchInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const scope = isRecord(value.scope) ? value.scope : undefined;
  const projectId = normalizeOptionalString(scope?.projectId);
  if (!projectId) {
    return undefined;
  }

  const sourceTypes = isStringArray(scope?.sourceTypes)
    ? scope.sourceTypes.filter(isRuntimeSourceType)
    : undefined;
  const documentIds = isStringArray(scope?.documentIds) ? [...scope.documentIds] : undefined;
  const options = isRecord(value.options) ? value.options : undefined;
  const mode =
    value.options && isRecord(value.options) &&
    (value.options.mode === "semantic" ||
      value.options.mode === "keyword" ||
      value.options.mode === "hybrid")
      ? value.options.mode
      : undefined;

  return {
    ...(normalizeOptionalString(value.query) ? { query: normalizeOptionalString(value.query) } : {}),
    scope: {
      projectId,
      ...(sourceTypes ? { sourceTypes } : {}),
      ...(documentIds ? { documentIds } : {}),
      ...(normalizeOptionalString(scope?.agentId)
        ? { agentId: normalizeOptionalString(scope?.agentId) }
        : {}),
      ...(normalizeOptionalString(scope?.codeLanguage)
        ? { codeLanguage: normalizeOptionalString(scope?.codeLanguage) }
        : {}),
    },
    ...(options
      ? {
          options: {
            ...(typeof options.topK === "number" ? { topK: options.topK } : {}),
            ...(typeof options.minScore === "number"
              ? { minScore: options.minScore }
              : {}),
            ...(mode ? { mode } : {}),
            ...(typeof options.expandContext === "boolean"
              ? { expandContext: options.expandContext }
              : {}),
            ...(typeof options.contextWindowChunks === "number"
              ? { contextWindowChunks: options.contextWindowChunks }
              : {}),
          },
        }
      : {}),
  };
}

function buildRuntimeChatNodeInput(
  context: WorkflowNodeExecutionContext,
): ChatNodeInput {
  const prompt =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "prompt"),
    ) ||
    normalizeOptionalString(context.variables.prompt) ||
    normalizeOptionalString(context.variables.userPrompt) ||
    normalizeOptionalString(context.variables.directive);
  const systemPrompt =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "systemPrompt"),
    ) || normalizeOptionalString(context.variables.systemPrompt);
  const messages = normalizeRuntimeChatMessages(
    resolveChatNodeConfigValue(context.node, context.variables, "messages") ??
      context.variables.messages,
  );
  const inputContext =
    resolveChatNodeConfigValue(context.node, context.variables, "context") ??
    context.variables.context;
  const inputVariables = resolveChatNodeConfigValue(
    context.node,
    context.variables,
    "variables",
  );
  const citations =
    resolveChatNodeConfigValue(context.node, context.variables, "citations") ??
    context.variables.citations;
  const toolCalls =
    resolveChatNodeConfigValue(context.node, context.variables, "toolCalls") ??
    context.variables.toolCalls;
  const documentSearch =
    normalizeRuntimeChatDocumentSearchInput(
      resolveChatNodeConfigValue(context.node, context.variables, "documentSearch") ??
        context.variables.documentSearch,
    );
  const thinking =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "thinking"),
    ) || normalizeOptionalString(context.variables.thinking);
  const sessionId =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "sessionId"),
    ) || context.instance.links.sessionId;
  const missionId =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "missionId"),
    ) || context.instance.links.missionId;
  const agentId =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "agentId"),
    ) ||
    context.node.agentId ||
    `${context.node.type}-agent`;
  const stage =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "stage"),
    ) ||
    context.node.stageKey ||
    context.node.id;
  const temperature =
    normalizeOptionalNumber(
      resolveChatNodeConfigValue(context.node, context.variables, "temperature"),
    ) || normalizeOptionalNumber(context.variables.temperature);
  const maxTokens =
    normalizeOptionalNumber(
      resolveChatNodeConfigValue(context.node, context.variables, "maxTokens"),
    ) || normalizeOptionalNumber(context.variables.maxTokens);
  const model =
    normalizeOptionalString(
      resolveChatNodeConfigValue(context.node, context.variables, "model"),
    ) || normalizeOptionalString(context.variables.model);

  return {
    ...(messages !== undefined ? { messages } : {}),
    ...(prompt ? { prompt } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(inputContext !== undefined ? { context: inputContext } : {}),
    ...(isRecord(inputVariables) ? { variables: clone(inputVariables) } : {}),
    workflowId: context.instance.links.workflowId || context.instance.instanceId,
    ...(sessionId ? { sessionId } : {}),
    ...(missionId ? { missionId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(stage ? { stage } : {}),
    ...(isStringArray(citations) ? { citations } : {}),
    ...(Array.isArray(toolCalls) ? { toolCalls: clone(toolCalls) } : {}),
    ...(documentSearch !== undefined ? { documentSearch: clone(documentSearch) } : {}),
    ...(thinking ? { thinking } : {}),
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    ...(model ? { model } : {}),
  };
}

function getRuntimeChatMessageStore(runtime: WorkflowRuntime) {
  const workflowRepo = runtime.workflowRepo as WorkflowRuntime["workflowRepo"] & {
    createMessage?: (message: {
      workflow_id: string;
      from_agent: string;
      to_agent: string;
      stage: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }) => unknown;
  };

  if (typeof workflowRepo.createMessage !== "function") {
    return undefined;
  }

  return {
    createMessage(message: {
      workflow_id: string;
      from_agent: string;
      to_agent: string;
      stage: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }) {
      return workflowRepo.createMessage?.(message);
    },
  };
}

function getRuntimeChatDocumentSearch(
  runtime: WorkflowRuntime,
): ChatNodeAdapterDeps["documentSearch"] | undefined {
  const candidate = runtime as WorkflowRuntime & {
    documentSearch?: ChatNodeAdapterDeps["documentSearch"];
  };

  return candidate.documentSearch;
}

function buildRuntimeChatNodeOutput(input: {
  node: WebAigcNodeSchema;
  nodeType: ChatNodeType;
  result: Awaited<ReturnType<typeof executeChatNode>>;
}): Record<string, unknown> {
  const { node, nodeType, result } = input;
  return {
    lastNodeId: node.id,
    lastNodeType: node.type,
    nodeType,
    content: result.output.content,
    result: result.output.content,
    model: result.output.model,
    latencyMs: result.output.latencyMs,
    messages: clone(result.output.messages),
    reply: clone(result.output.reply),
    ...(result.output.usage ? { usage: clone(result.output.usage) } : {}),
    ...(result.output.observability
      ? { observability: clone(result.output.observability) }
      : {}),
  };
}

class ChatWorkflowNodeAdapter implements WorkflowNodeAdapter {
  constructor(
    readonly type: ChatNodeType,
    private readonly runtime: WorkflowRuntime,
  ) {}

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const input = buildRuntimeChatNodeInput(context);
    const result = await executeChatNode(
      {
        nodeType: this.type,
        input,
      },
      {
        executeLLM: (messages, options) =>
          this.runtime.llmProvider.call(messages, options),
        messageStore: getRuntimeChatMessageStore(this.runtime),
        sessionStore: {
          appendLLMExchange: (agentId, options) =>
            this.runtime.memoryRepo.appendLLMExchange(agentId, options),
        },
        documentSearch: getRuntimeChatDocumentSearch(this.runtime),
      },
    );

    return {
      kind: "advance",
      output: buildRuntimeChatNodeOutput({
        node: context.node,
        nodeType: this.type,
        result,
      }),
    };
  }
}

class VariableAssignmentWorkflowNodeAdapter implements WorkflowNodeAdapter {
  readonly type = "variable_assignment";

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const target =
      normalizeOptionalString(
        resolveNodeTemplateValue(
          getNodeConfigDefaultValue(context.node, "target"),
          context.variables,
        ),
      ) || "";
    if (!target) {
      return {
        kind: "error",
        message: `Variable assignment node ${context.node.id} requires a target.`,
      };
    }

    const scope = normalizeRuntimeVariableAssignmentScope(
      resolveNodeTemplateValue(
        getNodeConfigDefaultValue(context.node, "scope"),
        context.variables,
      ),
    );
    const assignmentContext = buildRuntimeVariableAssignmentContext(
      context.variables,
    );
    const previousValue = lookupRuntimeVariableAssignmentValue(
      target,
      assignmentContext,
    );

    const expression = normalizeOptionalString(
      resolveNodeTemplateValue(
        getNodeConfigDefaultValue(context.node, "expression"),
        context.variables,
      ),
    );
    const source = getNodeConfigString(context.node, "source");
    const value = resolveNodeTemplateValue(
      getNodeConfigDefaultValue(context.node, "value"),
      context.variables,
    );
    const nextValue =
      expression !== undefined
        ? evaluateRuntimeVariableAssignmentExpression(expression, assignmentContext)
        : source
          ? resolveRuntimeVariableAssignmentTokenValue(source, assignmentContext)
          : value;

    const scopedVariables = buildRuntimeVariableAssignmentContext(context.variables);
    scopedVariables[scope][target] = clone(nextValue);

    const change: RuntimeVariableAssignmentChange = {
      nodeId: context.node.id,
      scope,
      target,
      previousValue: clone(previousValue),
      nextValue: clone(nextValue),
      assignedAt: nowIso(),
    };

    return {
      kind: "advance",
      output: {
        [target]: clone(nextValue),
        lastAssignedVariable: target,
        lastAssignedScope: scope,
        lastAssignedValue: clone(nextValue),
        runtimeVariableScopes: scopedVariables,
        runtimeVariableChanges: [
          ...readRuntimeVariableAssignmentChanges(context.variables),
          change,
        ],
        runtimeVariableLastChange: change,
      },
    };
  }
}

class FlowJumpWorkflowNodeAdapter implements WorkflowNodeAdapter {
  readonly type = "flow_jump";

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const configuredTarget = normalizeOptionalString(
      resolveNodeTemplateValue(
        getNodeConfigDefaultValue(context.node, "targetNodeId"),
        context.variables,
      ),
    );
    const fallbackTarget =
      getNodeConfigString(context.node, "nextNodeId") ||
      getNodeConfigString(context.node, "target");
    const targetNodeId = configuredTarget || fallbackTarget;

    if (!targetNodeId) {
      return {
        kind: "error",
        message: `Flow jump node ${context.node.id} requires a targetNodeId.`,
      };
    }

    const jumpEdge = context.definition.edgeSchemas.find(
      edge =>
        edge.fromNodeId === context.node.id &&
        edge.toNodeId === targetNodeId &&
        edge.kind === "jump",
    );
    if (!jumpEdge) {
      return {
        kind: "error",
        message:
          `Flow jump node ${context.node.id} cannot jump to ${targetNodeId} ` +
          "without an explicit jump edge.",
        output: {
          requestedTargetNodeId: targetNodeId,
          jumpValidated: false,
        },
      };
    }

    const reason =
      normalizeOptionalString(
        resolveNodeTemplateValue(
          getNodeConfigDefaultValue(context.node, "reason"),
          context.variables,
        ),
      ) ||
      normalizeOptionalString(getNodeConfigDefaultValue(context.node, "label")) ||
      normalizeOptionalString(jumpEdge.label) ||
      "flow_jump";

    return {
      kind: "advance",
      nextNodeId: targetNodeId,
      output: {
        jumpTargetNodeId: targetNodeId,
        jumpEdgeId: jumpEdge.id,
        jumpValidated: true,
        jumpReason: reason,
      },
    };
  }
}

class EndWorkflowNodeAdapter implements WorkflowNodeAdapter {
  readonly type = "end";

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const configuredStatus = resolveNodeTemplateValue(
      getNodeConfigDefaultValue(context.node, "status"),
      context.variables,
    );
    const configuredSummary = resolveNodeTemplateValue(
      getNodeConfigDefaultValue(context.node, "summary"),
      context.variables,
    );
    const configuredArtifacts = resolveNodeTemplateValue(
      getNodeConfigDefaultValue(context.node, "artifacts"),
      context.variables,
    );
    const configuredResult = resolveNodeTemplateValue(
      getNodeConfigDefaultValue(context.node, "output"),
      context.variables,
    );

    const fallbackSummary =
      typeof context.variables.summary === "string" && context.variables.summary.trim()
        ? context.variables.summary.trim()
        : typeof context.variables.directive === "string" &&
            context.variables.directive.trim()
          ? context.variables.directive.trim()
          : undefined;
    const fallbackStatus =
      typeof context.variables.status === "string" && context.variables.status.trim()
        ? context.variables.status.trim()
        : "completed";

    const output: Record<string, unknown> = {
      status:
        typeof configuredStatus === "string" && configuredStatus.trim()
          ? configuredStatus.trim()
          : fallbackStatus,
      finalVariables: clone(context.variables),
    };

    const summary =
      typeof configuredSummary === "string" && configuredSummary.trim()
        ? configuredSummary.trim()
        : fallbackSummary;
    if (summary) {
      output.summary = summary;
    }

    const artifacts =
      configuredArtifacts !== undefined
        ? configuredArtifacts
        : context.variables.artifactRefs ?? context.variables.artifacts;
    if (artifacts !== undefined) {
      output.artifacts = artifacts;
    }

    const result =
      configuredResult !== undefined
        ? configuredResult
        : context.variables.result ?? context.variables.output;
    if (result !== undefined) {
      output.result = result;
    }

    return {
      kind: "complete",
      output,
    };
  }
}

class ConditionWorkflowNodeAdapter implements WorkflowNodeAdapter {
  readonly type = "condition";

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    // New path: rules-based evaluation (14 operators + AND/OR)
    const rulesRaw = getNodeConfigDefaultValue(context.node, "rules");
    if (Array.isArray(rulesRaw) && rulesRaw.length > 0) {
      const relation: ConditionRelation =
        (getNodeConfigDefaultValue(context.node, "relation") as string)?.toUpperCase() === "OR"
          ? "OR"
          : "AND";

      const rulesResult = evaluateConditionRules(
        rulesRaw as ConditionRule[],
        relation,
        context.variables,
      );

      const branchKey = rulesResult.matched ? "true" : "false";
      const branchEdge = context.definition.edgeSchemas.find(
        edge =>
          edge.fromNodeId === context.node.id &&
          edge.kind === "conditional" &&
          typeof edge.label === "string" &&
          edge.label.trim() === branchKey,
      );

      return {
        kind: "advance",
        output: {
          conditionMode: "rules",
          conditionRelation: relation,
          conditionMatched: rulesResult.matched,
          conditionResults: rulesResult.results,
          branchKey,
        },
        nextNodeId: branchEdge?.toNodeId,
      };
    }

    // Legacy path: expression-based evaluation (backward compatible)
    const expression =
      normalizeOptionalString(
        resolveNodeTemplateValue(
          getNodeConfigDefaultValue(context.node, "expression"),
          context.variables,
        ),
      ) || "";

    const evaluation = evaluateRuntimeConditionExpression(
      expression,
      context.variables,
    );

    if (evaluation.error) {
      return {
        kind: "error",
        message: evaluation.error,
        output: {
          conditionExpression: expression,
          conditionMatched: false,
          branchKey: "error",
          conditionError: evaluation.error,
        },
      };
    }

    const branchKey = evaluation.matched ? "true" : "false";
    const branchEdge = context.definition.edgeSchemas.find(
      edge =>
        edge.fromNodeId === context.node.id &&
        edge.kind === "conditional" &&
        typeof edge.label === "string" &&
        edge.label.trim() === branchKey,
    );

    return {
      kind: "advance",
      output: {
        conditionExpression: expression,
        conditionMatched: evaluation.matched,
        branchKey,
        rationale: evaluation.rationale,
      },
      nextNodeId: branchEdge?.toNodeId,
    };
  }
}

class HitlChoiceAdapter implements WorkflowNodeAdapter {
  constructor(
    readonly type: string,
    private readonly options?: {
      promptFallback?: string;
      waitingForFallback?: string;
      branchFrom?: "optionId" | "branchKey";
    },
  ) {}

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const options = getHitlChoiceOptions(context.node);
    const prompt =
      getNodeConfigString(context.node, "prompt") ||
      getNodeConfigString(context.node, "title") ||
      context.node.description ||
      this.options?.promptFallback ||
      "Please choose an option";
    const waitingFor =
      getNodeConfigString(context.node, "waitingFor") ||
      prompt ||
      this.options?.waitingForFallback ||
      "waiting_for_choice";

    return {
      kind: "wait",
      waitingFor,
      inputSchema: [
        {
          key: isMultiSelectNode(context.node) ? "optionIds" : "optionId",
          label: "Selection",
          valueType: isMultiSelectNode(context.node) ? "array" : "string",
          required: true,
          description: buildChoiceDescription(options),
        },
      ],
      checkpointData: {
        nodeType: this.type,
        prompt,
        options,
        multiple: isMultiSelectNode(context.node),
      },
    };
  }

  async resume(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const options = getHitlChoiceOptions(context.node);
    const selectedIds = normalizeSelectionPayload(context.resumePayload);
    if (selectedIds.length === 0) {
      return {
        kind: "error",
        message: "Missing required selection payload",
      };
    }

    const selectedOptions = options.filter(option => selectedIds.includes(option.id));
    if (selectedOptions.length === 0) {
      return {
        kind: "error",
        message: `Selected option is not defined for node ${context.node.id}`,
      };
    }

    const output: Record<string, unknown> = {
      selection: selectedIds[0],
      selectedOptionId: selectedIds[0],
      selectedOptionIds: selectedIds,
      branchKey:
        this.options?.branchFrom === "branchKey"
          ? getPayloadString(context.resumePayload, "branchKey") || selectedIds[0]
          : selectedIds[0],
      selectedLabel: selectedOptions[0]?.label,
      selectedLabels: selectedOptions.map(option => option.label),
    };

    const requestedNextNodeId = getPayloadString(context.resumePayload, "nextNodeId");
    if (requestedNextNodeId) {
      return {
        kind: "advance",
        output,
        nextNodeId: requestedNextNodeId,
      };
    }

    const branchCandidate =
      this.options?.branchFrom === "branchKey"
        ? getPayloadString(context.resumePayload, "branchKey") || selectedIds[0]
        : selectedIds[0];
    const branchEdge = context.definition.edgeSchemas.find(
      edge =>
        edge.fromNodeId === context.node.id &&
        edge.kind === "conditional" &&
        typeof edge.label === "string" &&
        edge.label.trim() === branchCandidate,
    );

    return {
      kind: "advance",
      output,
      nextNodeId: branchEdge?.toNodeId,
    };
  }
}

class ParamCollectionWorkflowNodeAdapter implements WorkflowNodeAdapter {
  readonly type = "param_collection";

  async execute(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const fieldDefinitions = readWebAigcHitlFieldDefinitions({
      fields:
        getNodeConfigDefaultValue(context.node, "fields") ??
        getNodeConfigDefaultValue(context.node, "fieldDefinitions"),
    });
    const prompt =
      getNodeConfigString(context.node, "prompt") ||
      getNodeConfigString(context.node, "title") ||
      context.node.description ||
      "Collect structured parameters";
    const waitingFor =
      getNodeConfigString(context.node, "waitingFor") ||
      prompt ||
      "param_collection";

    return {
      kind: "wait",
      waitingFor,
      inputSchema: fieldDefinitions.map(field => ({
        key: field.key,
        label: field.label,
        valueType:
          field.type === "number"
            ? "number"
            : field.type === "boolean"
              ? "boolean"
              : "string",
        required: field.required,
        description: field.placeholder,
        defaultValue: field.defaultValue,
      })),
      checkpointData: {
        nodeType: this.type,
        prompt,
        fieldDefinitions,
      },
    };
  }

  async resume(
    context: WorkflowNodeExecutionContext,
  ): Promise<WorkflowNodeAdapterResult> {
    const fieldDefinitions = readWebAigcHitlFieldDefinitions({
      fields:
        getNodeConfigDefaultValue(context.node, "fields") ??
        getNodeConfigDefaultValue(context.node, "fieldDefinitions"),
    });
    const normalized = normalizeWebAigcHitlFormData(
      fieldDefinitions,
      context.resumePayload?.formData ?? context.resumePayload,
    );

    if (normalized.errors.length > 0) {
      return {
        kind: "error",
        message:
          normalized.errors[0] ||
          `Invalid param_collection payload for node ${context.node.id}`,
      };
    }

    const output: Record<string, unknown> = {
      formData: normalized.value,
      collectedParams: normalized.value,
      fieldCount: Object.keys(normalized.value).length,
    };

    const requestedNextNodeId = getPayloadString(
      context.resumePayload,
      "nextNodeId",
    );
    if (requestedNextNodeId) {
      return {
        kind: "advance",
        output,
        nextNodeId: requestedNextNodeId,
      };
    }

    return {
      kind: "advance",
      output,
    };
  }
}

export class WorkflowRuntimeEngine {
  constructor(
    private readonly runtime: WorkflowRuntime,
    private readonly adapters: InMemoryWorkflowNodeAdapterRegistry = new InMemoryWorkflowNodeAdapterRegistry(),
  ) {
    this.registerBuiltInAdapters();
  }

  registerAdapter(adapter: WorkflowNodeAdapter): void {
    this.adapters.register(adapter);
  }

  private registerBuiltInAdapters(): void {
    this.registerAdapter(new EchoWorkflowNodeAdapter());
    this.registerAdapter(new ChatWorkflowNodeAdapter("llm", this.runtime));
    this.registerAdapter(new ChatWorkflowNodeAdapter("dialogue", this.runtime));
    this.registerAdapter(new VariableAssignmentWorkflowNodeAdapter());
    this.registerAdapter(new ParamCollectionWorkflowNodeAdapter());
    this.registerAdapter(new FlowJumpWorkflowNodeAdapter());
    this.registerAdapter(new ConditionWorkflowNodeAdapter());
    this.registerAdapter(new EndWorkflowNodeAdapter());
    for (const type of ["root", "agent_task", "plan", "review", "audit", "summary"]) {
      this.registerAdapter(new ProjectionPassThroughAdapter(type));
    }
    this.registerAdapter(
      new HitlChoiceAdapter("selection", {
        promptFallback: "Select a follow-up branch",
        waitingForFallback: "selection",
        branchFrom: "optionId",
      }),
    );
    this.registerAdapter(
      new HitlChoiceAdapter("confirm_judge", {
        promptFallback: "Confirm or reject the current action",
        waitingForFallback: "confirmation",
        branchFrom: "branchKey",
      }),
    );
  }

  getState(
    workflowId: string,
    mission?: MissionRecord,
  ): StoredWebAigcRuntimeState | undefined {
    const workflow = this.runtime.workflowRepo.getWorkflow(workflowId);
    if (!workflow) return undefined;

    const existing = readStoredWebAigcRuntimeState(workflow);
    if (existing) {
      return existing;
    }

    const tasks = this.runtime.workflowRepo.getTasksByWorkflow(workflowId);
    const definition = buildWorkflowGraphDefinition({
      workflow,
      tasks,
      mission,
    });
    const instance = buildWorkflowGraphInstance({
      workflow,
      tasks,
      mission,
      definition,
    });

    return {
      domainModelVersion: 1,
      definition,
      instance,
      updatedAt: nowIso(),
    };
  }

  initialize(input: {
    workflowId: string;
    definition: WebAigcGraphDefinition;
    variables?: Record<string, unknown>;
  }): StoredWebAigcRuntimeState {
    const workflow = this.runtime.workflowRepo.getWorkflow(input.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${input.workflowId}`);
    }

    const createdAt = nowIso();
    const governanceApplied = applyRuntimeGovernancePolicyOverride(
      clone(input.variables || {}),
      input.definition.metadata && isRecord(input.definition.metadata)
        ? input.definition.metadata.runtimeGovernance
        : undefined,
    );
    const instance: WebAigcGraphInstance = {
      kind: "graph_instance",
      version: 1,
      instanceId: input.workflowId,
      definitionId: input.definition.definitionId,
      status: "PENDING",
      currentNodeId: input.definition.entryNodeId,
      createdAt: workflow.created_at || createdAt,
      startedAt: null,
      completedAt: null,
      links: {
        workflowId: input.workflowId,
        missionId: input.definition.links.missionId,
        sessionId: input.definition.links.sessionId,
        replayId: input.definition.links.replayId,
        auditId: input.definition.links.auditId,
      },
      variables: governanceApplied.variables,
      nodeRuns: input.definition.nodeSchemas.map(node => ({
        nodeId: node.id,
        status: "PENDING",
        attempts: 0,
        startedAt: null,
        completedAt: null,
      })),
      edgeTransitions: input.definition.edgeSchemas.map(edge => ({
        edgeId: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: edge.kind,
        status: "known",
      })),
    };

    const state: StoredWebAigcRuntimeState = {
      domainModelVersion: 1,
      definition: clone(input.definition),
      instance,
      updatedAt: createdAt,
    };

    this.persistState(input.workflowId, state);
    return state;
  }

  async runToCheckpoint(input: {
    workflowId: string;
    definition?: WebAigcGraphDefinition;
    variables?: Record<string, unknown>;
    maxSteps?: number;
  }): Promise<StoredWebAigcRuntimeState> {
    const workflow = this.requireWorkflow(input.workflowId);
    let state = readStoredWebAigcRuntimeState(workflow);
    if (!state) {
      state = this.initialize({
        workflowId: input.workflowId,
        definition:
          input.definition ||
          buildWorkflowGraphDefinition({
            workflow,
            tasks: this.runtime.workflowRepo.getTasksByWorkflow(input.workflowId),
          }),
        variables: input.variables,
      });
    } else if (input.definition?.metadata && isRecord(input.definition.metadata)) {
      const applied = applyRuntimeGovernancePolicyOverride(
        state.instance.variables,
        input.definition.metadata.runtimeGovernance,
      );
      state = {
        ...state,
        instance: {
          ...state.instance,
          variables: applied.variables,
        },
        updatedAt: nowIso(),
      };
      this.persistState(input.workflowId, state);
    }

    const limit = Math.max(1, input.maxSteps || 50);
    for (let step = 0; step < limit; step += 1) {
      if (
        isTerminalWebAigcStatus(state.instance.status) ||
        state.instance.status === "WAITING_INPUT"
      ) {
        break;
      }

      state = await this.executeCurrentNode(state);
      if (
        isTerminalWebAigcStatus(state.instance.status) ||
        state.instance.status === "WAITING_INPUT"
      ) {
        break;
      }
    }

    return state;
  }

  async resume(
    workflowId: string,
    payload: Record<string, unknown> = {},
  ): Promise<StoredWebAigcRuntimeState> {
    const workflow = this.requireWorkflow(workflowId);
    const state = readStoredWebAigcRuntimeState(workflow);
    if (!state) {
      throw new Error(`Workflow runtime state not found: ${workflowId}`);
    }
    if (!state.instance.checkpoint) {
      throw new Error(`Workflow is not waiting for input: ${workflowId}`);
    }

    const checkpoint = state.instance.checkpoint;
    const nextState = clone(state);
    nextState.instance.status = "EXECUTING";
    nextState.instance.variables = {
      ...nextState.instance.variables,
      ...payload,
    };
    nextState.instance.checkpoint = {
      ...checkpoint,
      resumeCount: checkpoint.resumeCount + 1,
      payload: {
        ...(checkpoint.payload || {}),
        ...payload,
      },
    };
    this.persistState(workflowId, nextState);
    const resumed = await this.executeCurrentNode(nextState, payload);
    if (
      resumed.instance.status === "EXECUTING" &&
      !resumed.instance.checkpoint
    ) {
      return this.runToCheckpoint({ workflowId, maxSteps: 50 });
    }
    return resumed;
  }

  private terminateState(
    state: StoredWebAigcRuntimeState,
    input: {
      requestedBy?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): StoredWebAigcRuntimeState {
    const nextState = clone(state);
    const latestLoopContext = readLatestLoopTrackerContext(nextState.instance.variables);
    nextState.instance.status = "FORCE_TERMINATED";
    nextState.instance.error = input.reason?.trim() || "Workflow runtime terminated by operator.";
    nextState.instance.completedAt = nowIso();
    nextState.instance.checkpoint = undefined;
    nextState.instance.variables = {
      ...nextState.instance.variables,
      runtimeTermination: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        terminatedAt: nextState.instance.completedAt,
        governance: buildRuntimeGovernanceSnapshot(
          readRuntimeGovernancePolicy(nextState.instance.variables),
          readRuntimeGovernanceState(nextState.instance.variables),
        ),
        ...(latestLoopContext ? { loop: clone(latestLoopContext) } : {}),
      },
    };

    const currentNode = nextState.instance.currentNodeId
      ? nextState.definition.nodeSchemas.find(
          node => node.id === nextState.instance.currentNodeId,
        )
      : undefined;
    const currentRun = currentNode
      ? ensureNodeRun(nextState.instance, currentNode.id)
      : undefined;
    if (
      currentRun &&
      currentRun.status !== "EXECUTED" &&
      currentRun.status !== "SKIPPED"
    ) {
      currentRun.status = "FORCE_TERMINATED";
      currentRun.completedAt = nextState.instance.completedAt;
      currentRun.error = nextState.instance.error;
      currentRun.waitingFor = undefined;
    }

    this.persistState(nextState.instance.instanceId, nextState);
    this.emitRuntimeNodeEvent({
      state: nextState,
      eventKey: "instance.terminated",
      node: currentNode,
      run: currentRun,
      error: nextState.instance.error,
      timestamp: nextState.instance.completedAt,
      metadata: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        governance: buildRuntimeGovernanceSnapshot(
          readRuntimeGovernancePolicy(nextState.instance.variables),
          readRuntimeGovernanceState(nextState.instance.variables),
        ),
        ...(latestLoopContext ? { loop: clone(latestLoopContext) } : {}),
        ...input.metadata,
      },
    });

    return nextState;
  }

  terminate(
    workflowId: string,
    input: {
      requestedBy?: string;
      reason?: string;
    } = {},
  ): StoredWebAigcRuntimeState {
    const workflow = this.requireWorkflow(workflowId);
    const state = readStoredWebAigcRuntimeState(workflow);
    if (!state) {
      throw new Error(`Workflow runtime state not found: ${workflowId}`);
    }
    return this.terminateState(state, input);
  }

  async retry(
    workflowId: string,
    input: {
      requestedBy?: string;
      reason?: string;
      maxSteps?: number;
    } = {},
  ): Promise<StoredWebAigcRuntimeState> {
    const workflow = this.requireWorkflow(workflowId);
    const state = readStoredWebAigcRuntimeState(workflow);
    if (!state) {
      throw new Error(`Workflow runtime state not found: ${workflowId}`);
    }
    if (state.instance.status !== "EXCEPTION") {
      throw new Error(`Workflow is not in exception state: ${workflowId}`);
    }

    const nextState = clone(state);
    const currentNodeId = nextState.instance.currentNodeId;
    if (!currentNodeId) {
      throw new Error(`Workflow has no retryable current node: ${workflowId}`);
    }

    const currentRun = ensureNodeRun(nextState.instance, currentNodeId);
    if (currentRun.retryable === false) {
      throw new Error(`Current runtime node is not retryable: ${workflowId}`);
    }

    const retryAllowance = evaluateRuntimeGovernanceRetryAllowance(
      nextState.instance.variables,
      "manual",
    );
    if (!retryAllowance.allowed) {
      const blockedAt = nowIso();
      const governanceBlocked = recordRuntimeGovernanceRetryBlocked(
        nextState.instance.variables,
        {
          blockedReason: retryAllowance.blockedReason || "manual_retry_budget_exhausted",
          blockedAt,
        },
      );
      nextState.instance.variables = {
        ...governanceBlocked.variables,
        runtimeRetryBlocked: {
          requestedBy: input.requestedBy || "operator",
          reason: input.reason?.trim() || "",
          blockedReason:
            retryAllowance.blockedReason || "manual_retry_budget_exhausted",
          blockedAt,
          nodeId: currentNodeId,
          governance: governanceBlocked.snapshot,
        },
      };
      nextState.instance.error = `Runtime retry blocked by governance policy: ${
        retryAllowance.blockedReason || "manual_retry_budget_exhausted"
      }`;
      this.persistState(workflowId, nextState);
      this.emitRuntimeNodeEvent({
        state: nextState,
        eventKey: "instance.retry_requested",
        node: nextState.definition.nodeSchemas.find(node => node.id === currentNodeId),
        run: currentRun,
        error: nextState.instance.error,
        timestamp: blockedAt,
        metadata: {
          requestedBy: input.requestedBy || "operator",
          reason: input.reason?.trim() || "",
          nodeId: currentNodeId,
          retryMode: "manual",
          allowed: false,
          blockedReason:
            retryAllowance.blockedReason || "manual_retry_budget_exhausted",
          governance: governanceBlocked.snapshot,
        },
      });
      throw new Error(nextState.instance.error);
    }

    nextState.instance.status = "EXECUTING";
    nextState.instance.error = undefined;
    nextState.instance.completedAt = null;
    nextState.instance.checkpoint = undefined;
    currentRun.status = "PENDING";
    currentRun.startedAt = null;
    currentRun.completedAt = null;
    currentRun.error = undefined;
    currentRun.waitingFor = undefined;
    currentRun.output = undefined;
    currentRun.transitionEdgeId = undefined;
    currentRun.retryable = undefined;

    const retriedAt = nowIso();
    const governanceRecorded = recordRuntimeGovernanceRetry(
      nextState.instance.variables,
      {
        mode: "manual",
        nodeId: currentNodeId,
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        retriedAt,
      },
    );
    nextState.instance.variables = {
      ...governanceRecorded.variables,
      runtimeRetry: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        retriedAt,
        nodeId: currentNodeId,
        governance: governanceRecorded.snapshot,
      },
    };

    this.persistState(workflowId, nextState);
    this.emitRuntimeNodeEvent({
      state: nextState,
      eventKey: "instance.retry_requested",
      node: nextState.definition.nodeSchemas.find(node => node.id === currentNodeId),
      run: currentRun,
      timestamp: nowIso(),
      metadata: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        nodeId: currentNodeId,
        retryMode: "manual",
        governance: governanceRecorded.snapshot,
      },
    });

    return this.runToCheckpoint({
      workflowId,
      maxSteps: input.maxSteps,
    });
  }

  escalate(
    workflowId: string,
    input: {
      requestedBy?: string;
      reason?: string;
    } = {},
  ): StoredWebAigcRuntimeState {
    const workflow = this.requireWorkflow(workflowId);
    const state = readStoredWebAigcRuntimeState(workflow);
    if (!state) {
      throw new Error(`Workflow runtime state not found: ${workflowId}`);
    }

    const nextState = clone(state);
    const currentNodeId = nextState.instance.currentNodeId;
    nextState.instance.variables = {
      ...nextState.instance.variables,
      runtimeEscalation: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        escalatedAt: nowIso(),
        nodeId: currentNodeId,
        governance: buildRuntimeGovernanceSnapshot(
          readRuntimeGovernancePolicy(nextState.instance.variables),
          readRuntimeGovernanceState(nextState.instance.variables),
        ),
      },
    };

    const checkpointCreatedAt = nowIso();
    nextState.instance.status = "WAITING_INPUT";
    nextState.instance.checkpoint = {
      nodeId: currentNodeId || nextState.definition.entryNodeId,
      waitingFor: "human escalation review",
      createdAt: checkpointCreatedAt,
      resumeCount: nextState.instance.checkpoint?.resumeCount || 0,
      payload: {
        reason: input.reason?.trim() || "",
        requestedBy: input.requestedBy || "operator",
      },
    };

    const currentNode = currentNodeId
      ? nextState.definition.nodeSchemas.find(node => node.id === currentNodeId)
      : undefined;
    const currentRun = currentNode
      ? ensureNodeRun(nextState.instance, currentNode.id)
      : undefined;
    if (currentRun) {
      currentRun.status = "WAITING_INPUT";
      currentRun.waitingFor = "human escalation review";
    }

    this.persistState(workflowId, nextState);
    this.emitRuntimeNodeEvent({
      state: nextState,
      eventKey: "instance.escalated",
      node: currentNode,
      run: currentRun,
      waitingFor: "human escalation review",
      timestamp: checkpointCreatedAt,
      metadata: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        governance: buildRuntimeGovernanceSnapshot(
          readRuntimeGovernancePolicy(nextState.instance.variables),
          readRuntimeGovernanceState(nextState.instance.variables),
        ),
      },
    });

    return nextState;
  }

  private requireWorkflow(workflowId: string): WorkflowRecord {
    const workflow = this.runtime.workflowRepo.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    return workflow;
  }

  private persistState(workflowId: string, state: StoredWebAigcRuntimeState): void {
    const workflow = this.requireWorkflow(workflowId);
    const currentNode = state.definition.nodeSchemas.find(
      node => node.id === state.instance.currentNodeId,
    );
    const results =
      workflow.results && typeof workflow.results === "object" ? workflow.results : {};

    this.runtime.workflowRepo.updateWorkflow(workflowId, {
      status: toCubeWorkflowStatus(state.instance.status) as WorkflowRecord["status"],
      current_stage:
        workflow.current_stage || currentNode?.stageKey || state.instance.currentNodeId,
      completed_at: state.instance.completedAt,
      results: {
        ...results,
        webAigcRuntime: {
          ...state,
          updatedAt: nowIso(),
        },
      },
    });
  }

  private persistFinalReportForRuntimeCompletion(
    workflowId: string,
    state: StoredWebAigcRuntimeState,
  ): void {
    const workflow = this.requireWorkflow(workflowId);
    const results =
      workflow.results && typeof workflow.results === "object" ? workflow.results : {};

    const rootNode =
      state.definition.nodeSchemas.find(node => node.id === state.definition.entryNodeId) ||
      state.definition.nodeSchemas[0];
    const tasks = this.runtime.workflowRepo.getTasksByWorkflow(workflowId);
    const messages = this.runtime.workflowRepo.getMessagesByWorkflow(workflowId);
    const scoredTasks = tasks.filter(task => task.total_score !== null);
    const averageScore =
      scoredTasks.length > 0
        ? scoredTasks.reduce((sum, task) => sum + (task.total_score || 0), 0) /
          scoredTasks.length
        : null;

    const errorIssues = state.instance.nodeRuns
      .filter(nodeRun => Boolean(nodeRun.error))
      .map(
        nodeRun =>
          `${nodeRun.nodeId}: ${nodeRun.error || "Node execution failed without detail"}`,
      );
    const waitingIssues = state.instance.nodeRuns
      .filter(nodeRun => nodeRun.status === "WAITING_INPUT" && nodeRun.waitingFor)
      .map(
        nodeRun => `${nodeRun.nodeId}: waiting for ${nodeRun.waitingFor}`,
      );

    const report: FinalWorkflowReportRecord = {
      kind: "final_workflow_report",
      version: 1,
      workflowId,
      generatedAt: nowIso(),
      workflow: {
        rootAgentId: rootNode?.agentId || "web-aigc-runtime",
        rootAgentName: rootNode?.title || rootNode?.id || "Web-AIGC Runtime",
        directive: workflow.directive,
        status: workflow.status,
        currentStage: workflow.current_stage,
        startedAt: workflow.started_at,
        completedAt: workflow.completed_at,
        departmentsInvolved: workflow.departments_involved || [],
      },
      stats: {
        messageCount: messages.length,
        taskCount: tasks.length,
        passedTaskCount: tasks.filter(task => task.status === "passed").length,
        revisedTaskCount: tasks.filter(task => task.version > 1).length,
        averageScore,
      },
      departmentReports: [],
      ceoFeedback: "",
      keyIssues: [...errorIssues, ...waitingIssues].slice(0, 12),
      tasks: tasks.map(task => ({
        id: task.id,
        department: task.department,
        workerId: task.worker_id,
        managerId: task.manager_id,
        status: task.status,
        totalScore: task.total_score,
        description: task.description,
        deliverablePreview: bestDeliverable(task).substring(0, 800),
      })),
    };

    const savedReport = this.runtime.reportRepo.saveFinalWorkflowReport(report);
    this.runtime.workflowRepo.updateWorkflow(workflowId, {
      results: {
        ...results,
        final_report: {
          generated_at: report.generatedAt,
          json_path: savedReport.jsonPath,
          markdown_path: savedReport.markdownPath,
          overview: {
            department_count: report.departmentReports.length,
            task_count: report.stats.taskCount,
            passed_task_count: report.stats.passedTaskCount,
            average_score: report.stats.averageScore,
            message_count: report.stats.messageCount,
          },
        },
      },
    });
  }

  private emitRuntimeCompletionEvent(
    workflowId: string,
    state: StoredWebAigcRuntimeState,
  ): void {
    const summary =
      typeof state.instance.output?.summary === "string" && state.instance.output.summary.trim()
        ? state.instance.output.summary.trim()
        : state.instance.error
          ? `Workflow runtime completed with error: ${state.instance.error}`
          : `Workflow runtime completed at node ${state.instance.currentNodeId || "unknown"}`;

    this.runtime.eventEmitter.emit({
      type: "workflow_complete",
      workflowId,
      status: "completed",
      summary,
    });
  }

  private emitRuntimeNodeEvent(input: {
    state: StoredWebAigcRuntimeState;
    eventKey: string;
    node?: WebAigcNodeSchema;
    run?: WebAigcNodeRunRecord;
    edge?: {
      edgeId?: string;
      fromNodeId?: string;
      toNodeId?: string;
      kind?: string;
    };
    waitingFor?: string;
    error?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const { state } = input;
    const timestamp = input.timestamp || nowIso();
    const workflowId =
      state.instance.links.workflowId || state.definition.links.workflowId || state.instance.instanceId;
    const checkpointId = state.instance.checkpoint
      ? `${state.instance.checkpoint.nodeId}:${state.instance.checkpoint.createdAt}`
      : undefined;
    const relationLinks = buildRuntimeRelationLinks(input);

    this.runtime.eventEmitter.emit({
      type: "web_aigc_runtime_event",
      workflowId,
      instanceId: state.instance.instanceId,
      eventKey: input.eventKey,
      timestamp,
      missionId: state.instance.links.missionId,
      sessionId: state.instance.links.sessionId,
      replayId: state.instance.links.replayId,
      nodeId: input.node?.id,
      edgeId: input.edge?.edgeId,
      fromNodeId: input.edge?.fromNodeId,
      toNodeId: input.edge?.toNodeId,
      status: state.instance.status,
      waitingFor: input.waitingFor,
      error: input.error,
      checkpointId,
      startedAt: input.run?.startedAt,
      completedAt: input.run?.completedAt,
      durationMs: computeDurationMs(input.run?.startedAt, input.run?.completedAt),
      metadata: mergeRuntimeEventMetadata(input.metadata, relationLinks),
    });
  }

  private finalizeIfCompleted(state: StoredWebAigcRuntimeState): void {
    if (state.instance.status !== "EXECUTED") {
      return;
    }

    this.persistFinalReportForRuntimeCompletion(state.instance.instanceId, state);
    this.emitRuntimeCompletionEvent(state.instance.instanceId, state);
  }

  private async executeCurrentNode(
    state: StoredWebAigcRuntimeState,
    resumePayload?: Record<string, unknown>,
  ): Promise<StoredWebAigcRuntimeState> {
    const nextState = clone(state);
    const { definition, instance } = nextState;
    const nodeId = instance.currentNodeId || definition.entryNodeId;
    const node = definition.nodeSchemas.find(item => item.id === nodeId);

    if (!node) {
      instance.status = "EXCEPTION";
      instance.error = `Node not found: ${nodeId}`;
      instance.completedAt = nowIso();
      this.persistState(instance.instanceId, nextState);
      return nextState;
    }

    const run = ensureNodeRun(instance, node.id);
    run.attempts += 1;
    run.startedAt = run.startedAt || nowIso();
    run.status = "EXECUTING";
    instance.status = "EXECUTING";
    instance.currentNodeId = node.id;
    this.persistState(instance.instanceId, nextState);
    this.emitRuntimeNodeEvent({
      state: nextState,
      eventKey: "node.started",
      node,
      run,
      timestamp: run.startedAt || nowIso(),
    });

    const adapter = this.adapters.get(node.type);
    if (!adapter) {
      run.status = "EXCEPTION";
      run.error = `Adapter not registered: ${node.type}`;
      run.completedAt = nowIso();
      instance.status = "EXCEPTION";
      instance.error = run.error;
      instance.completedAt = run.completedAt;
      this.persistState(instance.instanceId, nextState);
      return nextState;
    }

    let result: WorkflowNodeAdapterResult;
    try {
      const context: WorkflowNodeExecutionContext = {
        definition,
        instance,
        node,
        input: clone(instance.variables),
        variables: clone(instance.variables),
        resumePayload,
      };
      if (resumePayload && adapter.resume) {
        result = await adapter.resume(context);
      } else {
        result = await adapter.execute(context);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.status = "EXCEPTION";
      run.error = message;
      run.completedAt = nowIso();
      instance.status = "EXCEPTION";
      instance.error = message;
      instance.completedAt = run.completedAt;
      this.persistState(instance.instanceId, nextState);
      return nextState;
    }

    await this.applyAdapterResult(nextState, node, run, result);
    this.persistState(instance.instanceId, nextState);
    this.finalizeIfCompleted(nextState);
    return nextState;
  }

  private async applyAdapterResult(
    state: StoredWebAigcRuntimeState,
    node: WebAigcNodeSchema,
    run: WebAigcNodeRunRecord,
    result: WorkflowNodeAdapterResult,
  ): Promise<void> {
    const { definition, instance } = state;
    if (result.output) {
      run.output = clone(result.output);
      instance.variables = {
        ...instance.variables,
        ...result.output,
      };
    }

    const variableAssignmentChange =
      node.type === "variable_assignment"
        ? readRuntimeVariableAssignmentChange(result.output)
        : undefined;
    if (variableAssignmentChange) {
      this.emitRuntimeNodeEvent({
        state,
        eventKey: "variable.assigned",
        node,
        run,
        timestamp: variableAssignmentChange.assignedAt,
        metadata: {
          scope: variableAssignmentChange.scope,
          target: variableAssignmentChange.target,
          previousValue: variableAssignmentChange.previousValue,
          nextValue: variableAssignmentChange.nextValue,
        },
      });
    }

    if (result.kind === "wait") {
      run.status = "WAITING_INPUT";
      run.waitingFor = result.waitingFor;
      instance.status = "WAITING_INPUT";
      instance.checkpoint = {
        nodeId: node.id,
        waitingFor: result.waitingFor,
        createdAt: nowIso(),
        resumeCount: instance.checkpoint?.resumeCount || 0,
        inputSchema: result.inputSchema,
        payload: result.checkpointData,
      };
      this.emitRuntimeNodeEvent({
        state,
        eventKey: "node.waiting_input",
        node,
        run,
        waitingFor: result.waitingFor,
        timestamp: instance.checkpoint.createdAt,
      });
      return;
    }

    if (result.kind === "error") {
      run.status = "EXCEPTION";
      run.error = result.message;
      run.retryable = result.retryable;
      run.completedAt = nowIso();
      instance.status = "EXCEPTION";
      instance.error = result.message;
      instance.completedAt = run.completedAt;
      this.emitRuntimeNodeEvent({
        state,
        eventKey: "node.failed",
        node,
        run,
        error: result.message,
        timestamp: run.completedAt || nowIso(),
      });

      const handledAutomatically = await this.applyAutomaticFailureStrategy(
        state,
        node,
        run,
        result,
      );
      if (handledAutomatically) {
        return;
      }
      return;
    }

    run.status = "EXECUTED";
    run.completedAt = nowIso();
    run.waitingFor = undefined;
    instance.checkpoint = undefined;

    if (result.kind === "complete") {
      instance.status = "EXECUTED";
      instance.output = result.output ? clone(result.output) : instance.output;
      instance.currentNodeId = node.id;
      instance.completedAt = nowIso();
      this.emitRuntimeNodeEvent({
        state,
        eventKey: "node.completed",
        node,
        run,
        timestamp: run.completedAt,
      });
      return;
    }

    const transition = resolveNextNodeId(definition, node.id, result);
    if (!transition.nextNodeId) {
      instance.status = "EXECUTED";
      instance.currentNodeId = node.id;
      instance.output = result.output ? clone(result.output) : instance.output;
      instance.completedAt = nowIso();
      this.emitRuntimeNodeEvent({
        state,
        eventKey: "node.completed",
        node,
        run,
        timestamp: run.completedAt,
      });
      return;
    }

    const transitionEdge = definition.edgeSchemas.find(edge => edge.id === transition.edgeId);
    const transitionKind = transitionEdge?.kind || "success";
    const transitionTimestamp = nowIso();

    run.transitionEdgeId = transition.edgeId;
    this.emitRuntimeNodeEvent({
      state,
      eventKey: "node.completed",
      node,
      run,
      timestamp: run.completedAt,
    });

    if (transitionKind === "loop") {
      const loopKey = transition.edgeId || `${node.id}->${transition.nextNodeId}`;
      const loopTracker = ensureLoopRuntimeTrackerEntry(instance.variables, loopKey);
      instance.variables = loopTracker.variables;
      const nextIterationIndex = readLoopIterationCount(instance.variables, loopKey) + 1;
      const maxIterations = readLoopEdgeLimitNumber(transitionEdge, "maxIterations");
      if (typeof maxIterations === "number" && maxIterations >= 0 && nextIterationIndex > Math.floor(maxIterations)) {
        markEdgeBlocked(instance, transition.edgeId);
        instance.variables = updateLoopRuntimeTracker(instance.variables, loopKey, {
          startedAt: loopTracker.entry.startedAt,
          lastBlockedAt: transitionTimestamp,
          lastBlockedReason: "max_iterations_exceeded",
          lastAttemptedIterationIndex: nextIterationIndex,
          maxIterations: Math.floor(maxIterations),
        });
        instance.variables = {
          ...instance.variables,
          runtimeLoopTermination: {
            loopKey,
            iterationIndex: nextIterationIndex,
            reason: "max_iterations_exceeded",
            maxIterations: Math.floor(maxIterations),
            terminatedAt: transitionTimestamp,
            edgeId: transition.edgeId,
            fromNodeId: node.id,
            toNodeId: transition.nextNodeId,
          },
        };
        const terminated = this.terminateState(state, {
          requestedBy: "runtime.loop_guard",
          reason: `Loop edge ${loopKey} exceeded maxIterations (${Math.floor(maxIterations)}).`,
          metadata: {
            trigger: "loop_guard.max_iterations",
            kind: transitionKind,
            loopKey,
            iterationIndex: nextIterationIndex,
            maxIterations: Math.floor(maxIterations),
            edgeId: transition.edgeId,
            fromNodeId: node.id,
            toNodeId: transition.nextNodeId,
          },
        });
        state.instance = terminated.instance;
        state.updatedAt = terminated.updatedAt;
        return;
      }

      const startedAtValue = loopTracker.entry.startedAt;
      const startedAtMs = startedAtValue ? Date.parse(startedAtValue) : Number.NaN;
      const maxDurationMs = readLoopEdgeLimitNumber(transitionEdge, "maxDurationMs");
      const elapsedMs =
        Number.isFinite(startedAtMs)
          ? Math.max(0, Date.parse(transitionTimestamp) - startedAtMs)
          : undefined;
      if (
        typeof maxDurationMs === "number" &&
        maxDurationMs >= 0 &&
        typeof elapsedMs === "number" &&
        elapsedMs > Math.floor(maxDurationMs)
      ) {
        markEdgeBlocked(instance, transition.edgeId);
        instance.variables = updateLoopRuntimeTracker(instance.variables, loopKey, {
          startedAt: startedAtValue,
          lastBlockedAt: transitionTimestamp,
          lastBlockedReason: "max_duration_exceeded",
          lastAttemptedIterationIndex: nextIterationIndex,
          maxDurationMs: Math.floor(maxDurationMs),
          elapsedMs,
        });
        instance.variables = {
          ...instance.variables,
          runtimeLoopTermination: {
            loopKey,
            iterationIndex: nextIterationIndex,
            reason: "max_duration_exceeded",
            maxDurationMs: Math.floor(maxDurationMs),
            elapsedMs,
            terminatedAt: transitionTimestamp,
            edgeId: transition.edgeId,
            fromNodeId: node.id,
            toNodeId: transition.nextNodeId,
          },
        };
        const terminated = this.terminateState(state, {
          requestedBy: "runtime.loop_guard",
          reason: `Loop edge ${loopKey} exceeded maxDurationMs (${Math.floor(maxDurationMs)}ms).`,
          metadata: {
            trigger: "loop_guard.max_duration",
            kind: transitionKind,
            loopKey,
            iterationIndex: nextIterationIndex,
            maxDurationMs: Math.floor(maxDurationMs),
            elapsedMs,
            edgeId: transition.edgeId,
            fromNodeId: node.id,
            toNodeId: transition.nextNodeId,
          },
        });
        state.instance = terminated.instance;
        state.updatedAt = terminated.updatedAt;
        return;
      }

      const loopIteration = recordLoopIteration(instance.variables, loopKey);
      instance.variables = updateLoopRuntimeTracker(loopIteration.variables, loopKey, {
        startedAt: startedAtValue,
        lastIteratedAt: transitionTimestamp,
        iterationIndex: loopIteration.iterationIndex,
        edgeId: transition.edgeId,
        fromNodeId: node.id,
        toNodeId: transition.nextNodeId,
        ...(typeof maxIterations === "number"
          ? { maxIterations: Math.floor(maxIterations) }
          : {}),
        ...(typeof maxDurationMs === "number"
          ? {
              maxDurationMs: Math.floor(maxDurationMs),
              elapsedMs: elapsedMs ?? 0,
            }
          : {}),
      });
    }

    markEdgeExecuted(instance, transition.edgeId);
    this.emitRuntimeNodeEvent({
      state,
      eventKey: "edge.transitioned",
      node,
      run,
      edge: {
        edgeId: transition.edgeId,
        fromNodeId: node.id,
        toNodeId: transition.nextNodeId,
      },
      timestamp: transitionTimestamp,
      metadata: {
        kind: transitionKind,
      },
    });

    if (transitionKind === "loop") {
      const loopKey = transition.edgeId || `${node.id}->${transition.nextNodeId}`;
      this.emitRuntimeNodeEvent({
        state,
        eventKey: "edge.loop_iterated",
        node,
        run,
        edge: {
          edgeId: transition.edgeId,
          fromNodeId: node.id,
          toNodeId: transition.nextNodeId,
          kind: transitionKind,
        },
        timestamp: transitionTimestamp,
        metadata: {
          kind: transitionKind,
          loopKey,
          iterationIndex: readLoopIterationCount(instance.variables, loopKey),
        },
      });
    }

    instance.currentNodeId = transition.nextNodeId;
    instance.status = "EXECUTING";
  }

  private async applyAutomaticFailureStrategy(
    state: StoredWebAigcRuntimeState,
    node: WebAigcNodeSchema,
    run: WebAigcNodeRunRecord,
    result: Extract<WorkflowNodeAdapterResult, { kind: "error" }>,
  ): Promise<boolean> {
    if (!result.retryable) {
      return this.applyAutomaticEscalationIfConfigured(state, node, run, result, "not_retryable");
    }

    const retryBudget = Math.max(0, Math.floor(getNodeConfigNumber(node, "retryBudget") || 0));
    const governancePolicy = readRuntimeGovernancePolicy(state.instance.variables);
    const retryDelayMs = Math.max(
      0,
      Math.floor(
        getNodeConfigNumber(node, "retryDelayMs") ||
          governancePolicy.retryDelayMs ||
          0,
      ),
    );
    const escalateOnRetryExhausted = getNodeConfigBoolean(node, "escalateOnRetryExhausted") === true;
    const automaticRetryCount = this.getAutomaticRetryCount(state, node.id);
    const retryAllowance = evaluateRuntimeGovernanceRetryAllowance(
      state.instance.variables,
      "automatic",
    );

    if (
      retryBudget > 0 &&
      automaticRetryCount < retryBudget &&
      retryAllowance.allowed
    ) {
      if (retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
      await this.applyAutomaticRetry(state, node, run, automaticRetryCount + 1, retryBudget, retryDelayMs);
      return true;
    }

    if (!retryAllowance.allowed) {
      const blockedAt = nowIso();
      const governanceBlocked = recordRuntimeGovernanceRetryBlocked(
        state.instance.variables,
        {
          blockedReason:
            retryAllowance.blockedReason || "automatic_retry_budget_exhausted",
          blockedAt,
        },
      );
      state.instance.variables = {
        ...governanceBlocked.variables,
        runtimeRetryBlocked: {
          requestedBy: "runtime.auto_retry",
          reason: result.message,
          blockedReason:
            retryAllowance.blockedReason || "automatic_retry_budget_exhausted",
          blockedAt,
          nodeId: node.id,
          governance: governanceBlocked.snapshot,
        },
      };
      if (governancePolicy.escalateOnRetryBlocked) {
        return this.applyAutomaticEscalationIfConfigured(
          state,
          node,
          run,
          result,
          "retry_exhausted",
        );
      }
      return false;
    }

    if (escalateOnRetryExhausted) {
      return this.applyAutomaticEscalationIfConfigured(
        state,
        node,
        run,
        result,
        retryBudget > 0 ? "retry_exhausted" : "retry_disabled",
      );
    }

    return false;
  }

  private getAutomaticRetryCount(
    state: StoredWebAigcRuntimeState,
    nodeId: string,
  ): number {
    const tracker = state.instance.variables.runtimeAutoRetry;
    if (!isRecord(tracker)) {
      return 0;
    }

    const value = tracker[nodeId];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  }

  private async applyAutomaticRetry(
    state: StoredWebAigcRuntimeState,
    node: WebAigcNodeSchema,
    run: WebAigcNodeRunRecord,
    nextAttempt: number,
    retryBudget: number,
    retryDelayMs: number,
  ): Promise<void> {
    const retriedAt = nowIso();
    const governanceRecorded = recordRuntimeGovernanceRetry(
      state.instance.variables,
      {
        mode: "automatic",
        nodeId: node.id,
        requestedBy: "runtime.auto_retry",
        reason: `Automatic retry ${nextAttempt}/${retryBudget} for ${node.id}`,
        retriedAt,
        retryDelayMs,
      },
    );
    state.instance.status = "EXECUTING";
    state.instance.error = undefined;
    state.instance.completedAt = null;
    state.instance.checkpoint = undefined;
    state.instance.variables = {
      ...governanceRecorded.variables,
      runtimeRetry: {
        requestedBy: "runtime.auto_retry",
        reason: `Automatic retry ${nextAttempt}/${retryBudget} for ${node.id}`,
        retriedAt,
        nodeId: node.id,
        governance: governanceRecorded.snapshot,
      },
    };

    run.status = "PENDING";
    run.startedAt = null;
    run.completedAt = null;
    run.error = undefined;
    run.waitingFor = undefined;
    run.output = undefined;
    run.transitionEdgeId = undefined;
    run.retryable = undefined;

    this.emitRuntimeNodeEvent({
      state,
      eventKey: "instance.retry_requested",
      node,
      run,
      timestamp: nowIso(),
      metadata: {
        requestedBy: "runtime.auto_retry",
        reason: `Automatic retry ${nextAttempt}/${retryBudget}`,
        nodeId: node.id,
        retryAttempt: nextAttempt,
        retryBudget,
        retryDelayMs,
        automatic: true,
        retryMode: "automatic",
        governance: governanceRecorded.snapshot,
      },
    });

    const retriedState = await this.executeCurrentNode(state);
    state.instance = retriedState.instance;
    state.definition = retriedState.definition;
    state.updatedAt = retriedState.updatedAt;
  }

  private applyAutomaticEscalationIfConfigured(
    state: StoredWebAigcRuntimeState,
    node: WebAigcNodeSchema,
    run: WebAigcNodeRunRecord,
    result: Extract<WorkflowNodeAdapterResult, { kind: "error" }>,
    trigger: "not_retryable" | "retry_exhausted" | "retry_disabled",
  ): boolean {
    const autoEscalate = getNodeConfigBoolean(node, "autoEscalateOnFailure") === true;
    if (!autoEscalate) {
      return false;
    }

    const checkpointCreatedAt = nowIso();
    state.instance.status = "WAITING_INPUT";
    state.instance.error = undefined;
    state.instance.completedAt = null;
    state.instance.checkpoint = {
      nodeId: node.id,
      waitingFor: "human escalation review",
      createdAt: checkpointCreatedAt,
      resumeCount: state.instance.checkpoint?.resumeCount || 0,
      payload: {
        requestedBy: "runtime.auto_escalate",
        reason: result.message,
        trigger,
      },
    };
    state.instance.variables = {
      ...state.instance.variables,
      runtimeEscalation: {
        requestedBy: "runtime.auto_escalate",
        reason: result.message,
        escalatedAt: checkpointCreatedAt,
        nodeId: node.id,
        trigger,
        governance: buildRuntimeGovernanceSnapshot(
          readRuntimeGovernancePolicy(state.instance.variables),
          readRuntimeGovernanceState(state.instance.variables),
        ),
      },
    };

    run.status = "WAITING_INPUT";
    run.waitingFor = "human escalation review";
    run.retryable = result.retryable;

    this.emitRuntimeNodeEvent({
      state,
      eventKey: "instance.escalated",
      node,
      run,
      waitingFor: "human escalation review",
      timestamp: checkpointCreatedAt,
      metadata: {
        requestedBy: "runtime.auto_escalate",
        reason: result.message,
        trigger,
        automatic: true,
        governance: buildRuntimeGovernanceSnapshot(
          readRuntimeGovernancePolicy(state.instance.variables),
          readRuntimeGovernanceState(state.instance.variables),
        ),
      },
    });

    return true;
  }
}

export const webAigcRuntimeEngine = new WorkflowRuntimeEngine(serverRuntime);
