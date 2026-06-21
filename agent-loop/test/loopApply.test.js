import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLatestDiffToMain,
  buildLoopApplyPlan,
  findLatestDiffPatch,
  LoopApplyError,
  markLandingStatus,
  resolveRunDir,
  writeQueueLandingSummary,
} from '../src/loopApply.js';
import { runProcess } from '../src/runProcess.js';

test('resolveRunDir supports latest and explicit run ids', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  await fs.mkdir(path.join(repo, '.agent-loop', 'latest'), { recursive: true });
  await fs.mkdir(path.join(repo, '.agent-loop', 'runs', 'run-a'), { recursive: true });

  assert.equal(resolveRunDir({ repoRoot: repo, run: 'latest' }), path.join(repo, '.agent-loop', 'latest'));
  assert.equal(resolveRunDir({ repoRoot: repo, run: 'run-a' }), path.join(repo, '.agent-loop', 'runs', 'run-a'));
});

test('buildLoopApplyPlan defaults to excluding task docs and latest diff patch', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-a');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    options: {
      task: 'agent-loop/tasks/task-a.md',
      gates: ['npm test'],
    },
  }), 'utf8');
  await fs.writeFile(path.join(runDir, 'diff.1.patch'), 'diff one', 'utf8');
  await fs.writeFile(path.join(runDir, 'diff.2.patch'), 'diff two', 'utf8');
  await fs.writeFile(path.join(runDir, 'landing.json'), JSON.stringify({
    status: 'MAIN_GATE_GREEN',
    appliedToMain: true,
    mainGateGreen: true,
    committed: false,
  }), 'utf8');

  const plan = await buildLoopApplyPlan({ repoRoot: repo, run: 'run-a' });

  assert.equal(plan.runDir, runDir);
  assert.equal(plan.patchPath, path.join(runDir, 'diff.2.patch'));
  assert.deepEqual(plan.excludes, ['agent-loop/tasks/task-a.md']);
  assert.deepEqual(plan.gates, ['npm test']);
  assert.equal(plan.landing.status, 'MAIN_GATE_GREEN');
  assert.equal(plan.landing.mainGateGreen, true);
  assert.match(plan.checkCommand, /git apply --check/);
});

test('findLatestDiffPatch classifies missing patches as no diff', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-a');
  await fs.mkdir(runDir, { recursive: true });

  await assert.rejects(
    () => findLatestDiffPatch(runDir),
    (error) => {
      assert.equal(error instanceof LoopApplyError, true);
      assert.equal(error.kind, 'NO_DIFF_PATCH');
      assert.deepEqual(error.files, []);
      assert.match(error.message, /no diff\.N\.patch found/);
      return true;
    },
  );
});

test('markLandingStatus records apply, gate, and commit landing steps', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-a');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    runId: 'run-a',
    status: 'DONE_REVIEWED',
    options: {
      task: 'agent-loop/tasks/task-a.md',
      gates: ['npm test'],
    },
  }), 'utf8');

  const applied = await markLandingStatus({
    repoRoot: repo,
    run: 'run-a',
    status: 'APPLIED_TO_MAIN',
    details: { patchPath: 'diff.2.patch' },
  });
  assert.equal(applied.landing.status, 'APPLIED_TO_MAIN');
  assert.equal(applied.landing.appliedToMain, true);
  assert.equal(applied.landing.mainGateGreen, false);
  assert.equal(applied.landing.committed, false);

  const gateGreen = await markLandingStatus({
    repoRoot: repo,
    run: 'run-a',
    status: 'MAIN_GATE_GREEN',
  });
  assert.equal(gateGreen.landing.status, 'MAIN_GATE_GREEN');
  assert.equal(gateGreen.landing.appliedToMain, true);
  assert.equal(gateGreen.landing.mainGateGreen, true);
  assert.equal(gateGreen.landing.committed, false);

  const committed = await markLandingStatus({
    repoRoot: repo,
    run: 'run-a',
    status: 'COMMITTED',
    details: { commit: 'abc1234' },
  });
  assert.equal(committed.landing.status, 'COMMITTED');
  assert.equal(committed.landing.appliedToMain, true);
  assert.equal(committed.landing.mainGateGreen, true);
  assert.equal(committed.landing.committed, true);
  assert.equal(committed.landing.commit, 'abc1234');

  const saved = JSON.parse(await fs.readFile(path.join(runDir, 'landing.json'), 'utf8'));
  assert.equal(saved.status, 'COMMITTED');
  assert.equal(saved.commit, 'abc1234');
});

test('applyLatestDiffToMain applies latest run diff to main while excluding task docs', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  await runProcess('git', ['init'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['config', 'user.email', 'agent-loop@example.local'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['config', 'user.name', 'AgentLoop Test'], { cwd: repo, timeoutMs: 30000 });

  await fs.mkdir(path.join(repo, 'agent-loop', 'tasks'), { recursive: true });
  await fs.writeFile(path.join(repo, 'app.txt'), 'old\n', 'utf8');
  await fs.writeFile(path.join(repo, 'agent-loop', 'tasks', 'task-a.md'), '- [ ] old\n', 'utf8');
  await runProcess('git', ['add', '.'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: repo, timeoutMs: 30000 });

  await fs.writeFile(path.join(repo, 'app.txt'), 'new\n', 'utf8');
  await fs.writeFile(path.join(repo, 'agent-loop', 'tasks', 'task-a.md'), '- [x] old\n', 'utf8');
  const patch = await runProcess('git', ['diff', '--binary'], { cwd: repo, timeoutMs: 30000 });
  assert.equal(patch.exitCode, 0);
  await runProcess('git', ['checkout', '--', 'app.txt', 'agent-loop/tasks/task-a.md'], { cwd: repo, timeoutMs: 30000 });

  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-a');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    runId: 'run-a',
    status: 'DONE_REVIEWED',
    options: {
      task: 'agent-loop/tasks/task-a.md',
      gates: ['npm test'],
    },
  }), 'utf8');
  await fs.writeFile(path.join(runDir, 'diff.1.patch'), patch.stdout, 'utf8');

  const result = await applyLatestDiffToMain({
    repoRoot: repo,
    run: 'run-a',
    runner: runProcess,
  });

  assert.equal(result.landing.status, 'APPLIED_TO_MAIN');
  assert.equal((await fs.readFile(path.join(repo, 'app.txt'), 'utf8')).trim(), 'new');
  assert.equal((await fs.readFile(path.join(repo, 'agent-loop', 'tasks', 'task-a.md'), 'utf8')).trim(), '- [ ] old');
  const landing = JSON.parse(await fs.readFile(path.join(runDir, 'landing.json'), 'utf8'));
  assert.equal(landing.appliedToMain, true);
  assert.match(landing.patchPath, /diff\.1\.patch$/);
});

test('applyLatestDiffToMain classifies git apply check conflicts with files', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-a');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    runId: 'run-a',
    status: 'DONE_REVIEWED',
    options: {
      task: 'agent-loop/tasks/task-a.md',
      gates: ['npm test'],
    },
  }), 'utf8');
  await fs.writeFile(path.join(runDir, 'diff.1.patch'), 'diff --git a/app.txt b/app.txt\n', 'utf8');

  await assert.rejects(
    () => applyLatestDiffToMain({
      repoRoot: repo,
      run: 'run-a',
      runner: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'error: patch failed: app.txt:1\nerror: app.txt: patch does not apply\n',
      }),
    }),
    (error) => {
      assert.equal(error instanceof LoopApplyError, true);
      assert.equal(error.kind, 'PATCH_CONFLICT');
      assert.deepEqual(error.files, ['app.txt']);
      assert.match(error.message, /git apply --check failed/);
      return true;
    },
  );
});

test('writeQueueLandingSummary records queue patch without applying it', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-queue-landing-'));
  const patchText = 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-old\n+new\n';

  const summary = await writeQueueLandingSummary({
    repoRoot: repo,
    queueWorktreePath: path.join(repo, '.worktrees', 'migration-queue'),
    tasks: [
      { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' },
      { id: 'task-b', status: 'APPLY_CONFLICT', outcome: 'failed' },
    ],
    run: async (command, args) => {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['diff', '--binary']);
      return { exitCode: 0, stdout: patchText, stderr: '' };
    },
  });

  assert.equal(summary.status, 'PENDING_QUEUE_LANDING');
  assert.equal(summary.appliedToMain, false);
  assert.equal(summary.diffBytes, Buffer.byteLength(patchText, 'utf8'));
  assert.deepEqual(summary.tasks.map((task) => task.id), ['task-a', 'task-b']);
  assert.equal(
    await fs.readFile(path.join(repo, '.agent-loop', 'queue.diff.patch'), 'utf8'),
    patchText,
  );
  const saved = JSON.parse(await fs.readFile(path.join(repo, '.agent-loop', 'queue-landing.json'), 'utf8'));
  assert.equal(saved.status, 'PENDING_QUEUE_LANDING');
  assert.equal(saved.diffPath, path.join(repo, '.agent-loop', 'queue.diff.patch'));
});
