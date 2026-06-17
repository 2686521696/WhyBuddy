import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoopProgressWatcher,
  describeLoopSnapshot,
  formatElapsed,
  formatProgressLine,
} from '../src/runQueueProgress.js';
import {
  formatAgentProgressLine,
  formatLoopStateLine,
  shouldEmitLoopProgress,
  tailAgentLine,
} from '../src/loopProgress.js';

test('formatElapsed renders compact durations', () => {
  assert.equal(formatElapsed(4500), '4s');
  assert.equal(formatElapsed(125000), '2m05s');
});

test('describeLoopSnapshot summarizes gate and iteration context', () => {
  const snapshot = describeLoopSnapshot({
    status: 'CODEX_REVIEW',
    currentIteration: 2,
    baselineGate: { ok: true },
    worktree: { fixCwd: 'C:\\repo\\.worktrees\\task-a' },
    iterations: [{ iteration: 1 }],
  });

  assert.equal(snapshot.status, 'CODEX_REVIEW');
  assert.match(snapshot.label, /Codex review/);
  assert.ok(snapshot.details.some((line) => line.includes('轮次 2')));
  assert.ok(snapshot.details.some((line) => line.includes('基线 gate 绿')));
});

test('formatProgressLine renders status and heartbeat lines', () => {
  const snapshot = describeLoopSnapshot({ status: 'GROK_FIX' });
  const statusLine = formatProgressLine({
    taskLabel: 'task-a',
    eventType: 'status',
    snapshot,
    taskElapsedMs: 3000,
  });
  const heartbeatLine = formatProgressLine({
    taskLabel: 'task-a',
    eventType: 'heartbeat',
    snapshot,
    phaseElapsedMs: 120000,
    taskElapsedMs: 180000,
  });

  assert.match(statusLine, /task-a → Grok 修复中/);
  assert.match(heartbeatLine, /仍在 Grok 修复中/);
  assert.match(heartbeatLine, /本阶段 2m00s/);
});

test('createLoopProgressWatcher emits status then heartbeat', async () => {
  const events = [];
  let reads = 0;
  const watcher = createLoopProgressWatcher({
    repoRoot: 'C:\\repo',
    taskLabel: 'task-a',
    intervalMs: 20,
    heartbeatMs: 40,
    now: () => 1000 + reads * 50,
    readState: async () => {
      reads += 1;
      if (reads === 1) return { status: 'INIT' };
      if (reads === 2) return { status: 'CODEX_REVIEW' };
      return { status: 'CODEX_REVIEW' };
    },
    onEvent: (event) => events.push(event),
  });

  await new Promise((resolve) => setTimeout(resolve, 120));
  watcher.stop();

  assert.ok(events.some((event) => event.type === 'status' && event.snapshot.status === 'INIT'));
  assert.ok(events.some((event) => event.type === 'status' && event.snapshot.status === 'CODEX_REVIEW'));
  assert.ok(events.some((event) => event.type === 'heartbeat'));
});

test('tailAgentLine strips ansi and keeps the last meaningful line', () => {
  const text = '\u001B[32m first line\u001B[0m\n\nsecond line\n';
  assert.equal(tailAgentLine(text), 'second line');
});

test('formatLoopStateLine and agent progress lines are stderr-friendly', () => {
  const stateLine = formatLoopStateLine({
    status: 'WORKTREE_READY',
    worktree: { fixCwd: 'C:\\repo\\.worktrees\\task-a' },
  }, Date.now() - 5000);
  const agentLine = formatAgentProgressLine({
    agent: 'codex',
    phase: 'review --uncommitted',
    tail: 'git diff --stat succeeded in 740ms',
    stderrBytes: 4096,
    startedAt: Date.now() - 60000,
  });

  assert.match(stateLine, /\[agent-loop\]/);
  assert.match(agentLine, /codex › review --uncommitted/);
  assert.match(agentLine, /log 4KB/);
});

test('shouldEmitLoopProgress respects AGENT_LOOP_PROGRESS', () => {
  assert.equal(shouldEmitLoopProgress({ AGENT_LOOP_PROGRESS: '1' }), true);
  assert.equal(shouldEmitLoopProgress({ AGENT_LOOP_PROGRESS: 'true' }), true);
  assert.equal(shouldEmitLoopProgress({}), false);
});