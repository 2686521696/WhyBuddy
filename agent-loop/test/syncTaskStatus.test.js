import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildManagedFieldValues,
  migrationCapabilityForTask,
  shouldSkipTaskFile,
  syncTaskStatus,
  syncTaskFileFromRun,
  tryAutoSyncTaskStatus,
  updateExecutionStatusSection,
  updateMigrationCapabilitySection,
} from '../src/syncTaskStatusCore.js';

const sampleRun = {
  runId: '2026-06-16T17-00-02-496Z',
  runTimeLocal: '2026-06-17 01:00:02 (Asia/Shanghai)',
  runTimeUtc: '2026-06-16 17:00:02 (UTC)',
  status: 'DONE_GATE_ONLY',
  task: 'agent-loop/tasks/migrate-sliderule-gap-ask.md',
  runMode: 'gate-only',
  grokRan: false,
  codexRan: false,
  iterations: 0,
};

test('buildManagedFieldValues maps list-runs summary into task status fields', () => {
  const values = buildManagedFieldValues(sampleRun);
  assert.equal(values.get('最近执行'), '2026-06-17');
  assert.equal(values.get('AgentLoop run id'), '`2026-06-16T17-00-02-496Z`');
  assert.equal(values.get('AgentLoop 运行模式'), '`gate-only`');
  assert.match(values.get('gate 结果'), /baseline gate 为 green/);
});

test('updateExecutionStatusSection refreshes managed fields without touching checklist', () => {
  const markdown = [
    '# 迁移任务',
    '',
    '## 执行状态',
    '',
    '- 状态：已实现并验证通过',
    '- 最近执行：2026-06-01',
    '- AgentLoop run id：`old-run`',
    '- AgentLoop 结果：`OLD_STATUS`',
    '',
    '### 状态清单',
    '',
    '- [x] Python gate 通过',
    '',
    '## 目标',
    '',
    '只做这一片。',
    '',
  ].join('\n');

  const updated = updateExecutionStatusSection(markdown, sampleRun);

  assert.match(updated, /- 最近执行：2026-06-17/);
  assert.match(updated, /- AgentLoop run id：`2026-06-16T17-00-02-496Z`/);
  assert.match(updated, /- AgentLoop 运行模式：`gate-only`/);
  assert.match(updated, /- Grok 已运行：`false`/);
  assert.match(updated, /- \[x\] Python gate 通过/);
  assert.doesNotMatch(updated, /`old-run`/);
});

test('updateExecutionStatusSection refreshes English execution status sections', () => {
  const markdown = [
    '# runtime closure task',
    '',
    '## Execution status',
    '- Status: PENDING',
    '- Phase: 120-runtime-closure-e2e',
    '- Owner: grok',
    '',
    '## Objective',
    'Keep the task runnable.',
    '',
  ].join('\n');

  const updated = updateExecutionStatusSection(markdown, sampleRun);

  assert.match(updated, /- Status: DONE_GATE_ONLY/);
  assert.match(updated, /- AgentLoop run id: `2026-06-16T17-00-02-496Z`/);
  assert.match(updated, /- AgentLoop run mode: `gate-only`/);
  assert.match(updated, /- Grok ran: `false`/);
  assert.match(updated, /- Owner: grok/);
  assert.match(updated, /## Objective/);
});

test('shouldSkipTaskFile ignores templates and audit-only shells', () => {
  assert.equal(shouldSkipTaskFile('## 执行状态\n- 状态：模板文件'), true);
  assert.equal(shouldSkipTaskFile('## 执行状态\n- 状态：已实现并验证通过'), false);
});

test('updateMigrationCapabilitySection rewrites capability verification block', () => {
  const markdown = [
    '# 状态总表',
    '',
    '## 最近验证记录',
    '',
    '### `gap.ask`',
    '',
    '- 最近执行：旧日期',
    '- AgentLoop run id：`old-run`',
    '',
    '已记录通过的 gate：',
    '',
    '- [x] Python pytest',
    '',
    '### `intent.clarify`',
    '',
    '- 状态：已实现并验证通过',
    '',
  ].join('\n');

  const updated = updateMigrationCapabilitySection(markdown, 'gap.ask', sampleRun);

  assert.match(updated, /- AgentLoop 运行模式：`gate-only`/);
  assert.match(updated, /- 验证说明：这轮只是 gate-only 验证/);
  assert.match(updated, /- \[x\] Python pytest/);
  assert.match(updated, /### `intent.clarify`/);
  assert.doesNotMatch(updated, /`old-run`/);
});

test('syncTaskStatus matches task aliases stored as tasks/foo.md or agent-loop/tasks/foo.md', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-sync-alias-'));
  const taskPath = 'tasks/baseline-index-audit.md';
  const taskAbsolutePath = path.join(root, taskPath);
  await fs.mkdir(path.dirname(taskAbsolutePath), { recursive: true });
  await fs.writeFile(taskAbsolutePath, [
    '# baseline',
    '',
    '## 执行状态',
    '',
    '- 最近执行：2026-06-01',
    '',
  ].join('\n'), 'utf8');

  const runDir = path.join(root, '.agent-loop', 'runs', sampleRun.runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    runId: sampleRun.runId,
    status: sampleRun.status,
    options: { task: taskPath },
    iterations: [],
  }, null, 2)}\n`, 'utf8');

  const result = await syncTaskStatus({
    cwd: root,
    taskPaths: ['agent-loop/tasks/baseline-index-audit.md'],
  });

  assert.equal(result.updates[0].changed, true);
});

test('syncTaskFileFromRun writes the current run without reading list-runs history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-sync-run-'));
  const taskPath = 'tasks/migrate-sliderule-gap-ask.md';
  const taskAbsolutePath = path.join(root, taskPath);
  const migrationPath = path.join(root, 'tasks/000-nodejs-to-python-migration-status.md');
  await fs.mkdir(path.dirname(taskAbsolutePath), { recursive: true });
  await fs.writeFile(taskAbsolutePath, [
    '# gap.ask',
    '',
    '## 执行状态',
    '',
    '- 最近执行：2026-06-01',
    '- AgentLoop run id：`old-run`',
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(migrationPath, [
    '# 状态总表',
    '',
    '## 最近验证记录',
    '',
    '### `gap.ask`',
    '',
    '- 最近执行：旧日期',
    '',
    '已记录通过的 gate：',
    '',
    '- [x] Python pytest',
    '',
  ].join('\n'), 'utf8');

  const result = await syncTaskFileFromRun({
    cwd: root,
    taskPath,
    run: sampleRun,
    includeMigrationStatus: true,
  });

  assert.equal(result.update.changed, true);
  assert.match(await fs.readFile(taskAbsolutePath, 'utf8'), /AgentLoop 运行模式：`gate-only`/);
  assert.deepEqual(result.migrationStatus.changedCapabilities, ['gap.ask']);
});

test('syncTaskFileFromRun writes English execution status sections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-sync-english-run-'));
  const taskPath = 'agent-loop/tasks/sliderule-v2-runtime-closure-drivefull-01-demo-120.md';
  const taskAbsolutePath = path.join(root, taskPath);
  await fs.mkdir(path.dirname(taskAbsolutePath), { recursive: true });
  await fs.writeFile(taskAbsolutePath, [
    '# runtime closure',
    '',
    '## Execution status',
    '- Status: PENDING',
    '- Phase: 120-runtime-closure-e2e',
    '',
    '## Objective',
    'Exercise English status sync.',
    '',
  ].join('\n'), 'utf8');

  const result = await syncTaskFileFromRun({
    cwd: root,
    taskPath,
    run: sampleRun,
    includeMigrationStatus: false,
  });

  assert.equal(result.update.changed, true);
  const updated = await fs.readFile(taskAbsolutePath, 'utf8');
  assert.match(updated, /- Status: DONE_GATE_ONLY/);
  assert.match(updated, /- AgentLoop result: `DONE_GATE_ONLY`/);
  assert.match(updated, /## Objective/);
});

test('migrationCapabilityForTask resolves absolute discovered paths against repo cwd', () => {
  const repoRoot = 'C:/repo';
  const absoluteTaskPath = 'C:/repo/agent-loop/tasks/migrate-sliderule-gap-ask.md';
  assert.equal(
    migrationCapabilityForTask(absoluteTaskPath, repoRoot),
    'gap.ask'
  );
});

test('syncTaskStatus --all can map discovered tasks to migration capabilities', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-sync-all-'));
  const tasksDir = path.join(root, 'agent-loop', 'tasks');
  const migrationPath = path.join(tasksDir, '000-nodejs-to-python-migration-status.md');
  const gapTaskPath = path.join(tasksDir, 'migrate-sliderule-gap-ask.md');
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.writeFile(gapTaskPath, [
    '# gap.ask',
    '',
    '## 执行状态',
    '',
    '- 最近执行：2026-06-01',
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(migrationPath, [
    '# 状态总表',
    '',
    '## 最近验证记录',
    '',
    '### `gap.ask`',
    '',
    '- 最近执行：旧日期',
    '',
    '已记录通过的 gate：',
    '',
    '- [x] Python pytest',
    '',
  ].join('\n'), 'utf8');

  const runDir = path.join(root, '.agent-loop', 'runs', sampleRun.runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    runId: sampleRun.runId,
    status: sampleRun.status,
    options: { task: 'agent-loop/tasks/migrate-sliderule-gap-ask.md' },
    iterations: [],
  }, null, 2)}\n`, 'utf8');

  const result = await syncTaskStatus({
    cwd: root,
    all: true,
    includeMigrationStatus: true,
  });

  assert.equal(
    result.updates.find((entry) => entry.taskPath === 'agent-loop/tasks/migrate-sliderule-gap-ask.md')?.changed,
    true
  );
  assert.deepEqual(result.migrationStatus.changedCapabilities, ['gap.ask']);
});

test('tryAutoSyncTaskStatus reports failure without throwing', async () => {
  const result = await tryAutoSyncTaskStatus({
    cwd: 'C:/missing-root',
    task: 'agent-loop/tasks/missing.md',
    syncTaskStatus: true,
    syncMigrationStatus: false,
  }, sampleRun);

  assert.equal(result.failed, true);
  assert.match(result.error.message, /ENOENT|missing/i);
});

test('syncTaskStatus updates runnable task files from .agent-loop runs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-sync-'));
  const taskPath = 'agent-loop/tasks/migrate-sliderule-gap-ask.md';
  const taskAbsolutePath = path.join(root, taskPath);
  await fs.mkdir(path.dirname(taskAbsolutePath), { recursive: true });
  await fs.writeFile(taskAbsolutePath, [
    '# gap.ask',
    '',
    '## 执行状态',
    '',
    '- 状态：已实现并验证通过',
    '- 最近执行：2026-06-01',
    '- AgentLoop run id：`old-run`',
    '',
    '## 目标',
    '',
    '只做这一片。',
    '',
  ].join('\n'), 'utf8');

  const runDir = path.join(root, '.agent-loop', 'runs', sampleRun.runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    runId: sampleRun.runId,
    status: sampleRun.status,
    options: { task: taskPath },
    iterations: [],
    grokFix: null,
    codexReview: null,
  }, null, 2)}\n`, 'utf8');

  const result = await syncTaskStatus({
    cwd: root,
    taskPaths: [taskPath],
  });

  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].changed, true);
  const updated = await fs.readFile(taskAbsolutePath, 'utf8');
  assert.match(updated, /AgentLoop 运行模式：`gate-only`/);
  assert.doesNotMatch(updated, /`old-run`/);
});
