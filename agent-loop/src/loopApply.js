import fs from 'node:fs/promises';
import path from 'node:path';

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
    throw new Error(`git apply --check failed: ${check.stderr || check.stdout || check.exitCode}`);
  }

  const applied = await runner('git', applyArgsToGitArgv(applyArgs), {
    cwd: repoRoot,
    timeoutMs,
  });
  if (applied.exitCode !== 0) {
    throw new Error(`git apply failed: ${applied.stderr || applied.stdout || applied.exitCode}`);
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

  if (!patches.length) throw new Error(`no diff.N.patch found in ${runDir}`);
  return path.join(runDir, patches[0].name);
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
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
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
