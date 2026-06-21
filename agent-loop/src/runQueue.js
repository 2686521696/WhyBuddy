import path from 'node:path';
import { LoopApplyError } from './loopApply.js';
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

export function filterQueueTasks(tasks, { only = null, from = null, limit = null } = {}) {
  let selected = (tasks || []).filter((entry) => entry.enabled !== false);

  if (only) {
    const match = selected.find((entry) => (entry.id || entry.task) === only || entry.task === only);
    if (!match) throw new Error(`--only target not found: ${only}`);
    selected = [match];
  }

  if (from) {
    const index = selected.findIndex((entry) => (entry.id || entry.task) === from || entry.task === from);
    if (index < 0) throw new Error(`--from target not found: ${from}`);
    selected = selected.slice(index);
  }

  if (limit != null) {
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1) throw new Error('--limit requires a positive integer');
    selected = selected.slice(0, count);
  }

  return selected;
}

export function buildQueueCompletionMessage({
  done = 0,
  failed = 0,
  crashed = 0,
  quarantined = 0,
  skipped = 0,
  stopped = 0,
  total = 0,
} = {}) {
  const clean = failed === 0 && crashed === 0 && quarantined === 0 && stopped === 0;
  const verdict = clean
    ? 'all selected tasks succeeded or were skipped'
    : 'queue finished running; some tasks still need attention';
  return `[run-queue] queue finished: ${done} done, ${failed} task-failed, ${crashed} crashed, ${quarantined} quarantined, ${skipped} skipped, ${stopped} stopped (of ${total}) -- ${verdict}`;
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

export function resolveWorktreeScope({ entry = {}, defaults = {} } = {}) {
  const scope = entry.worktreeScope ?? defaults.worktreeScope ?? 'task';
  if (scope === 'task' || scope === 'queue') return scope;
  const label = entry.id || entry.task || 'queue entry';
  throw new Error(`invalid worktreeScope for ${label}: ${scope}`);
}

export function buildLoopArgsForQueueEntry({
  agentLoopRoot,
  repoRoot,
  entry,
  defaults = {},
  index = 0,
  queueWorktreePath = null,
  gateSets = {},
  defaultGates = [],
  loopScript = path.join(agentLoopRoot, 'src', 'loop.js'),
}) {
  const label = entry.id || entry.task;
  const useWorktree = entry.useWorktree ?? defaults.useWorktree ?? false;
  const worktreeScope = resolveWorktreeScope({ entry, defaults });
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

  if (useWorktree && worktreeScope === 'queue') {
    if (!queueWorktreePath) throw new Error(`queue worktree path is required for ${label}`);
    args.push('--fix-cwd', queueWorktreePath);
  } else if (useWorktree) {
    args.push('--create-worktree', worktreeName);
  } else {
    args.push('--fix-cwd', resolveFixCwd(repoRoot, entry.fixCwd ?? defaults.fixCwd ?? '.'));
  }

  if (entry.autoFix ?? defaults.autoFix ?? true) args.push('--auto-fix');

  const fixAgent = entry.fixAgent ?? defaults.fixAgent;
  if (fixAgent) args.push('--fix-agent', fixAgent);

  const fixModel = entry.fixModel ?? defaults.fixModel;
  if (fixModel) args.push('--fix-model', fixModel);

  const skipReview = entry.skipReview ?? defaults.skipReview ?? true;
  if (skipReview) {
    args.push('--skip-review');
  } else {
    const reviewAgent = entry.reviewAgent ?? defaults.reviewAgent;
    if (reviewAgent) args.push('--review-agent', reviewAgent);
    const reviewModel = entry.reviewModel ?? defaults.reviewModel;
    if (reviewModel) args.push('--review-model', reviewModel);
  }

  const scopedReview = entry.scopedReview ?? defaults.scopedReview;
  if (scopedReview != null) args.push('--scoped-review', String(scopedReview));

  const grokMaxTurns = entry.grokMaxTurns ?? defaults.grokMaxTurns;
  if (grokMaxTurns != null) args.push('--grok-max-turns', String(grokMaxTurns));

  const reviewMaxTurns = entry.reviewMaxTurns ?? defaults.reviewMaxTurns;
  if (reviewMaxTurns != null) args.push('--review-max-turns', String(reviewMaxTurns));
  const agentIdleTimeoutMs = entry.agentIdleTimeoutMs ?? defaults.agentIdleTimeoutMs;
  if (agentIdleTimeoutMs != null) args.push('--agent-idle-timeout-ms', String(agentIdleTimeoutMs));
  const agentTimeoutMs = entry.agentTimeoutMs ?? defaults.agentTimeoutMs;
  if (agentTimeoutMs != null) args.push('--agent-timeout-ms', String(agentTimeoutMs));
  if (entry.guardTests ?? defaults.guardTests ?? true) args.push('--guard-tests');
  const guardPolicy = entry.guardPolicy ?? defaults.guardPolicy;
  if (guardPolicy) args.push('--guard-policy', guardPolicy);
  if (entry.noSyncTaskStatus || defaults.noSyncTaskStatus) args.push('--no-sync-task-status');
  if (entry.noSyncMigrationStatus || defaults.noSyncMigrationStatus) args.push('--no-sync-migration-status');

  return args;
}

export function buildQueueSummaryFromState({ entry, state, exitCode = 0 }) {
  const label = entry.id || entry.task;
  const runRecord = summarizeRunRecord({
    runId: state?.runId || null,
    status: normalizeQueueStatusFromState(state?.status || null, state),
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
    applyStatus: null,
    applyErrorKind: null,
    ...runRecord,
  };
  if (summary.status === 'DONE_REVIEWED_NO_DIFF') {
    summary.applyStatus = 'DONE_REVIEWED_NO_DIFF';
    summary.applyErrorKind = 'NO_DIFF_BASELINE_GREEN';
  }
  summary.outcome = classifyQueueOutcome({ summary, exitCode });
  return summary;
}

function normalizeQueueStatusFromState(status, state = {}) {
  if (
    status === 'HALT_NO_CHANGES'
    && state?.baselineGate?.ok === true
    && Number(state?.baselineDiff?.bytes || 0) === 0
  ) {
    return 'DONE_REVIEWED_NO_DIFF';
  }
  return status;
}

export async function applyDoneSummaryToMain({
  summary,
  entry,
  state,
  repoRoot,
  defaults = {},
  applyLatestDiffToMain,
  runner,
} = {}) {
  const useWorktree = entry?.useWorktree ?? defaults.useWorktree ?? false;
  const worktreeScope = resolveWorktreeScope({ entry, defaults });
  if (summary?.outcome !== 'done' || !useWorktree || worktreeScope === 'queue') {
    return { summary, appliedToMain: false };
  }

  try {
    const landing = await applyLatestDiffToMain({
      repoRoot,
      run: state?.runId || 'latest',
      runner,
      timeoutMs: entry?.timeoutMs || defaults.timeoutMs || 1800000,
    });
    return {
      summary: {
        ...summary,
        appliedToMain: true,
        landingStatus: landing.landing.status,
      },
      appliedToMain: true,
      landing,
    };
  } catch (error) {
    const mapped = mapApplyErrorToSummary(error);
    return {
      summary: {
        ...summary,
        status: mapped.status,
        outcome: mapped.outcome,
        appliedToMain: false,
        applyStatus: mapped.applyStatus,
        applyErrorKind: mapped.applyErrorKind,
        applyErrorFiles: mapped.applyErrorFiles,
        applyError: error instanceof Error ? error.message : String(error),
      },
      appliedToMain: false,
      applyError: error,
    };
  }
}

function mapApplyErrorToSummary(error) {
  if (error instanceof LoopApplyError && error.kind === 'NO_DIFF_PATCH') {
    return {
      status: 'DONE_REVIEWED_NO_DIFF',
      outcome: 'done',
      applyStatus: 'DONE_REVIEWED_NO_DIFF',
      applyErrorKind: error.kind,
      applyErrorFiles: error.files,
    };
  }

  if (error instanceof LoopApplyError && error.kind === 'PATCH_CONFLICT') {
    return {
      status: 'APPLY_CONFLICT',
      outcome: 'failed',
      applyStatus: 'APPLY_CONFLICT',
      applyErrorKind: error.kind,
      applyErrorFiles: error.files,
    };
  }

  return {
    status: 'HALT_APPLY_FAILED',
    outcome: 'crashed',
    applyStatus: 'HALT_APPLY_FAILED',
    applyErrorKind: error instanceof LoopApplyError ? error.kind : 'UNKNOWN_APPLY_ERROR',
    applyErrorFiles: error instanceof LoopApplyError ? error.files : [],
  };
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
  if (status === 'DONE_REVIEWED_NO_DIFF') return 'done';
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
