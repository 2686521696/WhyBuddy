import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLatestDiffToMain,
  applyQueueLandingToMain,
  buildLoopApplyPlan,
  findLatestDiffPatch,
  LoopApplyError,
  markLandingStatus,
  resolveRunDir,
  writeQueueLandingSummary,
} from '../src/loopApply.js';
import { runProcess } from '../src/runProcess.js';

async function initGitRepoWithApp() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-queue-landing-real-'));
  await runProcess('git', ['init'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['config', 'user.email', 'agent-loop@example.local'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['config', 'user.name', 'AgentLoop Test'], { cwd: repo, timeoutMs: 30000 });
  await fs.writeFile(path.join(repo, 'app.txt'), 'old\n', 'utf8');
  await fs.writeFile(path.join(repo, 'other.txt'), 'base\n', 'utf8');
  await runProcess('git', ['add', 'app.txt', 'other.txt'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: repo, timeoutMs: 30000 });
  return repo;
}

async function writeRealQueueLandingPatch(repo) {
  await fs.writeFile(path.join(repo, 'app.txt'), 'new\n', 'utf8');
  const patch = await runProcess('git', ['diff', '--binary'], { cwd: repo, timeoutMs: 30000 });
  assert.equal(patch.exitCode, 0);
  await runProcess('git', ['checkout', '--', 'app.txt'], { cwd: repo, timeoutMs: 30000 });

  const dir = path.join(repo, '.agent-loop');
  await fs.mkdir(dir, { recursive: true });
  const patchPath = path.join(dir, 'queue.diff.patch');
  await fs.writeFile(patchPath, patch.stdout, 'utf8');
  await fs.writeFile(path.join(dir, 'queue-landing.json'), `${JSON.stringify({
    status: 'PENDING_QUEUE_LANDING',
    appliedToMain: false,
    diffPath: patchPath,
    diffBytes: Buffer.byteLength(patch.stdout, 'utf8'),
    tasks: [{ id: 'task-a' }],
  }, null, 2)}\n`, 'utf8');
  return path.join(dir, 'queue-landing.json');
}

async function writeQueueLanding(repo, extra = {}) {
  const dir = path.join(repo, '.agent-loop');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'queue.diff.patch'), 'diff --git a/a b/a\n', 'utf8');
  await fs.writeFile(path.join(dir, 'queue-landing.json'), JSON.stringify({
    status: 'PENDING_QUEUE_LANDING',
    appliedToMain: false,
    diffPath: path.join(dir, 'queue.diff.patch'),
    diffBytes: 20,
    tasks: [{ id: 'a' }],
    ...extra,
  }), 'utf8');
  return path.join(dir, 'queue-landing.json');
}

test('applyQueueLandingToMain checks, applies, and flips landing status', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-land-'));
  const landingPath = await writeQueueLanding(repo);
  const calls = [];
  const runner = async (command, args) => {
    calls.push(args.join(' '));
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  const result = await applyQueueLandingToMain({ repoRoot: repo, runner });
  assert.equal(result.applied, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /status --porcelain/);
  assert.match(calls[1], /apply --check/);
  const landing = JSON.parse(await fs.readFile(landingPath, 'utf8'));
  assert.equal(landing.status, 'APPLIED_TO_MAIN');
  assert.equal(landing.appliedToMain, true);
});

test('applyQueueLandingToMain --check never applies', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-land-'));
  await writeQueueLanding(repo);
  const calls = [];
  const runner = async (command, args) => {
    calls.push(args.join(' '));
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const result = await applyQueueLandingToMain({ repoRoot: repo, runner, check: true });
  assert.equal(result.applied, false);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /status --porcelain/);
  assert.match(calls[1], /apply --check/);
});

test('applyQueueLandingToMain surfaces a conflict and leaves main untouched', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-land-'));
  const landingPath = await writeQueueLanding(repo);
  const runner = async (command, args) => {
    if (args[0] === 'status') return { exitCode: 0, stdout: '', stderr: '' };
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'error: patch failed: a:1\nerror: a: patch does not apply',
    };
  };
  await assert.rejects(
    () => applyQueueLandingToMain({ repoRoot: repo, runner }),
    (error) => {
      assert.equal(error instanceof LoopApplyError, true);
      assert.equal(error.kind, 'PATCH_CONFLICT');
      assert.deepEqual(error.files, ['a']);
      return true;
    },
  );
  const landing = JSON.parse(await fs.readFile(landingPath, 'utf8'));
  assert.equal(landing.appliedToMain, false);
});

test('applyQueueLandingToMain refuses an already-applied landing', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-land-'));
  await writeQueueLanding(repo, { appliedToMain: true, status: 'APPLIED_TO_MAIN' });
  await assert.rejects(
    () => applyQueueLandingToMain({ repoRoot: repo, runner: async () => ({ exitCode: 0 }) }),
    /already applied/,
  );
});

test('applyQueueLandingToMain tolerates a UTF-8 BOM in queue-landing.json', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-land-'));
  const landingPath = await writeQueueLanding(repo);
  const raw = await fs.readFile(landingPath, 'utf8');
  await fs.writeFile(landingPath, `\uFEFF${raw}`, 'utf8');
  const calls = [];
  const runner = async (command, args) => {
    calls.push(args.join(' '));
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  const result = await applyQueueLandingToMain({ repoRoot: repo, runner, check: true });

  assert.equal(result.checked, true);
  assert.equal(result.applied, false);
  assert.match(calls[0], /status --porcelain/);
  assert.match(calls[1], /apply --check/);
});

test('applyQueueLandingToMain applies a real queue patch in a clean git repo', async () => {
  const repo = await initGitRepoWithApp();
  const landingPath = await writeRealQueueLandingPatch(repo);

  const preview = await applyQueueLandingToMain({ repoRoot: repo, runner: runProcess, check: true });
  assert.equal(preview.checked, true);
  assert.equal(preview.applied, false);
  assert.equal((await fs.readFile(path.join(repo, 'app.txt'), 'utf8')).trim(), 'old');

  const applied = await applyQueueLandingToMain({ repoRoot: repo, runner: runProcess });

  assert.equal(applied.checked, true);
  assert.equal(applied.applied, true);
  assert.equal((await fs.readFile(path.join(repo, 'app.txt'), 'utf8')).trim(), 'new');
  assert.equal((await fs.readFile(path.join(repo, 'other.txt'), 'utf8')).trim(), 'base');
  const landing = JSON.parse(await fs.readFile(landingPath, 'utf8'));
  assert.equal(landing.status, 'APPLIED_TO_MAIN');
  assert.equal(landing.appliedToMain, true);
});

test('applyQueueLandingToMain refuses dirty main before preview or apply', async () => {
  const repo = await initGitRepoWithApp();
  const landingPath = await writeRealQueueLandingPatch(repo);
  await fs.writeFile(path.join(repo, 'other.txt'), 'dirty user edit\n', 'utf8');

  await assert.rejects(
    () => applyQueueLandingToMain({ repoRoot: repo, runner: runProcess, check: true }),
    (error) => {
      assert.equal(error.kind, 'DIRTY_MAIN_NEEDS_COMMIT');
      assert.deepEqual(error.files, ['other.txt']);
      return true;
    },
  );
  await assert.rejects(
    () => applyQueueLandingToMain({ repoRoot: repo, runner: runProcess }),
    (error) => {
      assert.equal(error.kind, 'DIRTY_MAIN_NEEDS_COMMIT');
      assert.deepEqual(error.files, ['other.txt']);
      return true;
    },
  );

  assert.equal((await fs.readFile(path.join(repo, 'app.txt'), 'utf8')).trim(), 'old');
  assert.equal((await fs.readFile(path.join(repo, 'other.txt'), 'utf8')).trim(), 'dirty user edit');
  const landing = JSON.parse(await fs.readFile(landingPath, 'utf8'));
  assert.equal(landing.status, 'PENDING_QUEUE_LANDING');
  assert.equal(landing.appliedToMain, false);
});

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

test('writeQueueLandingSummary records queue patch from base ref without applying it', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-queue-landing-'));
  const queue = path.join(repo, '.worktrees', 'migration-queue');
  const patchText = 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-old\n+new\n';

  const summary = await writeQueueLandingSummary({
    repoRoot: repo,
    queueWorktreePath: queue,
    baseRef: 'main-head',
    tasks: [
      { id: 'task-a', status: 'DONE_REVIEWED', outcome: 'done' },
      { id: 'task-b', status: 'APPLY_CONFLICT', outcome: 'failed' },
    ],
    run: async (command, args, options = {}) => {
      assert.equal(command, 'git');
      assert.equal(options.cwd, queue);
      if (args[0] === 'ls-files') {
        assert.deepEqual(args, ['ls-files', '--others', '--exclude-standard']);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      assert.deepEqual(args, ['diff', '--binary', 'main-head']);
      return { exitCode: 0, stdout: patchText, stderr: '' };
    },
  });

  assert.equal(summary.status, 'PENDING_QUEUE_LANDING');
  assert.equal(summary.appliedToMain, false);
  assert.equal(summary.baseRef, 'main-head');
  assert.equal(summary.diffBytes, Buffer.byteLength(patchText, 'utf8'));
  assert.deepEqual(summary.tasks.map((task) => task.id), ['task-a', 'task-b']);
  assert.deepEqual(summary.patchTasks.map((task) => task.id), ['task-a']);
  assert.equal(summary.taskCounts.total, 2);
  assert.equal(summary.taskCounts.patch, 1);
  assert.equal(summary.taskCounts.failed, 1);
  assert.equal(
    await fs.readFile(path.join(repo, '.agent-loop', 'queue.diff.patch'), 'utf8'),
    patchText,
  );
  const saved = JSON.parse(await fs.readFile(path.join(repo, '.agent-loop', 'queue-landing.json'), 'utf8'));
  assert.equal(saved.status, 'PENDING_QUEUE_LANDING');
  assert.equal(saved.diffPath, path.join(repo, '.agent-loop', 'queue.diff.patch'));
  assert.deepEqual(saved.patchTasks.map((task) => task.id), ['task-a']);
});

test('writeQueueLandingSummary can include untracked queue worktree files', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-queue-landing-'));
  const queue = path.join(repo, '.worktrees', 'migration-queue');
  const patchText = 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-old\n+new\n';

  const summary = await writeQueueLandingSummary({
    repoRoot: repo,
    queueWorktreePath: queue,
    baseRef: 'main-head',
    includeUntracked: true,
    tasks: [],
    run: async (command, args) => {
      assert.equal(command, 'git');
      if (args[0] === 'diff') {
        assert.deepEqual(args, ['diff', '--binary', 'main-head']);
        return { exitCode: 0, stdout: patchText, stderr: '' };
      }
      if (args[0] === 'ls-files') {
        assert.deepEqual(args, ['ls-files', '--others', '--exclude-standard']);
        return { exitCode: 0, stdout: 'created.txt\n', stderr: '' };
      }
      if (args[0] === 'add') {
        assert.deepEqual(args, ['add', '--intent-to-add', '--', 'created.txt']);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    },
  });

  assert.deepEqual(summary.untrackedFiles, ['created.txt']);
});
