import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQueueOutcomes, recordQueueTaskOutcome, shouldSkipAutoDisabledTask } from '../src/queueOutcomes.js';
import { runProcess } from '../src/runProcess.js';
import {
  buildResumeUnfinishedPlan,
  buildQueueRestoreFailedSummary,
  buildLoopArgsForQueueEntry,
  buildQueueCompletionMessage,
  buildQueueSummaryFromState,
  applyDoneSummaryToMain,
  filterQueueTasks,
  mergeQueueOutcomes,
  resolveWorktreeScope,
  sanitizeWorktreeName,
  shouldPauseQueueAfterSummary,
} from '../src/runQueue.js';
import {
  createLoopProgressWatcher,
  formatProgressLine,
  readLatestState,
} from '../src/runQueueProgress.js';
import { applyLatestDiffToMain, writeQueueLandingSummary } from '../src/loopApply.js';
import {
  assertMainWorktreeClean,
  createQueueWorktreeCommit,
  createWorktreeCheckpoint,
  ensureWorktree,
  getWorktreePath,
  removeWorktree,
  restoreWorktreeCheckpoint,
  WorktreeStateError,
} from '../src/worktree.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultQueuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');

async function main() {
  const abortController = new AbortController();
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
    abortController.abort();
  };
  process.once('SIGTERM', requestStop);
  process.once('SIGINT', requestStop);

  const argv = process.argv.slice(2);
  const follow = !argv.includes('--no-follow');
  const preflightOnly = argv.includes('--preflight-only');
  const queuePath = resolveQueuePath(argv);
  const selection = resolveQueueSelection(argv);
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const repoRoot = path.resolve(agentLoopRoot, queue.cwd || '..');
  const defaults = {
    ...(queue.defaults || {}),
    ...(argv.includes('--force-fix') ? { forceFix: true } : {}),
  };
  const defaultGates = queue.gates || [];
  const gateSets = collectGateSets(queue, defaultGates);
  const maxConsecutiveNoChanges = defaults.maxConsecutiveNoChanges ?? 3;
  const autoDisableOnNoChanges = defaults.autoDisableOnNoChanges ?? true;
  const cleanupWorktree = defaults.cleanupWorktree ?? true;
  const rootOutcomes = await readQueueOutcomes(repoRoot);
  let outcomes = rootOutcomes;
  let tasks = filterQueueTasks(queue.tasks || [], { ...selection, resumeUnfinished: false });

  if (!tasks.length) {
    throw new Error('migration queue has no enabled tasks');
  }
  if (!defaultGates.length && !gateSets.infraGates.length) {
    throw new Error('migration queue has no gates');
  }

  if (follow) {
    process.stderr.write('[run-queue] live progress enabled (use --no-follow to disable)\n');
    process.stderr.write('[run-queue] tip: open .agent-loop/latest/state.json in another terminal for full detail\n');
  }

  const queueScopeEnabled = tasks.some((entry) => (
    (entry.useWorktree ?? defaults.useWorktree ?? false)
    && resolveWorktreeScope({ entry, defaults }) === 'queue'
  ));
  let queueWorktree = null;
  let queueBaseCheckpoint = null;
  let queueCurrentCheckpoint = null;
  let queueRestoreFailed = false;
  let checkpointTaskIds = new Set();
  if (queueScopeEnabled) {
    try {
      await assertMainWorktreeClean({ repoRoot, run: runProcess, timeoutMs: defaults.timeoutMs || 1800000 });
      const queueWorktreeName = sanitizeWorktreeName(defaults.queueWorktreeName || `queue-${Date.now()}`);
      const expectedQueueWorktreePath = getWorktreePath({ repoRoot, name: queueWorktreeName });
      const checkpointTaskIdsFromBranch = await readQueueCheckpointTaskIdsFromBranch({
        repoRoot,
        branch: `agent-loop/${queueWorktreeName}`,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      const checkpointTaskIdsFromAllRefs = await readQueueCheckpointTaskIdsFromAllRefs({
        repoRoot,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      const worktreeHeadBefore = await readGitHeadIfPresent({
        cwd: expectedQueueWorktreePath,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      const checkpointTaskIdsBeforeSync = await readQueueCheckpointTaskIds({
        cwd: expectedQueueWorktreePath,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      queueWorktree = await ensureWorktree({
        repoRoot,
        name: queueWorktreeName,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      const worktreeHeadAfter = await readGitHeadIfPresent({
        cwd: queueWorktree.path,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      const checkpointTaskIdsAfterSync = await readQueueCheckpointTaskIds({
        cwd: queueWorktree.path,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      checkpointTaskIds = new Set([
        ...checkpointTaskIdsFromAllRefs,
        ...checkpointTaskIdsFromBranch,
        ...checkpointTaskIdsBeforeSync,
        ...checkpointTaskIdsAfterSync,
      ]);
      outcomes = mergeQueueOutcomes(
        rootOutcomes,
        await readQueueOutcomesFromWorktree(queueWorktree.path),
      );
      process.stderr.write(
        `[run-queue] queue worktree sync: path=${queueWorktree.path} headBefore=${worktreeHeadBefore || 'missing'} headAfter=${worktreeHeadAfter || 'unknown'} checkpoints=${checkpointTaskIds.size}\n`,
      );
      queueBaseCheckpoint = await createWorktreeCheckpoint({
        worktreePath: queueWorktree.path,
        taskId: '__queue_base__',
        run: runProcess,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      queueCurrentCheckpoint = queueBaseCheckpoint;
      process.stderr.write(`[run-queue] queue worktree ready: ${queueWorktree.path}\n`);
    } catch (error) {
      const status = error instanceof WorktreeStateError ? error.code : 'HALT_WORKTREE_SETUP_FAILED';
      const summary = {
        id: '__queue_preflight__',
        task: null,
        exitCode: 1,
        status,
        outcome: 'crashed',
        runId: null,
        runTimeLocal: '',
        runTimeUtc: '',
        runMode: status.toLowerCase().replace(/_/g, '-'),
        grokRan: false,
        codexRan: false,
        reviewAgentRan: false,
        iterations: 0,
        worktreeError: error instanceof Error ? error.message : String(error),
        worktreeErrorFiles: error instanceof WorktreeStateError ? error.files : [],
      };
      process.stderr.write(`[run-queue] queue worktree preflight failed: ${summary.worktreeError}\n`);
      process.stdout.write(`${JSON.stringify({
        stopped: true,
        stoppedByUser: false,
        done: 0,
        failed: 0,
        crashed: 1,
        quarantined: 0,
        skipped: 0,
        results: [summary],
      }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
  }

  if (selection.resumeUnfinished) {
    const resumePlan = buildResumeUnfinishedPlan({
      tasks,
      outcomes,
      checkpointTaskIds,
    });
    tasks = filterQueueTasks(queue.tasks || [], {
      ...selection,
      outcomes,
      checkpointTaskIds,
    });
    process.stderr.write(
      `[run-queue] resume-unfinished preflight: queue=${path.basename(queuePath)} total=${resumePlan.total} clean=${resumePlan.cleanCount} next=${resumePlan.nextTaskId || 'none'} attention=${resumePlan.attentionCount}\n`,
    );
  }

  if (!tasks.length) {
    process.stderr.write('[run-queue] resume-unfinished preflight: no unfinished enabled tasks to run\n');
  }

  if (preflightOnly) {
    process.stdout.write(`${JSON.stringify({
      preflightOnly: true,
      selected: tasks.map((entry) => entry.id || entry.task),
      selectedCount: tasks.length,
    }, null, 2)}\n`);
    return;
  }

  const results = [];
  let skippedCount = 0;
  for (const [index, entry] of tasks.entries()) {
    if (stopRequested) break;
    const label = entry.id || entry.task;
    // An explicit single-task run (--only) forces the task to run even if it was
    // auto-disabled; otherwise honor the auto-disable skip.
    const skipCheck = selection.only
      ? { skip: false }
      : shouldSkipAutoDisabledTask({
        entry,
        outcomes,
        maxConsecutiveNoChanges,
      });
    if (skipCheck.skip) {
      skippedCount += 1;
      const skippedSummary = {
        id: label,
        task: entry.task,
        exitCode: 0,
        status: 'SKIPPED_AUTO_DISABLED',
        outcome: 'skipped',
        skipReason: skipCheck.reason,
        consecutiveNoChanges: skipCheck.record?.consecutiveNoChanges ?? 0,
      };
      results.push(skippedSummary);
      process.stderr.write(
        `\n[run-queue] ${index + 1}/${tasks.length} skip ${label}: auto-disabled after ${skipCheck.record?.consecutiveNoChanges ?? 0} HALT_NO_CHANGES\n`,
      );
      continue;
    }

    process.stderr.write(`\n[run-queue] ${index + 1}/${tasks.length} starting ${label}\n`);
    const worktreeScope = resolveWorktreeScope({ entry, defaults });
    let checkpoint = null;
    if ((entry.useWorktree ?? defaults.useWorktree ?? false) && worktreeScope === 'queue' && queueWorktree) {
      checkpoint = queueCurrentCheckpoint;
    }

    const args = buildLoopArgsForQueueEntry({
      agentLoopRoot,
      repoRoot,
      entry,
      defaults,
      index,
      queueWorktreePath: queueWorktree?.path || null,
      gateSets,
      defaultGates,
    });

    const watcher = follow
      ? createLoopProgressWatcher({
        repoRoot,
        taskLabel: label,
        onEvent: (event) => {
          process.stderr.write(`${formatProgressLine({
            taskLabel: label,
            eventType: event.type,
            snapshot: event.snapshot,
            phaseElapsedMs: event.phaseElapsedMs,
            taskElapsedMs: event.taskElapsedMs,
          })}\n`);
        },
      })
      : null;

    const run = await runProcess(process.execPath, args, {
      cwd: agentLoopRoot,
      env: {
        ...process.env,
        AGENT_LOOP_PROGRESS: follow ? '1' : '0',
      },
      timeoutMs: (entry.timeoutMs || defaults.timeoutMs || 1800000) + 120000,
      signal: abortController.signal,
      onStderr: follow
        ? (chunk) => {
          process.stderr.write(chunk);
        }
        : undefined,
      onStdout: follow
        ? (chunk) => {
          if (chunk.trim()) process.stderr.write(chunk);
        }
        : undefined,
    });

    watcher?.stop();

    if (run.aborted || stopRequested) {
      const stoppedSummary = {
        id: label,
        task: entry.task,
        exitCode: run.exitCode,
        guardReason: null,
        worktreeError: null,
        runId: null,
        runTimeLocal: '',
        runTimeUtc: '',
        status: 'HALT_STOPPED',
        fixAgent: entry.fixAgent ?? defaults.fixAgent ?? 'grok',
        reviewAgent: (entry.skipReview ?? defaults.skipReview ?? true)
          ? null
          : (entry.reviewAgent ?? defaults.reviewAgent ?? 'grok'),
        runMode: 'stopped',
        grokRan: false,
        codexRan: false,
        reviewAgentRan: false,
        iterations: 0,
        outcome: 'stopped',
      };
      results.push(stoppedSummary);
      process.stderr.write(`[run-queue] stopped ${label}: user requested stop\n`);
      break;
    }

    const state = await readLatestState(repoRoot);
    let summary = buildQueueSummaryFromState({
      entry,
      state,
      exitCode: run.exitCode,
    });

    const useWorktree = entry.useWorktree ?? defaults.useWorktree ?? false;
    const applyResult = await applyDoneSummaryToMain({
      summary,
      entry,
      state,
      repoRoot,
      defaults,
      applyLatestDiffToMain,
      runner: runProcess,
    });
    summary = applyResult.summary;
    const appliedToMain = applyResult.appliedToMain;
    if (applyResult.landing) {
      process.stderr.write(`[run-queue] applied ${label} diff to main: ${applyResult.landing.patchPath}\n`);
    }
    if (summary.applyError) {
      process.stderr.write(`[run-queue] apply failed ${label}: ${summary.applyError}\n`);
    }
    if (checkpoint && summary.outcome === 'done') {
      try {
        queueCurrentCheckpoint = await createQueueWorktreeCommit({
          worktreePath: queueWorktree.path,
          taskId: label,
          run: runProcess,
          timeoutMs: entry.timeoutMs || defaults.timeoutMs || 1800000,
        });
        process.stderr.write(`[run-queue] queue worktree checkpoint after ${label}: ${queueCurrentCheckpoint.ref}\n`);
      } catch (error) {
        summary.status = 'HALT_QUEUE_CHECKPOINT_FAILED';
        summary.outcome = 'crashed';
        summary.worktreeError = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[run-queue] queue worktree checkpoint failed after ${label}: ${summary.worktreeError}\n`);
      }
    }
    results.push(summary);

    process.stderr.write(`[run-queue] finished ${label}: status=${summary.status} exit=${summary.exitCode} grokRan=${summary.grokRan} codexRan=${summary.codexRan} mode=${summary.runMode}\n`);
    if (!follow) {
      if (run.stderr) process.stderr.write(run.stderr);
      if (run.stdout) process.stderr.write(run.stdout);
    }

    const pauseQueue = shouldPauseQueueAfterSummary(summary);
    if (pauseQueue) {
      summary.outcome = 'stopped';
      summary.queuePauseReason = 'quota_exhausted';
    }

    const outcomeRecord = await recordQueueTaskOutcome({
      repoRoot,
      entry,
      summary,
      maxConsecutiveNoChanges,
      autoDisableOnNoChanges,
    });
    if (outcomeRecord.autoDisabled) {
      process.stderr.write(
        `[run-queue] ⏸ AUTO-DISABLE ${label}: ${outcomeRecord.consecutiveNoChanges} consecutive HALT_NO_CHANGES — 后续队列将跳过，需人工 re-enable\n`,
      );
    }

    // 24/7 unattended mode: never stop the whole queue on a single task. Record the outcome
    // and move on so the rest of the enabled tasks still get their turn. Quarantined tasks
    // (suspected test tampering) are flagged loudly and left for a human — their changes are
    // never auto-merged here — but they do not block the queue either.
    if (summary.outcome === 'quarantined') {
      process.stderr.write(`[run-queue] ⚠ QUARANTINE ${label}: ${summary.status} (POSSIBLE_TEST_TAMPER) — 需人工复核，不自动合并，继续下一条\n`);
    } else if (summary.outcome === 'crashed') {
      process.stderr.write(`[run-queue] 💥 CRASHED ${label}: ${summary.status} exit=${run.exitCode} — 基建/seed 问题，继续下一条\n`);
    } else if (summary.outcome === 'failed') {
      process.stderr.write(`[run-queue] ✗ TASK-FAILED ${label}: ${summary.status} exit=${run.exitCode} — 记录后继续下一条\n`);
    }

    if (checkpoint && summary.outcome !== 'done') {
      try {
        await restoreWorktreeCheckpoint({
          worktreePath: queueWorktree.path,
          checkpoint,
          run: runProcess,
          timeoutMs: entry.timeoutMs || defaults.timeoutMs || 1800000,
        });
        process.stderr.write(`[run-queue] queue worktree restored after ${label}: ${checkpoint.ref}\n`);
      } catch (error) {
        const restoreSummary = buildQueueRestoreFailedSummary({ entry, error });
        results.push(restoreSummary);
        queueRestoreFailed = true;
        process.stderr.write(`[run-queue] queue worktree restore failed (${label}): ${restoreSummary.worktreeError}\n`);
        break;
      }
    }

    if (pauseQueue) {
      process.stderr.write(`[run-queue] quota exhausted after ${label}; pausing queue before starting the next task\n`);
      break;
    }

    const shouldCleanupWorktree = cleanupWorktree
      && useWorktree
      && worktreeScope !== 'queue'
      && !summary.applyError
      && (summary.outcome !== 'done' || appliedToMain);
    if (shouldCleanupWorktree) {
      const worktreeName = sanitizeWorktreeName(entry.worktreeName || entry.id || `task-${index + 1}`);
      try {
        await removeWorktree({ repoRoot, name: worktreeName });
        process.stderr.write(`[run-queue] worktree removed: ${worktreeName}\n`);
      } catch (error) {
        process.stderr.write(`[run-queue] worktree remove warning (${worktreeName}): ${error.message}\n`);
      }
    }
  }

  let queueLanding = null;
  if (queueWorktree && !queueRestoreFailed) {
    try {
      queueLanding = await writeQueueLandingSummary({
        repoRoot,
        queueWorktreePath: queueWorktree.path,
        baseRef: queueBaseCheckpoint?.ref || null,
        tasks: results,
        run: runProcess,
        timeoutMs: defaults.timeoutMs || 1800000,
      });
      process.stderr.write(`[run-queue] queue landing summary: ${queueLanding.diffPath}\n`);
    } catch (error) {
      const summary = {
        id: '__queue_landing__',
        task: null,
        exitCode: 1,
        status: 'HALT_QUEUE_LANDING_FAILED',
        outcome: 'crashed',
        runId: null,
        runTimeLocal: '',
        runTimeUtc: '',
        runMode: 'halt-queue-landing-failed',
        grokRan: false,
        codexRan: false,
        reviewAgentRan: false,
        iterations: 0,
        applyError: error instanceof Error ? error.message : String(error),
      };
      results.push(summary);
      process.stderr.write(`[run-queue] queue landing failed: ${summary.applyError}\n`);
    }
  }

  const doneCount = results.filter((r) => r.outcome === 'done').length;
  const failedCount = results.filter((r) => r.outcome === 'failed').length;
  const crashedCount = results.filter((r) => r.outcome === 'crashed').length;
  const quarantinedCount = results.filter((r) => r.outcome === 'quarantined').length;
  const stoppedCount = results.filter((r) => r.outcome === 'stopped').length;
  process.stderr.write(`\n${buildQueueCompletionMessage({
    done: doneCount,
    failed: failedCount,
    crashed: crashedCount,
    quarantined: quarantinedCount,
    skipped: skippedCount,
    stopped: stoppedCount,
    total: results.length,
  })}\n`);
  for (const r of results) {
    if (r.outcome !== 'done' && r.outcome !== 'skipped') {
      process.stderr.write(`[run-queue]   - ${r.outcome.toUpperCase()} ${r.id}: ${r.status} exit=${r.exitCode}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({
    stopped: stoppedCount > 0,
    stoppedByUser: stoppedCount > 0,
    done: doneCount,
    failed: failedCount,
    crashed: crashedCount,
    quarantined: quarantinedCount,
    skipped: skippedCount,
    queueLanding,
    results,
  }, null, 2)}\n`);

  // Non-zero exit if anything did not cleanly finish, so callers/CI still notice — but only
  // after every enabled task has had its turn.
  if (failedCount > 0 || crashedCount > 0 || quarantinedCount > 0 || stoppedCount > 0) {
    process.exitCode = 1;
  }
}

function resolveQueuePath(argv) {
  const flagIndex = argv.indexOf('--queue');
  if (flagIndex >= 0) {
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--queue requires a path');
    }
    return path.resolve(process.cwd(), value);
  }
  return defaultQueuePath;
}

function resolveQueueSelection(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  return {
    only: valueAfter('--only'),
    from: valueAfter('--from'),
    limit: valueAfter('--limit'),
    resumeUnfinished: argv.includes('--resume-unfinished'),
  };
}

function collectGateSets(queue, defaultGates) {
  const gateSets = { gates: defaultGates };
  for (const [key, value] of Object.entries(queue)) {
    if (key === 'gates') continue;
    if (!key.endsWith('Gates')) continue;
    if (Array.isArray(value)) gateSets[key] = value;
  }
  return gateSets;
}

async function readQueueOutcomesFromWorktree(worktreePath) {
  const filePath = path.join(worktreePath, '.agent-loop', 'queue-outcomes.json');
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { tasks: {} };
    throw error;
  }
}

async function readGitHeadIfPresent({ cwd, timeoutMs }) {
  try {
    await fs.access(cwd);
  } catch {
    return null;
  }
  const result = await runProcess('git', ['rev-parse', 'HEAD'], { cwd, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) return null;
  return result.stdout.trim() || null;
}

async function readQueueCheckpointTaskIds({ cwd, timeoutMs }) {
  try {
    await fs.access(cwd);
  } catch {
    return new Set();
  }
  const result = await runProcess('git', [
    'log',
    '--format=%s',
    '--grep=^agent-loop queue checkpoint:',
  ], { cwd, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) return new Set();
  return parseQueueCheckpointSubjects(result.stdout);
}

async function readQueueCheckpointTaskIdsFromBranch({ repoRoot, branch, timeoutMs }) {
  const exists = await runProcess('git', ['rev-parse', '--verify', '--quiet', branch], {
    cwd: repoRoot,
    timeoutMs,
  });
  if (exists.exitCode !== 0 || exists.timedOut || exists.spawnError) return new Set();
  const result = await runProcess('git', [
    'log',
    '--format=%s',
    '--grep=^agent-loop queue checkpoint:',
    branch,
  ], { cwd: repoRoot, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) return new Set();
  return parseQueueCheckpointSubjects(result.stdout);
}

async function readQueueCheckpointTaskIdsFromAllRefs({ repoRoot, timeoutMs }) {
  const result = await runProcess('git', [
    'log',
    '--all',
    '--format=%s',
    '--grep=^agent-loop queue checkpoint:',
  ], { cwd: repoRoot, timeoutMs });
  if (result.exitCode !== 0 || result.timedOut || result.spawnError) return new Set();
  return parseQueueCheckpointSubjects(result.stdout);
}

function parseQueueCheckpointSubjects(stdout = '') {
  const taskIds = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^agent-loop queue checkpoint:\s*(.+)$/)?.[1]?.trim())
    .filter(Boolean);
  return new Set(taskIds);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
