import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../src/gates.js';
import { runProcess } from '../src/runProcess.js';
import {
  buildLoopArgsForQueueEntry,
  buildQueueCompletionMessage,
  buildQueueSummaryFromState,
  classifyQueueOutcome,
  applyDoneSummaryToMain,
  filterQueueTasks,
  resolveWorktreeScope,
  resolveEntryGates,
  resolvePythonExe,
  resolveQueueGate,
} from '../src/runQueue.js';
import {
  LoopApplyError,
} from '../src/loopApply.js';
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

test('runProcess kills an idle child before the total timeout', async () => {
  const script = [
    'setTimeout(() => {}, 30000);',
  ].join('\n');

  const startedAt = Date.now();
  const result = await runProcess(process.execPath, ['-e', script], {
    timeoutMs: 30000,
    idleTimeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.idleTimedOut, true);
  assert.equal(result.timedOut, false);
  assert.ok(elapsedMs < 5000, `expected idle timeout quickly, elapsed ${elapsedMs}ms`);
  assert.notEqual(result.signal, null);
});

test('runProcess kills a noisy child at the agent timeout budget', async () => {
  const script = [
    'setInterval(() => console.error("still noisy"), 20);',
    'setTimeout(() => {}, 30000);',
  ].join('\n');

  const startedAt = Date.now();
  const result = await runProcess(process.execPath, ['-e', script], {
    timeoutMs: 30000,
    idleTimeoutMs: 1000,
    agentTimeoutMs: 150,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.agentTimedOut, true);
  assert.equal(result.idleTimedOut, false);
  assert.equal(result.timedOut, false);
  assert.ok(elapsedMs < 5000, `expected agent timeout quickly, elapsed ${elapsedMs}ms`);
  assert.match(result.stderr, /still noisy/);
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

test('resolveEntryGates accepts custom delivery gate sets', () => {
  const gates = resolveEntryGates({
    entry: { gatesKey: 'deliveryGates' },
    gateSets: {
      gates: ['default-gate'],
      deliveryGates: ['delivery-gate'],
    },
    defaultGates: ['default-gate'],
    label: 'sliderule-document-draft',
  });

  assert.deepEqual(gates, ['delivery-gate']);
});

test('filterQueueTasks can select one task by id', () => {
  const tasks = filterQueueTasks([
    { id: 'task-a', enabled: true },
    { id: 'task-b', enabled: true },
    { id: 'task-c', enabled: false },
  ], { only: 'task-b' });

  assert.deepEqual(tasks.map((task) => task.id), ['task-b']);
});

test('filterQueueTasks supports from and limit after disabled tasks are removed', () => {
  const tasks = filterQueueTasks([
    { id: 'task-a', enabled: true },
    { id: 'task-disabled', enabled: false },
    { id: 'task-b', enabled: true },
    { id: 'task-c', enabled: true },
  ], { from: 'task-b', limit: 1 });

  assert.deepEqual(tasks.map((task) => task.id), ['task-b']);
});

test('filterQueueTasks rejects unknown selectors', () => {
  assert.throws(
    () => filterQueueTasks([{ id: 'task-a', enabled: true }], { only: 'missing' }),
    /--only target not found: missing/,
  );
  assert.throws(
    () => filterQueueTasks([{ id: 'task-a', enabled: true }], { from: 'missing' }),
    /--from target not found: missing/,
  );
});

test('buildQueueCompletionMessage says queue finished is not the same as all succeeded', () => {
  const message = buildQueueCompletionMessage({
    done: 2,
    failed: 1,
    crashed: 0,
    quarantined: 1,
    skipped: 0,
    stopped: 0,
    total: 4,
  });

  assert.match(message, /queue finished running; some tasks still need attention/);
  assert.match(message, /2 done, 1 task-failed, 0 crashed, 1 quarantined/);
});

test('resolveQueueGate uses repo-root node bins for worktree Node gates', () => {
  const vitest = resolveQueueGate(
    'pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts --reporter=dot',
    { repoRoot, pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe' },
  );
  const tsc = resolveQueueGate(
    'pnpm exec tsc --noEmit --pretty false',
    { repoRoot, pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe' },
  );

  const binExt = process.platform === 'win32' ? '.cmd' : '';
  assert.match(vitest, new RegExp(`node_modules[\\\\/].bin[\\\\/]vitest${binExt.replace('.', '\\.')}`));
  assert.match(tsc, new RegExp(`node_modules[\\\\/].bin[\\\\/]tsc${binExt.replace('.', '\\.')}`));
  assert.doesNotMatch(vitest, /^pnpm exec/);
  assert.doesNotMatch(tsc, /^pnpm exec/);
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
      fixModel: 'gpt-5.5',
      reviewModel: 'gpt-5.5',
      guardTests: true,
      maxIterations: 3,
      timeoutMs: 600000,
      agentIdleTimeoutMs: 120000,
      agentTimeoutMs: 240000,
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
  assert.deepEqual(args.slice(args.indexOf('--fix-model'), args.indexOf('--fix-model') + 2), ['--fix-model', 'gpt-5.5']);
  assert.deepEqual(args.slice(args.indexOf('--review-model'), args.indexOf('--review-model') + 2), ['--review-model', 'gpt-5.5']);
  assert.deepEqual(args.slice(args.indexOf('--agent-idle-timeout-ms'), args.indexOf('--agent-idle-timeout-ms') + 2), ['--agent-idle-timeout-ms', '120000']);
  assert.deepEqual(args.slice(args.indexOf('--agent-timeout-ms'), args.indexOf('--agent-timeout-ms') + 2), ['--agent-timeout-ms', '240000']);
  assert.match(gateArg, /test_client_parity\.py/);
  assert.match(gateArg, /& "/);
  assert.match(gateArg, /tws-ai-slide-rule-python[\\/]\.venv[\\/]Scripts[\\/]python\.exe/);
});

test('buildLoopArgsForQueueEntry uses queue worktree fix cwd in queue scope', () => {
  const queueWorktreePath = 'C:\\repo\\.worktrees\\queue-migration';
  const args = buildLoopArgsForQueueEntry({
    agentLoopRoot,
    repoRoot,
    queueWorktreePath,
    entry: {
      id: 'task-a',
      task: 'agent-loop/tasks/task-a.md',
      worktreeScope: 'queue',
    },
    defaults: {
      useWorktree: true,
      autoFix: true,
      maxIterations: 1,
      timeoutMs: 600000,
    },
    index: 0,
    gateSets: { gates: ['node --test agent-loop/test/run-queue.test.js'] },
    defaultGates: ['node --test agent-loop/test/run-queue.test.js'],
  });

  assert.equal(args.includes('--create-worktree'), false);
  assert.ok(args.includes('--fix-cwd'));
  assert.deepEqual(args.slice(args.indexOf('--fix-cwd'), args.indexOf('--fix-cwd') + 2), ['--fix-cwd', queueWorktreePath]);
});

test('resolveWorktreeScope validates task and queue scopes', () => {
  assert.equal(resolveWorktreeScope({ entry: {}, defaults: {} }), 'task');
  assert.equal(resolveWorktreeScope({ entry: {}, defaults: { worktreeScope: 'queue' } }), 'queue');
  assert.equal(resolveWorktreeScope({ entry: { worktreeScope: 'task' }, defaults: { worktreeScope: 'queue' } }), 'task');
  assert.throws(
    () => resolveWorktreeScope({ entry: { id: 'task-a', worktreeScope: 'repo' }, defaults: {} }),
    /invalid worktreeScope for task-a: repo/,
  );
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

test('buildQueueSummaryFromState maps baseline-green no-diff tasks to reviewed no-diff', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    state: {
      status: 'HALT_NO_CHANGES',
      baselineGate: { ok: true, failureCount: 0 },
      baselineDiff: { bytes: 0 },
      iterations: [{ iteration: 1 }],
      agentFix: { exitCode: 0 },
      agentReview: { exitCode: 0 },
      options: { fixAgent: 'codex', reviewAgent: 'codex' },
    },
    exitCode: 1,
  });

  assert.equal(summary.status, 'DONE_REVIEWED_NO_DIFF');
  assert.equal(summary.outcome, 'done');
  assert.equal(summary.applyStatus, 'DONE_REVIEWED_NO_DIFF');
  assert.equal(summary.applyErrorKind, 'NO_DIFF_BASELINE_GREEN');
  assert.equal(summary.runMode, 'reviewed-no-diff');
});

test('applyDoneSummaryToMain applies done worktree summaries before cleanup', async () => {
  const summary = { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' };
  const calls = [];
  const result = await applyDoneSummaryToMain({
    summary,
    entry: { id: 'task-a', useWorktree: true },
    state: { runId: 'run-a' },
    repoRoot: 'C:\\repo',
    defaults: { timeoutMs: 1234 },
    runner: async () => ({ exitCode: 0 }),
    applyLatestDiffToMain: async (args) => {
      calls.push(args);
      return { landing: { status: 'APPLIED_TO_MAIN' }, patchPath: 'diff.1.patch' };
    },
  });

  assert.equal(result.appliedToMain, true);
  assert.equal(result.summary.outcome, 'done');
  assert.equal(result.summary.appliedToMain, true);
  assert.equal(result.summary.landingStatus, 'APPLIED_TO_MAIN');
  assert.equal(calls[0].run, 'run-a');
  assert.equal(calls[0].timeoutMs, 1234);
});

test('applyDoneSummaryToMain skips per-task apply in queue worktree scope', async () => {
  let called = false;
  const summary = { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' };
  const result = await applyDoneSummaryToMain({
    summary,
    entry: { id: 'task-a', useWorktree: true, worktreeScope: 'queue' },
    state: { runId: 'run-a' },
    repoRoot: 'C:\\repo',
    defaults: { useWorktree: true },
    runner: async () => ({ exitCode: 0 }),
    applyLatestDiffToMain: async () => {
      called = true;
      return { landing: { status: 'APPLIED_TO_MAIN' }, patchPath: 'diff.1.patch' };
    },
  });

  assert.equal(called, false);
  assert.equal(result.appliedToMain, false);
  assert.equal(result.summary, summary);
});

test('applyDoneSummaryToMain maps missing diff patch to reviewed no-diff outcome', async () => {
  const result = await applyDoneSummaryToMain({
    summary: { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' },
    entry: { id: 'task-a', useWorktree: true },
    state: { runId: 'run-a' },
    repoRoot: 'C:\\repo',
    defaults: {},
    runner: async () => ({ exitCode: 0 }),
    applyLatestDiffToMain: async () => {
      throw new LoopApplyError({
        kind: 'NO_DIFF_PATCH',
        message: 'no diff.N.patch found in run-a',
      });
    },
  });

  assert.equal(result.appliedToMain, false);
  assert.equal(result.summary.status, 'DONE_REVIEWED_NO_DIFF');
  assert.equal(result.summary.outcome, 'done');
  assert.equal(result.summary.applyStatus, 'DONE_REVIEWED_NO_DIFF');
  assert.equal(result.summary.applyErrorKind, 'NO_DIFF_PATCH');
  assert.match(result.summary.applyError, /no diff\.N\.patch found/);
});

test('applyDoneSummaryToMain maps patch conflicts without counting them as crashed', async () => {
  const result = await applyDoneSummaryToMain({
    summary: { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' },
    entry: { id: 'task-a', useWorktree: true },
    state: { runId: 'run-a' },
    repoRoot: 'C:\\repo',
    defaults: {},
    runner: async () => ({ exitCode: 0 }),
    applyLatestDiffToMain: async () => {
      throw new LoopApplyError({
        kind: 'PATCH_CONFLICT',
        files: ['server/routes/a2a.ts'],
        message: 'git apply --check failed: patch does not apply',
      });
    },
  });

  assert.equal(result.appliedToMain, false);
  assert.equal(result.summary.status, 'APPLY_CONFLICT');
  assert.equal(result.summary.outcome, 'failed');
  assert.equal(result.summary.applyStatus, 'APPLY_CONFLICT');
  assert.equal(result.summary.applyErrorKind, 'PATCH_CONFLICT');
  assert.deepEqual(result.summary.applyErrorFiles, ['server/routes/a2a.ts']);
  assert.match(result.summary.applyError, /patch does not apply/);
});

test('applyDoneSummaryToMain keeps unknown apply failures as crashed', async () => {
  const result = await applyDoneSummaryToMain({
    summary: { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' },
    entry: { id: 'task-a', useWorktree: true },
    state: { runId: 'run-a' },
    repoRoot: 'C:\\repo',
    defaults: {},
    runner: async () => ({ exitCode: 0 }),
    applyLatestDiffToMain: async () => {
      throw new Error('permission denied while applying patch');
    },
  });

  assert.equal(result.appliedToMain, false);
  assert.equal(result.summary.status, 'HALT_APPLY_FAILED');
  assert.equal(result.summary.outcome, 'crashed');
  assert.equal(result.summary.applyStatus, 'HALT_APPLY_FAILED');
  assert.equal(result.summary.applyErrorKind, 'UNKNOWN_APPLY_ERROR');
  assert.match(result.summary.applyError, /permission denied/);
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

test('buildLoopArgsForQueueEntry passes guard policy from entry or defaults', () => {
  const fromEntry = buildLoopArgsForQueueEntry({
    agentLoopRoot: 'C:\\repo\\agent-loop',
    repoRoot: 'C:\\repo',
    entry: {
      id: 'task-a',
      task: 'agent-loop/tasks/task-a.md',
      guardPolicy: 'agent-loop/policies/strict.json',
      useWorktree: true,
    },
    defaults: {
      guardPolicy: 'agent-loop/policies/default.json',
    },
    index: 0,
    gateSets: { gates: ['npm test'] },
    defaultGates: ['npm test'],
  });

  assert.equal(fromEntry.includes('--guard-policy'), true);
  assert.equal(fromEntry[fromEntry.indexOf('--guard-policy') + 1], 'agent-loop/policies/strict.json');

  const fromDefault = buildLoopArgsForQueueEntry({
    agentLoopRoot: 'C:\\repo\\agent-loop',
    repoRoot: 'C:\\repo',
    entry: {
      id: 'task-b',
      task: 'agent-loop/tasks/task-b.md',
      useWorktree: true,
    },
    defaults: {
      guardPolicy: 'agent-loop/policies/default.json',
    },
    index: 1,
    gateSets: { gates: ['npm test'] },
    defaultGates: ['npm test'],
  });

  assert.equal(fromDefault.includes('--guard-policy'), true);
  assert.equal(fromDefault[fromDefault.indexOf('--guard-policy') + 1], 'agent-loop/policies/default.json');
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

test('updateQueueOutcomeRecord preserves structured apply status details', () => {
  const record = updateQueueOutcomeRecord({
    record: {},
    status: 'APPLY_CONFLICT',
    outcome: 'failed',
    runId: 'run-conflict',
    applyStatus: 'APPLY_CONFLICT',
    applyErrorKind: 'PATCH_CONFLICT',
    applyErrorFiles: ['server/routes/a2a.ts'],
    applyError: 'git apply --check failed: patch does not apply',
  });

  assert.equal(record.lastStatus, 'APPLY_CONFLICT');
  assert.equal(record.lastOutcome, 'failed');
  assert.equal(record.lastRunId, 'run-conflict');
  assert.equal(record.applyStatus, 'APPLY_CONFLICT');
  assert.equal(record.applyErrorKind, 'PATCH_CONFLICT');
  assert.deepEqual(record.applyErrorFiles, ['server/routes/a2a.ts']);
  assert.match(record.applyError, /patch does not apply/);
});
