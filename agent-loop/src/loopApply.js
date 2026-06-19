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
    taskFile,
    excludes,
    gates: state.options?.gates || [],
    checkCommand: buildGitApplyCommand({ patchPath, excludes, check: true }),
    applyCommand: buildGitApplyCommand({ patchPath, excludes, check: false }),
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

export function buildGitApplyCommand({ patchPath, excludes = [], check = false }) {
  const parts = ['git apply'];
  if (check) parts.push('--check');
  for (const exclude of excludes) {
    parts.push(`--exclude=${quoteShellArg(exclude)}`);
  }
  parts.push(quoteShellArg(patchPath));
  return parts.join(' ');
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:\\-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}
