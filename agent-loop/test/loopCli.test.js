import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/runProcess.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loop CLI pauses and resumes from the same run directory without real agents', async () => {
  const { repo, env, commonArgs } = await createCliFixture({
    initialValue: 1,
    finalValue: 2,
  });

  const paused = await runProcess(process.execPath, [
    ...commonArgs,
    '--pause-before-fix',
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });
  assert.equal(paused.exitCode, 0, paused.stderr || paused.stdout);

  const statePath = path.join(repo, '.agent-loop', 'latest', 'state.json');
  const pausedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(pausedState.status, 'PAUSED_BEFORE_FIX');
  const runDir = pausedState.artifacts.runDir;

  const resumed = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'loop.js'),
    '--resume',
    statePath,
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });
  assert.equal(resumed.exitCode, 0, resumed.stderr || resumed.stdout);

  const finalState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(finalState.status, 'DONE_FIXED');
  assert.equal(finalState.runId, pausedState.runId);
  assert.equal(finalState.artifacts.runDir, runDir);
  assert.equal(finalState.iterations.length, 1);
  assert.match(await fs.readFile(path.join(repo, 'value.js'), 'utf8'), /value = 2/);
  assert.match(await fs.readFile(path.join(repo, '.agent-loop', 'latest', 'final-report.md'), 'utf8'), /DONE_FIXED/);
});

test('loop CLI auto-syncs execution status into task.md after completion', async () => {
  const { repo, env, commonArgs, taskPath } = await createCliFixture({
    initialValue: 1,
    finalValue: 2,
  });

  await fs.writeFile(taskPath, [
    '# 修复任务',
    '',
    '## 执行状态',
    '',
    '- 最近执行：2026-06-01',
    '- AgentLoop run id：`old-run`',
    '',
    '## 目标',
    '',
    'Make npm test pass by changing value.js.',
    '',
    '## 成功标准',
    '',
    '- npm test 全绿',
    '',
  ].join('\n'), 'utf8');

  const result = await runProcess(process.execPath, [
    ...commonArgs,
    '--skip-review',
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const taskText = await fs.readFile(taskPath, 'utf8');
  assert.match(taskText, /AgentLoop 运行模式：`grok-fix`/);
  assert.match(taskText, /AgentLoop 结果：`DONE_FIXED`/);
  assert.match(taskText, /Grok 已运行：`true`/);
  assert.doesNotMatch(taskText, /`old-run`/);
  assert.match(result.stderr, /Synced task status: /);
});

test('loop CLI resume preserves disabled task status sync from the paused run', async () => {
  const { repo, env, commonArgs, taskPath } = await createCliFixture({
    initialValue: 1,
    finalValue: 2,
  });

  await fs.writeFile(taskPath, [
    '# 修复任务',
    '',
    '## 执行状态',
    '',
    '- 最近执行：2026-06-01',
    '- AgentLoop run id：`old-run`',
    '',
    '## 目标',
    '',
    'Make npm test pass by changing value.js.',
    '',
    '## 成功标准',
    '',
    '- npm test 全绿',
    '',
  ].join('\n'), 'utf8');

  const paused = await runProcess(process.execPath, [
    ...commonArgs,
    '--pause-before-fix',
    '--no-sync-task-status',
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });
  assert.equal(paused.exitCode, 0, paused.stderr || paused.stdout);
  assert.match(await fs.readFile(taskPath, 'utf8'), /`old-run`/);

  const statePath = path.join(repo, '.agent-loop', 'latest', 'state.json');
  const resumed = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'loop.js'),
    '--resume',
    statePath,
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });

  assert.equal(resumed.exitCode, 0, resumed.stderr || resumed.stdout);
  const taskText = await fs.readFile(taskPath, 'utf8');
  assert.match(taskText, /`old-run`/);
  assert.doesNotMatch(taskText, /DONE_FIXED/);
  assert.doesNotMatch(resumed.stderr, /Synced task status: /);
});

test('loop CLI pauses after a progressing iteration and resumes from the next one', async () => {
  const { repo, env, commonArgs } = await createCliFixture({
    initialValue: 1,
    partialValue: 2,
    finalValue: 3,
  });

  const paused = await runProcess(process.execPath, [
    ...commonArgs,
    '--pause-after-iteration',
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });
  assert.equal(paused.exitCode, 0, paused.stderr || paused.stdout);

  const statePath = path.join(repo, '.agent-loop', 'latest', 'state.json');
  const pausedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(pausedState.status, 'PAUSED_AFTER_ITERATION');
  assert.equal(pausedState.currentIteration, 1);
  assert.equal(pausedState.iterations.length, 1);
  assert.equal(pausedState.iterations[0].iteration, 1);
  assert.match(await fs.readFile(path.join(repo, 'value.js'), 'utf8'), /value = 2/);

  const resumed = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'loop.js'),
    '--resume',
    statePath,
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs: 60000,
  });
  assert.equal(resumed.exitCode, 0, resumed.stderr || resumed.stdout);

  const finalState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(finalState.status, 'DONE_FIXED');
  assert.equal(finalState.runId, pausedState.runId);
  assert.deepEqual(finalState.iterations.map((iteration) => iteration.iteration), [1, 2]);
  assert.match(await fs.readFile(path.join(repo, 'value.js'), 'utf8'), /value = 3/);
});

async function createCliFixture({ initialValue, partialValue = null, finalValue }) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-cli-'));
  const repo = path.join(fixture, 'repo');
  const stubDir = path.join(fixture, 'stubs');
  const grokStub = path.join(stubDir, 'grok-stub.mjs');
  const codexStub = path.join(stubDir, 'codex-stub.mjs');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(stubDir, { recursive: true });

  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: {
      test: 'node test.js',
    },
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(repo, 'value.js'), `export const value = ${initialValue};\n`, 'utf8');
  await fs.writeFile(path.join(repo, 'test.js'), [
    "import { value } from './value.js';",
    `if (value !== ${finalValue}) {`,
    "  console.error(value === 1 ? 'Tests: 2 failed, 0 passed' : 'Tests: 1 failed, 1 passed');",
    '  process.exit(1);',
    '}',
    "console.log('Tests: 2 passed');",
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(repo, 'task.md'), 'Make npm test pass by changing value.js.\n\n## 成功标准\n\n- npm test 全绿\n', 'utf8');
  await fs.writeFile(grokStub, [
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "const cwdIndex = process.argv.indexOf('--cwd');",
    'const cwd = cwdIndex >= 0 ? process.argv[cwdIndex + 1] : process.cwd();',
    "const valuePath = path.join(cwd, 'value.js');",
    "const text = await fs.readFile(valuePath, 'utf8');",
    partialValue === null
      ? `await fs.writeFile(valuePath, 'export const value = ${finalValue};\\n', 'utf8');`
      : [
        `const nextValue = text.includes('value = ${initialValue}') ? ${partialValue} : ${finalValue};`,
        "await fs.writeFile(valuePath, `export const value = ${nextValue};\\n`, 'utf8');",
      ].join('\n'),
    'console.log(JSON.stringify({ verdict: "changed" }));',
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(codexStub, 'console.log("review skipped in smoke");\n', 'utf8');

  await runOk('git', ['init'], { cwd: repo });
  await runOk('git', ['config', 'user.email', 'agent-loop@example.test'], { cwd: repo });
  await runOk('git', ['config', 'user.name', 'Agent Loop Test'], { cwd: repo });
  await runOk('git', ['add', '.'], { cwd: repo });
  await runOk('git', ['commit', '-m', 'initial'], { cwd: repo });

  const env = {
    ...process.env,
    AGENT_LOOP_CODEX_COMMAND_JSON: JSON.stringify([process.execPath, codexStub]),
    AGENT_LOOP_GROK_COMMAND_JSON: JSON.stringify([process.execPath, grokStub]),
    NODE_OPTIONS: '',
  };
  const commonArgs = [
    path.join(agentLoopRoot, 'src', 'loop.js'),
    '--cwd',
    repo,
    '--fix-cwd',
    repo,
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--auto-fix',
    '--skip-review',
    '--timeout-ms',
    '30000',
  ];

  return {
    repo,
    env,
    commonArgs,
    taskPath: path.join(repo, 'task.md'),
  };
}

async function runOk(command, args, options) {
  const result = await runProcess(command, args, { timeoutMs: 30000, ...options });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result;
}
