import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateGate as defaultEvaluateGate } from './gates.js';
import { captureDiff as defaultCaptureDiff, hasDiffChanged } from './diff.js';
import {
  fixStatusForAgent,
  requiredAgentNames,
  resolveAgentRoles,
  reviewStatusForAgent,
  useScopedReview,
} from './agentRoles.js';
import { buildAgentFixPrompt, buildAgentReviewPrompt } from './grokPrompt.js';
import { ensureWorktree as defaultEnsureWorktree } from './worktree.js';
import { resolveAgents as defaultResolveAgents } from './resolveAgents.js';
import { runProcess as defaultRunProcess } from './runProcess.js';
import { buildCodexExecArgs, buildCodexReviewArgs, buildGrokJsonArgs } from './commands.js';
import { madeGateProgress, summarizeGateProgress } from './gateProgress.js';
import { classifyAgentFailure } from './agentFailure.js';
import { analyzeDiffGuard } from './diffGuard.js';
import { resolveAgentInvocation } from './agentProcess.js';
import { createAgentStderrReporter } from './loopProgress.js';

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
    appendArtifact = null,
    onProgress = async () => {},
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
    agentFix: null,
    agentReview: null,
    grokFix: null,
    codexReview: null,
    grokReview: null,
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
  const requiredAgents = requiredAgentNames(options);
  if (requiredAgents.some((name) => !agents[name])) {
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
    return await runFinalReview({
      state,
      agents,
      fixCwd,
      options,
      taskText,
      runProcess,
      writeArtifact,
      appendArtifact,
      onProgress,
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

  const { fixAgent } = resolveAgentRoles(options);

  for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
    await transition('BUDGET_LOOP_HEAD', { currentIteration: iteration });

    const prompt = buildAgentFixPrompt({
      taskText,
      gate: currentGate,
      workerAgent: fixAgent,
    });
    const requestFile = fixRequestArtifact(fixAgent, iteration);
    await writeArtifact(requestFile, prompt, 'text');
    if (fixAgent === 'grok') {
      await writeArtifact(`grok-request.${iteration}.md`, prompt, 'text');
    }
    await transition(fixStatusForAgent(fixAgent));

    const attempts = [];
    let agentFix = null;
    let postFixDiff = null;
    let diffChanged = false;
    const maxRetries = options.grokMaxRetries ?? 1;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      agentFix = await runFixAttempt({
        agents,
        agent: fixAgent,
        runProcess,
        writeArtifact,
        appendArtifact,
        onProgress,
        runDir,
        fixCwd,
        options,
        iteration,
        attempt,
        requestFile,
      });

      postFixDiff = await captureDiff({ cwd: fixCwd, timeoutMs: options.timeoutMs });
      await writeArtifact(`diff.${iteration}.${attempt}.patch`, postFixDiff.text, 'text');
      if (attempt === 1) await writeArtifact(`diff.${iteration}.patch`, postFixDiff.text, 'text');
      diffChanged = hasDiffChanged(previousDiff, postFixDiff.text);
      const failure = classifyAgentFailure(agentFix);
      const summarizedFix = summarizeRun(agentFix);
      attempts.push({
        attempt,
        agentFix: summarizedFix,
        grokFix: fixAgent === 'grok' ? summarizedFix : null,
        failure,
        diff: summarizeDiff(postFixDiff.text),
        diffChanged,
      });

      if (diffChanged || !failure.retryable || attempt > maxRetries) break;
      await sleep(options.retryBackoffMs ?? 1000);
    }

    const summarizedFix = summarizeRun(agentFix);
    const legacyFixPatch = {
      agentFix: summarizedFix,
      grokFix: fixAgent === 'grok' ? summarizedFix : null,
    };

    if (agentFix.timedOut || agentFix.spawnError) {
      iterations.push({ iteration, attempts, ...legacyFixPatch, gate: null, diff: summarizeDiff(postFixDiff.text) });
      await transition('HALT_HUMAN', { iterations, ...legacyFixPatch });
      return finalizeState(state, options);
    }

    if (!diffChanged) {
      const failure = classifyAgentFailure(agentFix);
      iterations.push({
        iteration,
        attempts,
        ...legacyFixPatch,
        failure,
        gate: null,
        diff: summarizeDiff(postFixDiff.text),
      });
      await transition(failure.agentUnstable ? 'HALT_HUMAN' : 'HALT_NO_CHANGES',
        { iterations, ...legacyFixPatch });
      return finalizeState(state, options);
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
      ...legacyFixPatch,
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
      ...legacyFixPatch,
    });

    if (postFixGate.ok) {
      if (options.guardTests && iterationRecord.diffGuard.hasFindings) {
        await transition('HALT_HUMAN', {
          iterations,
          ...legacyFixPatch,
          guardReason: 'POSSIBLE_TEST_TAMPER',
        });
        return finalizeState(state, options);
      }
      if (options.skipReview) {
        await transition('DONE_FIXED', { iterations });
        return finalizeState(state, options);
      }
      return await runFinalReview({
        state,
        agents,
        fixCwd,
        options,
        taskText,
        runProcess,
        writeArtifact,
        appendArtifact,
        onProgress,
        transition,
        iterations,
      });
    }

    const postGateFailure = classifyAgentFailure(agentFix);
    if (postGateFailure.agentUnstable) {
      // Unstable agent layer (rate limit / auth / network) + still-red gate → stop for human,
      // don't keep rolling. max_turns / nonzero_exit fall through to the progress judge below.
      await transition('HALT_HUMAN', { iterations, ...legacyFixPatch });
      return finalizeState(state, options);
    }

    if (options.guardTests && iterationRecord.diffGuard.hasFindings) {
      await transition('HALT_HUMAN', {
        iterations,
        ...legacyFixPatch,
        guardReason: 'POSSIBLE_TEST_TAMPER',
      });
      return finalizeState(state, options);
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
  return finalizeState(state, options);
}

async function runFixAttempt({
  agents,
  agent,
  runProcess,
  writeArtifact,
  appendArtifact,
  onProgress,
  runDir,
  fixCwd,
  options,
  iteration,
  attempt,
  requestFile,
}) {
  const outputStem = fixOutputStem(agent, iteration, attempt);
  const reporter = createAgentStderrReporter({
    agent,
    phase: `fix ${iteration}.${attempt}`,
    appendArtifact,
    clearArtifact: writeArtifact,
    onProgress,
    artifactName: `${outputStem}.stderr.log`,
  });
  await reporter.reset();

  const promptPath = artifactPath(runDir, requestFile);
  let agentFix;
  if (agent === 'grok') {
    agentFix = await runAgentProcess(runProcess, agents.grok, buildGrokJsonArgs({
      promptFile: promptPath,
      cwd: fixCwd,
      maxTurns: options.grokMaxTurns ?? 4,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      onStderr: reporter.onStderr,
    });
  } else {
    const prompt = await fs.readFile(promptPath, 'utf8');
    agentFix = await runAgentProcess(runProcess, agents.codex, buildCodexExecArgs({ cwd: fixCwd }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      input: prompt,
      onStderr: reporter.onStderr,
    });
  }

  await writeFixOutputArtifacts({
    writeArtifact,
    outputStem,
    agent,
    iteration,
    attempt,
    agentFix,
  });
  return agentFix;
}

async function writeGateArtifacts({ prefix, gate, writeArtifact }) {
  for (const [index, run] of gate.runs.entries()) {
    const stem = `${prefix}-gate-${index + 1}`;
    await writeArtifact(`${stem}.stdout.log`, run.stdout || '', 'text');
    await writeArtifact(`${stem}.stderr.log`, run.stderr || '', 'text');
    await writeArtifact(`${stem}.exit.json`, summarizeRun(run), 'json');
  }
}

async function runFinalReview({
  state,
  agents,
  fixCwd,
  options,
  taskText,
  runProcess,
  writeArtifact,
  appendArtifact,
  onProgress,
  transition,
  iterations = state.iterations,
}) {
  const { fixAgent, reviewAgent } = resolveAgentRoles(options);
  const scoped = useScopedReview(options);
  const reviewStem = reviewArtifactStem(reviewAgent);
  await transition(reviewStatusForAgent(reviewAgent), { iterations });

  const reporter = createAgentStderrReporter({
    agent: reviewAgent,
    phase: scoped ? 'scoped review' : 'review --uncommitted',
    appendArtifact,
    clearArtifact: writeArtifact,
    onProgress,
    artifactName: `${reviewStem}.stderr.log`,
  });
  await reporter.reset();

  let promptInput = null;
  if (scoped || reviewAgent === 'grok') {
    const prompt = buildAgentReviewPrompt({ taskText, workerAgent: fixAgent });
    await writeArtifact('review-request.md', prompt, 'text');
    promptInput = prompt;
  }

  let agentReview;
  if (reviewAgent === 'grok') {
    agentReview = await runAgentProcess(runProcess, agents.grok, buildGrokJsonArgs({
      promptFile: artifactPath(state.artifacts.runDir, 'review-request.md'),
      cwd: fixCwd,
      maxTurns: options.reviewMaxTurns ?? 2,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      onStderr: reporter.onStderr,
    });
  } else if (scoped) {
    agentReview = await runAgentProcess(runProcess, agents.codex, buildCodexReviewArgs({
      uncommitted: true,
      readPromptFromStdin: true,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      input: promptInput,
      onStderr: reporter.onStderr,
    });
  } else {
    agentReview = await runAgentProcess(runProcess, agents.codex, buildCodexReviewArgs(), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      onStderr: reporter.onStderr,
    });
  }

  await writeArtifact(`${reviewStem}.stdout.log`, agentReview.stdout || '', 'text');
  if (!reporter.getBuffer()) {
    await writeArtifact(`${reviewStem}.stderr.log`, agentReview.stderr || '', 'text');
  }
  await writeArtifact(`${reviewStem}.exit.json`, summarizeRun(agentReview), 'json');
  if (reviewAgent === 'codex') {
    await writeArtifact('codex-review.stdout.log', agentReview.stdout || '', 'text');
    await writeArtifact('codex-review.stderr.log', agentReview.stderr || '', 'text');
    await writeArtifact('codex-review.exit.json', summarizeRun(agentReview), 'json');
  }

  const summarizedReview = summarizeRun(agentReview);
  const legacyReviewPatch = {
    agentReview: summarizedReview,
    codexReview: reviewAgent === 'codex' ? summarizedReview : null,
    grokReview: reviewAgent === 'grok' ? summarizedReview : null,
  };

  if (agentReview.exitCode === 0 && !agentReview.timedOut && !agentReview.spawnError) {
    await transition('DONE_REVIEWED', {
      iterations,
      ...legacyReviewPatch,
    });
  } else {
    await transition('HALT_HUMAN', {
      iterations,
      ...legacyReviewPatch,
    });
  }
  return finalizeState(state, options);
}

function artifactPath(runDir, fileName) {
  return runDir ? path.join(runDir, fileName) : fileName;
}

function fixRequestArtifact(agent, iteration) {
  return `fix-request.${agent}.${iteration}.md`;
}

function fixOutputStem(agent, iteration, attempt) {
  if (agent === 'grok') return `grok-output.${iteration}.${attempt}`;
  return `fix-output.${agent}.${iteration}.${attempt}`;
}

function reviewArtifactStem(agent) {
  if (agent === 'codex') return 'codex-review';
  return `review-output.${agent}`;
}

async function writeFixOutputArtifacts({
  writeArtifact,
  outputStem,
  agent,
  iteration,
  attempt,
  agentFix,
}) {
  await writeArtifact(`${outputStem}.stdout.log`, agentFix.stdout || '', 'text');
  await writeArtifact(`${outputStem}.stderr.log`, agentFix.stderr || '', 'text');
  await writeArtifact(`${outputStem}.exit.json`, summarizeRun(agentFix), 'json');
  if (attempt === 1) {
    const baseStem = agent === 'grok'
      ? `grok-output.${iteration}`
      : `fix-output.${agent}.${iteration}`;
    await writeArtifact(`${baseStem}.stdout.log`, agentFix.stdout || '', 'text');
    await writeArtifact(`${baseStem}.stderr.log`, agentFix.stderr || '', 'text');
    await writeArtifact(`${baseStem}.exit.json`, summarizeRun(agentFix), 'json');
  }
}

function finalizeState(state, options) {
  const { fixAgent, reviewAgent } = resolveAgentRoles(options);
  state.agentFix = state.agentFix ?? state.grokFix ?? null;
  state.agentReview = state.agentReview ?? state.codexReview ?? state.grokReview ?? null;
  state.grokFix = fixAgent === 'grok' ? state.agentFix : null;
  state.codexReview = reviewAgent === 'codex' ? state.agentReview : null;
  state.grokReview = reviewAgent === 'grok' ? state.agentReview : null;
  return snapshotState(state);
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
