import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateGate as defaultEvaluateGate } from './gates.js';
import { captureDiff as defaultCaptureDiff, hasDiffChanged } from './diff.js';
import { buildGrokFixPrompt } from './grokPrompt.js';
import { ensureWorktree as defaultEnsureWorktree } from './worktree.js';
import { resolveAgents as defaultResolveAgents } from './resolveAgents.js';
import { runProcess as defaultRunProcess } from './runProcess.js';
import { buildCodexReviewArgs, buildGrokJsonArgs } from './commands.js';
import { madeGateProgress, summarizeGateProgress } from './gateProgress.js';
import { classifyAgentFailure } from './agentFailure.js';
import { analyzeDiffGuard } from './diffGuard.js';
import { resolveAgentInvocation } from './agentProcess.js';

export async function runLoop({ options, runId = timestamp(), runDir, latestDir, resumeState = null, deps = {} }) {
  const {
    resolveAgents = defaultResolveAgents,
    ensureWorktree = defaultEnsureWorktree,
    evaluateGate = defaultEvaluateGate,
    captureDiff = defaultCaptureDiff,
    runProcess = defaultRunProcess,
    sleep = defaultSleep,
    onState = async () => {},
    writeArtifact = async () => {},
  } = deps;

  const state = resumeState ? snapshotState(resumeState) : {
    runId,
    status: 'INIT',
    options,
    agents: null,
    worktree: null,
    baselineGate: null,
    baselineGateSnapshot: null,
    baselineDiff: null,
    baselineDiffText: '',
    iterations: [],
    grokFix: null,
    codexReview: null,
    artifacts: {
      runDir,
      latestDir,
    },
  };

  async function transition(status, patch = {}) {
    Object.assign(state, patch, { status });
    await onState(snapshotState(state));
  }

  if (resumeState) {
    state.options = options;
    await transition('RESUMED');
  } else {
    await transition('INIT');
  }

  const agents = await resolveAgents();
  await transition('PROBED', { agents });
  if (!agents.codex || !agents.grok) {
    await transition('HALT_AGENT_NOT_FOUND');
    return snapshotState(state);
  }

  const taskPath = path.resolve(options.cwd, options.task);
  const taskText = await fs.readFile(taskPath, 'utf8');
  if (!resumeState) await writeArtifact('task.md', taskText, 'text');

  let worktree = null;
  if (!resumeState && options.createWorktree) {
    worktree = await ensureWorktree({
      repoRoot: options.cwd,
      name: options.createWorktree,
      timeoutMs: options.timeoutMs,
    });
  }
  const fixCwd = options.fixCwd || state.worktree?.fixCwd || worktree?.path || options.cwd;
  let baselineGate = state.baselineGateSnapshot;
  let baselineDiff = { text: state.baselineDiffText || '' };

  if (!resumeState) {
    await transition('WORKTREE_READY', {
      worktree: {
        targetCwd: options.cwd,
        fixCwd,
        details: worktree,
      },
    });

    baselineGate = await evaluateGate({
      cwd: fixCwd,
      commands: options.gates,
      timeoutMs: options.timeoutMs,
    });
    await writeArtifact('baseline-gate.json', baselineGate, 'json');
    await writeGateArtifacts({ prefix: 'baseline', gate: baselineGate, writeArtifact });
    baselineDiff = await captureDiff({ cwd: fixCwd, timeoutMs: options.timeoutMs });
    await writeArtifact('baseline.diff.patch', baselineDiff.text, 'text');
    await transition('BASELINE_GATE_RESULT', {
      baselineGate: summarizeGate(baselineGate),
      baselineGateSnapshot: baselineGate,
      baselineDiff: summarizeDiff(baselineDiff.text),
      baselineDiffText: baselineDiff.text,
    });
  } else if (!baselineGate) {
    throw new Error('resume state is missing baselineGateSnapshot');
  }

  if (!resumeState && baselineGate.ok) {
    if (options.skipReview) {
      await transition('DONE_GATE_ONLY');
      return snapshotState(state);
    }
    return await runFinalCodexReview({
      state,
      agents,
      fixCwd,
      options,
      runProcess,
      writeArtifact,
      transition,
    });
  }

  if (!options.autoFix) {
    await transition('HALT_HUMAN');
    return snapshotState(state);
  }

  if (!resumeState && options.pauseBeforeFix) {
    await transition('PAUSED_BEFORE_FIX', {
      currentIteration: 1,
      baselineGate: summarizeGate(baselineGate),
      baselineGateSnapshot: baselineGate,
      baselineDiff: summarizeDiff(baselineDiff.text),
      baselineDiffText: baselineDiff.text,
    });
    return snapshotState(state);
  }

  const iterations = state.iterations || [];
  const maxIterations = options.maxIterations ?? 3;
  const lastIteration = resumeState ? iterations.at(-1) : null;
  let previousDiff = lastIteration?.diffText ?? baselineDiff.text;
  let currentGate = lastIteration?.gateSnapshot ?? baselineGate;
  const startIteration = lastIteration ? lastIteration.iteration + 1 : 1;

  for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
    await transition('BUDGET_LOOP_HEAD', { currentIteration: iteration });

    const prompt = buildGrokFixPrompt({
      taskText,
      gate: currentGate,
    });
    await writeArtifact(`grok-request.${iteration}.md`, prompt, 'text');
    await transition('GROK_FIX');

    const attempts = [];
    let grokFix = null;
    let postFixDiff = null;
    let diffChanged = false;
    const maxRetries = options.grokMaxRetries ?? 1;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      grokFix = await runGrokAttempt({
        agents,
        runProcess,
        writeArtifact,
        runDir,
        fixCwd,
        options,
        iteration,
        attempt,
      });

      postFixDiff = await captureDiff({ cwd: fixCwd, timeoutMs: options.timeoutMs });
      await writeArtifact(`diff.${iteration}.${attempt}.patch`, postFixDiff.text, 'text');
      if (attempt === 1) await writeArtifact(`diff.${iteration}.patch`, postFixDiff.text, 'text');
      diffChanged = hasDiffChanged(previousDiff, postFixDiff.text);
      const failure = classifyAgentFailure(grokFix);
      attempts.push({
        attempt,
        grokFix: summarizeRun(grokFix),
        failure,
        diff: summarizeDiff(postFixDiff.text),
        diffChanged,
      });

      if (diffChanged || !failure.retryable || attempt > maxRetries) break;
      await sleep(options.retryBackoffMs ?? 1000);
    }

    if (grokFix.timedOut || grokFix.spawnError) {
      iterations.push({ iteration, attempts, grokFix: summarizeRun(grokFix), gate: null, diff: summarizeDiff(postFixDiff.text) });
      await transition('HALT_HUMAN', { iterations, grokFix: summarizeRun(grokFix) });
      return snapshotState(state);
    }

    if (!diffChanged) {
      const failure = classifyAgentFailure(grokFix);
      iterations.push({
        iteration,
        attempts,
        grokFix: summarizeRun(grokFix),
        failure,
        gate: null,
        diff: summarizeDiff(postFixDiff.text),
      });
      await transition(failure.agentUnstable ? 'HALT_HUMAN' : 'HALT_NO_CHANGES',
        { iterations, grokFix: summarizeRun(grokFix) });
      return snapshotState(state);
    }

    const postFixGate = await evaluateGate({
      cwd: fixCwd,
      commands: options.gates,
      timeoutMs: options.timeoutMs,
    });
    await writeArtifact(`post-fix-gate.${iteration}.json`, postFixGate, 'json');
    await writeGateArtifacts({ prefix: `post-fix.${iteration}`, gate: postFixGate, writeArtifact });

    const iterationRecord = {
      iteration,
      attempts,
      grokFix: summarizeRun(grokFix),
      gate: summarizeGate(postFixGate),
      gateSnapshot: postFixGate,
      gateProgress: summarizeGateProgress(postFixGate),
      diff: summarizeDiff(postFixDiff.text),
      diffText: postFixDiff.text,
      diffGuard: analyzeDiffGuard(postFixDiff.text),
    };
    iterations.push(iterationRecord);
    await transition('POST_FIX_GATE_RESULT', {
      iterations,
      grokFix: summarizeRun(grokFix),
    });

    if (postFixGate.ok) {
      if (options.guardTests && iterationRecord.diffGuard.hasFindings) {
        await transition('HALT_HUMAN', {
          iterations,
          grokFix: summarizeRun(grokFix),
          guardReason: 'POSSIBLE_TEST_TAMPER',
        });
        return snapshotState(state);
      }
      if (options.skipReview) {
        await transition('DONE_FIXED', { iterations });
        return snapshotState(state);
      }
      return await runFinalCodexReview({
        state,
        agents,
        fixCwd,
        options,
        runProcess,
        writeArtifact,
        transition,
        iterations,
      });
    }

    const postGateFailure = classifyAgentFailure(grokFix);
    if (postGateFailure.agentUnstable) {
      // Unstable agent layer (rate limit / auth / network) + still-red gate → stop for human,
      // don't keep rolling. max_turns / nonzero_exit fall through to the progress judge below.
      await transition('HALT_HUMAN', { iterations, grokFix: summarizeRun(grokFix) });
      return snapshotState(state);
    }

    if (options.guardTests && iterationRecord.diffGuard.hasFindings) {
      await transition('HALT_HUMAN', {
        iterations,
        grokFix: summarizeRun(grokFix),
        guardReason: 'POSSIBLE_TEST_TAMPER',
      });
      return snapshotState(state);
    }

    if (!madeGateProgress(currentGate, postFixGate)) {
      await transition('HALT_NO_PROGRESS', { iterations });
      return snapshotState(state);
    }

    if (options.pauseAfterIteration) {
      await transition('PAUSED_AFTER_ITERATION', {
        currentIteration: iteration,
        iterations,
      });
      return snapshotState(state);
    }

    previousDiff = postFixDiff.text;
    currentGate = postFixGate;
  }

  await transition('HALT_BUDGET', { iterations });
  return snapshotState(state);
}

async function runGrokAttempt({
  agents,
  runProcess,
  writeArtifact,
  runDir,
  fixCwd,
  options,
  iteration,
  attempt,
}) {
  const grokFix = await runAgentProcess(runProcess, agents.grok, buildGrokJsonArgs({
    promptFile: artifactPath(runDir, `grok-request.${iteration}.md`),
    cwd: fixCwd,
    maxTurns: options.grokMaxTurns ?? 4,
  }), {
    cwd: fixCwd,
    timeoutMs: options.timeoutMs,
  });
  await writeArtifact(`grok-output.${iteration}.${attempt}.stdout.log`, grokFix.stdout || '', 'text');
  await writeArtifact(`grok-output.${iteration}.${attempt}.stderr.log`, grokFix.stderr || '', 'text');
  await writeArtifact(`grok-output.${iteration}.${attempt}.exit.json`, summarizeRun(grokFix), 'json');
  if (attempt === 1) {
    await writeArtifact(`grok-output.${iteration}.stdout.log`, grokFix.stdout || '', 'text');
    await writeArtifact(`grok-output.${iteration}.stderr.log`, grokFix.stderr || '', 'text');
    await writeArtifact(`grok-output.${iteration}.exit.json`, summarizeRun(grokFix), 'json');
  }
  return grokFix;
}

async function writeGateArtifacts({ prefix, gate, writeArtifact }) {
  for (const [index, run] of gate.runs.entries()) {
    const stem = `${prefix}-gate-${index + 1}`;
    await writeArtifact(`${stem}.stdout.log`, run.stdout || '', 'text');
    await writeArtifact(`${stem}.stderr.log`, run.stderr || '', 'text');
    await writeArtifact(`${stem}.exit.json`, summarizeRun(run), 'json');
  }
}

async function runFinalCodexReview({
  state,
  agents,
  fixCwd,
  options,
  runProcess,
  writeArtifact,
  transition,
  iterations = state.iterations,
}) {
  await transition('CODEX_REVIEW', { iterations });
  const codexReview = await runAgentProcess(runProcess, agents.codex, buildCodexReviewArgs(), {
    cwd: fixCwd,
    timeoutMs: options.timeoutMs,
  });
  await writeArtifact('codex-review.stdout.log', codexReview.stdout || '', 'text');
  await writeArtifact('codex-review.stderr.log', codexReview.stderr || '', 'text');
  await writeArtifact('codex-review.exit.json', summarizeRun(codexReview), 'json');

  if (codexReview.exitCode === 0 && !codexReview.timedOut && !codexReview.spawnError) {
    await transition('DONE_REVIEWED', {
      iterations,
      codexReview: summarizeRun(codexReview),
    });
  } else {
    await transition('HALT_HUMAN', {
      iterations,
      codexReview: summarizeRun(codexReview),
    });
  }
  return snapshotState(state);
}

function artifactPath(runDir, fileName) {
  return runDir ? path.join(runDir, fileName) : fileName;
}

function runAgentProcess(runProcess, agent, args, options) {
  const invocation = resolveAgentInvocation(agent, args);
  return runProcess(invocation.command, invocation.args, options);
}

function summarizeGate(gate) {
  return {
    ok: gate.ok,
    failureCount: gate.failureCount,
    progress: summarizeGateProgress(gate),
  };
}

function summarizeDiff(text) {
  return {
    bytes: Buffer.byteLength(text || '', 'utf8'),
  };
}

export function summarizeRun(result) {
  return {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    spawnError: result.spawnError ?? null,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  };
}

function snapshotState(state) {
  return JSON.parse(JSON.stringify(state));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
