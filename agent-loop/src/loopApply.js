import fs from 'node:fs/promises';
import path from 'node:path';
import { assertMainWorktreeClean, WorktreeStateError } from './worktree.js';

export class LoopApplyError extends Error {
  constructor({ kind, message, files = [], cause = null } = {}) {
    super(message || kind || 'loop apply failed');
    this.name = 'LoopApplyError';
    this.kind = kind || 'UNKNOWN_APPLY_ERROR';
    this.files = Array.isArray(files) ? files : [];
    if (cause) this.cause = cause;
  }
}

export function resolveRunDir({ repoRoot, run = 'latest' }) {
  if (path.isAbsolute(run)) return run;
  if (run === 'latest') return path.join(repoRoot, '.agent-loop', 'latest');
  return path.join(repoRoot, '.agent-loop', 'runs', run);
}

export async function buildLoopApplyPlan({
  repoRoot,
  run = 'latest',
  excludeTaskDoc = true,
  extraExcludes = [],
} = {}) {
  const runDir = resolveRunDir({ repoRoot, run });
  const state = JSON.parse(await fs.readFile(path.join(runDir, 'state.json'), 'utf8'));
  const landing = await readJsonIfExists(path.join(runDir, 'landing.json')) || defaultLandingStatus();
  const patchPath = await findLatestDiffPatch(runDir);
  const taskFile = state.options?.task || state.task || null;
  const excludes = [
    ...(excludeTaskDoc && taskFile ? [taskFile] : []),
    ...extraExcludes,
  ];

  return {
    repoRoot,
    run,
    runDir,
    patchPath,
    landing,
    taskFile,
    excludes,
    gates: state.options?.gates || [],
    checkCommand: buildGitApplyCommand({ patchPath, excludes, check: true }),
    applyCommand: buildGitApplyCommand({ patchPath, excludes, check: false }),
  };
}

export async function applyLatestDiffToMain({
  repoRoot,
  run = 'latest',
  excludeTaskDoc = true,
  extraExcludes = [],
  runner,
  timeoutMs = 120000,
} = {}) {
  if (!runner) throw new Error('runner is required');
  const plan = await buildLoopApplyPlan({
    repoRoot,
    run,
    excludeTaskDoc,
    extraExcludes,
  });
  const applyArgs = buildGitApplyArgs({
    patchPath: plan.patchPath,
    excludes: plan.excludes,
    check: false,
  });
  const checkArgs = buildGitApplyArgs({
    patchPath: plan.patchPath,
    excludes: plan.excludes,
    check: true,
  });

  const check = await runner('git', applyArgsToGitArgv(checkArgs), {
    cwd: repoRoot,
    timeoutMs,
  });
  if (check.exitCode !== 0) {
    const output = check.stderr || check.stdout || String(check.exitCode);
    throw new LoopApplyError({
      kind: classifyGitApplyErrorKind(output),
      message: `git apply --check failed: ${output}`,
      files: extractGitApplyErrorFiles(output),
    });
  }

  const applied = await runner('git', applyArgsToGitArgv(applyArgs), {
    cwd: repoRoot,
    timeoutMs,
  });
  if (applied.exitCode !== 0) {
    const output = applied.stderr || applied.stdout || String(applied.exitCode);
    throw new LoopApplyError({
      kind: classifyGitApplyErrorKind(output),
      message: `git apply failed: ${output}`,
      files: extractGitApplyErrorFiles(output),
    });
  }

  const landing = await markLandingStatus({
    repoRoot,
    run,
    status: 'APPLIED_TO_MAIN',
    details: {
      patchPath: plan.patchPath,
      excludes: plan.excludes,
    },
  });

  return {
    ...plan,
    check,
    applied,
    landing: landing.landing,
  };
}

// Land the combined queue worktree diff (.agent-loop/queue.diff.patch) onto main.
// Always git-apply --check first; only when check passes (and check===false) does it
// actually apply and flip queue-landing.json to APPLIED_TO_MAIN. A conflict throws a
// LoopApplyError with the offending files and never mutates the working tree.
export async function applyQueueLandingToMain({
  repoRoot,
  runner,
  check = false,
  timeoutMs = 120000,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  if (!runner) throw new Error('runner is required');

  const landingPath = path.join(repoRoot, '.agent-loop', 'queue-landing.json');
  const landing = await readJsonIfExists(landingPath);
  if (!landing) {
    throw new LoopApplyError({ kind: 'NO_QUEUE_LANDING', message: 'no queue-landing.json to apply' });
  }
  if (landing.appliedToMain) {
    throw new LoopApplyError({ kind: 'ALREADY_APPLIED', message: 'queue landing already applied to main' });
  }
  const patchPath = landing.diffPath || path.join(repoRoot, '.agent-loop', 'queue.diff.patch');
  await assertCleanMainForLanding({ repoRoot, runner, timeoutMs });

  const checkResult = await runner('git', buildGitApplyArgs({ patchPath, excludes: [], check: true }), {
    cwd: repoRoot,
    timeoutMs,
  });
  if (checkResult.exitCode !== 0) {
    const output = checkResult.stderr || checkResult.stdout || String(checkResult.exitCode);
    throw new LoopApplyError({
      kind: classifyGitApplyErrorKind(output),
      message: `git apply --check failed: ${output}`,
      files: extractGitApplyErrorFiles(output),
    });
  }
  if (check) {
    return { checked: true, applied: false, patchPath };
  }

  const applyResult = await runner('git', buildGitApplyArgs({ patchPath, excludes: [], check: false }), {
    cwd: repoRoot,
    timeoutMs,
  });
  if (applyResult.exitCode !== 0) {
    const output = applyResult.stderr || applyResult.stdout || String(applyResult.exitCode);
    throw new LoopApplyError({
      kind: classifyGitApplyErrorKind(output),
      message: `git apply failed: ${output}`,
      files: extractGitApplyErrorFiles(output),
    });
  }

  const updated = {
    ...landing,
    status: 'APPLIED_TO_MAIN',
    appliedToMain: true,
    appliedAt: new Date().toISOString(),
  };
  await fs.writeFile(landingPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return { checked: true, applied: true, patchPath, landing: updated };
}

async function assertCleanMainForLanding({ repoRoot, runner, timeoutMs }) {
  try {
    await assertMainWorktreeClean({
      repoRoot,
      run: runner,
      timeoutMs,
      ignorePaths: ['.agent-loop/', '.worktrees/'],
    });
  } catch (error) {
    if (error instanceof WorktreeStateError) {
      throw new LoopApplyError({
        kind: error.code,
        message: error.message,
        files: error.files,
        cause: error,
      });
    }
    throw error;
  }
}

export async function writeQueueLandingSummary({
  repoRoot,
  queueWorktreePath,
  baseRef = null,
  tasks = [],
  run,
  timeoutMs = 120000,
  includeUntracked = true,
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  if (!queueWorktreePath) throw new Error('queueWorktreePath is required');
  if (!run) throw new Error('runner is required');

  const untrackedFiles = includeUntracked
    ? await stageIntentToAddUntrackedFiles({ queueWorktreePath, run, timeoutMs })
    : [];
  const diffArgs = ['diff', '--binary'];
  if (baseRef) diffArgs.push(baseRef);
  const result = await run('git', diffArgs, { cwd: queueWorktreePath, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`queue worktree diff failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }

  const agentLoopDir = path.join(repoRoot, '.agent-loop');
  await fs.mkdir(agentLoopDir, { recursive: true });
  const diffPath = path.join(agentLoopDir, 'queue.diff.patch');
  const landingPath = path.join(agentLoopDir, 'queue-landing.json');
  const diffText = result.stdout || '';
  await fs.writeFile(diffPath, diffText, 'utf8');

  const normalizedTasks = tasks.map((task) => ({
    id: task.id,
    task: task.task ?? null,
    status: task.status ?? null,
    outcome: task.outcome ?? null,
    runId: task.runId ?? null,
  }));
  const patchTasks = normalizedTasks.filter((task) => task.outcome === 'done');
  const taskCounts = countQueueLandingTasks(normalizedTasks);
  const summary = {
    status: 'PENDING_QUEUE_LANDING',
    appliedToMain: false,
    diffPath,
    queueWorktreePath,
    baseRef,
    diffBytes: Buffer.byteLength(diffText, 'utf8'),
    untrackedFiles,
    tasks: normalizedTasks,
    patchTasks,
    taskCounts,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(landingPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

function countQueueLandingTasks(tasks) {
  const counts = {
    total: tasks.length,
    patch: 0,
    done: 0,
    failed: 0,
    crashed: 0,
    quarantined: 0,
    skipped: 0,
  };
  for (const task of tasks) {
    const outcome = task.outcome || 'unknown';
    if (outcome === 'done') {
      counts.done += 1;
      counts.patch += 1;
    } else if (Object.hasOwn(counts, outcome)) {
      counts[outcome] += 1;
    }
  }
  return counts;
}

async function stageIntentToAddUntrackedFiles({
  queueWorktreePath,
  run,
  timeoutMs,
}) {
  const listed = await run('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: queueWorktreePath,
    timeoutMs,
  });
  if (listed.exitCode !== 0 || listed.timedOut || listed.spawnError) {
    throw new Error(`queue worktree untracked file listing failed: ${listed.stderr || listed.spawnError || listed.exitCode}`);
  }
  const files = String(listed.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!files.length) return [];

  const add = await run('git', ['add', '--intent-to-add', '--', ...files], {
    cwd: queueWorktreePath,
    timeoutMs,
  });
  if (add.exitCode !== 0 || add.timedOut || add.spawnError) {
    throw new Error(`queue worktree untracked intent-to-add failed: ${add.stderr || add.spawnError || add.exitCode}`);
  }
  return files;
}

function defaultLandingStatus() {
  return {
    status: 'PENDING_APPLY',
    appliedToMain: false,
    mainGateGreen: false,
    committed: false,
  };
}

export async function markLandingStatus({
  repoRoot,
  run = 'latest',
  status,
  details = {},
} = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const runDir = resolveRunDir({ repoRoot, run });
  const landingPath = path.join(runDir, 'landing.json');
  const previous = await readJsonIfExists(landingPath);
  const landing = normalizeLandingStatus({
    ...(previous || {}),
    ...details,
    status,
    updatedAt: new Date().toISOString(),
  });

  await fs.writeFile(landingPath, `${JSON.stringify(landing, null, 2)}\n`, 'utf8');
  return {
    repoRoot,
    run,
    runDir,
    landingPath,
    landing,
  };
}

export async function findLatestDiffPatch(runDir) {
  const entries = await fs.readdir(runDir);
  const patches = entries
    .map((name) => {
      const match = /^diff\.(\d+)\.patch$/.exec(name);
      return match ? { name, iteration: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.iteration - a.iteration);

  if (!patches.length) {
    throw new LoopApplyError({
      kind: 'NO_DIFF_PATCH',
      message: `no diff.N.patch found in ${runDir}`,
    });
  }
  return path.join(runDir, patches[0].name);
}

function classifyGitApplyErrorKind(output) {
  const text = String(output || '');
  if (
    /patch does not apply/i.test(text)
    || /already exists in working directory/i.test(text)
    || /patch failed:/i.test(text)
  ) {
    return 'PATCH_CONFLICT';
  }
  return 'UNKNOWN_APPLY_ERROR';
}

function extractGitApplyErrorFiles(output) {
  const files = new Set();
  const text = String(output || '');
  for (const line of text.split(/\r?\n/)) {
    const patchFailed = line.match(/^error:\s+patch failed:\s+(.+?):\d+/i);
    if (patchFailed) {
      files.add(patchFailed[1]);
      continue;
    }

    const doesNotApply = line.match(/^error:\s+(.+?):\s+patch does not apply/i);
    if (doesNotApply) {
      files.add(doesNotApply[1]);
      continue;
    }

    const alreadyExists = line.match(/^error:\s+(.+?):\s+already exists in working directory/i);
    if (alreadyExists) {
      files.add(alreadyExists[1]);
    }
  }
  return Array.from(files);
}

function normalizeLandingStatus(landing) {
  const status = landing.status;
  if (!['APPLIED_TO_MAIN', 'MAIN_GATE_GREEN', 'COMMITTED'].includes(status)) {
    throw new Error(`unknown landing status: ${status}`);
  }

  return {
    ...landing,
    appliedToMain: ['APPLIED_TO_MAIN', 'MAIN_GATE_GREEN', 'COMMITTED'].includes(status),
    mainGateGreen: ['MAIN_GATE_GREEN', 'COMMITTED'].includes(status),
    committed: status === 'COMMITTED',
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(stripJsonBom(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function stripJsonBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

export function buildGitApplyCommand({ patchPath, excludes = [], check = false }) {
  const parts = ['git', ...buildGitApplyArgs({ patchPath, excludes, check })]
    .map((part) => quoteShellArg(part));
  return parts.join(' ');
}

function buildGitApplyArgs({ patchPath, excludes = [], check = false }) {
  const parts = ['apply'];
  if (check) parts.push('--check');
  for (const exclude of excludes) {
    parts.push(`--exclude=${exclude}`);
  }
  parts.push(patchPath);
  return parts;
}

function applyArgsToGitArgv(args) {
  return args;
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:\\-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}
