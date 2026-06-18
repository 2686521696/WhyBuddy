import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../src/gates.js';
import { runProcess } from '../src/runProcess.js';
import {
  buildLoopArgsForQueueEntry,
  buildQueueSummaryFromState,
  classifyQueueOutcome,
  resolveEntryGates,
  resolvePythonExe,
  resolveQueueGate,
} from '../src/runQueue.js';
import {
  shouldSkipAutoDisabledTask,
  updateQueueOutcomeRecord,
} from '../src/queueOutcomes.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = 'C:\\repo';
const workspaceRoot = path.resolve(agentLoopRoot, '..');

test('runProcess kills the child when the abort signal fires', async () => {
  const controller = new AbortController();
  const script = [
    'setInterval(() => {}, 1000);',
  ].join('\n');

  const promise = runProcess(process.execPath, ['-e', script], {
    timeoutMs: 30000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const result = await promise;

  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.notEqual(result.signal, null);
});

test('resolveEntryGates throws for unknown gatesKey', () => {
  assert.throws(
    () => resolveEntryGates({
      entry: { gatesKey: 'missing' },
      gateSets: { gates: ['npm test'] },
      defaultGates: ['npm test'],
      label: 'task-a',
    }),
    /unknown gatesKey: missing/,
  );
});

test('resolveQueueGate substitutes repo-root pythonExe for worktree gates', () => {
  const gate = 'cd tws-ai-slide-rule-python; & "{{pythonExe}}" -m pytest tests/test_client_parity.py -q';
  const resolved = resolveQueueGate(gate, {
    repoRoot,
    pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe',
  });

  assert.equal(
    resolved,
    `cd tws-ai-slide-rule-python; & "${path.join(repoRoot, 'tws-ai-slide-rule-python', '.venv', 'Scripts', 'python.exe')}" -m pytest tests/test_client_parity.py -q`,
  );
  assert.match(resolved, /& "/);
  assert.equal(resolvePythonExe(repoRoot, null).endsWith(`${path.sep}python.exe`), process.platform === 'win32');
});

test('resolveQueueGate substitutes taskFile for scoped mojibake gates', () => {
  const gate = 'node agent-loop/src/check-mojibake.js {{taskFile}} tws-ai-slide-rule-python/sliderule_llm/client.py';
  const resolved = resolveQueueGate(gate, {
    repoRoot,
    pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe',
    taskFile: 'agent-loop/tasks/backend-python-llm-client-parity.md',
  });

  assert.equal(
    resolved,
    'node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-llm-client-parity.md tws-ai-slide-rule-python/sliderule_llm/client.py',
  );
});

test('evaluateGate runs powershell call operator with resolved pythonExe', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('powershell python gate is Windows-specific');
    return;
  }

  const pythonExe = resolvePythonExe(workspaceRoot, 'tws-ai-slide-rule-python/.venv/Scripts/python.exe');
  try {
    await fs.access(pythonExe);
  } catch {
    t.skip(`python venv not present at ${pythonExe}`);
    return;
  }

  const command = resolveQueueGate(
    'cd tws-ai-slide-rule-python; & "{{pythonExe}}" -c "print(\'ok\')"',
    { repoRoot: workspaceRoot, pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe' },
  );
  const gate = await evaluateGate({
    cwd: workspaceRoot,
    commands: [command],
    timeoutMs: 30000,
  });

  assert.equal(gate.ok, true, gate.runs[0]?.stderr || gate.runs[0]?.stdout);
  assert.match(gate.runs[0].stdout, /ok/);
});

test('buildLoopArgsForQueueEntry uses worktree and omits fix-cwd', () => {
  const args = buildLoopArgsForQueueEntry({
    agentLoopRoot,
    repoRoot,
    entry: {
      id: 'backend-python-llm-client-parity',
      task: 'agent-loop/tasks/backend-python-llm-client-parity.md',
      gatesKey: 'infraGates',
    },
    defaults: {
      useWorktree: true,
      autoFix: true,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'codex',
      guardTests: true,
      maxIterations: 3,
      timeoutMs: 600000,
      lang: 'zh-CN',
      pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe',
    },
    index: 0,
    gateSets: {
      gates: ['default-gate'],
      infraGates: ['cd tws-ai-slide-rule-python; & "{{pythonExe}}" -m pytest tests/test_client_parity.py -q'],
    },
    defaultGates: ['default-gate'],
  });

  const gateIndex = args.indexOf('--gate');
  const gateArg = args[gateIndex + 1];

  assert.ok(args.includes('--create-worktree'));
  assert.ok(args.includes('backend-python-llm-client-parity'));
  assert.equal(args.includes('--fix-cwd'), false);
  assert.ok(args.includes('--auto-fix'));
  assert.equal(args.includes('--skip-review'), false);
  assert.ok(args.includes('--fix-agent'));
  assert.ok(args.includes('--review-agent'));
  assert.match(gateArg, /test_client_parity\.py/);
  assert.match(gateArg, /& "/);
  assert.match(gateArg, /tws-ai-slide-rule-python[\\/]\.venv[\\/]Scripts[\\/]python\.exe/);
});

test('buildQueueSummaryFromState exposes grokRan codexRan and runMode', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    state: {
      runId: '2026-06-17T03-29-42-364Z',
      status: 'DONE_REVIEWED',
      options: { fixAgent: 'grok', reviewAgent: 'codex' },
      iterations: [{ iteration: 1, grokFix: { exitCode: 0 } }],
      grokFix: { exitCode: 0 },
      codexReview: { exitCode: 0 },
    },
    exitCode: 0,
  });

  assert.equal(summary.grokRan, true);
  assert.equal(summary.codexRan, true);
  assert.equal(summary.runMode, 'grok-fix+codex-review');
  assert.equal(summary.status, 'DONE_REVIEWED');
  assert.equal(summary.guardReason, null);
});

test('buildQueueSummaryFromState surfaces guardReason for quarantine detection', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-tamper', task: 'agent-loop/tasks/task-tamper.md' },
    state: {
      runId: '2026-06-17T04-00-00-000Z',
      status: 'HALT_HUMAN',
      guardReason: 'POSSIBLE_TEST_TAMPER',
      options: { fixAgent: 'grok', skipReview: true },
      iterations: [{ iteration: 1, grokFix: { exitCode: 0 } }],
    },
    exitCode: 1,
  });

  assert.equal(summary.status, 'HALT_HUMAN');
  assert.equal(summary.guardReason, 'POSSIBLE_TEST_TAMPER');
});

test('classifyQueueOutcome separates crashed infra from task failures', () => {
  assert.equal(classifyQueueOutcome({
    summary: { status: 'PROBED', iterations: 0, grokRan: false, codexRan: false },
    exitCode: 1,
  }), 'crashed');

  assert.equal(classifyQueueOutcome({
    summary: {
      status: 'HALT_HUMAN',
      iterations: 0,
      grokRan: false,
      worktreeError: 'seed worktree copy failed',
    },
    exitCode: 1,
  }), 'crashed');

  assert.equal(classifyQueueOutcome({
    summary: { status: 'HALT_NO_CHANGES', iterations: 1, grokRan: true },
    exitCode: 1,
  }), 'failed');

  assert.equal(classifyQueueOutcome({
    summary: { status: 'DONE_REVIEWED', iterations: 0, grokRan: true },
    exitCode: 0,
  }), 'done');

  assert.equal(classifyQueueOutcome({
    summary: { status: 'HALT_HUMAN', guardReason: 'POSSIBLE_TEST_TAMPER', iterations: 1, grokRan: true },
    exitCode: 1,
  }), 'quarantined');

  // No success criteria → task-level failure (send back to spec), not an infra crash.
  assert.equal(classifyQueueOutcome({
    summary: { status: 'HALT_NO_SUCCESS_CRITERIA', iterations: 0, grokRan: false, codexRan: false },
    exitCode: 1,
  }), 'failed');
});

test('buildQueueSummaryFromState sets outcome from classifyQueueOutcome', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    state: {
      status: 'HALT_NO_CHANGES',
      iterations: [{ iteration: 1 }],
      grokFix: { exitCode: 1 },
      options: { fixAgent: 'grok', skipReview: true },
    },
    exitCode: 1,
  });

  assert.equal(summary.outcome, 'failed');
  assert.equal(summary.grokRan, true);
});

test('buildLoopArgsForQueueEntry passes --no-sync-task-status from defaults', () => {
  const args = buildLoopArgsForQueueEntry({
    agentLoopRoot,
    repoRoot,
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    defaults: { noSyncTaskStatus: true, useWorktree: false, maxIterations: 1 },
    gateSets: { gates: ['npm test'] },
    defaultGates: ['npm test'],
  });

  assert.ok(args.includes('--no-sync-task-status'));
});

test('updateQueueOutcomeRecord auto-disables after consecutive HALT_NO_CHANGES', () => {
  let record = updateQueueOutcomeRecord({
    record: {},
    status: 'HALT_NO_CHANGES',
    outcome: 'failed',
    maxConsecutiveNoChanges: 3,
  });
  assert.equal(record.consecutiveNoChanges, 1);
  assert.equal(record.autoDisabled, false);

  record = updateQueueOutcomeRecord({
    record,
    status: 'HALT_NO_CHANGES',
    outcome: 'failed',
    maxConsecutiveNoChanges: 3,
  });
  record = updateQueueOutcomeRecord({
    record,
    status: 'HALT_NO_CHANGES',
    outcome: 'failed',
    maxConsecutiveNoChanges: 3,
  });
  assert.equal(record.consecutiveNoChanges, 3);
  assert.equal(record.autoDisabled, true);

  const skip = shouldSkipAutoDisabledTask({
    entry: { id: 'sliderule-synthesis-merge' },
    outcomes: { tasks: { 'sliderule-synthesis-merge': record } },
    maxConsecutiveNoChanges: 3,
  });
  assert.equal(skip.skip, true);
});
