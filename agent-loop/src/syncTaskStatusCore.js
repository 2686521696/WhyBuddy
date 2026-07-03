import fs from 'node:fs/promises';
import path from 'node:path';
import { listRuns } from './listRunsCore.js';

const ENGLISH_EXECUTION_STATUS_HEADING = '## Execution status';

const EXECUTION_STATUS_HEADING = '## 执行状态';
const TEMPLATE_MARKERS = [
  '模板文件',
  '任务模板已补中文',
  '不代表某个能力已经执行完成',
];

const MANAGED_FIELDS = [
  '最近执行',
  '最近确认',
  'AgentLoop run id',
  'AgentLoop 本地时间',
  'AgentLoop 结果',
  'AgentLoop 运行模式',
  'Grok 已运行',
  'Codex 已运行',
  'gate 结果',
];

const MIGRATION_STATUS_MAP = new Map([
  ['agent-loop/tasks/migrate-sliderule-gap-ask.md', 'gap.ask'],
  ['tasks/migrate-sliderule-gap-ask.md', 'gap.ask'],
  ['agent-loop/tasks/migrate-sliderule-intent-clarify.md', 'intent.clarify'],
  ['tasks/migrate-sliderule-intent-clarify.md', 'intent.clarify'],
  ['agent-loop/tasks/migrate-sliderule-critique-generate.md', 'critique.generate'],
  ['tasks/migrate-sliderule-critique-generate.md', 'critique.generate'],
  ['agent-loop/tasks/migrate-sliderule-synthesis-merge.md', 'synthesis.merge'],
  ['tasks/migrate-sliderule-synthesis-merge.md', 'synthesis.merge'],
  ['agent-loop/tasks/migrate-sliderule-rebuttal-resolve.md', 'rebuttal.resolve'],
  ['tasks/migrate-sliderule-rebuttal-resolve.md', 'rebuttal.resolve'],
  ['agent-loop/tasks/migrate-sliderule-counter-argue.md', 'counter.argue'],
  ['tasks/migrate-sliderule-counter-argue.md', 'counter.argue'],
  ['agent-loop/tasks/migrate-sliderule-report-write.md', 'report.write'],
  ['tasks/migrate-sliderule-report-write.md', 'report.write'],
  ['agent-loop/tasks/migrate-sliderule-structure-decompose.md', 'structure.decompose'],
  ['tasks/migrate-sliderule-structure-decompose.md', 'structure.decompose'],
  ['agent-loop/tasks/migrate-sliderule-risk-analyze.md', 'risk.analyze'],
  ['tasks/migrate-sliderule-risk-analyze.md', 'risk.analyze'],
  ['agent-loop/tasks/migrate-sliderule-evidence-search.md', 'evidence.search'],
  ['tasks/migrate-sliderule-evidence-search.md', 'evidence.search'],
]);

export async function syncTaskStatus({
  cwd,
  taskPaths = [],
  all = false,
  tasksDir = null,
  dryRun = false,
  includeMigrationStatus = false,
  migrationStatusPath = 'agent-loop/tasks/000-nodejs-to-python-migration-status.md',
  timeZone = undefined,
} = {}) {
  if (!cwd) throw new Error('cwd is required');

  const resolvedTasksDir = tasksDir || await resolveTasksDir(cwd);
  const resolvedTasks = await resolveTaskPaths({
    cwd,
    taskPaths,
    all,
    tasksDir: resolvedTasksDir,
  });
  const updates = [];

  for (const taskPath of resolvedTasks) {
    const runs = await listRuns({
      cwd,
      tasks: taskPathAliases(taskPath),
      limit: 1,
      timeZone,
    });
    if (!runs.length) {
      updates.push({
        taskPath,
        skipped: true,
        reason: 'no-matching-run',
      });
      continue;
    }

    updates.push(await syncSingleTaskFile({
      cwd,
      taskPath,
      run: runs[0],
      dryRun,
    }));
  }

  let migrationStatus = null;
  if (includeMigrationStatus) {
    migrationStatus = await syncMigrationStatusFile({
      cwd,
      migrationStatusPath,
      updates: updates.filter((entry) => entry.run),
      dryRun,
    });
  }

  return {
    updates,
    migrationStatus,
  };
}

export async function syncTaskFileFromRun({
  cwd,
  taskPath,
  run,
  includeMigrationStatus = true,
  dryRun = false,
} = {}) {
  if (!cwd) throw new Error('cwd is required');
  if (!taskPath) throw new Error('taskPath is required');
  if (!run) throw new Error('run is required');

  const update = await syncSingleTaskFile({ cwd, taskPath, run, dryRun });
  let migrationStatus = null;
  if (includeMigrationStatus && update.run) {
    migrationStatus = await syncMigrationStatusFile({
      cwd,
      migrationStatusPath: await resolveMigrationStatusPath(cwd),
      updates: [update],
      dryRun,
    });
  }

  return { update, migrationStatus };
}

export async function tryAutoSyncTaskStatus(activeOptions, runSummary) {
  if (activeOptions.syncTaskStatus === false) {
    return { skipped: true, reason: 'disabled' };
  }

  try {
    const syncResult = await syncTaskFileFromRun({
      cwd: activeOptions.cwd,
      taskPath: activeOptions.task,
      run: runSummary,
      includeMigrationStatus: activeOptions.syncMigrationStatus !== false,
    });
    const syncUpdate = syncResult.update;
    if (syncUpdate?.changed) {
      console.error(`Synced task status: ${syncUpdate.taskPath}`);
    } else if (syncUpdate?.skipped) {
      console.error(`Skipped task status sync (${syncUpdate.reason}): ${syncUpdate.taskPath || activeOptions.task}`);
    }
    if (syncResult.migrationStatus?.changedCapabilities?.length) {
      console.error(`Synced migration status: ${syncResult.migrationStatus.changedCapabilities.join(', ')}`);
    }
    return syncResult;
  } catch (error) {
    console.error(`Warning: task status sync failed: ${error.message}`);
    return { failed: true, error };
  }
}

export function updateExecutionStatusSection(markdown, run) {
  const englishSection = findSection(markdown, ENGLISH_EXECUTION_STATUS_HEADING);
  if (englishSection) {
    const fieldValues = buildEnglishManagedFieldValues(run);
    const updatedLines = upsertEnglishFieldLines(englishSection.bodyLines, fieldValues);
    const nextSectionBody = `${updatedLines.join('\n')}\n`;
    return `${englishSection.before}${ENGLISH_EXECUTION_STATUS_HEADING}\n${nextSectionBody}${englishSection.after}`;
  }

  const section = findSection(markdown, EXECUTION_STATUS_HEADING);
  if (!section) return markdown;

  const fieldValues = buildManagedFieldValues(run);
  const updatedLines = upsertFieldLines(section.bodyLines, fieldValues);
  const nextSectionBody = `${updatedLines.join('\n')}\n`;
  return `${section.before}${EXECUTION_STATUS_HEADING}\n${nextSectionBody}${section.after}`;
}

export function updateMigrationCapabilitySection(markdown, capability, run) {
  const heading = `### \`${capability}\``;
  const section = findSection(markdown, heading, { boundary: 'subsection' });
  if (!section) return markdown;

  const lines = [
    `- 最近执行：${formatExecutionDate(run)}`,
    `- AgentLoop run id：\`${run.runId}\``,
    `- AgentLoop 本地时间：\`${run.runTimeLocal}\``,
    `- AgentLoop 结果：\`${run.status}\``,
    `- AgentLoop 运行模式：\`${run.runMode}\``,
    `- Grok 已运行：\`${run.grokRan}\``,
    `- Codex 已运行：\`${run.codexRan}\``,
    '- AgentLoop 报告：`.agent-loop/latest/final-report.md`',
    `- 验证说明：${describeRunMode(run.runMode)}`,
  ];

  const preserved = section.bodyLines.filter((line) => {
    return line.startsWith('- [') || line.startsWith('已记录通过的 gate');
  });

  const nextBody = [...lines, ...(preserved.length ? ['', ...preserved] : [])].join('\n');
  return `${section.before}${heading}\n\n${nextBody}\n${section.after}`;
}

export function buildManagedFieldValues(run) {
  const values = new Map();
  values.set('最近执行', formatExecutionDate(run));
  values.set('最近确认', formatExecutionDate(run));
  values.set('AgentLoop run id', `\`${run.runId}\``);
  values.set('AgentLoop 本地时间', `\`${run.runTimeLocal}\``);
  values.set('AgentLoop 结果', `\`${run.status}\``);
  values.set('AgentLoop 运行模式', `\`${run.runMode}\``);
  values.set('Grok 已运行', `\`${run.grokRan}\``);
  values.set('Codex 已运行', `\`${run.codexRan}\``);
  values.set('gate 结果', describeGateResult(run));
  return values;
}

export function shouldSkipTaskFile(markdown) {
  return TEMPLATE_MARKERS.some((marker) => markdown.includes(marker));
}

export function buildEnglishManagedFieldValues(run) {
  const values = new Map();
  values.set('Status', run.status || '');
  values.set('Last execution', formatExecutionDate(run));
  values.set('AgentLoop run id', `\`${run.runId}\``);
  values.set('AgentLoop local time', `\`${run.runTimeLocal}\``);
  values.set('AgentLoop result', `\`${run.status}\``);
  values.set('AgentLoop run mode', `\`${run.runMode}\``);
  values.set('Grok ran', `\`${run.grokRan}\``);
  values.set('Codex ran', `\`${run.codexRan}\``);
  values.set('gate result', describeGateResult(run));
  return values;
}

function resolveTaskPaths({ cwd, taskPaths, all, tasksDir }) {
  if (taskPaths.length > 0) {
    return taskPaths.map((taskPath) => normalizeTaskPath(taskPath));
  }
  if (!all) {
    throw new Error('pass --task <path> one or more times, or use --all');
  }
  return discoverTaskFiles(cwd, tasksDir);
}

async function resolveMigrationStatusPath(cwd) {
  for (const candidate of [
    'agent-loop/tasks/000-nodejs-to-python-migration-status.md',
    'tasks/000-nodejs-to-python-migration-status.md',
  ]) {
    try {
      await fs.access(path.join(cwd, candidate));
      return candidate;
    } catch {
      continue;
    }
  }
  return 'agent-loop/tasks/000-nodejs-to-python-migration-status.md';
}

async function resolveTasksDir(cwd) {
  for (const candidate of ['tasks', 'agent-loop/tasks']) {
    try {
      const stat = await fs.stat(path.join(cwd, candidate));
      if (stat.isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  return 'agent-loop/tasks';
}

async function discoverTaskFiles(cwd, tasksDir) {
  const absoluteTasksDir = path.resolve(cwd, tasksDir);
  const entries = await fs.readdir(absoluteTasksDir, { withFileTypes: true });
  const prefix = tasksDir.replace(/\\/g, '/');
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => normalizeTaskPath(`${prefix}/${entry.name}`))
    .sort();
}

async function syncSingleTaskFile({ cwd, taskPath, run, dryRun }) {
  const taskFile = await resolveTaskFile(cwd, taskPath);
  const original = await fs.readFile(taskFile.absolutePath, 'utf8');
  if (shouldSkipTaskFile(original)) {
    return {
      taskPath: taskFile.relativePath,
      skipped: true,
      reason: 'template-or-non-runnable-task',
    };
  }

  if (!findExecutionStatusSection(original)) {
    return {
      taskPath: taskFile.relativePath,
      skipped: true,
      reason: 'no-execution-status-section',
      run,
    };
  }

  const next = updateExecutionStatusSection(original, run);
  if (next === original) {
    return {
      taskPath: taskFile.relativePath,
      skipped: true,
      reason: 'already-up-to-date',
      run,
    };
  }

  if (!dryRun) {
    await fs.writeFile(taskFile.absolutePath, next, 'utf8');
  }

  return {
    taskPath: taskFile.relativePath,
    changed: true,
    dryRun,
    run,
  };
}

async function syncMigrationStatusFile({ cwd, migrationStatusPath, updates, dryRun }) {
  const absolutePath = path.resolve(cwd, migrationStatusPath);
  let markdown;
  try {
    markdown = await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        path: migrationStatusPath,
        changedCapabilities: [],
        skipped: true,
        reason: 'migration-status-missing',
      };
    }
    throw error;
  }
  const changedCapabilities = [];

  for (const entry of updates) {
    const capability = migrationCapabilityForTask(entry.taskPath, cwd);
    if (!capability || !entry.run) continue;
    const next = updateMigrationCapabilitySection(markdown, capability, entry.run);
    if (next !== markdown) {
      markdown = next;
      changedCapabilities.push(capability);
    }
  }

  if (changedCapabilities.length > 0 && !dryRun) {
    await fs.writeFile(absolutePath, markdown, 'utf8');
  }

  return {
    path: migrationStatusPath,
    changedCapabilities,
    dryRun,
  };
}

function findSection(markdown, heading, { boundary = 'section' } = {}) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line === heading);
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isSectionBoundary(lines[i], boundary)) {
      end = i;
      break;
    }
  }

  return {
    before: `${lines.slice(0, start).join('\n')}${start > 0 ? '\n' : ''}`,
    bodyLines: lines.slice(start + 1, end),
    after: end < lines.length ? `${lines.slice(end).join('\n')}` : '',
  };
}

function findExecutionStatusSection(markdown) {
  return (
    findSection(markdown, EXECUTION_STATUS_HEADING)
    || findSection(markdown, ENGLISH_EXECUTION_STATUS_HEADING)
  );
}

function upsertFieldLines(bodyLines, fieldValues) {
  const managedKeys = new Set(MANAGED_FIELDS);
  const seen = new Set();
  const result = [];

  for (const line of bodyLines) {
    const match = line.match(/^- ([^：:]+)[：:]\s*(.*)$/);
    if (!match) {
      result.push(line);
      continue;
    }

    const [, rawKey] = match;
    const key = rawKey.trim();
    if (!managedKeys.has(key) || !fieldValues.has(key)) {
      result.push(line);
      continue;
    }

    seen.add(key);
    result.push(`- ${key}：${fieldValues.get(key)}`);
  }

  const missing = MANAGED_FIELDS.filter((key) => !seen.has(key) && fieldValues.has(key));
  if (missing.length > 0) {
    const insertIndex = findManagedFieldInsertIndex(result);
    const toInsert = missing.map((key) => `- ${key}：${fieldValues.get(key)}`);
    result.splice(insertIndex, 0, ...toInsert);
  }

  return result;
}

function upsertEnglishFieldLines(bodyLines, fieldValues) {
  const managedKeys = new Set(fieldValues.keys());
  const seen = new Set();
  const result = [];

  for (const line of bodyLines) {
    const match = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!match) {
      result.push(line);
      continue;
    }

    const [, rawKey] = match;
    const key = rawKey.trim();
    if (!managedKeys.has(key)) {
      result.push(line);
      continue;
    }

    seen.add(key);
    result.push(`- ${key}: ${fieldValues.get(key)}`);
  }

  const missing = [...fieldValues.keys()].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    const insertIndex = findManagedFieldInsertIndex(result);
    const toInsert = missing.map((key) => `- ${key}: ${fieldValues.get(key)}`);
    result.splice(insertIndex, 0, ...toInsert);
  }

  return result;
}

function findManagedFieldInsertIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('### ')) return i;
  }
  return lines.length;
}

function formatExecutionDate(run) {
  return run.runTimeLocal?.slice(0, 10) || run.runId || '';
}

function describeGateResult(run) {
  if (run.status === 'DONE_GATE_ONLY' || run.runMode === 'gate-only') {
    return 'baseline gate 为 green，failure count 为 0';
  }
  if (run.status?.startsWith('DONE_')) {
    return `最终状态为 \`${run.status}\``;
  }
  return `最近状态为 \`${run.status}\``;
}

function describeRunMode(runMode) {
  if (runMode === 'gate-only') {
    return '这轮只是 gate-only 验证，不是 Grok 修复执行，也不是 Codex review。';
  }
  if (runMode === 'grok-fix') {
    return '这轮包含 Grok 修复，并且 gate 已通过；未跑 Codex review。';
  }
  if (runMode === 'codex-review') {
    return '这轮只跑了 Codex review，没有 Grok 修复。';
  }
  if (runMode === 'grok-fix+codex-review') {
    return '这轮先做了 Grok 修复，随后又跑了 Codex review。';
  }
  return `最近运行模式为 \`${runMode}\`。`;
}

function normalizeTaskPath(taskPath) {
  return String(taskPath).replace(/\\/g, '/').replace(/^\.\//, '');
}

async function resolveTaskFile(cwd, taskPath) {
  for (const alias of taskPathAliases(taskPath)) {
    const absolutePath = path.resolve(cwd, alias);
    try {
      await fs.access(absolutePath);
      return { relativePath: alias, absolutePath };
    } catch {
      continue;
    }
  }
  const relativePath = normalizeTaskPath(taskPath);
  return {
    relativePath,
    absolutePath: path.resolve(cwd, relativePath),
  };
}

export function migrationCapabilityForTask(taskPath, cwd = process.cwd()) {
  const candidates = new Set([
    normalizeTaskPath(taskPath),
    ...taskPathAliases(taskPath),
  ]);
  try {
    candidates.add(normalizeTaskPath(path.relative(cwd, taskPath)));
  } catch {
    // Keep lookup candidates derived from the original task path only.
  }
  for (const candidate of candidates) {
    if (MIGRATION_STATUS_MAP.has(candidate)) {
      return MIGRATION_STATUS_MAP.get(candidate);
    }
  }
  return null;
}

function taskPathAliases(taskPath) {
  const normalized = normalizeTaskPath(taskPath);
  const aliases = new Set([normalized]);
  if (normalized.startsWith('agent-loop/tasks/')) {
    aliases.add(normalized.slice('agent-loop/'.length));
  } else if (normalized.startsWith('tasks/')) {
    aliases.add(`agent-loop/${normalized}`);
  }
  return [...aliases];
}

function isSectionBoundary(line, boundary) {
  if (boundary === 'subsection') {
    return line.startsWith('### ') || isH2Heading(line);
  }
  return isH2Heading(line);
}

function isH2Heading(line) {
  return /^## [^#]/.test(line);
}
