import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runLoop } from '../src/loopEngine.js';

test('runLoop drives Grok through multiple gate rounds until green, then runs Grok review', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
          const promptFile = args[1];
          grokPrompts.push(await fs.readFile(promptFile, 'utf8'));
          if (promptFile.includes('review-request')) {
            return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"ok","findings":[]}');
          }
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
  await fs.writeFile(taskPath, 'audit-only gate check\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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

test('runLoop passes a worktree-local Grok prompt file when fix cwd differs from run dir', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const fixCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-worktree-'));
  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-1');
  await fs.mkdir(runDir, { recursive: true });
  const taskPath = path.join(repo, 'task.md');
  await fs.writeFile(taskPath, 'create audit doc\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  let capturedPromptFile = null;

  const result = await runLoop({
    options: {
      cwd: repo,
      fixCwd,
      createWorktree: null,
      task: taskPath,
      gates: ['test gate'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 1,
    },
    runDir,
    latestDir: runDir,
    deps: {
      resolveAgents: async () => ({ codex: null, grok: 'grok.exe' }),
      evaluateGate: async () => gate(false, 1, 'missing doc'),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        assert.equal(command, 'grok.exe');
        capturedPromptFile = args[args.indexOf('--prompt-file') + 1];
        assert.equal(path.isAbsolute(capturedPromptFile), true);
        assert.equal(capturedPromptFile.startsWith(fixCwd), true);
        assert.match(path.relative(fixCwd, capturedPromptFile).replaceAll('\\', '/'), /^\.agent-loop-context\/current-run\/fix-request\.grok\.1\.md$/);
        assert.equal(options.cwd, fixCwd);
        await fs.access(capturedPromptFile);
        const prompt = await fs.readFile(capturedPromptFile, 'utf8');
        assert.match(prompt, /\.agent-loop-context\/current-run\/run-summary\.json/);
        assert.match(prompt, /\.agent-loop-context\/current-run\/task\.md/);
        assert.match(prompt, /\.agent-loop-context\/current-run\/gate-current\.json/);
        assert.match(prompt, /Use only current-worktree relative paths/);
        await fs.access(path.join(fixCwd, '.agent-loop-context', 'current-run', 'run-summary.json'));
        await fs.access(path.join(fixCwd, '.agent-loop-context', 'current-run', 'gate-current.json'));
        await fs.access(path.join(fixCwd, '.agent-loop-context', 'current-run', 'task.md'));
        return runOk(command, args, options.cwd, '{"verdict":"blocked"}');
      },
      writeArtifact: artifactWriter(runDir),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_NO_CHANGES');
  assert.ok(capturedPromptFile);
});

test('runLoop halts no progress when a red post-fix gate has unchanged failure count', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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

test('runLoop halts for human when a fix agent idles out', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      fixAgent: 'codex',
      timeoutMs: 1000,
      agentIdleTimeoutMs: 100,
      maxIterations: 2,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(false, 1, '1 failed'),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        assert.equal(options.idleTimeoutMs, 100);
        return {
          command,
          args,
          cwd: options.cwd,
          exitCode: null,
          signal: 'SIGTERM',
          timedOut: false,
          idleTimedOut: true,
          spawnError: null,
          stdout: '',
          stderr: '',
          startedAt: '2026-06-16T00:00:00.000Z',
          endedAt: '2026-06-16T00:00:01.000Z',
        };
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.agentFix.idleTimedOut, true);
  assert.equal(result.iterations[0].attempts[0].failure.kind, 'idle_timeout');
});

test('runLoop halts for human when a noisy fix agent exceeds its wall-clock budget', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      fixAgent: 'codex',
      timeoutMs: 1000,
      agentIdleTimeoutMs: 500,
      agentTimeoutMs: 100,
      maxIterations: 2,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(false, 1, '1 failed'),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        assert.equal(options.idleTimeoutMs, 500);
        assert.equal(options.agentTimeoutMs, 100);
        return {
          command,
          args,
          cwd: options.cwd,
          exitCode: null,
          signal: 'SIGTERM',
          timedOut: false,
          idleTimedOut: false,
          agentTimedOut: true,
          spawnError: null,
          stdout: '',
          stderr: 'still noisy',
          startedAt: '2026-06-16T00:00:00.000Z',
          endedAt: '2026-06-16T00:00:01.000Z',
        };
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.agentFix.agentTimedOut, true);
  assert.equal(result.iterations[0].attempts[0].failure.kind, 'agent_timeout');
});

test('runLoop does not pass worker max turns to Codex fix because current CLI rejects it', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  let codexArgs = null;
  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      fixAgent: 'codex',
      timeoutMs: 1000,
      workerMaxTurns: 8,
      grokMaxTurns: 8,
      maxIterations: 1,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(false, 1, '1 failed'),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        if (command === 'codex.exe') codexArgs = args;
        return runOk(command, args, options.cwd, '{}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_NO_CHANGES');
  assert.ok(codexArgs);
  assert.equal(codexArgs.includes('--max-turns'), false);
});

test('runLoop continues when a single red gate reports fewer inner test failures', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');
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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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

test('runLoop allows reviewed protected test additions without guardTests quarantine', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## Acceptance criteria\n\n- gate green\n', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    protectedTestAdditionDiff(),
  ];
  const transitions = [];
  let codexCalls = 0;

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
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 1,
      guardTests: true,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        codexCalls++;
        return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"reviewed","findings":[]}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => transitions.push(state.status),
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(result.guardReason, undefined);
  assert.equal(codexCalls, 1);
  assert.equal(result.reviewRounds.length, 1);
  assert.equal(result.reviewRounds[0].decision, 'pass');
  assert.equal(result.iterations[0].diffGuard.hasFindings, true);
  assert.equal(result.iterations[0].diffGuard.hasBlockingFindings, false);
  assert.deepEqual(
    transitions.filter((status) => status === 'POST_FIX_GATE_RESULT' || status === 'CODEX_REVIEW' || status === 'DONE_REVIEWED'),
    ['POST_FIX_GATE_RESULT', 'CODEX_REVIEW', 'DONE_REVIEWED']
  );
});

test('runLoop trusts structured review pass for protected test net deletions', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## Acceptance criteria\n\n- gate green\n', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    protectedTestDiff(),
  ];
  const transitions = [];
  let codexCalls = 0;

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
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 1,
      guardTests: true,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        codexCalls++;
        return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"reviewed","findings":[]}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => transitions.push(state.status),
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(result.guardReason, undefined);
  assert.equal(codexCalls, 1);
  assert.equal(result.reviewRounds.length, 1);
  assert.equal(result.reviewRounds[0].decision, 'pass');
  assert.equal(result.iterations[0].diffGuard.hasBlockingFindings, true);
  assert.deepEqual(
    transitions.filter((status) => status === 'POST_FIX_GATE_RESULT' || status === 'CODEX_REVIEW' || status === 'DONE_REVIEWED'),
    ['POST_FIX_GATE_RESULT', 'CODEX_REVIEW', 'DONE_REVIEWED']
  );
});

test('runLoop lets post-fix review request another fix before guardTests quarantine', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## Acceptance criteria\n\n- gate green\n', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    protectedTestDiff(),
    'diff --git a/src/example.js b/src/example.js\n+review fix\n',
  ];
  const reviewVerdicts = [
    '{"verdict":"needs_changes","summary":"fix the adapter","findings":[{"severity":"major","path":"src/example.js","message":"missing adapter"}]}',
    '{"verdict":"pass","summary":"reviewed","findings":[]}',
  ];
  const transitions = [];
  let codexCalls = 0;
  let grokCalls = 0;

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
      reviewAgent: 'codex',
      scopedReview: true,
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
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') {
          grokCalls++;
          return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        }
        codexCalls++;
        return runOk(command, args, options.cwd, reviewVerdicts.shift() ?? '{"verdict":"pass","findings":[]}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => transitions.push(state.status),
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(grokCalls, 2);
  assert.equal(codexCalls, 2);
  assert.equal(result.reviewRounds.length, 2);
  assert.equal(result.reviewRounds[0].decision, 'needs_changes');
  assert.equal(result.reviewRounds[1].decision, 'pass');
  assert.equal(transitions.includes('REVIEW_NEEDS_CHANGES'), true);
});

test('runLoop applies guardPolicy protected globs during diff guard', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  const policyPath = path.join(cwd, 'guard-policy.json');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');
  await fs.writeFile(policyPath, JSON.stringify({
    protectedGlobs: ['src/generated/**'],
  }), 'utf8');

  const gateResults = [
    gate(false, 1, 'Tests: 1 failed'),
    gate(true, 0, 'Tests: 1 passed'),
  ];
  const diffs = [
    '',
    'diff --git a/src/generated/client.js b/src/generated/client.js\n--- a/src/generated/client.js\n+++ b/src/generated/client.js\n@@ -1 +1,2 @@\n export const value = 1;\n+export const patched = true;\n',
  ];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: cwd,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
      guardTests: true,
      guardPolicyPath: policyPath,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) ?? '' }),
      runProcess: async (command, args, options) => runOk(command, args, options.cwd, '{"verdict":"changed"}'),
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.guardReason, 'POSSIBLE_TEST_TAMPER');
  assert.equal(result.iterations[0].diffGuard.findings[0].path, 'src/generated/client.js');
});

test('runLoop records a single iteration when a retryable Grok failure changes files and the gate remains red', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');
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
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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

test('runLoop injects worker env into agent processes and redacts raw values from state', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const gateResults = [
    gate(false, 1, 'baseline failure'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    'diff --git a/src/a.py b/src/a.py\n+fixed\n',
  ];
  const processCalls = [];
  const states = [];

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
      reviewAgent: 'codex',
      scopedReview: true,
      workerEnv: {
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'localhost,127.0.0.1,::1',
      },
      timeoutMs: 1000,
      maxIterations: 1,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        processCalls.push({ command, args, options });
        if (command === 'grok.exe') {
          return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        }
        if (command === 'codex.exe') {
          return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"ok","findings":[]}');
        }
        throw new Error(`unexpected agent call: ${command} ${args.join(' ')}`);
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => states.push(state),
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(processCalls.length, 2);
  assert.equal(processCalls[0].options.env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(processCalls[0].options.env.NO_PROXY, 'localhost,127.0.0.1,::1');
  assert.equal(processCalls[1].options.env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(processCalls[1].options.env.NO_PROXY, 'localhost,127.0.0.1,::1');

  for (const state of states) {
    assert.equal(state.options.workerEnv, undefined);
    assert.deepEqual(state.options.workerEnvKeys, ['HTTPS_PROXY', 'NO_PROXY']);
  }
  assert.equal(result.options.workerEnv, undefined);
  assert.deepEqual(result.options.workerEnvKeys, ['HTTPS_PROXY', 'NO_PROXY']);
});

test('runLoop passes an absolute --cd path to scoped Codex review when worktree path is relative', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate green\n', 'utf8');

  const relativeWorktree = path.join('.worktrees', 'review-target');
  const codexCalls = [];

  const result = await runLoop({
    options: {
      cwd,
      fixCwd: null,
      createWorktree: 'review-target',
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 1,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      ensureWorktree: async () => ({ path: relativeWorktree }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        if (command === 'codex.exe') {
          codexCalls.push({ args, cwd: options.cwd });
          return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"ok","findings":[]}');
        }
        throw new Error(`unexpected agent call: ${command} ${args.join(' ')}`);
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(codexCalls.length, 1);
  const cdIndex = codexCalls[0].args.indexOf('--cd');
  assert.notEqual(cdIndex, -1);
  assert.equal(codexCalls[0].args[cdIndex + 1], path.resolve(cwd, relativeWorktree));
  assert.equal(codexCalls[0].cwd, path.resolve(cwd, relativeWorktree));
});

test('runLoop skips grok fix and completes when baseline gate is green but checklist is pending', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, [
    '# Dev task',
    '',
    '### 状态清单',
    '',
    '- [ ] provider fallback chain',
    '',
    '## 允许修改的文件',
    '',
    '- `src/client.py`',
    '',
    '## 成功标准',
    '',
    '- gate 全绿且清单全部完成',
    '',
  ].join('\n'), 'utf8');

  const transitions = [];
  const grokPrompts = [];

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
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args) => {
        if (command === 'grok.exe' && args.includes('--prompt-file')) {
          const promptArgIndex = args.indexOf('--prompt-file');
          const promptFile = args[promptArgIndex + 1];
          grokPrompts.push(await fs.readFile(promptFile, 'utf8'));
          return runOk(command, args, cwd, '{"verdict":"changed"}');
        }
        throw new Error(`unexpected agent call: ${command} ${args.join(' ')}`);
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => transitions.push(state.status),
    },
  });

  assert.equal(result.status, 'DONE_GATE_ONLY');
  assert.equal(result.iterations.length, 0);
  assert.equal(transitions.includes('GROK_FIX'), false);
  assert.equal(grokPrompts.length, 0);
  assert.match(await fs.readFile(taskPath, 'utf8'), /- \[x\] provider fallback chain/);
});

test('runLoop loops Grok back when scoped Codex review returns needs_changes, then finishes on pass', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix gate to green\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const gateResults = [
    gate(false, 1, '1 failed'),
    gate(true, 0, ''),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+first fix\n',
    'diff --git a/a.js b/a.js\n+first fix\n+review fix\n',
  ];
  const reviewVerdicts = [
    JSON.stringify({
      verdict: 'needs_changes',
      summary: 'add fallback',
      riskLevel: 'medium',
      applyRecommendation: 'hold',
      verifiedBoundaries: ['allowed files', 'gate evidence'],
      findings: [{ severity: 'major', path: 'src/a.py', message: 'missing fallback' }],
    }),
    JSON.stringify({
      verdict: 'pass',
      summary: 'looks good',
      riskLevel: 'low',
      applyRecommendation: 'apply',
      verifiedBoundaries: ['allowed files', 'gate green'],
      findings: [],
    }),
  ];
  const transitions = [];
  const codexProcessCalls = [];
  let codexCalls = 0;
  let grokCalls = 0;

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
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 4,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') {
          grokCalls++;
          return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        }
        codexCalls++;
        codexProcessCalls.push({ args, input: options.input });
        // exitCode 0 even on needs_changes: the verdict must win over the exit code.
        return runOk(command, args, options.cwd, reviewVerdicts.shift() ?? '{"verdict":"pass"}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => transitions.push(state.status),
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(result.iterations.length, 2);
  assert.equal(result.reviewRounds.length, 2);
  assert.equal(result.reviewRounds[0].decision, 'needs_changes');
  assert.equal(result.reviewRounds[1].decision, 'pass');
  assert.equal(result.reviewRounds[0].riskLevel, 'medium');
  assert.equal(result.reviewRounds[0].applyRecommendation, 'hold');
  assert.deepEqual(result.reviewRounds[0].verifiedBoundaries, ['allowed files', 'gate evidence']);
  assert.equal(result.reviewRounds[1].riskLevel, 'low');
  assert.equal(result.reviewRounds[1].applyRecommendation, 'apply');
  assert.deepEqual(result.reviewRounds[1].verifiedBoundaries, ['allowed files', 'gate green']);
  assert.equal(grokCalls, 2);
  assert.equal(codexCalls, 2);
  assert.equal(codexProcessCalls.every((call) => call.args[0] === 'exec'), true);
  assert.equal(codexProcessCalls.every((call) => call.input?.includes('"verdict"')), true);
  assert.equal(transitions.includes('REVIEW_NEEDS_CHANGES'), true);
});

test('runLoop includes allowed-file HEAD snapshots in scoped review prompts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'src', 'a.py'), 'def current():\n    return "HEAD implementation"\n', 'utf8');
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, [
    '## allowed files',
    '',
    '- `src/a.py`',
    '',
    '## 成功标准',
    '',
    '- gate 全绿',
  ].join('\n'), 'utf8');

  const codexInputs = [];

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
      reviewAgent: 'codex',
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
      runProcess: async (command, args, options) => {
        if (command === 'codex.exe') {
          codexInputs.push(options.input || '');
          return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"ok","findings":[]}');
        }
        throw new Error(`unexpected agent call: ${command} ${args.join(' ')}`);
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(codexInputs.length, 1);
  assert.match(codexInputs[0], /HEAD file snapshots/);
  assert.match(codexInputs[0], /src\/a\.py/);
  assert.match(codexInputs[0], /HEAD implementation/);
});

test('runLoop lets the maxIterations budget stop an endless review tug-of-war', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  // Baseline already green; the reviewer never relents (always needs_changes),
  // so the only thing that stops the loop is the shared iteration budget.
  const stubborn = '{"verdict":"needs_changes","summary":"still wrong","findings":[{"severity":"major","path":"src/a.py","message":"missing fallback"}]}';

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
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 2,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: `diff --git a/a.js b/a.js\n+round ${Math.random()}\n` }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        return runOk(command, args, options.cwd, stubborn);
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_BUDGET');
  assert.equal(result.iterations.length, 2);
  // 1 baseline review + 1 review per fix iteration.
  assert.equal(result.reviewRounds.length, 3);
});

test('runLoop halts for human when the reviewer returns a blocked verdict', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

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
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        return runOk(command, args, options.cwd, '{"verdict":"blocked","summary":"cannot satisfy criteria","findings":[]}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.reviewRounds.length, 1);
  assert.equal(result.reviewRounds[0].decision, 'halt');
});

test('runLoop refuses a task with no success criteria before running anything', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '# task with no completion criteria\n\njust do something', 'utf8');
  let gateCalls = 0;

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
      evaluateGate: async () => {
        gateCalls++;
        return gate(true, 0, '');
      },
      captureDiff: async () => ({ text: '' }),
      runProcess: async () => {
        throw new Error('an inadmissible task should never spawn an agent');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_NO_SUCCESS_CRITERIA');
  assert.equal(result.admission.reason, 'NO_SUCCESS_CRITERIA');
  assert.equal(gateCalls, 0);
  assert.equal(result.iterations.length, 0);
});

test('runLoop enters the fix loop when a green baseline gets a needs_changes review', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const gateResults = [
    gate(true, 0, ''),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    'diff --git a/a.js b/a.js\n+review fix\n',
  ];
  const reviewVerdicts = [
    '{"verdict":"needs_changes","summary":"tighten","findings":[{"severity":"minor","path":"src/a.py","message":"edge case"}]}',
    '{"verdict":"pass","summary":"ok","findings":[]}',
  ];

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
      reviewAgent: 'codex',
      scopedReview: true,
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
        if (command === 'grok.exe') return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        return runOk(command, args, options.cwd, reviewVerdicts.shift() ?? '{"verdict":"pass"}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'DONE_REVIEWED');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.reviewRounds.length, 2);
});

test('runLoop resume preserves review-driven fix prompt after GROK_FIX is persisted', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const reviewFinding = {
    severity: 'minor',
    path: 'src/a.py',
    message: 'edge case',
  };
  const resumeState = {
    runId: 'resume-review-fix',
    status: 'GROK_FIX',
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    agents: { codex: 'codex.exe', grok: 'grok.exe' },
    worktree: { targetCwd: cwd, fixCwd: cwd, details: null },
    baselineGate: { ok: true, failureCount: 0 },
    baselineGateSnapshot: gate(true, 0, ''),
    baselineDiffText: '',
    iterations: [],
    reviewRounds: [{
      round: 1,
      verdict: 'needs_changes',
      decision: 'needs_changes',
      summary: 'tighten edge case',
      findings: [reviewFinding],
    }],
    pendingReview: {
      parsed: {
        verdict: 'needs_changes',
        summary: 'tighten edge case',
        findings: [reviewFinding],
      },
      verdict: 'needs_changes',
    },
    artifacts: { runDir: cwd, latestDir: cwd },
    currentIteration: 1,
  };

  const grokPrompts = [];

  const result = await runLoop({
    options: resumeState.options,
    runDir: cwd,
    latestDir: cwd,
    resumeState,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: 'diff --git a/a.js b/a.js\n+review fix\n' }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') {
          const promptArgIndex = args.indexOf('--prompt-file');
          grokPrompts.push(await fs.readFile(args[promptArgIndex + 1], 'utf8'));
          return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        }
        return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"ok","findings":[]}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(grokPrompts.length, 1);
  assert.match(grokPrompts[0], /审查回修请求/);
  assert.match(grokPrompts[0], /edge case/);
  assert.equal(result.status, 'DONE_REVIEWED');
});

test('runLoop resume rebuilds review-driven fix context from reviewRounds when pendingReview is missing', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\ngate 全绿，并且 Python/Node 行为一致。\n', 'utf8');

  const resumeState = {
    runId: 'resume-review-round-fallback',
    status: 'GROK_FIX',
    options: {
      cwd,
      fixCwd: cwd,
      createWorktree: null,
      task: taskPath,
      gates: ['npm test'],
      autoFix: true,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    agents: { codex: 'codex.exe', grok: 'grok.exe' },
    worktree: { targetCwd: cwd, fixCwd: cwd, details: null },
    baselineGate: { ok: true, failureCount: 0 },
    baselineGateSnapshot: gate(true, 0, ''),
    baselineDiffText: '',
    iterations: [],
    reviewRounds: [{
      round: 1,
      verdict: 'needs_changes',
      decision: 'needs_changes',
      summary: 'tighten fallback chain',
      findings: [{ severity: 'major', path: 'src/a.py', message: 'missing fallback' }],
    }],
    pendingReview: null,
    artifacts: { runDir: cwd, latestDir: cwd },
    currentIteration: 1,
  };

  const grokPrompts = [];

  const result = await runLoop({
    options: resumeState.options,
    runDir: cwd,
    latestDir: cwd,
    resumeState,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: 'diff --git a/a.js b/a.js\n+review fix\n' }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') {
          const promptArgIndex = args.indexOf('--prompt-file');
          grokPrompts.push(await fs.readFile(args[promptArgIndex + 1], 'utf8'));
          return runOk(command, args, options.cwd, '{"verdict":"changed"}');
        }
        return runOk(command, args, options.cwd, '{"verdict":"pass","summary":"ok","findings":[]}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.match(grokPrompts[0], /missing fallback/);
  assert.equal(result.status, 'DONE_REVIEWED');
});

test('runLoop halts when scoped review output is unparseable even with exit code 0', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, '## 允许修改的文件\n\n- `src/a.py`\n\n## 成功标准\n\n1. gate 全绿\n2. 不改测试\n', 'utf8');

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
      reviewAgent: 'codex',
      scopedReview: true,
      timeoutMs: 1000,
      maxIterations: 3,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: 'codex.exe', grok: 'grok.exe' }),
      evaluateGate: async () => gate(true, 0, ''),
      captureDiff: async () => ({ text: '' }),
      runProcess: async (command, args, options) => {
        if (command === 'grok.exe') {
          throw new Error('grok should not run when baseline review output is unparseable');
        }
        return runOk(command, args, options.cwd, '我觉得这里还不太行，应该继续改……');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async () => {},
    },
  });

  assert.equal(result.status, 'HALT_HUMAN');
  assert.equal(result.reviewRounds.length, 1);
  assert.equal(result.reviewRounds[0].decision, 'halt');
  assert.equal(result.iterations.length, 0);
});

test('runLoop publishes the active fix log pointer before the worker runs', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-test-'));
  const taskPath = path.join(cwd, 'task.md');
  await fs.writeFile(taskPath, 'fix unstable agent log\n\n## 成功标准\n\n- gate 全绿\n', 'utf8');

  const states = [];
  const gateResults = [
    gate(false, 1, 'baseline red'),
    gate(true, 0, ''),
  ];
  const diffs = [
    '',
    'diff --git a/src/a.py b/src/a.py\n+fixed\n',
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
      fixAgent: 'grok',
      timeoutMs: 1000,
      maxIterations: 1,
    },
    runDir: cwd,
    latestDir: cwd,
    deps: {
      resolveAgents: async () => ({ codex: null, grok: 'grok.exe' }),
      evaluateGate: async () => gateResults.shift(),
      captureDiff: async () => ({ text: diffs.shift() ?? diffs.at(-1) }),
      runProcess: async (command, args, options) => {
        const latestState = states.at(-1);
        assert.equal(latestState.status, 'GROK_FIX');
        assert.deepEqual(latestState.activeAgentLog, {
          phase: 'fix',
          agent: 'grok',
          iteration: 1,
          attempt: 1,
          stdout: 'grok-output.1.1.stdout.log',
          stderr: 'grok-output.1.1.stderr.log',
        });
        return runOk(command, args, options.cwd, '{"verdict":"changed"}');
      },
      writeArtifact: artifactWriter(cwd),
      onState: async (state) => states.push(state),
    },
  });

  assert.equal(result.status, 'DONE_FIXED');
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

function protectedTestAdditionDiff() {
  return `diff --git a/src/example.test.js b/src/example.test.js
--- a/src/example.test.js
+++ b/src/example.test.js
@@ -1 +1,4 @@
 import assert from 'node:assert/strict';
+test('keeps strict behavior covered', () => {
+  assert.equal(value, 2);
+});
`;
}
