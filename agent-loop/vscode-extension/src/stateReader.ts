import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { formatAgentLogTail, resolveActiveLogPath, resolveLogRoot } from './activeLog';
import { activeAgentLabel, buildPipelineSteps, describeSnapshot, formatElapsed, phaseLabel, resolveAgentRoles } from './phaseLabels';
import { latestDir, queuePath } from './paths';
import { summarizeStateRun } from './runSummary';

export { findNewestFixLog, formatAgentLogTail, resolveActiveLogCandidates, resolveActiveLogPath, resolveLogRoot } from './activeLog';
import type { LoopState, QueueFile, RunSnapshot, RunSummaryItem } from './types';

const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

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

export async function buildRunSnapshot(repoRoot: string, phaseStartedAt: number, runStartedAt: number): Promise<RunSnapshot> {
  const state = await readJsonFile<LoopState>(path.join(latestDir(repoRoot), 'state.json'));
  const queue = await readJsonFile<QueueFile>(queuePath(repoRoot));
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
  const now = Date.now();

  return {
    state,
    queueRunning: false,
    agentTail: activeLog.tail,
    agentLogBytes: activeLog.bytes,
    taskLabel,
    phaseLabel: phaseLabel(state?.status),
    details,
    elapsedMs: now - runStartedAt,
    phaseElapsedMs: now - phaseStartedAt,
    updatedAt: now,
    pipelineSteps: buildPipelineSteps(state, queueDefaults),
    fixAgent,
    reviewAgent,
    runMode: summary?.runMode || 'unknown',
  };
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

export function snapshotStatusLine(snapshot: RunSnapshot): string {
  const status = snapshot.state?.status || 'IDLE';
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