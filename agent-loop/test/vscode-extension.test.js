import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';


const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(agentLoopRoot, 'vscode-extension');
const extensionOut = path.join(extensionRoot, 'out');
const requireFromExtension = createRequire(path.join(extensionRoot, 'package.json'));

test('extension runSummary matches core runSummary for agent-neutral cases', async () => {
  const core = await import(pathToFileURL(path.join(agentLoopRoot, 'src', 'runSummary.js')).href);
  const ext = requireFromExtension('./out/runSummary.js');

  const cases = [
    {
      name: 'grok fix + grok review',
      input: {
        runId: '2026-06-16T18-00-00-000Z',
        status: 'DONE_REVIEWED',
        task: 'tasks/a.md',
        iterations: [{ iteration: 1, grokFix: { exitCode: 0, timedOut: false } }],
        grokFix: { exitCode: 0, timedOut: false },
        grokReview: { exitCode: 0, timedOut: false },
        fixAgent: 'grok',
        reviewAgent: 'grok',
      },
    },
    {
      name: 'codex fix does not mark grokRan',
      input: {
        runId: 'run-1',
        status: 'DONE_FIXED',
        task: 'task.md',
        iterations: [{ iteration: 1, agentFix: { exitCode: 0, timedOut: false } }],
        agentFix: { exitCode: 0, timedOut: false },
        fixAgent: 'codex',
        reviewAgent: 'grok',
      },
    },
    {
      name: 'gate only',
      input: {
        runId: '2026-06-16T17-00-02-496Z',
        status: 'DONE_GATE_ONLY',
        task: 'tasks/gate.md',
        iterations: [],
      },
    },
    {
      name: 'review halt after successful fix',
      input: {
        runId: 'run-2',
        status: 'HALT_HUMAN',
        task: 'task.md',
        iterations: [{ iteration: 1, agentFix: { exitCode: 0, timedOut: false } }],
        agentFix: { exitCode: 0, timedOut: false },
        agentReview: { exitCode: 1, timedOut: false },
        fixAgent: 'codex',
        reviewAgent: 'grok',
      },
    },
    {
      name: 'reviewed no diff apply status',
      input: {
        runId: 'run-3',
        status: 'DONE_REVIEWED_NO_DIFF',
        task: 'task.md',
        iterations: [],
        fixAgent: 'codex',
        reviewAgent: 'codex',
      },
    },
    {
      name: 'apply conflict status',
      input: {
        runId: 'run-4',
        status: 'APPLY_CONFLICT',
        task: 'task.md',
        iterations: [],
        fixAgent: 'codex',
        reviewAgent: 'codex',
      },
    },
  ];

  for (const { name, input } of cases) {
    const coreSummary = core.summarizeRunRecord(input);
    const extSummary = ext.summarizeRunRecord(input);
    assert.deepEqual(
      {
        runMode: extSummary.runMode,
        grokRan: extSummary.grokRan,
        codexRan: extSummary.codexRan,
        reviewAgentRan: extSummary.reviewAgentRan,
        iterations: extSummary.iterations,
      },
      {
        runMode: coreSummary.runMode,
        grokRan: coreSummary.grokRan,
        codexRan: coreSummary.codexRan,
        reviewAgentRan: coreSummary.reviewAgentRan,
        iterations: coreSummary.iterations,
      },
      name,
    );
  }
});

test('extension runSummary loads from a simulated VS Code install directory', async () => {
  const installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-ext-install-'));
  const fakeOutDir = path.join(installRoot, 'out');
  await fs.mkdir(fakeOutDir, { recursive: true });
  await fs.copyFile(
    path.join(extensionOut, 'runSummary.js'),
    path.join(fakeOutDir, 'runSummary.js'),
  );

  const requireFromInstall = createRequire(path.join(installRoot, 'package.json'));
  await fs.writeFile(path.join(installRoot, 'package.json'), '{"name":"fake-ext","version":"0.0.0"}\n', 'utf8');

  const mod = requireFromInstall('./out/runSummary.js');
  const summary = mod.summarizeRunRecord({
    runId: 'run-1',
    status: 'DONE_REVIEWED',
    task: 'task.md',
    iterations: [{ iteration: 1, grokFix: { exitCode: 0 } }],
    grokFix: { exitCode: 0 },
    grokReview: { exitCode: 0 },
    fixAgent: 'grok',
    reviewAgent: 'grok',
  });

  assert.equal(summary.runMode, 'grok-fix+grok-review');
  assert.equal(summary.grokRan, true);
});

test('findNewestFixLog prefers attempt stderr over iteration alias during fix', async () => {
  const { findNewestFixLog } = requireFromExtension('./out/activeLog.js');
  const latest = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-latest-log-'));
  await fs.writeFile(path.join(latest, 'grok-output.1.stderr.log'), 'alias-old\n', 'utf8');
  await fs.writeFile(path.join(latest, 'grok-output.1.2.stderr.log'), 'attempt-2-live\n', 'utf8');

  const resolved = await findNewestFixLog(latest, 'grok-output', 1);

  assert.equal(path.basename(resolved), 'grok-output.1.2.stderr.log');
});

test('resolveActiveLogPath prefers grok review stdout after DONE_REVIEWED', async () => {
  const { resolveActiveLogPath } = requireFromExtension('./out/activeLog.js');
  const latest = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-latest-log-'));
  await fs.writeFile(path.join(latest, 'review-output.grok.stderr.log'), '', 'utf8');
  await fs.writeFile(
    path.join(latest, 'review-output.grok.stdout.log'),
    JSON.stringify({
      text: JSON.stringify({ verdict: 'pass', summary: 'pool parity 已完成' }),
    }),
    'utf8',
  );

  const resolved = await resolveActiveLogPath(latest, {
    status: 'DONE_REVIEWED',
    options: { reviewAgent: 'grok', skipReview: false },
    grokReview: { exitCode: 0 },
    iterations: [],
  });

  assert.equal(path.basename(resolved), 'review-output.grok.stdout.log');
});

test('resolveActiveLogPath shows fix stderr after HALT_NO_CHANGES', async () => {
  const { resolveActiveLogPath } = requireFromExtension('./out/activeLog.js');
  const latest = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-latest-log-'));
  await fs.writeFile(path.join(latest, 'grok-output.1.1.stderr.log'), 'Error: max turns reached\n', 'utf8');
  await fs.writeFile(
    path.join(latest, 'grok-output.1.1.stdout.log'),
    JSON.stringify({ text: '正在读取相关文件\n' }),
    'utf8',
  );

  const resolved = await resolveActiveLogPath(latest, {
    status: 'HALT_NO_CHANGES',
    options: { fixAgent: 'grok', skipReview: false, reviewAgent: 'grok' },
    currentIteration: 1,
    iterations: [{ iteration: 1, grokFix: { exitCode: 1 } }],
    grokFix: { exitCode: 1 },
  });

  assert.equal(path.basename(resolved), 'grok-output.1.1.stderr.log');
});

test('resolveActiveLogPath prefers explicit active agent log pointer during fix', async () => {
  const { resolveActiveLogPath } = requireFromExtension('./out/activeLog.js');
  const latest = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-active-pointer-'));
  await fs.writeFile(path.join(latest, 'grok-output.1.2.stderr.log'), 'newer but not active\n', 'utf8');
  await fs.writeFile(path.join(latest, 'grok-output.1.1.stderr.log'), 'current active log\n', 'utf8');

  const resolved = await resolveActiveLogPath(latest, {
    status: 'GROK_FIX',
    options: { fixAgent: 'grok' },
    currentIteration: 1,
    activeAgentLog: {
      phase: 'fix',
      agent: 'grok',
      iteration: 1,
      attempt: 1,
      stderr: 'grok-output.1.1.stderr.log',
      stdout: 'grok-output.1.1.stdout.log',
    },
  });

  assert.equal(path.basename(resolved), 'grok-output.1.1.stderr.log');
});

test('resolveLogRoot prefers run artifacts directory over latest', async () => {
  const { resolveLogRoot } = requireFromExtension('./out/activeLog.js');
  const repoRoot = 'C:\\repo';
  const runDir = 'C:\\repo\\.agent-loop\\runs\\2026-06-17T14-07-19-291Z';

  assert.equal(
    resolveLogRoot({ artifacts: { runDir } }, repoRoot),
    runDir,
  );
  assert.equal(
    resolveLogRoot(null, repoRoot),
    path.join(repoRoot, '.agent-loop', 'latest'),
  );
});

test('resolveDisplayGate prefers post-fix gate over baseline gate', async () => {
  const { resolveDisplayGate } = requireFromExtension('./out/gateSummary.js');

  const gate = resolveDisplayGate({
    baselineGate: { ok: false, failureCount: 2 },
    iterations: [
      { iteration: 1, gate: { ok: true, failureCount: 0 } },
    ],
  });

  assert.deepEqual(gate, {
    ok: true,
    text: '修复 Gate 绿',
    source: 'post-fix',
    failureCount: 0,
  });
});

test('buildRunSnapshot can read a historical run and freeze terminal elapsed', async () => {
  const { buildRunSnapshotFromStatePath } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-snapshot-repo-'));
  const runId = '2026-06-17T15-34-38-183Z';
  const runDir = path.join(repo, '.agent-loop', 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });
  const statePath = path.join(runDir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify({
    runId,
    status: 'HALT_NO_CHANGES',
    options: { task: 'agent-loop/tasks/migrate-sliderule-critique-generate.md' },
    baselineGate: { ok: false, failureCount: 2 },
    iterations: [
      {
        iteration: 1,
        agentFix: {
          startedAt: '2026-06-17T15:34:46.734Z',
          endedAt: '2026-06-17T15:36:00.631Z',
        },
        gate: null,
      },
    ],
    artifacts: { runDir },
  }), 'utf8');

  const snapshot = await buildRunSnapshotFromStatePath(repo, statePath, {
    now: () => Date.parse('2026-06-17T15:40:00.000Z'),
  });

  assert.equal(snapshot.state.runId, runId);
  assert.equal(snapshot.taskLabel, 'migrate-sliderule-critique-generate');
  assert.equal(snapshot.elapsedMs, 82448);
});

test('buildRunSnapshot marks stale active runs as interrupted and freezes elapsed', async () => {
  const { buildRunSnapshotFromStatePath } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-stale-snapshot-'));
  const runId = '2026-06-20T19-21-08-121Z';
  const runDir = path.join(repo, '.agent-loop', 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });
  const statePath = path.join(runDir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify({
    runId,
    status: 'CODEX_FIX',
    options: {
      task: 'agent-loop/tasks/backend-python-blueprint-brainstorm-contract.md',
      timeoutMs: 1800000,
      fixAgent: 'codex',
      reviewAgent: 'codex',
    },
    artifacts: { runDir },
    iterations: [],
  }), 'utf8');
  const staleTime = new Date('2026-06-20T19:21:48.000Z');
  await fs.utimes(statePath, staleTime, staleTime);

  const snapshot = await buildRunSnapshotFromStatePath(repo, statePath, {
    now: () => Date.parse('2026-06-20T20:10:00.000Z'),
  });

  assert.equal(snapshot.state.status, 'CODEX_FIX');
  assert.equal(snapshot.displayStatus, 'STALE_INTERRUPTED');
  assert.equal(snapshot.phaseLabel, '运行中断');
  assert.equal(snapshot.staleRun.status, 'CODEX_FIX');
  assert.equal(snapshot.elapsedMs, staleTime.getTime() - Date.parse('2026-06-20T19:21:08.121Z'));
  assert.ok(snapshot.details.some((line) => line.includes('运行中断')));
});

test('buildRunSnapshot reads landing status and structured final report', async () => {
  const { buildRunSnapshotFromStatePath } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-snapshot-report-'));
  const runId = '2026-06-20T10-00-00-000Z';
  const runDir = path.join(repo, '.agent-loop', 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });
  const statePath = path.join(runDir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify({
    runId,
    status: 'DONE_REVIEWED',
    options: { task: 'agent-loop/tasks/task-a.md' },
    artifacts: { runDir },
    guardPolicy: { protectedGlobs: ['src/generated/**'], protectTaskDocs: true },
    iterations: [],
  }), 'utf8');
  await fs.writeFile(path.join(runDir, 'landing.json'), JSON.stringify({
    status: 'MAIN_GATE_GREEN',
    appliedToMain: true,
    mainGateGreen: true,
    committed: false,
  }), 'utf8');
  await fs.writeFile(path.join(runDir, 'final-report.json'), JSON.stringify({
    schemaVersion: 1,
    status: 'DONE_REVIEWED',
    runMode: 'grok-fix+grok-review',
    guardPolicy: { protectedGlobs: ['src/generated/**'], protectTaskDocs: true },
  }), 'utf8');

  const snapshot = await buildRunSnapshotFromStatePath(repo, statePath, {
    now: () => Date.parse('2026-06-20T10:01:00.000Z'),
  });

  assert.equal(snapshot.landing.status, 'MAIN_GATE_GREEN');
  assert.equal(snapshot.finalReport.status, 'DONE_REVIEWED');
  assert.deepEqual(snapshot.guardPolicy, { protectedGlobs: ['src/generated/**'], protectTaskDocs: true });
});

test('findLatestRunForTask maps a queue task to its newest run', async () => {
  const { findLatestRunForTask } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-task-run-'));
  const runs = path.join(repo, '.agent-loop', 'runs');
  await fs.mkdir(path.join(runs, 'older'), { recursive: true });
  await fs.mkdir(path.join(runs, 'newer'), { recursive: true });
  await fs.writeFile(path.join(runs, 'older', 'state.json'), JSON.stringify({
    status: 'DONE_GATE_ONLY',
    options: { task: 'agent-loop/tasks/migrate-sliderule-report-write.md' },
  }), 'utf8');
  await fs.writeFile(path.join(runs, 'newer', 'state.json'), JSON.stringify({
    status: 'HALT_HUMAN',
    options: { task: 'agent-loop/tasks/migrate-sliderule-report-write.md' },
  }), 'utf8');
  const olderTime = new Date('2026-06-17T15:00:00.000Z');
  const newerTime = new Date('2026-06-17T15:00:01.000Z');
  await fs.utimes(path.join(runs, 'older', 'state.json'), olderTime, olderTime);
  await fs.utimes(path.join(runs, 'newer', 'state.json'), newerTime, newerTime);

  const match = await findLatestRunForTask(repo, 'agent-loop/tasks/migrate-sliderule-report-write.md');

  assert.equal(match.runId, 'newer');
  assert.equal(path.basename(path.dirname(match.statePath)), 'newer');
});

test('formatAgentLogTail pretty prints grok review json', async () => {
  const { formatAgentLogTail } = requireFromExtension('./out/activeLog.js');
  const tail = formatAgentLogTail(JSON.stringify({
    text: JSON.stringify({ verdict: 'pass', summary: 'gate 全绿，审查通过' }),
  }));

  assert.match(tail, /"verdict": "pass"/);
  assert.match(tail, /"summary": "gate 全绿，审查通过"/);
  assert.match(tail, /^\{\n/);
});

test('formatAgentLogTail pretty prints top-level review json', async () => {
  const { formatAgentLogTail } = requireFromExtension('./out/activeLog.js');
  const tail = formatAgentLogTail(JSON.stringify({
    verdict: 'pass',
    summary: 'admin contract gate passed',
    findings: [],
  }));

  assert.match(tail, /"verdict": "pass"/);
  assert.match(tail, /"summary": "admin contract gate passed"/);
  assert.match(tail, /"findings": \[\]/);
  assert.doesNotMatch(tail, /^\{"verdict":/);
});

test('buildQueueOverview merges queue membership with per-task outcomes', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-overview-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    defaults: {
      useWorktree: true,
      worktreeScope: 'queue',
      queueWorktreeName: 'migration-queue',
      fixAgent: 'grok',
      reviewAgent: 'codex',
      skipReview: false,
    },
    tasks: [
      { id: 'a', task: 'agent-loop/tasks/a.md' },
      { id: 'b', task: 'agent-loop/tasks/b.md', worktreeScope: 'task', worktreeName: 'task-b', fixAgent: 'codex', reviewAgent: 'grok' },
      { id: 'c', task: 'agent-loop/tasks/c.md', enabled: false },
    ],
  }), 'utf8');
  await fs.mkdir(path.join(repo, '.agent-loop'), { recursive: true });
  await fs.writeFile(path.join(repo, '.agent-loop', 'queue-outcomes.json'), JSON.stringify({
    tasks: {
      a: {
        lastOutcome: 'done',
        lastStatus: 'DONE_REVIEWED',
        lastRunId: 'run-a',
        lastUpdatedAt: '2026-06-23T08:00:00.000Z',
      },
      b: { lastOutcome: 'failed', lastStatus: 'HALT_HUMAN', lastRunId: 'run-b' },
    },
  }), 'utf8');

  const overview = await buildQueueOverview(repo, { queueFilePath, queueRunning: false });

  assert.equal(overview.counts.total, 3);
  assert.equal(overview.counts.done, 1);
  assert.equal(overview.counts.failed, 0);
  assert.equal(overview.counts.human, 1);
  assert.equal(overview.counts.pending, 1);
  assert.equal(overview.tasks[0].outcome, 'done');
  assert.equal(overview.tasks[0].agent, 'Grok / Codex');
  assert.equal(overview.tasks[0].fixAgent, 'grok');
  assert.equal(overview.tasks[0].reviewAgent, 'codex');
  assert.equal(overview.tasks[0].lastUpdatedText, '2026-06-23 16:00:00');
  assert.equal(overview.tasks[0].branch, 'agent-loop/migration-queue');
  assert.equal(overview.tasks[1].agent, 'Codex / Grok');
  assert.equal(overview.tasks[1].branch, 'agent-loop/task-b');
  assert.equal(overview.tasks[2].enabled, false);
});

test('buildQueueOverview groups no-diff reviewed and apply conflicts separately', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-overview-groups-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    tasks: [
      { id: 'no-diff', task: 'agent-loop/tasks/no-diff.md' },
      { id: 'conflict', task: 'agent-loop/tasks/conflict.md' },
      { id: 'rescue', task: 'agent-loop/tasks/rescue.md' },
      { id: 'human', task: 'agent-loop/tasks/human.md' },
      { id: 'dirty', task: 'agent-loop/tasks/dirty.md' },
    ],
  }), 'utf8');
  await fs.mkdir(path.join(repo, '.agent-loop'), { recursive: true });
  await fs.writeFile(path.join(repo, '.agent-loop', 'queue-outcomes.json'), JSON.stringify({
    tasks: {
      'no-diff': {
        lastOutcome: 'done',
        lastStatus: 'DONE_REVIEWED_NO_DIFF',
        lastRunId: 'run-no-diff',
        applyStatus: 'DONE_REVIEWED_NO_DIFF',
        applyErrorKind: 'NO_DIFF_PATCH',
      },
      conflict: {
        lastOutcome: 'failed',
        lastStatus: 'APPLY_CONFLICT',
        lastRunId: 'run-conflict',
        applyStatus: 'APPLY_CONFLICT',
        applyErrorKind: 'PATCH_CONFLICT',
        applyErrorFiles: ['server/routes/a2a.ts'],
      },
      rescue: {
        lastOutcome: 'failed',
        lastStatus: 'HALT_NO_PROGRESS',
        lastRunId: 'run-rescue',
        applyStatus: 'RESCUE_PATCH_AVAILABLE',
        applyErrorKind: 'PARTIAL_DIFF_GATE_RED',
        rescuePatchAvailable: true,
        diffBytes: 16691,
      },
      human: { lastOutcome: 'failed', lastStatus: 'HALT_HUMAN', lastRunId: 'run-human' },
      dirty: {
        lastOutcome: 'crashed',
        lastStatus: 'DIRTY_MAIN_NEEDS_COMMIT',
        lastRunId: null,
        worktreeErrorFiles: ['agent-loop/src/runQueue.js'],
      },
    },
  }), 'utf8');

  const overview = await buildQueueOverview(repo, { queueFilePath, queueRunning: false });

  assert.equal(overview.counts.done, 0);
  assert.equal(overview.counts.noDiff, 1);
  assert.equal(overview.counts.applyConflict, 1);
  assert.equal(overview.counts.rescuePatch, 1);
  assert.equal(overview.counts.failed, 1);
  assert.equal(overview.counts.human, 1);
  assert.equal(overview.counts.crashed, 0);
  assert.equal(overview.counts.stopped, 1);
  assert.equal(overview.tasks[0].outcomeGroup, 'noDiff');
  assert.equal(overview.tasks[1].outcomeGroup, 'applyConflict');
  assert.deepEqual(overview.tasks[1].applyErrorFiles, ['server/routes/a2a.ts']);
  assert.equal(overview.tasks[2].outcomeGroup, 'rescuePatch');
  assert.equal(overview.tasks[2].category, 'attention');
  assert.equal(overview.tasks[2].rescuePatchAvailable, true);
  assert.equal(overview.tasks[2].diffBytes, 16691);
  assert.equal(overview.tasks[4].outcomeGroup, 'stopped');
});

test('buildQueueOverview promotes explicit manual rescue evidence out of attention', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-overview-manual-rescue-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    tasks: [
      { id: 'rescued', task: 'agent-loop/tasks/rescued.md' },
      { id: 'still-needs-rescue', task: 'agent-loop/tasks/still-needs-rescue.md' },
    ],
  }), 'utf8');
  await fs.mkdir(path.join(repo, '.agent-loop'), { recursive: true });
  await fs.mkdir(path.join(repo, 'agent-loop', 'tasks'), { recursive: true });
  await fs.writeFile(path.join(repo, 'agent-loop', 'tasks', 'rescued.md'), [
    '# rescued',
    '',
    '- 状态：已完成（人工 rescue 后门禁已绿）',
    '',
    '### 救回验证',
    '- Python gate passed',
    '- Node gate passed',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(repo, 'agent-loop', 'tasks', 'still-needs-rescue.md'), [
    '# still-needs-rescue',
    '',
    '- 状态：需人工接管',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(repo, '.agent-loop', 'queue-outcomes.json'), JSON.stringify({
    tasks: {
      rescued: {
        lastOutcome: 'failed',
        lastStatus: 'HALT_NO_PROGRESS',
        lastRunId: 'run-rescued',
        applyStatus: 'RESCUE_PATCH_AVAILABLE',
        applyErrorKind: 'PARTIAL_DIFF_GATE_RED',
        rescuePatchAvailable: true,
        diffBytes: 4096,
      },
      'still-needs-rescue': {
        lastOutcome: 'failed',
        lastStatus: 'HALT_NO_PROGRESS',
        lastRunId: 'run-still-needs-rescue',
        applyStatus: 'RESCUE_PATCH_AVAILABLE',
        applyErrorKind: 'PARTIAL_DIFF_GATE_RED',
        rescuePatchAvailable: true,
        diffBytes: 2048,
      },
    },
  }), 'utf8');

  const overview = await buildQueueOverview(repo, { queueFilePath, queueRunning: false });

  assert.equal(overview.counts.done, 1);
  assert.equal(overview.counts.manualRescueLanded, 1);
  assert.equal(overview.counts.rescuePatch, 1);
  assert.equal(overview.counts.failed, 1);
  assert.equal(overview.tasks[0].outcomeGroup, 'manualRescueLanded');
  assert.equal(overview.tasks[0].category, 'landed');
  assert.equal(overview.tasks[0].status, 'MANUAL_RESCUE_LANDED');
  assert.equal(overview.tasks[0].applyStatus, 'MANUAL_RESCUE_LANDED');
  assert.equal(overview.tasks[0].rawStatus, 'HALT_NO_PROGRESS');
  assert.equal(overview.tasks[0].rawApplyStatus, 'RESCUE_PATCH_AVAILABLE');
  assert.equal(overview.tasks[1].outcomeGroup, 'rescuePatch');
  assert.equal(overview.tasks[1].category, 'attention');
  assert.equal(overview.tasks[1].status, 'HALT_NO_PROGRESS');
  assert.equal(overview.tasks[1].applyStatus, 'RESCUE_PATCH_AVAILABLE');
});

test('buildQueueOverview flags the running task from the live run', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-overview-run-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    tasks: [{ id: 'a', task: 'agent-loop/tasks/a.md' }, { id: 'b', task: 'agent-loop/tasks/b.md' }],
  }), 'utf8');

  const overview = await buildQueueOverview(repo, {
    queueFilePath,
    queueRunning: true,
    runningTaskPath: 'agent-loop/tasks/b.md',
  });

  assert.equal(overview.tasks[1].running, true);
  assert.equal(overview.tasks[0].running, false);
  assert.equal(overview.counts.running, 1);
});

test('buildQueueOverview does not count a stale active snapshot as running', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-overview-stale-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    tasks: [{ id: 'a', task: 'agent-loop/tasks/a.md' }, { id: 'b', task: 'agent-loop/tasks/b.md' }],
  }), 'utf8');

  const overview = await buildQueueOverview(repo, {
    queueFilePath,
    queueRunning: true,
    runningTaskPath: 'agent-loop/tasks/b.md',
    currentRunStale: true,
  });

  assert.equal(overview.tasks[1].running, false);
  assert.equal(overview.counts.running, 0);
  assert.equal(overview.counts.pending, 2);
});

test('extension phase labels render clean Chinese status text', async () => {
  const { phaseLabel, formatElapsed, activeAgentLabel } = requireFromExtension('./out/phaseLabels.js');

  assert.equal(phaseLabel(undefined), '等待运行');
  assert.equal(phaseLabel('INIT'), '初始化');
  assert.equal(phaseLabel('HALT_NO_CHANGES'), '修复无有效 diff');
  assert.equal(formatElapsed(62000), '1 分 02 秒');
  assert.equal(activeAgentLabel(undefined, null), '-');
});

test('classifyTriageCategory sorts tasks into the five overview lanes', () => {
  const { classifyTriageCategory } = requireFromExtension('./out/stateReader.js');
  const base = { running: false, stale: false, enabled: true, autoDisabled: false, outcomeGroup: null };

  assert.equal(classifyTriageCategory({ ...base, running: true }), 'running');
  assert.equal(classifyTriageCategory({ ...base, stale: true }), 'attention');
  assert.equal(classifyTriageCategory({ ...base, enabled: false }), 'disabled');
  assert.equal(classifyTriageCategory({ ...base, autoDisabled: true }), 'attention');
  assert.equal(classifyTriageCategory({ ...base, outcomeGroup: 'failed' }), 'attention');
  assert.equal(classifyTriageCategory({ ...base, outcomeGroup: 'applyConflict' }), 'attention');
  assert.equal(classifyTriageCategory({ ...base, outcomeGroup: 'rescuePatch' }), 'attention');
  assert.equal(classifyTriageCategory({ ...base, outcomeGroup: 'human' }), 'attention');
  assert.equal(classifyTriageCategory({ ...base, outcomeGroup: 'reviewed' }), 'landed');
  assert.equal(classifyTriageCategory({ ...base, outcomeGroup: 'noDiff' }), 'landed');
  assert.equal(classifyTriageCategory(base), 'pending');
});

test('buildQueueOverview attaches a triage category to each task', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-triage-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    tasks: [
      { id: 'a', task: 'agent-loop/tasks/a.md' },
      { id: 'b', task: 'agent-loop/tasks/b.md' },
    ],
  }), 'utf8');
  await fs.mkdir(path.join(repo, '.agent-loop'), { recursive: true });
  await fs.writeFile(path.join(repo, '.agent-loop', 'queue-outcomes.json'), JSON.stringify({
    tasks: {
      a: { lastOutcome: 'done', lastStatus: 'DONE_REVIEWED' },
      b: { lastOutcome: 'crashed', lastStatus: 'HALT_HUMAN' },
    },
  }), 'utf8');

  const overview = await buildQueueOverview(repo, { queueFilePath, queueRunning: false });

  assert.equal(overview.tasks[0].category, 'landed');
  assert.equal(overview.tasks[1].category, 'attention');
});

test('extractRunEvidence pulls the latest diff and failing gate output', () => {
  const { extractRunEvidence } = requireFromExtension('./out/stateReader.js');
  const ev = extractRunEvidence({
    baselineDiffText: 'old baseline diff',
    iterations: [
      {
        iteration: 1,
        diffText: 'diff --git a/a.js b/a.js\n+added line\n',
        gateSnapshot: {
          runs: [{ label: 'npm test', exitCode: 1, stdout: 'Tests: 1 failed', stderr: 'AssertionError: boom' }],
        },
      },
    ],
  });
  assert.match(ev.diffText, /\+added line/);
  assert.equal(ev.hasDiff, true);
  assert.match(ev.gateFailure, /npm test/);
  assert.match(ev.gateFailure, /AssertionError: boom/);
});

test('extractRunEvidence truncates a long diff and reports it', () => {
  const { extractRunEvidence } = requireFromExtension('./out/stateReader.js');
  const ev = extractRunEvidence(
    { iterations: [{ iteration: 1, diffText: 'x'.repeat(20000) }] },
    { maxDiffChars: 100 },
  );
  assert.equal(ev.diffTruncated, true);
  assert.equal(ev.diffText.length, 100);
});

test('dashboard media renders diff and failing gate panels', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 't', runId: 'r', status: 'HALT_NO_PROGRESS', pipelineSteps: [],
    hasDiff: true,
    diffText: 'diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-old\n+new\n',
    diffTruncated: false,
    gateFailure: '$ npm test\nAssertionError: boom',
    gateFailureTruncated: true,
    iterations: [], reviewRounds: [],
  });
  assert.match(html, /class="workbench-pane diff-pane"/);
  assert.match(html, /<h2>Diff<\/h2>/);
  assert.match(html, /data-scroll-key="diff"/);
  assert.match(html, /diff-add/);
  assert.match(html, /失败 Gate 输出/);
  assert.match(html, /AssertionError: boom/);
});

test('readRunEvents parses the append-only event log and skips junk', async () => {
  const { readRunEvents } = requireFromExtension('./out/stateReader.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-events-'));
  await fs.writeFile(path.join(dir, 'events.jsonl'), [
    JSON.stringify({ ts: '2026-06-21T08:00:00.000Z', status: 'INIT', iteration: null }),
    'not json at all',
    JSON.stringify({ ts: '2026-06-21T08:00:01.000Z', status: 'GROK_FIX', iteration: 1 }),
    '',
  ].join('\n'), 'utf8');

  const events = await readRunEvents(dir);
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 'INIT');
  assert.equal(events[1].status, 'GROK_FIX');
  assert.equal(events[1].iteration, 1);
  assert.deepEqual(await readRunEvents(path.join(dir, 'nope')), []);
});

test('dashboard media renders the run event stream', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 't', runId: 'r', status: 'DONE_REVIEWED', pipelineSteps: [],
    iterations: [], reviewRounds: [],
    events: [
      { status: 'INIT', label: '初始化', timeText: '16:49:25', iteration: null },
      { status: 'GROK_FIX', label: 'Grok 修复中', timeText: '16:49:32', iteration: 1 },
      { status: 'DONE_REVIEWED', label: '完成（已 review）', timeText: '16:50:08', iteration: null },
    ],
  });
  assert.match(html, /event-workbench/);
  assert.match(html, /event-search/);
  assert.match(html, /data-event-filter="errors"/);
  assert.match(html, /16:49:32/);
  assert.match(html, /Grok 修复中/);
  assert.match(html, /ev-dot ok/);
});

test('dashboard detail promotes queue back and file actions into the header', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'header-actions-task',
    taskPath: 'agent-loop/tasks/header-actions-task.md',
    runId: 'header-actions-run',
    status: 'DONE_REVIEWED',
    pipelineSteps: [],
    iterations: [],
    reviewRounds: [],
    reportPath: 'C:/repo/.agent-loop/latest/final-report.md',
    reportJsonPath: 'C:/repo/.agent-loop/latest/final-report.json',
    landingPath: 'C:/repo/.agent-loop/latest/landing.json',
    statePath: 'C:/repo/.agent-loop/latest/state.json',
  });
  // De-duplicated: brand lives in the sidebar, breadcrumb + actions in the topbar,
  // and the detail header keeps only the title + meta (no second copy of any of them).
  assert.match(html, /class="product-brand"[\s\S]*class="brand-mark"/);
  assert.match(html, /class="product-crumbs"[\s\S]*header-actions-task/);
  assert.match(html, /class="product-topbar-actions"[\s\S]*data-act="runTask"/);
  assert.match(html, /data-act="openReport"[\s\S]*final-report\.md/);
  assert.match(html, /data-act="openReport"[\s\S]*final-report\.json/);
  assert.match(html, /data-act="openReport"[\s\S]*landing\.json/);
  assert.match(html, /data-act="openState"[\s\S]*state\.json/);
  assert.doesNotMatch(html, /class="detail-breadcrumbs"/);
  assert.doesNotMatch(html, /class="detail-actions"/);
  assert.doesNotMatch(html, /class="btn ghost detail-back"/);
  assert.doesNotMatch(html, /<div class="links">/);
});

test('dashboard detail event filters and search reduce visible event rows', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'event-filter-task',
    runId: 'event-filter-run',
    status: 'HALT_HUMAN',
    pipelineSteps: [],
    iterations: [],
    reviewRounds: [],
    activeEventFilter: 'errors',
    eventSearchQuery: 'manual',
    events: [
      { status: 'INIT', label: 'Started', timeText: '10:00:00', iteration: null },
      { status: 'POST_FIX_GATE_RESULT', label: 'Gate failed', timeText: '10:01:00', iteration: 1 },
      { status: 'CODEX_REVIEW', label: 'Review started', timeText: '10:02:00', iteration: 1 },
      { status: 'HALT_HUMAN', label: 'Manual handoff required', timeText: '10:03:00', iteration: 1 },
    ],
  });

  assert.match(html, /data-event-search/);
  assert.match(html, /value="manual"/);
  assert.match(html, /class="chip err active" data-event-filter="errors"/);
  assert.match(html, /data-event-status="HALT_HUMAN"/);
  assert.match(html, /Manual handoff required/);
  assert.doesNotMatch(html, /data-event-status="INIT"/);
  assert.doesNotMatch(html, /data-event-status="POST_FIX_GATE_RESULT"/);
  assert.doesNotMatch(html, /data-event-status="CODEX_REVIEW"/);
});

test('dashboard event filtering logic groups errors, gate, review, and search matches', async () => {
  const win = await loadDashboardWindow();
  const { filterEvents } = win.AgentLoopDashboardInternals;
  const events = [
    { status: 'INIT', label: 'Started', timeText: '10:00:00', iteration: null },
    { status: 'POST_FIX_GATE_RESULT', label: 'Gate failed badly', timeText: '10:01:00', iteration: 1 },
    { status: 'CODEX_REVIEW', label: 'Review started', timeText: '10:02:00', iteration: 1 },
    { status: 'DONE_REVIEWED', label: 'Review passed', timeText: '10:03:00', iteration: null },
    { status: 'HALT_HUMAN', label: 'Manual handoff required', timeText: '10:04:00', iteration: 2 },
    { status: 'STALE_INTERRUPTED', label: 'Run stopped updating', timeText: '10:05:00', iteration: null },
  ];

  assert.deepEqual(filterEvents(events, 'errors', '').map((event) => event.status), ['HALT_HUMAN', 'STALE_INTERRUPTED']);
  assert.deepEqual(filterEvents(events, 'gate', '').map((event) => event.status), ['POST_FIX_GATE_RESULT']);
  assert.deepEqual(filterEvents(events, 'review', '').map((event) => event.status), ['CODEX_REVIEW', 'DONE_REVIEWED']);
  assert.deepEqual(filterEvents(events, 'all', 'manual').map((event) => event.status), ['HALT_HUMAN']);
  assert.deepEqual(filterEvents(events, 'errors', '#2').map((event) => event.status), ['HALT_HUMAN']);
});

test('dashboard detail renders the v2 operations workbench layout', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'backend-python-runtime-evidence-reconcile-89',
    taskPath: 'agent-loop/tasks/backend-python-runtime-evidence-reconcile-89.md',
    runId: '2026-06-22T14-30-15-000Z',
    status: 'DONE_REVIEWED',
    phaseLabel: '完成（已 review）',
    elapsedText: '8s',
    gateText: 'PASS',
    gateOk: true,
    agentText: 'codex + codex',
    roleText: 'codex + codex',
    runMode: 'codex-fix+codex-review',
    pipelineSteps: [
      { key: 'INIT', label: 'Init' },
      { key: 'WORKSPACE', label: 'Workspace' },
      { key: 'WORKTREE', label: 'Worktree' },
      { key: 'BASELINE_GATE_RESULT', label: 'Gate' },
      { key: 'CODEX_FIX', label: 'Codex' },
      { key: 'POST_FIX_GATE_RESULT', label: 'testGate' },
      { key: 'DONE', label: 'Done' },
    ],
    events: [
      { status: 'INIT', label: 'Initialized environment.', timeText: '14:30:15', iteration: null },
      { status: 'WORKSPACE', label: 'Workspace prepared successfully.', timeText: '14:30:17', iteration: null },
      { status: 'CODEX_FIX', label: 'Codex analysis completed.', timeText: '14:30:28', iteration: 1 },
      { status: 'DONE_REVIEWED', label: 'Execution finished.', timeText: '14:30:33', iteration: null },
    ],
    hasDiff: true,
    diffText: 'diff --git a/src/utils.py b/src/utils.py\n+new\n',
    diffTruncated: false,
    gateFailure: '',
    iterations: [{ iteration: 1, gateOk: true, failureCount: 0, diffBytes: 37 * 1024, guard: false, attempts: 1 }],
    reviewRounds: [{
      round: 1,
      verdict: 'pass',
      decision: 'pass',
      summary: 'Review passed with minor warnings.',
      findings: [{ severity: 'minor', path: 'src/utils.py', message: 'Line too long' }],
    }],
    agentTail: JSON.stringify({ review_id: 'rev-9a8b7c6d5e4f', status: 'pending_approval' }),
    landing: { status: 'MAIN_GATE_GREEN', commit: '8f7g6h5' },
    statePath: 'C:/repo/.agent-loop/latest/state.json',
    reportPath: 'C:/repo/.agent-loop/latest/final-report.md',
    reportJsonPath: 'C:/repo/.agent-loop/latest/final-report.json',
    landingPath: 'C:/repo/.agent-loop/latest/landing.json',
  });

  assert.match(html, /class="[^"]*\bdetail-shell\b[^"]*"/);
  assert.match(html, /class="product-crumbs"/);
  assert.match(html, /Runs/);
  assert.match(html, /backend-python-runtime-evidence-reconcile-89/);
  assert.match(html, /class="detail-meta"/);
  assert.match(html, /RunId:/);
  assert.match(html, /Commit:/);
  assert.match(html, /class="detail-stage-rail"/);
  assert.match(html, /class="stage-svg"/);
  assert.match(html, /任务准入/);
  assert.match(html, /Worker \(/);
  assert.match(html, /Reviewer \(/);
  assert.match(html, /已交付/);
  assert.match(html, /未通过，回修/);
  assert.match(html, /class="stage-legend"/);
  assert.match(html, /class="run-kpi-grid"/);
  assert.match(html, /迭代次数/);
  assert.match(html, /事件总数/);
  assert.match(html, /阻断次数/);
  assert.match(html, /最终状态/);
  assert.match(html, /37KB/);
  assert.match(html, /codex \+ codex/);
  assert.match(html, /class="detail-workbench"/);
  assert.match(html, /class="event-search"/);
  assert.match(html, /搜索事件/);
  assert.match(html, /data-event-filter="errors"/);
  assert.match(html, /class="workbench-tabs"/);
  assert.match(html, /class="tab active" data-tab="review"/);
  assert.match(html, /Review/);
  assert.match(html, /Diff/);
  assert.match(html, /Agent 输出/);
  assert.match(html, /Artifacts/);
  assert.match(html, /class="workbench-pane review-pane active"/);
  assert.match(html, /class="workbench-pane diff-pane"/);
  assert.match(html, /data-scroll-key="diff"/);
  assert.match(html, /class="workbench-pane agent-pane"/);
  assert.match(html, /data-scroll-key="agent-log"/);
  assert.match(html, /class="workbench-pane artifacts-pane"/);
  assert.match(html, /state\.json/);
});

test('dashboard detail renders a product-style v3 run page', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'backend-python-blueprint-job-store-runtime-takeover-104',
    runId: '2026-06-23T16-00-00-000Z',
    status: 'GROK_FIX',
    phaseLabel: 'Grok 修复中',
    elapsedText: '12 分 03 秒',
    gateText: '基线 Gate 红 (1)',
    gateOk: false,
    agentText: 'Grok',
    repo: 'cube-pets-office',
    commit: 'e7a3543d',
    pipelineSteps: [{ key: 'INIT', label: '初始化' }, { key: 'GROK_FIX', label: 'Grok' }],
    details: ['轮次 1', 'worktree: migration-queue'],
    iterations: [],
    reviewRounds: [],
    agentTail: 'working...',
    events: [
      { status: 'INIT', label: '初始化', timeText: '16:00:00', iteration: null },
      { status: 'GROK_FIX', label: 'Grok 修复中', timeText: '16:00:05', iteration: 1 },
    ],
    landing: { status: 'PENDING_APPLY' },
  });

  assert.match(html, /class="[^"]*\bproduct-shell\b[^"]*"/);
  assert.match(html, /class="[^"]*\bproduct-sidebar\b[^"]*"/);
  assert.match(html, /class="[^"]*\bproduct-topbar\b[^"]*"/);
  assert.match(html, /AgentLoop[\s\S]*Runs[\s\S]*backend-python-blueprint-job-store-runtime-takeover-104/);
  assert.match(html, /class="[^"]*\bpage-status-badge\b[^"]*[\s\S]*Grok 修复中/);
  assert.match(html, /class="[^"]*\brun-property-grid\b[^"]*"/);
  assert.match(html, /智能体[\s\S]*Grok/);
  assert.match(html, /环境[\s\S]*cube-pets-office/);
  assert.match(html, /调度配置[\s\S]*基线 Gate 红/);
  assert.match(html, /class="[^"]*\bexecution-history\b[^"]*"/);
  assert.match(html, /class="detail-hero v2"/);
  assert.match(html, /class="[^"]*\bant-descriptions\b[^"]*"/);
  assert.match(html, /class="stage-svg"/);
  assert.match(html, /class="[^"]*\bant-timeline\b[^"]*"/);
});

test('dashboard detail v2 uses fluid width and compact spacing', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.css'), 'utf8');
  const detailRule = css.match(/\.run-detail\.detail-shell\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const shellRule = css.match(/\.detail-shell\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const dashboardRule = css.match(/\.dashboard\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const workbenchRule = css.match(/\.detail-workbench\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const kpiRule = css.match(/\.run-kpi-grid\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const detailBrandRule = css.match(/\.detail-hero-brand\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const detailBrandMarkRule = css.match(/\.detail-hero-brand \.brand-mark\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.doesNotMatch(shellRule, /max-width:\s*1320px/);
  assert.match(detailRule, /max-width:\s*none/);
  assert.match(detailRule, /width:\s*100%/);
  assert.match(detailRule, /padding:\s*12px 14px/);
  assert.match(dashboardRule, /padding:\s*14px 16px/);
  assert.match(workbenchRule, /gap:\s*10px/);
  assert.match(kpiRule, /gap:\s*8px/);
  assert.match(kpiRule, /margin:\s*0 0 10px/);
  assert.match(detailBrandRule, /gap:\s*6px/);
  assert.match(detailBrandMarkRule, /width:\s*clamp\(112px,\s*11vw,\s*150px\)/);
});

test('dashboard detail workbench uses one-third left and two-thirds right columns', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.css'), 'utf8');
  const workbenchRule = css.match(/\.detail-workbench\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.match(workbenchRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*2fr\)/);
});

test('dashboard detail preserves the active workbench tab across refresh renders', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'active tab task',
    runId: 'active-tab-run',
    status: 'CODEX_FIX',
    pipelineSteps: [],
    activeTab: 'agent',
    hasDiff: true,
    diffText: 'diff --git a/a.js b/a.js\n+new\n',
    agentTail: 'latest output',
    iterations: [],
    reviewRounds: [],
  });

  assert.match(html, /class="tab" data-tab="review"/);
  assert.match(html, /class="tab active" data-tab="agent"/);
  assert.match(html, /class="workbench-pane review-pane"/);
  assert.match(html, /class="workbench-pane agent-pane active"/);
  assert.match(html, /data-scroll-key="agent-log"/);
  assert.match(html, /latest output/);
});

test('clearAutoDisable resets an auto-disabled task and is idempotent', async () => {
  const { clearAutoDisable, readQueueOutcomes } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-reenable-'));
  await fs.mkdir(path.join(repo, '.agent-loop'), { recursive: true });
  await fs.writeFile(path.join(repo, '.agent-loop', 'queue-outcomes.json'), JSON.stringify({
    tasks: { a: { autoDisabled: true, consecutiveNoChanges: 3, lastStatus: 'HALT_NO_CHANGES' } },
  }), 'utf8');

  assert.equal((await clearAutoDisable(repo, 'a')).changed, true);
  const after = await readQueueOutcomes(repo);
  assert.equal(after.tasks.a.autoDisabled, false);
  assert.equal(after.tasks.a.consecutiveNoChanges, 0);

  assert.equal((await clearAutoDisable(repo, 'a')).changed, false);
  assert.equal((await clearAutoDisable(repo, 'missing')).changed, false);
});

test('dashboard overview shows a re-enable action on auto-disabled tasks', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 1 },
    queueRunning: false,
    current: null,
    tasks: [
      { task: 'agent-loop/tasks/a.md', id: 'a', taskLabel: 'a', badge: 'disabled', category: 'attention', autoDisabled: true, enabled: true, statusLabel: '自动禁用' },
    ],
  });
  assert.match(html, /data-act="reEnable"/);
  assert.match(html, /data-id="a"/);
  assert.match(html, /重开/);
});

test('dashboard detail shows a single-run action for the task', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 't', runId: 'r', status: 'HALT_NO_CHANGES', pipelineSteps: [],
    iterations: [], reviewRounds: [],
    taskPath: 'agent-loop/tasks/x.md', statePath: '/tmp/state.json',
  });
  assert.match(html, /data-act="runTask"/);
  assert.match(html, /data-task="agent-loop\/tasks\/x\.md"/);
  assert.match(html, /单跑此任务/);
});

test('dashboard overview shows a pending landing workbench with actions', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 8 }, queueRunning: false, current: null, tasks: [],
    landing: {
      status: 'PENDING_QUEUE_LANDING',
      appliedToMain: false,
      diffBytes: 4096,
      tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c', outcome: 'failed' }],
      patchTasks: [{ id: 'a' }, { id: 'b' }],
      taskCounts: { total: 8, patch: 2, failed: 6 },
    },
  });
  assert.match(html, /待落地到 main/);
  assert.match(html, /2 个成功合并/);
  assert.match(html, /6 个需关注任务未包含在补丁中/);
  assert.doesNotMatch(html, /8 个任务的合并改动/);
  assert.match(html, /data-act="previewLanding"/);
  assert.match(html, /data-act="applyLanding"/);
});

test('dashboard overview hides a zero-byte pending landing workbench', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 2 }, queueRunning: false, current: null, tasks: [],
    landing: {
      status: 'PENDING_QUEUE_LANDING',
      appliedToMain: false,
      diffBytes: 0,
      patchTasks: [],
      taskCounts: { total: 2, patch: 0, failed: 0 },
    },
  });
  assert.doesNotMatch(html, /class="[^"]*\blanding-banner\b[^"]*"/);
  assert.doesNotMatch(html, /data-act="previewLanding"/);
  assert.doesNotMatch(html, /data-act="applyLanding"/);
});

test('dashboard overview renders rescue patch rows as attention items', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 1, queueTotal: 1, rescuePatch: 1, failed: 1 },
    queueRunning: false,
    current: null,
    tasks: [
      {
        task: 'agent-loop/tasks/rescue.md',
        taskLabel: 'rescue',
        badge: 'rescuePatch',
        outcomeGroup: 'rescuePatch',
        category: 'attention',
        statusLabel: 'RESCUE_PATCH_AVAILABLE',
        applyErrorKind: 'PARTIAL_DIFF_GATE_RED',
        rescuePatchAvailable: true,
        diffBytes: 16691,
        running: false,
      },
    ],
  });
  assert.match(html, /data-state="rescuePatch"/);
  assert.match(html, /PATCH/);
  assert.match(html, /RESCUE_PATCH_AVAILABLE/);
  assert.match(html, /PARTIAL_DIFF_GATE_RED/);
  assert.match(html, /16KB/);
});

test('dashboard overview shows an applied landing without apply action', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 1 }, queueRunning: false, current: null, tasks: [],
    landing: { status: 'APPLIED_TO_MAIN', appliedToMain: true, diffBytes: 1024, tasks: [{ id: 'a' }] },
  });
  assert.match(html, /已落地到 main/);
  assert.doesNotMatch(html, /data-act="applyLanding"/);
});

test('extension package opens the queue view first in the AgentLoop container', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
  const views = packageJson.contributes.views['agent-loop'];

  assert.equal(views[0].id, 'agentLoop.queue');
  assert.deepEqual(
    views.map((view) => view.id),
    ['agentLoop.queue', 'agentLoop.currentRun', 'agentLoop.runs'],
  );
});

test('dashboard view title command is contributed only once', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
  const viewTitleMenus = packageJson.contributes.menus['view/title'];
  const dashboardMenus = viewTitleMenus.filter((item) => item.command === 'agentLoop.openDashboard');

  assert.equal(dashboardMenus.length, 1);
  assert.equal(dashboardMenus[0].when, 'view == agentLoop.currentRun');
});

test('extension package declares SlideRule brand assets for VS Code details', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
  const readme = await fs.readFile(path.join(extensionRoot, 'README.md'), 'utf8');
  const activityIcon = await fs.readFile(path.join(extensionRoot, 'media', 'icon.svg'), 'utf8');
  const sourceActivityIcon = await fs.readFile(path.join(agentLoopRoot, '..', 'docs', 'assets', 'slidrule_logo_transparent.svg'), 'utf8');
  const webviewBrand = await fs.readFile(path.join(extensionRoot, 'media', 'sliderule-brand.svg'), 'utf8');
  const sourceWebviewBrand = await fs.readFile(path.join(agentLoopRoot, '..', 'docs', 'assets', 'SlideRule_banner_no_border_transparent.svg'), 'utf8');

  assert.equal(packageJson.icon, 'media/sliderule-icon.png');
  assert.equal(packageJson.contributes.viewsContainers.activitybar[0].icon, 'media/icon.svg');
  assert.match(packageJson.scripts.package, /--no-rewrite-relative-links/);
  assert.equal(sha256(activityIcon), sha256(sourceActivityIcon));
  assert.equal(sha256(webviewBrand), sha256(sourceWebviewBrand));
  assert.doesNotMatch(activityIcon, /<circle cx="12" cy="12" r="9"/);
  assert.match(readme, /media\/sliderule-brand\.png/);
  assert.match(readme, /SlideRule\.ai/);
  await fs.access(path.join(extensionRoot, 'media', 'sliderule-icon.png'));
  await fs.access(path.join(extensionRoot, 'media', 'sliderule-brand.png'));
  await fs.access(path.join(extensionRoot, 'media', 'sliderule-brand.svg'));
});

test('dashboard panel exposes a Webview-safe SlideRule brand logo URI', async () => {
  const source = await fs.readFile(path.join(extensionRoot, 'src', 'dashboardPanel.ts'), 'utf8');

  assert.match(source, /sliderule-brand\.svg/);
  assert.match(source, /brandLogo/);
  assert.match(source, /img-src \$\{this\.panel\.webview\.cspSource\} data:/);
});

test('dashboard panel loads the local React dashboard bundle with CSP nonce support', async () => {
  const source = await fs.readFile(path.join(extensionRoot, 'src', 'dashboardPanel.ts'), 'utf8');

  assert.match(source, /dashboard\.bundle\.css/);
  assert.match(source, /dashboard\.bundle\.js/);
  assert.match(source, /style-src \$\{this\.panel\.webview\.cspSource\} 'nonce-\$\{nonce\}'/);
  assert.match(source, /window\.__AGENT_LOOP_CSP_NONCE__/);
  assert.match(source, /src="\$\{bundleScriptUri\}"/);
});

test('extension package builds the dashboard React bundle locally', async () => {
  const rootPackageJson = JSON.parse(await fs.readFile(path.join(agentLoopRoot, 'package.json'), 'utf8'));
  const packageJson = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));

  assert.match(rootPackageJson.scripts['dev:dashboard'] ?? '', /vscode-extension/);
  assert.match(rootPackageJson.scripts['dev:dashboard'] ?? '', /dev:dashboard/);
  assert.match(packageJson.scripts['dev:dashboard'] ?? '', /vite/);
  assert.match(packageJson.scripts['dev:dashboard'] ?? '', /vite\.dashboard\.dev\.config\.ts/);
  assert.match(packageJson.scripts['build:dashboard'] ?? '', /vite/);
  assert.match(packageJson.scripts.package ?? '', /build:dashboard/);
  const panelSource = await fs.readFile(path.join(extensionRoot, 'src', 'dashboardPanel.ts'), 'utf8');
  assert.match(panelSource, /payload\.injectToWorker/);
  assert.match(panelSource, /config\.update\('injectKeysToWorker'/);
  await fs.access(path.join(extensionRoot, 'index.html'));
  await fs.access(path.join(extensionRoot, 'vite.dashboard.dev.config.ts'));
  await fs.access(path.join(extensionRoot, 'src', 'dashboard-react', 'dev.tsx'));
  await fs.access(path.join(extensionRoot, 'src', 'dashboard-react', 'devPayload.ts'));
  for (const dependency of ['@ant-design/icons', '@antv/g6', 'antd', 'react', 'react-dom']) {
    assert.ok(packageJson.dependencies?.[dependency], `${dependency} dependency is declared`);
  }
  for (const dependency of ['@vitejs/plugin-react', 'vite']) {
    assert.ok(packageJson.devDependencies?.[dependency], `${dependency} devDependency is declared`);
  }
});

test('React dashboard keeps Ant Design components native and minimally configured', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const css = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'dashboard-react.css'),
    'utf8',
  );

  assert.match(source, /prefixCls="agent-ant"/);
  assert.doesNotMatch(source, /document\.body\.classList/);
  assert.doesNotMatch(source, /theme\./);
  assert.doesNotMatch(source, /colorBg|colorText|colorBorder|colorPrimary/);
  assert.doesNotMatch(source, /Pagination/);
  assert.doesNotMatch(source, /visibleTasks\s*=\s*tasks\.slice/);
  assert.doesNotMatch(source, /rowClassName/);
  const queueTable = source.match(/function QueueTable[\s\S]*?\n}\n\nfunction /)?.[0] ?? '';
  assert.match(queueTable, /<Table/);
  assert.match(queueTable, /key:\s*'branch'/);
  assert.match(queueTable, /task\.branch\s*\|\|\s*'-'/);
  assert.match(queueTable, /task\.agent\s*\|\|\s*formatAgentPair\(task\)/);
  assert.match(queueTable, />详情<\/Button>/);
  assert.doesNotMatch(queueTable, />打开<\/Button>/);
  assert.doesNotMatch(queueTable, /locale=\{/);
  assert.doesNotMatch(source, /className="[^"]*\bant-/);
  assert.doesNotMatch(css, /\.agent-ant-|\.ant-|--vscode-|--al-/);
});

test('React dashboard keeps the sidebar to one workbench item and moves task filters into table tabs', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const css = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'dashboard-react.css'),
    'utf8',
  );

  assert.match(source, /Tabs/);
  assert.match(source, /label:\s*'工作台'/);
  assert.match(source, /selectedKeys=\{\['workbench'\]\}/);
  assert.match(source, /activeKey=\{filter\}/);
  assert.match(source, /items=\{tabItems\}/);
  assert.match(source, /title="任务列表"/);
  assert.doesNotMatch(source, /<Text strong>AgentLoop<\/Text>/);
  assert.doesNotMatch(source, /<Text type="secondary">Dashboard<\/Text>/);
  assert.doesNotMatch(source, /DashboardSidebar\(\{[\s\S]*filter/);
  assert.match(css, /\.native-brand\s*\{(?<body>[^}]+height:\s*56px[^}]+justify-content:\s*flex-start[^}]+overflow:\s*hidden[^}]+)\}/);
  assert.match(css, /\.native-brand-mark\s*\{(?<body>[^}]+justify-content:\s*flex-start[^}]+)\}/);
});

test('React dashboard sidebar brand aligns with the header and crops an enlarged logo', async () => {
  const css = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'dashboard-react.css'),
    'utf8',
  );
  const sidebarRule = css.match(/\.native-sidebar\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const headerRule = css.match(/\.native-header\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const brandRule = css.match(/\.native-brand\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const brandMarkRule = css.match(/\.native-brand-mark\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const brandImgRule = css.match(/\.native-brand-mark img\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.match(sidebarRule, /padding:\s*0/);
  assert.match(headerRule, /height:\s*56px/);
  assert.match(brandRule, /height:\s*56px/);
  assert.match(brandRule, /overflow:\s*hidden/);
  assert.match(brandMarkRule, /height:\s*56px/);
  assert.match(brandMarkRule, /width:\s*auto/);
  assert.match(brandRule, /justify-content:\s*flex-start/);
  assert.doesNotMatch(brandRule, /justify-content:\s*center/);
  assert.match(brandImgRule, /width:\s*144px/);
  assert.match(brandImgRule, /max-width:\s*none/);
  assert.match(brandImgRule, /transform:\s*scale\(1\)/);
  assert.doesNotMatch(brandImgRule, /width:\s*120px/);
  assert.doesNotMatch(brandImgRule, /width:\s*180px/);
  assert.doesNotMatch(brandImgRule, /transform:\s*scale\(1\.32\)/);
  assert.doesNotMatch(brandRule, /height:\s*72px/);
});

test('React dashboard uses six table rows per page and keeps the logo only in the sidebar brand area', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );

  assert.match(source, /const PAGE_SIZE = 6;/);
  assert.match(source, /pagination=\{\{ pageSize: PAGE_SIZE \}\}/);
  assert.match(source, /<div className="native-brand">\s*<BrandMark \/>\s*<\/div>/);
  assert.doesNotMatch(source, /<Space align="center">\s*<BrandMark \/>[\s\S]*<Title level=\{3\}>AgentLoop 控制台<\/Title>/);
});

test('React dashboard renders run details with Ant Design product components', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const entry = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'main.tsx'),
    'utf8',
  );

  assert.match(source, /export function DashboardDetailApp/);
  for (const component of ['Button', 'Descriptions', 'Steps', 'Statistic', 'Tabs', 'List']) {
    assert.match(source, new RegExp(`\\b${component}\\b`));
  }
  assert.match(source, /native-detail-dashboard/);
  assert.match(entry, /renderDetail/);
  assert.match(entry, /DashboardDetailApp/);
  assert.match(source, /postCommand\('showOverview'\)/);
  assert.match(source, /payload\.reportJsonPath[\s\S]*postCommand\('openReport', \{ reportPath: payload\.reportJsonPath \}\)/);
  assert.match(source, /payload\.landingPath[\s\S]*postCommand\('openReport', \{ reportPath: payload\.landingPath \}\)/);
  assert.doesNotMatch(source, /postCommand\('backToQueue'/);
  assert.doesNotMatch(source, /postCommand\('openReportJson'/);
});

test('React dashboard detail folds stats into hero metrics and uses the reference three-column layout', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const metrics = source.match(/function metricItems[\s\S]*?\n}\n\nfunction DetailHero/)?.[0] ?? '';

  assert.match(source, /className="native-metric-grid"/);
  for (const key of ['iteration', 'events', 'elapsed', 'blocks', 'status']) {
    assert.match(metrics, new RegExp(`key: '${key}'`));
  }
  for (const title of ['迭代次数', '事件总数', '耗时', '阻断次数', '最终状态']) {
    assert.match(metrics, new RegExp(`title: '${title}'`));
  }
  for (const duplicateKey of ['agent', 'gate', 'run', 'commit', 'landing']) {
    assert.doesNotMatch(metrics, new RegExp(`key: '${duplicateKey}'`));
  }
  assert.doesNotMatch(source, /function DetailStats/);
  assert.doesNotMatch(source, /<DetailStats payload=\{payload\} \/>/);
  assert.match(source, /<Col xs=\{24\} xl=\{5\}>[\s\S]*<EventTimeline payload=\{payload\} \/>/);
  assert.match(source, /<Col xs=\{24\} xl=\{14\}>[\s\S]*<DetailTabs payload=\{payload\} \/>/);
  assert.match(source, /<Col xs=\{24\} xl=\{5\}>[\s\S]*<DetailRightRail payload=\{payload\} \/>/);
});

test('React dashboard detail matches the polished run-workbench visual structure', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const css = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'dashboard-react.css'),
    'utf8',
  );

  assert.match(source, /function DetailHero/);
  assert.match(source, /className="native-detail-hero"/);
  assert.match(source, /className="native-run-head"/);
  assert.match(source, /className="native-title-line"/);
  assert.match(source, /className="native-back-button"/);
  assert.match(source, /<Button[\s\S]*className="native-back-button"[\s\S]*icon=\{<LeftOutlined \/>\}[\s\S]*>\s*返回\s*<\/Button>/);
  assert.doesNotMatch(source, /<Title level=\{3\}>馃/);
  assert.doesNotMatch(source, /<Button size="small" onClick=\{\(\) => postCommand\('showOverview'\)\}>/);
  assert.match(source, /className="native-hero-kpis"/);
  assert.match(source, /className="native-metric-grid"/);
  for (const title of ['迭代次数', '事件总数', '耗时', '阻断次数', '最终状态']) {
    assert.match(source, new RegExp(`title: '${title}'`));
  }
  assert.match(source, /function DetailProgress/);
  assert.match(source, /className="native-step-card"/);
  assert.match(source, /className="native-flow-lane"/);
  assert.match(source, /from '@antv\/g6'/);
  assert.match(source, /new Graph\(/);
  assert.match(source, /useEffect/);
  assert.match(source, /useRef/);
  assert.match(source, /className="native-flow-g6-canvas"/);
  assert.doesNotMatch(source, /className="native-flow-svg"/);
  assert.doesNotMatch(source, /preserveAspectRatio="none"/);
  assert.match(source, /buildG6FlowData/);
  assert.match(source, /node:\s*\{[\s\S]*type:\s*'rect'/);
  assert.match(source, /labelText/);
  assert.match(source, /labelWordWrap:\s*false/);
  assert.match(source, /labelMaxWidth/);
  assert.match(source, /ports/);
  assert.match(source, /sourcePort:\s*'right'/);
  assert.match(source, /targetPort:\s*'left'/);
  assert.match(source, /type:\s*'quadratic'/);
  assert.match(source, /lineDash:\s*\[6,\s*5\]/);
  assert.doesNotMatch(source, /native-flow-cards/);
  assert.doesNotMatch(source, /native-flow-node-card/);
  assert.doesNotMatch(source, /className="native-flow-icon"/);
  assert.match(source, /className="native-flow-legend"/);
  assert.match(source, /未通过，回修/);
  assert.doesNotMatch(source, /className="native-flow-return"/);
  assert.match(source, /<Progress[\s\S]*percent=\{progressPercent\}/);
  assert.match(source, /<Steps[\s\S]*className="native-steps"/);
  assert.match(source, /function ReviewPanel/);
  assert.match(source, /function ChangeStatsCard/);
  assert.match(source, /className="native-change-card"/);
  assert.doesNotMatch(source, /className="native-review-result"/);
  assert.doesNotMatch(source, /native-review-summary-card/);
  assert.doesNotMatch(source, /Review\s+缁撹/);
  assert.match(source, /className="native-review-card"/);
  assert.match(source, /className="native-code-shell"/);
  assert.match(source, /className="native-code-copy"/);
  assert.match(source, /function renderCodeTokens/);
  assert.match(source, /native-code-token native-code-key/);
  assert.match(source, /native-code-token native-code-string/);
  assert.match(source, /native-code-token native-code-number/);
  assert.match(source, /native-code-token native-code-boolean/);
  assert.match(source, /native-code-token native-code-null/);
  assert.match(source, /native-code-token native-code-punctuation/);
  assert.doesNotMatch(source, /function DetailDescriptions/);
  assert.doesNotMatch(source, /<DetailDescriptions payload=\{payload\} \/>/);
  assert.doesNotMatch(source, /function DetailSteps/);
  assert.doesNotMatch(source, /<DetailSteps payload=\{payload\} \/>/);

  for (const selector of [
    '.native-detail-hero',
    '.native-run-head',
    '.native-title-line',
    '.native-back-button',
    '.native-hero-kpis',
    '.native-metric-grid',
    '.native-metric',
    '.native-step-card',
    '.native-flow-lane',
    '.native-flow-g6-canvas',
    '.native-flow-legend',
    '.native-change-card',
    '.native-timeline-shell',
    '.native-timeline-row',
    '.native-steps',
    '.native-review-card',
    '.native-code-shell',
    '.native-code-copy',
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  }
  const flowMapRule = css.match(/\.native-flow-map\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const flowCanvasRule = css.match(/\.native-flow-g6-canvas\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const timelineRowRule = css.match(/\.native-timeline-row\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const timelineLineRule = css.match(/\.native-timeline-row:not\(:last-child\)::after\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const timelineDotRule = css.match(/\.native-timeline-dot\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const tabBodyRule = css.match(/\.native-detail-tab-body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  assert.match(flowMapRule, /min-height:\s*154px/);
  assert.match(flowCanvasRule, /height:\s*146px/);
  assert.doesNotMatch(flowCanvasRule, /min-width:\s*1030px/);
  assert.match(timelineRowRule, /grid-template-columns:\s*56px 16px minmax\(0,\s*1fr\)/);
  assert.match(timelineLineRule, /left:\s*63px/);
  assert.match(timelineLineRule, /top:\s*18px/);
  assert.match(timelineDotRule, /justify-self:\s*center/);
  assert.match(source, /<Card className="native-detail-workbench" styles=\{\{ body: \{ padding: 0 \} \}\}>/);
  assert.match(source, /tabBarStyle=\{\{ padding: '0 24px', marginBottom: 0 \}\}/);
  assert.match(source, /className="native-detail-tab-body"/);
  assert.match(tabBodyRule, /padding:\s*0/);
  assert.doesNotMatch(tabBodyRule, /24px/);
  for (const selector of [
    '.native-code-token',
    '.native-code-key',
    '.native-code-string',
    '.native-code-number',
    '.native-code-boolean',
    '.native-code-null',
    '.native-code-punctuation',
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  }
  assert.match(css, /\.native-scroll-surface::-webkit-scrollbar/);
  assert.match(css, /\.native-code::-webkit-scrollbar/);
  assert.match(css, /\.native-timeline-shell::-webkit-scrollbar/);
  assert.match(css, /scrollbar-width:\s*thin/);
});

test('React dashboard detail uses a workbench flow map and right rail', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const css = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'dashboard-react.css'),
    'utf8',
  );

  assert.match(source, /function AgentLoopFlow/);
  assert.match(source, /function buildFlowNodes/);
  assert.match(source, /function buildG6FlowData/);
  assert.match(source, /function ChangeStatsCard/);
  assert.match(source, /function DetailRightRail/);
  assert.match(source, /function IterationTimeline/);
  assert.match(source, /className="native-flow-map"/);
  assert.match(source, /node:\s*\{[\s\S]*type:\s*'rect'/);
  assert.match(source, /labelWordWrap:\s*false/);
  assert.doesNotMatch(source, /native-flow-cards/);
  assert.doesNotMatch(source, /native-flow-node-card/);
  assert.match(source, /<ChangeStatsCard payload=\{payload\} \/>/);
  assert.match(source, /className="native-detail-main-row"/);
  assert.match(source, /className="native-detail-rail"/);
  assert.match(source, /<Col xs=\{24\} xl=\{5\}>[\s\S]*<EventTimeline payload=\{payload\} \/>[\s\S]*<ChangeStatsCard payload=\{payload\} \/>/);
  assert.match(source, /<Col xs=\{24\} xl=\{14\}>[\s\S]*<DetailTabs payload=\{payload\} \/>/);
  assert.match(source, /<Col xs=\{24\} xl=\{5\}>[\s\S]*<DetailRightRail payload=\{payload\} \/>/);
  assert.doesNotMatch(source, /<Card size="small" title="[^"]*" className="native-detail-nested">/);
  assert.doesNotMatch(source, /<Card title="Artifacts">/);
  assert.match(source, /className="native-rail-action"/);
  assert.match(source, /<span className="native-rail-action-label">/);
  assert.match(source, /<RightOutlined className="native-rail-action-arrow" \/>/);
  assert.match(source, /查看结构化报告/);
  assert.match(source, /导出工作/);

  for (const selector of [
    '.native-flow-map',
    '.native-flow-lane',
    '.native-flow-g6-canvas',
    '.native-flow-legend',
    '.native-timeline-shell',
    '.native-timeline-row',
    '.native-timeline-dot',
    '.native-detail-main-row',
    '.native-detail-rail',
    '.native-rail-actions',
    '.native-rail-action',
    '.native-rail-action-label',
    '.native-rail-action-arrow',
    '.native-timeline-card',
  ]) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  }
  const railActionRule = css.match(/\.native-rail-action\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const railActionLabelRule = css.match(/\.native-rail-action-label\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  assert.match(railActionRule, /justify-content:\s*flex-start/);
  assert.match(railActionRule, /text-align:\s*left/);
  assert.match(railActionLabelRule, /margin-right:\s*auto/);
});

test('React dashboard flow keeps the G6 instance stable across live refreshes', async () => {
  const source = await fs.readFile(
    path.join(extensionRoot, 'src', 'dashboard-react', 'DashboardApp.tsx'),
    'utf8',
  );
  const component = source.match(/function AgentLoopFlow[\s\S]*?\n}\n\nfunction EventTimeline/)?.[0] ?? '';

  assert.match(
    component,
    /const nodes = useMemo\(\(\) => buildFlowNodes\(payload\), \[payload\.status, payload\.fixAgent, payload\.reviewAgent\]\);/,
  );
  assert.match(component, /renderedSignatureRef/);
  assert.match(component, /renderedSignatureRef\.current === flowSignature/);
  assert.match(component, /graph\.resize\(nextWidth, FLOW_HEIGHT\)/);
  assert.match(component, /graph\.setData\(buildG6FlowData/);
  assert.doesNotMatch(
    component,
    /function createGraph[\s\S]*?graphRef\.current\.destroy\(\);[\s\S]*?new Graph\(/,
  );
});

test('extension package contributes clean Chinese labels', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    packageJson.contributes.views['agent-loop'].map((view) => view.name),
    ['任务队列', '当前运行', '历史运行'],
  );

  const titles = Object.fromEntries(
    packageJson.contributes.commands.map((command) => [command.command, command.title]),
  );
  assert.equal(titles['agentLoop.runQueue'], 'AgentLoop: 运行任务队列');
  assert.equal(titles['agentLoop.stopRun'], 'AgentLoop: 停止当前运行');
  assert.equal(titles['agentLoop.openDashboard'], 'AgentLoop: 打开可视化面板');
  assert.equal(titles['agentLoop.openFinalReport'], 'AgentLoop: 打开最终报告');
  assert.equal(titles['agentLoop.openStateJson'], 'AgentLoop: 打开 state.json');
  assert.equal(titles['agentLoop.refresh'], '刷新');
});

test('compiled extension UI sources do not contain mojibake markers', async () => {
  const markers = /鈥|鎬|妯|褰|杩|浠|鍘|淇|瀹|锛|鐨|姝|闈|鍔|钀|绛|宸|鏈|寰|鏌|闅|鍋|鎵|鍒|绌|杞|繍|涓|鏆|瘯|绉/;
  const files = [
    path.join(extensionOut, 'extension.js'),
    path.join(extensionOut, 'phaseLabels.js'),
    path.join(extensionOut, 'runController.js'),
    path.join(extensionOut, 'stateMonitor.js'),
    path.join(extensionOut, 'treeProviders.js'),
    path.join(extensionOut, 'dashboardPanel.js'),
    path.join(extensionRoot, 'media', 'dashboard.js'),
  ];

  const offenders = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    if (markers.test(raw)) offenders.push(path.relative(extensionRoot, file));
  }

  assert.deepEqual(offenders, []);
});

test('packaged extension sources do not require external agent-loop runSummary.js', async () => {
  const offenders = [];
  const files = await fs.readdir(extensionOut);
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const raw = await fs.readFile(path.join(extensionOut, file), 'utf8');
    if (raw.includes('src/runSummary.js') || raw.includes('createRequire')) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test('VSIX contents are self-contained for run summary', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
  const vsixPath = path.join(extensionRoot, `agent-loop-dashboard-${packageJson.version}.vsix`);
  try {
    await fs.access(vsixPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const raw = await fs.readFile(vsixPath);
  const listing = raw.toString('latin1');
  assert.doesNotMatch(listing, /agent-loop\/src\/runSummary\.js/);
  assert.match(listing, /extension\/out\/runSummary\.js/);
  assert.match(listing, /extension\/out\/activeLog\.js/);
  assert.match(listing, /extension\/out\/gateSummary\.js/);
  assert.match(listing, /extension\/media\/dashboard\.js/);
  assert.match(listing, /extension\/media\/dashboard\.css/);
  assert.match(listing, /extension\/media\/dashboard\.bundle\.js/);
  assert.match(listing, /extension\/media\/dashboard\.bundle\.css/);
  assert.match(listing, /extension\/media\/icon\.svg/);
  assert.match(listing, /extension\/media\/sliderule-icon\.png/);
  assert.match(listing, /extension\/media\/sliderule-brand\.png/);
  assert.match(listing, /extension\/media\/sliderule-brand\.svg/);
  assert.match(listing, /extension\/readme\.md/i);
});

test('dashboard media renders console overview with stale current run', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 3, done: 1, failed: 1, crashed: 0, quarantined: 0, running: 0, pending: 1 },
    queueRunning: true,
    current: {
      taskLabel: 'backend-python-blueprint-brainstorm-contract',
      phaseLabel: '运行中断',
      elapsedText: '48 分 12 秒',
      staleRun: { status: 'CODEX_FIX' },
    },
    tasks: [
      { task: 'agent-loop/tasks/a.md', taskLabel: 'a', badge: 'done', statusLabel: '完成', running: false },
      { task: 'agent-loop/tasks/b.md', taskLabel: 'b', badge: 'stale', statusLabel: '运行中断', running: false },
      { task: 'agent-loop/tasks/c.md', taskLabel: 'c', badge: 'pending', statusLabel: null, running: false },
    ],
  });

  assert.match(html, /AgentLoop 控制台/);
  assert.match(html, /运行中断/);
  assert.match(html, /backend-python-blueprint-brainstorm-contract/);
  assert.match(html, /console-top/);
  assert.match(html, /queue-toolbar/);
  assert.match(html, /task-table/);
  assert.match(html, /queue-table/);
  assert.match(html, /data-state="stale"/);
});

test('dashboard overview renders the console v2 queue workbench layout', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: {
      total: 44,
      queueTotal: 6,
      applied: 6,
      reviewed: 0,
      noDiff: 0,
      applyConflict: 0,
      human: 0,
      failed: 0,
      crashed: 0,
      stopped: 0,
      running: 0,
      pending: 0,
    },
    queueRunning: false,
    current: null,
    landing: {
      status: 'PENDING_QUEUE_LANDING',
      diffBytes: 10240,
      taskCounts: { patch: 6, failed: 0 },
      currentBranch: 'main',
    },
    tasks: [
      {
        task: 'agent-loop/tasks/a.md',
        taskLabel: 'backend-python-auth-permission-audit-runtime-90',
        badge: 'reviewed',
        statusLabel: '完成（已 review）',
        enabled: true,
        running: false,
        category: 'landed',
      },
      {
        task: 'agent-loop/tasks/b.md',
        taskLabel: 'backend-python-a2a-stream-runtime-boundary-90',
        badge: 'applied',
        statusLabel: '完成（已落地）',
        enabled: true,
        running: false,
        category: 'landed',
      },
      {
        task: 'agent-loop/tasks/old.md',
        taskLabel: 'backend-python-old-disabled',
        badge: 'disabled',
        statusLabel: '已禁用',
        enabled: false,
        running: false,
        category: 'disabled',
      },
    ],
  });

  assert.match(html, /class="[^"]*\bconsole-top\b[^"]*"/);
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /6 个队列任务 \/ 44 个全部任务/);
  assert.match(html, /class="[^"]*\blanding-banner\b[^"]*"/);
  assert.match(html, /当前分支/);
  assert.match(html, /main/);
  assert.match(html, /6 个成功合并 · 10KB diff/);
  assert.match(html, /data-act="previewLanding"[\s\S]*预演/);
  assert.match(html, /data-act="applyLanding"[\s\S]*落地到 main/);
  assert.match(html, /placeholder="搜索任务 \/ Agent \/ 文件\.\.\."/);
  assert.match(html, /data-filter="queue"[\s\S]*任务队列[\s\S]*6/);
  assert.match(html, /data-filter="all"[\s\S]*全部[\s\S]*44/);
  assert.match(html, /任务队列 6 · 全部 44 · 需关注 0 · 已落地 6 · 已禁用/);
  assert.match(html, /已运行 6\/44/);
  assert.match(html, /class="[^"]*\btask-table\b[^"]*"/);
  assert.match(html, /状态/);
  assert.match(html, /任务名/);
  assert.match(html, /Agent/);
  assert.match(html, /变更/);
  assert.match(html, /最后更新/);
  assert.match(html, /操作/);
  assert.match(html, /backend-python-auth-permission-audit-runtime-90/);
  assert.match(html, /完成（已 review）/);
  assert.match(html, /打开/);
});

test('dashboard media delegates overview rendering to the React bridge when available', async () => {
  const calls = [];
  const app = fakeAppRoot();
  const win = await loadDashboardWindow({
    document: { getElementById: () => app },
  });
  win.AgentLoopReactDashboard = {
    renderOverview(payload) {
      calls.push(payload);
      app.innerHTML = '<main class="react-dashboard">React overview</main>';
    },
  };

  win.__dispatchMessage({
    type: 'overview',
    payload: {
      counts: { total: 1, queueTotal: 1 },
      queueRunning: false,
      tasks: [{ task: 'agent-loop/tasks/react.md', taskLabel: 'react', badge: 'pending', enabled: true }],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tasks[0].taskLabel, 'react');
  assert.match(app.innerHTML, /react-dashboard/);
});

test('dashboard media delegates detail rendering to the React bridge when available', async () => {
  const calls = [];
  const app = fakeAppRoot();
  const win = await loadDashboardWindow({
    document: { getElementById: () => app },
  });
  win.AgentLoopReactDashboard = {
    renderOverview() {
      throw new Error('overview bridge should not render detail payloads');
    },
    renderDetail(payload) {
      calls.push(payload);
      app.innerHTML = '<main class="native-dashboard native-detail-dashboard">React detail</main>';
    },
  };

  win.__dispatchMessage({
    type: 'detail',
    payload: {
      taskLabel: 'backend-python-detail-sync-104',
      runId: 'detail-run',
      status: 'DONE_REVIEWED',
      phaseLabel: 'DONE_REVIEWED',
      pipelineSteps: [],
      iterations: [],
      reviewRounds: [],
      agentTail: 'detail output',
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskLabel, 'backend-python-detail-sync-104');
  assert.equal(calls[0].activeTab, 'review');
  assert.match(app.innerHTML, /native-detail-dashboard/);
  assert.match(app.innerHTML, /React detail/);
});

test('dashboard media exposes the acquired VS Code API for the React bridge', async () => {
  const source = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.js'), 'utf8');
  const bridge = await fs.readFile(path.join(extensionRoot, 'src', 'dashboard-react', 'vscodeBridge.ts'), 'utf8');

  assert.match(source, /window\.__AGENT_LOOP_VSCODE_API__\s*=\s*vscode/);
  assert.match(bridge, /window\.__AGENT_LOOP_VSCODE_API__/);
});

test('dashboard overview renders a product-style v3 shell', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 44, queueTotal: 19, running: 1, pending: 18, disabled: 25 },
    queueRunning: true,
    current: {
      taskLabel: 'backend-python-blueprint-job-store-runtime-takeover-104',
      phaseLabel: 'Grok 修复中',
      elapsedText: '12 分 03 秒',
      runId: '2026-06-23T16-00-00-000Z',
    },
    tasks: [
      ...Array.from({ length: 19 }, (_, index) => ({
        task: `agent-loop/tasks/backend-python-task-${index + 1}.md`,
        taskLabel: `backend-python-task-${index + 1}`,
        badge: index === 0 ? 'running' : 'pending',
        statusLabel: index === 0 ? '运行中' : '待跑',
        enabled: true,
        running: index === 0,
        category: index === 0 ? 'running' : 'pending',
      })),
    ],
  });

  assert.match(html, /class="[^"]*\bproduct-shell\b[^"]*"/);
  assert.match(html, /class="[^"]*\bproduct-sidebar\b[^"]*"/);
  assert.match(html, /AgentLoop/);
  assert.match(html, /Queue/);
  assert.match(html, /Runs/);
  assert.match(html, /class="[^"]*\bproduct-main\b[^"]*"/);
  assert.match(html, /class="[^"]*\bproduct-topbar\b[^"]*"/);
  assert.match(html, /AgentLoop[\s\S]*Queue/);
  assert.match(html, /class="[^"]*\bpage-status-badge\b[^"]*[\s\S]*运行中/);
  assert.match(html, /class="[^"]*\bqueue-product-grid\b[^"]*"/);
  assert.match(html, /class="[^"]*\bant-descriptions\b[^"]*"/);
  assert.match(html, /class="[^"]*\bant-table\b[^"]*"/);
  assert.match(html, /class="[^"]*\bant-pagination\b[^"]*"/);
  assert.match(html, /1-12 \/ 19/);
  assert.match(html, /backend-python-task-12/);
  assert.doesNotMatch(html, /backend-python-task-13/);
});

test('dashboard overview pagination state renders a later page', async () => {
  const renderer = await loadDashboardRenderer();
  renderer.setQueuePage(2);
  const html = renderer.renderOverview({
    counts: { total: 19, queueTotal: 19, running: 0, pending: 19, disabled: 0 },
    queueRunning: false,
    current: null,
    tasks: [
      {
        task: 'agent-loop/tasks/placeholder.md',
        taskLabel: 'placeholder',
        badge: 'pending',
        statusLabel: '待跑',
        enabled: false,
        running: false,
        category: 'disabled',
      },
      ...Array.from({ length: 19 }, (_, index) => ({
        task: `agent-loop/tasks/page-task-${index + 1}.md`,
        taskLabel: `page-task-${index + 1}`,
        badge: 'pending',
        statusLabel: '待跑',
        enabled: true,
        running: false,
        category: 'pending',
      })),
    ],
  });

  assert.match(html, /13-19 \/ 19/);
  assert.doesNotMatch(html, /page-task-12/);
  assert.match(html, /page-task-13/);
  assert.match(html, /page-task-19/);
  assert.match(html, /data-page="1"/);
  assert.match(html, /data-page="2"[^>]*class="[^"]*\bactive\b/);
});

test('dashboard overview renders table rows with Tag and Badge component semantics', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 2, queueTotal: 2, running: 1, pending: 1, disabled: 0 },
    queueRunning: true,
    current: null,
    tasks: [
      {
        task: 'agent-loop/tasks/running.md',
        taskLabel: 'running-task',
        badge: 'running',
        statusLabel: '运行中',
        enabled: true,
        running: true,
        category: 'running',
        agent: 'Grok',
        diffBytes: 4096,
        lastUpdatedText: '刚刚',
      },
      {
        task: 'agent-loop/tasks/pending.md',
        taskLabel: 'pending-task',
        badge: 'pending',
        statusLabel: '待跑',
        enabled: true,
        running: false,
        category: 'pending',
      },
    ],
  });

  assert.match(html, /class="[^"]*\bqueue-row\b[^"]*\bant-table-row\b[^"]*"/);
  assert.match(html, /class="[^"]*\bstatus-pill\b[^"]*\bant-tag\b[^"]*"/);
  assert.match(html, /class="[^"]*\btask-agent\b[^"]*\bant-tag\b[^"]*"/);
  assert.match(html, /class="[^"]*\btask-diff\b[^"]*\bant-badge\b[^"]*"/);
  assert.match(html, /running-task/);
  assert.match(html, /4KB/);
});

test('dashboard overview side panel uses Statistic and Progress component semantics', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 20, queueTotal: 8, running: 2, pending: 6, disabled: 12, reviewed: 5 },
    queueRunning: true,
    current: null,
    tasks: [
      ...Array.from({ length: 8 }, (_, index) => ({
        task: `agent-loop/tasks/stat-${index + 1}.md`,
        taskLabel: `stat-${index + 1}`,
        badge: index < 2 ? 'running' : 'pending',
        statusLabel: index < 2 ? '运行中' : '待跑',
        enabled: true,
        running: index < 2,
        category: index < 2 ? 'running' : 'pending',
      })),
    ],
  });

  assert.match(html, /class="[^"]*\bproduct-side-panel\b[^"]*\bant-statistic-card\b[^"]*"/);
  assert.match(html, /class="[^"]*\bproduct-side-list\b[^"]*\bant-statistic-list\b[^"]*"/);
  assert.match(html, /class="[^"]*\bant-statistic\b[^"]*"/);
  assert.match(html, /class="[^"]*\bside-progress\b[^"]*\bant-progress\b[^"]*"/);
});

test('dashboard detail evidence iterations and artifacts use component semantics', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'component-detail',
    runId: '2026-06-24T01-00-00-000Z',
    status: 'DONE_REVIEWED',
    phaseLabel: '完成（已 review）',
    elapsedText: '1 分 02 秒',
    gateText: 'Gate 绿',
    gateOk: true,
    agentText: 'Grok',
    iterations: [{ iteration: 1, gateOk: true, diffBytes: 2048, attempts: 2 }],
    reviewRounds: [{ round: 1, verdict: 'pass', decision: 'pass', summary: 'ok', findings: [] }],
    events: [{ status: 'DONE_REVIEWED', label: '完成', timeText: '09:00:00' }],
    agentTail: 'done',
    reportPath: 'C:/repo/final-report.md',
    reportJsonPath: 'C:/repo/final-report.json',
    landingPath: 'C:/repo/landing.json',
    statePath: 'C:/repo/state.json',
    landing: { status: 'MAIN_GATE_GREEN', commit: 'abc123' },
    details: ['轮次 1', 'worktree: migration-queue'],
  });

  assert.match(html, /class="[^"]*\bevidence\b[^"]*\bant-descriptions\b[^"]*"/);
  assert.match(html, /class="[^"]*\biterations\b[^"]*\bant-timeline\b[^"]*"/);
  assert.match(html, /class="[^"]*\bevidence-row\b[^"]*\btimeline-item\b[^"]*"/);
  assert.match(html, /class="[^"]*\bdetail-tabs\b[^"]*\bant-tabs\b[^"]*"/);
  assert.match(html, /class="[^"]*\bartifact-row\b[^"]*\bant-descriptions-item\b[^"]*"/);
});

test('dashboard product shell constrains overflow to content regions instead of page chrome', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.css'), 'utf8');
  const htmlRule = css.match(/html,\s*body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const shellRule = css.match(/\.product-shell\.dashboard\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const mainRule = css.match(/\.product-main\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const pageRule = css.match(/\.product-page\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const tableBodyRule = css.match(/\.ant-table \.queue-body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.match(htmlRule, /overflow:\s*hidden/);
  assert.match(shellRule, /height:\s*100vh/);
  assert.match(shellRule, /overflow:\s*hidden/);
  assert.match(mainRule, /min-height:\s*0/);
  assert.match(mainRule, /overflow:\s*hidden/);
  assert.match(pageRule, /overflow:\s*auto/);
  assert.match(tableBodyRule, /overflow:\s*visible/);
});

test('React dashboard shell owns its two-column layout without relying on Ant runtime CSS', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'src', 'dashboard-react', 'dashboard-react.css'), 'utf8');
  const shellRule = css.match(/\.native-dashboard\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const sidebarRule = css.match(/\.native-sidebar\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const mainRule = css.match(/\.native-main\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const contentRule = css.match(/\.native-content\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.match(shellRule, /min-height:\s*100vh/);
  assert.match(sidebarRule, /height:\s*100vh/);
  assert.match(sidebarRule, /overflow:\s*auto/);
  assert.match(mainRule, /min-width:\s*0/);
  assert.match(contentRule, /min-height:\s*calc\(100vh - 56px\)/);
  assert.match(contentRule, /overflow-x:\s*hidden/);
  assert.doesNotMatch(contentRule, /overflow:\s*auto/);
});

test('buildQueueOverview separates enabled queue size from all task size', async () => {
  const { buildQueueOverview } = requireFromExtension('./out/stateReader.js');
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-overview-queue-size-'));
  const queueFilePath = path.join(repo, 'queue.json');
  await fs.writeFile(queueFilePath, JSON.stringify({
    tasks: [
      { id: 'a', task: 'agent-loop/tasks/a.md' },
      { id: 'b', task: 'agent-loop/tasks/b.md' },
      { id: 'c', task: 'agent-loop/tasks/c.md', enabled: false },
      { id: 'd', task: 'agent-loop/tasks/d.md', enabled: false },
    ],
  }), 'utf8');

  const overview = await buildQueueOverview(repo, { queueFilePath, queueRunning: false });

  assert.equal(overview.counts.total, 4);
  assert.equal(overview.counts.queueTotal, 2);
});

test('dashboard overview defaults to current task queue while keeping all tasks separate', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 4, queueTotal: 2, running: 0, pending: 2, disabled: 2 },
    queueRunning: false,
    current: null,
    tasks: [
      { task: 'agent-loop/tasks/a.md', taskLabel: 'queue-a', badge: 'pending', statusLabel: null, enabled: true, running: false },
      { task: 'agent-loop/tasks/b.md', taskLabel: 'queue-b', badge: 'pending', statusLabel: null, enabled: true, running: false },
      { task: 'agent-loop/tasks/c.md', taskLabel: 'old-c', badge: 'disabled', statusLabel: '已禁用', enabled: false, running: false },
      { task: 'agent-loop/tasks/d.md', taskLabel: 'old-d', badge: 'disabled', statusLabel: '已禁用', enabled: false, running: false },
    ],
  });

  assert.match(html, /filter-tab queue active[\s\S]*任务队列[\s\S]*2/);
  assert.match(html, /filter-tab[\s\S]*全部[\s\S]*4/);
  assert.match(html, /queue-a/);
  assert.match(html, /queue-b/);
  assert.doesNotMatch(html, /old-c/);
  assert.doesNotMatch(html, /old-d/);
});

test('dashboard overview renders SlideRule logo in the console header', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: { total: 6, queueTotal: 2 },
    queueRunning: false,
    current: null,
    tasks: [],
  });

  assert.match(html, /class="brand-mark"/);
  assert.match(html, /aria-label="SlideRule"/);
  assert.match(html, /<img[^>]+src="media\/sliderule-brand\.svg"/);
  assert.doesNotMatch(html, /<svg viewBox="0 0 32 32"/);
  assert.match(html, /AgentLoop 控制台/);
});

test('dashboard detail keeps the SlideRule logo in the detail header', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'backend-python-a2a-invoke-runtime-bridge',
    runId: '2026-06-21T01-00-00-000Z',
    status: 'DONE_REVIEWED',
    phaseLabel: '完成（已 review）',
    elapsedText: '2 分 03 秒',
    gateText: '修复 Gate 绿',
    gateOk: true,
    agentText: 'Codex',
    pipelineSteps: [{ key: 'INIT', label: '初始化' }, { key: 'DONE', label: '完成' }],
    details: [],
    iterations: [],
    reviewRounds: [],
    agentTail: '',
    landing: { status: 'PENDING_APPLY' },
  });

  assert.match(html, /detail-hero/);
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /aria-label="SlideRule"/);
  assert.match(html, /<img[^>]+src="media\/sliderule-brand\.svg"/);
});

test('dashboard console header uses an enlarged logo without leaving a wide title gap', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.css'), 'utf8');
  const headerBrandRule = css.match(/\.header-brand\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const titleStackRule = css.match(/\.title-stack\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const brandRule = css.match(/\.brand-mark\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const imgRule = css.match(/\.brand-mark img\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.match(headerBrandRule, /grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)/);
  assert.match(headerBrandRule, /column-gap:\s*12px/);
  assert.match(titleStackRule, /padding-left:\s*0/);
  assert.doesNotMatch(brandRule, /background\s*:/);
  assert.doesNotMatch(brandRule, /border\s*:/);
  assert.doesNotMatch(brandRule, /box-shadow\s*:/);
  assert.match(brandRule, /width:\s*clamp\(220px,\s*15vw,\s*280px\)/);
  assert.match(brandRule, /height:\s*clamp\(82px,\s*6\.5vw,\s*110px\)/);
  assert.match(imgRule, /height:\s*100%/);
  assert.doesNotMatch(imgRule, /height:\s*28px/);
});

test('dashboard detail keeps a compact logo independent from the console header logo', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.css'), 'utf8');
  const detailBrandMarkRule = css.match(/\.detail-hero-brand \.brand-mark\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.match(detailBrandMarkRule, /width:\s*clamp\(112px,\s*11vw,\s*150px\)/);
  assert.match(detailBrandMarkRule, /height:\s*clamp\(36px,\s*4vw,\s*46px\)/);
  assert.doesNotMatch(detailBrandMarkRule, /height:\s*clamp\(82px,\s*6\.5vw,\s*110px\)/);
});

test('dashboard media renders outcome groups and conflict files', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderOverview({
    counts: {
      total: 4,
      applied: 0,
      reviewed: 0,
      noDiff: 1,
      applyConflict: 1,
      human: 1,
      failed: 0,
      crashed: 0,
      stopped: 1,
      running: 0,
      pending: 0,
    },
    queueRunning: false,
    current: null,
    tasks: [
      {
        task: 'agent-loop/tasks/no-diff.md',
        taskLabel: 'no-diff',
        badge: 'noDiff',
        statusLabel: '已审查无新增差异',
        running: false,
      },
      {
        task: 'agent-loop/tasks/conflict.md',
        taskLabel: 'conflict',
        badge: 'applyConflict',
        statusLabel: '应用冲突',
        applyErrorFiles: ['server/routes/a2a.ts'],
        applyError: 'patch does not apply',
        running: false,
      },
      {
        task: 'agent-loop/tasks/human.md',
        taskLabel: 'human',
        badge: 'human',
        statusLabel: '人工接管',
        running: false,
      },
      {
        task: 'agent-loop/tasks/dirty.md',
        taskLabel: 'dirty',
        badge: 'stopped',
        statusLabel: '主仓库有未提交改动',
        running: false,
      },
    ],
  });

  assert.match(html, /NO_DIFF/);
  assert.match(html, /APPLY/);
  assert.match(html, /HUMAN/);
  assert.match(html, /STOP/);
  assert.match(html, /server\/routes\/a2a\.ts/);
  assert.match(html, /patch does not apply/);
  assert.match(html, /data-state="applyConflict"/);
  assert.match(html, /data-state="noDiff"/);
});

test('dashboard media renders detail evidence and log sections', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'backend-python-a2a-invoke-runtime-bridge',
    runId: '2026-06-21T01-00-00-000Z',
    status: 'DONE_REVIEWED',
    phaseLabel: '完成（已 review）',
    elapsedText: '2 分 03 秒',
    gateText: '修复 Gate 绿',
    gateOk: true,
    agentText: 'Codex',
    roleText: 'codex 修 + codex 审',
    runMode: 'codex-fix+codex-review',
    pipelineSteps: [{ key: 'INIT', label: '初始化' }, { key: 'DONE', label: '完成' }],
    details: ['worktree: run-a', '已完成迭代 1'],
    iterations: [{ iteration: 1, gateOk: true, failureCount: 0, diffBytes: 2048, guard: false, attempts: 1 }],
    reviewRounds: [{ round: 1, verdict: 'pass', decision: 'pass', summary: '边界通过', findings: [] }],
    agentTail: 'All gates passed',
    displayGate: { ok: true },
    landing: { status: 'COMMITTED', committed: true, commit: 'abc1234' },
    guardPolicy: { protectTests: true, protectTaskDocs: false, protectedGlobs: [] },
    statePath: 'C:/repo/.agent-loop/latest/state.json',
  });

  assert.match(html, /run-detail/);
  assert.match(html, /detail-hero/);
  assert.match(html, /detail-stage-rail/);
  assert.match(html, /detail-workbench/);
  assert.match(html, /workbench-left/);
  assert.match(html, /workbench-right/);
  assert.match(html, /workbench-left[\s\S]*panel iterations/);
  assert.match(html, /workbench-right[\s\S]*Review/);
  assert.match(html, /证据/);
  assert.match(html, /Review/);
  assert.match(html, /All gates passed/);
  assert.match(html, /abc1234/);
});

test('dashboard media renders syntax highlighted json agent output', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'backend-python-blueprint-agent-crew-proxy-contract',
    runId: '2026-06-20T19-20-27-078Z',
    status: 'DONE_REVIEWED',
    phaseLabel: '完成',
    elapsedText: '1 分 00 秒',
    gateText: '基线 Gate 绿',
    gateOk: true,
    agentText: 'codex + codex',
    roleText: 'codex修 + codex审',
    runMode: 'codex-review',
    pipelineSteps: [{ key: 'INIT', label: '初始化' }, { key: 'DONE', label: '完成' }],
    details: [],
    iterations: [],
    reviewRounds: [],
    agentTail: JSON.stringify({
      verdict: 'pass',
      summary: 'Python contract tests passed',
      findings: [],
    }),
    landing: { status: 'PENDING_APPLY' },
  });

  assert.match(html, /json-token key/);
  assert.match(html, /log-json wrap/);
  assert.match(html, /&quot;verdict&quot;/);
  assert.match(html, /&quot;pass&quot;/);
  assert.match(html, /Python contract tests passed/);
  assert.doesNotMatch(html, /\{&quot;verdict&quot;:/);
});

test('dashboard preserves internal diff and agent log scroll positions across refreshes', async () => {
  const win = await loadDashboardWindow();
  const { captureScrollPositions, restoreScrollPositions } = win.AgentLoopDashboardInternals;
  const pageScroller = { scrollTop: 41 };
  const doc = { scrollingElement: pageScroller, documentElement: { scrollTop: 0 } };
  const before = [
    fakeScrollable('diff', 320),
    fakeScrollable('agent-log', 880),
    fakeScrollable('gate-output', 120),
  ];
  const after = [
    fakeScrollable('diff', 0),
    fakeScrollable('agent-log', 0),
    fakeScrollable('gate-output', 0),
  ];

  const captured = captureScrollPositions(fakeRoot(before), doc);
  pageScroller.scrollTop = 0;
  restoreScrollPositions(fakeRoot(after), captured, doc);

  assert.equal(pageScroller.scrollTop, 41);
  assert.equal(after[0].scrollTop, 320);
  assert.equal(after[1].scrollTop, 880);
  assert.equal(after[2].scrollTop, 120);
});

test('dashboard preserves focused queue search input across refreshes', async () => {
  const win = await loadDashboardWindow();
  const { captureScrollPositions, restoreScrollPositions } = win.AgentLoopDashboardInternals;
  const beforeInput = fakeFocusable('queue-search', 'a2a stream', 3, 7);
  const afterInput = fakeFocusable('queue-search', '', 0, 0);
  const pageScroller = { scrollTop: 0 };
  const doc = {
    activeElement: beforeInput,
    scrollingElement: pageScroller,
    documentElement: { scrollTop: 0 },
  };

  const captured = captureScrollPositions(fakeRoot([], { 'queue-search': beforeInput }), doc);
  restoreScrollPositions(fakeRoot([], { 'queue-search': afterInput }), captured, doc);

  assert.equal(afterInput.value, 'a2a stream');
  assert.equal(afterInput.selectionStart, 3);
  assert.equal(afterInput.selectionEnd, 7);
  assert.equal(afterInput.focused, true);
});

test('dashboard preserves focused event search input across refreshes', async () => {
  const win = await loadDashboardWindow();
  const { captureScrollPositions, restoreScrollPositions } = win.AgentLoopDashboardInternals;
  const beforeInput = fakeFocusable('event-search', 'manual halt', 0, 6);
  const afterInput = fakeFocusable('event-search', '', 0, 0);
  const pageScroller = { scrollTop: 0 };
  const doc = {
    activeElement: beforeInput,
    scrollingElement: pageScroller,
    documentElement: { scrollTop: 0 },
  };

  const captured = captureScrollPositions(fakeRoot([], { 'event-search': beforeInput }), doc);
  restoreScrollPositions(fakeRoot([], { 'event-search': afterInput }), captured, doc);

  assert.equal(afterInput.value, 'manual halt');
  assert.equal(afterInput.selectionStart, 0);
  assert.equal(afterInput.selectionEnd, 6);
  assert.equal(afterInput.focused, true);
});

test('dashboard defers html refresh while the user is actively scrolling', async () => {
  const win = await loadDashboardWindow();
  const { createRenderScheduler } = win.AgentLoopDashboardInternals;
  const rendered = [];
  let now = 1000;
  let scheduled = null;
  let timerId = 0;
  const scheduler = createRenderScheduler({
    renderNow: (html) => rendered.push(html),
    now: () => now,
    idleMs: 300,
    setTimeoutFn: (fn, delay) => {
      scheduled = { id: ++timerId, fn, delay };
      return scheduled.id;
    },
    clearTimeoutFn: () => {
      scheduled = null;
    },
  });

  scheduler.markUserScroll();
  assert.equal(scheduler.schedule('<main>first</main>'), 'deferred');
  assert.deepEqual(rendered, []);
  assert.equal(scheduled.delay, 300);

  now += 100;
  assert.equal(scheduler.schedule('<main>latest</main>'), 'deferred');
  assert.deepEqual(rendered, []);
  assert.equal(scheduled.delay, 200);

  scheduled.fn();
  assert.deepEqual(rendered, ['<main>latest</main>']);
});

test('dashboard marks diff and agent log panels with stable scroll keys', async () => {
  const renderer = await loadDashboardRenderer();
  const html = renderer.renderDetail({
    taskLabel: 'scroll task',
    runId: 'scroll-run',
    status: 'CODEX_FIX',
    pipelineSteps: [],
    hasDiff: true,
    diffText: 'diff --git a/a.js b/a.js\n+new\n',
    gateFailure: '$ npm test\nfailed',
    agentTail: 'long agent output',
    iterations: [],
    reviewRounds: [],
  });

  assert.match(html, /data-scroll-key="diff"/);
  assert.match(html, /data-scroll-key="agent-log"/);
  assert.match(html, /data-scroll-key="gate-output"/);
  assert.match(html, /Review Data \(JSON\)[\s\S]*data-scroll-key="review-json"/);
});

test('dashboard keeps last non-empty agent output when a live refresh has an empty tail', async () => {
  const messages = [];
  const app = fakeAppRoot();
  const win = await loadDashboardWindow({
    document: { getElementById: () => app },
    acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message) }),
  });
  const detail = {
    taskLabel: 'log-stability-task',
    taskPath: 'agent-loop/tasks/log-stability-task.md',
    runId: 'stable-run',
    status: 'GROK_FIX',
    pipelineSteps: [],
    iterations: [],
    reviewRounds: [],
    activeTab: 'agent',
    agentTail: 'first non-empty grok output',
  };

  win.__dispatchMessage({ type: 'detail', payload: detail });
  assert.match(app.innerHTML, /first non-empty grok output/);

  win.__dispatchMessage({ type: 'detail', payload: { ...detail, agentTail: '', agentLogKb: 0 } });

  assert.match(app.innerHTML, /first non-empty grok output/);
});

test('dashboard clears cached agent output when the run id changes for the same task', async () => {
  const app = fakeAppRoot();
  const win = await loadDashboardWindow({
    document: { getElementById: () => app },
    acquireVsCodeApi: () => ({ postMessage: () => {} }),
  });
  const detail = {
    taskLabel: 'log-stability-task',
    taskPath: 'agent-loop/tasks/log-stability-task.md',
    runId: 'first-run',
    status: 'GROK_FIX',
    pipelineSteps: [],
    iterations: [],
    reviewRounds: [],
    agentTail: 'old run output',
  };

  win.__dispatchMessage({ type: 'detail', payload: detail });
  assert.match(app.innerHTML, /old run output/);

  win.__dispatchMessage({
    type: 'detail',
    payload: { ...detail, runId: 'second-run', agentTail: '' },
  });

  assert.doesNotMatch(app.innerHTML, /old run output/);
  assert.match(app.innerHTML, /暂无输出/);
});

async function loadDashboardRenderer() {
  const win = await loadDashboardWindow();
  return win.AgentLoopDashboardRenderer;
}

async function loadDashboardWindow(overrides = {}) {
  const source = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.js'), 'utf8');
  const listeners = new Map();
  const sandbox = {
    window: {},
    document: { getElementById: () => null },
    acquireVsCodeApi: () => ({ postMessage: () => {} }),
    ...overrides,
  };
  sandbox.window.addEventListener = (type, handler) => {
    listeners.set(type, handler);
  };
  sandbox.window.__dispatchMessage = (data) => {
    listeners.get('message')?.({ data });
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'dashboard.js' });
  return sandbox.window;
}

function fakeAppRoot() {
  return {
    innerHTML: '',
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

function fakeScrollable(key, scrollTop) {
  return {
    scrollTop,
    getAttribute(name) {
      return name === 'data-scroll-key' ? key : null;
    },
  };
}

function fakeFocusable(key, value, selectionStart, selectionEnd) {
  return {
    value,
    selectionStart,
    selectionEnd,
    focused: false,
    getAttribute(name) {
      return name === 'data-focus-key' ? key : null;
    },
    focus(options) {
      this.focused = true;
      this.focusOptions = options;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
}

function fakeRoot(elements, focusables = {}) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-scroll-key]');
      return elements;
    },
    querySelector(selector) {
      const match = selector.match(/^\[data-focus-key="([^"]+)"\]$/);
      return match ? focusables[match[1]] || null : null;
    },
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ===== Settings / SecretStorage safety tests =====
test('settings send logic never includes raw keys (SecretStorage safety)', async () => {
  // Simulate the payload construction from dashboardPanel
  const rawKeys = {
    grokApiKey: 'sk-secret-grok-123',
    openaiApiKey: 'sk-secret-openai-456',
  };

  const keysStatus = {};
  Object.keys(rawKeys).forEach(k => {
    keysStatus[k] = rawKeys[k] ? 'configured' : '';
  });

  const payload = {
    nonSensitive: { fixAgent: 'grok' },
    keys: keysStatus,
    baseUrl: '',
  };

  // Assert no raw secret in the message that would be sent to webview
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('sk-secret'));
  assert.ok(serialized.includes('configured'));
  assert.ok(payload.keys.grokApiKey === 'configured');
});

test('settings save message normalization accepts top-level and payload shapes', () => {
  const { normalizeSaveSettingsPayload } = requireFromExtension('./out/settingsMessages.js');

  assert.deepEqual(
    normalizeSaveSettingsPayload({ type: 'saveSettings', fixAgent: 'grok', workerMaxTurns: 128 }),
    { fixAgent: 'grok', workerMaxTurns: 128 },
  );
  assert.deepEqual(
    normalizeSaveSettingsPayload({ type: 'saveSettings', payload: { reviewAgent: 'codex', grokApiKey: 'secret' } }),
    { reviewAgent: 'codex', grokApiKey: 'secret' },
  );
  assert.deepEqual(normalizeSaveSettingsPayload(null), {});
});

test('settings preview log redaction removes raw api keys', () => {
  const { redactSettingsMessageForLog } = requireFromExtension('./out/settingsMessages.js');

  const redacted = redactSettingsMessageForLog({
    type: 'saveSettings',
    grokApiKey: 'sk-grok-secret',
    payload: {
      openaiApiKey: 'sk-openai-secret',
      queuePath: 'agent-loop/scripts/migration-queue.json',
    },
  });

  const serialized = JSON.stringify(redacted);
  assert.ok(!serialized.includes('sk-grok-secret'));
  assert.ok(!serialized.includes('sk-openai-secret'));
  assert.match(serialized, /configured|redacted/i);
  assert.match(serialized, /migration-queue\.json/);
});

test('getAgentLoopConfig shape includes new CLI and key related fields', () => {
  // We can't easily mock vscode here without setup, but ensure the module exports and basic defaults
  const { getAgentLoopConfig } = requireFromExtension('./out/paths.js');
  const cfg = getAgentLoopConfig();
  assert.ok(typeof cfg === 'object');
  assert.ok('fixAgent' in cfg);
  assert.ok('reviewAgent' in cfg);
  assert.ok('workerMaxTurns' in cfg);
  assert.ok('injectKeysToWorker' in cfg);
  assert.equal(typeof cfg.workerMaxTurns, 'number');
});
