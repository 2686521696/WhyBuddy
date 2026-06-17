import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuns, formatRunList } from '../src/listRuns.js';
import { runProcess } from '../src/runProcess.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('listRuns summarizes run directories with agent activity flags', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-'));
  await writeRun(root, '2026-06-16T17-00-02-496Z', {
    runId: '2026-06-16T17-00-02-496Z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/migrate-sliderule-gap-ask.md' },
    iterations: [],
    grokFix: null,
    codexReview: null,
  });
  await writeRun(root, '2026-06-16T18-00-00-000Z', {
    runId: '2026-06-16T18-00-00-000Z',
    status: 'DONE_FIXED',
    options: { task: 'task.md' },
    iterations: [{ iteration: 1 }],
    grokFix: { exitCode: 0, timedOut: false },
    codexReview: null,
  });

  const runs = await listRuns({ cwd: root });

  assert.deepEqual(runs.map((run) => run.runId), [
    '2026-06-16T18-00-00-000Z',
    '2026-06-16T17-00-02-496Z',
  ]);
  assert.equal(runs[0].runMode, 'grok-fix');
  assert.equal(runs[0].grokRan, true);
  assert.equal(runs[0].codexRan, false);
  assert.equal(runs[1].runMode, 'gate-only');
  assert.equal(runs[1].runTimeLocal, '2026-06-17 01:00:02 (Asia/Shanghai)');
});

test('listRuns filters by run mode and status before applying limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-filter-'));
  await writeRun(root, '2026-06-16T17-00-02-496Z', {
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/gate-only.md' },
    iterations: [],
  });
  await writeRun(root, '2026-06-16T18-00-00-000Z', {
    status: 'DONE_FIXED',
    options: { task: 'tasks/fixed.md' },
    iterations: [{ iteration: 1, grokFix: { exitCode: 0, timedOut: false } }],
  });
  await writeRun(root, '2026-06-16T19-00-00-000Z', {
    status: 'HALT_HUMAN',
    options: { task: 'tasks/halt.md' },
    iterations: [{ iteration: 1, grokFix: { exitCode: 1, timedOut: false } }],
    grokFix: { exitCode: 1, timedOut: false },
  });

  const runs = await listRuns({
    cwd: root,
    limit: 1,
    modes: ['grok-fix'],
    statuses: ['DONE_FIXED'],
  });

  assert.deepEqual(runs.map((run) => run.runId), ['2026-06-16T18-00-00-000Z']);
  assert.equal(runs[0].task, 'tasks/fixed.md');
});

test('listRuns sorts parseable run IDs by timestamp before string fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-sort-'));
  await writeRun(root, 'manual-run-z', {
    runId: 'manual-run-z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/manual.md' },
    iterations: [],
  });
  await writeRun(root, '2026-06-16T18-00-00-000Z', {
    status: 'DONE_FIXED',
    options: { task: 'tasks/fixed.md' },
    iterations: [{ iteration: 1, grokFix: { exitCode: 0, timedOut: false } }],
  });

  const runs = await listRuns({ cwd: root });

  assert.deepEqual(runs.map((run) => run.runId), [
    '2026-06-16T18-00-00-000Z',
    'manual-run-z',
  ]);
});

test('formatRunList prints a compact Chinese table', () => {
  const output = formatRunList([
    {
      runId: '2026-06-16T17-00-02-496Z',
      status: 'DONE_GATE_ONLY',
      task: 'tasks/migrate-sliderule-gap-ask.md',
      runMode: 'gate-only',
      grokRan: false,
      codexRan: false,
      iterations: 0,
      runTimeLocal: '2026-06-17 01:00:02 (Asia/Shanghai)',
      runTimeUtc: '2026-06-16 17:00:02 (UTC)',
    },
  ], { lang: 'zh-CN' });

  assert.match(output, /本地时间/);
  assert.match(output, /模式/);
  assert.match(output, /2026-06-17 01:00:02 \(Asia\/Shanghai\)/);
  assert.match(output, /gate-only/);
  assert.match(output, /否/);
});

test('list-runs CLI reads .agent-loop/runs from cwd', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-cli-'));
  await writeRun(root, '2026-06-16T17-00-02-496Z', {
    runId: '2026-06-16T17-00-02-496Z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/migrate-sliderule-gap-ask.md' },
    iterations: [],
    grokFix: null,
    codexReview: null,
  });

  const result = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'list-runs.js'),
    '--cwd',
    root,
    '--lang',
    'zh-CN',
  ], {
    cwd: agentLoopRoot,
    timeoutMs: 30000,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /DONE_GATE_ONLY/);
  assert.match(result.stdout, /gate-only/);
  assert.match(result.stdout, /2026-06-17 01:00:02 \(Asia\/Shanghai\)/);
});

test('listRuns filters by task path before applying limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-task-'));
  await writeRun(root, '2026-06-16T17-00-02-496Z', {
    runId: '2026-06-16T17-00-02-496Z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'agent-loop/tasks/migrate-sliderule-gap-ask.md' },
    iterations: [],
  });
  await writeRun(root, '2026-06-16T18-00-00-000Z', {
    runId: '2026-06-16T18-00-00-000Z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/baseline-index-audit.md' },
    iterations: [],
  });

  const runs = await listRuns({
    cwd: root,
    tasks: ['migrate-sliderule-gap-ask.md'],
    limit: 1,
  });

  assert.deepEqual(runs.map((run) => run.runId), ['2026-06-16T17-00-02-496Z']);
  assert.equal(runs[0].task, 'agent-loop/tasks/migrate-sliderule-gap-ask.md');
});

test('listRuns reads configured agent roles and new review fields from state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-agents-'));
  await writeRun(root, '2026-06-16T20-00-00-000Z', {
    runId: '2026-06-16T20-00-00-000Z',
    status: 'DONE_REVIEWED',
    options: {
      task: 'tasks/reviewed.md',
      fixAgent: 'grok',
      reviewAgent: 'grok',
      skipReview: false,
    },
    iterations: [{ iteration: 1, grokFix: { exitCode: 0, timedOut: false } }],
    agentFix: { exitCode: 0, timedOut: false },
    grokFix: { exitCode: 0, timedOut: false },
    agentReview: { exitCode: 0, timedOut: false },
    grokReview: { exitCode: 0, timedOut: false },
    codexReview: null,
  });

  const runs = await listRuns({ cwd: root });

  assert.equal(runs[0].fixAgent, 'grok');
  assert.equal(runs[0].reviewAgent, 'grok');
  assert.equal(runs[0].runMode, 'grok-fix+grok-review');
  assert.equal(runs[0].grokRan, true);
  assert.equal(runs[0].codexRan, false);
  assert.equal(runs[0].reviewAgentRan, true);
});

test('listRuns honors an explicit display time zone', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-tz-'));
  await writeRun(root, '2026-06-16T11-08-17-334Z', {
    runId: '2026-06-16T11-08-17-334Z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/a.md' },
    iterations: [],
  });

  const runs = await listRuns({
    cwd: root,
    timeZone: 'America/New_York',
  });

  assert.equal(runs[0].runTimeLocal, '2026-06-16 07:08:17 (America/New_York)');
});

test('list-runs CLI prints filtered JSON summaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-runs-json-'));
  await writeRun(root, '2026-06-16T17-00-02-496Z', {
    runId: '2026-06-16T17-00-02-496Z',
    status: 'DONE_GATE_ONLY',
    options: { task: 'tasks/gate-only.md' },
    iterations: [],
  });
  await writeRun(root, '2026-06-16T18-00-00-000Z', {
    runId: '2026-06-16T18-00-00-000Z',
    status: 'DONE_FIXED',
    options: { task: 'tasks/fixed.md' },
    iterations: [{ iteration: 1, grokFix: { exitCode: 0, timedOut: false } }],
  });

  const result = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'list-runs.js'),
    '--cwd',
    root,
    '--json',
    '--mode',
    'grok-fix',
    '--status',
    'DONE_FIXED',
  ], {
    cwd: agentLoopRoot,
    timeoutMs: 30000,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const runs = JSON.parse(result.stdout);
  assert.deepEqual(runs, [
    {
      runId: '2026-06-16T18-00-00-000Z',
      runTimeLocal: '2026-06-17 02:00:00 (Asia/Shanghai)',
      runTimeUtc: '2026-06-16 18:00:00 (UTC)',
      status: 'DONE_FIXED',
      task: 'tasks/fixed.md',
      fixAgent: 'grok',
      reviewAgent: 'codex',
      runMode: 'grok-fix',
      grokRan: true,
      codexRan: false,
      reviewAgentRan: false,
      iterations: 1,
    },
  ]);
});

async function writeRun(root, runId, state) {
  const runDir = path.join(root, '.agent-loop', 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
