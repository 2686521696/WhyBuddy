import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentChecklistFixPrompt,
  buildAgentFixPrompt,
  buildAgentReviewFixPrompt,
  buildAgentReviewPrompt,
} from '../src/grokPrompt.js';

test('buildAgentFixPrompt includes migration boundary guardrails for worker agents', () => {
  const prompt = buildAgentFixPrompt({
    taskText: '# Task\n\n## 成功标准\n\n- gate 通过\n',
    gate: { runs: [] },
    workerAgent: 'grok',
  });

  assert.match(prompt, /Migration Boundary Guardrails/);
  assert.match(prompt, /修复 worker 负责落地当前任务内/);
  assert.match(prompt, /不要把一个切片扩大成“大迁移”/);
  assert.match(prompt, /Node thin proxy、Python baseline、LLM infra、RAG\/vector\/evidence/);
  assert.match(prompt, /mcp\.call/);
  assert.match(prompt, /orchestrate\.plan/);
  assert.match(prompt, /输出 blocked/);
});

test('buildAgentFixPrompt gives a direct fast path for missing gate files listed in task', () => {
  const prompt = buildAgentFixPrompt({
    taskText: [
      '# Task',
      '',
      '## allowed files',
      '',
      '- `slide-rule-python/tests/test_missing_runtime.py`',
      '',
      '## success criteria',
      '',
      '- gate green',
    ].join('\n'),
    gate: {
      runs: [
        {
          label: 'pytest tests/test_missing_runtime.py',
          exitCode: 1,
          timedOut: false,
          stdout: '',
          stderr: 'ERROR: file or directory not found: tests/test_missing_runtime.py\n',
        },
      ],
    },
    workerAgent: 'grok',
  });

  assert.match(prompt, /Missing gate file fast path/);
  assert.match(prompt, /tests\/test_missing_runtime\.py/);
  assert.match(prompt, /Create the missing gate file first/);
  assert.match(prompt, /avoid broad repository exploration/);
});

test('buildAgentFixPrompt requires structured diagnosis before edits', () => {
  const prompt = buildAgentFixPrompt({
    taskText: '# Task\n\n## success criteria\n\n- gate green\n',
    gate: { runs: [] },
    workerAgent: 'codex',
  });

  assert.match(prompt, /Pre-edit diagnosis/);
  assert.match(prompt, /failureKind/);
  assert.match(prompt, /rootCause/);
  assert.match(prompt, /editNeeded/);
  assert.match(prompt, /intendedFiles/);
  assert.match(prompt, /gatesToRun/);
  assert.match(prompt, /If editNeeded is false/);
  assert.match(prompt, /Do not create a cosmetic diff/);
  assert.match(prompt, /diagnosis/);
});

test('buildAgentFixPrompt does not suggest creating missing files outside task scope', () => {
  const prompt = buildAgentFixPrompt({
    taskText: [
      '# Task',
      '',
      '## allowed files',
      '',
      '- `src/allowed.py`',
      '',
      '## success criteria',
      '',
      '- gate green',
    ].join('\n'),
    gate: {
      runs: [
        {
          label: 'pytest tests/test_out_of_scope.py',
          exitCode: 1,
          timedOut: false,
          stdout: '',
          stderr: 'ERROR: file or directory not found: tests/test_out_of_scope.py\n',
        },
      ],
    },
    workerAgent: 'grok',
  });

  assert.doesNotMatch(prompt, /Missing gate file fast path/);
  assert.match(prompt, /tests\/test_out_of_scope\.py/);
});

test('buildAgentReviewFixPrompt keeps review-driven fixes inside migration boundaries', () => {
  const prompt = buildAgentReviewFixPrompt({
    taskText: '# Task',
    review: {
      verdict: 'needs_changes',
      summary: 'tighten boundary',
      findings: [{ severity: 'major', path: 'src/a.js', message: 'scope expanded' }],
    },
    diffText: 'diff --git a/src/a.js b/src/a.js\n+change\n',
    workerAgent: 'grok',
  });

  assert.match(prompt, /Migration Boundary Guardrails/);
  assert.match(prompt, /proxy contract、smoke gate、generated\/fallback evidence/);
  assert.match(prompt, /如果任务没有明确 allowed files、gate、成功标准/);
});

test('buildAgentChecklistFixPrompt requires diagnosis and no fake checklist diffs', () => {
  const prompt = buildAgentChecklistFixPrompt({
    taskText: '# Task\n\n### status\n- [ ] Implement runtime\n',
    pendingItems: ['Implement runtime'],
    workerAgent: 'codex',
  });

  assert.match(prompt, /Pre-edit diagnosis/);
  assert.match(prompt, /checklist_pending/);
  assert.match(prompt, /Do not mark checklist items done unless/);
  assert.match(prompt, /diagnosis/);
});

test('buildAgentReviewFixPrompt requires diagnosis scoped to review findings', () => {
  const prompt = buildAgentReviewFixPrompt({
    taskText: '# Task',
    review: {
      verdict: 'needs_changes',
      summary: 'tighten boundary',
      findings: [{ severity: 'major', path: 'src/a.js', message: 'scope expanded' }],
    },
    diffText: 'diff --git a/src/a.js b/src/a.js\n+change\n',
    workerAgent: 'codex',
  });

  assert.match(prompt, /Pre-edit diagnosis/);
  assert.match(prompt, /review_needs_changes/);
  assert.match(prompt, /Only edit files needed to resolve the listed review findings/);
  assert.match(prompt, /diagnosis/);
});

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
      fileSnapshots: [
        {
          path: 'src/client.py',
          exists: true,
          content: 'def client():\n    return "python-runtime"\n',
          truncated: false,
        },
      ],
    },
  });

  assert.match(prompt, /AgentLoop gate 结果/);
  assert.match(prompt, /16 passed in 0\.25s/);
  assert.match(prompt, /HEAD file snapshots/);
  assert.match(prompt, /src\/client\.py/);
  assert.match(prompt, /python-runtime/);
  assert.match(prompt, /HEAD 提交/);
  assert.match(prompt, /勿重跑/);
  assert.match(prompt, /禁止调用 Shell/);
  assert.match(prompt, /Codex Boundary Review Checklist/);
  assert.match(prompt, /fallback\/proxy 冒充完整实现/);
  assert.match(prompt, /整体 Node backend、SlideRule V5、Node thin proxy/);
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

test('buildAgentReviewPrompt includes file snapshots when diff is truncated', () => {
  const prompt = buildAgentReviewPrompt({
    taskText: '# Task\n\n## allowed files\n\n- `docs/audit.md`\n',
    reviewContext: {
      gateSnapshot: { ok: true, failureCount: 0, runs: [] },
      diffText: `diff --git a/docs/audit.md b/docs/audit.md\n${'+x\n'.repeat(8000)}`,
      hadFixIterations: true,
      fileSnapshots: [
        {
          path: 'docs/audit.md',
          exists: true,
          content: 'FULL COVERAGE MATRIX\n- backend-python-a\n- backend-python-b\n',
          truncated: false,
        },
      ],
    },
  });

  assert.match(prompt, /<truncated>/);
  assert.match(prompt, /HEAD file snapshots/);
  assert.match(prompt, /FULL COVERAGE MATRIX/);
  assert.match(prompt, /backend-python-b/);
});

test('buildAgentReviewPrompt preserves late-file evidence when raw diff is large', () => {
  const largeEarlyDiff = [
    'diff --git a/server/routes/node-adapters/web-qa-node-adapter.ts b/server/routes/node-adapters/web-qa-node-adapter.ts',
    '--- a/server/routes/node-adapters/web-qa-node-adapter.ts',
    '+++ b/server/routes/node-adapters/web-qa-node-adapter.ts',
    '@@ -1,1 +1,4000 @@',
    ...Array.from({ length: 4000 }, (_value, index) => `+const nodeStubLine${index} = true;`),
    'diff --git a/slide-rule-python/services/web_aigc_web_qa_adapter.py b/slide-rule-python/services/web_aigc_web_qa_adapter.py',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/slide-rule-python/services/web_aigc_web_qa_adapter.py',
    '@@ -0,0 +1,5 @@',
    '+def execute_web_qa_facade(payload):',
    '+    return {"runtime": {"backend": "python"}, "source": "python-web-qa-facade"}',
  ].join('\n');

  const prompt = buildAgentReviewPrompt({
    taskText: '# Task',
    reviewContext: {
      gateSnapshot: { ok: true, failureCount: 0, runs: [] },
      diffText: largeEarlyDiff,
      hadFixIterations: true,
    },
  });

  assert.match(prompt, /Diff file evidence/);
  assert.match(prompt, /slide-rule-python\/services\/web_aigc_web_qa_adapter\.py/);
  assert.match(prompt, /execute_web_qa_facade/);
  assert.match(prompt, /python-web-qa-facade/);
});
