import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditEventType } from '../../shared/audit/contracts.js';
import type {
  MissionDecision,
  MissionDecisionOption,
  MissionRecord,
} from '../../shared/mission/contracts.js';
import { BUILTIN_DECISION_TEMPLATES } from '../../shared/mission/decision-templates.js';
import {
  submitMissionDecision,
  type MissionDecisionRuntime,
} from '../tasks/mission-decision.js';
import { AuditChain } from '../audit/audit-chain.js';
import { AuditCollector } from '../audit/audit-collector.js';
import { installAuditHooks } from '../audit/audit-hooks.js';
import { TimestampProvider } from '../audit/timestamp-provider.js';
import { createTaskRouter, createDecisionTemplatesRouter } from '../routes/tasks.js';
import { MissionRuntime } from '../tasks/mission-runtime.js';
import { MissionStore } from '../tasks/mission-store.js';

/* ─── Mock MissionDecisionRuntime ─── */

function createMockRuntime(initialTasks: MissionRecord[] = []): MissionDecisionRuntime & {
  tasks: Map<string, MissionRecord>;
} {
  const tasks = new Map<string, MissionRecord>();
  for (const t of initialTasks) {
    tasks.set(t.id, structuredClone(t));
  }

  return {
    tasks,
    getTask(id: string) {
      const t = tasks.get(id);
      return t ? structuredClone(t) : undefined;
    },
    resumeMissionFromDecision(id, submission) {
      const t = tasks.get(id);
      if (!t) return undefined;
      if (submission.historyEntry) {
        const history = t.decisionHistory ? [...t.decisionHistory] : [];
        history.push(structuredClone(submission.historyEntry));
        t.decisionHistory = history;
      }
      t.status = 'running';
      t.waitingFor = undefined;
      t.decision = undefined;
      t.updatedAt = Date.now();
      tasks.set(id, t);
      return structuredClone(t);
    },
  };
}

function makeWaitingTask(
  id: string,
  decision: MissionDecision,
  overrides: Partial<MissionRecord> = {},
): MissionRecord {
  return {
    id,
    kind: 'chat',
    title: 'Test task',
    status: 'waiting',
    progress: 50,
    currentStageKey: 'execute',
    stages: [{ key: 'execute', label: 'Run execution', status: 'running' }],
    waitingFor: decision.prompt,
    decision,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    ...overrides,
  };
}

/* ─── Unit Tests ─── */

describe('submitMissionDecision — requiresComment validation', () => {
  it('returns 400 when option has requiresComment=true and freeText is empty', () => {
    const decision: MissionDecision = {
      prompt: 'Approve the plan?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject', requiresComment: true },
      ],
    };
    const task = makeWaitingTask('task_1', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_1', {
      optionId: 'reject',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toContain('comment');
    }
  });

  it('succeeds when option has requiresComment=true and freeText is provided', () => {
    const decision: MissionDecision = {
      prompt: 'Approve the plan?',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject', requiresComment: true },
      ],
      allowFreeText: true,
    };
    const task = makeWaitingTask('task_2', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_2', {
      optionId: 'reject',
      freeText: 'Needs more detail on step 3',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.optionId).toBe('reject');
      expect(result.decision.freeText).toBe('Needs more detail on step 3');
    }
  });
});

describe('submitMissionDecision — decision history append', () => {
  it('appends a DecisionHistoryEntry after successful decision', () => {
    const decision: MissionDecision = {
      prompt: 'Choose direction',
      options: [
        { id: 'left', label: 'Go Left' },
        { id: 'right', label: 'Go Right' },
      ],
      type: 'multi-choice',
      decisionId: 'dec_test_001',
    };
    const task = makeWaitingTask('task_3', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_3', { optionId: 'left' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const history = result.task.decisionHistory ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].decisionId).toBe('dec_test_001');
      expect(history[0].type).toBe('multi-choice');
      expect(history[0].resolved.optionId).toBe('left');
      expect(history[0].resolved.optionLabel).toBe('Go Left');
      expect(history[0].submittedAt).toBeGreaterThan(0);
    }
  });

  it('accumulates multiple decisions in decisionHistory', () => {
    const decision1: MissionDecision = {
      prompt: 'Step 1',
      options: [{ id: 'a', label: 'A' }],
      decisionId: 'dec_1',
    };
    const task = makeWaitingTask('task_4', decision1);
    const runtime = createMockRuntime([task]);

    // First decision
    const r1 = submitMissionDecision(runtime, 'task_4', { optionId: 'a' });
    expect(r1.ok).toBe(true);

    // submitMissionDecision appends history to the returned task clone.
    // Sync that history back into the mock store so the second call sees it.
    if (r1.ok) {
      const inner = runtime.tasks.get('task_4')!;
      inner.decisionHistory = structuredClone(r1.task.decisionHistory ?? []);
      inner.status = 'waiting';
      inner.decision = {
        prompt: 'Step 2',
        options: [{ id: 'b', label: 'B' }],
        decisionId: 'dec_2',
      };
      inner.waitingFor = 'Step 2';
      runtime.tasks.set('task_4', inner);
    }

    // Second decision
    const r2 = submitMissionDecision(runtime, 'task_4', { optionId: 'b' });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      const history = r2.task.decisionHistory ?? [];
      expect(history).toHaveLength(2);
      expect(history[0].decisionId).toBe('dec_1');
      expect(history[1].decisionId).toBe('dec_2');
    }
  });

  it('preserves web-aigc metadata in resolved decision and history', () => {
    const decision: MissionDecision = {
      prompt: 'Choose direction',
      options: [
        { id: 'left', label: 'Go Left' },
        { id: 'right', label: 'Go Right' },
      ],
      type: 'custom-action',
      decisionId: 'dec_hitl_selection_1',
      payload: {
        nodeType: 'selection',
        sessionId: 'sess-1',
        interactionId: 'int-1',
        branchKey: 'branch-left',
      },
    };
    const task = makeWaitingTask('task_hitl_1', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_hitl_1', {
      optionId: 'left',
      metadata: {
        nodeType: 'selection',
        sessionId: 'sess-1',
        interactionId: 'int-1',
        branchKey: 'branch-left',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.metadata?.nodeType).toBe('selection');
      expect(result.decision.metadata?.sessionId).toBe('sess-1');
      expect(result.decision.metadata?.interactionId).toBe('int-1');
      expect(result.decision.metadata?.branchKey).toBe('branch-left');

      const history = result.task.decisionHistory ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].nodeType).toBe('selection');
      expect(history[0].sessionId).toBe('sess-1');
      expect(history[0].interactionId).toBe('int-1');
      expect(history[0].branchKey).toBe('branch-left');
      expect(history[0].resolved.metadata?.sessionId).toBe('sess-1');
    }
  });

  it('persists submittedBy into decision history', () => {
    const decision: MissionDecision = {
      prompt: 'Choose a path',
      options: [
        { id: 'left', label: 'Go Left' },
        { id: 'right', label: 'Go Right' },
      ],
      decisionId: 'dec_submitter_1',
    };
    const task = makeWaitingTask('task_submitter_1', decision);
    const runtime = createMockRuntime([task]);

    const result = submitMissionDecision(runtime, 'task_submitter_1', {
      optionId: 'left',
      submittedBy: 'operator-alice',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const history = result.task.decisionHistory ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].submittedBy).toBe('operator-alice');
    }
  });
});

describe('submitMissionDecision — multi-step decision chain', () => {
  it('when orchestrator puts task back into waiting, task enters waiting again with new decision', async () => {
    // Use MissionRuntime + MissionStore to simulate the multi-step chain.
    // Note: Both MissionStore.resolveWaiting and submitMissionDecision append
    // to decisionHistory, so each decision produces 2 history entries when
    // going through the real runtime. We verify the chain behavior here.
    const store = new MissionStore();
    const missionRuntime = new MissionRuntime({ store, autoRecover: false });

    const task = missionRuntime.createChatTask('Multi-step test');
    missionRuntime.markMissionRunning(task.id, 'execute', 'Running', 50);
    missionRuntime.waitOnMission(task.id, 'first decision', 'Choose path', 50, {
      prompt: 'Choose path',
      options: [
        { id: 'path-a', label: 'Path A' },
        { id: 'path-b', label: 'Path B' },
      ],
    });

    // Submit first decision — task should resume to running
    const result = submitMissionDecision(missionRuntime, task.id, { optionId: 'path-a' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe('running');
      // decisionHistory should have entries (from resolveWaiting + submitMissionDecision)
      expect(result.task.decisionHistory!.length).toBeGreaterThanOrEqual(1);
    }

    // Simulate orchestrator putting task back into waiting (nextDecision)
    missionRuntime.waitOnMission(task.id, 'confirm path A', 'Confirm?', 55, {
      prompt: 'Confirm path A?',
      options: [
        { id: 'confirm', label: 'Confirm' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });

    const afterWait = missionRuntime.getTask(task.id);
    expect(afterWait?.status).toBe('waiting');
    expect(afterWait?.decision?.prompt).toBe('Confirm path A?');

    // Submit second decision
    const result2 = submitMissionDecision(missionRuntime, task.id, { optionId: 'confirm' });
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.task.status).toBe('running');
      // History should have grown from both decisions
      const historyLen = result2.task.decisionHistory!.length;
      expect(historyLen).toBeGreaterThanOrEqual(2);
    }
  });
});

/* ─── API Endpoint Tests ─── */

async function startServer(runtime: MissionRuntime) {
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskRouter(runtime));
  app.use('/api/decision-templates', createDecisionTemplatesRouter());

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function createAuditTestCollector() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const chain = new AuditChain({
    privateKey: privateKey.export({ type: 'sec1', format: 'pem' }) as string,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  });
  const collector = new AuditCollector(chain, new TimestampProvider());
  return { chain, collector };
}

describe('API endpoints', () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express['listen']> | null = null;
  let baseUrl = '';
  let auditCollector: AuditCollector | null = null;
  let auditChain: AuditChain | null = null;

  beforeEach(async () => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
    const started = await startServer(runtime);
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      server.close(err => err ? reject(err) : resolve());
    });
    auditCollector?.destroy();
    auditCollector = null;
    auditChain = null;
    server = null;
  });

  it('GET /api/tasks/:id/decisions returns decision history', async () => {
    const task = runtime.createChatTask('Decision history test');
    runtime.markMissionRunning(task.id, 'execute', 'Running', 50);
    runtime.waitOnMission(task.id, 'approval', 'Approve?', 50, {
      prompt: 'Approve?',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      decisionId: 'dec_api_1',
    });

    // Submit a decision
    await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId: 'yes' }),
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decisions`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.missionId).toBe(task.id);
    expect(body.decisions).toBeInstanceOf(Array);
    expect(body.decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/decision-templates returns built-in templates', async () => {
    const response = await fetch(`${baseUrl}/api/decision-templates`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.templates).toBeInstanceOf(Array);
    expect(body.templates.length).toBe(BUILTIN_DECISION_TEMPLATES.length);
    expect(body.templates.map((t: { templateId: string }) => t.templateId)).toContain(
      'execution-plan-approval'
    );
    expect(body.templates.map((t: { templateId: string }) => t.templateId)).toContain(
      'stage-gate'
    );
    expect(body.templates.map((t: { templateId: string }) => t.templateId)).toContain(
      'risk-confirmation'
    );

    const approvalTemplate = body.templates.find(
      (template: { templateId: string }) =>
        template.templateId === 'execution-plan-approval'
    );
    expect(approvalTemplate).toBeDefined();
    expect(
      approvalTemplate.defaultOptions.map(
        (option: { id: string; label: string }) => option.id
      )
    ).toContain('modify');
    expect(
      approvalTemplate.defaultOptions.map(
        (option: { id: string; label: string }) => option.label
      )
    ).toContain('Modify');
  });

  it('POST /api/tasks/:id/decision keeps web-aigc metadata on task history', async () => {
    const task = runtime.createChatTask('HITL selection metadata test');
    runtime.markMissionRunning(task.id, 'execute', 'Running', 50);
    runtime.waitOnMission(task.id, 'selection', 'Choose a branch', 50, {
      prompt: 'Choose a branch',
      options: [
        { id: 'branch-a', label: 'Branch A' },
        { id: 'branch-b', label: 'Branch B' },
      ],
      type: 'custom-action',
      decisionId: 'dec_api_hitl_1',
      payload: {
        nodeType: 'selection',
        sessionId: 'session-api-1',
        interactionId: 'interaction-api-1',
      },
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        optionId: 'branch-a',
        metadata: {
          nodeType: 'selection',
          sessionId: 'session-api-1',
          interactionId: 'interaction-api-1',
          branchKey: 'branch-a',
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.decision.metadata.sessionId).toBe('session-api-1');
    expect(body.decision.metadata.interactionId).toBe('interaction-api-1');
    expect(body.task.decisionHistory).toBeInstanceOf(Array);
    expect(body.task.decisionHistory.at(-1).nodeType).toBe('selection');
    expect(body.task.decisionHistory.at(-1).sessionId).toBe('session-api-1');
    expect(body.task.decisionHistory.at(-1).interactionId).toBe('interaction-api-1');
    expect(body.task.decisionHistory.at(-1).branchKey).toBe('branch-a');
  });

  it('POST /api/tasks/:id/decision persists submittedBy to decision history', async () => {
    const task = runtime.createChatTask('Submitted by propagation test');
    runtime.markMissionRunning(task.id, 'execute', 'Running', 50);
    runtime.waitOnMission(task.id, 'approval', 'Approve?', 50, {
      prompt: 'Approve?',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      decisionId: 'dec_api_submitter_1',
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        optionId: 'yes',
        submittedBy: 'operator-bob',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task.decisionHistory).toBeInstanceOf(Array);
    expect(body.task.decisionHistory.at(-1).submittedBy).toBe('operator-bob');
  });

  it('POST /api/tasks/:id/decision records audit decision_submitted entry', async () => {
    const audit = createAuditTestCollector();
    auditChain = audit.chain;
    auditCollector = audit.collector;
    installAuditHooks({ collector: auditCollector });

    const task = runtime.createTask({
      kind: 'chat',
      title: 'Audit decision submission test',
      projection: {
        workflowId: 'wf-audit-hitl',
        instanceId: 'instance-audit-hitl',
        replayId: 'replay-audit-hitl',
      },
      stageLabels: [{ key: 'execute', label: 'Execute' }],
    });
    runtime.markMissionRunning(task.id, 'execute', 'Running', 50);
    runtime.waitOnMission(task.id, 'selection', 'Choose a branch', 50, {
      prompt: 'Choose a branch',
      options: [
        { id: 'branch-a', label: 'Branch A' },
        { id: 'branch-b', label: 'Branch B' },
      ],
      decisionId: 'dec_audit_hitl_1',
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        optionId: 'branch-a',
        submittedBy: 'operator-audit',
        metadata: {
          nodeType: 'selection',
          nodeId: 'node-selection-1',
          sessionId: 'session-audit-1',
          interactionId: 'interaction-audit-1',
          branchKey: 'branch-a',
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(auditChain).not.toBeNull();

    const count = auditChain!.getEntryCount();
    expect(count).toBeGreaterThan(0);
    const entries = auditChain!.getEntries(0, count - 1);
    const decisionEntry = entries.find(
      entry =>
        entry.event.eventType === AuditEventType.DECISION_MADE &&
        entry.event.metadata?.eventKey === 'human.decision_submitted',
    );

    expect(decisionEntry).toBeDefined();
    expect(decisionEntry?.event.actor).toMatchObject({
      type: 'user',
      id: 'operator-audit',
    });
    expect(decisionEntry?.event.resource).toMatchObject({
      type: 'mission',
      id: task.id,
      name: 'node-selection-1',
    });
    expect(decisionEntry?.event.context).toMatchObject({
      sessionId: 'session-audit-1',
    });
    expect(decisionEntry?.event.metadata).toMatchObject({
      eventKey: 'human.decision_submitted',
      workflowId: 'wf-audit-hitl',
      instanceId: 'instance-audit-hitl',
      missionId: task.id,
      decisionId: 'dec_audit_hitl_1',
      nodeId: 'node-selection-1',
      nodeType: 'selection',
      submittedBy: 'operator-audit',
      optionId: 'branch-a',
      optionLabel: 'Branch A',
      interactionId: 'interaction-audit-1',
      branchKey: 'branch-a',
    });
  });

  it('POST /api/tasks/:id/decision rejects timed out waiting input', async () => {
    const task = runtime.createChatTask('Timed waiting decision test');
    runtime.markMissionRunning(task.id, 'execute', 'Running', 50);
    runtime.waitOnMission(task.id, 'user input', 'Need details', 50, {
      prompt: 'Provide missing details',
      options: [{ id: 'submit', label: 'Submit' }],
      timeoutAt: Date.now() - 1_000,
    });

    const response = await fetch(`${baseUrl}/api/tasks/${task.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        optionId: 'submit',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('timed out');
    expect(runtime.getTask(task.id)?.status).toBe('waiting');
  });
});
