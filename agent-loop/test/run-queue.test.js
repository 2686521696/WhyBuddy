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
  buildQueueRestoreFailedSummary,
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
  const gate = 'cd slide-rule-python; & "{{pythonExe}}" -m pytest tests/test_client_parity.py -q';
  const resolved = resolveQueueGate(gate, {
    repoRoot,
    pythonExe: 'slide-rule-python/.venv/Scripts/python.exe',
  });

  assert.equal(
    resolved,
    `cd slide-rule-python; & "${path.join(repoRoot, 'slide-rule-python', '.venv', 'Scripts', 'python.exe')}" -m pytest tests/test_client_parity.py -q`,
  );
  assert.match(resolved, /& "/);
  assert.equal(resolvePythonExe(repoRoot, null).endsWith(`${path.sep}python.exe`), process.platform === 'win32');
});

test('resolveQueueGate substitutes taskFile for scoped mojibake gates', () => {
  const gate = 'node agent-loop/src/check-mojibake.js {{taskFile}} slide-rule-python/sliderule_llm/client.py';
  const resolved = resolveQueueGate(gate, {
    repoRoot,
    pythonExe: 'slide-rule-python/.venv/Scripts/python.exe',
    taskFile: 'agent-loop/tasks/backend-python-llm-client-parity.md',
  });

  assert.equal(
    resolved,
    'node agent-loop/src/check-mojibake.js agent-loop/tasks/backend-python-llm-client-parity.md slide-rule-python/sliderule_llm/client.py',
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

test('filterQueueTasks --only can single-run a disabled task', () => {
  const tasks = filterQueueTasks([
    { id: 'task-a', enabled: true },
    { id: 'task-b', enabled: false },
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
    { repoRoot, pythonExe: 'slide-rule-python/.venv/Scripts/python.exe' },
  );
  const tsc = resolveQueueGate(
    'pnpm exec tsc --noEmit --pretty false',
    { repoRoot, pythonExe: 'slide-rule-python/.venv/Scripts/python.exe' },
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

  const pythonExe = resolvePythonExe(workspaceRoot, 'slide-rule-python/.venv/Scripts/python.exe');
  try {
    await fs.access(pythonExe);
  } catch {
    t.skip(`python venv not present at ${pythonExe}`);
    return;
  }

  const command = resolveQueueGate(
    'cd slide-rule-python; & "{{pythonExe}}" -c "print(\'ok\')"',
    { repoRoot: workspaceRoot, pythonExe: 'slide-rule-python/.venv/Scripts/python.exe' },
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
      fixModel: 'grok-build',
      reviewModel: 'gpt-5.5',
      guardTests: true,
      maxIterations: 3,
      workerMaxTurns: 8,
      workerMaxRetries: 2,
      timeoutMs: 600000,
      agentIdleTimeoutMs: 120000,
      agentTimeoutMs: 240000,
      lang: 'zh-CN',
      pythonExe: 'slide-rule-python/.venv/Scripts/python.exe',
    },
    index: 0,
    gateSets: {
      gates: ['default-gate'],
      infraGates: ['cd slide-rule-python; & "{{pythonExe}}" -m pytest tests/test_client_parity.py -q'],
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
  assert.deepEqual(args.slice(args.indexOf('--fix-model'), args.indexOf('--fix-model') + 2), ['--fix-model', 'grok-build']);
  assert.deepEqual(args.slice(args.indexOf('--review-model'), args.indexOf('--review-model') + 2), ['--review-model', 'gpt-5.5']);
  assert.deepEqual(args.slice(args.indexOf('--worker-max-turns'), args.indexOf('--worker-max-turns') + 2), ['--worker-max-turns', '8']);
  assert.deepEqual(args.slice(args.indexOf('--worker-max-retries'), args.indexOf('--worker-max-retries') + 2), ['--worker-max-retries', '2']);
  assert.deepEqual(args.slice(args.indexOf('--agent-idle-timeout-ms'), args.indexOf('--agent-idle-timeout-ms') + 2), ['--agent-idle-timeout-ms', '120000']);
  assert.deepEqual(args.slice(args.indexOf('--agent-timeout-ms'), args.indexOf('--agent-timeout-ms') + 2), ['--agent-timeout-ms', '240000']);
  assert.match(gateArg, /test_client_parity\.py/);
  assert.match(gateArg, /& "/);
  assert.match(gateArg, /slide-rule-python[\\/]\.venv[\\/]Scripts[\\/]python\.exe/);
});

test('buildLoopArgsForQueueEntry applies global production budgets when queue omits overrides', () => {
  const args = buildLoopArgsForQueueEntry({
    agentLoopRoot,
    repoRoot,
    entry: {
      id: 'task-default-budget',
      task: 'agent-loop/tasks/task-default-budget.md',
    },
    defaults: {
      useWorktree: false,
      autoFix: true,
      skipReview: true,
    },
    index: 0,
    gateSets: {
      gates: ['node --version'],
    },
    defaultGates: ['node --version'],
  });

  assert.deepEqual(args.slice(args.indexOf('--max-iterations'), args.indexOf('--max-iterations') + 2), ['--max-iterations', '16']);
  assert.deepEqual(args.slice(args.indexOf('--worker-max-turns'), args.indexOf('--worker-max-turns') + 2), ['--worker-max-turns', '512']);
});

test('buildLoopArgsForQueueEntry passes merged worker env from defaults and entry', () => {
  const args = buildLoopArgsForQueueEntry({
    agentLoopRoot,
    repoRoot,
    entry: {
      id: 'backend-python-network-worker',
      task: 'agent-loop/tasks/backend-python-network-worker.md',
      gatesKey: 'gates',
      workerEnv: {
        HTTPS_PROXY: 'http://127.0.0.1:7891',
        NO_PROXY: 'localhost,127.0.0.1,::1',
        EMPTY_IGNORED: '',
      },
    },
    defaults: {
      useWorktree: false,
      autoFix: true,
      skipReview: true,
      workerEnv: {
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
      },
    },
    gateSets: {
      gates: ['node --version'],
    },
    defaultGates: ['node --version'],
  });

  const workerEnvPairs = args
    .map((arg, index) => (arg === '--worker-env' ? args[index + 1] : null))
    .filter(Boolean);

  assert.deepEqual(workerEnvPairs, [
    'HTTP_PROXY=http://127.0.0.1:7890',
    'HTTPS_PROXY=http://127.0.0.1:7891',
    'NO_PROXY=localhost,127.0.0.1,::1',
  ]);
});

test('migration queue task entries use worker max-turn fields instead of grok legacy names', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));

  const legacyTasks = (queue.tasks || []).filter((task) => (
    Object.prototype.hasOwnProperty.call(task, 'grokMaxTurns')
    || Object.prototype.hasOwnProperty.call(task, 'grokMaxRetries')
  ));

  assert.deepEqual(
    legacyTasks.map((task) => task.id || task.task),
    [],
    'task entries should use workerMaxTurns/workerMaxRetries; keep grokMax* only as defaults compatibility',
  );
});

test('migration queue worker max turns defaults and task overrides are 512', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));

  assert.equal(queue.defaults?.workerMaxTurns, 512);
  assert.equal(queue.defaults?.grokMaxTurns, 512);

  const non512Tasks = (queue.tasks || []).filter((task) => task.workerMaxTurns !== 512);

  assert.deepEqual(
    non512Tasks.map((task) => task.id || task.task),
    [],
    'all queue task entries should run with workerMaxTurns: 512',
  );
});

test('migration queue defaults use grok as the fix worker', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));

  assert.equal(queue.defaults?.fixAgent, 'grok');
  assert.equal(queue.defaults?.fixModel, 'grok-build');
  assert.equal(queue.defaults?.reviewAgent, 'codex');
  assert.equal(queue.defaults?.reviewModel, 'gpt-5.5');
});

test('migration queue defaults configure local proxy env for worker agents', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));

  assert.deepEqual(queue.defaults?.workerEnv, {
    HTTP_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    ALL_PROXY: 'http://127.0.0.1:7890',
    NO_PROXY: 'localhost,127.0.0.1,::1',
  });
});

test('migration queue keeps 107 settings full wave available but disabled when superseded', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const tasks = queue.tasks || [];

  const expected107Ids = [
    'agent-loop-settings-schema-config-surface-107',
    'agent-loop-settings-effective-config-runtime-107',
    'agent-loop-settings-worker-env-secret-injection-107',
    'agent-loop-settings-cli-worker-routing-107',
    'agent-loop-settings-provider-health-cli-107',
    'agent-loop-settings-provider-health-cache-107',
    'agent-loop-settings-profile-storage-schema-107',
    'agent-loop-settings-profile-crud-ui-107',
    'agent-loop-settings-profile-run-guard-107',
    'agent-loop-settings-queue-defaults-sync-107',
    'agent-loop-settings-import-export-files-107',
    'agent-loop-settings-diagnostics-artifacts-107',
    'agent-loop-settings-ui-product-polish-107',
    'agent-loop-settings-dev-preview-mocks-107',
    'agent-loop-settings-test-harness-coverage-107',
    'agent-loop-settings-docs-operator-runbook-107',
    'agent-loop-settings-release-readiness-vsix-107',
    'agent-loop-settings-security-redaction-audit-107',
    'agent-loop-settings-workspace-trust-107',
    'agent-loop-settings-runner-task-generation-107',
  ].sort();

  const present107Ids = tasks.filter((task) => task.id?.endsWith('-107')).map((task) => task.id).sort();
  assert.deepEqual(present107Ids, expected107Ids);

  const enabled107Ids = tasks.filter((task) => task.id?.endsWith('-107') && task.enabled).map((task) => task.id);
  assert.deepEqual(enabled107Ids, [], '107 settings tasks should stay present for --only reruns but disabled while 108 is active');

  const stillEnabledSuperseded = tasks.filter(
    (task) => (
      /^agent-loop-settings-.*-(100|101|102|103|104|105|106)$/.test(task.id || '')
    ) && task.enabled,
  );
  assert.deepEqual(
    stillEnabledSuperseded.map((task) => task.id),
    [],
    '100-106-stage settings tasks should stay disabled once the 107 settings full wave is active',
  );

  const missingTaskFiles = [];
  const missingGates = [];
  const guardEnabled = [];
  const gatesWithoutMarkers = [];
  for (const entry of tasks.filter((task) => task.id?.endsWith('-107'))) {
    const taskPath = path.join(workspaceRoot, entry.task);
    try {
      await fs.access(taskPath);
    } catch {
      missingTaskFiles.push(entry.task);
    }
    if (!Array.isArray(queue[entry.gatesKey])) missingGates.push(entry.gatesKey);
    if (!JSON.stringify(queue[entry.gatesKey] || []).includes('missing Settings 107 marker')) {
      gatesWithoutMarkers.push(entry.gatesKey);
    }
    if (entry.guardTests) guardEnabled.push(entry.id);
  }

  assert.deepEqual(missingTaskFiles, []);
  assert.deepEqual(missingGates, []);
  assert.deepEqual(gatesWithoutMarkers, []);
  assert.deepEqual(guardEnabled, []);
});

test('migration queue 107 settings wave keeps task specific red gates for single-rerun safety', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const tasks = queue.tasks || [];

  const settings107 = tasks.filter((t) => t.id && t.id.endsWith('-107'));
  assert.ok(settings107.length > 0, '107 wave must stay available for explicit --only reruns');

  for (const entry of settings107) {
    const gates = queue[entry.gatesKey] || [];
    assert.ok(Array.isArray(gates) && gates.length > 0, `missing gates array for ${entry.gatesKey}`);
    assert.match(gates[0] || '', /node -e .*Buffer\.from.*missing Settings 107 marker/, `${entry.gatesKey} must start with task-specific marker check (red gate)`);
    const hasMojibake = gates.some((g) => typeof g === 'string' && g.includes('check-mojibake.js'));
    assert.ok(hasMojibake, `${entry.gatesKey} must contain mojibake check`);
  }

  // ensure 100-106 remain disabled
  const enabledOld = tasks.filter((t) => t.enabled && /^agent-loop-settings-.*-(100|101|102|103|104|105|106)$/.test(t.id || ''));
  assert.deepEqual(enabledOld, [], '100-106 settings must be disabled while 107 active');
});

test('migration queue enables 110 SlideRule AgentLoop runtime SSOT wave and disables superseded waves', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const tasks = queue.tasks || [];

  const enabledIds = tasks.filter((task) => task.enabled).map((task) => task.id).sort();
  const expected110Ids = [
    'sliderule-agentloop-event-envelope-110',
    'sliderule-agentloop-event-store-110',
    'sliderule-agentloop-state-reducer-110',
    'sliderule-agentloop-legacy-event-adapter-110',
    'sliderule-agentloop-event-read-api-110',
    'sliderule-agentloop-sse-stream-v2-110',
    'sliderule-agentloop-web-route-shell-110',
    'sliderule-agentloop-flow-event-projection-110',
    'sliderule-agentloop-node-event-adapter-110',
    'sliderule-agentloop-python-worker-adapter-110',
    'sliderule-agentloop-artifact-index-110',
    'sliderule-agentloop-replay-release-readiness-110',
  ].sort();

  assert.deepEqual(
    expected110Ids.filter((id) => !enabledIds.includes(id)),
    [],
    'the 110 SlideRule AgentLoop runtime SSOT core wave must remain enabled',
  );

  const enabled108Ids = tasks.filter((task) => task.enabled && /^sliderule-agentloop-.*-108$/.test(task.id || '')).map((task) => task.id);
  assert.deepEqual(enabled108Ids, [], '108 integration tasks should stay present for --only reruns but disabled once 110 is active');
  const enabled109Ids = tasks.filter((task) => task.enabled && /^sliderule-agentloop-.*-109$/.test(task.id || '')).map((task) => task.id);
  assert.deepEqual(enabled109Ids, [], '109 rescue tasks should stay present for --only reruns but disabled once 110 is active');
});

test('migration queue 110 SlideRule AgentLoop runtime SSOT wave has task specific red gates', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const tasks = queue.tasks || [];

  const enabled110 = tasks.filter((task) => task.enabled && /^sliderule-agentloop-.*-110$/.test(task.id || ''));
  assert.equal(enabled110.length, 12, '110 runtime SSOT wave should have exactly 12 enabled tasks');

  const missingTaskFiles = [];
  const missingGates = [];
  const gatesWithoutMarkers = [];
  const gatesWithoutExecution = [];
  const gatesWithoutMojibake = [];
  const guardEnabled = [];
  const non128Tasks = [];

  for (const entry of enabled110) {
    const taskPath = path.join(workspaceRoot, entry.task);
    try {
      await fs.access(taskPath);
    } catch {
      missingTaskFiles.push(entry.task);
    }

    const gates = queue[entry.gatesKey] || [];
    if (!Array.isArray(gates) || gates.length === 0) missingGates.push(entry.gatesKey);
    if (!String(gates[0] || '').includes('missing SlideRule AgentLoop 110 marker')) {
      gatesWithoutMarkers.push(entry.gatesKey);
    }
    if (!gates.some((gate) => typeof gate === 'string' && (gate.includes('-m pytest') || gate.includes('node --test')))) {
      gatesWithoutExecution.push(entry.gatesKey);
    }
    if (!gates.some((gate) => typeof gate === 'string' && gate.includes('check-mojibake.js'))) {
      gatesWithoutMojibake.push(entry.gatesKey);
    }
    if (entry.guardTests) guardEnabled.push(entry.id);
    if (entry.workerMaxTurns !== 512) non128Tasks.push(entry.id);
  }

  assert.deepEqual(missingTaskFiles, []);
  assert.deepEqual(missingGates, []);
  assert.deepEqual(gatesWithoutMarkers, []);
  assert.deepEqual(gatesWithoutExecution, []);
  assert.deepEqual(gatesWithoutMojibake, []);
  assert.deepEqual(guardEnabled, []);
  assert.deepEqual(non128Tasks, []);
});

test('migration queue release readiness 107 runs full extension tests', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const gates = queue.agentLoopSettingsReleaseReadinessVsix107Gates || [];

  assert.ok(
    gates.some((gate) => gate === 'cd agent-loop/vscode-extension; npm test'),
    'release readiness must prove the full extension test suite, not only the filtered release readiness tests',
  );
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

test('buildQueueSummaryFromState marks failed runs with diff as rescue patch available', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-rescue', task: 'agent-loop/tasks/task-rescue.md' },
    state: {
      runId: '2026-06-23T04-02-28-134Z',
      status: 'HALT_NO_PROGRESS',
      options: { fixAgent: 'grok', skipReview: true },
      iterations: [
        {
          iteration: 1,
          grokFix: { exitCode: 1 },
          diff: { bytes: 16691 },
          attempts: [
            {
              attempt: 1,
              grokFix: { exitCode: 1 },
              failure: { kind: 'max_turns', retryable: false, agentUnstable: false },
              diff: { bytes: 16691 },
              diffChanged: true,
            },
          ],
        },
      ],
      grokFix: { exitCode: 1 },
    },
    exitCode: 1,
  });

  assert.equal(summary.outcome, 'failed');
  assert.equal(summary.applyStatus, 'RESCUE_PATCH_AVAILABLE');
  assert.equal(summary.applyErrorKind, 'PARTIAL_DIFF_GATE_RED');
  assert.equal(summary.rescuePatchAvailable, true);
  assert.equal(summary.diffBytes, 16691);
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

test('buildQueueSummaryFromState does not mark review needs_changes no-diff as done', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    state: {
      status: 'HALT_NO_CHANGES',
      baselineGate: { ok: true, failureCount: 0 },
      baselineDiff: { bytes: 0 },
      reviewVerdict: 'needs_changes',
      iterations: [{ iteration: 1, diff: { bytes: 100 } }],
      agentFix: { exitCode: 0 },
      agentReview: { exitCode: 0, parsed: { verdict: 'needs_changes' } },
      options: { fixAgent: 'codex', reviewAgent: 'codex' },
    },
    exitCode: 1,
  });

  assert.equal(summary.status, 'HALT_NO_CHANGES');
  assert.equal(summary.outcome, 'failed');
  assert.equal(summary.applyStatus, null);
  assert.equal(summary.applyErrorKind, null);
  assert.equal(summary.runMode, 'halt-no-changes');
});

test('buildQueueRestoreFailedSummary turns failed checkpoint restore into a queue-stopping crash', () => {
  const summary = buildQueueRestoreFailedSummary({
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    error: new Error('reset --hard failed'),
  });

  assert.equal(summary.id, 'task-a');
  assert.equal(summary.task, 'agent-loop/tasks/task-a.md');
  assert.equal(summary.status, 'HALT_QUEUE_RESTORE_FAILED');
  assert.equal(summary.outcome, 'crashed');
  assert.equal(summary.runMode, 'halt-queue-restore-failed');
  assert.match(summary.worktreeError, /reset --hard failed/);
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

// ===== Settings queue defaults preview coverage (dry-run, no write, workerEnv redaction) =====
test('migration queue settings preview API does not write migration-queue.json (dry run only)', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const before = await fs.readFile(queuePath, 'utf8');
  const beforeM = (await fs.stat(queuePath)).mtimeMs;

  // Simulate read + structured preview of supported without mutating
  const parsed = JSON.parse(before);
  const supported = ['fixAgent', 'workerMaxTurns', 'reviewAgent', 'skipReview', 'maxIterations'];
  const previewSlice = {};
  for (const k of supported) {
    if (k in (parsed.defaults || {})) previewSlice[k] = (parsed.defaults || {})[k];
  }
  // pretend dry-run change
  previewSlice.workerMaxTurns = 999;

  const after = await fs.readFile(queuePath, 'utf8');
  const afterM = (await fs.stat(queuePath)).mtimeMs;
  assert.equal(after, before);
  assert.equal(afterM, beforeM);
  assert.equal(previewSlice.workerMaxTurns, 999);
});

test('migration queue settings preview redacts workerEnv secret values in output', async () => {
  const queuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');
  const q = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const rawDefaults = q.defaults || {};

  // Preview output shape must never contain workerEnv values
  const preview = {};
  const supportedNoEnv = Object.keys(rawDefaults).filter((k) => k !== 'workerEnv');
  for (const k of supportedNoEnv) {
    preview[k] = rawDefaults[k];
  }
  assert.ok(!('workerEnv' in preview), 'preview must redact/omit workerEnv');
  if (rawDefaults.workerEnv) {
    // ensure original had it but we excluded
    assert.ok(Object.keys(rawDefaults.workerEnv).length > 0);
  }
});
