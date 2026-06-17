import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentReviewPrompt } from '../src/grokPrompt.js';

test('buildAgentReviewPrompt includes gate evidence and head-review guidance when diff is empty', () => {
  const prompt = buildAgentReviewPrompt({
    taskText: '# Task\n\n## 允许修改的文件\n\n- `src/client.py`\n',
    reviewContext: {
      gateSnapshot: {
        ok: true,
        failureCount: 0,
        runs: [
          {
            label: 'pytest tests/test_client_parity.py',
            exitCode: 0,
            timedOut: false,
            stdout: '16 passed in 0.25s\n',
            stderr: '',
          },
        ],
      },
      diffText: '',
      hadFixIterations: false,
    },
  });

  assert.match(prompt, /AgentLoop gate 结果/);
  assert.match(prompt, /16 passed in 0\.25s/);
  assert.match(prompt, /HEAD 提交/);
  assert.match(prompt, /勿重跑/);
  assert.match(prompt, /未提交 diff 为空/);
  assert.doesNotMatch(prompt, /请审查当前 worktree 里的未提交改动。/);
});

test('buildAgentReviewPrompt prioritizes uncommitted diff when present', () => {
  const prompt = buildAgentReviewPrompt({
    taskText: '# Task',
    reviewContext: {
      gateSnapshot: { ok: true, failureCount: 0, runs: [] },
      diffText: 'diff --git a/src/client.py b/src/client.py\n+fallback\n',
      hadFixIterations: true,
    },
  });

  assert.match(prompt, /未提交改动/);
  assert.match(prompt, /\+fallback/);
  assert.doesNotMatch(prompt, /HEAD 提交/);
});