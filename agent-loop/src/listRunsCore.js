import fs from 'node:fs/promises';
import path from 'node:path';
import { parseRunIdDate, summarizeRunRecord } from './runSummary.js';

export async function listRuns({
  cwd,
  limit = 20,
  modes = [],
  statuses = [],
  tasks = [],
  timeZone = undefined,
} = {}) {
  if (!cwd) throw new Error('cwd is required');
  const modeSet = new Set(modes);
  const statusSet = new Set(statuses);
  const taskFilters = tasks.map(normalizeTaskPath).filter(Boolean);
  const runsDir = path.join(cwd, '.agent-loop', 'runs');
  let entries;
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const summaries = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const statePath = path.join(runsDir, runId, 'state.json');
    let state;
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch {
      continue;
    }
    summaries.push(summarizeRunRecord({
      runId: state.runId || runId,
      status: state.status,
      task: state.options?.task || state.task || null,
      iterations: state.iterations || [],
      grokFix: state.grokFix || null,
      agentFix: state.agentFix || null,
      codexReview: state.codexReview || null,
      grokReview: state.grokReview || null,
      agentReview: state.agentReview || null,
      fixAgent: state.options?.fixAgent || 'grok',
      reviewAgent: state.options?.skipReview ? null : (state.options?.reviewAgent || 'grok'),
      timeZone,
    }));
  }

  return summaries
    .filter((summary) => modeSet.size === 0 || modeSet.has(summary.runMode))
    .filter((summary) => statusSet.size === 0 || statusSet.has(summary.status))
    .filter((summary) => taskFilters.length === 0 || taskFilters.some((task) => matchesTask(summary.task, task)))
    .sort(compareRunSummaries)
    .slice(0, limit);
}

export function formatRunList(runs, { lang = 'en' } = {}) {
  const labels = lang === 'zh-CN'
    ? {
        empty: '没有找到 AgentLoop 运行记录。',
        localTime: '本地时间',
        runId: '运行 ID',
        status: '状态',
        task: '任务',
        mode: '模式',
        grok: 'Grok',
        codex: 'Codex',
        iterations: '轮次',
        yes: '是',
        no: '否',
      }
    : {
        empty: 'No AgentLoop runs found.',
        localTime: 'Local Time',
        runId: 'Run ID',
        status: 'Status',
        task: 'Task',
        mode: 'Mode',
        grok: 'Grok',
        codex: 'Codex',
        iterations: 'Iterations',
        yes: 'yes',
        no: 'no',
      };

  if (!runs.length) return `${labels.empty}\n`;
  const rows = [
    [labels.localTime, labels.status, labels.mode, labels.grok, labels.codex, labels.iterations, labels.task, labels.runId],
    ...runs.map((run) => [
      run.runTimeLocal || run.runId || '',
      run.status || '',
      run.runMode || '',
      run.grokRan ? labels.yes : labels.no,
      run.codexRan ? labels.yes : labels.no,
      String(run.iterations ?? 0),
      run.task || '',
      run.runId || '',
    ]),
  ];
  const widths = rows[0].map((_, column) => {
    return Math.max(...rows.map((row) => displayWidth(row[column])));
  });
  return `${rows.map((row) => {
    return row.map((cell, column) => padEndDisplay(cell, widths[column])).join('  ');
  }).join('\n')}\n`;
}

function padEndDisplay(value, width) {
  const text = String(value ?? '');
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function displayWidth(value) {
  return [...String(value ?? '')].reduce((width, char) => {
    return width + (char.charCodeAt(0) > 127 ? 2 : 1);
  }, 0);
}

function normalizeTaskPath(task) {
  return String(task || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchesTask(summaryTask, filterTask) {
  const summary = normalizeTaskPath(summaryTask);
  const filter = normalizeTaskPath(filterTask);
  if (!summary || !filter) return false;
  return summary === filter || summary.endsWith(`/${filter}`) || filter.endsWith(`/${summary}`);
}

function compareRunSummaries(a, b) {
  const aTime = parseRunIdDate(a.runId)?.getTime();
  const bTime = parseRunIdDate(b.runId)?.getTime();
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  if (Number.isFinite(aTime) && !Number.isFinite(bTime)) return -1;
  if (!Number.isFinite(aTime) && Number.isFinite(bTime)) return 1;
  return String(b.runId).localeCompare(String(a.runId));
}
