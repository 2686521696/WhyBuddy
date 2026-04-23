import type { AgentHandle } from "../../../shared/workflow-runtime.js";
import type {
  ActivatedSkill,
  ResolveOptions,
  SkillBinding,
  SkillExecutionMetrics,
  SkillRecord,
} from "../../../shared/skill-contracts.js";
import type { WorkflowMcpBinding } from "../../../shared/organization-schema.js";
import type { Action, ResourceType } from "../../../shared/permission/contracts.js";
import db from "../../db/index.js";
import { registry } from "../../core/registry.js";
import { skillRegistry } from "../../core/dynamic-organization.js";
import { SkillActivator } from "../../core/skill-activator.js";
import { SkillMonitor } from "../../core/skill-monitor.js";
import type { AuditLogger as PermissionAuditLogger } from "../../permission/check-engine.js";
import {
  InternalApiExecutor,
  type InternalApiExecutorLike,
} from "./internal-api-adapter.js";
import {
  PassthroughApiExecutor,
  type PassthroughApiExecutorLike,
} from "./passthrough-api-adapter.js";

export type AutoAgentTargetKind =
  | "agent"
  | "guest_agent"
  | "skill"
  | "internal_api"
  | "passthrough_api";

export interface AutoAgentExecutionRequest {
  kind: AutoAgentTargetKind;
  targetId: string;
  input: string;
  context?: string[];
  workflowId?: string;
  stage?: string;
  version?: string;
  delegateAgentId?: string;
  maxSkills?: number;
  metadata?: Record<string, unknown>;
}

export interface AutoAgentFallbackTarget {
  kind: AutoAgentTargetKind;
  targetId: string;
  version?: string;
  delegateAgentId?: string;
  maxSkills?: number;
}

export interface AutoAgentRecoveryMetadata {
  attemptCount: number;
  retryCount: number;
  timeoutMs?: number;
  fallbackUsed: boolean;
  fallbackTarget?: {
    kind: AutoAgentTargetKind;
    targetId: string;
  };
  requestedTarget: {
    kind: AutoAgentTargetKind;
    targetId: string;
  };
  errorChain?: string[];
}

export interface AutoAgentExecutionResult {
  kind: AutoAgentTargetKind;
  targetId: string;
  output: string;
  delegatedTo: {
    agentId: string;
    agentName: string;
    role: AgentHandle["config"]["role"];
    kind: "agent" | "guest_agent";
  };
  metadata: {
    source: "auto_agent";
    invokedAt: string;
    workflowId?: string;
    stage?: string;
    requestMetadata?: Record<string, unknown>;
    skillIds?: string[];
    skillVersions?: Record<string, string>;
    mcpBindings?: WorkflowMcpBinding[];
    targetLabel?: string;
    recovery?: AutoAgentRecoveryMetadata;
  };
}

export interface AutoAgentDirectory {
  get(id: string): AgentHandle | undefined;
  getCEO(): AgentHandle | undefined;
  isGuest(id: string): boolean;
}

export interface AutoAgentSkillRegistry {
  resolveSkills(skillIds: string[], options?: ResolveOptions): SkillBinding[];
  resolveMcpForSkill(
    skill: SkillRecord,
    agentId: string,
    workflowId: string
  ): WorkflowMcpBinding[];
}

export interface AutoAgentSkillMonitor {
  recordMetrics(metrics: SkillExecutionMetrics): void;
}

export interface AutoAgentExecutorDependencies {
  directory?: AutoAgentDirectory;
  skills?: AutoAgentSkillRegistry;
  skillMonitor?: AutoAgentSkillMonitor;
  skillActivator?: SkillActivator;
  internalApis?: InternalApiExecutorLike;
  passthroughApis?: PassthroughApiExecutorLike;
  auditLogger?: PermissionAuditLogger;
}

export interface AutoAgentExecutorLike {
  execute(request: AutoAgentExecutionRequest): Promise<AutoAgentExecutionResult>;
}

type NormalizedAutoAgentExecutionRequest = AutoAgentExecutionRequest & {
  targetId: string;
  input: string;
  context: string[];
};

interface AutoAgentExecutionControls {
  timeoutMs?: number;
  retryCount: number;
  fallback?: AutoAgentFallbackTarget;
}

interface AutoAgentExecutionEnvelope {
  result: AutoAgentExecutionResult;
  recovery: AutoAgentRecoveryMetadata;
}

const AUTO_AGENT_RESOURCE_TYPE: ResourceType = "api";
const AUTO_AGENT_ACTION: Action = "call";

function ensureText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required field: ${field}`);
  }
  return value.trim();
}

function normalizeContext(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function dedupeMcpBindings(bindings: WorkflowMcpBinding[]): WorkflowMcpBinding[] {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const key = `${binding.id}:${binding.server}:${binding.connection.endpoint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function readNestedString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  return (
    readString(value, key) ||
    (isRecord(value.links) ? readString(value.links, key) : undefined)
  );
}

function readNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
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

function normalizeAutoAgentRequest(
  request: AutoAgentExecutionRequest,
): NormalizedAutoAgentExecutionRequest {
  return {
    ...request,
    kind: request.kind,
    targetId: ensureText(request.targetId, "targetId"),
    input: ensureText(request.input, "input"),
    context: normalizeContext(request.context),
  };
}

function coerceAutoAgentRequestForAudit(
  request: AutoAgentExecutionRequest,
): NormalizedAutoAgentExecutionRequest {
  return {
    ...request,
    kind: request.kind,
    targetId:
      typeof request.targetId === "string" ? request.targetId.trim() : "",
    input: typeof request.input === "string" ? request.input.trim() : "",
    context: normalizeContext(request.context),
  };
}

function buildAutoAgentResource(
  kind: AutoAgentTargetKind,
  targetId: string,
): string {
  return `auto_agent:${kind}:${targetId}`;
}

function resolveAuditMetadataRecord(
  request: AutoAgentExecutionRequest,
): Record<string, unknown> | undefined {
  return isRecord(request.metadata) ? request.metadata : undefined;
}

function resolveAuditAgentId(
  request: AutoAgentExecutionRequest,
  fallbackAgentId?: string,
): string {
  const metadata = resolveAuditMetadataRecord(request);
  return (
    readString(metadata, "agentId") ||
    readString(metadata, "requestedBy") ||
    readString(metadata, "operator") ||
    fallbackAgentId ||
    "auto_agent_executor"
  );
}

function resolveAuditOperator(
  request: AutoAgentExecutionRequest,
): string | undefined {
  const metadata = resolveAuditMetadataRecord(request);
  return readString(metadata, "operator") || readString(metadata, "requestedBy");
}

function resolveAuditWorkflowId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return request.workflowId?.trim() || readNestedString(resolveAuditMetadataRecord(request), "workflowId");
}

function resolveAuditMissionId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  const metadata = resolveAuditMetadataRecord(request);
  return readNestedString(metadata, "missionId") || readString(metadata, "taskId");
}

function resolveAuditSessionId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return readNestedString(resolveAuditMetadataRecord(request), "sessionId");
}

function resolveAuditTraceId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return readNestedString(resolveAuditMetadataRecord(request), "traceId");
}

function resolveAuditRequestId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return readNestedString(resolveAuditMetadataRecord(request), "requestId");
}

function resolveAuditReplayId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  const metadata = resolveAuditMetadataRecord(request);
  return readNestedString(metadata, "replayId") || resolveAuditWorkflowId(request);
}

function resolveAuditLineageId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return readNestedString(resolveAuditMetadataRecord(request), "lineageId");
}

function resolveAuditDecisionId(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return readNestedString(resolveAuditMetadataRecord(request), "decisionId");
}

function resolveAuditSourceApp(
  request: AutoAgentExecutionRequest,
): string | undefined {
  return readNestedString(resolveAuditMetadataRecord(request), "sourceApp");
}

function isAutoAgentTargetKind(value: string): value is AutoAgentTargetKind {
  return (
    value === "agent" ||
    value === "guest_agent" ||
    value === "skill" ||
    value === "internal_api" ||
    value === "passthrough_api"
  );
}

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeRetryCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(3, Math.floor(value));
}

function normalizeMaxSkills(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function normalizeFallbackTarget(
  value: unknown,
): AutoAgentFallbackTarget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = readString(value, "kind");
  const targetId = readString(value, "targetId");
  if (!kind || !targetId || !isAutoAgentTargetKind(kind)) {
    return undefined;
  }

  return {
    kind,
    targetId,
    version: readString(value, "version"),
    delegateAgentId: readString(value, "delegateAgentId"),
    maxSkills: normalizeMaxSkills(readNumber(value, "maxSkills")),
  };
}

function resolveExecutionControls(
  request: AutoAgentExecutionRequest,
): AutoAgentExecutionControls {
  const metadata = resolveAuditMetadataRecord(request);
  const timeoutMs = normalizeTimeoutMs(readNumber(metadata, "timeoutMs"));
  const retryCount = normalizeRetryCount(readNumber(metadata, "retryCount"));
  const fallback =
    normalizeFallbackTarget(metadata?.fallback) ??
    normalizeFallbackTarget(metadata?.fallbackTarget);

  return {
    timeoutMs,
    retryCount,
    fallback,
  };
}

function withRecoveryMetadata(
  result: AutoAgentExecutionResult,
  recovery: AutoAgentRecoveryMetadata,
): AutoAgentExecutionResult {
  return {
    ...result,
    metadata: {
      ...result.metadata,
      recovery,
    },
  };
}

class AutoAgentTimeoutError extends Error {
  constructor(
    kind: AutoAgentTargetKind,
    targetId: string,
    timeoutMs: number,
  ) {
    super(`Auto-agent execution timed out after ${timeoutMs}ms for ${kind}:${targetId}`);
    this.name = "AutoAgentTimeoutError";
  }
}

export function normalizeAutoAgentContextInput(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return undefined;
}

export function mapAutoAgentErrorToStatusCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Missing required field:")) return 400;
  if (message.includes("timed out")) return 504;
  if (
    message.includes("not found") ||
    message.includes("not a guest agent") ||
    message.includes("not a resident agent") ||
    message.includes("No enabled skill bindings") ||
    message.includes("No default delegate agent is available")
  ) {
    return 404;
  }
  if (message.includes("disabled")) return 409;
  return 500;
}

export class AutoAgentExecutor implements AutoAgentExecutorLike {
  private readonly directory: AutoAgentDirectory;
  private readonly skills: AutoAgentSkillRegistry;
  private readonly skillMonitor: AutoAgentSkillMonitor;
  private readonly skillActivator: SkillActivator;
  private readonly internalApis: InternalApiExecutorLike;
  private readonly passthroughApis: PassthroughApiExecutorLike;
  private readonly auditLogger?: PermissionAuditLogger;

  constructor(deps: AutoAgentExecutorDependencies = {}) {
    this.directory = deps.directory ?? registry;
    this.skills = deps.skills ?? skillRegistry;
    this.skillMonitor = deps.skillMonitor ?? new SkillMonitor(db);
    this.skillActivator = deps.skillActivator ?? new SkillActivator();
    this.internalApis = deps.internalApis ?? new InternalApiExecutor();
    this.passthroughApis =
      deps.passthroughApis ??
      new PassthroughApiExecutor({
        auditLogger: deps.auditLogger,
      });
    this.auditLogger = deps.auditLogger;
  }

  async execute(request: AutoAgentExecutionRequest): Promise<AutoAgentExecutionResult> {
    const auditRequest = coerceAutoAgentRequestForAudit(request);
    const controls = resolveExecutionControls(request);
    try {
      const normalizedRequest = normalizeAutoAgentRequest(request);
      const execution = await this.executeWithRecovery(normalizedRequest, controls);
      this.auditExecution(
        normalizedRequest,
        "allowed",
        undefined,
        execution.result,
        execution.recovery,
      );
      return execution.result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const recovery = this.buildFailureRecoveryMetadata(auditRequest, controls, reason);
      this.auditExecution(auditRequest, "error", reason, undefined, recovery);
      throw error;
    }
  }

  private async executeWithRecovery(
    request: NormalizedAutoAgentExecutionRequest,
    controls: AutoAgentExecutionControls,
  ): Promise<AutoAgentExecutionEnvelope> {
    const errorChain: string[] = [];
    const requestedTarget = {
      kind: request.kind,
      targetId: request.targetId,
    };

    for (let attempt = 0; attempt <= controls.retryCount; attempt++) {
      try {
        const result = await this.executeSingleAttempt(request, controls.timeoutMs);
        const recovery: AutoAgentRecoveryMetadata = {
          attemptCount: attempt + 1,
          retryCount: controls.retryCount,
          timeoutMs: controls.timeoutMs,
          fallbackUsed: false,
          requestedTarget,
          errorChain: errorChain.length > 0 ? [...errorChain] : undefined,
        };
        return {
          result: withRecoveryMetadata(result, recovery),
          recovery,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errorChain.push(reason);
        if (attempt < controls.retryCount) {
          continue;
        }
      }
    }

    if (controls.fallback) {
      const fallbackRequest: NormalizedAutoAgentExecutionRequest = {
        ...request,
        kind: controls.fallback.kind,
        targetId: controls.fallback.targetId,
        version: controls.fallback.version,
        delegateAgentId: controls.fallback.delegateAgentId,
        maxSkills: controls.fallback.maxSkills,
      };

      try {
        const fallbackResult = await this.executeSingleAttempt(
          fallbackRequest,
          controls.timeoutMs,
        );
        const recovery: AutoAgentRecoveryMetadata = {
          attemptCount: controls.retryCount + 2,
          retryCount: controls.retryCount,
          timeoutMs: controls.timeoutMs,
          fallbackUsed: true,
          fallbackTarget: {
            kind: controls.fallback.kind,
            targetId: controls.fallback.targetId,
          },
          requestedTarget,
          errorChain: [...errorChain],
        };
        return {
          result: withRecoveryMetadata(fallbackResult, recovery),
          recovery,
        };
      } catch (error) {
        const fallbackReason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Primary auto-agent execution failed after ${controls.retryCount + 1} attempt(s): ${errorChain.at(-1) ?? "unknown error"}. Fallback ${controls.fallback.kind}:${controls.fallback.targetId} failed: ${fallbackReason}`,
        );
      }
    }

    const finalReason = errorChain.at(-1) ?? "Auto-agent execution failed";
    if (controls.retryCount > 0) {
      throw new Error(
        `Auto-agent execution failed after ${controls.retryCount + 1} attempt(s): ${finalReason}`,
      );
    }
    throw new Error(finalReason);
  }

  private async executeSingleAttempt(
    request: NormalizedAutoAgentExecutionRequest,
    timeoutMs?: number,
  ): Promise<AutoAgentExecutionResult> {
    if (request.kind === "skill") {
      const skillRequest = request as NormalizedAutoAgentExecutionRequest & {
        kind: "skill";
      };
      return this.executeSkill(skillRequest, timeoutMs);
    }

    if (request.kind === "internal_api") {
      const internalApiRequest = request as NormalizedAutoAgentExecutionRequest & {
        kind: "internal_api";
      };
      return this.executeInternalApi(internalApiRequest, timeoutMs);
    }

    if (request.kind === "passthrough_api") {
      const passthroughApiRequest = request as NormalizedAutoAgentExecutionRequest & {
        kind: "passthrough_api";
      };
      return this.executePassthroughApi(passthroughApiRequest, timeoutMs);
    }

    const agent = this.resolveAgentTarget(request.targetId, request.kind);
    const output = await this.invokeWithTimeout(
      request,
      () =>
        agent.invoke(request.input, request.context, {
          workflowId: request.workflowId,
          stage: request.stage ?? "auto_agent",
        }),
      timeoutMs,
    );

    return {
      kind: request.kind,
      targetId: request.targetId,
      output,
      delegatedTo: {
        agentId: agent.config.id,
        agentName: agent.config.name,
        role: agent.config.role,
        kind: this.directory.isGuest(agent.config.id) ? "guest_agent" : "agent",
      },
      metadata: {
        source: "auto_agent",
        invokedAt: new Date().toISOString(),
        workflowId: request.workflowId,
        stage: request.stage ?? "auto_agent",
        requestMetadata: request.metadata,
        targetLabel: agent.config.name,
      },
    };
  }

  private resolveAgentTarget(
    targetId: string,
    expectedKind: "agent" | "guest_agent"
  ): AgentHandle {
    const agent = this.directory.get(targetId);
    if (!agent) {
      throw new Error(`Target ${expectedKind} not found: ${targetId}`);
    }

    const isGuest = this.directory.isGuest(targetId);
    if (expectedKind === "guest_agent" && !isGuest) {
      throw new Error(`Target is not a guest agent: ${targetId}`);
    }
    if (expectedKind === "agent" && isGuest) {
      throw new Error(`Target is a guest agent, not a resident agent: ${targetId}`);
    }

    return agent;
  }

  private resolveDelegateAgent(request: AutoAgentExecutionRequest): AgentHandle {
    if (request.delegateAgentId?.trim()) {
      const delegate = this.directory.get(request.delegateAgentId.trim());
      if (!delegate) {
        throw new Error(`Delegate agent not found: ${request.delegateAgentId.trim()}`);
      }
      return delegate;
    }

    const ceo = this.directory.getCEO();
    if (!ceo) {
      throw new Error("No default delegate agent is available for skill execution");
    }
    return ceo;
  }

  private enrichSkillBindings(
    bindings: SkillBinding[],
    agentId: string,
    workflowId: string
  ): SkillBinding[] {
    return bindings.map((binding) => ({
      ...binding,
      mcpBindings: this.skills.resolveMcpForSkill(
        binding.resolvedSkill,
        agentId,
        workflowId
      ),
    }));
  }

  private materializeSkillPrompts(
    skills: ActivatedSkill[],
    input: string
  ): ActivatedSkill[] {
    return skills.map((skill) => ({
      ...skill,
      resolvedPrompt: skill.resolvedPrompt.replace(/\{input\}/g, input),
    }));
  }

  private async executeSkill(
    request: AutoAgentExecutionRequest & { kind: "skill"; targetId: string; input: string; context: string[] },
    timeoutMs?: number,
  ): Promise<AutoAgentExecutionResult> {
    const delegateAgent = this.resolveDelegateAgent(request);
    const resolveOptions: ResolveOptions | undefined = request.version
      ? { versionMap: { [request.targetId]: request.version } }
      : undefined;
    const baseBindings = this.skills.resolveSkills([request.targetId], resolveOptions);

    if (baseBindings.length === 0) {
      throw new Error(`Skill not found or disabled: ${request.targetId}`);
    }

    const workflowId = request.workflowId ?? "auto-agent";
    const taskContext = request.context.length > 0
      ? request.context.join("\n\n")
      : request.input;
    const enrichedBindings = this.enrichSkillBindings(
      baseBindings,
      delegateAgent.config.id,
      workflowId
    );

    const activationStartedAt = Date.now();
    const activatedSkills = this.skillActivator.activateSkills(
      enrichedBindings,
      taskContext,
      request.maxSkills
    );
    const activationTimeMs = Date.now() - activationStartedAt;

    if (activatedSkills.length === 0) {
      throw new Error(`No enabled skill bindings resolved for ${request.targetId}`);
    }

    const materializedSkills = this.materializeSkillPrompts(activatedSkills, request.input);
    const skillPromptSection = this.skillActivator.buildSkillPromptSection(materializedSkills);
    const prompt = [
      "Use the activated skill pack to process the incoming request.",
      skillPromptSection,
      "Input:",
      request.input,
      "Requirements:",
      "- Follow the skill instructions before adding your own synthesis.",
      "- Call out missing context briefly if the request is underspecified.",
      "- Keep the output directly usable by the next workflow step.",
    ].join("\n\n");

    const executionStartedAt = Date.now();
    let output = "";
    let success = false;
    try {
      output = await this.invokeWithTimeout(
        request,
        () =>
          delegateAgent.invoke(prompt, request.context, {
            workflowId: request.workflowId,
            stage: request.stage ?? "auto_agent_skill",
          }),
        timeoutMs,
      );
      success = true;
    } finally {
      const executionTimeMs = Date.now() - executionStartedAt;
      const tokenCount = success ? estimateTokenCount(`${request.input}\n${output}`) : 0;
      for (const skill of materializedSkills) {
        this.skillMonitor.recordMetrics({
          skillId: skill.skillId,
          version: skill.version,
          workflowId,
          agentId: delegateAgent.config.id,
          agentRole: delegateAgent.config.role,
          taskType: "auto_agent_skill",
          activationTimeMs,
          executionTimeMs,
          tokenCount,
          success,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const mcpBindings = dedupeMcpBindings(
      materializedSkills.flatMap((skill) => skill.mcpBindings)
    );

    return {
      kind: "skill",
      targetId: request.targetId,
      output,
      delegatedTo: {
        agentId: delegateAgent.config.id,
        agentName: delegateAgent.config.name,
        role: delegateAgent.config.role,
        kind: this.directory.isGuest(delegateAgent.config.id) ? "guest_agent" : "agent",
      },
      metadata: {
        source: "auto_agent",
        invokedAt: new Date().toISOString(),
        workflowId: request.workflowId,
        stage: request.stage ?? "auto_agent_skill",
        requestMetadata: request.metadata,
        skillIds: materializedSkills.map((skill) => skill.skillId),
        skillVersions: Object.fromEntries(
          materializedSkills.map((skill) => [skill.skillId, skill.version])
        ),
        mcpBindings,
        targetLabel: baseBindings[0]?.resolvedSkill.name,
      },
    };
  }

  private async executeInternalApi(
    request: AutoAgentExecutionRequest & {
      kind: "internal_api";
      targetId: string;
      input: string;
      context: string[];
    },
    timeoutMs?: number,
  ): Promise<AutoAgentExecutionResult> {
    const result = await this.invokeWithTimeout(
      request,
      () =>
        this.internalApis.execute({
          targetId: request.targetId,
          input: request.input,
          context: request.context,
          workflowId: request.workflowId,
          stage: request.stage,
          metadata: request.metadata,
        }),
      timeoutMs,
    );

    return {
      kind: "internal_api",
      targetId: request.targetId,
      output: result.output,
      delegatedTo: {
        agentId: "internal_api_executor",
        agentName: "Internal API Executor",
        role: "worker",
        kind: "agent",
      },
      metadata: {
        source: "auto_agent",
        invokedAt: new Date().toISOString(),
        workflowId: request.workflowId,
        stage: request.stage ?? "auto_agent_internal_api",
        requestMetadata: request.metadata,
        targetLabel: result.targetLabel,
      },
    };
  }

  private async executePassthroughApi(
    request: AutoAgentExecutionRequest & {
      kind: "passthrough_api";
      targetId: string;
      input: string;
      context: string[];
    },
    timeoutMs?: number,
  ): Promise<AutoAgentExecutionResult> {
    const requestMetadata =
      request.metadata && typeof request.metadata === "object"
        ? { ...request.metadata }
        : {};
    if (timeoutMs && typeof requestMetadata.timeoutMs !== "number") {
      requestMetadata.timeoutMs = timeoutMs;
    }

    const result = await this.invokeWithTimeout(
      request,
      () =>
        this.passthroughApis.execute({
          targetId: request.targetId,
          input: request.input,
          context: request.context,
          workflowId: request.workflowId,
          stage: request.stage,
          metadata: requestMetadata,
        }),
      timeoutMs,
    );

    return {
      kind: "passthrough_api",
      targetId: request.targetId,
      output: result.output,
      delegatedTo: {
        agentId: "passthrough_api_executor",
        agentName: "Passthrough API Executor",
        role: "worker",
        kind: "agent",
      },
      metadata: {
        source: "auto_agent",
        invokedAt: new Date().toISOString(),
        workflowId: request.workflowId,
        stage: request.stage ?? "auto_agent_passthrough_api",
        requestMetadata,
        targetLabel: result.targetLabel,
      },
    };
  }

  private auditExecution(
    request: NormalizedAutoAgentExecutionRequest,
    result: "allowed" | "error",
    reason?: string,
    execution?: AutoAgentExecutionResult,
    recovery?: AutoAgentRecoveryMetadata,
  ): void {
    if (!this.auditLogger) {
      return;
    }

    const requestMetadata = resolveAuditMetadataRecord(request);
    const resolvedRecovery = recovery ?? execution?.metadata.recovery;
    const workflowId = resolveAuditWorkflowId(request);
    const missionId = resolveAuditMissionId(request);
    const sessionId = resolveAuditSessionId(request);
    const requestId = resolveAuditRequestId(request);
    const replayId = resolveAuditReplayId(request);
    const traceId = resolveAuditTraceId(request);
    const lineageId = resolveAuditLineageId(request);
    const decisionId = resolveAuditDecisionId(request);
    const sourceApp = resolveAuditSourceApp(request);
    this.auditLogger.log({
      agentId: resolveAuditAgentId(request, execution?.delegatedTo.agentId),
      operation: "auto_agent",
      resourceType: AUTO_AGENT_RESOURCE_TYPE,
      action: AUTO_AGENT_ACTION,
      resource: buildAutoAgentResource(request.kind, request.targetId),
      result,
      reason,
      ...(lineageId ? { lineageId } : {}),
      metadata: {
        targetKind: request.kind,
        targetId: request.targetId,
        workflowId,
        missionId,
        sessionId,
        requestId,
        replayId,
        traceId,
        lineageId,
        decisionId,
        sourceApp,
        operator: resolveAuditOperator(request),
        stage: execution?.metadata.stage ?? request.stage,
        inputPreview: summarizeInput(request.input),
        contextCount: request.context.length,
        delegateAgentId: request.delegateAgentId,
        delegatedAgentId: execution?.delegatedTo.agentId,
        delegatedAgentKind: execution?.delegatedTo.kind,
        delegatedAgentRole: execution?.delegatedTo.role,
        targetLabel: execution?.metadata.targetLabel,
        skillIds: execution?.metadata.skillIds,
        mcpBindingCount: execution?.metadata.mcpBindings?.length,
        attemptCount: resolvedRecovery?.attemptCount,
        retryCount: resolvedRecovery?.retryCount,
        timeoutMs: resolvedRecovery?.timeoutMs,
        fallbackUsed: resolvedRecovery?.fallbackUsed,
        fallbackTargetKind: resolvedRecovery?.fallbackTarget?.kind,
        fallbackTargetId: resolvedRecovery?.fallbackTarget?.targetId,
        requestedTargetKind: resolvedRecovery?.requestedTarget.kind,
        requestedTargetId: resolvedRecovery?.requestedTarget.targetId,
        errorChain: resolvedRecovery?.errorChain,
        metadataKeys: requestMetadata ? Object.keys(requestMetadata).sort() : [],
      },
    });
  }

  private buildFailureRecoveryMetadata(
    request: NormalizedAutoAgentExecutionRequest,
    controls: AutoAgentExecutionControls,
    reason: string,
  ): AutoAgentRecoveryMetadata {
    return {
      attemptCount: controls.retryCount + 1 + (controls.fallback ? 1 : 0),
      retryCount: controls.retryCount,
      timeoutMs: controls.timeoutMs,
      fallbackUsed: false,
      fallbackTarget: controls.fallback
        ? {
            kind: controls.fallback.kind,
            targetId: controls.fallback.targetId,
          }
        : undefined,
      requestedTarget: {
        kind: request.kind,
        targetId: request.targetId,
      },
      errorChain: [reason],
    };
  }

  private async invokeWithTimeout<T>(
    request: Pick<NormalizedAutoAgentExecutionRequest, "kind" | "targetId">,
    operation: () => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    if (!timeoutMs) {
      return operation();
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new AutoAgentTimeoutError(
                request.kind,
                request.targetId,
                timeoutMs,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

let autoAgentExecutor: AutoAgentExecutorLike = new AutoAgentExecutor();

export function getAutoAgentExecutor(): AutoAgentExecutorLike {
  return autoAgentExecutor;
}

export function setAutoAgentExecutor(executor: AutoAgentExecutorLike): void {
  autoAgentExecutor = executor;
}

export function resetAutoAgentExecutor(): void {
  autoAgentExecutor = new AutoAgentExecutor();
}
