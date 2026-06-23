import { randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

import { MISSION_CORE_STAGE_BLUEPRINT } from '../../shared/mission/contracts.js';
import type {
  ArtifactListItem,
  ArtifactListResponse,
  MissionEvent,
  MissionRecord,
} from '../../shared/mission/contracts.js';
import { EXECUTOR_API_ROUTES, type CancelExecutorJobRequest } from '../../shared/executor/api.js';
import type { SubmitMissionOperatorActionRequest } from '../../shared/mission/api.js';
import { BUILTIN_DECISION_TEMPLATES } from '../../shared/mission/decision-templates.js';
import {
  buildWorkflowDirectiveContext,
  buildWorkflowInputSignature,
  normalizeWorkflowAttachments,
  normalizeWorkflowInputProjection,
  type WorkflowInputAttachment,
} from '../../shared/workflow-input.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import db from '../db/index.js';
import { buildExecutionPlan } from '../core/execution-plan-builder.js';
import {
  ExecutorClient,
  getExecutorCapabilityMismatchReason,
} from '../core/executor-client.js';
import { workflowEngine } from '../core/workflow-engine.js';
import { linkWorkflowToMission } from '../core/mission-enrichment-bridge.js';
import type { ProjectRecord } from '../persistence/repositories.js';
import { submitMissionDecision } from '../tasks/mission-decision.js';
import {
  buildMissionProjectionView,
  buildMissionSessionView,
} from '../tasks/mission-projection.js';
import {
  MissionOperatorActionError,
  createMissionOperatorService,
} from '../tasks/mission-operator-service.js';
import {
  missionRuntime,
  type MissionRuntime,
} from '../tasks/mission-runtime.js';
import {
  getMimeType,
  isInlinePreviewMime,
  isTextMime,
  validateArtifactPath,
  resolveArtifactAbsolutePath,
  resolveExecutorJobAbsolutePath,
} from './artifact-utils.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_DECISION_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_EXECUTOR_BASE_URL = 'http://127.0.0.1:3031';
const FINAL_MISSION_STATUSES = new Set(['done', 'failed', 'cancelled']);

export interface TaskRouterOptions {
  fetchImpl?: typeof fetch;
  executorBaseUrl?: string;
  taskLifecycleRuntimeBaseUrl?: string;
  taskLifecycleProductionClosureBaseUrl?: string;
  workflowRetry?: WorkflowRetryDependencies;
  requireAuth?: RequestHandler;
  projects?: {
    findByIdForOwner(
      projectId: string,
      ownerUserId: string,
    ): Promise<ProjectRecord | null>;
  };
  projectResources?: {
    create<TPayload extends Record<string, unknown>>(input: {
      projectId: string;
      resourceType: 'mission';
      payload: TPayload;
    }): Promise<unknown>;
  };
}

interface WorkflowRetryStartOptions {
  attachments?: WorkflowInputAttachment[];
  directiveContext?: string;
  inputSignature?: string;
}

interface WorkflowRetryRecord {
  id: string;
  results?: {
    input?: Record<string, unknown>;
  } | null;
}

interface WorkflowRetryDependencies {
  startWorkflow(
    directive: string,
    options?: WorkflowRetryStartOptions,
  ): Promise<string>;
  getWorkflow(workflowId: string): WorkflowRetryRecord | undefined;
  updateWorkflow(
    workflowId: string,
    updates: { results?: Record<string, unknown> },
  ): void;
  linkWorkflowToMission(workflowId: string, missionId: string): void;
}

function parseLimit(rawValue: unknown, defaultLimit = DEFAULT_LIMIT): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return defaultLimit;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function buildTaskTitle(
  title: unknown,
  sourceText: unknown
): string | null {
  if (typeof title === 'string' && title.trim()) {
    return title.trim();
  }

  if (typeof sourceText === 'string' && sourceText.trim()) {
    const compact = sourceText.trim().replace(/\s+/g, ' ');
    return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
  }

  return null;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getProjectionProjectId(body: Record<string, unknown>): string | undefined {
  const projection = body.projection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return undefined;
  }

  return parseOptionalString((projection as Record<string, unknown>).projectId);
}

function missionLinkPayload(projectId: string, task: MissionRecord): Record<string, unknown> {
  return {
    projectId,
    missionId: task.id,
    status: task.status,
    createdAt: new Date(task.createdAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
  };
}

function runRequestHandler(
  handler: RequestHandler,
  request: Request,
  response: Parameters<RequestHandler>[1],
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off('finish', onFinished);
      response.off('close', onFinished);
    };
    const onFinished = () => {
      cleanup();
      resolve(false);
    };

    response.once('finish', onFinished);
    response.once('close', onFinished);

    handler(request, response, error => {
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(true);
    });
  });
}

function normalizeCancelSource(value: unknown): MissionEvent['source'] {
  switch (value) {
    case 'brain':
    case 'executor':
    case 'feishu':
    case 'mission-core':
    case 'user':
      return value;
    default:
      return 'user';
  }
}

function toExecutorCancelSource(
  source: MissionEvent['source'],
): CancelExecutorJobRequest['source'] {
  switch (source) {
    case 'user':
    case 'brain':
    case 'feishu':
      return source;
    case 'executor':
    case 'mission-core':
    default:
      return 'system';
  }
}

function buildExecutorUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function resolveTaskLifecycleRuntimeBaseUrl(
  options: TaskRouterOptions,
): string | undefined {
  const configured =
    options.taskLifecycleRuntimeBaseUrl?.trim() ||
    process.env.TASK_LIFECYCLE_RUNTIME_BASE_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : undefined;
}

function resolveTaskLifecycleProductionClosureBaseUrl(
  options: TaskRouterOptions,
): string | undefined {
  const configured =
    options.taskLifecycleProductionClosureBaseUrl?.trim() ||
    process.env.TASK_LIFECYCLE_PRODUCTION_CLOSURE_BASE_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : undefined;
}

function buildTaskLifecycleRuntimeUrl(baseUrl: string, action: string): string {
  return new URL(
    `/api/tasks/runtime/${action}`,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  ).toString();
}

function buildTaskLifecycleMetadata(
  task: MissionRecord,
  input: {
    projectId?: string;
    authChecked?: boolean;
  } = {},
): Record<string, unknown> {
  const projectId = input.projectId ?? task.projection?.projectId;
  return {
    ...(projectId
      ? {
          project: {
            projectId,
            validatedBy: 'node',
          },
        }
      : {}),
    resource: {
      resourceType: 'mission',
      resourceId: task.id,
      owner: 'node',
    },
    auth: {
      owner: 'node',
      required: Boolean(projectId),
      checked: Boolean(input.authChecked || !projectId),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskLifecycleRuntimeEnvelope(
  value: unknown,
): value is TaskLifecycleRuntimeEnvelope {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }
  if (value.ok === false) {
    return (
      typeof value.error === 'string' &&
      typeof value.code === 'string' &&
      typeof value.message === 'string'
    );
  }
  return value.ok === true && isRecord(value.task);
}

function formatTaskLifecycleError(
  envelope: TaskLifecycleRuntimeFailure,
): string {
  return `${envelope.code}: ${envelope.message}`;
}

function mapLifecycleRuntimeStatusToMissionStatus(
  status: TaskLifecycleRuntimeTask['status'],
  fallback?: MissionRecord['status'],
): MissionRecord['status'] {
  switch (status) {
    case 'started':
      return fallback === 'queued' ? 'queued' : 'running';
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return fallback ?? 'running';
  }
}

interface MissionDispatchResult {
  task: MissionRecord | undefined;
  dispatchAccepted: boolean;
  dispatchError?: string;
}

type TaskLifecycleRuntimeAction =
  | 'create'
  | 'status'
  | 'cancel'
  | 'error'
  | 'replay';

interface TaskLifecycleRuntimeTask {
  id: string;
  status: 'started' | 'running' | 'completed' | 'failed' | 'cancelled';
  nodeStatus?: MissionRecord['status'];
  progress?: number;
  stageKey?: string;
  message?: string;
  updatedAt?: string;
  summary?: string;
  error?: {
    code?: string;
    message?: string;
  };
  cancelRequested?: boolean;
}

interface TaskLifecycleRuntimeReplay {
  missionId: string;
  eventCount: number;
  limit: number;
  owner: 'node';
  events: MissionEvent[];
}

interface TaskLifecycleRuntimeSuccess {
  ok: true;
  action: TaskLifecycleRuntimeAction;
  contractVersion: string;
  runtime?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  task: TaskLifecycleRuntimeTask;
  replay?: TaskLifecycleRuntimeReplay;
}

interface TaskLifecycleRuntimeFailure {
  ok: false;
  action: TaskLifecycleRuntimeAction;
  contractVersion?: string;
  error: string;
  code: string;
  message: string;
  retryable?: boolean;
  runtime?: Record<string, unknown>;
}

type TaskLifecycleRuntimeEnvelope =
  | TaskLifecycleRuntimeSuccess
  | TaskLifecycleRuntimeFailure;

interface TaskLifecycleRuntimeCallInput {
  action: TaskLifecycleRuntimeAction;
  task: MissionRecord;
  metadata: Record<string, unknown>;
  events?: MissionEvent[];
  limit?: number;
  reason?: string;
}

interface TaskLifecycleProductionClosureEnvelope {
  ok: boolean;
  status?: string;
  action?: string;
  contractVersion?: string;
  provenance?: string;
  missionId?: string;
  projectId?: string;
  resourceId?: string;
  error?: string;
  code?: string;
  message?: string;
  runtime?: Record<string, unknown>;
  closureSummary?: {
    missionId?: string;
    projectId?: string;
    resourceId?: string;
    actor?: unknown;
    decision?: string;
    projection?: Record<string, unknown>;
    replay?: unknown;
    cancel?: unknown;
    taskProjection?: unknown;
  };
  metadata?: Record<string, unknown>;
}

function buildServerBaseUrl(request: Request): string {
  const forwardedProto = request.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.header('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get('host') || '127.0.0.1';
  return `${protocol}://${host}`;
}

function shouldAutoDispatchMission(
  task: Pick<MissionRecord, 'kind'>,
  requested: unknown,
): boolean {
  if (requested === true) return true;
  if (requested === false) return false;
  return task.kind === 'nl-command';
}

function shouldRestartWorkflowMission(
  task: Pick<MissionRecord, 'kind' | 'projection'>,
): boolean {
  return (
    task.kind !== 'nl-command' &&
    typeof task.projection?.workflowId === 'string' &&
    task.projection.workflowId.trim().length > 0
  );
}

function getWorkflowRetryDependencies(
  options: TaskRouterOptions,
): WorkflowRetryDependencies {
  return (
    options.workflowRetry ?? {
      startWorkflow: (directive, retryOptions) =>
        workflowEngine.startWorkflow(directive, retryOptions),
      getWorkflow: workflowId => db.getWorkflow(workflowId),
      updateWorkflow: (workflowId, updates) => db.updateWorkflow(workflowId, updates),
      linkWorkflowToMission,
    }
  );
}

function getWorkflowInput(
  workflow: WorkflowRetryRecord | undefined,
): Record<string, unknown> {
  return workflow?.results?.input &&
    typeof workflow.results.input === 'object' &&
    !Array.isArray(workflow.results.input)
    ? workflow.results.input
    : {};
}

interface WorkflowMissionRetryResult {
  task: MissionRecord | undefined;
  dispatchAccepted: boolean;
  dispatchError?: string;
  workflowId?: string;
  previousWorkflowId?: string;
}

async function restartMissionWorkflow(
  runtime: MissionRuntime,
  missionId: string,
  dependencies: WorkflowRetryDependencies,
  source: MissionEvent['source'] = 'brain',
): Promise<WorkflowMissionRetryResult> {
  const mission = runtime.getTask(missionId);
  if (!mission) {
    return {
      task: undefined,
      dispatchAccepted: false,
      dispatchError: 'Mission not found',
    };
  }

  const previousWorkflowId = mission.projection?.workflowId?.trim();
  if (!previousWorkflowId) {
    return {
      task: mission,
      dispatchAccepted: false,
      dispatchError: 'Mission is not linked to a workflow.',
    };
  }

  const sourceText = mission.sourceText?.trim() || mission.title;
  const previousWorkflow = dependencies.getWorkflow(previousWorkflowId);
  const previousInput = getWorkflowInput(previousWorkflow);
  const attachments = normalizeWorkflowAttachments(previousInput.attachments);
  const projection = normalizeWorkflowInputProjection({
    ...(previousInput.projection &&
    typeof previousInput.projection === 'object' &&
    !Array.isArray(previousInput.projection)
      ? previousInput.projection
      : {}),
    sessionId:
      previousInput.sessionId ??
      mission.projection?.sessionId ??
      mission.topicId,
    sourceApp: previousInput.sourceApp ?? mission.projection?.sourceApp,
    projectId: mission.projection?.projectId,
  });
  const directiveContext = buildWorkflowDirectiveContext(sourceText, attachments);
  const inputSignature = buildWorkflowInputSignature(sourceText, attachments);

  try {
    const workflowId = await dependencies.startWorkflow(sourceText, {
      attachments,
      directiveContext,
      inputSignature,
    });
    const workflow = dependencies.getWorkflow(workflowId);
    const workflowInput = getWorkflowInput(workflow);

    dependencies.updateWorkflow(workflowId, {
      results: {
        ...(workflow?.results || {}),
        input: {
          ...workflowInput,
          attachments,
          directiveContext,
          signature: inputSignature,
          ...(projection?.sessionId ? { sessionId: projection.sessionId } : {}),
          ...(projection?.sourceApp ? { sourceApp: projection.sourceApp } : {}),
          ...(projection ? { projection } : {}),
        },
      },
    });

    dependencies.linkWorkflowToMission(workflowId, missionId);
    runtime.patchMissionExecution(missionId, {
      projection: {
        workflowId,
        instanceId: workflowId,
        replayId: workflowId,
        ...(projection || {}),
      },
    });
    runtime.logMission(
      missionId,
      `Retry started workflow ${workflowId} from previous workflow ${previousWorkflowId}.`,
      'info',
      2,
      source,
    );
    const runningTask = runtime.markMissionRunning(
      missionId,
      'execute',
      `Workflow ${workflowId} restarted for retry attempt ${mission.attempt ?? 1}.`,
      4,
      source,
    );

    return {
      task: runningTask,
      dispatchAccepted: true,
      workflowId,
      previousWorkflowId,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedTask = runtime.failMission(
      missionId,
      `Workflow retry dispatch failed: ${detail}`,
      source,
    );
    return {
      task: failedTask,
      dispatchAccepted: false,
      dispatchError: detail,
      previousWorkflowId,
    };
  }
}

async function callTaskLifecycleRuntime(
  input: TaskLifecycleRuntimeCallInput,
  options: {
    baseUrl?: string;
    fetchImpl: typeof fetch;
  },
): Promise<TaskLifecycleRuntimeEnvelope | undefined> {
  if (!options.baseUrl) {
    return undefined;
  }

  const response = await options.fetchImpl(
    buildTaskLifecycleRuntimeUrl(options.baseUrl, input.action),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: input.action,
        task: input.task,
        metadata: input.metadata,
        ...(input.events ? { events: input.events } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        now: new Date().toISOString(),
      }),
    },
  );
  const rawBody = await response.text();
  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return {
      ok: false,
      action: input.action,
      error: 'runtime_error',
      code: 'TASK_LIFECYCLE_RUNTIME_PROTOCOL_ERROR',
      message: 'Task lifecycle runtime returned a non-JSON response.',
      retryable: false,
    };
  }

  if (isTaskLifecycleRuntimeEnvelope(parsed)) {
    return parsed;
  }

  return {
    ok: false,
    action: input.action,
    error: 'runtime_error',
    code: 'TASK_LIFECYCLE_RUNTIME_PROTOCOL_ERROR',
    message: response.ok
      ? 'Task lifecycle runtime response is missing required fields.'
      : `Task lifecycle runtime request failed with HTTP ${response.status}.`,
    retryable: response.ok ? false : true,
  };
}

async function callTaskLifecycleRuntimeSafely(
  input: TaskLifecycleRuntimeCallInput,
  options: {
    baseUrl?: string;
    fetchImpl: typeof fetch;
  },
): Promise<TaskLifecycleRuntimeEnvelope | undefined> {
  try {
    return await callTaskLifecycleRuntime(input, options);
  } catch (error) {
    return {
      ok: false,
      action: input.action,
      error: 'runtime_error',
      code: 'TASK_LIFECYCLE_RUNTIME_UNAVAILABLE',
      message:
        error instanceof Error
          ? error.message
          : 'Task lifecycle runtime is unavailable.',
      retryable: true,
    };
  }
}

async function callTaskLifecycleProductionClosure(
  payload: Record<string, unknown>,
  options: {
    baseUrl?: string;
    fetchImpl: typeof fetch;
  },
): Promise<TaskLifecycleProductionClosureEnvelope | undefined> {
  if (!options.baseUrl) {
    return undefined;
  }
  const url = new URL(
    '/api/tasks/runtime/closure',
    options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`,
  ).toString();
  const response = await options.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, now: new Date().toISOString() }),
  });
  const text = await response.text();
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object') {
      return parsed as TaskLifecycleProductionClosureEnvelope;
    }
  } catch {
    // fallthrough
  }
  return {
    ok: false,
    error: 'runtime_error',
    code: 'TASK_LIFECYCLE_CLOSURE_PROTOCOL_ERROR',
    message: response.ok ? 'Closure response missing fields.' : `Closure failed ${response.status}`,
  };
}

async function callTaskLifecycleProductionClosureSafely(
  payload: Record<string, unknown>,
  options: {
    baseUrl?: string;
    fetchImpl: typeof fetch;
  },
): Promise<TaskLifecycleProductionClosureEnvelope | undefined> {
  try {
    return await callTaskLifecycleProductionClosure(payload, options);
  } catch (error) {
    return {
      ok: false,
      error: 'runtime_error',
      code: 'TASK_LIFECYCLE_CLOSURE_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Task lifecycle production closure unavailable.',
    };
  }
}

function applyLifecycleRuntimeTaskEnvelope(
  runtime: MissionRuntime,
  current: MissionRecord,
  envelope: TaskLifecycleRuntimeSuccess,
  source: MissionEvent['source'] = 'mission-core',
): MissionRecord {
  const lifecycleTask = envelope.task;
  const targetStatus = mapLifecycleRuntimeStatusToMissionStatus(
    lifecycleTask.status,
    current.status,
  );
  const stageKey = lifecycleTask.stageKey || current.currentStageKey;
  const message = lifecycleTask.message;
  const progress =
    typeof lifecycleTask.progress === 'number'
      ? lifecycleTask.progress
      : undefined;

  if (
    (current.status === 'done' && targetStatus === 'done') ||
    (current.status === 'failed' && targetStatus === 'failed') ||
    (current.status === 'cancelled' && targetStatus === 'cancelled')
  ) {
    return runtime.updateMission(current.id, task => {
      if (progress !== undefined) {
        task.progress = progress;
      }
      if (lifecycleTask.summary) {
        task.summary = lifecycleTask.summary;
      }
    }) ?? current;
  }

  if (targetStatus === 'done') {
    return runtime.finishMission(current.id, lifecycleTask.summary || message, source) ?? current;
  }

  if (targetStatus === 'failed') {
    return runtime.failMission(
      current.id,
      lifecycleTask.error?.message || message || 'Task lifecycle failed.',
      source,
    ) ?? current;
  }

  if (targetStatus === 'cancelled') {
    return runtime.cancelMission(current.id, {
      reason: message,
      source,
    }) ?? current;
  }

  if (targetStatus === 'running') {
    return runtime.markMissionRunning(
      current.id,
      stageKey,
      message || 'Task lifecycle runtime reports the task is running.',
      progress,
      source,
    ) ?? current;
  }

  return current;
}

function failMissionFromLifecycleRuntime(
  runtime: MissionRuntime,
  task: MissionRecord,
  envelope: TaskLifecycleRuntimeFailure,
  source: MissionEvent['source'] = 'mission-core',
): MissionRecord {
  return runtime.failMission(
    task.id,
    formatTaskLifecycleError(envelope),
    source,
  ) ?? task;
}

function applyMissionDispatchPayload(
  job: { payload?: Record<string, unknown> },
  missionId: string,
  sourceText: string,
  executionMode: 'mock' | 'real',
): void {
  const existing = job.payload || {};
  const existingEnv =
    typeof existing.env === 'object' &&
    existing.env !== null &&
    !Array.isArray(existing.env)
      ? (existing.env as Record<string, unknown>)
      : {};

  if (executionMode === 'mock') {
    const { aiEnabled: _aiEnabled, aiTaskType: _aiTaskType, runner: _runner, ...rest } = existing;

    job.payload = {
      ...rest,
      ...(Object.keys(existingEnv).length > 0 ? { env: existingEnv } : {}),
      runner: {
        kind: 'mock',
        outcome: 'success',
        steps: 3,
        delayMs: 40,
        summary: 'Mock mission execution completed.',
      },
    };
    return;
  }

  const { runner: _runner, ...rest } = existing;
  job.payload = {
    ...rest,
    aiEnabled: true,
    aiTaskType:
      typeof existing.aiTaskType === 'string' && existing.aiTaskType.trim()
        ? existing.aiTaskType.trim()
        : 'text-generation',
    command: [],
    env: {
      ...existingEnv,
      MISSION_ID: missionId,
      TASK_CONTENT: sourceText,
    },
  };
}

async function dispatchMissionToExecutor(
  runtime: MissionRuntime,
  missionId: string,
  options: {
    fetchImpl: typeof fetch;
    executorBaseUrl: string;
    callbackUrl: string;
    source?: MissionEvent['source'];
  },
): Promise<MissionDispatchResult> {
  const source = options.source ?? 'brain';
  const mission = runtime.getTask(missionId);
  if (!mission) {
    return {
      task: undefined,
      dispatchAccepted: false,
      dispatchError: 'Mission not found',
    };
  }

  const sourceText = mission.sourceText?.trim() || mission.title;
  runtime.markMissionRunning(
    missionId,
    'receive',
    'Mission intake accepted and queued for execution dispatch.',
    4,
    source,
  );
  runtime.updateMissionStage(
    missionId,
    'receive',
    {
      status: 'done',
      detail: 'Mission intake accepted and ready for execution planning.',
    },
    8,
    source,
  );
  runtime.markMissionRunning(
    missionId,
    'understand',
    'Reading mission objective and constraints.',
    12,
    source,
  );

  let buildResult: Awaited<ReturnType<typeof buildExecutionPlan>>;
  try {
    buildResult = await buildExecutionPlan({
      missionId,
      title: mission.title,
      sourceText,
      requestedBy: 'brain',
      topicId: mission.topicId,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failedTask = runtime.failMission(
      missionId,
      `Execution plan build failed: ${detail}`,
      source,
    );
    return {
      task: failedTask,
      dispatchAccepted: false,
      dispatchError: detail,
    };
  }

  runtime.updateMissionStage(
    missionId,
    'understand',
    {
      status: 'done',
      detail: buildResult.understanding.summary,
    },
    20,
    source,
  );
  runtime.markMissionRunning(
    missionId,
    'plan',
    'Structured execution plan created for runtime dispatch.',
    28,
    source,
  );
  runtime.updateMissionStage(
    missionId,
    'plan',
    {
      status: 'done',
      detail: buildResult.plan.summary,
    },
    36,
    source,
  );
  runtime.markMissionRunning(
    missionId,
    'provision',
    'Provisioning executor job on lobster.',
    45,
    source,
  );

  const firstJob = buildResult.plan.jobs[0];
  if (!firstJob) {
    const failedTask = runtime.failMission(
      missionId,
      'Execution plan did not produce any executor jobs.',
      source,
    );
    return {
      task: failedTask,
      dispatchAccepted: false,
      dispatchError: 'Execution plan did not produce any executor jobs.',
    };
  }

  const executionMode =
    process.env.LOBSTER_EXECUTION_MODE === 'mock' ? 'mock' : 'real';
  applyMissionDispatchPayload(firstJob, missionId, sourceText, executionMode);

  const executorClient = new ExecutorClient({
    baseUrl: options.executorBaseUrl,
    callbackUrl: options.callbackUrl,
    fetchImpl: options.fetchImpl,
  });

  try {
    const dispatchResult = await executorClient.dispatchPlan(buildResult.plan, {
      jobId: firstJob.id,
      requestId: `mission_${missionId}_attempt_${mission.attempt ?? 1}`,
      traceId: randomUUID(),
      idempotencyKey: `mission:${missionId}:attempt:${mission.attempt ?? 1}`,
    });

    runtime.updateMissionStage(
      missionId,
      'provision',
      {
        status: 'done',
        detail: `Executor accepted job ${dispatchResult.response.jobId}.`,
      },
      55,
      source,
    );
    runtime.patchMissionExecution(missionId, {
      executor: {
        name: dispatchResult.request.executor,
        requestId: dispatchResult.request.requestId,
        jobId: dispatchResult.response.jobId,
        status: 'queued',
        baseUrl: options.executorBaseUrl,
        lastEventType: 'job.accepted',
        lastEventAt: Date.now(),
      },
      instance: buildResult.plan.workspaceRoot
        ? {
            workspaceRoot: buildResult.plan.workspaceRoot,
          }
        : undefined,
      artifacts: buildResult.plan.artifacts,
    });
    const runningTask = runtime.markMissionRunning(
      missionId,
      'execute',
      'Executor accepted the mission. Docker execution is in progress.',
      60,
      source,
    );

    return {
      task: runningTask,
      dispatchAccepted: true,
    };
  } catch (error) {
    const detail =
      getExecutorCapabilityMismatchReason(error) ||
      (error instanceof Error ? error.message : String(error));
    const failedTask = runtime.failMission(
      missionId,
      `Executor dispatch failed: ${detail}`,
      source,
    );
    return {
      task: failedTask,
      dispatchAccepted: false,
      dispatchError: detail,
    };
  }
}

function isExecutorTerminalStatus(value: unknown): boolean {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

export function createTaskRouter(
  runtime: MissionRuntime = missionRuntime,
  options: TaskRouterOptions = {},
): Router {
  const router = Router();
  const EXECUTOR_LOG_WHITESPACE_CHECK_BYTES = 4096;
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultExecutorBaseUrl =
    options.executorBaseUrl?.trim() ||
    process.env.LOBSTER_EXECUTOR_BASE_URL?.trim() ||
    DEFAULT_EXECUTOR_BASE_URL;
  const taskLifecycleRuntimeBaseUrl = resolveTaskLifecycleRuntimeBaseUrl(options);
  const operatorService = createMissionOperatorService(runtime, {
    fetchImpl,
    executorBaseUrl: defaultExecutorBaseUrl,
  });
  const workflowRetry = getWorkflowRetryDependencies(options);

  async function buildExecutorLogFallback(
    missionId: string,
    jobId: string,
  ): Promise<string | null> {
    const eventsPath = resolveExecutorJobAbsolutePath(missionId, jobId, 'events.jsonl');

    try {
      const raw = await readFile(eventsPath, 'utf-8');
      const lines = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            const parsed = JSON.parse(line) as {
              occurredAt?: string;
              message?: string;
              summary?: string;
              type?: string;
            };
            const timestamp = parsed.occurredAt?.trim() || 'unknown-time';
            const message =
              parsed.message?.trim() ||
              parsed.summary?.trim() ||
              parsed.type?.trim() ||
              line;
            return `[${timestamp}] ${message}`;
          } catch {
            return line;
          }
        });

      return lines.length > 0 ? `${lines.join('\n')}\n` : '';
    } catch {
      return null;
    }
  }

  async function resolveExecutorLogFallback(
    missionId: string,
    jobId: string,
    absolutePath: string,
  ): Promise<string | null> {
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        return buildExecutorLogFallback(missionId, jobId);
      }

      if (fileStat.size === 0) {
        return buildExecutorLogFallback(missionId, jobId);
      }

      if (fileStat.size > EXECUTOR_LOG_WHITESPACE_CHECK_BYTES) {
        return null;
      }

      const content = await readFile(absolutePath, 'utf-8');
      return content.trim().length === 0
        ? buildExecutorLogFallback(missionId, jobId)
        : null;
    } catch {
      return buildExecutorLogFallback(missionId, jobId);
    }
  }

  router.post('/', async (req, res) => {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : {};
    const title = buildTaskTitle(body.title, body.sourceText);
    const bodyProjectId = parseOptionalString(body.projectId);
    const projectionProjectId = getProjectionProjectId(body);
    if (bodyProjectId && projectionProjectId && bodyProjectId !== projectionProjectId) {
      return res.status(400).json({
        error: 'projectId mismatch between request body and projection',
      });
    }

    const requestedProjectId = bodyProjectId ?? projectionProjectId;
    const projection = normalizeWorkflowInputProjection({
      ...(typeof body.projection === 'object' && body.projection !== null
        ? body.projection
        : {}),
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : body.topicId,
      sourceApp: typeof body.sourceApp === 'string' ? body.sourceApp : undefined,
    });
    if (!title) {
      return res.status(400).json({
        error: 'title or sourceText is required',
      });
    }

    let ownedProjectId: string | undefined;
    if (requestedProjectId) {
      if (!options.requireAuth || !options.projects) {
        return res.status(500).json({
          error: 'Project owner validation is not configured',
        });
      }

      const authenticated = await runRequestHandler(options.requireAuth, req, res);
      if (!authenticated) {
        return undefined;
      }

      const userId = (req as AuthenticatedRequest).user?.id;
      if (!userId) {
        const authDeniedClosureBaseUrl = resolveTaskLifecycleProductionClosureBaseUrl(options);
        if (authDeniedClosureBaseUrl) {
          await callTaskLifecycleProductionClosureSafely(
            {
              action: 'auth-denied',
              projectId: requestedProjectId,
              reason: 'Authentication required',
            },
            { baseUrl: authDeniedClosureBaseUrl, fetchImpl },
          );
        }
        return res.status(401).json({ error: 'Authentication required' });
      }

      const project = await options.projects.findByIdForOwner(
        requestedProjectId,
        userId,
      );
      if (!project) {
        const currentUserForDenied = (req as unknown as AuthenticatedRequest).user;
        const deniedActor = currentUserForDenied
          ? { id: currentUserForDenied.id, email: currentUserForDenied.email, role: currentUserForDenied.role }
          : undefined;
        const authDeniedClosureBaseUrl = resolveTaskLifecycleProductionClosureBaseUrl(options);
        if (authDeniedClosureBaseUrl) {
          await callTaskLifecycleProductionClosureSafely(
            {
              action: 'auth-denied',
              projectId: requestedProjectId,
              actor: deniedActor,
              reason: 'Project or resource authorization denied.',
            },
            { baseUrl: authDeniedClosureBaseUrl, fetchImpl },
          );
        }
        return res.status(404).json({ error: 'Project not found.' });
      }
      ownedProjectId = project.id;
    }

    const currentUserForClosure = (req as unknown as AuthenticatedRequest).user;
    const actor = currentUserForClosure
      ? { id: currentUserForClosure.id, email: currentUserForClosure.email, role: currentUserForClosure.role }
      : undefined;

    let task = runtime.createTask({
      kind: typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'chat',
      title,
      sourceText:
        typeof body.sourceText === 'string' && body.sourceText.trim()
          ? body.sourceText.trim()
          : undefined,
      topicId:
        typeof body.topicId === 'string' && body.topicId.trim()
          ? body.topicId.trim()
          : projection?.sessionId,
      projection: {
        ...(typeof body.workflowId === 'string' && body.workflowId.trim()
          ? {
              workflowId: body.workflowId.trim(),
              instanceId: body.workflowId.trim(),
              replayId: body.workflowId.trim(),
            }
          : {}),
        ...(projection || {}),
        ...(ownedProjectId ? { projectId: ownedProjectId } : {}),
      },
      stageLabels: [...MISSION_CORE_STAGE_BLUEPRINT],
    });
    const lifecycleMetadata = buildTaskLifecycleMetadata(task, {
      projectId: ownedProjectId,
      authChecked: Boolean(ownedProjectId),
    });
    let lifecycle: TaskLifecycleRuntimeEnvelope | undefined;
    let lifecycleError: string | undefined;

    lifecycle = await callTaskLifecycleRuntimeSafely(
      {
        action: 'create',
        task,
        metadata: lifecycleMetadata,
      },
      {
        baseUrl: taskLifecycleRuntimeBaseUrl,
        fetchImpl,
      },
    );
    if (lifecycle?.ok === true) {
      task = applyLifecycleRuntimeTaskEnvelope(runtime, task, lifecycle, 'mission-core');
    } else if (lifecycle?.ok === false) {
      lifecycleError = formatTaskLifecycleError(lifecycle);
      task = failMissionFromLifecycleRuntime(runtime, task, lifecycle, 'mission-core');
    }

    // Consume Python production closure summary (preserves Node store boundary)
    const taskLifecycleProductionClosureBaseUrl = resolveTaskLifecycleProductionClosureBaseUrl(options);
    let closureSummary: TaskLifecycleProductionClosureEnvelope | undefined;
    if (taskLifecycleProductionClosureBaseUrl) {
      const closureAction = (lifecycle?.ok === false || lifecycleError) ? 'error' : 'create';
      const closurePayload: Record<string, unknown> = {
        action: closureAction,
        missionId: task.id,
        projectId: ownedProjectId,
        task,
        metadata: lifecycleMetadata,
        events: runtime.listTaskEvents(task.id, 10),
      };
      if (actor) {
        closurePayload.actor = actor;
      }
      if (closureAction === 'error') {
        const failEnv = lifecycle as TaskLifecycleRuntimeFailure | undefined;
        closurePayload.error = {
          code: failEnv?.code || 'TASK_LIFECYCLE_ERROR',
          message: lifecycleError || failEnv?.message || 'lifecycle error from production closure path',
        };
      }
      closureSummary = await callTaskLifecycleProductionClosureSafely(
        closurePayload,
        { baseUrl: taskLifecycleProductionClosureBaseUrl, fetchImpl },
      );
    }

    let dispatchAccepted: boolean | undefined;
    let dispatchError: string | undefined;
    if (!lifecycleError && shouldAutoDispatchMission(task, body.autoDispatch)) {
      const dispatched = await dispatchMissionToExecutor(runtime, task.id, {
        fetchImpl,
        executorBaseUrl: defaultExecutorBaseUrl,
        callbackUrl: new URL(
          EXECUTOR_API_ROUTES.events,
          buildServerBaseUrl(req)
        ).toString(),
      });
      task = dispatched.task ?? task;
      dispatchAccepted = dispatched.dispatchAccepted;
      dispatchError = dispatched.dispatchError;
    }

    if (ownedProjectId && options.projectResources) {
      await options.projectResources.create({
        projectId: ownedProjectId,
        resourceType: 'mission',
        payload: missionLinkPayload(ownedProjectId, task),
      });
    }

    return res.status(201).json({
      ok: true,
      task,
      ...(lifecycle
        ? {
            ...(lifecycle.ok ? { lifecycle } : {}),
            ...(lifecycleError ? { lifecycleError } : {}),
          }
        : {}),
      ...(closureSummary ? { closure: closureSummary } : {}),
      ...(dispatchAccepted === undefined
        ? {}
        : {
            dispatchAccepted,
            dispatchError,
          }),
    });
  });

  router.get('/', (req, res) => {
    const limit = parseLimit(req.query.limit);
    res.json({
      ok: true,
      tasks: runtime.listTasks(limit),
    });
  });

  router.get('/:id', async (req, res) => {
    let task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const lifecycle = await callTaskLifecycleRuntimeSafely(
      {
        action: 'status',
        task,
        metadata: buildTaskLifecycleMetadata(task),
      },
      {
        baseUrl: taskLifecycleRuntimeBaseUrl,
        fetchImpl,
      },
    );
    if (lifecycle?.ok === true) {
      task = applyLifecycleRuntimeTaskEnvelope(runtime, task, lifecycle, 'mission-core');
    }

    res.json({
      ok: true,
      task,
      ...(lifecycle?.ok === true ? { lifecycle } : {}),
      ...(lifecycle?.ok === false
        ? { lifecycleError: formatTaskLifecycleError(lifecycle) }
        : {}),
    });
  });

  router.get('/:id/projection', (req, res) => {
    const projection = buildMissionProjectionView(runtime, req.params.id);
    if (!projection) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      ok: true,
      missionId: req.params.id,
      projection,
    });
  });

  router.get('/:id/session', (req, res) => {
    const result = buildMissionSessionView(runtime, req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result);
  });

  router.get('/:id/events', async (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const limit = parseLimit(req.query.limit);
    const events = runtime.listTaskEvents(task.id, limit);

    const replayUser = (req as unknown as AuthenticatedRequest).user;
    const replayActor = replayUser ? { id: replayUser.id, email: replayUser.email, role: replayUser.role } : undefined;

    const lifecycle = await callTaskLifecycleRuntimeSafely(
      {
        action: 'replay',
        task,
        metadata: buildTaskLifecycleMetadata(task),
        events,
        limit,
      },
      {
        baseUrl: taskLifecycleRuntimeBaseUrl,
        fetchImpl,
      },
    );

    // Consume Python production closure for replay (preserves event sequence at boundary)
    let replayClosureSummary: TaskLifecycleProductionClosureEnvelope | undefined;
    const replayClosureBaseUrl = resolveTaskLifecycleProductionClosureBaseUrl(options);
    if (replayClosureBaseUrl) {
      replayClosureSummary = await callTaskLifecycleProductionClosureSafely(
        {
          action: 'replay',
          missionId: task.id,
          projectId:
            task.projection && typeof task.projection === 'object' && !Array.isArray(task.projection)
              ? (task.projection as Record<string, unknown>).projectId as string | undefined
              : undefined,
          task,
          actor: replayActor,
          events,
          limit,
          metadata: buildTaskLifecycleMetadata(task),
        },
        { baseUrl: replayClosureBaseUrl, fetchImpl },
      );
    }

    res.json({
      ok: true,
      missionId: task.id,
      events,
      ...(lifecycle?.ok === true ? { lifecycle } : {}),
      ...(lifecycle?.ok === false
        ? { lifecycleError: formatTaskLifecycleError(lifecycle) }
        : {}),
      ...(replayClosureSummary ? { closure: replayClosureSummary } : {}),
    });
  });

  router.get('/:id/decisions', (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const limit = parseLimit(req.query.limit, DEFAULT_DECISION_LIMIT);
    const history = task.decisionHistory ?? [];
    const sliced = history.slice(-limit);
    res.json({
      ok: true,
      missionId: task.id,
      decisions: sliced,
    });
  });

  router.post('/:id/cancel', async (req, res) => {
    const task = runtime.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (FINAL_MISSION_STATUSES.has(task.status)) {
      return res.json({
        ok: true,
        alreadyFinal: true,
        executorForwarded: false,
        task,
      });
    }

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : undefined;
    const requestedBy =
      typeof req.body?.requestedBy === 'string' && req.body.requestedBy.trim()
        ? req.body.requestedBy.trim()
        : undefined;
    const source = normalizeCancelSource(req.body?.source);

    const cancelUser = (req as unknown as AuthenticatedRequest).user;
    const cancelActor = cancelUser
      ? { id: cancelUser.id, email: cancelUser.email, role: cancelUser.role }
      : requestedBy
      ? { id: requestedBy }
      : undefined;

    const cancelProjectId =
      task.projection && typeof task.projection === 'object' && !Array.isArray(task.projection)
        ? (task.projection as Record<string, unknown>).projectId as string | undefined
        : undefined;

    const lifecycle = await callTaskLifecycleRuntimeSafely(
      {
        action: 'cancel',
        task,
        metadata: buildTaskLifecycleMetadata(task),
        reason,
      },
      {
        baseUrl: taskLifecycleRuntimeBaseUrl,
        fetchImpl,
      },
    );
    if (lifecycle?.ok === false) {
      return res.status(502).json({
        error: formatTaskLifecycleError(lifecycle),
      });
    }

    const executorJobId = task.executor?.jobId?.trim();
    let executorForwarded = false;

    if (executorJobId) {
      const executorBaseUrl =
        task.executor?.baseUrl?.trim() || defaultExecutorBaseUrl;
      const requestBody: CancelExecutorJobRequest = {
        reason,
        requestedBy,
        source: toExecutorCancelSource(source),
      };

      let downstreamResponse: Response;
      try {
        downstreamResponse = await fetchImpl(
          buildExecutorUrl(
            executorBaseUrl,
            EXECUTOR_API_ROUTES.cancelJob.replace(':id', encodeURIComponent(executorJobId)),
          ),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          },
        );
      } catch (error) {
        return res.status(503).json({
          error:
            error instanceof Error
              ? `Executor cancel request failed: ${error.message}`
              : 'Executor cancel request failed',
        });
      }

      const rawBody = await downstreamResponse.text();
      let parsedBody: unknown = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsedBody = null;
      }

      if (!downstreamResponse.ok) {
        const message =
          typeof parsedBody === 'object' &&
          parsedBody !== null &&
          'error' in parsedBody &&
          typeof parsedBody.error === 'string'
            ? parsedBody.error
            : `Executor cancel request failed with HTTP ${downstreamResponse.status}`;

        if (downstreamResponse.status !== 404) {
          return res.status(502).json({ error: message });
        }
      } else {
        executorForwarded = true;
        const downstreamStatus =
          typeof parsedBody === 'object' &&
          parsedBody !== null &&
          'status' in parsedBody
            ? parsedBody.status
            : undefined;
        if (!isExecutorTerminalStatus(downstreamStatus)) {
          executorForwarded = true;
        }
      }
    }

    const cancelled = runtime.cancelMission(task.id, {
      reason,
      requestedBy,
      source,
    });

    // Consume Python production closure for cancel (mission service/route boundary)
    let cancelClosureSummary: TaskLifecycleProductionClosureEnvelope | undefined;
    const cancelClosureBaseUrl = resolveTaskLifecycleProductionClosureBaseUrl(options);
    if (cancelClosureBaseUrl) {
      cancelClosureSummary = await callTaskLifecycleProductionClosureSafely(
        {
          action: 'cancel',
          missionId: task.id,
          projectId: cancelProjectId,
          task: cancelled ?? task,
          reason,
          actor: cancelActor,
          events: runtime.listTaskEvents(task.id, 10),
          metadata: buildTaskLifecycleMetadata(task),
        },
        { baseUrl: cancelClosureBaseUrl, fetchImpl },
      );
    }

    return res.json({
      ok: true,
      alreadyFinal: false,
      executorForwarded,
      task: cancelled,
      ...(lifecycle?.ok === true ? { lifecycle } : {}),
      ...(cancelClosureSummary ? { closure: cancelClosureSummary } : {}),
    });
  });

  router.post('/:id/operator-actions', async (req, res) => {
    try {
      const input = (req.body || {}) as SubmitMissionOperatorActionRequest;
      const result = await operatorService.submit(req.params.id, input);
      let task = result.task;
      let dispatchAccepted: boolean | undefined;
      let dispatchError: string | undefined;

      if (input.action === 'retry' && shouldRestartWorkflowMission(task)) {
        const restarted = await restartMissionWorkflow(
          runtime,
          task.id,
          workflowRetry,
        );
        task = restarted.task ?? task;
        dispatchAccepted = restarted.dispatchAccepted;
        dispatchError = restarted.dispatchError;
      } else if (input.action === 'retry' && shouldAutoDispatchMission(task, undefined)) {
        const dispatched = await dispatchMissionToExecutor(runtime, task.id, {
          fetchImpl,
          executorBaseUrl: defaultExecutorBaseUrl,
          callbackUrl: new URL(
            EXECUTOR_API_ROUTES.events,
            buildServerBaseUrl(req)
          ).toString(),
        });
        task = dispatched.task ?? task;
        dispatchAccepted = dispatched.dispatchAccepted;
        dispatchError = dispatched.dispatchError;
      }

      return res.json({
        ok: true,
        action: result.action,
        task,
        ...(dispatchAccepted === undefined
          ? {}
          : {
              dispatchAccepted,
              dispatchError,
            }),
      });
    } catch (error) {
      if (error instanceof MissionOperatorActionError) {
        return res.status(error.statusCode).json({
          error: error.message,
          allowedActions: error.allowedActions,
        });
      }

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Mission operator action failed',
      });
    }
  });

  /* ─── Artifact Routes (Task 2.1 / 2.2 / 2.3) ─── */

  // 2.1 — List artifacts
  router.get('/:id/artifacts', (req, res) => {
    const mission = runtime.getTask(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: `Mission not found: ${req.params.id}` });
    }

    const raw = mission.artifacts ?? [];
    const artifacts: ArtifactListItem[] = raw.map((a, index) => ({
      ...a,
      index,
      downloadUrl: `/api/tasks/${mission.id}/artifacts/${index}/download`,
    }));

    const body: ArtifactListResponse = {
      ok: true,
      missionId: mission.id,
      artifacts,
    };
    return res.json(body);
  });

  // 2.2 — Download artifact
  router.get('/:id/artifacts/:index/download', async (req, res) => {
    const mission = runtime.getTask(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: `Mission not found: ${req.params.id}` });
    }

    const raw = mission.artifacts ?? [];
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= raw.length) {
      return res.status(404).json({ error: `Artifact not found at index ${req.params.index}` });
    }

    const artifact = raw[idx];

    // URL artifacts → 302 redirect
    if (artifact.kind === 'url') {
      return res.redirect(302, artifact.url ?? '');
    }

    if (!artifact.path) {
      return res.status(404).json({ error: 'Artifact has no file path' });
    }

    if (!validateArtifactPath(artifact.path)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    const jobId = mission.executor?.jobId ?? '';
    const absPath = resolveArtifactAbsolutePath(mission.id, jobId, artifact.path);

    if (artifact.name === 'executor.log') {
      const fallbackLog = await resolveExecutorLogFallback(mission.id, jobId, absPath);
      if (fallbackLog !== null) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
        return res.send(fallbackLog);
      }
    }

    try {
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) {
        return res.status(404).json({ error: 'Artifact file not found' });
      }
    } catch {
      return res.status(404).json({ error: 'Artifact file not found' });
    }

    res.setHeader('Content-Type', artifact.mimeType || getMimeType(artifact.name));
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
    const stream = fs.createReadStream(absPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read artifact file' });
      }
    });
    stream.pipe(res);
  });

  // 2.3 — Preview artifact
  router.get('/:id/artifacts/:index/preview', async (req, res) => {
    const mission = runtime.getTask(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: `Mission not found: ${req.params.id}` });
    }

    const raw = mission.artifacts ?? [];
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= raw.length) {
      return res.status(404).json({ error: `Artifact not found at index ${req.params.index}` });
    }

    const artifact = raw[idx];

    if (!artifact.path) {
      return res.status(404).json({ error: 'Artifact has no file path' });
    }

    if (!validateArtifactPath(artifact.path)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    const mime = artifact.mimeType || getMimeType(artifact.name);
    if (!isInlinePreviewMime(mime)) {
      return res.status(415).json({ error: 'Artifact type cannot be previewed' });
    }

    const jobId = mission.executor?.jobId ?? '';
    const absPath = resolveArtifactAbsolutePath(mission.id, jobId, artifact.path);

    const MAX_PREVIEW_BYTES = 1_048_576; // 1 MB

    if (artifact.name === 'executor.log') {
      const fallbackLog = await resolveExecutorLogFallback(mission.id, jobId, absPath);
      if (fallbackLog !== null) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(fallbackLog);
      }
    }

    try {
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) {
        return res.status(404).json({ error: 'Artifact file not found' });
      }

      const textPreview = isTextMime(mime);
      const truncated = textPreview && fileStat.size > MAX_PREVIEW_BYTES;

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${artifact.name}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox");
      if (truncated) {
        res.setHeader('X-Truncated', 'true');
      }

      const stream = fs.createReadStream(absPath, textPreview ? {
        start: 0,
        end: truncated ? MAX_PREVIEW_BYTES - 1 : undefined,
      } : undefined);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read artifact file' });
        }
      });
      stream.pipe(res);
    } catch {
      return res.status(404).json({ error: 'Artifact file not found' });
    }
  });

  router.post('/:id/decision', (req, res) => {
    const result = submitMissionDecision(runtime, req.params.id, req.body || {}, {
      idempotentIfNotWaiting: true,
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ error: result.error });
    }

    // Broadcast mission.decision.submitted Socket event (Task 5.3)
    if (!result.alreadyResolved && result.task.decisionHistory?.length) {
      const historyEntry = result.task.decisionHistory[result.task.decisionHistory.length - 1];
      runtime.emitDecisionSubmitted(result.task, historyEntry, result.decision);
    }

    res.json({
      ok: true,
      alreadyResolved: result.alreadyResolved === true,
      detail: result.detail,
      decision: result.decision,
      task: result.task,
    });
  });

  return router;
}

export function createDecisionTemplatesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      templates: [...BUILTIN_DECISION_TEMPLATES],
    });
  });

  return router;
}

export default createTaskRouter();
