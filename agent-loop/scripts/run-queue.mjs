import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQueueOutcomes, recordQueueTaskOutcome, shouldSkipAutoDisabledTask } from '../src/queueOutcomes.js';
import { runProcess } from '../src/runProcess.js';
import {
  buildLoopArgsForQueueEntry,
  buildQueueCompletionMessage,
  buildQueueSummaryFromState,
  filterQueueTasks,
  sanitizeWorktreeName,
} from '../src/runQueue.js';
import {
  createLoopProgressWatcher,
  formatProgressLine,
  readLatestState,
} from '../src/runQueueProgress.js';
import { removeWorktree } from '../src/worktree.js';

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
  const queuePath = resolveQueuePath(argv);
  const selection = resolveQueueSelection(argv);
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const repoRoot = path.resolve(agentLoopRoot, queue.cwd || '..');
  const defaults = queue.defaults || {};
  const defaultGates = queue.gates || [];
  const gateSets = collectGateSets(queue, defaultGates);
  const maxConsecutiveNoChanges = defaults.maxConsecutiveNoChanges ?? 3;
  const autoDisableOnNoChanges = defaults.autoDisableOnNoChanges ?? true;
  const cleanupWorktree = defaults.cleanupWorktree ?? true;
  const outcomes = await readQueueOutcomes(repoRoot);
  const tasks = filterQueueTasks(queue.tasks || [], selection);

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

  const results = [];
  let skippedCount = 0;
  for (const [index, entry] of tasks.entries()) {
    if (stopRequested) break;
    const label = entry.id || entry.task;
    const skipCheck = shouldSkipAutoDisabledTask({
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

    const args = buildLoopArgsForQueueEntry({
      agentLoopRoot,
      repoRoot,
      entry,
      defaults,
      index,
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
    const summary = buildQueueSummaryFromState({
      entry,
      state,
      exitCode: run.exitCode,
    });
    results.push(summary);

    process.stderr.write(`[run-queue] finished ${label}: status=${summary.status} exit=${summary.exitCode} grokRan=${summary.grokRan} codexRan=${summary.codexRan} mode=${summary.runMode}\n`);
    if (!follow) {
      if (run.stderr) process.stderr.write(run.stderr);
      if (run.stdout) process.stderr.write(run.stdout);
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

    const useWorktree = entry.useWorktree ?? defaults.useWorktree ?? false;
    if (cleanupWorktree && useWorktree) {
      const worktreeName = sanitizeWorktreeName(entry.worktreeName || entry.id || `task-${index + 1}`);
      try {
        await removeWorktree({ repoRoot, name: worktreeName });
        process.stderr.write(`[run-queue] worktree removed: ${worktreeName}\n`);
      } catch (error) {
        process.stderr.write(`[run-queue] worktree remove warning (${worktreeName}): ${error.message}\n`);
      }
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
