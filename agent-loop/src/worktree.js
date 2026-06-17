import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './runProcess.js';

export function getWorktreePath({ repoRoot, name }) {
  if (!/^[A-Za-z0-9._-]+$/.test(name || '')) {
    throw new Error('invalid worktree name');
  }
  return path.join(repoRoot, '.worktrees', name);
}

export async function ensureWorktree({
  repoRoot,
  name,
  timeoutMs = 120000,
  run = runProcess,
}) {
  const worktreePath = getWorktreePath({ repoRoot, name });
  await ensureWorktreesIgnored({ repoRoot, run, timeoutMs });

  try {
    const stat = await fs.stat(worktreePath);
    if (stat.isDirectory()) {
      const existing = { path: worktreePath, created: false };
      await seedWorktreeFromRepo({ repoRoot, worktreePath, run, timeoutMs, resetBeforeSeed: true });
      return existing;
    }
  } catch {
    // create below
  }

  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  const branch = `agent-loop/${name}`;
  const result = await run('git', ['worktree', 'add', '-b', branch, worktreePath], {
    cwd: repoRoot,
    timeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`git worktree add failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  const created = { path: worktreePath, created: true, branch };
  await seedWorktreeFromRepo({ repoRoot, worktreePath, run, timeoutMs, resetBeforeSeed: false });
  return created;
}

export async function resetWorktreeWorkingTree({
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const hard = await run('git', ['reset', '--hard', 'HEAD'], { cwd: worktreePath, timeoutMs });
  if (hard.exitCode !== 0 || hard.timedOut || hard.spawnError) {
    throw new Error(`worktree reset --hard failed: ${hard.stderr || hard.spawnError || hard.exitCode}`);
  }

  const clean = await run('git', ['clean', '-fd'], { cwd: worktreePath, timeoutMs });
  if (clean.exitCode !== 0 || clean.timedOut || clean.spawnError) {
    throw new Error(`worktree clean failed: ${clean.stderr || clean.spawnError || clean.exitCode}`);
  }
}

export async function seedWorktreeFromRepo({
  repoRoot,
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
  resetBeforeSeed = false,
}) {
  if (resetBeforeSeed) {
    await resetWorktreeWorkingTree({ worktreePath, run, timeoutMs });
  }

  await applyRepoDiff({
    repoRoot,
    worktreePath,
    run,
    timeoutMs,
    diffArgs: ['diff', 'HEAD', '--binary'],
  });
  await copyUntrackedFiles({ repoRoot, worktreePath, run, timeoutMs });
}

async function applyRepoDiff({ repoRoot, worktreePath, run, timeoutMs, diffArgs }) {
  const diff = await run('git', diffArgs, { cwd: repoRoot, timeoutMs });
  if (!diff.stdout?.trim()) return;
  const applied = await run('git', ['apply', '--whitespace=nowarn'], {
    cwd: worktreePath,
    timeoutMs,
    input: diff.stdout,
  });
  if (applied.exitCode !== 0 || applied.timedOut || applied.spawnError) {
    throw new Error(`seed worktree from ${diffArgs.join(' ')} failed: ${applied.stderr || applied.spawnError || applied.exitCode}`);
  }
}

async function copyUntrackedFiles({ repoRoot, worktreePath, run, timeoutMs }) {
  const listed = await run('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    timeoutMs,
  });
  const files = listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const relPath of files) {
    const source = path.join(repoRoot, relPath);
    const target = path.join(worktreePath, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}

async function ensureWorktreesIgnored({ repoRoot, run, timeoutMs }) {
  const ignored = await run('git', ['check-ignore', '-q', '.worktrees/probe'], {
    cwd: repoRoot,
    timeoutMs,
  });
  if (ignored.exitCode === 0) return;
  throw new Error('.worktrees must be ignored before creating agent-loop worktrees');
}