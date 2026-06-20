import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveAgentRoles } from './phaseLabels';
import type { LoopState } from './types';

export function resolveLogRoot(state: LoopState | null, repoRoot: string): string {
  const runDir = state?.artifacts?.runDir;
  if (runDir) {
    return path.isAbsolute(runDir) ? runDir : path.resolve(repoRoot, runDir);
  }
  return path.join(repoRoot, '.agent-loop', 'latest');
}

const TERMINAL_STATUSES = new Set([
  'DONE_REVIEWED',
  'DONE_FIXED',
  'DONE_GATE_ONLY',
  'HALT_HUMAN',
  'HALT_NO_CHANGES',
  'HALT_NO_PROGRESS',
  'HALT_BUDGET',
]);

export async function resolveActiveLogPath(latestRoot: string, state: LoopState | null): Promise<string> {
  const candidates = await resolveActiveLogCandidates(latestRoot, state);
  const fallback = candidates[0] || path.join(latestRoot, 'review-output.grok.stdout.log');
  return pickFirstReadableLog(candidates, fallback);
}

export async function resolveActiveLogCandidates(latestRoot: string, state: LoopState | null): Promise<string[]> {
  const status = state?.status;
  const { fixAgent, reviewAgent } = resolveAgentRoles(state);
  const candidates: string[] = [];

  if (status === 'GROK_REVIEW' || status === 'CODEX_REVIEW') {
    pushReviewLogs(candidates, latestRoot, reviewAgent);
    return candidates;
  }

  const inFixPhase = status === 'GROK_FIX'
    || status === 'CODEX_FIX'
    || status === 'BUDGET_LOOP_HEAD';
  if (inFixPhase) {
    await pushFixLogs(candidates, latestRoot, fixAgent, state);
    return candidates;
  }

  if (status && TERMINAL_STATUSES.has(status)) {
    if (reviewAgentRan(state)) {
      pushReviewLogs(candidates, latestRoot, reviewAgent);
    }
    if (fixAgentRan(state)) {
      await pushFixLogs(candidates, latestRoot, fixAgent, state);
    }
    if (candidates.length) return candidates;
  }

  pushReviewLogs(candidates, latestRoot, reviewAgent);
  await pushFixLogs(candidates, latestRoot, fixAgent, state);
  return candidates;
}

export async function findNewestFixLog(latestRoot: string, prefix: string, iteration: number): Promise<string | null> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(latestRoot);
  } catch {
    return null;
  }

  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const detailedPattern = new RegExp(`^${escapedPrefix}\\.${iteration}\\.(\\d+)\\.stderr\\.log$`);
  const aliasPattern = new RegExp(`^${escapedPrefix}\\.${iteration}\\.stderr\\.log$`);
  const candidates: Array<{ filePath: string; attempt: number; detailed: boolean; mtimeMs: number }> = [];

  for (const name of entries) {
    const detailedMatch = detailedPattern.exec(name);
    const aliasMatch = !detailedMatch ? aliasPattern.exec(name) : null;
    if (!detailedMatch && !aliasMatch) continue;

    const filePath = path.join(latestRoot, name);
    let mtimeMs = 0;
    try {
      const stat = await fs.stat(filePath);
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }

    candidates.push({
      filePath,
      attempt: detailedMatch ? Number.parseInt(detailedMatch[1], 10) : 0,
      detailed: Boolean(detailedMatch),
      mtimeMs,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.detailed !== b.detailed) return a.detailed ? -1 : 1;
    if (a.attempt !== b.attempt) return b.attempt - a.attempt;
    return b.mtimeMs - a.mtimeMs;
  });

  return candidates[0].filePath;
}

async function pickFirstReadableLog(candidates: string[], fallback: string): Promise<string> {
  for (const candidate of candidates) {
    if (await fileHasContent(candidate)) return candidate;
  }
  return fallback;
}

async function fileHasContent(filePath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim().length > 0;
  } catch {
    return false;
  }
}

function pushReviewLogs(candidates: string[], latestRoot: string, reviewAgent: string | null): void {
  if (reviewAgent === 'grok') {
    candidates.push(
      path.join(latestRoot, 'review-output.grok.stdout.log'),
      path.join(latestRoot, 'review-output.grok.stderr.log'),
    );
    return;
  }
  if (reviewAgent === 'codex') {
    candidates.push(
      path.join(latestRoot, 'codex-review.stdout.log'),
      path.join(latestRoot, 'codex-review.stderr.log'),
    );
  }
}

async function pushFixLogs(
  candidates: string[],
  latestRoot: string,
  fixAgent: string,
  state: LoopState | null,
): Promise<void> {
  const iteration = state?.currentIteration
    || state?.iterations?.at(-1)?.iteration
    || 1;
  const prefix = fixAgent === 'codex' ? 'fix-output.codex' : 'grok-output';
  const resolved = await findNewestFixLog(latestRoot, prefix, iteration);
  if (resolved) {
    candidates.push(resolved, swapLogStream(resolved, 'stdout'));
    return;
  }
  candidates.push(
    path.join(latestRoot, `${prefix}.${iteration}.stderr.log`),
    path.join(latestRoot, `${prefix}.${iteration}.stdout.log`),
  );
}

function swapLogStream(filePath: string, stream: 'stderr' | 'stdout'): string {
  return filePath.replace(/\.(stderr|stdout)\.log$/, `.${stream}.log`);
}

function reviewAgentRan(state: LoopState | null): boolean {
  return Boolean(state?.grokReview || state?.codexReview || state?.agentReview);
}

function fixAgentRan(state: LoopState | null): boolean {
  return Boolean(
    state?.iterations?.length
    || state?.grokFix
    || state?.agentFix
    || state?.currentIteration,
  );
}

const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function formatAgentLogTail(raw: string, maxLines = 6): string {
  const trimmed = stripAnsi(raw).trim();
  if (!trimmed) return '';

  try {
    const outer = JSON.parse(trimmed) as { text?: unknown };
    if (typeof outer.text === 'string' && outer.text.trim()) {
      try {
        const inner = JSON.parse(outer.text) as unknown;
        return JSON.stringify(inner, null, 2);
      } catch {
        return outer.text.trim();
      }
    }
    return JSON.stringify(outer, null, 2);
  } catch {
    // fall through to plain-text tail
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-maxLines).join('\n');
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}
