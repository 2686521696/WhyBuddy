import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentInvocation } from '../src/agentProcess.js';

test('resolveAgentInvocation keeps string commands unchanged', () => {
  assert.deepEqual(resolveAgentInvocation('codex.exe', ['review', '--uncommitted']), {
    command: 'codex.exe',
    args: ['review', '--uncommitted'],
  });
});

test('resolveAgentInvocation appends args after JSON command override prefixes', () => {
  assert.deepEqual(resolveAgentInvocation(['node.exe', 'codex-stub.mjs'], ['review']), {
    command: 'node.exe',
    args: ['codex-stub.mjs', 'review'],
  });
});
