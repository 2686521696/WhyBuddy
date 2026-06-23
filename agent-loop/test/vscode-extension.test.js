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
    tasks: [
      { id: 'a', task: 'agent-loop/tasks/a.md' },
      { id: 'b', task: 'agent-loop/tasks/b.md' },
      { id: 'c', task: 'agent-loop/tasks/c.md', enabled: false },
    ],
  }), 'utf8');
  await fs.mkdir(path.join(repo, '.agent-loop'), { recursive: true });
  await fs.writeFile(path.join(repo, '.agent-loop', 'queue-outcomes.json'), JSON.stringify({
    tasks: {
      a: { lastOutcome: 'done', lastStatus: 'DONE_REVIEWED', lastRunId: 'run-a' },
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
  const brandIndex = html.indexOf('class="brand-mark"');
  const backIndex = html.indexOf('class="btn ghost detail-back"');
  const breadcrumbIndex = html.indexOf('class="detail-breadcrumbs"');
  const actionIndex = html.indexOf('class="detail-actions"');

  assert.ok(brandIndex >= 0, 'detail header keeps the logo');
  assert.ok(backIndex > brandIndex, 'queue back button sits to the right of the logo');
  assert.ok(breadcrumbIndex > backIndex, 'breadcrumbs sit after the queue back button');
  assert.ok(actionIndex > 0, 'detail actions exist in the header');
  assert.match(html, /class="btn ghost detail-back"[^>]*data-act="showOverview"[\s\S]*<span class="btn-icon">/);
  assert.match(html, /class="detail-actions"[\s\S]*data-act="runTask"/);
  assert.match(html, /class="detail-actions"[\s\S]*data-act="openReport"[\s\S]*final-report\.md/);
  assert.match(html, /class="detail-actions"[\s\S]*data-act="openReport"[\s\S]*final-report\.json/);
  assert.match(html, /class="detail-actions"[\s\S]*data-act="openReport"[\s\S]*landing\.json/);
  assert.match(html, /class="detail-actions"[\s\S]*data-act="openState"[\s\S]*state\.json/);
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
  assert.match(html, /class="detail-breadcrumbs"/);
  assert.match(html, /Projects/);
  assert.match(html, /SlideRule/);
  assert.match(html, /Runs/);
  assert.match(html, /backend-python-runtime-evidence-reconcile-89/);
  assert.match(html, /class="detail-meta"/);
  assert.match(html, /Repo:/);
  assert.match(html, /Commit:/);
  assert.match(html, /class="detail-stage-rail"/);
  assert.match(html, /Init/);
  assert.match(html, /Workspace/);
  assert.match(html, /testGate/);
  assert.match(html, /class="run-kpi-grid"/);
  assert.match(html, /状态/);
  assert.match(html, /DONE_REVIEWED/);
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

test('dashboard console header keeps the SlideRule logo transparent and line-height sized', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.css'), 'utf8');
  const brandRule = css.match(/\.brand-mark\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
  const imgRule = css.match(/\.brand-mark img\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

  assert.doesNotMatch(brandRule, /background\s*:/);
  assert.doesNotMatch(brandRule, /border\s*:/);
  assert.doesNotMatch(brandRule, /box-shadow\s*:/);
  assert.match(brandRule, /height:\s*clamp\(42px,\s*5vw,\s*54px\)/);
  assert.match(imgRule, /height:\s*100%/);
  assert.doesNotMatch(imgRule, /height:\s*28px/);
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

async function loadDashboardRenderer() {
  const win = await loadDashboardWindow();
  return win.AgentLoopDashboardRenderer;
}

async function loadDashboardWindow() {
  const source = await fs.readFile(path.join(extensionRoot, 'media', 'dashboard.js'), 'utf8');
  const sandbox = {
    window: {},
    document: { getElementById: () => null },
    acquireVsCodeApi: () => ({ postMessage: () => {} }),
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'dashboard.js' });
  return sandbox.window;
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
