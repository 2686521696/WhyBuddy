import fs from 'node:fs/promises';
import path from 'node:path';
import { parseLoopArgs } from './loopArgs.js';
import { runLoop } from './loopEngine.js';
import { buildLoopReport, buildLoopReportJson } from './loopReport.js';
import { summarizeRunRecord } from './runSummary.js';
import { tryAutoSyncTaskStatus } from './syncTaskStatusCore.js';
import {
  formatAgentProgressLine,
  formatLoopStateLine,
  shouldEmitLoopProgress,
} from './loopProgress.js';

async function main() {
  const options = parseLoopArgs(process.argv.slice(2));
  const resumeState = options.resume ? JSON.parse(await fs.readFile(options.resume, 'utf8')) : null;
  const activeOptions = resumeState
    ? {
      ...resumeState.options,
      resume: options.resume,
      pauseBeforeFix: false,
      syncTaskStatus: resolveResumeSyncOption({
        flag: '--no-sync-task-status',
        resumeStateValue: resumeState.options?.syncTaskStatus,
      }),
      syncMigrationStatus: resolveResumeSyncOption({
        flag: '--no-sync-migration-status',
        resumeStateValue: resumeState.options?.syncMigrationStatus,
      }),
    }
    : options;
  const runId = resumeState?.runId || timestamp();
  const runDir = resumeState?.artifacts?.runDir || path.join(activeOptions.cwd, '.agent-loop', 'runs', runId);
  const latestDir = resumeState?.artifacts?.latestDir || path.join(activeOptions.cwd, '.agent-loop', 'latest');
  if (!resumeState) {
    await fs.mkdir(runDir, { recursive: true });
    await fs.rm(latestDir, { recursive: true, force: true });
    await fs.mkdir(latestDir, { recursive: true });
  }

  const writeArtifact = async (fileName, content, kind = 'text') => {
    if (kind === 'json') {
      await writeTextBoth(runDir, latestDir, fileName, `${JSON.stringify(content, null, 2)}\n`);
    } else {
      await writeTextBoth(runDir, latestDir, fileName, String(content ?? ''));
    }
  };

  const appendArtifact = async (fileName, content) => {
    await appendTextBoth(runDir, latestDir, fileName, String(content ?? ''));
  };

  const emitProgress = shouldEmitLoopProgress();
  const progressStartedAt = Date.now();
  let lastReportedStatus = null;

  const result = await runLoop({
    options: activeOptions,
    runId,
    runDir,
    latestDir,
    resumeState,
    deps: {
      writeArtifact,
      appendArtifact,
      onProgress: emitProgress
        ? (event) => {
          process.stderr.write(`${formatAgentProgressLine({
            ...event,
            startedAt: progressStartedAt,
          })}\n`);
        }
        : async () => {},
      onState: async (state) => {
        await writeArtifact('state.json', state, 'json');
        if (emitProgress && state.status !== lastReportedStatus) {
          lastReportedStatus = state.status;
          process.stderr.write(`${formatLoopStateLine(state, progressStartedAt)}\n`);
        }
      },
    },
  });

  const runSummary = summarizeRunRecord({
    runId,
    status: result.status,
    task: activeOptions.task,
    iterations: result.iterations || [],
    grokFix: result.grokFix,
    agentFix: result.agentFix,
    codexReview: result.codexReview,
    grokReview: result.grokReview,
    agentReview: result.agentReview,
    fixAgent: activeOptions.fixAgent,
    reviewAgent: activeOptions.skipReview ? null : activeOptions.reviewAgent,
  });
  const report = buildLoopReport({
    runId,
    cwd: activeOptions.cwd,
    fixCwd: result.worktree?.fixCwd || activeOptions.fixCwd || activeOptions.cwd,
    task: activeOptions.task,
    gates: activeOptions.gates,
    baselineGate: result.baselineGate,
    finalState: result.status,
    fixAgent: activeOptions.fixAgent,
    reviewAgent: activeOptions.skipReview ? null : activeOptions.reviewAgent,
    agentFix: result.agentFix,
    agentReview: result.agentReview,
    grokFix: result.grokFix,
    codexReview: result.codexReview,
    grokReview: result.grokReview,
    iterations: result.iterations || [],
    reviewRounds: result.reviewRounds || [],
    maxIterations: activeOptions.maxIterations,
    lang: activeOptions.lang,
    runMode: runSummary.runMode,
    grokRan: runSummary.grokRan,
    codexRan: runSummary.codexRan,
    runTimeLocal: runSummary.runTimeLocal,
    runTimeUtc: runSummary.runTimeUtc,
  });
  await writeArtifact('final-report.md', report, 'text');
  await writeArtifact('final-report.json', buildLoopReportJson({
    runId,
    cwd: activeOptions.cwd,
    fixCwd: result.worktree?.fixCwd || activeOptions.fixCwd || activeOptions.cwd,
    task: activeOptions.task,
    gates: activeOptions.gates,
    baselineGate: result.baselineGate,
    finalState: result.status,
    fixAgent: activeOptions.fixAgent,
    reviewAgent: activeOptions.skipReview ? null : activeOptions.reviewAgent,
    iterations: result.iterations || [],
    reviewRounds: result.reviewRounds || [],
    maxIterations: activeOptions.maxIterations,
    lang: activeOptions.lang,
    runMode: runSummary.runMode,
    grokRan: runSummary.grokRan,
    codexRan: runSummary.codexRan,
    runTimeLocal: runSummary.runTimeLocal,
    runTimeUtc: runSummary.runTimeUtc,
  }), 'json');

  await tryAutoSyncTaskStatus(activeOptions, runSummary);

  console.log(path.join(latestDir, 'final-report.md'));
  if (result.status.startsWith('HALT_')) {
    process.exitCode = result.status === 'HALT_AGENT_NOT_FOUND' ? 2 : 1;
  }
}

async function writeTextBoth(runDir, latestDir, fileName, content) {
  await fs.writeFile(path.join(runDir, fileName), content, 'utf8');
  await fs.writeFile(path.join(latestDir, fileName), content, 'utf8');
}

async function appendTextBoth(runDir, latestDir, fileName, content) {
  await fs.appendFile(path.join(runDir, fileName), content, 'utf8');
  await fs.appendFile(path.join(latestDir, fileName), content, 'utf8');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveResumeSyncOption({ flag, resumeStateValue }) {
  if (process.argv.includes(flag)) {
    return false;
  }
  return resumeStateValue ?? true;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
