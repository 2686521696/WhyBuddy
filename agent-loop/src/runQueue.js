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

export function resolveQueueGate(gate, { repoRoot, pythonExe, taskFile }) {
  const resolved = resolvePythonExe(repoRoot, pythonExe);
  return String(gate)
    .replaceAll('{{pythonExe}}', resolved)
    .replaceAll('{{taskFile}}', taskFile || '')
    .replace(/^pnpm exec vitest\b/, quoteForPowershell(resolveNodeBin(repoRoot, 'vitest')))
    .replace(/^pnpm exec tsc\b/, quoteForPowershell(resolveNodeBin(repoRoot, 'tsc')));
}

export function resolveQueueGates(gates, context) {
  return gates.map((gate) => resolveQueueGate(gate, context));
}

export function resolveNodeBin(repoRoot, command) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  return path.join(repoRoot, 'node_modules', '.bin', executable);
}

function quoteForPowershell(value) {
  return `& "${value}"`;
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
  const entryGates = resolveQueueGates(rawGates, { repoRoot, pythonExe, taskFile: entry.task });

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

  const grokMaxTurns = entry.grokMaxTurns ?? defaults.grokMaxTurns;
  if (grokMaxTurns != null) args.push('--grok-max-turns', String(grokMaxTurns));

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

  const summary = {
    id: label,
    task: entry.task,
    exitCode,
    guardReason: state?.guardReason || null,
    worktreeError: state?.worktreeError || null,
    ...runRecord,
  };
  summary.outcome = classifyQueueOutcome({ summary, exitCode });
  return summary;
}

/**
 * Queue-level outcome for 24/7 triage:
 * - done: gate green / reviewed
 * - quarantined: suspected test tampering
 * - crashed: loop died before a meaningful fix attempt (seed/worktree/agent infra)
 * - failed: fix was attempted but task did not finish green
 */
export function classifyQueueOutcome({ summary, exitCode = 0 }) {
  const status = String(summary?.status || '');
  const iterations = Number(summary?.iterations ?? 0);
  const grokRan = Boolean(summary?.grokRan);
  const codexRan = Boolean(summary?.codexRan);
  const guardReason = summary?.guardReason || null;
  const worktreeError = summary?.worktreeError || null;

  if (status.startsWith('DONE_') && exitCode === 0) return 'done';
  if (guardReason === 'POSSIBLE_TEST_TAMPER') return 'quarantined';

  if (worktreeError) return 'crashed';
  if (status === 'HALT_AGENT_NOT_FOUND') return 'crashed';
  // Inadmissible task (no spec-derived success criteria): a task-level failure to
  // send back for specification, NOT an infra crash. The triage line carries the
  // exact status so it's distinguishable from a fix that was tried and missed.
  if (status === 'HALT_NO_SUCCESS_CRITERIA') return 'failed';

  const fixAttempted = grokRan || codexRan || iterations > 0;
  const infraStuck = !fixAttempted && !status.startsWith('DONE_');
  if (infraStuck && (exitCode !== 0 || status === 'PROBED' || status === 'INIT')) {
    return 'crashed';
  }
  if (status === 'HALT_HUMAN' && !fixAttempted) {
    return 'crashed';
  }

  return 'failed';
}
