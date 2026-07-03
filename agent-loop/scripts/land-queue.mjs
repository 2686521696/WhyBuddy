import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { runProcess } from '../src/runProcess.js';
import { applyQueueLandingToMain } from '../src/loopApply.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

// Schema for final reviewed landing commit summary (119 closure-final-landing-commit precheck objective)
export const LANDING_COMMIT_SUMMARY_SCHEMA = {
  changedFiles: 'string[]',
  exportedSymbols: 'string[]',
  validationCommands: 'string[]',
  mainCleanStatus: "'clean' | 'dirty' | 'unknown'",
  evidencePresent: 'boolean',
  closureAdvanced: 'boolean',
};

// prepareFinalLandingCommitSummary: executable pure helper for landing evidence + clean main status.
// Used to prepare candidate material for Codex review / main landing.
// Deterministic, includes positive evidence (clean + full report data) and fail-closed negative (dirty or incomplete -> no advance claim).
export function prepareFinalLandingCommitSummary(input = {}, options = {}) {
  const {
    changedFiles = [],
    exportedSymbols = [],
    validationCommands = [],
    gitStatusPorcelain = '',
    hasReportContent = false,
  } = input;
  const mainCleanStatus = (gitStatusPorcelain || '').trim() === '' ? 'clean' : 'dirty';
  const evidencePresent = Array.isArray(validationCommands) && validationCommands.length > 0 && !!hasReportContent;
  // closureAdvanced only true on clean + real evidence + files (fail-closed otherwise)
  const closureAdvanced = mainCleanStatus === 'clean' && evidencePresent && changedFiles.length > 0;
  return {
    changedFiles: [...changedFiles],
    exportedSymbols: [...exportedSymbols],
    validationCommands: [...validationCommands],
    mainCleanStatus,
    evidencePresent,
    closureAdvanced,
    meta: {
      forTask: 'sliderule-v2-closure-precheck-06-closure-final-landing-commit-119',
      schemaVersion: '1',
    },
  };
}

function buildPositiveLandingFixture() {
  return {
    changedFiles: [
      'agent-loop/scripts/land-queue.mjs',
      'agent-loop/tasks/sliderule-v2-closure-precheck-06-closure-final-landing-commit-119.md',
    ],
    exportedSymbols: [
      'prepareFinalLandingCommitSummary',
      'LANDING_COMMIT_SUMMARY_SCHEMA',
    ],
    validationCommands: [
      'node agent-loop/scripts/land-queue.mjs --self-test',
      'git status --porcelain',
      'node -e "..."',
    ],
    gitStatusPorcelain: '',
    hasReportContent: true,
  };
}

function buildNegativeLandingFixture() {
  return {
    changedFiles: [],
    exportedSymbols: [],
    validationCommands: [],
    gitStatusPorcelain: 'M foo/bar.ts\n?? baz',
    hasReportContent: false,
  };
}

function isDirectExecution() {
  // Reliable direct-run (node script.mjs) detection to avoid side effects on ESM import (used by -e tests, reports).
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
    const posIn = buildPositiveLandingFixture();
    const negIn = buildNegativeLandingFixture();
    const posOut = prepareFinalLandingCommitSummary(posIn);
    const negOut = prepareFinalLandingCommitSummary(negIn);

    const positiveEvidence = {
      cleanMain: posOut.mainCleanStatus === 'clean',
      evidencePresent: posOut.evidencePresent === true,
      closureAdvanced: posOut.closureAdvanced === true,
      filesListed: posOut.changedFiles.length === 2,
      symbolsExported: posOut.exportedSymbols.includes('prepareFinalLandingCommitSummary'),
      deterministic: JSON.stringify(posOut) === JSON.stringify(prepareFinalLandingCommitSummary(posIn)),
    };

    const negativeEvidence = {
      dirtyMain: negOut.mainCleanStatus === 'dirty',
      noEvidenceWhenMissing: negOut.evidencePresent === false,
      noFakeAdvance: negOut.closureAdvanced === false,
      noFakeClean: negOut.mainCleanStatus !== 'clean',
    };

    const allGood = positiveEvidence.cleanMain === true
      && positiveEvidence.evidencePresent === true
      && positiveEvidence.closureAdvanced === true
      && positiveEvidence.deterministic === true
      && negativeEvidence.dirtyMain === true
      && negativeEvidence.noEvidenceWhenMissing === true
      && negativeEvidence.noFakeAdvance === true
      && negativeEvidence.noFakeClean === true;

    const evidence = {
      mode: 'self-test',
      positive: positiveEvidence,
      negative: negativeEvidence,
      posOut,
      negOut,
      ok: allGood,
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (!allGood) process.exitCode = 1;
    return;
  }

  if (argv.includes('--summary')) {
    // Emit a structured summary stub (evidence commands + clean status) for final landing commit prep.
    // Consumers (report, codex) use this as candidate slice.
    const repoRoot = valueAfter(argv, '--repo') || path.resolve(agentLoopRoot, '..');
    let porcelain = '';
    try {
      // best-effort local status for evidence only; never mutate
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
      porcelain = (r.stdout || '').trim();
    } catch {}
    const stub = prepareFinalLandingCommitSummary({
      changedFiles: [],
      exportedSymbols: [],
      validationCommands: [
        'node agent-loop/scripts/land-queue.mjs --self-test',
        'git status --porcelain',
        'node agent-loop/scripts/land-queue.mjs --check --repo <main-repo>',
      ],
      gitStatusPorcelain: porcelain,
      hasReportContent: true,
    });
    process.stdout.write(`${JSON.stringify({ summary: stub, schema: 'LANDING_COMMIT_SUMMARY_SCHEMA' }, null, 2)}\n`);
    return;
  }

  const check = argv.includes('--check');
  const repoRoot = valueAfter(argv, '--repo') || path.resolve(agentLoopRoot, '..');

  try {
    const result = await applyQueueLandingToMain({ repoRoot, runner: runProcess, check });
    if (check) {
      process.stderr.write(`[land] check passed: queue patch can land cleanly (${result.patchPath})\n`);
    } else {
      process.stderr.write(`[land] applied queue patch to main: ${result.patchPath}\n`);
    }
  } catch (error) {
    const kind = error?.kind || 'ERROR';
    process.stderr.write(`[land] ${check ? 'check' : 'apply'} failed (${kind}): ${error.message}\n`);
    if (Array.isArray(error?.files) && error.files.length) {
      process.stderr.write(`[land] files: ${error.files.join(', ')}\n`);
    }
    process.exitCode = 1;
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
