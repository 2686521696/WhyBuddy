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
import {
  buildAgentChecklistFixPrompt,
  buildAgentFixPrompt,
  buildAgentReviewFixPrompt,
  buildAgentReviewPrompt,
} from './grokPrompt.js';
import { classifyReviewOutcome, parseAgentReviewOutput } from './reviewParser.js';
import { markAllChecklistItemsDone, parseTaskChecklist, shouldRunDevFix } from './taskChecklist.js';
import { checkTaskAdmission } from './taskContract.js';
import { ensureWorktree as defaultEnsureWorktree } from './worktree.js';
import { resolveAgents as defaultResolveAgents } from './resolveAgents.js';
import { runProcess as defaultRunProcess } from './runProcess.js';
import { buildCodexExecArgs, buildCodexReviewArgs, buildGrokJsonArgs } from './commands.js';
import { madeGateProgress, summarizeGateProgress } from './gateProgress.js';
import { classifyAgentFailure } from './agentFailure.js';
import { analyzeDiffGuard } from './diffGuard.js';
import { resolveAgentInvocation } from './agentProcess.js';
import { createAgentStderrReporter } from './loopProgress.js';

const MAX_REVIEW_FILE_SNAPSHOT_BYTES = 24000;
const MAX_REVIEW_FILE_SNAPSHOTS = 24;
const WORKER_CONTEXT_DIR = '.agent-loop-context/current-run';

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

  const runtimeOptions = options;
  const publicOptions = sanitizeOptionsForState(runtimeOptions);
  const state = resumeState ? snapshotState(resumeState) : {
    runId,
    status: 'INIT',
    options: publicOptions,
    agents: null,
    worktree: null,
    baselineGate: null,
    baselineGateSnapshot: null,
    baselineDiff: null,
    baselineDiffText: '',
    iterations: [],
    reviewRounds: [],
    pendingReview: null,
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

  // Normalize fields that older resume states may lack so the review loop can
  // read them unconditionally.
  state.reviewRounds = state.reviewRounds || [];
  if (state.pendingReview === undefined) state.pendingReview = null;
  const guardPolicy = await loadGuardPolicy(runtimeOptions);
  state.guardPolicy = guardPolicy;

  async function transition(status, patch = {}) {
    state.options = sanitizeOptionsForState(runtimeOptions);
    Object.assign(state, patch, { status });
    await onState(snapshotState(state));
  }

  if (resumeState) {
    state.options = publicOptions;
    await transition('RESUMED');
  } else {
    await transition('INIT');
  }

  const agents = await resolveAgents();
  await transition('PROBED', { agents });
  const requiredAgents = requiredAgentNames(runtimeOptions);
  if (requiredAgents.some((name) => !agents[name])) {
    await transition('HALT_AGENT_NOT_FOUND');
    return snapshotState(state);
  }

  const taskPath = path.resolve(runtimeOptions.cwd, runtimeOptions.task);
  let taskText = await fs.readFile(taskPath, 'utf8');
  if (!resumeState) await writeArtifact('task.md', taskText, 'text');

  // Entry contract: a task with no spec-derived completion criteria does not
  // enter the loop. No runtime guessing — kick it back to be specified.
  if (!resumeState) {
    const admission = checkTaskAdmission(taskText);
    if (!admission.admissible) {
      await transition('HALT_NO_SUCCESS_CRITERIA', { admission });
      return snapshotState(state);
    }
  }

  let worktree = null;
  if (!resumeState && runtimeOptions.createWorktree) {
    try {
      worktree = await ensureWorktree({
        repoRoot: runtimeOptions.cwd,
        name: runtimeOptions.createWorktree,
        timeoutMs: runtimeOptions.timeoutMs,
      });
    } catch (error) {
      await transition('HALT_HUMAN', {
        worktreeError: error instanceof Error ? error.message : String(error),
      });
      return snapshotState(state);
    }
  }
  const repoCwd = path.resolve(runtimeOptions.cwd);
  const rawFixCwd = runtimeOptions.fixCwd || state.worktree?.fixCwd || worktree?.path || runtimeOptions.cwd;
  const fixCwd = path.isAbsolute(rawFixCwd) ? rawFixCwd : path.resolve(repoCwd, rawFixCwd);
  let baselineGate = state.baselineGateSnapshot;
  let baselineDiff = { text: state.baselineDiffText || '' };
  const resumeStatus = resumeState ? resumeState.status : null;
  let pendingReview = resolvePendingReview(state, resumeStatus);

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

  const taskChecklist = parseTaskChecklist(taskText);
  const baselineDevFix = shouldRunDevFix({
    baselineGateOk: baselineGate.ok,
    checklist: taskChecklist,
    autoFix: options.autoFix,
  });

  if (!resumeState && baselineGate.ok && !baselineDevFix && !options.forceFix) {
    if (options.skipReview) {
      taskText = await completeTaskChecklistOnSuccess({ options, fixCwd, taskText });
      await transition('DONE_GATE_ONLY');
      return snapshotState(state);
    }
    const review = await handleReview({
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
      iterations: state.iterations,
      currentGate: baselineGate,
    });
    if (review.kind === 'terminal') return review.state;
    // Review wants changes on an already-green baseline → fall through into the
    // fix loop carrying the review findings as the next fix prompt.
    pendingReview = review.pendingReview;
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
  const maxIterations = options.maxIterations ?? 16;
  const lastIteration = resumeState ? iterations.at(-1) : null;
  let previousDiff = lastIteration?.diffText ?? baselineDiff.text;
  let currentGate = lastIteration?.gateSnapshot ?? baselineGate;
  const startIteration = lastIteration ? lastIteration.iteration + 1 : 1;

  const { fixAgent } = resolveAgentRoles(options);

  for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
    await transition('BUDGET_LOOP_HEAD', { currentIteration: iteration });

    const checklist = parseTaskChecklist(taskText);
    const reviewDrivenFix = Boolean(pendingReview);
    const useChecklistPrompt = !reviewDrivenFix && checklist.hasPending && currentGate.ok;
    const contextBundle = fixAgent === 'grok'
      ? buildWorkerContextBundlePaths({
        includePendingReview: reviewDrivenFix,
        includePreviousDiff: reviewDrivenFix,
      })
      : null;
    let prompt;
    if (reviewDrivenFix) {
      prompt = buildAgentReviewFixPrompt({
        taskText,
        review: pendingReview.parsed,
        gate: currentGate,
        diffText: previousDiff,
        workerAgent: fixAgent,
        contextBundle,
      });
    } else if (useChecklistPrompt) {
      prompt = buildAgentChecklistFixPrompt({
        taskText,
        pendingItems: checklist.pending,
        workerAgent: fixAgent,
        contextBundle,
      });
    } else {
      prompt = buildAgentFixPrompt({
        taskText,
        gate: currentGate,
        workerAgent: fixAgent,
        contextBundle,
      });
    }
    const requestFile = fixRequestArtifact(fixAgent, iteration);
    await writeArtifact(requestFile, prompt, 'text');
    if (fixAgent === 'grok') {
      await writeArtifact(`grok-request.${iteration}.md`, prompt, 'text');
    }

    const attempts = [];
    let agentFix = null;
    let postFixDiff = null;
    let diffChanged = false;
    const maxRetries = options.workerMaxRetries ?? options.grokMaxRetries ?? 1;

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
        prompt,
        taskText,
        currentGate,
        previousDiff,
        transition,
        pendingReview,
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

    if (agentFix.timedOut || agentFix.idleTimedOut || agentFix.agentTimedOut || agentFix.spawnError) {
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
      diffGuard: analyzeDiffGuard(postFixDiff.text, { policy: guardPolicy }),
    };
    iterations.push(iterationRecord);
    pendingReview = null;
    await transition('POST_FIX_GATE_RESULT', {
      iterations,
      ...legacyFixPatch,
      pendingReview: null,
    });

    if (postFixGate.ok) {
      if (options.skipReview) {
        if (options.guardTests && shouldHaltForGuardTests(iterationRecord.diffGuard, { allowAdvisory: false })) {
          await transition('HALT_HUMAN', {
            iterations,
            ...legacyFixPatch,
            guardReason: 'POSSIBLE_TEST_TAMPER',
          });
          return finalizeState(state, options);
        }
        taskText = await completeTaskChecklistOnSuccess({ options, fixCwd, taskText });
        await transition('DONE_FIXED', { iterations });
        return finalizeState(state, options);
      }
      const review = await handleReview({
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
        currentGate: postFixGate,
        deferPassFinalize: true,
      });
      if (review.kind === 'pass') {
        if (
          options.guardTests
          && !review.guardFindingsReviewed
          && shouldHaltForGuardTests(iterationRecord.diffGuard, { allowAdvisory: true })
        ) {
          await transition('HALT_HUMAN', {
            ...review.reviewSnapshot,
            iterations,
            ...legacyFixPatch,
            guardReason: 'POSSIBLE_TEST_TAMPER',
          });
          return finalizeState(state, options);
        }
        taskText = await completeTaskChecklistOnSuccess({ options, fixCwd, taskText });
        await transition('DONE_REVIEWED', { ...review.reviewSnapshot, iterations, pendingReview: null });
        return finalizeState(state, options);
      }
      if (review.kind === 'terminal') return review.state;
      // Review asked for changes → spend the next budget slot on a review-driven
      // fix instead of finalizing.
      pendingReview = review.pendingReview;
      previousDiff = postFixDiff.text;
      currentGate = postFixGate;
      continue;
    }

    const postGateFailure = classifyAgentFailure(agentFix);
    if (postGateFailure.agentUnstable) {
      // Unstable agent layer (rate limit / auth / network) + still-red gate → stop for human,
      // don't keep rolling. max_turns / nonzero_exit fall through to the progress judge below.
      await transition('HALT_HUMAN', { iterations, ...legacyFixPatch });
      return finalizeState(state, options);
    }

    if (options.guardTests && shouldHaltForGuardTests(iterationRecord.diffGuard, { allowAdvisory: true })) {
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

function shouldHaltForGuardTests(diffGuard, { allowAdvisory = false } = {}) {
  if (!diffGuard) return false;
  if (!allowAdvisory) return Boolean(diffGuard.hasFindings);
  if (typeof diffGuard.hasBlockingFindings === 'boolean') return diffGuard.hasBlockingFindings;
  return Boolean(diffGuard.hasFindings);
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
  prompt,
  taskText,
  currentGate,
  previousDiff,
  transition,
  pendingReview,
}) {
  const outputStem = fixOutputStem(agent, iteration, attempt);
  if (transition) {
    // Keep pendingReview in state until this iteration is recorded so pause/resume
    // mid-fix still has the review findings that shaped the request above. Also
    // publish the exact live log files so the dashboard does not need to guess.
    await transition(fixStatusForAgent(agent), {
      pendingReview,
      activeAgentLog: buildActiveAgentLogPointer({
        phase: 'fix',
        agent,
        iteration,
        attempt,
        outputStem,
      }),
    });
  }
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
    const contextBundle = await writeWorkerContextBundle({
      fixCwd,
      requestFile,
      prompt,
      taskText,
      gate: currentGate,
      previousDiff,
      pendingReview,
    });
    agentFix = await runAgentProcess(runProcess, agents.grok, buildGrokJsonArgs({
      promptFile: contextBundle.promptPath,
      cwd: fixCwd,
      maxTurns: options.workerMaxTurns ?? options.grokMaxTurns ?? 512,
      model: options.fixModel,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      idleTimeoutMs: options.agentIdleTimeoutMs,
      agentTimeoutMs: options.agentTimeoutMs,
      onStderr: reporter.onStderr,
    }, options);
  } else {
    const prompt = await fs.readFile(promptPath, 'utf8');
    agentFix = await runAgentProcess(runProcess, agents.codex, buildCodexExecArgs({
      cwd: fixCwd,
      model: options.fixModel,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      idleTimeoutMs: options.agentIdleTimeoutMs,
      agentTimeoutMs: options.agentTimeoutMs,
      input: prompt,
      onStderr: reporter.onStderr,
    }, options);
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

// Run the review agent and act on its verdict. Returns either a terminal result
// (pass/halt — caller should return state) or a continue result carrying the
// findings for the next review-driven fix iteration.
async function handleReview(args) {
  const {
    state,
    options,
    transition,
    taskText,
    fixCwd,
    iterations = state.iterations,
    deferPassFinalize = false,
  } = args;
  const review = await runReview(args);

  state.reviewRounds.push({
    round: state.reviewRounds.length + 1,
    verdict: review.reviewVerdict,
    decision: review.decision,
    findings: Array.isArray(review.parsed?.findings) ? review.parsed.findings : [],
    summary: review.parsed?.summary ?? null,
    riskLevel: review.parsed?.riskLevel ?? null,
    applyRecommendation: review.parsed?.applyRecommendation ?? null,
    verifiedBoundaries: Array.isArray(review.parsed?.verifiedBoundaries)
      ? review.parsed.verifiedBoundaries
      : [],
  });

  const reviewSnapshot = {
    iterations,
    reviewRounds: state.reviewRounds,
    ...review.legacyReviewPatch,
    reviewVerdict: review.reviewVerdict,
  };

  if (review.decision === 'pass') {
    const guardFindingsReviewed = Boolean(review.parsed?.verdict);
    if (deferPassFinalize) {
      return { kind: 'pass', reviewSnapshot, guardFindingsReviewed };
    }
    const completedTaskText = await completeTaskChecklistOnSuccess({ options, fixCwd, taskText });
    args.taskText = completedTaskText;
    await transition('DONE_REVIEWED', { ...reviewSnapshot, pendingReview: null });
    return { kind: 'terminal', state: finalizeState(state, options) };
  }

  if (review.decision === 'halt') {
    // 'blocked' is the reviewer's own call that the task can't be satisfied, or
    // the agent failed/timed out — either way a human takes over.
    await transition('HALT_HUMAN', reviewSnapshot);
    return { kind: 'terminal', state: finalizeState(state, options) };
  }

  // decision === 'needs_changes' — feed the findings back to the fix worker for
  // another round. The shared maxIterations budget is the backstop against an
  // endless fix<->review tug-of-war (the reviewer can also short-circuit with
  // 'blocked'); the engine does not second-guess with its own heuristic.
  if (!options.autoFix) {
    await transition('HALT_HUMAN', reviewSnapshot);
    return { kind: 'terminal', state: finalizeState(state, options) };
  }

  const pendingReview = { parsed: review.parsed, verdict: review.reviewVerdict };
  await transition('REVIEW_NEEDS_CHANGES', { ...reviewSnapshot, pendingReview });
  return { kind: 'continue', pendingReview };
}

async function runReview({
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
  await transition(reviewStatusForAgent(reviewAgent), {
    iterations,
    activeAgentLog: buildActiveAgentLogPointer({
      phase: 'review',
      agent: reviewAgent,
      outputStem: reviewStem,
    }),
  });

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
    const lastIteration = iterations.at(-1);
    const fileSnapshots = await collectReviewFileSnapshots({ fixCwd, taskText });
    const prompt = buildAgentReviewPrompt({
      taskText,
      workerAgent: fixAgent,
      reviewContext: {
        gateSnapshot: lastIteration?.gateSnapshot ?? state.baselineGateSnapshot,
        diffText: lastIteration?.diffText ?? state.baselineDiffText ?? '',
        hadFixIterations: iterations.length > 0,
        fileSnapshots,
      },
    });
    await writeArtifact('review-file-snapshots.json', fileSnapshots, 'json');
    await writeArtifact('review-request.md', prompt, 'text');
    promptInput = prompt;
  }

  let agentReview;
  if (reviewAgent === 'grok') {
    agentReview = await runAgentProcess(runProcess, agents.grok, buildGrokJsonArgs({
      promptFile: artifactPath(state.artifacts.runDir, 'review-request.md'),
      cwd: fixCwd,
      maxTurns: options.reviewMaxTurns ?? 2,
      model: options.reviewModel,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      idleTimeoutMs: options.agentIdleTimeoutMs,
      agentTimeoutMs: options.agentTimeoutMs,
      onStderr: reporter.onStderr,
    }, options);
  } else if (scoped) {
    agentReview = await runAgentProcess(runProcess, agents.codex, buildCodexExecArgs({
      cwd: fixCwd,
      model: options.reviewModel,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      idleTimeoutMs: options.agentIdleTimeoutMs,
      agentTimeoutMs: options.agentTimeoutMs,
      input: promptInput,
      onStderr: reporter.onStderr,
    }, options);
  } else {
    agentReview = await runAgentProcess(runProcess, agents.codex, buildCodexReviewArgs({
      model: options.reviewModel,
    }), {
      cwd: fixCwd,
      timeoutMs: options.timeoutMs,
      idleTimeoutMs: options.agentIdleTimeoutMs,
      agentTimeoutMs: options.agentTimeoutMs,
      onStderr: reporter.onStderr,
    }, options);
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

  // Parse a structured verdict whenever the reviewer was given the JSON-verdict
  // prompt (Grok review, or scoped Codex). Plain `codex review --uncommitted`
  // emits a natural-language report, so it keeps exit-code semantics.
  const requiresStructuredVerdict = scoped || reviewAgent === 'grok';
  const parsedReview = requiresStructuredVerdict
    ? parseAgentReviewOutput(agentReview.stdout || '')
    : null;
  const decision = classifyReviewOutcome({
    parsed: parsedReview,
    timedOut: agentReview.timedOut,
    spawnError: agentReview.spawnError,
    exitCode: agentReview.exitCode,
    requiresStructuredVerdict,
  });
  const reviewVerdict = parsedReview?.verdict
    ?? (decision === 'pass' ? 'pass' : decision === 'needs_changes' ? 'needs_changes' : null);

  return {
    decision,
    parsed: parsedReview,
    reviewVerdict,
    legacyReviewPatch,
    agentReview,
  };
}

function artifactPath(runDir, fileName) {
  return runDir ? path.resolve(runDir, fileName) : path.resolve(fileName);
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

function buildWorkerContextBundlePaths({
  includePendingReview = false,
  includePreviousDiff = false,
} = {}) {
  const base = WORKER_CONTEXT_DIR;
  return {
    task: `${base}/task.md`,
    runSummary: `${base}/run-summary.json`,
    currentGate: `${base}/gate-current.json`,
    gateFailures: `${base}/gate-failures.md`,
    pendingReview: includePendingReview ? `${base}/pending-review.json` : null,
    previousDiff: includePreviousDiff ? `${base}/previous-diff.patch` : null,
  };
}

async function writeWorkerContextBundle({
  fixCwd,
  requestFile,
  prompt,
  taskText,
  gate,
  previousDiff,
  pendingReview,
}) {
  const contextDir = path.resolve(fixCwd, WORKER_CONTEXT_DIR);
  if (!isInsideDirectory(fixCwd, contextDir)) {
    throw new Error(`worker context directory escapes fix cwd: ${contextDir}`);
  }
  await fs.rm(contextDir, { recursive: true, force: true });
  await fs.mkdir(contextDir, { recursive: true });

  const promptPath = path.join(contextDir, requestFile);
  await fs.writeFile(promptPath, prompt || '', 'utf8');
  await fs.writeFile(path.join(contextDir, 'task.md'), taskText || '', 'utf8');
  await fs.writeFile(path.join(contextDir, 'run-summary.json'), `${JSON.stringify({
    requestFile,
    agent: 'grok',
    cwd: '.',
    contextDir: WORKER_CONTEXT_DIR,
    hasPendingReview: Boolean(pendingReview),
    hasPreviousDiff: Boolean(String(previousDiff || '').trim()),
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(contextDir, 'gate-current.json'), `${JSON.stringify(sanitizeGateForWorkerContext(gate), null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(contextDir, 'gate-failures.md'), formatGateFailuresForWorkerContext(gate), 'utf8');

  if (pendingReview) {
    await fs.writeFile(path.join(contextDir, 'pending-review.json'), `${JSON.stringify(pendingReview.parsed || pendingReview, null, 2)}\n`, 'utf8');
  }
  if (String(previousDiff || '').trim()) {
    await fs.writeFile(path.join(contextDir, 'previous-diff.patch'), String(previousDiff), 'utf8');
  }

  return { promptPath };
}

function sanitizeGateForWorkerContext(gate) {
  return {
    ok: gate?.ok ?? null,
    failureCount: gate?.failureCount ?? null,
    progress: gate ? summarizeGateProgress(gate) : null,
    runs: (gate?.runs || []).map((run) => ({
      label: run.label,
      command: run.command,
      args: run.args,
      cwd: run.cwd,
      exitCode: run.exitCode,
      timedOut: run.timedOut ?? false,
      idleTimedOut: run.idleTimedOut ?? false,
      agentTimedOut: run.agentTimedOut ?? false,
      spawnError: run.spawnError ?? null,
      stdoutBytes: Buffer.byteLength(run.stdout || '', 'utf8'),
      stderrBytes: Buffer.byteLength(run.stderr || '', 'utf8'),
    })),
  };
}

function formatGateFailuresForWorkerContext(gate) {
  const failedRuns = (gate?.runs || [])
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.exitCode !== 0 || run.timedOut || run.spawnError);

  if (!failedRuns.length) return 'No failing gate runs captured.\n';

  return `${failedRuns.map(({ run, index }) => [
    `## Gate ${index + 1}: ${run.label || '(unlabeled)'}`,
    '',
    `- exitCode: ${run.exitCode}`,
    `- timedOut: ${run.timedOut ?? false}`,
    run.spawnError ? `- spawnError: ${run.spawnError}` : '',
    '',
    '### stdout',
    '```text',
    truncateText(stripAnsiSafe(run.stdout || ''), 6000),
    '```',
    '',
    '### stderr',
    '```text',
    truncateText(stripAnsiSafe(run.stderr || ''), 6000),
    '```',
  ].filter(Boolean).join('\n')).join('\n\n')}\n`;
}

function stripAnsiSafe(value) {
  return String(value).replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function truncateText(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...<truncated>`;
}

function buildActiveAgentLogPointer({
  phase,
  agent,
  iteration = null,
  attempt = null,
  outputStem,
}) {
  return {
    phase,
    agent,
    iteration,
    attempt,
    stdout: `${outputStem}.stdout.log`,
    stderr: `${outputStem}.stderr.log`,
  };
}

async function collectReviewFileSnapshots({ fixCwd, taskText }) {
  const files = extractAllowedFilePaths(taskText);
  const snapshots = [];
  for (const relPath of files) {
    const absolutePath = path.resolve(fixCwd, relPath);
    if (!isInsideDirectory(fixCwd, absolutePath)) continue;
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        const nestedFiles = await listReviewSnapshotFiles({
          root: absolutePath,
          relRoot: relPath,
          remaining: MAX_REVIEW_FILE_SNAPSHOTS - snapshots.length,
        });
        for (const nestedFile of nestedFiles) {
          snapshots.push(await readReviewSnapshotFile({ fixCwd, relPath: nestedFile }));
        }
      } else if (stat.isFile()) {
        snapshots.push(await readReviewSnapshotFile({ fixCwd, relPath }));
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        snapshots.push({
          path: relPath,
          exists: false,
          content: '',
          truncated: false,
        });
      } else {
        snapshots.push({
          path: relPath,
          exists: null,
          content: `Unable to read file snapshot: ${error?.message || error}`,
          truncated: false,
        });
      }
    }
    if (snapshots.length >= MAX_REVIEW_FILE_SNAPSHOTS) break;
  }
  return snapshots;
}

async function readReviewSnapshotFile({ fixCwd, relPath }) {
  const absolutePath = path.resolve(fixCwd, relPath);
  const buffer = await fs.readFile(absolutePath);
  const truncated = buffer.length > MAX_REVIEW_FILE_SNAPSHOT_BYTES;
  return {
    path: relPath.replaceAll('\\', '/'),
    exists: true,
    content: buffer.subarray(0, MAX_REVIEW_FILE_SNAPSHOT_BYTES).toString('utf8'),
    truncated,
  };
}

async function listReviewSnapshotFiles({ root, relRoot, remaining }) {
  if (remaining <= 0) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= remaining) break;
    const entryPath = path.join(root, entry.name);
    const relPath = path.join(relRoot, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      const nested = await listReviewSnapshotFiles({
        root: entryPath,
        relRoot: relPath,
        remaining: remaining - files.length,
      });
      files.push(...nested);
    } else if (entry.isFile() && shouldSnapshotReviewFile(relPath)) {
      files.push(relPath);
    }
  }
  return files;
}

function shouldSnapshotReviewFile(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return [
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.md',
    '.json',
  ].includes(ext);
}

function extractAllowedFilePaths(taskText) {
  const lines = String(taskText || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+(允许修改的文件|allowed files)\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const paths = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+/.test(line.trim())) break;
    const codeSpans = [...line.matchAll(/`([^`]+)`/g)];
    if (codeSpans.length) {
      paths.push(...codeSpans.map((match) => match[1]));
      continue;
    }
    const bullet = line.trim().match(/^[-*]\s+(.+\S)\s*$/);
    if (bullet) paths.push(bullet[1]);
  }
  return [...new Set(paths.map(normalizeAllowedPath).filter(Boolean))]
    .slice(0, MAX_REVIEW_FILE_SNAPSHOTS);
}

function normalizeAllowedPath(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('*')) return null;
  const withoutTrailingSlash = cleaned.replace(/\/+$/g, '');
  if (!withoutTrailingSlash) return null;
  if (path.isAbsolute(withoutTrailingSlash) || withoutTrailingSlash.split('/').includes('..')) return null;
  return withoutTrailingSlash;
}

function isInsideDirectory(root, candidate) {
  const relative = path.relative(path.resolve(root), candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Restore review-driven fix context for resume. Prefer the persisted pendingReview
// snapshot; fall back to the latest needs_changes review round when an older run
// cleared pendingReview too early.
//
// IMPORTANT: the fallback is intentionally narrow. We only resurrect from reviewRounds
// when the review-driven fix for that round has not yet been performed/recorded.
// We skip for PAUSED_AFTER_ITERATION and POST_FIX_GATE_RESULT because a fix iteration
// has already consumed the review (next work should be normal gate-driven, not stale review).
function resolvePendingReview(state, resumeStatus = null) {
  if (state.pendingReview?.parsed) return state.pendingReview;

  const lastNeedsChanges = [...(state.reviewRounds || [])]
    .reverse()
    .find((round) => (
      round.decision === 'needs_changes'
      || round.verdict === 'needs_changes'
    ));

  if (!lastNeedsChanges) return null;

  if (resumeStatus === 'PAUSED_AFTER_ITERATION' ||
      resumeStatus === 'POST_FIX_GATE_RESULT') {
    return null;
  }

  return {
    parsed: {
      verdict: 'needs_changes',
      summary: lastNeedsChanges.summary ?? null,
      findings: Array.isArray(lastNeedsChanges.findings) ? lastNeedsChanges.findings : [],
      riskLevel: lastNeedsChanges.riskLevel ?? null,
      applyRecommendation: lastNeedsChanges.applyRecommendation ?? null,
      verifiedBoundaries: Array.isArray(lastNeedsChanges.verifiedBoundaries)
        ? lastNeedsChanges.verifiedBoundaries
        : [],
    },
    verdict: 'needs_changes',
  };
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

async function completeTaskChecklistOnSuccess({ options, fixCwd, taskText }) {
  const updated = markAllChecklistItemsDone(taskText);
  if (updated === taskText) return taskText;

  const targets = new Set([
    path.resolve(options.cwd, options.task),
    path.resolve(fixCwd, options.task),
  ]);

  for (const target of targets) {
    await fs.writeFile(target, updated, 'utf8');
  }
  return updated;
}

function finalizeState(state, options) {
  const { fixAgent, reviewAgent } = resolveAgentRoles(options);
  state.options = sanitizeOptionsForState(options);
  state.agentFix = state.agentFix ?? state.grokFix ?? null;
  state.agentReview = state.agentReview ?? state.codexReview ?? state.grokReview ?? null;
  state.grokFix = fixAgent === 'grok' ? state.agentFix : null;
  state.codexReview = reviewAgent === 'codex' ? state.agentReview : null;
  state.grokReview = reviewAgent === 'grok' ? state.agentReview : null;
  return snapshotState(state);
}

function runAgentProcess(runProcess, agent, args, processOptions, loopOptions = {}) {
  const invocation = resolveAgentInvocation(agent, args);
  return runProcess(invocation.command, invocation.args, {
    ...processOptions,
    env: buildWorkerProcessEnv(loopOptions.workerEnv, processOptions.env),
  });
}

function buildWorkerProcessEnv(workerEnv = {}, baseEnv = process.env) {
  const cleanWorkerEnv = {};
  if (workerEnv && typeof workerEnv === 'object' && !Array.isArray(workerEnv)) {
    for (const [name, value] of Object.entries(workerEnv)) {
      if (value == null) continue;
      cleanWorkerEnv[name] = String(value);
    }
  }
  return {
    ...baseEnv,
    ...cleanWorkerEnv,
  };
}

function sanitizeOptionsForState(options) {
  const sanitized = { ...options };
  const workerEnv = options?.workerEnv;
  delete sanitized.workerEnv;
  if (workerEnv && typeof workerEnv === 'object' && !Array.isArray(workerEnv)) {
    sanitized.workerEnvKeys = Object.keys(workerEnv).filter((name) => workerEnv[name] != null).sort();
  } else {
    sanitized.workerEnvKeys = [];
  }
  return sanitized;
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

async function loadGuardPolicy(options) {
  if (!options.guardPolicyPath) return {};
  const policyPath = path.isAbsolute(options.guardPolicyPath)
    ? options.guardPolicyPath
    : path.resolve(options.cwd, options.guardPolicyPath);
  return JSON.parse(await fs.readFile(policyPath, 'utf8'));
}

export function summarizeRun(result) {
  return {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    idleTimedOut: result.idleTimedOut ?? false,
    agentTimedOut: result.agentTimedOut ?? false,
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
