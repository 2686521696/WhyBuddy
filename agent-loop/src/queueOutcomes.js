import fs from 'node:fs/promises';
import path from 'node:path';

const OUTCOMES_LOCK_TIMEOUT_MS = 120000;
const OUTCOMES_STALE_LOCK_MS = 300000;

export function queueOutcomesPath(repoRoot) {
  return path.join(repoRoot, '.agent-loop', 'queue-outcomes.json');
}

function queueOutcomesLockPath(repoRoot) {
  return path.join(repoRoot, '.agent-loop', 'queue-outcomes.lock');
}

export async function readQueueOutcomes(repoRoot) {
  const filePath = queueOutcomesPath(repoRoot);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return { tasks: {} };
    throw error;
  }
}

export async function writeQueueOutcomes(repoRoot, data) {
  const filePath = queueOutcomesPath(repoRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireQueueOutcomesLock(repoRoot, {
  timeoutMs = OUTCOMES_LOCK_TIMEOUT_MS,
  staleMs = OUTCOMES_STALE_LOCK_MS,
} = {}) {
  const lockPath = queueOutcomesLockPath(repoRoot);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        path.join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8',
      );
      return async () => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`timed out waiting for queue outcomes lock: ${lockPath}`);
      }
      await sleep(100 + Math.floor(Math.random() * 150));
    }
  }
}

export function shouldSkipAutoDisabledTask({ entry, outcomes, maxConsecutiveNoChanges = 3 }) {
  const label = entry.id || entry.task;
  const record = outcomes?.tasks?.[label];
  if (!record) return { skip: false, record: null };
  const streak = record.consecutiveNoChanges || 0;
  if (record.autoDisabled || (maxConsecutiveNoChanges > 0 && streak >= maxConsecutiveNoChanges)) {
    return { skip: true, record, reason: 'consecutive-no-changes' };
  }
  return { skip: false, record };
}

export function updateQueueOutcomeRecord({
  record = {},
  status,
  outcome,
  runId = null,
  applyStatus = null,
  applyErrorKind = null,
  applyErrorFiles = null,
  applyError = null,
  rescuePatchAvailable = null,
  diffBytes = null,
  queuePauseReason = null,
  maxConsecutiveNoChanges = 3,
  autoDisableOnNoChanges = true,
}) {
  const next = {
    ...record,
    lastStatus: status || record.lastStatus || null,
    lastOutcome: outcome || record.lastOutcome || null,
    lastRunId: runId || record.lastRunId || null,
    lastUpdatedAt: new Date().toISOString(),
    consecutiveNoChanges: record.consecutiveNoChanges || 0,
    autoDisabled: Boolean(record.autoDisabled),
    autoDisabledAt: record.autoDisabledAt || null,
  };

  if (applyStatus) next.applyStatus = applyStatus;
  if (applyErrorKind) next.applyErrorKind = applyErrorKind;
  if (Array.isArray(applyErrorFiles)) next.applyErrorFiles = applyErrorFiles;
  if (applyError) next.applyError = applyError;
  if (rescuePatchAvailable != null) next.rescuePatchAvailable = Boolean(rescuePatchAvailable);
  if (diffBytes != null) next.diffBytes = Number(diffBytes) || 0;
  if (queuePauseReason) next.queuePauseReason = queuePauseReason;

  if (status === 'HALT_NO_CHANGES') {
    next.consecutiveNoChanges += 1;
  } else if (status?.startsWith('DONE_')) {
    next.consecutiveNoChanges = 0;
    next.autoDisabled = false;
    next.autoDisabledAt = null;
    if (outcome === 'done' && !applyStatus && !applyErrorKind && rescuePatchAvailable == null) {
      delete next.applyStatus;
      delete next.applyErrorKind;
      delete next.applyErrorFiles;
      delete next.applyError;
      next.rescuePatchAvailable = false;
    }
  } else if (outcome === 'crashed') {
    // Infra failures should not count toward "grok can't do this task" streaks.
    next.consecutiveNoChanges = record.consecutiveNoChanges || 0;
  } else if (outcome === 'failed') {
    next.consecutiveNoChanges = 0;
  }

  if (
    autoDisableOnNoChanges
    && maxConsecutiveNoChanges > 0
    && next.consecutiveNoChanges >= maxConsecutiveNoChanges
  ) {
    next.autoDisabled = true;
    next.autoDisabledAt = next.autoDisabledAt || new Date().toISOString();
  }

  return next;
}

export async function recordQueueTaskOutcome({
  repoRoot,
  entry,
  summary,
  maxConsecutiveNoChanges = 3,
  autoDisableOnNoChanges = true,
}) {
  const label = entry.id || entry.task;
  const releaseLock = await acquireQueueOutcomesLock(repoRoot);
  try {
    const outcomes = await readQueueOutcomes(repoRoot);
    outcomes.tasks ||= {};
    outcomes.tasks[label] = updateQueueOutcomeRecord({
      record: outcomes.tasks[label],
      status: summary.status,
      outcome: summary.outcome,
      runId: summary.runId,
      applyStatus: summary.applyStatus,
      applyErrorKind: summary.applyErrorKind,
      applyErrorFiles: summary.applyErrorFiles,
      applyError: summary.applyError,
      rescuePatchAvailable: summary.rescuePatchAvailable,
      diffBytes: summary.diffBytes,
      queuePauseReason: summary.queuePauseReason,
      maxConsecutiveNoChanges,
      autoDisableOnNoChanges,
    });
    await writeQueueOutcomes(repoRoot, outcomes);
    return outcomes.tasks[label];
  } finally {
    await releaseLock();
  }
}
