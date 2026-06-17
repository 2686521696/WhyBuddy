import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLoopArgs } from '../src/loopArgs.js';
import { evaluateGate } from '../src/gates.js';
import { decideNextState } from '../src/stateMachine.js';
import { hasDiffChanged } from '../src/diff.js';
import { buildGrokFixPrompt } from '../src/grokPrompt.js';
import { getWorktreePath, resetWorktreeWorkingTree, seedWorktreeFromRepo } from '../src/worktree.js';

test('parseLoopArgs requires cwd, task, and at least one gate', () => {
  assert.deepEqual(
    parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--gate',
      'npm run check',
    ]),
    {
      cwd: 'C:\\repo',
      task: 'task.md',
      gates: ['npm test', 'npm run check'],
      autoFix: false,
      createWorktree: null,
      fixCwd: null,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'grok',
      scopedReview: null,
      reviewMaxTurns: 2,
      timeoutMs: 120000,
      maxIterations: 3,
      grokMaxTurns: 4,
      grokMaxRetries: 1,
      retryBackoffMs: 1000,
      pauseBeforeFix: false,
      pauseAfterIteration: false,
      guardTests: false,
      lang: 'en',
      syncTaskStatus: true,
      syncMigrationStatus: true,
      resume: null,
    }
  );

  assert.throws(() => parseLoopArgs(['--cwd', 'C:\\repo']), /--task is required/);
  assert.throws(() => parseLoopArgs(['--cwd', 'C:\\repo', '--task', 'task.md']), /at least one --gate is required/);
});

test('parseLoopArgs disables automatic task status sync when requested', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--no-sync-task-status',
    '--no-sync-migration-status',
  ]);

  assert.equal(parsed.syncTaskStatus, false);
  assert.equal(parsed.syncMigrationStatus, false);
});

test('parseLoopArgs supports configurable fix and review agents', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--fix-agent',
    'codex',
    '--review-agent',
    'grok',
    '--scoped-review',
    'true',
  ]);

  assert.equal(parsed.fixAgent, 'codex');
  assert.equal(parsed.reviewAgent, 'grok');
  assert.equal(parsed.scopedReview, true);
  assert.equal(parsed.skipReview, false);
});

test('parseLoopArgs treats review-agent none as skip-review', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--review-agent',
    'none',
  ]);

  assert.equal(parsed.skipReview, true);
  assert.equal(parsed.reviewAgent, null);
});

test('parseLoopArgs supports skip-review for gate-only runs', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--skip-review',
  ]);

  assert.equal(parsed.skipReview, true);
});

test('parseLoopArgs supports zh-CN loop reports', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--lang',
    'zh-CN',
  ]);

  assert.equal(parsed.lang, 'zh-CN');
  assert.throws(
    () => parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--lang',
      'fr',
    ]),
    /--lang must be one of: en, zh-CN/
  );
});

test('parseLoopArgs supports pause and resume controls', () => {
  const paused = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--pause-before-fix',
  ]);

  assert.equal(paused.pauseBeforeFix, true);

  const pausedAfterIteration = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--pause-after-iteration',
  ]);

  assert.equal(pausedAfterIteration.pauseAfterIteration, true);

  const resumed = parseLoopArgs([
    '--resume',
    'C:\\repo\\.agent-loop\\latest\\state.json',
  ]);

  assert.equal(resumed.resume, 'C:\\repo\\.agent-loop\\latest\\state.json');
  assert.equal(resumed.cwd, null);
  assert.deepEqual(resumed.gates, []);
});

test('parseLoopArgs supports test tamper guard', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--guard-tests',
  ]);

  assert.equal(parsed.guardTests, true);
});

test('parseLoopArgs supports max iteration budget', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--max-iterations',
    '5',
  ]);

  assert.equal(parsed.maxIterations, 5);
  assert.throws(
    () => parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--max-iterations',
      '0',
    ]),
    /--max-iterations must be a positive integer/
  );
});

test('parseLoopArgs supports Grok max turns budget', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--grok-max-turns',
    '6',
  ]);

  assert.equal(parsed.grokMaxTurns, 6);
  assert.throws(
    () => parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--grok-max-turns',
      '0',
    ]),
    /--grok-max-turns must be a positive integer/
  );
});

test('parseLoopArgs supports Grok retry budget', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--grok-max-retries',
    '2',
    '--retry-backoff-ms',
    '50',
  ]);

  assert.equal(parsed.grokMaxRetries, 2);
  assert.equal(parsed.retryBackoffMs, 50);
  assert.throws(
    () => parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--grok-max-retries',
      '-1',
    ]),
    /--grok-max-retries must be a non-negative integer/
  );
  assert.throws(
    () => parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--retry-backoff-ms',
      '-1',
    ]),
    /--retry-backoff-ms must be a non-negative integer/
  );
});

test('parseLoopArgs requires explicit fix cwd when auto-fix is enabled', () => {
  assert.throws(
    () => parseLoopArgs([
      '--cwd',
      'C:\\repo',
      '--task',
      'task.md',
      '--gate',
      'npm test',
      '--auto-fix',
    ]),
    /--fix-cwd is required when --auto-fix is enabled/
  );

  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--fix-cwd',
    'C:\\repo-worktree',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--auto-fix',
  ]);

  assert.equal(parsed.fixCwd, 'C:\\repo-worktree');
});

test('parseLoopArgs allows auto-fix with create-worktree instead of fix-cwd', () => {
  const parsed = parseLoopArgs([
    '--cwd',
    'C:\\repo',
    '--create-worktree',
    'agentloop-fix-1',
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--auto-fix',
  ]);

  assert.equal(parsed.createWorktree, 'agentloop-fix-1');
  assert.equal(parsed.fixCwd, null);
});

test('seedWorktreeFromRepo applies HEAD binary diff and copies untracked files', async () => {
  const repoRoot = path.join(os.tmpdir(), `agent-loop-seed-${Date.now()}`);
  const worktreePath = path.join(repoRoot, '.worktrees', 'seed-test');
  await fs.mkdir(path.join(repoRoot, 'pkg'), { recursive: true });
  await fs.mkdir(path.join(worktreePath, 'pkg'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'pkg', 'tracked.txt'), 'repo-version\n', 'utf8');
  await fs.writeFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'worktree-version\n', 'utf8');
  await fs.writeFile(path.join(repoRoot, 'pkg', 'new.txt'), 'fresh\n', 'utf8');

  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'diff' && args[1] === 'HEAD' && args[2] === '--binary') {
      return { exitCode: 0, stdout: 'diff --git a/pkg/tracked.txt b/pkg/tracked.txt\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'ls-files') {
      return { exitCode: 0, stdout: 'pkg/new.txt\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'apply') {
      await fs.writeFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'repo-version\n', 'utf8');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  await seedWorktreeFromRepo({ repoRoot, worktreePath, run, timeoutMs: 1000 });

  assert.equal(await fs.readFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'utf8'), 'repo-version\n');
  assert.equal(await fs.readFile(path.join(worktreePath, 'pkg', 'new.txt'), 'utf8'), 'fresh\n');
  assert.ok(calls.some((call) => call.command === 'git' && call.args.join(' ') === 'diff HEAD --binary'));
  assert.equal(calls.filter((call) => call.command === 'git' && call.args[0] === 'apply').length, 1);
});

test('seedWorktreeFromRepo can reset and reseed the same worktree twice', async () => {
  const repoRoot = path.join(os.tmpdir(), `agent-loop-reseed-${Date.now()}`);
  const worktreePath = path.join(repoRoot, '.worktrees', 'reseed-test');
  await fs.mkdir(path.join(repoRoot, 'pkg'), { recursive: true });
  await fs.mkdir(path.join(worktreePath, 'pkg'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'pkg', 'tracked.txt'), 'repo-version\n', 'utf8');
  await fs.writeFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'stale-grok-version\n', 'utf8');

  let applyCount = 0;
  const run = async (command, args, options = {}) => {
    if (command === 'git' && args[0] === 'reset' && args[1] === '--hard') {
      await fs.writeFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'clean-base\n', 'utf8');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'clean') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'diff' && args[1] === 'HEAD') {
      return { exitCode: 0, stdout: 'diff --git a/pkg/tracked.txt b/pkg/tracked.txt\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'ls-files') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'apply') {
      applyCount += 1;
      await fs.writeFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'repo-version\n', 'utf8');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };

  await seedWorktreeFromRepo({ repoRoot, worktreePath, run, timeoutMs: 1000, resetBeforeSeed: true });
  await seedWorktreeFromRepo({ repoRoot, worktreePath, run, timeoutMs: 1000, resetBeforeSeed: true });

  assert.equal(applyCount, 2);
  assert.equal(await fs.readFile(path.join(worktreePath, 'pkg', 'tracked.txt'), 'utf8'), 'repo-version\n');
  await assert.doesNotReject(async () => resetWorktreeWorkingTree({ worktreePath, run, timeoutMs: 1000 }));
});

test('getWorktreePath creates project-local hidden worktree paths', () => {
  assert.equal(
    getWorktreePath({ repoRoot: 'C:\\repo', name: 'agentloop-fix-1' }),
    'C:\\repo\\.worktrees\\agentloop-fix-1'
  );
  assert.throws(() => getWorktreePath({ repoRoot: 'C:\\repo', name: '..\\bad' }), /invalid worktree name/);
});

test('evaluateGate marks all-zero commands green and preserves raw runs', async () => {
  const gate = await evaluateGate({
    cwd: 'C:\\repo',
    commands: ['ok one', 'ok two'],
    run: async (command, args, options) => ({
      command,
      args,
      cwd: options.cwd,
      exitCode: 0,
      timedOut: false,
      stdout: `${args.join(' ')} passed`,
      stderr: '',
    }),
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.failureCount, 0);
  assert.equal(gate.runs.length, 2);
  assert.match(gate.runs[0].stdout, /ok one passed/);
});

test('evaluateGate marks non-zero and timed-out commands red', async () => {
  const gate = await evaluateGate({
    cwd: 'C:\\repo',
    commands: ['ok', 'fail', 'slow'],
    run: async (_command, args, options) => ({
      command: _command,
      args,
      cwd: options.cwd,
      exitCode: args.at(-1) === 'fail' ? 1 : 0,
      timedOut: args.at(-1) === 'slow',
      stdout: '',
      stderr: args.at(-1) === 'fail' ? 'boom' : '',
    }),
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.failureCount, 2);
});

test('decideNextState keeps red baseline safe when autoFix is disabled', () => {
  assert.equal(
    decideNextState({ phase: 'BASELINE_GATE_RESULT', gateOk: false, autoFix: false }),
    'HALT_HUMAN'
  );
  assert.equal(
    decideNextState({ phase: 'BASELINE_GATE_RESULT', gateOk: false, autoFix: true }),
    'GROK_FIX'
  );
  assert.equal(
    decideNextState({ phase: 'BASELINE_GATE_RESULT', gateOk: true, autoFix: false }),
    'CODEX_REVIEW'
  );
});

test('hasDiffChanged detects empty and changed diff snapshots', () => {
  assert.equal(hasDiffChanged('', ''), false);
  assert.equal(hasDiffChanged('diff --git a/a b/a\n-old', 'diff --git a/a b/a\n-old'), false);
  assert.equal(hasDiffChanged('', 'diff --git a/a b/a\n+new'), true);
});

test('buildGrokFixPrompt includes task, gate failure, and safety rules', () => {
  const prompt = buildGrokFixPrompt({
    taskText: '修复 Python baseline',
    gate: {
      runs: [
        {
          label: 'pytest',
          exitCode: 1,
          timedOut: false,
          stdout: '1 failed',
          stderr: 'AssertionError',
        },
      ],
    },
  });

  assert.match(prompt, /修复 Python baseline/);
  assert.match(prompt, /pytest/);
  assert.match(prompt, /AssertionError/);
  assert.match(prompt, /Do not delete, weaken, skip, or rewrite tests/);
  assert.match(prompt, /Do not change gate commands, test scripts, CI config/);
  assert.match(prompt, /Do not bypass assertions/);
  assert.match(prompt, /不要提交/);
  assert.match(prompt, /只输出 JSON/);
});

test('buildGrokFixPrompt strips ANSI color codes from gate output', () => {
  const prompt = buildGrokFixPrompt({
    taskText: '修复 client parity',
    gate: {
      runs: [
        {
          label: 'pytest',
          exitCode: 1,
          timedOut: false,
          stdout: '\u001b[31mF\u001b[0m\u001b[31mFAILED\u001b[0m tests/test_client_parity.py::test_x - ImportError',
          stderr: '',
        },
      ],
    },
  });

  assert.doesNotMatch(prompt, /\u001b\[/);
  assert.match(prompt, /FAILED tests\/test_client_parity\.py::test_x - ImportError/);
  assert.match(prompt, /FFAILED/);
});
