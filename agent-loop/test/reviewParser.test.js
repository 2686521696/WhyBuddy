import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyReviewOutcome,
  normalizeReviewVerdict,
  parseAgentReviewOutput,
  reviewVerdictAllowsDone,
} from '../src/reviewParser.js';

test('parseAgentReviewOutput reads nested grok json text', () => {
  const stdout = JSON.stringify({
    text: '{"verdict":"pass","summary":"ok","findings":[]}',
    stopReason: 'Cancelled',
  });

  const parsed = parseAgentReviewOutput(stdout);
  assert.equal(parsed.verdict, 'pass');
  assert.equal(reviewVerdictAllowsDone(parsed), true);
});

test('reviewVerdictAllowsDone rejects needs_changes', () => {
  assert.equal(reviewVerdictAllowsDone({ verdict: 'needs_changes' }), false);
});

test('normalizeReviewVerdict maps ok and approved onto pass', () => {
  assert.equal(normalizeReviewVerdict('ok'), 'pass');
  assert.equal(normalizeReviewVerdict('Approved'), 'pass');
  assert.equal(normalizeReviewVerdict('needs-changes'), 'needs_changes');
  assert.equal(normalizeReviewVerdict('changed'), 'changed');
});

test('classifyReviewOutcome lets a needs_changes verdict win over a zero exit code', () => {
  const decision = classifyReviewOutcome({
    parsed: { verdict: 'needs_changes' },
    timedOut: false,
    spawnError: null,
    exitCode: 0,
  });
  assert.equal(decision, 'needs_changes');
});

test('classifyReviewOutcome treats a blocked verdict as halt even when exit code is zero', () => {
  assert.equal(classifyReviewOutcome({ parsed: { verdict: 'blocked' }, exitCode: 0 }), 'halt');
});

test('classifyReviewOutcome falls back to exit code when no verdict is parsed', () => {
  assert.equal(classifyReviewOutcome({ parsed: null, exitCode: 0 }), 'pass');
  assert.equal(classifyReviewOutcome({ parsed: null, exitCode: 1 }), 'halt');
});

test('classifyReviewOutcome halts when structured verdict is required but missing', () => {
  assert.equal(classifyReviewOutcome({
    parsed: null,
    exitCode: 0,
    requiresStructuredVerdict: true,
  }), 'halt');
  assert.equal(classifyReviewOutcome({
    parsed: null,
    exitCode: 0,
    requiresStructuredVerdict: false,
  }), 'pass');
});

test('classifyReviewOutcome halts on a timed-out or spawn-failed review', () => {
  assert.equal(classifyReviewOutcome({ parsed: { verdict: 'pass' }, timedOut: true, exitCode: 0 }), 'halt');
  assert.equal(classifyReviewOutcome({ parsed: { verdict: 'pass' }, spawnError: 'ENOENT', exitCode: 0 }), 'halt');
});