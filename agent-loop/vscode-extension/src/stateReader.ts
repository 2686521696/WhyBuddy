import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveActiveLogPath } from './activeLog';
import { activeAgentLabel, buildPipelineSteps, describeSnapshot, formatElapsed, phaseLabel, resolveAgentRoles } from './phaseLabels';
import { latestDir, queuePath } from './paths';
import { summarizeStateRun } from './runSummary';

export { findNewestFixLog, resolveActiveLogPath } from './activeLog';
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
    const lines = stripAnsi(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return { tail: lines.slice(-maxLines).join('\n'), bytes };
  } catch {
    return { tail: '', bytes: 0 };
  }
}

export async function buildRunSnapshot(repoRoot: string, phaseStartedAt: number, runStartedAt: number): Promise<RunSnapshot> {
  const state = await readJsonFile<LoopState>(path.join(latestDir(repoRoot), 'state.json'));
  const queue = await readJsonFile<QueueFile>(queuePath(repoRoot));
  const queueDefaults = queue?.defaults ?? null;
  const activeLogPath = await resolveActiveLogPath(latestDir(repoRoot), state);
  const activeLog = await readTextTail(activeLogPath);
  const { details, taskLabel } = describeSnapshot(state, queueDefaults);
  const summary = state ? summarizeStateRun(state, state.runId || 'latest') : null;
  const { fixAgent, reviewAgent } = resolveAgentRoles(state, queueDefaults);
  const now = Date.now();

  return {
    state,
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