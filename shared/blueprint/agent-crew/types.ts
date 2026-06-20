/**
 * 子域 4：Agent Crew & Runtime Capability 的类型出口。
 *
 * 当前采用 re-export 视图（方案 B）。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 2.1（子域 4 路由：`/jobs/:id/agent-crew`、`/role-timelines`、`/capabilities`、`/capability-invocations`、`/capability-evidence`、`/sandbox-derivation-jobs`）
 * - 需求 2.4、5.1、5.2、6.3
 */

export type {
  // Runtime capability
  BlueprintRuntimeCapability,
  BlueprintRuntimeCapabilityKind,
  BlueprintRuntimeCapabilitySecurityLevel,
  BlueprintRuntimeCapabilityStatus,
  BlueprintCapabilityUsage,
  BlueprintCapabilityBinding,
  BlueprintCapabilityEvidence,
  BlueprintCapabilityEvidenceKind,
  BlueprintCapabilityEvidenceStatus,
  BlueprintCapabilityInvocation,
  BlueprintCapabilityInvocationRequest,
  BlueprintCapabilityInvocationStatus,
  BlueprintCapabilitySafetyGate,
  BlueprintCapabilitySafetyGateStatus,
  BlueprintFetchCapabilityEvidenceRequest,
  BlueprintFetchCapabilityInvocationsRequest,
  // Agent Crew / 角色
  BlueprintAgentCrew,
  BlueprintAgentRole,
  BlueprintAgentRoleGroup,
  BlueprintRoleActivationOverride,
  BlueprintRoleActivationOverrideKind,
  BlueprintRoleCapability,
  BlueprintRolePresence,
  BlueprintRolePresenceState,
  BlueprintRoleTimeline,
  BlueprintRoleTimelineCollection,
  BlueprintRoleTimelineEntry,
  BlueprintRoleTimelineFilters,
  BlueprintStageActivationPolicy,
  // Sandbox 推导作业
  BlueprintSandboxDerivationAggregate,
  BlueprintSandboxDerivationCapabilityRequest,
  BlueprintSandboxDerivationExecutionMode,
  BlueprintSandboxDerivationJob,
  BlueprintSandboxDerivationJobRequest,
  BlueprintSandboxDerivationJobStatus,
  BlueprintSandboxEvaluationMetric,
  BlueprintSandboxRoutePath,
  // 响应
  BlueprintAgentCrewResponse,
  BlueprintCapabilityEvidenceResponse,
  BlueprintCapabilityInvocationsResponse,
  BlueprintCapabilityRegistryResponse,
  BlueprintInvokeCapabilityResponse,
  BlueprintRoleTimelinesResponse,
  BlueprintSandboxDerivationJobResponse,
  BlueprintSandboxDerivationJobsResponse,
} from "../contracts.js";

import type {
  BlueprintGenerationStage,
  BlueprintGenerationStatus,
  BlueprintRolePresenceState,
} from "../contracts.js";

export const BLUEPRINT_AGENT_CREW_PROXY_CONTRACT_VERSION =
  "blueprint.agent-crew.proxy.v1" as const;

export type BlueprintAgentCrewProxyContractVersion =
  typeof BLUEPRINT_AGENT_CREW_PROXY_CONTRACT_VERSION;

export type BlueprintAgentCrewProxyEventKind =
  | "plan"
  | "assign"
  | "result"
  | "error";

export interface BlueprintAgentCrewProxyBudget {
  maxIterations?: number;
  maxTokens?: number;
  timeoutMs?: number;
  remainingIterations?: number;
  remainingTokens?: number;
  remainingTimeMs?: number;
}

export interface BlueprintAgentCrewProxyError {
  code?: string;
  message: string;
  retryable?: boolean;
}

export interface BlueprintAgentCrewProxyEvent {
  contractVersion: BlueprintAgentCrewProxyContractVersion;
  kind: BlueprintAgentCrewProxyEventKind;
  id: string;
  jobId: string;
  crewId?: string;
  roleId: string;
  stage: BlueprintGenerationStage;
  occurredAt: string;
  summary: string;
  budget?: BlueprintAgentCrewProxyBudget;
  payload?: {
    planId?: string;
    assignmentId?: string;
    resultId?: string;
    status?: string;
    capabilityId?: string;
    routeId?: string;
    nodeId?: string;
    artifactIds?: string[];
    evidenceIds?: string[];
    outputSummary?: string;
    error?: BlueprintAgentCrewProxyError;
    [key: string]: unknown;
  };
}

export type BlueprintAgentCrewProxyTimelineEntryType =
  | "role.agent.plan"
  | "role.agent.assign"
  | "role.agent.result"
  | "role.agent.error";

export interface BlueprintAgentCrewProxyTimelineEntry {
  id: string;
  eventId: string;
  jobId: string;
  projectId?: string;
  crewId?: string;
  stage: BlueprintGenerationStage;
  roleId: string;
  presenceState: BlueprintRolePresenceState;
  type: BlueprintAgentCrewProxyTimelineEntryType;
  status: BlueprintGenerationStatus;
  occurredAt: string;
  summary: string;
  currentAction?: string;
  capabilityId?: string;
  artifactId?: string;
  evidenceId?: string;
  routeId?: string;
  nodeId?: string;
  error?: string;
  payload: {
    proxy: {
      contractVersion: BlueprintAgentCrewProxyContractVersion;
      kind: BlueprintAgentCrewProxyEventKind;
    };
    budget?: BlueprintAgentCrewProxyBudget;
    error?: BlueprintAgentCrewProxyError;
    sourcePayload?: Record<string, unknown>;
  };
}

export interface BlueprintAgentCrewProxyTimeline {
  id: string;
  jobId: string;
  projectId?: string;
  crewId?: string;
  roleId: string;
  latestStage: BlueprintGenerationStage;
  latestPresenceState: BlueprintRolePresenceState;
  latestAction?: string;
  latestCapabilityId?: string;
  latestArtifactId?: string;
  latestEvidenceId?: string;
  startedAt: string;
  updatedAt: string;
  entryCount: number;
  entries: BlueprintAgentCrewProxyTimelineEntry[];
}
