import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/runProcess.js';
import { buildLoopArgsForQueueEntry, buildQueueSummaryFromState } from '../src/runQueue.js';
import {
  createLoopProgressWatcher,
  formatProgressLine,
  readLatestState,
} from '../src/runQueueProgress.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultQueuePath = path.join(agentLoopRoot, 'scripts', 'migration-queue.json');

async function main() {
  const argv = process.argv.slice(2);
  const follow = !argv.includes('--no-follow');
  const queuePath = resolveQueuePath(argv);
  const queue = JSON.parse(await fs.readFile(queuePath, 'utf8'));
  const repoRoot = path.resolve(agentLoopRoot, queue.cwd || '..');
  const defaults = queue.defaults || {};
  const defaultGates = queue.gates || [];
  const gateSets = {
    gates: defaultGates,
    infraGates: queue.infraGates || defaultGates,
    poolGates: queue.poolGates || defaultGates,
    jsonGates: queue.jsonGates || defaultGates,
  };
  const tasks = (queue.tasks || []).filter((entry) => entry.enabled !== false);

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
  for (const [index, entry] of tasks.entries()) {
    const label = entry.id || entry.task;
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

    const done = summary.status?.startsWith('DONE_');
    const halted = summary.status?.startsWith('HALT_');
    if (!done || run.exitCode !== 0) {
      process.stderr.write(`[run-queue] stopping queue after ${label}\n`);
      process.stdout.write(`${JSON.stringify({ stopped: true, results }, null, 2)}\n`);
      process.exitCode = run.exitCode || (halted ? 1 : 1);
      return;
    }
  }

  process.stdout.write(`${JSON.stringify({ stopped: false, results }, null, 2)}\n`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});