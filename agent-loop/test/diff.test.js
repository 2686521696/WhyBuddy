import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { captureDiff, hasDiffChanged } from '../src/diff.js';
import { runProcess } from '../src/runProcess.js';

test('captureDiff includes untracked text files as new-file patches', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-diff-'));
  await runGit(repo, ['init']);
  await runGit(repo, ['config', 'user.email', 'agent-loop@example.test']);
  await runGit(repo, ['config', 'user.name', 'Agent Loop']);

  await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
  await fs.writeFile(path.join(repo, 'README.md'), 'baseline\n', 'utf8');
  await runGit(repo, ['add', 'README.md']);
  await runGit(repo, ['commit', '-m', 'baseline']);

  await fs.writeFile(path.join(repo, 'README.md'), 'baseline\nchanged\n', 'utf8');
  await fs.writeFile(path.join(repo, 'docs', 'new-audit.md'), '# New Audit\n\n- gate green\n', 'utf8');

  const diff = await captureDiff({ cwd: repo });

  assert.match(diff.text, /diff --git a\/README\.md b\/README\.md/);
  assert.match(diff.text, /diff --git a\/docs\/new-audit\.md b\/docs\/new-audit\.md/);
  assert.match(diff.text, /new file mode 100644/);
  assert.match(diff.text, /\+\+\+ b\/docs\/new-audit\.md/);
  assert.match(diff.text, /\+# New Audit/);
  assert.match(diff.text, /\+- gate green/);
  assert.equal(hasDiffChanged('', diff.text), true);
});

async function runGit(cwd, args) {
  const result = await runProcess('git', args, { cwd, timeoutMs: 60000 });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result;
}
