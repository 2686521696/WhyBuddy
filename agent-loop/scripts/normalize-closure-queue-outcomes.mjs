import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Schema for normalized queue outcome record (focused on 119 closure hygiene)
export const CLOSURE_QUEUE_OUTCOME_SCHEMA = {
  lastStatus: 'string|null',
  lastOutcome: 'string|null',
  lastRunId: 'string|null',
  lastUpdatedAt: 'iso-string',
  consecutiveNoChanges: 'number',
  autoDisabled: 'boolean',
  applyStatus: 'string|undefined',
  applyErrorKind: 'string|undefined',
  rescuePatchAvailable: 'boolean|undefined',
  closureStatus: 'closed|blocked|pending|undefined (optional for 119 shards)',
};

// Normalize queue outcomes for 119 closure shards / 118 cross shards after review/landing.
// - For clean DONE_REVIEWED + done: clear stale rescue/apply fields (hygiene)
// - Never promote failed/crashed/HALT to done (fail-closed)
// - Idempotent; only touches closure-prefixed ids
// - Deterministic by default: preserves original lastUpdatedAt (use options.now for explicit fixed time)
export function normalizeClosureQueueOutcomes(outcomes = { tasks: {} }, options = {}) {
  const { closurePrefixes = ['sliderule-v2-closure-', 'sliderule-v2-cross-runtime-118-shard-'], now = null } = options;
  const tasks = { ...(outcomes.tasks || {}) };
  let normalized = 0;
  let skippedBad = 0;

  for (const [taskId, record] of Object.entries(tasks)) {
    const isClosureTask = closurePrefixes.some((p) => taskId.includes(p));
    if (!isClosureTask || !record) continue;

    const status = record.lastStatus || '';
    const outcome = record.lastOutcome || '';

    if ((status === 'DONE_REVIEWED' || status === 'DONE_FIXED') && outcome === 'done') {
      // positive hygiene: clean stale fields
      const next = { ...record };
      delete next.applyStatus;
      delete next.applyErrorKind;
      delete next.applyErrorFiles;
      delete next.applyError;
      if (next.rescuePatchAvailable != null) next.rescuePatchAvailable = false;
      next.consecutiveNoChanges = 0;
      next.autoDisabled = false;
      next.autoDisabledAt = null;
      if (now != null) {
        next.lastUpdatedAt = typeof now === 'string' ? now : now.toISOString();
      }
      // else: preserve original lastUpdatedAt for deterministic local behavior
      next.closureStatus = 'closed';
      tasks[taskId] = next;
      normalized += 1;
    } else if (outcome === 'failed' || outcome === 'crashed' || status.startsWith('HALT_')) {
      // fail-closed negative: do not rewrite bad states
      skippedBad += 1;
    }
  }

  return {
    ...outcomes,
    tasks,
    meta: {
      normalizedFor: '119-closure-queue-outcome-cleanup',
      normalizedCount: normalized,
      skippedBadCount: skippedBad,
      prefixes: closurePrefixes,
    },
  };
}

function buildPositiveFixture() {
  return {
    tasks: {
      'sliderule-v2-closure-precheck-05-closure-queue-outcome-cleanup-119': {
        lastStatus: 'DONE_REVIEWED',
        lastOutcome: 'done',
        lastRunId: 'run-119-05',
        lastUpdatedAt: '2026-07-02T10:00:00.000Z',
        consecutiveNoChanges: 0,
        autoDisabled: false,
        applyStatus: 'RESCUE_PATCH_AVAILABLE',
        rescuePatchAvailable: true,
        closureStatus: 'pending',
      },
      'sliderule-v2-cross-runtime-118-shard-07-queue': {
        lastStatus: 'DONE_REVIEWED',
        lastOutcome: 'done',
        lastRunId: 'run-118-07',
        lastUpdatedAt: '2026-07-01T09:00:00.000Z',
        consecutiveNoChanges: 1,
        applyErrorKind: 'PARTIAL',
      },
    },
  };
}

function buildNegativeFixture() {
  return {
    tasks: {
      'sliderule-v2-closure-ui-04-workbench-outcome-closure-status-119': {
        lastStatus: 'HALT_NO_CHANGES',
        lastOutcome: 'failed',
        consecutiveNoChanges: 2,
        autoDisabled: true,
      },
      'sliderule-v2-cross-runtime-118-shard-02-queue': {
        lastStatus: 'APPLY_CONFLICT',
        lastOutcome: 'crashed',
        applyErrorKind: 'PATCH_CONFLICT',
      },
    },
  };
}

function isDirectExecution() {
  // Reliable direct-run (node script.mjs) detection.
  // Prevents main() side-effects (Usage + exitCode) when the module is imported via ESM.
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const posIn = buildPositiveFixture();
    const negIn = buildNegativeFixture();
    const posOut = normalizeClosureQueueOutcomes(posIn);
    const negOut = normalizeClosureQueueOutcomes(negIn);

    // positive evidence
    const posTask = posOut.tasks['sliderule-v2-closure-precheck-05-closure-queue-outcome-cleanup-119'];
    const posShard = posOut.tasks['sliderule-v2-cross-runtime-118-shard-07-queue'];
    const posOut2 = normalizeClosureQueueOutcomes(posIn);
    const positiveEvidence = {
      inputHasStale: !!(posIn.tasks['sliderule-v2-closure-precheck-05-closure-queue-outcome-cleanup-119'].rescuePatchAvailable),
      cleanedRescue: posTask.rescuePatchAvailable === false,
      clearedApply: posTask.applyStatus === undefined,
      resetStreak: posTask.consecutiveNoChanges === 0,
      markedClosed: posTask.closureStatus === 'closed',
      shardCleaned: posShard && posShard.applyErrorKind === undefined,
      // determinism evidence (preserve original lastUpdatedAt, identical runs)
      preservedTime: posTask.lastUpdatedAt === posIn.tasks['sliderule-v2-closure-precheck-05-closure-queue-outcome-cleanup-119'].lastUpdatedAt,
      deterministic: JSON.stringify(posOut) === JSON.stringify(posOut2),
    };

    // fail-closed negative: bad states untouched
    const negTask = negOut.tasks['sliderule-v2-closure-ui-04-workbench-outcome-closure-status-119'];
    const negShard = negOut.tasks['sliderule-v2-cross-runtime-118-shard-02-queue'];
    const negativeEvidence = {
      haltPreserved: negTask.lastStatus === 'HALT_NO_CHANGES' && negTask.lastOutcome === 'failed',
      crashedPreserved: negShard.lastOutcome === 'crashed' && !!negShard.applyErrorKind,
      noFakeDone: negTask.lastOutcome !== 'done' && negShard.lastOutcome !== 'done',
    };

    // file I/O hygiene evidence: proves full normalized JSON output + writeback path (addresses review)
    // uses temp file + atomic write pattern + cleanup; exercises positive cleanup + fail-closed
    let fileEvidence = { fullOutput: false, writeCleaned: false, badStatesPreserved: false };
    try {
      const tmp = `agent-loop/scripts/.tmp-norm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
      const posIn = buildPositiveFixture();
      const negIn = buildNegativeFixture();
      await fs.writeFile(tmp, JSON.stringify(posIn, null, 2));
      const readIn = JSON.parse(await fs.readFile(tmp, 'utf8'));
      const normResult = normalizeClosureQueueOutcomes(readIn);
      // full normalized JSON shape available for consumers
      const hasFull = !!normResult.tasks && !!normResult.meta && 'normalizedCount' in normResult.meta;
      // simulate writeback (the code path used by --write)
      const wtmp = `${tmp}.write`;
      await fs.writeFile(wtmp, `${JSON.stringify(normResult, null, 2)}\n`);
      await fs.rename(wtmp, tmp);
      const afterWrite = JSON.parse(await fs.readFile(tmp, 'utf8'));
      const p = afterWrite.tasks['sliderule-v2-closure-precheck-05-closure-queue-outcome-cleanup-119'];
      const writeCleaned = p && p.rescuePatchAvailable === false && p.closureStatus === 'closed' && p.applyStatus === undefined;
      // now feed a negative fixture and ensure no rewrite of bad to done
      await fs.writeFile(tmp, JSON.stringify(negIn, null, 2));
      const normNeg = normalizeClosureQueueOutcomes(JSON.parse(await fs.readFile(tmp, 'utf8')));
      const n = normNeg.tasks['sliderule-v2-closure-ui-04-workbench-outcome-closure-status-119'];
      const badPreserved = n && n.lastOutcome === 'failed' && n.lastStatus === 'HALT_NO_CHANGES';
      fileEvidence = { fullOutput: hasFull, writeCleaned, badStatesPreserved: badPreserved };
      await fs.unlink(tmp).catch(() => {});
      await fs.unlink(wtmp).catch(() => {});
    } catch (e) {
      fileEvidence = { fullOutput: false, writeCleaned: false, badStatesPreserved: false, error: String(e.message) };
    }

    const allGood = positiveEvidence.cleanedRescue === true
      && positiveEvidence.clearedApply === true
      && positiveEvidence.markedClosed === true
      && positiveEvidence.preservedTime === true
      && positiveEvidence.deterministic === true
      && negativeEvidence.haltPreserved === true
      && negativeEvidence.crashedPreserved === true
      && negativeEvidence.noFakeDone === true
      && fileEvidence.fullOutput === true
      && fileEvidence.writeCleaned === true
      && fileEvidence.badStatesPreserved === true;

    const evidence = {
      mode: 'self-test',
      positive: positiveEvidence,
      negative: negativeEvidence,
      file: fileEvidence,
      metaOut: posOut.meta,
      ok: allGood,
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (!allGood) {
      process.exitCode = 1;
    }
    return;
  }

  // support reading a queue-outcomes.json and normalizing (hygiene path)
  // find non-flag arg that looks like outcomes/queue json
  const fileArg = argv.find((a) => !a.startsWith('--') && (a.endsWith('.json') || a.includes('outcome') || a.includes('queue')));
  if (fileArg) {
    try {
      const raw = await fs.readFile(fileArg, 'utf8');
      const data = JSON.parse(raw);
      const result = normalizeClosureQueueOutcomes(data);
      const doWrite = argv.includes('--write') || argv.includes('--in-place');
      if (doWrite) {
        // safe atomic write for actual cleanup/hygiene
        const tmpPath = `${fileArg}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmpPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        await fs.rename(tmpPath, fileArg);
        process.stderr.write(`[normalize] wrote normalized outcomes to ${fileArg} (normalizedCount=${result.meta.normalizedCount})\n`);
      }
      // Emit FULL normalized JSON (not just meta) so it is a consumable deterministic artifact for main flow / landing
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (e) {
      console.error('Failed to normalize outcomes file:', e.message);
      process.exitCode = 1;
    }
    return;
  }

  console.error('Usage: node normalize-closure-queue-outcomes.mjs --self-test');
  console.error('   or: node normalize-closure-queue-outcomes.mjs [--write] <queue-outcomes.json>');
  process.exitCode = 1;
}

if (isDirectExecution()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
