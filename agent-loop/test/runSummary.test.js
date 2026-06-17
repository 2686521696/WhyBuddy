import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRunMode, formatRunTimestamp, resolveDisplayTimeZone, summarizeRunRecord } from '../src/runSummary.js';

test('classifyRunMode marks gate-only runs explicitly', () => {
  assert.equal(
    classifyRunMode({
      status: 'DONE_GATE_ONLY',
      iterations: [],
      grokFix: null,
      codexReview: null,
    }),
    'gate-only'
  );
});

test('classifyRunMode marks Grok fix runs with and without Codex review', () => {
  assert.equal(
    classifyRunMode({
      status: 'DONE_FIXED',
      iterations: [{ iteration: 1 }],
      grokFix: { exitCode: 0, timedOut: false },
      codexReview: null,
    }),
    'grok-fix'
  );
  assert.equal(
    classifyRunMode({
      status: 'DONE_REVIEWED',
      iterations: [{ iteration: 1 }],
      grokFix: { exitCode: 0, timedOut: false },
      codexReview: { exitCode: 0, timedOut: false },
      reviewAgent: 'codex',
    }),
    'grok-fix+codex-review'
  );
  assert.equal(
    classifyRunMode({
      status: 'DONE_REVIEWED',
      iterations: [{ iteration: 1 }],
      grokFix: { exitCode: 0, timedOut: false },
      grokReview: { exitCode: 0, timedOut: false },
    }),
    'grok-fix+grok-review'
  );
});

test('classifyRunMode marks baseline-green review without Grok fix by review agent', () => {
  assert.equal(
    classifyRunMode({
      status: 'DONE_REVIEWED',
      iterations: [],
      grokFix: null,
      codexReview: { exitCode: 0, timedOut: false },
      reviewAgent: 'codex',
    }),
    'codex-review'
  );
  assert.equal(
    classifyRunMode({
      status: 'DONE_REVIEWED',
      iterations: [],
      grokFix: null,
      grokReview: { exitCode: 0, timedOut: false },
    }),
    'grok-review'
  );
});

test('classifyRunMode prefers review halt when fix finished but review failed', () => {
  assert.equal(
    classifyRunMode({
      status: 'HALT_HUMAN',
      iterations: [{ iteration: 1, agentFix: { exitCode: 0, timedOut: false } }],
      agentFix: { exitCode: 0, timedOut: false },
      agentReview: { exitCode: 1, timedOut: false },
      fixAgent: 'codex',
      reviewAgent: 'grok',
    }),
    'halt-human-after-grok-review',
  );
});

test('classifyRunMode marks timeout and halt states', () => {
  assert.equal(
    classifyRunMode({
      status: 'HALT_HUMAN',
      iterations: [{ iteration: 1 }],
      grokFix: { exitCode: null, timedOut: true },
      codexReview: null,
    }),
    'grok-fix-timeout'
  );
  assert.equal(
    classifyRunMode({
      status: 'HALT_HUMAN',
      iterations: [],
      grokFix: null,
      codexReview: null,
    }),
    'halt-human'
  );
});

test('summarizeRunRecord exposes run mode and agent activity flags', () => {
  const summary = summarizeRunRecord({
    runId: '2026-06-16T11-08-17-334Z',
    status: 'DONE_GATE_ONLY',
    task: 'tasks/baseline-index-audit.md',
    iterations: [],
    grokFix: null,
    codexReview: null,
  });

  assert.deepEqual(summary, {
    runId: '2026-06-16T11-08-17-334Z',
    status: 'DONE_GATE_ONLY',
    task: 'tasks/baseline-index-audit.md',
    fixAgent: 'grok',
    reviewAgent: 'grok',
    runMode: 'gate-only',
    grokRan: false,
    codexRan: false,
    reviewAgentRan: false,
    iterations: 0,
    runTimeLocal: '2026-06-16 19:08:17 (Asia/Shanghai)',
    runTimeUtc: '2026-06-16 11:08:17 (UTC)',
  });
});

test('summarizeRunRecord does not mark grokRan when codex was the fix worker', () => {
  const summary = summarizeRunRecord({
    runId: 'run-1',
    status: 'DONE_FIXED',
    task: 'task.md',
    iterations: [{ iteration: 1, agentFix: { exitCode: 0, timedOut: false } }],
    agentFix: { exitCode: 0, timedOut: false },
    grokFix: null,
    codexReview: null,
    fixAgent: 'codex',
    reviewAgent: 'grok',
  });

  assert.equal(summary.runMode, 'codex-fix');
  assert.equal(summary.grokRan, false);
  assert.equal(summary.codexRan, true);
});

test('summarizeRunRecord treats iteration-level Grok data as Grok activity', () => {
  const summary = summarizeRunRecord({
    runId: 'run-1',
    status: 'DONE_FIXED',
    task: 'task.md',
    iterations: [{ iteration: 1, grokFix: { exitCode: 0, timedOut: false } }],
    grokFix: null,
    codexReview: null,
  });

  assert.equal(summary.runMode, 'grok-fix');
  assert.equal(summary.grokRan, true);
});

test('resolveDisplayTimeZone prefers explicit value then TZ then Asia/Shanghai', () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    assert.equal(resolveDisplayTimeZone('Pacific/Auckland'), 'Pacific/Auckland');
    assert.equal(resolveDisplayTimeZone(), 'Europe/Berlin');
    delete process.env.TZ;
    assert.equal(resolveDisplayTimeZone(), 'Asia/Shanghai');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test('formatRunTimestamp renders readable local and UTC timestamps from run IDs', () => {
  assert.equal(
    formatRunTimestamp('2026-06-16T11-08-17-334Z', { timeZone: 'Asia/Shanghai', label: 'Asia/Shanghai' }),
    '2026-06-16 19:08:17 (Asia/Shanghai)'
  );
  assert.equal(
    formatRunTimestamp('2026-06-16T11-08-17-334Z', { timeZone: 'UTC', label: 'UTC' }),
    '2026-06-16 11:08:17 (UTC)'
  );
});
