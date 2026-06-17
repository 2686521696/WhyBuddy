import path from 'node:path';
import { summarizeRunRecord } from './runSummary.js';

export function defaultPythonExe(repoRoot) {
  if (process.platform === 'win32') {
    return path.join(repoRoot, 'tws-ai-slide-rule-python', '.venv', 'Scripts', 'python.exe');
  }
  return path.join(repoRoot, 'tws-ai-slide-rule-python', '.venv', 'bin', 'python');
}

export function resolvePythonExe(repoRoot, pythonExe) {
  const configured = pythonExe || defaultPythonExe(repoRoot);
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

export function resolveQueueGate(gate, { repoRoot, pythonExe }) {
  const resolved = resolvePythonExe(repoRoot, pythonExe);
  return String(gate).replaceAll('{{pythonExe}}', resolved);
}

export function resolveQueueGates(gates, context) {
  return gates.map((gate) => resolveQueueGate(gate, context));
}

export function resolveEntryGates({ entry, gateSets, defaultGates, label }) {
  if (Array.isArray(entry.gates) && entry.gates.length > 0) {
    return entry.gates;
  }
  const gateKey = entry.gatesKey || 'gates';
  const gates = gateSets[gateKey];
  if (!gates) {
    throw new Error(`migration queue entry ${label} references unknown gatesKey: ${gateKey}`);
  }
  return gates.length ? gates : defaultGates;
}

export function resolveFixCwd(repoRoot, fixCwd) {
  if (!fixCwd || fixCwd === '.') return repoRoot;
  return path.resolve(repoRoot, fixCwd);
}

export function sanitizeWorktreeName(name) {
  const safe = String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) throw new Error('worktree name is empty after sanitization');
  return safe.slice(0, 80);
}

export function buildLoopArgsForQueueEntry({
  agentLoopRoot,
  repoRoot,
  entry,
  defaults = {},
  index = 0,
  gateSets = {},
  defaultGates = [],
  loopScript = path.join(agentLoopRoot, 'src', 'loop.js'),
}) {
  const label = entry.id || entry.task;
  const useWorktree = entry.useWorktree ?? defaults.useWorktree ?? false;
  const worktreeName = sanitizeWorktreeName(entry.worktreeName || entry.id || `task-${index + 1}`);
  const rawGates = resolveEntryGates({ entry, gateSets, defaultGates, label });
  const pythonExe = entry.pythonExe ?? defaults.pythonExe;
  const entryGates = resolveQueueGates(rawGates, { repoRoot, pythonExe });

  const args = [
    loopScript,
    '--cwd', repoRoot,
    '--task', entry.task,
    '--lang', entry.lang || defaults.lang || 'zh-CN',
    '--timeout-ms', String(entry.timeoutMs || defaults.timeoutMs || 1800000),
    '--max-iterations', String(entry.maxIterations ?? defaults.maxIterations ?? 3),
  ];

  for (const gate of entryGates) {
    args.push('--gate', gate);
  }

  if (useWorktree) {
    args.push('--create-worktree', worktreeName);
  } else {
    args.push('--fix-cwd', resolveFixCwd(repoRoot, entry.fixCwd ?? defaults.fixCwd ?? '.'));
  }

  if (entry.autoFix ?? defaults.autoFix ?? true) args.push('--auto-fix');

  const fixAgent = entry.fixAgent ?? defaults.fixAgent;
  if (fixAgent) args.push('--fix-agent', fixAgent);

  const skipReview = entry.skipReview ?? defaults.skipReview ?? true;
  if (skipReview) {
    args.push('--skip-review');
  } else {
    const reviewAgent = entry.reviewAgent ?? defaults.reviewAgent;
    if (reviewAgent) args.push('--review-agent', reviewAgent);
  }

  const scopedReview = entry.scopedReview ?? defaults.scopedReview;
  if (scopedReview != null) args.push('--scoped-review', String(scopedReview));

  const reviewMaxTurns = entry.reviewMaxTurns ?? defaults.reviewMaxTurns;
  if (reviewMaxTurns != null) args.push('--review-max-turns', String(reviewMaxTurns));
  if (entry.guardTests ?? defaults.guardTests ?? true) args.push('--guard-tests');
  if (entry.noSyncTaskStatus || defaults.noSyncTaskStatus) args.push('--no-sync-task-status');
  if (entry.noSyncMigrationStatus || defaults.noSyncMigrationStatus) args.push('--no-sync-migration-status');

  return args;
}

export function buildQueueSummaryFromState({ entry, state, exitCode = 0 }) {
  const label = entry.id || entry.task;
  const runRecord = summarizeRunRecord({
    runId: state?.runId || null,
    status: state?.status || null,
    task: entry.task,
    iterations: state?.iterations || [],
    grokFix: state?.grokFix || null,
    agentFix: state?.agentFix || null,
    codexReview: state?.codexReview || null,
    grokReview: state?.grokReview || null,
    agentReview: state?.agentReview || null,
    fixAgent: state?.options?.fixAgent || 'grok',
    reviewAgent: state?.options?.skipReview ? null : (state?.options?.reviewAgent || 'grok'),
  });

  return {
    id: label,
    task: entry.task,
    exitCode,
    ...runRecord,
  };
}