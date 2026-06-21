import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMainWorktreeClean,
  createWorktreeCheckpoint,
  parseNameStatusLines,
  parseWorktreeListPorcelain,
  restoreWorktreeCheckpoint,
} from '../src/worktree.js';

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
