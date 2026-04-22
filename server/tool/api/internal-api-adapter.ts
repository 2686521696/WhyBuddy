import type { AigcMonitoringInstanceListQuery } from "../../../shared/aigc-monitoring.js";
import type {
  GetMissionSessionResponse,
  MissionProjectionView,
} from "../../../shared/mission/api.js";
import type { MissionRecord } from "../../../shared/mission/contracts.js";
import type {
  Action,
  GovernanceDecision,
  PermissionCheckResult,
  ResourceType,
} from "../../../shared/permission/contracts.js";
import { WEB_AIGC_RISK_ACTION_API } from "../../../shared/web-aigc-risk-actions.js";
import type {
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../../shared/workflow-runtime.js";
import {
  buildMonitoringInstanceDetail,
  buildMonitoringInstanceListResponse,
  buildMonitoringSessionDetail,
} from "../../core/aigc-monitoring-projection.js";
import { resolveWorkflowMission } from "../../core/mission-enrichment-bridge.js";
import { buildWorkflowGraphInstanceSnapshot } from "../../core/workflow-graph-projection.js";
import db from "../../db/index.js";
import type {
  AuditLogger as PermissionAuditLogger,
  PermissionCheckEngine,
} from "../../permission/check-engine.js";
import {
  evaluateGovernanceDecision,
  isGovernanceBlockingDecision,
} from "../../permission/governance-policy.js";
import {
  buildMissionProjectionView,
  buildMissionSessionView,
} from "../../tasks/mission-projection.js";
import {
  missionRuntime,
  type MissionRuntime,
} from "../../tasks/mission-runtime.js";

export const INTERNAL_API_TARGET_IDS = [
  "mission.projection.get",
  "mission.session.get",
  "workflow.graph_instance_snapshot",
  "aigc_monitoring.instances",
  "aigc_monitoring.instance_detail",
  "aigc_monitoring.session_detail",
  "web_aigc.risk_action_catalog",
] as const;

export type InternalApiTargetId = (typeof INTERNAL_API_TARGET_IDS)[number];

export interface InternalApiExecutionRequest {
  targetId: string;
  input: string;
  context: string[];
  workflowId?: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}

export interface InternalApiExecutionResult {
  output: string;
  targetLabel: string;
  operation: string;
  response: unknown;
}

export interface InternalApiExecutorLike {
  execute(request: InternalApiExecutionRequest): Promise<InternalApiExecutionResult>;
}

export interface InternalApiWorkflowRepository {
  getWorkflow(id: string): WorkflowRecord | undefined;
  getWorkflows(): WorkflowRecord[];
  getTasksByWorkflow(workflowId: string): TaskRecord[];
  getMessagesByWorkflow(workflowId: string): MessageRecord[];
}

export interface MissionRuntimeReader {
  getTask(id: string): MissionRecord | undefined;
}

export interface InternalApiPermissionEngine {
  checkPermission(
    agentId: string,
    resourceType: ResourceType,
    action: Action,
    resource: string,
    token: string,
  ): PermissionCheckResult;
}

export interface InternalApiExecutorDependencies {
  workflowRepo?: InternalApiWorkflowRepository;
  resolveMissionId?: (workflowId: string) => string | undefined;
  getMission?: (missionId: string) => MissionRecord | undefined;
  missionRuntime?: MissionRuntimeReader;
  permissionEngine?: InternalApiPermissionEngine;
  auditLogger?: PermissionAuditLogger;
  buildMissionProjection?: (
    runtime: MissionRuntimeReader,
    missionId: string,
  ) => MissionProjectionView | null;
  buildMissionSession?: (
    runtime: MissionRuntimeReader,
    missionId: string,
  ) => GetMissionSessionResponse | null;
}

function defaultBuildMissionProjection(
  runtime: MissionRuntimeReader,
  missionId: string,
): MissionProjectionView | null {
  return buildMissionProjectionView(runtime as MissionRuntime, missionId);
}

function defaultBuildMissionSession(
  runtime: MissionRuntimeReader,
  missionId: string,
): GetMissionSessionResponse | null {
  return buildMissionSessionView(runtime as MissionRuntime, missionId);
}

interface WorkflowProjectionContext {
  workflow: WorkflowRecord;
  mission?: MissionRecord;
  tasks: TaskRecord[];
  messages: MessageRecord[];
}

interface InternalApiAccessContext {
  agentId: string;
  resourceType: ResourceType;
  action: Action;
  resource: string;
  permission?: PermissionCheckResult;
  governance?: GovernanceDecision;
}

type InternalApiFallbackMode = "empty_result" | "static_response";

interface InternalApiFallbackConfig {
  mode: InternalApiFallbackMode;
  targetLabel?: string;
  operation?: string;
  output?: string;
  response?: unknown;
  recoverableErrors?: string[];
}

interface InternalApiFallbackOutcome {
  result: InternalApiExecutionResult;
  metadata: Record<string, unknown>;
}

const INTERNAL_API_RESOURCE_TYPE: ResourceType = "api";
const INTERNAL_API_ACTION: Action = "call";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function serializeInternalApiResponse(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function buildInternalApiResource(targetId: string): string {
  return `internal_api:${targetId}`;
}

function summarizeInput(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > 160
    ? `${normalized.slice(0, 160).trimEnd()}...`
    : normalized;
}

function normalizeMonitoringListQuery(
  value: unknown,
): AigcMonitoringInstanceListQuery {
  if (!isRecord(value)) {
    return {};
  }

  return {
    name: readString(value, "name"),
    code: readString(value, "code"),
    version: readNumber(value, "version"),
    executor: readString(value, "executor"),
    instanceUuid: readString(value, "instanceUuid"),
    category: readString(value, "category"),
    status: readString(value, "status") as
      | AigcMonitoringInstanceListQuery["status"]
      | undefined,
    startTimeFrom: readString(value, "startTimeFrom"),
    startTimeTo: readString(value, "startTimeTo"),
    endTimeFrom: readString(value, "endTimeFrom"),
    endTimeTo: readString(value, "endTimeTo"),
    page: readNumber(value, "page"),
    size: readNumber(value, "size"),
  };
}

function resolveRequestedWorkflowId(
  request: InternalApiExecutionRequest,
): string | undefined {
  if (typeof request.workflowId === "string" && request.workflowId.trim()) {
    return request.workflowId.trim();
  }

  if (!isRecord(request.metadata)) {
    return undefined;
  }

  return (
    readString(request.metadata, "workflowId") ||
    readString(request.metadata, "instanceId")
  );
}

function resolveRequestedMissionId(
  request: InternalApiExecutionRequest,
): string | undefined {
  if (!isRecord(request.metadata)) {
    return undefined;
  }

  return (
    readString(request.metadata, "missionId") ||
    readString(request.metadata, "taskId")
  );
}

function resolveRequestedAgentId(
  request: InternalApiExecutionRequest,
): string | undefined {
  if (!isRecord(request.metadata)) {
    return undefined;
  }

  return (
    readString(request.metadata, "agentId") ||
    readString(request.metadata, "requestedBy") ||
    readString(request.metadata, "operator")
  );
}

function resolveRequestedToken(
  request: InternalApiExecutionRequest,
): string | undefined {
  if (!isRecord(request.metadata)) {
    return undefined;
  }

  return (
    readString(request.metadata, "token") ||
    readString(request.metadata, "capabilityToken")
  );
}

function readFallbackConfig(
  request: InternalApiExecutionRequest,
): InternalApiFallbackConfig | null {
  if (!isRecord(request.metadata)) {
    return null;
  }

  const rawFallback =
    (isRecord(request.metadata.fallback) && request.metadata.fallback) ||
    (isRecord(request.metadata.errorFallback) && request.metadata.errorFallback);

  if (!rawFallback) {
    return null;
  }

  const mode = readString(rawFallback, "mode");
  const recoverableErrors = Array.isArray(rawFallback.recoverableErrors)
    ? rawFallback.recoverableErrors.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : undefined;

  return {
    mode: mode === "static_response" ? "static_response" : "empty_result",
    targetLabel: readString(rawFallback, "targetLabel"),
    operation: readString(rawFallback, "operation"),
    output: readString(rawFallback, "output"),
    response: rawFallback.response,
    recoverableErrors: recoverableErrors?.length ? recoverableErrors : undefined,
  };
}

function matchesRecoverableError(
  reason: string,
  fallback: InternalApiFallbackConfig,
): boolean {
  if (!fallback.recoverableErrors || fallback.recoverableErrors.length === 0) {
    return true;
  }

  return fallback.recoverableErrors.some((keyword) => reason.includes(keyword));
}

function buildFallbackResponse(
  request: InternalApiExecutionRequest,
  fallback: InternalApiFallbackConfig,
  reason: string,
): unknown {
  const common = {
    ok: false,
    fallbackUsed: true,
    fallbackStrategy: fallback.mode,
    targetId: request.targetId,
    workflowId: resolveRequestedWorkflowId(request) ?? null,
    missionId: resolveRequestedMissionId(request) ?? null,
    error: reason,
  };

  if (fallback.mode === "static_response") {
    if (isRecord(fallback.response)) {
      return {
        ...fallback.response,
        ...common,
      };
    }

    return {
      ...common,
      data: fallback.response ?? null,
    };
  }

  return {
    ...common,
    data: [],
  };
}

export class InternalApiExecutor implements InternalApiExecutorLike {
  private readonly workflowRepo: InternalApiWorkflowRepository;
  private readonly resolveMissionId: (workflowId: string) => string | undefined;
  private readonly getMission: (missionId: string) => MissionRecord | undefined;
  private readonly runtime: MissionRuntimeReader;
  private readonly permissionEngine?: InternalApiPermissionEngine;
  private readonly auditLogger?: PermissionAuditLogger;
  private readonly buildMissionProjection: (
    runtime: MissionRuntimeReader,
    missionId: string,
  ) => MissionProjectionView | null;
  private readonly buildMissionSession: (
    runtime: MissionRuntimeReader,
    missionId: string,
  ) => GetMissionSessionResponse | null;

  constructor(deps: InternalApiExecutorDependencies = {}) {
    this.workflowRepo = deps.workflowRepo ?? db;
    this.resolveMissionId = deps.resolveMissionId ?? resolveWorkflowMission;
    this.getMission =
      deps.getMission ?? ((missionId: string) => missionRuntime.getTask(missionId));
    this.runtime = deps.missionRuntime ?? missionRuntime;
    this.permissionEngine = deps.permissionEngine;
    this.auditLogger = deps.auditLogger;
    this.buildMissionProjection =
      deps.buildMissionProjection ?? defaultBuildMissionProjection;
    this.buildMissionSession =
      deps.buildMissionSession ?? defaultBuildMissionSession;
  }

  async execute(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const access = this.enforceAccessControl(request);

    try {
      let result: InternalApiExecutionResult;
      switch (request.targetId) {
        case "mission.projection.get":
          result = await this.executeMissionProjection(request);
          break;
        case "mission.session.get":
          result = await this.executeMissionSession(request);
          break;
        case "workflow.graph_instance_snapshot":
          result = await this.executeWorkflowGraphSnapshot(request);
          break;
        case "aigc_monitoring.instances":
          result = await this.executeMonitoringInstanceList(request);
          break;
        case "aigc_monitoring.instance_detail":
          result = await this.executeMonitoringInstanceDetail(request);
          break;
        case "aigc_monitoring.session_detail":
          result = await this.executeMonitoringSessionDetail(request);
          break;
        case "web_aigc.risk_action_catalog":
          result = await this.executeRiskActionCatalog();
          break;
        default:
          throw new Error(`Internal API target not found: ${request.targetId}`);
      }

      this.auditExecution(access, request, "allowed", undefined, {
        targetLabel: result.targetLabel,
        operation: result.operation,
      });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const fallback = this.buildFallbackOutcome(request, reason);
      if (fallback) {
        this.auditExecution(access, request, "allowed", undefined, fallback.metadata);
        return fallback.result;
      }
      this.auditExecution(access, request, "error", reason);
      throw error;
    }
  }

  private enforceAccessControl(
    request: InternalApiExecutionRequest,
  ): InternalApiAccessContext {
    const access: InternalApiAccessContext = {
      agentId: resolveRequestedAgentId(request) ?? "internal_api_executor",
      resourceType: INTERNAL_API_RESOURCE_TYPE,
      action: INTERNAL_API_ACTION,
      resource: buildInternalApiResource(request.targetId),
    };

    if (!this.permissionEngine) {
      return access;
    }

    const agentId = resolveRequestedAgentId(request);
    if (!agentId) {
      const reason = "Missing required field: agentId";
      this.auditExecution(access, request, "denied", reason, {
        governanceHook: "internal-api-entry",
      });
      throw new Error(reason);
    }

    const token = resolveRequestedToken(request);
    if (!token) {
      const reason = "Missing required field: token";
      this.auditExecution(
        { ...access, agentId },
        request,
        "denied",
        reason,
        {
          governanceHook: "internal-api-entry",
        },
      );
      throw new Error(reason);
    }

    const permission = this.permissionEngine.checkPermission(
      agentId,
      access.resourceType,
      access.action,
      access.resource,
      token,
    );
    access.agentId = agentId;
    access.permission = permission;

    if (!permission.allowed) {
      const reason =
        permission.reason ||
        `Permission denied for internal API target: ${request.targetId}`;
      this.auditExecution(access, request, "denied", reason, {
        governanceHook: "permission-engine",
      });
      throw new Error(reason);
    }

    const governance = evaluateGovernanceDecision(
      access.resourceType,
      access.action,
      access.resource,
    );
    access.governance = governance;

    if (isGovernanceBlockingDecision(governance)) {
      const reason =
        governance?.rationale ||
        `Governance blocked internal API target: ${request.targetId}`;
      this.auditExecution(access, request, "denied", reason, {
        governanceHook: "governance-policy",
      });
      throw new Error(reason);
    }

    return access;
  }

  private auditExecution(
    access: InternalApiAccessContext,
    request: InternalApiExecutionRequest,
    result: "allowed" | "denied" | "error",
    reason?: string,
    metadata: Record<string, unknown> = {},
  ): void {
    if (!this.auditLogger) {
      return;
    }

    this.auditLogger.log({
      agentId: access.agentId,
      operation: "internal_api",
      resourceType: access.resourceType,
      action: access.action,
      resource: access.resource,
      result,
      reason,
      governance: access.governance,
      metadata: {
        targetId: request.targetId,
        workflowId: resolveRequestedWorkflowId(request),
        missionId: resolveRequestedMissionId(request),
        stage: request.stage,
        inputPreview: summarizeInput(request.input),
        ...metadata,
      },
    });
  }

  private buildFallbackOutcome(
    request: InternalApiExecutionRequest,
    reason: string,
  ): InternalApiFallbackOutcome | null {
    const fallback = readFallbackConfig(request);
    if (!fallback || !matchesRecoverableError(reason, fallback)) {
      return null;
    }

    const response = buildFallbackResponse(request, fallback, reason);
    const result: InternalApiExecutionResult = {
      output: fallback.output ?? serializeInternalApiResponse(response),
      targetLabel: fallback.targetLabel ?? "Internal API 回退结果",
      operation: fallback.operation ?? request.targetId,
      response,
    };

    return {
      result,
      metadata: {
        targetLabel: result.targetLabel,
        operation: result.operation,
        fallbackUsed: true,
        fallbackStrategy: fallback.mode,
        fallbackReason: reason,
      },
    };
  }

  private resolveMission(request: InternalApiExecutionRequest): MissionRecord {
    const missionId = resolveRequestedMissionId(request);
    if (!missionId) {
      throw new Error("Missing required field: missionId");
    }

    const mission = this.runtime.getTask(missionId);
    if (!mission) {
      throw new Error(`Mission not found: ${missionId}`);
    }

    return mission;
  }

  private getWorkflowProjectionContext(
    request: InternalApiExecutionRequest,
  ): WorkflowProjectionContext {
    const workflowId = resolveRequestedWorkflowId(request);
    if (!workflowId) {
      throw new Error("Missing required field: workflowId");
    }

    const workflow = this.workflowRepo.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const missionId = this.resolveMissionId(workflow.id);
    const mission = missionId ? this.getMission(missionId) : undefined;

    return {
      workflow,
      mission,
      tasks: this.workflowRepo.getTasksByWorkflow(workflow.id),
      messages: this.workflowRepo.getMessagesByWorkflow(workflow.id),
    };
  }

  private async executeMissionProjection(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const mission = this.resolveMission(request);
    const response = this.buildMissionProjection(this.runtime, mission.id);
    if (!response) {
      throw new Error(`Mission projection not found: ${mission.id}`);
    }

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "Mission 聚合投影视图",
      operation: "mission.projection.get",
      response,
    };
  }

  private async executeMissionSession(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const mission = this.resolveMission(request);
    const response = this.buildMissionSession(this.runtime, mission.id);
    if (!response) {
      throw new Error(`Mission session not found: ${mission.id}`);
    }

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "Mission 会话与记忆视图",
      operation: "mission.session.get",
      response,
    };
  }

  private async executeWorkflowGraphSnapshot(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const context = this.getWorkflowProjectionContext(request);
    const response = buildWorkflowGraphInstanceSnapshot(context);

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "工作流图实例快照",
      operation: "workflow.graph_instance_snapshot",
      response,
    };
  }

  private async executeMonitoringInstanceList(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const workflows = this.workflowRepo.getWorkflows().map((workflow) => {
      const missionId = this.resolveMissionId(workflow.id);
      const mission = missionId ? this.getMission(missionId) : undefined;
      const tasks = this.workflowRepo.getTasksByWorkflow(workflow.id);
      const messages = this.workflowRepo.getMessagesByWorkflow(workflow.id);
      const instance = buildWorkflowGraphInstanceSnapshot({
        workflow,
        mission,
        tasks,
        messages,
      });

      return {
        workflow,
        mission,
        instance,
      };
    });

    const query = normalizeMonitoringListQuery(
      isRecord(request.metadata) ? request.metadata.query : undefined,
    );
    const response = buildMonitoringInstanceListResponse({
      items: workflows,
      query,
    });

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "AIGC 监控实例列表",
      operation: "aigc_monitoring.instances",
      response,
    };
  }

  private async executeMonitoringInstanceDetail(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const context = this.getWorkflowProjectionContext(request);
    const instance = buildWorkflowGraphInstanceSnapshot(context);
    const response = buildMonitoringInstanceDetail({
      workflow: context.workflow,
      mission: context.mission,
      instance,
    });

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "AIGC 监控实例详情",
      operation: "aigc_monitoring.instance_detail",
      response,
    };
  }

  private async executeMonitoringSessionDetail(
    request: InternalApiExecutionRequest,
  ): Promise<InternalApiExecutionResult> {
    const context = this.getWorkflowProjectionContext(request);
    const response = buildMonitoringSessionDetail({
      workflow: context.workflow,
      mission: context.mission,
      messages: context.messages,
    });

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "AIGC 监控会话详情",
      operation: "aigc_monitoring.session_detail",
      response,
    };
  }

  private async executeRiskActionCatalog(): Promise<InternalApiExecutionResult> {
    const response = {
      kind: "web_aigc_risk_action_catalog",
      version: 1,
      actions: WEB_AIGC_RISK_ACTION_API,
      notes: [
        "该目录用于暴露 Web-AIGC 兼容层中的高风险动作入口。",
        "向量写入类动作会继续经过 permission + governance + audit 链路。",
      ],
    };

    return {
      output: serializeInternalApiResponse(response),
      targetLabel: "Web-AIGC 风险动作目录",
      operation: "web_aigc.risk_action_catalog",
      response,
    };
  }
}
