import { stripAnsi } from './ansi.js';

export function buildAgentFixPrompt({ taskText, gate, workerAgent = 'grok' }) {
  const failureBlocks = gate.runs
    .filter((run) => run.exitCode !== 0 || run.timedOut || run.spawnError)
    .map((run, index) => {
      return [
        `## 失败 Gate ${index + 1}: ${run.label}`,
        '',
        `- exitCode: ${run.exitCode}`,
        `- timedOut: ${run.timedOut}`,
        run.spawnError ? `- spawnError: ${run.spawnError}` : '',
        '',
        '### stdout',
        '```text',
        truncate(stripAnsi(run.stdout || ''), 6000),
        '```',
        '',
        '### stderr',
        '```text',
        truncate(stripAnsi(run.stderr || ''), 6000),
        '```',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  return [
    `# AgentLoop ${workerAgent} 修复请求`,
    '',
    '你是修复执行者。请根据任务目标和失败 gate 修改当前仓库文件。',
    '',
    '## 任务',
    '',
    taskText,
    '',
    '## Safety Guardrails',
    '',
    '- Do not delete, weaken, skip, or rewrite tests to make the gate pass.',
    '- Do not change gate commands, test scripts, CI config, or test runner config unless the task explicitly asks for that.',
    '- Do not bypass assertions, mark tests skipped/only, lower coverage, or replace checks with placeholders.',
    '',
    '## 失败信息',
    '',
    failureBlocks || '没有捕获到失败详情。',
    '',
    '## 规则',
    '',
    '- 只修复和任务/gate 直接相关的问题。',
    '- 不要提交、不要 git add、不要改写历史。',
    '- 不要做无关重构。',
    '- 如果无法修复，请不要伪造成功。',
    '- 修改完成后，只输出 JSON，不要 markdown fence。',
    '',
    '## 输出格式',
    '',
    '{"verdict":"changed|blocked","summary":"简短说明","files":["相对路径"]}',
  ].join('\n');
}

export function buildAgentChecklistFixPrompt({ taskText, pendingItems = [], workerAgent = 'grok' }) {
  const pendingBlock = pendingItems.length
    ? pendingItems.map((item) => `- [ ] ${item}`).join('\n')
    : '- 没有解析到未完成项。';

  return [
    `# AgentLoop ${workerAgent} 开发请求`,
    '',
    '你是开发执行者。基线 gate 已通过，但任务「状态清单」仍有未完成项，请继续实现。',
    '',
    '## 任务',
    '',
    taskText,
    '',
    '## 待完成清单',
    '',
    pendingBlock,
    '',
    '## Safety Guardrails',
    '',
    '- Do not delete, weaken, skip, or rewrite tests to make the gate pass.',
    '- Do not change gate commands, test scripts, CI config, or test runner config unless the task explicitly asks for that.',
    '- Do not bypass assertions, mark tests skipped/only, lower coverage, or replace checks with placeholders.',
    '',
    '## 规则',
    '',
    '- 只实现清单中与任务目标直接相关的未完成项。',
    '- 优先补齐测试与实现，使清单项可以勾选为完成。',
    '- 若任务允许修改 task markdown，可将已完成项从 `[ ]` 改为 `[x]`。',
    '- 不要提交、不要 git add、不要改写历史。',
    '- 不要做无关重构。',
    '- 如果无法完成，请不要伪造成功。',
    '- 修改完成后，只输出 JSON，不要 markdown fence。',
    '',
    '## 输出格式',
    '',
    '{"verdict":"changed|blocked","summary":"简短说明","files":["相对路径"]}',
  ].join('\n');
}

export function buildGrokFixPrompt(args) {
  return buildAgentFixPrompt(args);
}

function formatGateEvidence(gateSnapshot) {
  if (!gateSnapshot?.runs?.length) {
    return '没有附带 gate 运行记录。';
  }

  return gateSnapshot.runs.map((run, index) => {
    return [
      `### Gate ${index + 1}`,
      '',
      `- command: ${run.label}`,
      `- exitCode: ${run.exitCode}`,
      `- timedOut: ${run.timedOut}`,
      run.spawnError ? `- spawnError: ${run.spawnError}` : '',
      '',
      '#### stdout',
      '```text',
      truncate(stripAnsi(run.stdout || ''), 6000),
      '```',
      '',
      '#### stderr',
      '```text',
      truncate(stripAnsi(run.stderr || ''), 6000),
      '```',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function buildReviewFocusBlock({ diffText, gateSnapshot, hadFixIterations }) {
  const hasDiff = Boolean(String(diffText || '').trim());
  const gateGreen = gateSnapshot?.ok === true;

  if (hasDiff) {
    return [
      '- 审查焦点：当前 worktree 的**未提交改动**。',
      '- 以下「未提交 diff」是主要证据；gate 输出用于验证这些改动是否满足任务。',
    ].join('\n');
  }

  if (gateGreen && !hadFixIterations) {
    return [
      '- 审查焦点：实现已在 **HEAD 提交** 中，当前未提交 diff 为空或只含无关元数据。',
      '- 不要因为没有未提交 Python/源码 diff 就判定「未开发」；请读取任务「允许修改的文件」在 HEAD 中的内容。',
      '- 不要自己执行 gate / pytest / shell 命令；以下 AgentLoop 已验证的 gate 输出就是测试证据。',
    ].join('\n');
  }

  return [
    '- 审查焦点：以 AgentLoop 附带的 gate 结果与允许文件路径为准。',
    '- 若未提交 diff 为空，请审查 HEAD 中允许文件的实现是否满足任务。',
    '- 不要自己重跑 gate 或 live LLM。',
  ].join('\n');
}

export function buildAgentReviewPrompt({
  taskText,
  workerAgent = 'grok',
  reviewContext = {},
}) {
  const {
    gateSnapshot = null,
    diffText = '',
    hadFixIterations = false,
  } = reviewContext;
  const diffBlock = String(diffText || '').trim()
    ? ['```diff', truncate(diffText, 12000), '```'].join('\n')
    : '（无未提交 diff，或 diff 为空。）';

  return [
    '# AgentLoop 审查请求',
    '',
    `你是代码审查员。${workerAgent} 已完成修改，或 AgentLoop gate 已通过等待你审查。`,
    '请根据下方证据审查任务是否完成；不要依赖你自己重跑 gate。',
    '',
    '## 任务',
    '',
    taskText,
    '',
    '## 审查范围',
    '',
    '- 优先只审查任务「允许修改的文件」段落列出的路径。',
    '- 不要要求全仓库大扫除；忽略无关脏 diff 时请在 summary 里说明。',
    '- 不要自己跑 live LLM。',
    buildReviewFocusBlock({ diffText, gateSnapshot, hadFixIterations }),
    '',
    '## AgentLoop gate 结果（已验证，勿重跑）',
    '',
    gateSnapshot?.ok === true ? '- 总结: green' : gateSnapshot?.ok === false ? '- 总结: red' : '- 总结: unknown',
    gateSnapshot?.failureCount != null ? `- failureCount: ${gateSnapshot.failureCount}` : '',
    '',
    formatGateEvidence(gateSnapshot),
    '',
    '## 未提交 diff',
    '',
    diffBlock,
    '',
    '## 输出格式',
    '',
    '第一轮回复只输出 JSON，不要 markdown fence，不要先跑 shell：',
    '',
    '{"verdict":"pass|needs_changes|blocked","summary":"简短结论","findings":[{"severity":"blocker|major|minor","path":"相对路径","message":"说明"}]}',
  ].filter(Boolean).join('\n');
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...<truncated>`;
}
