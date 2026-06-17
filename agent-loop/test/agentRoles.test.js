import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixStatusForAgent,
  requiredAgentNames,
  resolveAgentRoles,
  reviewStatusForAgent,
  useScopedReview,
} from '../src/agentRoles.js';

test('resolveAgentRoles defaults to grok fix and grok review', () => {
  assert.deepEqual(resolveAgentRoles({}), { fixAgent: 'grok', reviewAgent: 'grok' });
  assert.deepEqual(resolveAgentRoles({ skipReview: true }), { fixAgent: 'grok', reviewAgent: null });
});

test('requiredAgentNames follows configured roles', () => {
  assert.deepEqual(requiredAgentNames({ autoFix: true, fixAgent: 'codex', reviewAgent: 'grok' }), ['codex', 'grok']);
  assert.deepEqual(requiredAgentNames({ autoFix: false, skipReview: true }), []);
});

test('status helpers map agent ids to loop states', () => {
  assert.equal(fixStatusForAgent('grok'), 'GROK_FIX');
  assert.equal(fixStatusForAgent('codex'), 'CODEX_FIX');
  assert.equal(reviewStatusForAgent('grok'), 'GROK_REVIEW');
  assert.equal(reviewStatusForAgent('codex'), 'CODEX_REVIEW');
});

test('useScopedReview defaults to true for grok review only', () => {
  assert.equal(useScopedReview({ reviewAgent: 'grok' }), true);
  assert.equal(useScopedReview({ reviewAgent: 'codex' }), false);
  assert.equal(useScopedReview({ reviewAgent: 'codex', scopedReview: true }), true);
});