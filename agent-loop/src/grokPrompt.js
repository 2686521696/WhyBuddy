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

export function buildGrokFixPrompt(args) {
  return buildAgentFixPrompt(args);
}

export function buildAgentReviewPrompt({ taskText, workerAgent = 'grok' }) {
  return [
    '# AgentLoop 审查请求',
    '',
    `你是代码审查员。${workerAgent} 已完成修改，或基线 gate 已通过等待你审查。`,
    '请审查当前 worktree 里的未提交改动。',
    '',
    '## 任务',
    '',
    taskText,
    '',
    '## 审查范围',
    '',
    '- 优先只审查任务「允许修改的文件」段落列出的路径。',
    '- 不要要求全仓库大扫除；忽略无关脏 diff 时请在 summary 里说明。',
    '- 不要自己跑 live LLM；以 gate 与 diff 为准。',
    '',
    '## 输出格式',
    '',
    '只输出 JSON，不要 markdown fence：',
    '',
    '{"verdict":"pass|needs_changes|blocked","summary":"简短结论","findings":[{"severity":"blocker|major|minor","path":"相对路径","message":"说明"}]}',
  ].join('\n');
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...<truncated>`;
}
