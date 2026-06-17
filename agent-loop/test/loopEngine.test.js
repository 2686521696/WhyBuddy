import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runLoop } from '../src/loopEngine.js';

test('runLoop drives Grok through multiple gate rounds until green, then runs Grok review', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 2, 'baseline failure'),
    gate(false, 1, 'one failure remains'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+first fix\n',
    'diff --git a/a.js b/a.js\n+first fix\n+second fix\n',
  ];
  const transitions = [];
  const grokPrompts = [];
  const processCalls = [];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: false,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        processCalls.push({ command, args, cwd: options.cwd });
        if (command === 'grok.exe') {
          grokPrompts.push(await fs.readFile(args[1], 'utf8'));
          return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        }
        return runOk(command, args, options.cwd, 'review markdown');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => transitions.push(state.status),
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(result.iterations.length, 2);
  assert.equal(grokPrompts.length, 3);
  assert.equal(processCalls.filter((call) => call.command === 'grok.exe').length, 3);
  assert.equal(processCalls.filter((call) => call.command === 'codex.exe').length, 0);
  assert.deepEqual(
    transitions.filter((status) => status === 'GROK_FIX'),
    ['GROK_FIX', 'GROK_FIX']
  );
  assert.equal(transitions.at(-2), 'GROK_REVIEW');
});

test('runLoop audit-only succeeds without agents when review is skipped and auto-fix is disabled', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'audit-only gate check', 'utf8');

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: false,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: null, grok: null }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async () => {
        throw new Error('audit-only run should not spawn agents');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_GATE_ONLY');
  assert.equal(result.iterations.length, 0);
  assert.equal(result.grokFix, null);
  assert.equal(result.codexReview, null);
});

test('runLoop halts no progress when a red post-fix gate has unchanged failure count', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, 'same failure'),
    gate(false, 1, 'same failure'),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+attempt\n',
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_NO_PROGRESS');
  assert.equal(result.iterations.length, 1);
});

test('runLoop continues when a single red gate reports fewer inner test failures', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, 'Tests: 50 failed, 10 passed'),
    gate(false, 1, 'Tests: 1 failed, 59 passed'),
    gate(true, 0, 'Tests: 60 passed'),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+first broad fix\n',
    'diff --git a/a.js b/a.js\n+first broad fix\n+final fix\n',
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations.length, 2);
});

test('runLoop accepts a changed worktree when Grok exits non-zero but the post-fix gate is green', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+fix despite nonzero exit\n',
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      grokMaxTurns: 4,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => ({
        ...runOk(command, args, options.cwd, '{"stopReason":"Cancelled"}'),
        exitCode: 1,
      }),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].grokFix.exitCode, 1);
  assert.equal(result.iterations[0].gate.ok, true);
});

test('runLoop retries retryable Grok failures that exit non-zero without producing a diff', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    '',
    'diff --git a/a.js b/a.js\n+fix after retry\n',
  ];
  const processCalls = [];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      grokMaxTurns: 4,
      grokMaxRetries: 1,
      retryBackoffMs: 0,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        processCalls.push({ command, args, cwd: options.cwd });
        if (processCalls.filter((call) => call.command === 'grok.exe').length === 1) {
          return {
            ...runOk(command, args, options.cwd, ''),
            exitCode: 1,
            stderr: 'Error: rate limit exceeded',
          };
        }
        return runOk(command, args, options.cwd, '{"verdict":"changed"}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].attempts.length, 2);
  assert.equal(result.iterations[0].attempts[0].failure.kind, 'rate_limit');
  assert.equal(processCalls.filter((call) => call.command === 'grok.exe').length, 2);
});

test('runLoop pauses before the first Grok fix when pauseBeforeFix is enabled', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');
  const processCalls = [];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      pauseBeforeFix: true,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(false, 1, '1 failed'),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        processCalls.push({ command, args, cwd: options.cwd });
        return runOk(command, args, options.cwd, '{}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'PAUSED_BEFORE_FIX');
  assert.equal(result.currentIteration, 1);
  assert.equal(processCalls.length, 0);
});

test('runLoop resumes a paused state without rerunning the baseline gate', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const baseline = gate(false, 1, '1 failed');
  const gateResults = [gate(true, 0, '')];
  const diffs = [
    'diff --git a/a.js b/a.js\n+fix after resume\n',
  ];
  let gateCalls = 0;

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
    },
    runDir: cwd,
    latestDir: cwd,
    resumeState: {
      runId: 'resume-test',
      status: 'PAUSED_BEFORE_FIX',
      options: {
        cwd,
        fixCwd: cwd,
        task: taskPath,
        gates: ['npm test'],
        autoFix: true,
        skipReview: true,
        timeoutMs: 1000,
        maxIterations: 2,
      },
      agents: { codex: 'codex.exe', grok: 'grok.exe' },
      worktree: { targetCwd: cwd, fixCwd: cwd, details: null },
      baselineGate: { ok: false, failureCount: 1 },
      baselineGateSnapshot: baseline,
      baselineDiff: { bytes: 0 },
      baselineDiffText: '',
      iterations: [],
      artifacts: { runDir: cwd, latestDir: cwd },
    },
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => {
        gateCalls++;
        return gateResults.shift();
      },
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations.length, 1);
  assert.equal(gateCalls, 1);
});

test('runLoop ignores pauseBeforeFix when resuming an already paused state', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const baseline = gate(false, 1, '1 failed');
  const gateResults = [gate(true, 0, '')];
  const diffs = [
    'diff --git a/a.js b/a.js\n+fix after resume\n',
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      pauseBeforeFix: true,
    },
    runDir: cwd,
    latestDir: cwd,
    resumeState: {
      runId: 'resume-test',
      status: 'PAUSED_BEFORE_FIX',
      options: {
        cwd,
        fixCwd: cwd,
        task: taskPath,
        gates: ['npm test'],
        autoFix: true,
        skipReview: true,
        timeoutMs: 1000,
        maxIterations: 2,
        pauseBeforeFix: true,
      },
      agents: { codex: 'codex.exe', grok: 'grok.exe' },
      worktree: { targetCwd: cwd, fixCwd: cwd, details: null },
      baselineGate: { ok: false, failureCount: 1 },
      baselineGateSnapshot: baseline,
      baselineDiff: { bytes: 0 },
      baselineDiffText: '',
      iterations: [],
      artifacts: { runDir: cwd, latestDir: cwd },
    },
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations.length, 1);
});

test('runLoop pauses after a progressing red iteration and resumes from the next iteration', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const firstGateResults = [
    gate(false, 1, 'Tests: 5 failed, 10 passed'),
    gate(false, 1, 'Tests: 1 failed, 14 passed'),
  ];
  const firstDiffs = [
    '',
    'diff --git a/a.js b/a.js\n+partial fix\n',
  ];
  const firstTransitions = [];

  const paused = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
      pauseAfterIteration: true,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => firstGateResults.shift(),
      captureDiff: async () => ({ text: firstDiffs.shift() ?? firstDiffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => firstTransitions.push(state.status),
    },
  });

  assert.equal(paused.status, 'PAUSED_AFTER_ITERATION');
  assert.equal(paused.currentIteration, 1);
  assert.equal(paused.iterations.length, 1);
  assert.equal(paused.iterations[0].gate.ok, false);
  assert.match(paused.iterations[0].diffText, /partial fix/);
  assert.equal(firstTransitions.includes('HALT_NO_PROGRESS'), false);

  const resumeGateResults = [
    gate(true, 0, 'Tests: 15 passed'),
  ];
  const resumeDiffs = [
    'diff --git a/a.js b/a.js\n+partial fix\n+final fix\n',
  ];
  let grokCalls = 0;
  let gateCalls = 0;

  const resumed = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
      pauseAfterIteration: true,
    },
    runDir: cwd,
    latestDir: cwd,
    resumeState: paused,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => {
        gateCalls++;
        return resumeGateResults.shift();
      },
      captureDiff: async () => ({ text: resumeDiffs.shift() ?? resumeDiffs.at(-1) }),
      runProcess: async (command, args, options) => {
        grokCalls++;
        return runOk(command, args, options.cwd, '{"verdict":"changed"}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(resumed.status, 'DONE_FIXED');
  assert.equal(resumed.iterations.length, 2);
  assert.deepEqual(resumed.iterations.map((iteration) => iteration.iteration), [1, 2]);
  assert.equal(grokCalls, 1);
  assert.equal(gateCalls, 1);
});

test('runLoop records diff guard findings without halting by default', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    protectedTestDiff(),
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations[0].diffGuard.hasFindings, true);
  assert.equal(result.iterations[0].diffGuard.findings[0].path, 'src/example.test.js');
});

test('runLoop halts when guardTests sees protected test tampering', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    protectedTestDiff(),
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      guardTests: true,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.guardReason, 'POSSIBLE_TEST_TAMPER');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].diffGuard.hasFindings, true);
});

test('runLoop records a single iteration when a retryable Grok failure changes files and the gate remains red', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 2, '2 failed'),
    gate(false, 1, '1 failed'),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+partial fix\n',
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      grokMaxTurns: 4,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => ({
        ...runOk(command, args, options.cwd, ''),
        exitCode: 1,
        stderr: 'rate limit exceeded',
      }),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].gate.ok, false);
});

test('runLoop halts for human on an auth failure even though auth is non-retryable', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 2, '2 failed'),
    gate(false, 1, '1 failed'),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+partial fix\n',
  ];
  let grokCalls = 0;

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
      grokMaxTurns: 4,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        grokCalls++;
        return {
          ...runOk(command, args, options.cwd, ''),
          exitCode: 1,
          stderr: '401 Unauthorized invalid api key',
        };
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  // auth is non-retryable (no second attempt) AND agent-unstable, so even though Grok produced a
  // diff and the gate is merely red (not the progress judge's call), we stop for human.
  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.iterations.length, 1);
  assert.equal(grokCalls, 1);
});

test('runLoop continues after max-turns when a changed red gate made progress', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green', 'utf8');

  const gateResults = [
    gate(false, 1, 'Tests: 5 failed, 10 passed'),
    gate(false, 1, 'Tests: 1 failed, 14 passed'),
    gate(true, 0, 'Tests: 15 passed'),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+partial fix\n',
    'diff --git a/a.js b/a.js\n+partial fix\n+final fix\n',
  ];
  let grokCalls = 0;

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
      grokMaxTurns: 4,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        grokCalls++;
        if (grokCalls === 1) {
          return {
            ...runOk(command, args, options.cwd, ''),
            exitCode: 1,
            stderr: 'max turns reached',
          };
        }
        return runOk(command, args, options.cwd, '{"verdict":"changed"}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
  assert.equal(result.iterations.length, 2);
  assert.equal(result.iterations[0].attempts[0].failure.kind, 'max_turns');
  assert.equal(grokCalls, 2);
});

test('runLoop writes review-request.md for grok review even when scoped review is disabled', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n', 'utf8');
  const written = new Set();

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: false,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'grok',
      scopedReview: false,
      timeoutMs: 1000,
      maxIterations: 1,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args) => {
        if (command === 'grok.exe' && args.includes('--prompt-file')) {
          const promptArgIndex = args.indexOf('--prompt-file');
          const promptFile = args[promptArgIndex + 1];
          assert.ok(promptFile.endsWith('review-request.md'));
          return runOk(command, args, cwd, '{"verdict":"pass"}');
        }
        throw new Error(`unexpected agent call: ${command} ${args.join(' ')}`);
      },
      writeArtifact: async (fileName, content, kind) => {
        written.add(fileName);
        return artifactWriter(cwd)(fileName, content, kind);
      },
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(written.has('review-request.md'), true);
});

test('runLoop can use grok for scoped review after a green baseline gate', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n', 'utf8');

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'grok',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 1,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args) => {
        if (command === 'grok.exe' && args.includes('--prompt-file')) {
          return runOk(command, args, cwd, '{"verdict":"pass"}');
        }
        throw new Error(`unexpected agent call: ${command} ${args.join(' ')}`);
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(result.grokReview?.exitCode, 0);
  assert.equal(result.codexReview, null);
});

function artifactWriter(cwd) {
  return async (fileName, content, kind) => {
    await fs.writeFile(
      path.join(cwd, fileName),
      kind === 'json' ? `${JSON.stringify(content, null, 2)}\n` : String(content),
      'utf8'
    );
  };
}

function gate(ok, failureCount, stderr) {
  return {
    ok,
    failureCount,
    runs: [
      {
        label: 'npm test',
        command: 'powershell.exe',
        args: ['-NoProfile', '-Command', 'npm test'],
        cwd: 'repo',
        exitCode: ok ? 0 : 1,
        signal: null,
        timedOut: false,
        spawnError: null,
        stdout: '',
        stderr,
        startedAt: '2026-06-16T00:00:00.000Z',
        endedAt: '2026-06-16T00:00:01.000Z',
      },
    ],
  };
}

function runOk(command, args, cwd, stdout) {
  return {
    command,
    args,
    cwd,
    exitCode: 0,
    signal: null,
    timedOut: false,
    spawnError: null,
    stdout,
    stderr: '',
    startedAt: '2026-06-16T00:00:00.000Z',
    endedAt: '2026-06-16T00:00:01.000Z',
  };
}

function protectedTestDiff() {
  return `diff --git a/src/example.test.js b/src/example.test.js
--- a/src/example.test.js
+++ b/src/example.test.js
@@ -1,5 +1,3 @@
-test('keeps strict behavior', () => {
-  assert.equal(value, 2);
-});
+test('keeps strict behavior', () => {});
`;
}
