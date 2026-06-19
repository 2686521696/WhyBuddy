import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoopApplyPlan, resolveRunDir } from '../src/loopApply.js';

test('resolveRunDir supports latest and explicit run ids', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  await fs.mkdir(path.join(repo, '.agent-loop', 'latest'), { recursive: true });
  await fs.mkdir(path.join(repo, '.agent-loop', 'runs', 'run-a'), { recursive: true });

  assert.equal(resolveRunDir({ repoRoot: repo, run: 'latest' }), path.join(repo, '.agent-loop', 'latest'));
  assert.equal(resolveRunDir({ repoRoot: repo, run: 'run-a' }), path.join(repo, '.agent-loop', 'runs', 'run-a'));
});

test('buildLoopApplyPlan defaults to excluding task docs and latest diff patch', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-apply-'));
  const runDir = path.join(repo, '.agent-loop', 'runs', 'run-a');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), JSON.stringify({
    options: {
      task: 'agent-loop/tasks/task-a.md',
      gates: ['npm test'],
    },
  }), 'utf8');
  await fs.writeFile(path.join(runDir, 'diff.1.patch'), 'diff one', 'utf8');
  await fs.writeFile(path.join(runDir, 'diff.2.patch'), 'diff two', 'utf8');

  const plan = await buildLoopApplyPlan({ repoRoot: repo, run: 'run-a' });

  assert.equal(plan.runDir, runDir);
  assert.equal(plan.patchPath, path.join(runDir, 'diff.2.patch'));
  assert.deepEqual(plan.excludes, ['agent-loop/tasks/task-a.md']);
  assert.deepEqual(plan.gates, ['npm test']);
  assert.match(plan.checkCommand, /git apply --check/);
});
