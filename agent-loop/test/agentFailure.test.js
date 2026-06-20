import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAgentFailure,
  isRetryableAgentFailure,
} from '../src/agentFailure.js';

test('classifyAgentFailure marks transport/rate-limit retryable but auth non-retryable', () => {
  assert.deepEqual(classifyAgentFailure(run({ stderr: 'Error: rate limit exceeded' })), {
    kind: 'rate_limit',
    retryable: true,
    agentUnstable: true,
  });
  // auth is persistent → NOT retryable, but still agent-unstable (halt for human, don't loop).
  assert.deepEqual(classifyAgentFailure(run({ stderr: '401 Unauthorized invalid api key' })), {
    kind: 'auth',
    retryable: false,
    agentUnstable: true,
  });
  assert.deepEqual(classifyAgentFailure(run({ stderr: 'fetch failed: ECONNRESET' })), {
    kind: 'network',
    retryable: true,
    agentUnstable: true,
  });
  assert.equal(isRetryableAgentFailure(run({ stderr: 'ETIMEDOUT while connecting' })), true);
  assert.equal(isRetryableAgentFailure(run({ stderr: '401 Unauthorized' })), false);
});

test('classifyAgentFailure separates max-turns from generic non-zero exits (agent-stable)', () => {
  assert.deepEqual(classifyAgentFailure(run({ stderr: 'Error: max turns reached' })), {
    kind: 'max_turns',
    retryable: false,
    agentUnstable: false,
  });
  assert.deepEqual(classifyAgentFailure(run({ stderr: 'agent refused to edit' })), {
    kind: 'nonzero_exit',
    retryable: false,
    agentUnstable: false,
  });
});

test('classifyAgentFailure does not mistake business "auth" wording for an agent auth failure', () => {
  // Real repo noise: a failing business auth test / task text mentioning auth must stay nonzero_exit.
  assert.deepEqual(classifyAgentFailure(run({ stderr: 'auth module test failed' })), {
    kind: 'nonzero_exit',
    retryable: false,
    agentUnstable: false,
  });
  assert.deepEqual(classifyAgentFailure(run({ stdout: 'implementing the authentication system' })), {
    kind: 'nonzero_exit',
    retryable: false,
    agentUnstable: false,
  });
  // Strong signals still classify as a real agent auth failure.
  assert.equal(classifyAgentFailure(run({ stderr: '401 Unauthorized invalid api key' })).kind, 'auth');
  assert.equal(classifyAgentFailure(run({ stderr: 'authentication failed: token expired' })).kind, 'auth');
});

test('classifyAgentFailure treats spawn errors and process timeouts as hard failures', () => {
  assert.deepEqual(classifyAgentFailure(run({ spawnError: 'ENOENT' })), {
    kind: 'spawn_error',
    retryable: false,
    agentUnstable: true,
  });
  assert.deepEqual(classifyAgentFailure(run({ timedOut: true })), {
    kind: 'timeout',
    retryable: false,
    agentUnstable: true,
  });
  assert.deepEqual(classifyAgentFailure(run({ idleTimedOut: true })), {
    kind: 'idle_timeout',
    retryable: false,
    agentUnstable: true,
  });
});

function run(overrides = {}) {
  return {
    exitCode: 1,
    timedOut: false,
    spawnError: null,
    stdout: '',
    stderr: '',
    ...overrides,
  };
}
