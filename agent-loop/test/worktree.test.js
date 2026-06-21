import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertMainWorktreeClean,
  createQueueWorktreeCommit,
  createWorktreeCheckpoint,
  parseNameStatusLines,
  parseWorktreeListPorcelain,
  restoreWorktreeCheckpoint,
  syncAgentLoopTaskDocsFromRepo,
} from '../src/worktree.js';
import { runProcess } from '../src/runProcess.js';

test('parseNameStatusLines handles rename entries', () => {
  const entries = parseNameStatusLines('M\tagent-loop/src/worktree.js\nR100\told.md\tnew.md\n');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { code: 'M', path: 'agent-loop/src/worktree.js' });
  assert.deepEqual(entries[1], { code: 'R', oldPath: 'old.md', newPath: 'new.md' });
});

test('parseWorktreeListPorcelain parses git worktree list output', () => {
  const stdout = [
    'worktree C:/repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree C:/repo/.worktrees/task-a',
    'HEAD def456',
    'branch refs/heads/agent-loop/task-a',
    '',
  ].join('\n');

  const worktrees = parseWorktreeListPorcelain(stdout);
  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[1].branch, 'refs/heads/agent-loop/task-a');
});

test('assertMainWorktreeClean fails when tracked or untracked files are present', async () => {
  const clean = await assertMainWorktreeClean({
    repoRoot: 'C:\\repo',
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  });
  assert.equal(clean.clean, true);

  await assert.rejects(
    () => assertMainWorktreeClean({
      repoRoot: 'C:\\repo',
      run: async () => ({
        exitCode: 0,
        stdout: ' M agent-loop/src/runQueue.js\n?? scratch.txt\n',
        stderr: '',
      }),
    }),
    (error) => {
      assert.equal(error.code, 'DIRTY_MAIN_NEEDS_COMMIT');
      assert.deepEqual(error.files, ['agent-loop/src/runQueue.js', 'scratch.txt']);
      assert.match(error.message, /main worktree has uncommitted changes/);
      return true;
    },
  );
});

test('worktree checkpoints can be created and restored', async () => {
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  const checkpoint = await createWorktreeCheckpoint({
    worktreePath: 'C:\\repo\\.worktrees\\queue-a',
    taskId: 'task-a',
    run,
  });
  await restoreWorktreeCheckpoint({
    worktreePath: 'C:\\repo\\.worktrees\\queue-a',
    checkpoint,
    run,
  });

  assert.deepEqual(checkpoint, { taskId: 'task-a', ref: 'abc123' });
  assert.ok(calls.some((call) => call.command === 'git' && call.args.join(' ') === 'reset --hard abc123'));
  assert.ok(calls.some((call) => call.command === 'git' && call.args.join(' ') === 'clean -fd'));
});

test('queue worktree commits tracked and untracked success changes into a checkpoint', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-queue-worktree-'));
  await runProcess('git', ['init'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['config', 'user.email', 'agent-loop@example.local'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['config', 'user.name', 'AgentLoop Test'], { cwd: repo, timeoutMs: 30000 });

  await fs.writeFile(path.join(repo, 'tracked.txt'), 'old\n', 'utf8');
  await runProcess('git', ['add', 'tracked.txt'], { cwd: repo, timeoutMs: 30000 });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: repo, timeoutMs: 30000 });

  await fs.writeFile(path.join(repo, 'tracked.txt'), 'new\n', 'utf8');
  await fs.writeFile(path.join(repo, 'created.txt'), 'created\n', 'utf8');

  const checkpoint = await createQueueWorktreeCommit({
    worktreePath: repo,
    taskId: 'task-a',
    run: runProcess,
  });

  assert.equal(checkpoint.committed, true);
  assert.equal(checkpoint.taskId, 'task-a');
  assert.match(checkpoint.ref, /^[0-9a-f]{40}$/);

  const status = await runProcess('git', ['status', '--porcelain'], { cwd: repo, timeoutMs: 30000 });
  assert.equal(status.stdout, '');

  const files = await runProcess('git', ['show', '--name-only', '--format=', checkpoint.ref], {
    cwd: repo,
    timeoutMs: 30000,
  });
  assert.match(files.stdout, /tracked\.txt/);
  assert.match(files.stdout, /created\.txt/);
});

test('queue worktree checkpoint skips EOL-only tracked dirtiness', async () => {
  const calls = [];
  const checkpoint = await createQueueWorktreeCommit({
    worktreePath: 'C:\\repo\\.worktrees\\migration-queue',
    taskId: 'task-eol',
    run: async (command, args, options = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      if (args[0] === 'status') {
        return { exitCode: 0, stdout: ' M agent-loop/tasks/task-a.md\n', stderr: '' };
      }
      if (args[0] === 'diff') {
        assert.deepEqual(args, ['diff', '--quiet', '--ignore-space-at-eol']);
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { exitCode: 0, stdout: 'abc123\n', stderr: '' };
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    },
  });

  assert.deepEqual(checkpoint, { taskId: 'task-eol', ref: 'abc123', committed: false });
  assert.equal(calls.some((call) => call.args[0] === 'add'), false);
  assert.equal(calls.some((call) => call.args[0] === 'commit'), false);
});

test('task doc sync keeps normalized-identical target bytes to avoid EOL-only dirtiness', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-task-doc-sync-'));
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-task-doc-sync-wt-'));
  const sourceTask = path.join(repo, 'agent-loop', 'tasks', 'task-a.md');
  const targetTask = path.join(worktree, 'agent-loop', 'tasks', 'task-a.md');
  await fs.mkdir(path.dirname(sourceTask), { recursive: true });
  await fs.mkdir(path.dirname(targetTask), { recursive: true });
  await fs.writeFile(sourceTask, '# Task\n- [ ] one\n', 'utf8');
  await fs.writeFile(targetTask, '# Task\r\n- [ ] one\r\n', 'utf8');

  await syncAgentLoopTaskDocsFromRepo({ repoRoot: repo, worktreePath: worktree });

  assert.equal(await fs.readFile(targetTask, 'utf8'), '# Task\r\n- [ ] one\r\n');
});
