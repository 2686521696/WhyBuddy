import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { formatAgentLogTail, resolveActiveLogPath, resolveLogRoot } from './activeLog';
import { resolveDisplayGate } from './gateSummary';
import { activeAgentLabel, buildPipelineSteps, describeSnapshot, formatElapsed, phaseLabel, resolveAgentRoles } from './phaseLabels';
import { parseRunIdDate, summarizeStateRun } from './runSummary';

export { findNewestFixLog, formatAgentLogTail, resolveActiveLogCandidates, resolveActiveLogPath, resolveLogRoot } from './activeLog';
import type { FinalReportJson, LandingStatus, LoopState, QueueFile, QueueOverview, QueueOverviewItem, RunSnapshot, RunSummaryItem } from './types';

interface QueueOutcomesFile {
  tasks?: Record<string, {
    lastStatus?: string;
    lastOutcome?: string;
    lastRunId?: string;
    autoDisabled?: boolean;
    applyStatus?: string;
    applyErrorKind?: string;
    applyErrorFiles?: string[];
    applyError?: string;
    worktreeErrorFiles?: string[];
  }>;
}

const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TERMINAL_STATUS_RE = /^(DONE_|HALT_|PAUSED_)/;
const ACTIVE_STATUS_RE = /^(CODEX_FIX|GROK_FIX|CODEX_REVIEW|GROK_REVIEW|BUDGET_LOOP_HEAD|REVIEW_NEEDS_CHANGES)$/;
const STALE_BUFFER_MS = 60_000;

export interface BuildSnapshotOptions {
  statePath?: string;
  queueFilePath?: string;
  now?: () => number;
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readTextTail(filePath: string, maxLines = 6): Promise<{ tail: string; bytes: number }> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const bytes = Buffer.byteLength(raw, 'utf8');
    return { tail: formatAgentLogTail(raw, maxLines), bytes };
  } catch {
    return { tail: '', bytes: 0 };
  }
}

export async function buildRunSnapshot(
  repoRoot: string,
  phaseStartedAt: number,
  runStartedAt: number,
  options: BuildSnapshotOptions = {},
): Promise<RunSnapshot> {
  const statePath = options.statePath || path.join(defaultLatestDir(repoRoot), 'state.json');
  return buildRunSnapshotFromStatePath(repoRoot, statePath, {
    ...options,
    phaseStartedAt,
    runStartedAt,
  });
}

export async function buildRunSnapshotFromStatePath(
  repoRoot: string,
  statePath: string,
  options: BuildSnapshotOptions & { phaseStartedAt?: number; runStartedAt?: number } = {},
): Promise<RunSnapshot> {
  const state = await readJsonFile<LoopState>(statePath);
  const queue = await readJsonFile<QueueFile>(options.queueFilePath || defaultQueuePath(repoRoot));
  const queueDefaults = queue?.defaults ?? null;
  const logRoot = resolveLogRoot(state, repoRoot);
  const activeLogPath = await resolveActiveLogPath(logRoot, state);
  let activeLog = await readTextTail(activeLogPath);
  if (!activeLog.tail) {
    activeLog = await readProgressHint(logRoot, state);
  }
  const { details, taskLabel } = describeSnapshot(state, queueDefaults);
  const summary = state ? summarizeStateRun(state, state.runId || 'latest') : null;
  const { fixAgent, reviewAgent } = resolveAgentRoles(state, queueDefaults);
  const now = options.now?.() ?? Date.now();
  const runStartedAt = options.runStartedAt ?? inferRunStartedAt(state, now);
  const terminalEndedAt = await inferTerminalEndedAt(state, statePath);
  const staleRun = await detectStaleRun(state, statePath, now);
  const displayStatus = staleRun ? 'STALE_INTERRUPTED' : (state?.status ?? null);
  const elapsedAt = terminalEndedAt ?? (staleRun ? now - staleRun.stateAgeMs : now);
  const displayGate = resolveDisplayGate(state);
  const landing = await readRunArtifact<LandingStatus>(state, repoRoot, 'landing.json');
  const finalReport = await readRunArtifact<FinalReportJson>(state, repoRoot, 'final-report.json');
  const detailsWithStale = staleRun
    ? [`运行中断: ${staleRun.status} 超过 ${formatElapsed(staleRun.timeoutMs)} 未更新`, ...details]
    : details;

  return {
    state,
    statePath,
    queueRunning: false,
    agentTail: activeLog.tail,
    agentLogBytes: activeLog.bytes,
    taskLabel,
    phaseLabel: phaseLabel(displayStatus ?? state?.status),
    displayStatus,
    staleRun,
    details: detailsWithStale,
    elapsedMs: Math.max(0, elapsedAt - runStartedAt),
    phaseElapsedMs: Math.max(0, now - (options.phaseStartedAt ?? runStartedAt)),
    updatedAt: now,
    pipelineSteps: buildPipelineSteps(state, queueDefaults),
    fixAgent,
    reviewAgent,
    runMode: summary?.runMode || 'unknown',
    displayGate,
    landing,
    finalReport,
    guardPolicy: state?.guardPolicy ?? finalReport?.guardPolicy ?? null,
  };
}

async function readRunArtifact<T>(state: LoopState | null, repoRoot: string, fileName: string): Promise<T | null> {
  const runDir = resolveLogRoot(state, repoRoot);
  return readJsonFile<T>(path.join(runDir, fileName));
}

export async function listRecentRuns(repoRoot: string, limit = 20): Promise<RunSummaryItem[]> {
  const dir = path.join(repoRoot, '.agent-loop', 'runs');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const items: RunSummaryItem[] = [];
  for (const runId of entries) {
    const statePath = path.join(dir, runId, 'state.json');
    const state = await readJsonFile<LoopState>(statePath);
    if (!state) continue;
    let mtimeMs = 0;
    try {
      const stat = await fs.stat(statePath);
      mtimeMs = stat.mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    const summary = summarizeStateRun(state, runId);
    items.push({
      runId: summary.runId || runId,
      status: summary.status || state.status || 'UNKNOWN',
      task: summary.task || state.options?.task || '—',
      fixAgent: summary.fixAgent,
      reviewAgent: summary.reviewAgent,
      runMode: summary.runMode,
      grokRan: summary.grokRan,
      codexRan: summary.codexRan,
      iterations: summary.iterations,
      mtimeMs,
    });
  }

  return items.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

export async function findLatestRunForTask(
  repoRoot: string,
  taskPath: string,
): Promise<{ runId: string; statePath: string } | null> {
  const dir = path.join(repoRoot, '.agent-loop', 'runs');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }

  const normalizedTask = normalizeTaskPath(taskPath);
  let best: { runId: string; statePath: string; mtimeMs: number } | null = null;
  for (const runId of entries) {
    const statePath = path.join(dir, runId, 'state.json');
    const state = await readJsonFile<LoopState>(statePath);
    if (!state || normalizeTaskPath(state.options?.task || '') !== normalizedTask) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await fs.stat(statePath)).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    if (!best || mtimeMs > best.mtimeMs) {
      best = { runId, statePath, mtimeMs };
    }
  }
  return best ? { runId: best.runId, statePath: best.statePath } : null;
}

export async function readQueueOutcomes(repoRoot: string): Promise<QueueOutcomesFile> {
  const file = await readJsonFile<QueueOutcomesFile>(
    path.join(repoRoot, '.agent-loop', 'queue-outcomes.json'),
  );
  return file ?? { tasks: {} };
}

// Merge the queue definition (membership/order) with per-task queue outcomes and
// the currently-running task, into the model the overview view renders.
export async function buildQueueOverview(
  repoRoot: string,
  options: {
    queueFilePath?: string;
    runningTaskPath?: string | null;
    queueRunning?: boolean;
    currentRunStale?: boolean;
  } = {},
): Promise<QueueOverview> {
  const queue = await readJsonFile<QueueFile>(options.queueFilePath || defaultQueuePath(repoRoot));
  const outcomes = await readQueueOutcomes(repoRoot);
  const runningTask = options.runningTaskPath ? normalizeTaskPath(options.runningTaskPath) : null;

  const tasks: QueueOverviewItem[] = (queue?.tasks || []).map((task) => {
    const id = task.id || task.task;
    const record = outcomes.tasks?.[id];
    const running = Boolean(options.queueRunning)
      && !options.currentRunStale
      && runningTask !== null
      && normalizeTaskPath(task.task) === runningTask;
    return {
      id,
      task: task.task,
      enabled: task.enabled !== false,
      outcome: record?.lastOutcome ?? null,
      outcomeGroup: classifyOutcomeGroup(record?.lastOutcome ?? null, record?.lastStatus ?? null),
      status: record?.lastStatus ?? null,
      lastRunId: record?.lastRunId ?? null,
      autoDisabled: Boolean(record?.autoDisabled),
      applyStatus: record?.applyStatus ?? null,
      applyErrorKind: record?.applyErrorKind ?? null,
      applyErrorFiles: Array.isArray(record?.applyErrorFiles) ? record.applyErrorFiles : [],
      applyError: record?.applyError ?? null,
      worktreeErrorFiles: Array.isArray(record?.worktreeErrorFiles) ? record.worktreeErrorFiles : [],
      running,
      stale: Boolean(options.currentRunStale)
        && runningTask !== null
        && normalizeTaskPath(task.task) === runningTask,
    };
  });

  const counts = {
    total: tasks.length,
    done: 0,
    applied: 0,
    reviewed: 0,
    noDiff: 0,
    applyConflict: 0,
    human: 0,
    failed: 0,
    crashed: 0,
    quarantined: 0,
    stopped: 0,
    running: 0,
    pending: 0,
  };
  for (const item of tasks) {
    if (item.running) {
      counts.running += 1;
    } else if (item.outcomeGroup === 'applied') {
      counts.applied += 1;
      counts.done += 1;
    } else if (item.outcomeGroup === 'reviewed') {
      counts.reviewed += 1;
      counts.done += 1;
    } else if (item.outcomeGroup === 'noDiff') {
      counts.noDiff += 1;
    } else if (item.outcomeGroup === 'applyConflict') {
      counts.applyConflict += 1;
    } else if (item.outcomeGroup === 'human') {
      counts.human += 1;
    } else if (item.outcomeGroup === 'failed') {
      counts.failed += 1;
    } else if (item.outcomeGroup === 'crashed') {
      counts.crashed += 1;
    } else if (item.outcomeGroup === 'quarantined') {
      counts.quarantined += 1;
    } else if (item.outcomeGroup === 'stopped') {
      counts.stopped += 1;
    } else {
      counts.pending += 1;
    }
  }

  return { tasks, counts, queueRunning: Boolean(options.queueRunning) };
}

function classifyOutcomeGroup(outcome: string | null, status: string | null): string | null {
  if (status === 'DONE_REVIEWED_NO_DIFF') return 'noDiff';
  if (status === 'APPLY_CONFLICT') return 'applyConflict';
  if (status === 'DIRTY_MAIN_NEEDS_COMMIT' || status === 'HALT_STOPPED') return 'stopped';
  if (status === 'HALT_HUMAN') return 'human';
  if (outcome === 'done') {
    if (status === 'DONE_REVIEWED') return 'reviewed';
    return 'applied';
  }
  return outcome;
}

export function snapshotStatusLine(snapshot: RunSnapshot): string {
  const status = snapshot.displayStatus || snapshot.state?.status || 'IDLE';
  const parts = [
    `${phaseLabel(status)}`,
    `总耗时 ${formatElapsed(snapshot.elapsedMs)}`,
    `模式 ${snapshot.runMode}`,
    `agent ${activeAgentLabel(status, snapshot.state, { fixAgent: snapshot.fixAgent, reviewAgent: snapshot.reviewAgent })}`,
  ];
  if (snapshot.details.length) parts.push(snapshot.details.join(' · '));
  return parts.join(' | ');
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

function defaultLatestDir(repoRoot: string): string {
  return path.join(repoRoot, '.agent-loop', 'latest');
}

function defaultQueuePath(repoRoot: string): string {
  return path.join(repoRoot, 'agent-loop', 'scripts', 'migration-queue.json');
}

function normalizeTaskPath(taskPath: string): string {
  return taskPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^agent-loop\//, '');
}

function inferRunStartedAt(state: LoopState | null, fallback: number): number {
  const parsed = parseRunIdDate(state?.runId);
  return parsed?.getTime() ?? fallback;
}

async function inferTerminalEndedAt(state: LoopState | null, statePath: string): Promise<number | null> {
  const status = state?.status || '';
  if (!TERMINAL_STATUS_RE.test(status)) return null;

  const candidates = collectEndedAtValues(state);
  for (const value of candidates) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }

  try {
    return (await fs.stat(statePath)).mtimeMs;
  } catch {
    return null;
  }
}

async function detectStaleRun(
  state: LoopState | null,
  statePath: string,
  now: number,
): Promise<RunSnapshot['staleRun']> {
  const status = state?.status || '';
  if (!ACTIVE_STATUS_RE.test(status)) return null;

  let stateAgeMs = 0;
  try {
    const stat = await fs.stat(statePath);
    stateAgeMs = Math.max(0, now - stat.mtimeMs);
  } catch {
    return null;
  }

  const timeoutMs = state?.options?.timeoutMs ?? 30 * 60 * 1000;
  if (stateAgeMs <= timeoutMs + STALE_BUFFER_MS) return null;

  return {
    status,
    reason: 'active-state-stale',
    stateAgeMs,
    timeoutMs,
  };
}

function collectEndedAtValues(state: LoopState | null): string[] {
  const values: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value) values.push(value);
  };
  push(state?.agentReview?.endedAt);
  push(state?.codexReview?.endedAt);
  push(state?.grokReview?.endedAt);
  push(state?.agentFix?.endedAt);
  push(state?.grokFix?.endedAt);

  const iterations = Array.isArray(state?.iterations) ? state.iterations : [];
  for (let i = iterations.length - 1; i >= 0; i -= 1) {
    const iteration = iterations[i];
    push(iteration?.agentFix?.endedAt);
    push(iteration?.grokFix?.endedAt);
    const attempts = Array.isArray(iteration?.attempts) ? iteration.attempts : [];
    for (let j = attempts.length - 1; j >= 0; j -= 1) {
      push(attempts[j]?.agentFix?.endedAt);
      push(attempts[j]?.grokFix?.endedAt);
    }
    const gateRuns = Array.isArray(iteration?.gateSnapshot?.runs) ? iteration.gateSnapshot.runs : [];
    for (let j = gateRuns.length - 1; j >= 0; j -= 1) {
      push(gateRuns[j]?.endedAt);
    }
  }

  const baselineRuns = Array.isArray(state?.baselineGateSnapshot?.runs) ? state.baselineGateSnapshot.runs : [];
  for (let i = baselineRuns.length - 1; i >= 0; i -= 1) {
    push(baselineRuns[i]?.endedAt);
  }

  return values;
}

async function readProgressHint(
  logRoot: string,
  state: LoopState | null,
): Promise<{ tail: string; bytes: number }> {
  const status = state?.status || '';
  if (status === 'GROK_FIX' || status === 'CODEX_FIX' || status === 'BUDGET_LOOP_HEAD') {
    const request = await readTextTail(path.join(logRoot, 'grok-request.1.md'), 4);
    if (request.tail) {
      return { tail: `（Grok 修复中，尚无 stdout）\n${request.tail}`, bytes: request.bytes };
    }
  }
  if (status === 'BASELINE_GATE_RESULT' || status === 'WORKTREE_READY' || status === 'INIT' || status === 'PROBED') {
    const gate = await readTextTail(path.join(logRoot, 'baseline-gate-1.stdout.log'), 4);
    if (gate.tail) {
      return { tail: `（Gate 输出）\n${gate.tail}`, bytes: gate.bytes };
    }
  }
  return { tail: '', bytes: 0 };
}
