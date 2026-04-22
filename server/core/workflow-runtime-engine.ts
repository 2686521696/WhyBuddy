import type { MissionRecord } from "../../shared/mission/contracts.js";
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
  executeChatNode,
  type ChatNodeInput,
  type ChatNodeType,
} from "../routes/node-adapters/chat-node-adapter.js";
import {
  evaluateRuntimeConditionExpression,
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
  const messages =
    resolveChatNodeConfigValue(context.node, context.variables, "messages") ||
    context.variables.messages;
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
      variables: clone(input.variables || {}),
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
      payload,
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

    const nextState = clone(state);
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

    this.persistState(workflowId, nextState);
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
      },
    });

    return nextState;
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

    nextState.instance.variables = {
      ...nextState.instance.variables,
      runtimeRetry: {
        requestedBy: input.requestedBy || "operator",
        reason: input.reason?.trim() || "",
        retriedAt: nowIso(),
        nodeId: currentNodeId,
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
      metadata: input.metadata,
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

    run.transitionEdgeId = transition.edgeId;
    markEdgeExecuted(instance, transition.edgeId);
    this.emitRuntimeNodeEvent({
      state,
      eventKey: "node.completed",
      node,
      run,
      timestamp: run.completedAt,
    });
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
      timestamp: nowIso(),
      metadata: {
        kind:
          definition.edgeSchemas.find(edge => edge.id === transition.edgeId)?.kind || "success",
      },
    });
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
    const retryDelayMs = Math.max(0, Math.floor(getNodeConfigNumber(node, "retryDelayMs") || 0));
    const escalateOnRetryExhausted = getNodeConfigBoolean(node, "escalateOnRetryExhausted") === true;
    const automaticRetryCount = this.getAutomaticRetryCount(state, node.id);

    if (retryBudget > 0 && automaticRetryCount < retryBudget) {
      if (retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
      await this.applyAutomaticRetry(state, node, run, automaticRetryCount + 1, retryBudget, retryDelayMs);
      return true;
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
    state.instance.status = "EXECUTING";
    state.instance.error = undefined;
    state.instance.completedAt = null;
    state.instance.checkpoint = undefined;
    state.instance.variables = {
      ...state.instance.variables,
      runtimeRetry: {
        requestedBy: "runtime.auto_retry",
        reason: `Automatic retry ${nextAttempt}/${retryBudget} for ${node.id}`,
        retriedAt: nowIso(),
        nodeId: node.id,
      },
      runtimeAutoRetry: {
        ...(isRecord(state.instance.variables.runtimeAutoRetry)
          ? state.instance.variables.runtimeAutoRetry
          : {}),
        [node.id]: nextAttempt,
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
      },
    });

    return true;
  }
}

export const webAigcRuntimeEngine = new WorkflowRuntimeEngine(serverRuntime);
