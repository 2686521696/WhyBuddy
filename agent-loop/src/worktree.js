import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './runProcess.js';

export class WorktreeStateError extends Error {
  constructor({ code, message, files = [] } = {}) {
    super(message || code || 'worktree state error');
    this.name = 'WorktreeStateError';
    this.code = code || 'WORKTREE_STATE_ERROR';
    this.files = Array.isArray(files) ? files : [];
  }
}

export function getWorktreePath({ repoRoot, name }) {
  if (!/^[A-Za-z0-9._-]+$/.test(name || '')) {
    throw new Error('invalid worktree name');
  }
  return path.join(repoRoot, '.worktrees', name);
}

export async function assertMainWorktreeClean({
  repoRoot,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const result = await run('git', ['status', '--porcelain'], { cwd: repoRoot, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`git status --porcelain failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  const files = parseStatusPorcelainFiles(result.stdout);
  if (files.length > 0) {
    throw new WorktreeStateError({
      code: 'DIRTY_MAIN_NEEDS_COMMIT',
      message: `main worktree has uncommitted changes: ${files.join(', ')}`,
      files,
    });
  }
  return { clean: true };
}

export async function createWorktreeCheckpoint({
  worktreePath,
  taskId,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const result = await run('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError || !result.stdout?.trim()) {
    throw new Error(`create worktree checkpoint failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  return { taskId, ref: result.stdout.trim() };
}

export async function createQueueWorktreeCommit({
  worktreePath,
  taskId,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const status = await run('git', ['status', '--porcelain'], { cwd: worktreePath, timeoutMs });
  if (status.exitCode !== 0 || status.timedOut || status.spawnError) {
    throw new Error(`queue worktree status failed: ${status.stderr || status.spawnError || status.exitCode}`);
  }
  const untrackedFiles = parseStatusPorcelainFiles(status.stdout)
    .filter((file) => String(status.stdout || '').includes(`?? ${file}`));
  const meaningfulTrackedDiff = await hasMeaningfulTrackedDiff({ worktreePath, run, timeoutMs });
  if (!meaningfulTrackedDiff && untrackedFiles.length === 0) {
    const checkpoint = await createWorktreeCheckpoint({ worktreePath, taskId, run, timeoutMs });
    return { ...checkpoint, committed: false };
  }

  const add = await run('git', ['add', '-A'], { cwd: worktreePath, timeoutMs });
  if (add.exitCode !== 0 || add.timedOut || add.spawnError) {
    throw new Error(`queue worktree add failed: ${add.stderr || add.spawnError || add.exitCode}`);
  }

  const message = `agent-loop queue checkpoint: ${taskId || 'task'}`;
  const commit = await run('git', ['commit', '-m', message], { cwd: worktreePath, timeoutMs });
  if (commit.exitCode !== 0 || commit.timedOut || commit.spawnError) {
    throw new Error(`queue worktree commit failed: ${commit.stderr || commit.spawnError || commit.exitCode}`);
  }

  const checkpoint = await createWorktreeCheckpoint({ worktreePath, taskId, run, timeoutMs });
  return { ...checkpoint, committed: true };
}

async function hasMeaningfulTrackedDiff({
  worktreePath,
  run,
  timeoutMs,
}) {
  const diff = await run('git', ['diff', '--quiet', '--ignore-space-at-eol'], { cwd: worktreePath, timeoutMs });
  if (diff.exitCode === 0) return false;
  if (diff.exitCode === 1) return true;
  throw new Error(`queue worktree diff check failed: ${diff.stderr || diff.spawnError || diff.exitCode}`);
}

export async function restoreWorktreeCheckpoint({
  worktreePath,
  checkpoint,
  run = runProcess,
  timeoutMs = 120000,
}) {
  if (!checkpoint?.ref) throw new Error('checkpoint ref is required');
  await resetWorktreeWorkingTree({ worktreePath, run, timeoutMs, resetRef: checkpoint.ref });
  return { restored: true, checkpoint };
}

export async function ensureWorktree({
  repoRoot,
  name,
  timeoutMs = 120000,
  run = runProcess,
}) {
  const worktreePath = getWorktreePath({ repoRoot, name });
  await ensureWorktreesIgnored({ repoRoot, run, timeoutMs });

  let stat = null;
  try {
    stat = await fs.stat(worktreePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (stat?.isDirectory()) {
    const registration = await inspectRegisteredWorktree({ repoRoot, worktreePath, run, timeoutMs });
    if (!registration.worktree) {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } else if (!registration.managed) {
      throw new Error(
        `registered non-agent-loop worktree exists at target path: ${worktreePath} (${registration.worktree.branch || 'detached'})`,
      );
    } else {
      const existing = { path: worktreePath, created: false };
      await seedWorktreeFromRepo({
        repoRoot,
        worktreePath,
        run,
        timeoutMs,
        resetBeforeSeed: true,
        alignToRepoHead: true,
      });
      return existing;
    }
  } else if (stat) {
    throw new Error(`worktree path exists but is not a directory: ${worktreePath}`);
  }

  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  const branch = `agent-loop/${name}`;
  let result = await run('git', ['worktree', 'add', '-b', branch, worktreePath], {
    cwd: repoRoot,
    timeoutMs,
  });
  let reusedBranch = false;
  if (isExistingBranchWorktreeAddError(result, branch)) {
    result = await run('git', ['worktree', 'add', worktreePath, branch], {
      cwd: repoRoot,
      timeoutMs,
    });
    reusedBranch = true;
  }
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`git worktree add failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  const created = { path: worktreePath, created: true, branch, reusedBranch };
  await seedWorktreeFromRepo({
    repoRoot,
    worktreePath,
    run,
    timeoutMs,
    resetBeforeSeed: reusedBranch,
    alignToRepoHead: reusedBranch,
  });
  return created;
}

function isExistingBranchWorktreeAddError(result, branch) {
  if (!result || result.exitCode === 0 || result.timedOut || result.spawnError) return false;
  const text = `${result.stderr || ''}\n${result.stdout || ''}`;
  return text.includes(`a branch named '${branch}' already exists`)
    || text.includes(`a branch named "${branch}" already exists`)
    || text.includes(`fatal: '${branch}' is already a branch`)
    || text.includes(`fatal: '${branch}' is already checked out`);
}

async function inspectRegisteredWorktree({
  repoRoot,
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const worktrees = await listRegisteredWorktrees({ repoRoot, run, timeoutMs });
  const target = path.resolve(worktreePath);
  const worktree = worktrees.find((entry) => path.resolve(entry.path) === target) || null;
  return {
    worktree,
    managed: Boolean(worktree && isAgentLoopManagedWorktree(worktree, repoRoot)),
  };
}

export async function resetWorktreeWorkingTree({
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
  resetRef = 'HEAD',
}) {
  const hard = await run('git', ['reset', '--hard', resetRef], { cwd: worktreePath, timeoutMs });
  if (hard.exitCode !== 0 || hard.timedOut || hard.spawnError) {
    throw new Error(`worktree reset --hard failed: ${hard.stderr || hard.spawnError || hard.exitCode}`);
  }

  const clean = await run('git', ['clean', '-fd'], { cwd: worktreePath, timeoutMs });
  if (clean.exitCode !== 0 || clean.timedOut || clean.spawnError) {
    throw new Error(`worktree clean failed: ${clean.stderr || clean.spawnError || clean.exitCode}`);
  }
}

export async function resolveRepoHead({
  repoRoot,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const result = await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError || !result.stdout?.trim()) {
    throw new Error(`resolve repo HEAD failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  return result.stdout.trim();
}

export async function alignWorktreeToRepoHead({
  repoRoot,
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const repoHead = await resolveRepoHead({ repoRoot, run, timeoutMs });
  await resetWorktreeWorkingTree({ worktreePath, run, timeoutMs, resetRef: repoHead });
  return repoHead;
}

export async function seedWorktreeFromRepo({
  repoRoot,
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
  resetBeforeSeed = false,
  alignToRepoHead = false,
}) {
  if (resetBeforeSeed) {
    if (alignToRepoHead) {
      await alignWorktreeToRepoHead({ repoRoot, worktreePath, run, timeoutMs });
    } else {
      await resetWorktreeWorkingTree({ worktreePath, run, timeoutMs });
    }
  }

  await syncWorkingTreeChanges({ repoRoot, worktreePath, run, timeoutMs });
  await copyUntrackedFiles({ repoRoot, worktreePath, run, timeoutMs });
  await syncAgentLoopTaskDocsFromRepo({ repoRoot, worktreePath });
}

export async function syncWorkingTreeChanges({
  repoRoot,
  worktreePath,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const listed = await run('git', ['diff', '--name-status', 'HEAD'], { cwd: repoRoot, timeoutMs });
  if (listed.exitCode !== 0 || listed.timedOut || listed.spawnError) {
    throw new Error(
      `list repo working tree changes failed: ${listed.stderr || listed.spawnError || listed.exitCode}`,
    );
  }

  for (const entry of parseNameStatusLines(listed.stdout)) {
    await applyWorkingTreeEntry({ repoRoot, worktreePath, entry });
  }
}

export function parseNameStatusLines(stdout) {
  const entries = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf('\t');
    if (tab < 0) continue;
    const status = trimmed.slice(0, tab);
    const rest = trimmed.slice(tab + 1);
    const code = status.charAt(0);
    if (code === 'R' || code === 'C') {
      const split = rest.split('\t');
      if (split.length < 2) continue;
      entries.push({ code, oldPath: split[0], newPath: split[1] });
      continue;
    }
    entries.push({ code, path: rest });
  }
  return entries;
}

export function parseStatusPorcelainFiles(stdout) {
  const files = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const payload = line.length > 3 ? line.slice(3) : line.trim();
    if (!payload) continue;
    if (/^R/.test(line) || /^C/.test(line)) {
      const parts = payload.split(' -> ');
      files.push(parts.at(-1));
    } else {
      files.push(payload);
    }
  }
  return files;
}

export async function syncAgentLoopTaskDocsFromRepo({ repoRoot, worktreePath }) {
  const tasksDir = path.join(repoRoot, 'agent-loop', 'tasks');
  let entries;
  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const relPath = path.join('agent-loop', 'tasks', entry.name);
    const source = path.join(repoRoot, relPath);
    const target = path.join(worktreePath, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await copyFileIfDifferentBeyondLineEndings(source, target);
  }
}

async function copyFileIfDifferentBeyondLineEndings(source, target) {
  const sourceBuffer = await fs.readFile(source);
  let targetBuffer = null;
  try {
    targetBuffer = await fs.readFile(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (
    targetBuffer
    && sourceBuffer.equals(targetBuffer)
  ) {
    return;
  }

  if (
    targetBuffer
    && normalizeLineEndings(sourceBuffer.toString('utf8')) === normalizeLineEndings(targetBuffer.toString('utf8'))
  ) {
    return;
  }

  await fs.writeFile(target, sourceBuffer);
}

function normalizeLineEndings(text) {
  return String(text).replace(/\r\n/g, '\n');
}

async function applyWorkingTreeEntry({ repoRoot, worktreePath, entry }) {
  if (entry.code === 'D') {
    await fs.rm(path.join(worktreePath, entry.path), { force: true });
    return;
  }
  if (entry.code === 'R' || entry.code === 'C') {
    await fs.rm(path.join(worktreePath, entry.oldPath), { force: true });
    await copyRepoPathToWorktree({ repoRoot, worktreePath, relPath: entry.newPath });
    return;
  }
  await copyRepoPathToWorktree({ repoRoot, worktreePath, relPath: entry.path });
}

async function copyRepoPathToWorktree({ repoRoot, worktreePath, relPath }) {
  const source = path.join(repoRoot, relPath);
  const target = path.join(worktreePath, relPath);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } catch (error) {
    throw new Error(
      `seed worktree copy failed (repo=${repoRoot}, worktree=${worktreePath}, path=${relPath}): ${error.message}`,
    );
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

export function parseWorktreeListPorcelain(stdout) {
  const worktrees = [];
  let current = null;
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim(), head: null, branch: null, bare: false, detached: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length).trim();
    if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).trim();
    if (line === 'bare') current.bare = true;
    if (line === 'detached') current.detached = true;
  }
  if (current) worktrees.push(current);
  return worktrees;
}

export async function listRegisteredWorktrees({
  repoRoot,
  run = runProcess,
  timeoutMs = 120000,
}) {
  const result = await run('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`git worktree list failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  return parseWorktreeListPorcelain(result.stdout);
}

export function isAgentLoopManagedWorktree(worktree, repoRoot) {
  const managedRoot = path.join(path.resolve(repoRoot), '.worktrees');
  const wtPath = path.resolve(worktree.path);
  if (!wtPath.startsWith(managedRoot)) return false;
  if (!worktree.branch) return false;
  return worktree.branch.startsWith('refs/heads/agent-loop/');
}

export async function removeWorktree({
  repoRoot,
  name,
  run = runProcess,
  timeoutMs = 120000,
  force = true,
}) {
  const worktreePath = getWorktreePath({ repoRoot, name });
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  const result = await run('git', args, { cwd: repoRoot, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`git worktree remove failed: ${result.stderr || result.spawnError || result.exitCode}`);
  }
  return { path: worktreePath, removed: true };
}

export async function removeAgentLoopWorktrees({
  repoRoot,
  keepNames = [],
  run = runProcess,
  timeoutMs = 120000,
  force = true,
}) {
  const keep = new Set(keepNames);
  const removed = [];
  const worktrees = await listRegisteredWorktrees({ repoRoot, run, timeoutMs });
  for (const worktree of worktrees) {
    if (!isAgentLoopManagedWorktree(worktree, repoRoot)) continue;
    const name = path.basename(worktree.path);
    if (keep.has(name)) continue;
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktree.path);
    const result = await run('git', args, { cwd: repoRoot, timeoutMs });
    if (result.exitCode !== 0 || result.timedOut || result.spawnError) {
      throw new Error(
        `git worktree remove failed (${worktree.path}): ${result.stderr || result.spawnError || result.exitCode}`,
      );
    }
    removed.push({ name, path: worktree.path, branch: worktree.branch });
  }
  return removed;
}
