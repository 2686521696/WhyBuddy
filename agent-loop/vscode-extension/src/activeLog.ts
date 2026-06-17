import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveAgentRoles } from './phaseLabels';
import type { LoopState } from './types';

export async function resolveActiveLogPath(latestRoot: string, state: LoopState | null): Promise<string> {
  const status = state?.status;
  const { fixAgent } = resolveAgentRoles(state);

  if (status === 'GROK_REVIEW') {
    return path.join(latestRoot, 'review-output.grok.stderr.log');
  }
  if (status === 'CODEX_REVIEW') {
    return path.join(latestRoot, 'codex-review.stderr.log');
  }

  const inFixPhase = status === 'GROK_FIX'
    || status === 'CODEX_FIX'
    || status === 'BUDGET_LOOP_HEAD';
  if (inFixPhase) {
    const iteration = state?.currentIteration
      || state?.iterations?.at(-1)?.iteration
      || 1;
    const prefix = fixAgent === 'codex' ? 'fix-output.codex' : 'grok-output';
    const resolved = await findNewestFixLog(latestRoot, prefix, iteration);
    if (resolved) return resolved;
    return path.join(latestRoot, `${prefix}.${iteration}.stderr.log`);
  }

  return path.join(latestRoot, 'codex-review.stderr.log');
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