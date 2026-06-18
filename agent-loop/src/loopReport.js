export function buildLoopReport({
  runId,
  cwd,
  fixCwd,
  task,
  gates,
  baselineGate,
  finalState,
  fixAgent = 'grok',
  reviewAgent = 'grok',
  agentFix = null,
  agentReview = null,
  grokFix = null,
  codexReview = null,
  grokReview = null,
  iterations = [],
  reviewRounds = [],
  maxIterations = 3,
  lang = 'en',
  runMode = 'unknown',
  grokRan = Boolean(grokFix),
  codexRan = Boolean(codexReview),
  runTimeLocal = '',
  runTimeUtc = '',
}) {
  const labels = getLabels(lang, { fixAgent, reviewAgent });
  const effectiveReview = agentReview ?? codexReview ?? grokReview;
  const lines = [];
  lines.push(labels.title);
  lines.push('');
  lines.push(`${labels.runId}: \`${runId}\``);
  if (runTimeLocal) lines.push(`${labels.localTime}: \`${runTimeLocal}\``);
  if (runTimeUtc) lines.push(`${labels.utcTime}: \`${runTimeUtc}\``);
  lines.push(`${labels.runMode}: \`${runMode}\``);
  lines.push(`${labels.grokRan}: \`${grokRan}\``);
  lines.push(`${labels.codexRan}: \`${codexRan}\``);
  lines.push(`${labels.targetCwd}: \`${cwd}\``);
  lines.push(`${labels.fixCwd}: \`${fixCwd || cwd}\``);
  lines.push(`${labels.taskFile}: \`${task}\``);
  lines.push(`${labels.finalState}: \`${finalState}\``);
  lines.push(`${labels.maxIterations}: \`${maxIterations}\``);
  lines.push('');

  lines.push(`## ${labels.baselineGate}`);
  lines.push('');
  if (baselineGate) {
    lines.push(`- ${labels.result}: \`${baselineGate.ok ? 'green' : 'red'}\``);
    lines.push(`- ${labels.failureCount}: \`${baselineGate.failureCount}\``);
    if (baselineGate.progress) {
      lines.push(`- ${labels.effectiveFailureCount}: \`${baselineGate.progress.effectiveFailureCount}\``);
    }
  } else {
    lines.push(`- ${labels.notRun}`);
  }
  lines.push('');

  if (gates?.length) {
    lines.push(`### ${labels.gateCommands}`);
    lines.push('');
    for (const [index, gate] of gates.entries()) {
      lines.push(`- ${index + 1}. \`${gate}\``);
    }
    lines.push('');
  }

  lines.push(`## ${labels.fixIterations}`);
  lines.push('');
  if (iterations.length === 0) {
    lines.push(`- ${labels.noFixIteration}`);
  } else {
    for (const iteration of iterations) {
      lines.push(`### ${labels.iteration} ${iteration.iteration}`);
      lines.push('');
      const iterationFix = summarizeIterationFix(iteration);
      if (iterationFix) {
        lines.push(`- ${labels.fixExitCode}: \`${iterationFix.exitCode}\``);
        lines.push(`- ${labels.fixTimedOut}: \`${iterationFix.timedOut}\``);
      }
      if (iteration.attempts?.length) {
        lines.push(`- ${labels.fixAttempts}: \`${iteration.attempts.length}\``);
        for (const attempt of iteration.attempts) {
          const attemptFix = summarizeAttemptFix(attempt);
          lines.push(`  - ${labels.attempt} ${attempt.attempt}: ${labels.exitCode}=\`${attemptFix?.exitCode ?? labels.unknown}\`, ${labels.failure}=\`${attempt.failure.kind}\`, ${labels.retryable}=\`${attempt.failure.retryable}\`, ${labels.diffChanged}=\`${attempt.diffChanged}\``);
        }
      }
      if (iteration.gate) {
        lines.push(`- ${labels.gateResult}: \`${iteration.gate.ok ? labels.gateResultGreen : labels.gateResultRed}\``);
        lines.push(`- ${labels.gateFailureCount}: \`${iteration.gate.failureCount}\``);
        if (iteration.gateProgress) {
          lines.push(`- ${labels.innerFailureCount}: \`${iteration.gateProgress.innerFailureCount ?? labels.unknown}\``);
          lines.push(`- ${labels.effectiveFailureCount}: \`${iteration.gateProgress.effectiveFailureCount}\``);
        }
      } else {
        lines.push(`- ${labels.gateResult}: \`${labels.gateResultNotRun}\``);
      }
      if (iteration.diff) {
        lines.push(`- ${labels.diffBytes}: \`${iteration.diff.bytes}\``);
      }
      if (iteration.diffGuard) {
        lines.push(`- ${labels.diffGuardFindings}: \`${iteration.diffGuard.findings.length}\``);
        for (const finding of iteration.diffGuard.findings) {
          const reason = localizeDiffGuardReason(finding.reason, labels);
          lines.push(`  - ${reason}: \`${finding.path}\` (+${finding.addedLines}/-${finding.deletedLines})`);
        }
      }
      lines.push(`- ${labels.files}: \`${fixArtifactNames(fixAgent, iteration.iteration)}\``);
      lines.push('');
    }
  }
  lines.push('');

  lines.push(`## ${labels.reviewSection}`);
  lines.push('');
  if (effectiveReview) {
    lines.push(`- ${labels.exitCode}: \`${effectiveReview.exitCode}\``);
    lines.push(`- ${labels.timedOut}: \`${effectiveReview.timedOut}\``);
    lines.push(`- ${labels.rawOutput}: \`${reviewArtifactNames(reviewAgent)}\``);
  } else {
    lines.push(`- ${labels.notRun}`);
  }
  lines.push('');

  if (reviewRounds.length) {
    lines.push(`### ${labels.reviewRounds}`);
    lines.push('');
    for (const round of reviewRounds) {
      lines.push(`- ${labels.reviewRound} ${round.round}: ${labels.reviewVerdict}=\`${round.verdict ?? labels.unknown}\`, ${labels.reviewDecision}=\`${round.decision}\``);
      if (round.summary) lines.push(`  - ${labels.reviewSummary}: ${round.summary}`);
      for (const finding of round.findings || []) {
        lines.push(`  - \`${finding.severity || labels.unknown}\` \`${finding.path || '-'}\`: ${finding.message || ''}`);
      }
    }
    lines.push('');
  }

  lines.push(`## ${labels.statusNotes}`);
  lines.push('');
  for (const note of labels.statusNoteLines) {
    lines.push(`- ${note}`);
  }
  lines.push('');
  lines.push(`## ${labels.nextStep}`);
  lines.push('');
  if (finalState?.startsWith('DONE_')) {
    lines.push(`- ${labels.nextStepDone}`);
  } else {
    lines.push(`- ${labels.nextStepHalt}`);
  }

  return lines.join('\n');
}

function summarizeAttemptFix(attempt) {
  return attempt?.agentFix ?? attempt?.grokFix ?? null;
}

function summarizeIterationFix(iteration) {
  return iteration?.agentFix ?? iteration?.grokFix ?? null;
}

function fixArtifactNames(fixAgent, iteration) {
  if (fixAgent === 'codex') {
    return `fix-request.codex.${iteration}.md, fix-output.codex.${iteration}.*, diff.${iteration}.patch`;
  }
  return `grok-request.${iteration}.md, grok-output.${iteration}.*, diff.${iteration}.patch`;
}

function reviewArtifactNames(reviewAgent) {
  if (reviewAgent === 'grok') {
    return 'review-output.grok.stdout.log, review-output.grok.stderr.log, review-output.grok.exit.json, review-request.md';
  }
  return 'codex-review.stdout.log, codex-review.stderr.log, codex-review.exit.json';
}

function localizeDiffGuardReason(reason, labels) {
  return labels.diffGuardReasons?.[reason] || reason;
}

function getLabels(lang, { fixAgent = 'grok', reviewAgent = 'grok' } = {}) {
  const fixAgentLabel = String(fixAgent || 'grok');
  const reviewAgentLabel = reviewAgent ? String(reviewAgent) : 'review';
  if (lang === 'zh-CN') {
    return {
      title: '# AgentLoop 闭环报告',
      runId: '运行 ID',
      localTime: '本地时间',
      utcTime: 'UTC 时间',
      runMode: '运行模式',
      grokRan: 'Grok 已运行',
      codexRan: 'Codex 已运行',
      targetCwd: '目标目录',
      fixCwd: '修复目录',
      taskFile: '任务文件',
      finalState: '最终状态',
      maxIterations: '最大轮次',
      baselineGate: '基线 Gate',
      result: '结果',
      failureCount: '失败数',
      effectiveFailureCount: '有效失败数',
      notRun: '未运行。',
      gateCommands: 'Gate 命令',
      fixIterations: `${fixAgentLabel} 修复轮次`,
      noFixIteration: '没有运行修复轮次。',
      iteration: '第',
      fixExitCode: `${fixAgentLabel} 退出码`,
      fixTimedOut: `${fixAgentLabel} 是否超时`,
      fixAttempts: `${fixAgentLabel} 尝试次数`,
      attempt: '尝试',
      failure: '失败',
      retryable: '可重试',
      diffChanged: 'diff 已变化',
      gateResult: 'Gate 结果',
      gateResultGreen: '通过',
      gateResultRed: '失败',
      gateResultNotRun: '未运行',
      gateFailureCount: 'Gate 失败数',
      innerFailureCount: '内部失败数',
      unknown: '未知',
      diffBytes: 'Diff 字节数',
      diffGuardFindings: 'Diff 保护检查',
      diffGuardReasons: {
        protected_path_changed: '受保护路径被修改',
        protected_file_net_deletion: '受保护文件净删除',
      },
      files: '文件',
      reviewSection: `${reviewAgentLabel} 审查`,
      reviewRounds: '审查轮次',
      reviewRound: '第',
      reviewVerdict: 'verdict',
      reviewDecision: '判定',
      reviewSummary: '结论',
      exitCode: '退出码',
      timedOut: '是否超时',
      rawOutput: '原始输出',
      statusNotes: '状态说明',
      statusNoteLines: [
        '`DONE_REVIEWED`：gate 已通过，最终审查成功。',
        '`REVIEW_NEEDS_CHANGES`：审查要求修改，已回喂修复工人进入下一轮（过渡态）。',
        '`DONE_FIXED`：修复工人完成后 gate 已通过，并跳过了 review。',
        '`DONE_GATE_ONLY`：基线 gate 已通过，且跳过了 review。',
        '`PAUSED_BEFORE_FIX`：基线 gate 后、第一次修复前暂停。',
        '`PAUSED_AFTER_ITERATION`：一轮修复有进展但仍红，暂停等待继续。',
        '`HALT_NO_CHANGES`：修复工人运行了，但没有产生新 diff。',
        '`HALT_NO_PROGRESS`：修复后 gate 仍红，且有效失败数没有下降。',
        '`HALT_NO_SUCCESS_CRITERIA`：任务缺少非空 `## 成功标准`，不入环，退回补全完成判定标准。',
        '`HALT_BUDGET`：达到最大修复轮次。',
        '`HALT_HUMAN`：agent 调用失败、超时，或需要人工接管。',
        '`POSSIBLE_TEST_TAMPER`：`--guard-tests` 发现测试/配置等受保护路径被改动。',
        '`HALT_AGENT_NOT_FOUND`：缺少本次运行真正需要的 agent（由 `--auto-fix` / `--skip-review` 决定）。',
      ],
      nextStep: '下一步',
      nextStepDone: '查看 worktree diff，再决定是否合并或提交。',
      nextStepHalt: '打开 `.agent-loop/latest/state.json` 和 stdout/stderr 日志查看停止原因。',
    };
  }

  return {
    title: '# AgentLoop Loop Report',
    runId: 'Run ID',
    localTime: 'Local Time',
    utcTime: 'UTC Time',
    runMode: 'Run Mode',
    grokRan: 'Grok Ran',
    codexRan: 'Codex Ran',
    targetCwd: 'Target cwd',
    fixCwd: 'Fix cwd',
    taskFile: 'Task file',
    finalState: 'Final state',
    maxIterations: 'Max iterations',
    baselineGate: 'Baseline Gate',
    result: 'Result',
    failureCount: 'Failure count',
    effectiveFailureCount: 'Effective failure count',
    notRun: 'Not run.',
    gateCommands: 'Gate Commands',
    fixIterations: `${fixAgentLabel} Fix Iterations`,
    noFixIteration: 'No fix iteration ran.',
    iteration: 'Iteration',
    fixExitCode: `${fixAgentLabel} exitCode`,
    fixTimedOut: `${fixAgentLabel} timedOut`,
    fixAttempts: `${fixAgentLabel} attempts`,
    attempt: 'Attempt',
    failure: 'failure',
    retryable: 'retryable',
    diffChanged: 'diffChanged',
      gateResult: 'Gate result',
      gateResultGreen: 'green',
      gateResultRed: 'red',
      gateResultNotRun: 'not-run',
      gateFailureCount: 'Gate failure count',
      innerFailureCount: 'Inner failure count',
      unknown: 'unknown',
    diffBytes: 'Diff bytes',
      diffGuardFindings: 'Diff guard findings',
      diffGuardReasons: {
        protected_path_changed: 'protected_path_changed',
        protected_file_net_deletion: 'protected_file_net_deletion',
      },
      files: 'Files',
    reviewSection: `${reviewAgentLabel} Review`,
    reviewRounds: 'Review Rounds',
    reviewRound: 'Round',
    reviewVerdict: 'verdict',
    reviewDecision: 'decision',
    reviewSummary: 'summary',
    exitCode: 'Exit code',
    timedOut: 'Timed out',
    rawOutput: 'Raw output',
    statusNotes: 'Status Notes',
    statusNoteLines: [
      '`DONE_REVIEWED`: gate green, final review succeeded.',
      '`REVIEW_NEEDS_CHANGES`: review asked for changes; findings were fed back to the fix worker for another round (transitional).',
      '`DONE_FIXED`: gate green after fix worker completed, review skipped.',
      '`DONE_GATE_ONLY`: baseline gate was green, review skipped.',
      '`PAUSED_BEFORE_FIX`: paused after baseline gate and before the first fix attempt.',
      '`PAUSED_AFTER_ITERATION`: paused after a progressing red post-fix gate; resume continues at the next iteration.',
      '`HALT_NO_CHANGES`: fix worker ran but produced no new diff.',
      '`HALT_NO_PROGRESS`: post-fix gate stayed red and effective failure count did not drop.',
      '`HALT_NO_SUCCESS_CRITERIA`: the task lacks a non-empty `## 成功标准`, so it never enters the loop; send it back to define completion criteria.',
      '`HALT_BUDGET`: max fix iterations reached.',
      '`HALT_HUMAN`: agent call failed, timed out, or human takeover is required.',
      '`POSSIBLE_TEST_TAMPER`: `--guard-tests` detected protected test/config changes in the diff.',
      '`HALT_AGENT_NOT_FOUND`: a required agent for this run was not found (depends on `--auto-fix` / `--skip-review`).',
    ],
    nextStep: 'Next Step',
    nextStepDone: 'Review the worktree diff and decide whether to merge.',
    nextStepHalt: 'Open `.agent-loop/latest/state.json` plus the stdout/stderr logs to inspect the halt reason.',
  };
}
