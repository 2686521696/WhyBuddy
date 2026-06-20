import { stripAnsi } from './ansi.js';

const MIGRATION_BOUNDARY_GUARDRAILS = [
  '## Migration Boundary Guardrails（迁移边界护栏）',
  '',
  '- 角色分工：修复 worker 负责落地当前任务内的代码/测试/文档；边界判断、进度口径、是否扩大迁移范围由 reviewer / 人工决定。',
  '- 不要把一个切片扩大成“大迁移”：只做 task 里点名的 capability、endpoint、contract 或 gate。',
  '- 如果任务涉及 Node -> Python 迁移，必须保持分层口径：Node thin proxy、Python baseline、LLM infra、RAG/vector/evidence、Blueprint/Autopilot 主流程要分开描述。',
  '- 不要把 proxy contract、smoke gate、generated/fallback evidence 宣传成完整迁移或生产级 retrieval。',
  '- 遇到 `mcp.call`、`skill.invoke`、`orchestrate.plan`、真实 vector retrieval 这类硬边界，先补 audit/contract/smoke，不要直接迁大编排。',
  '- 如果任务没有明确 allowed files、gate、成功标准，或需要扩大边界，请输出 blocked，不要自作主张。',
].join('\n');

const REVIEW_BOUNDARY_CHECKLIST = [
  '## Codex Boundary Review Checklist（Codex 边界审查清单）',
  '',
  '- 先审 task 的成功标准、允许文件、gate 是否足以证明完成；不要只看“有 diff / gate 绿”。',
  '- 检查 Grok 是否扩大迁移范围、改了无关系统、绕过测试或把 fallback/proxy 冒充完整实现。',
  '- 对迁移进度保持分层判断：整体 Node backend、SlideRule V5、Node thin proxy、Python baseline、LLM infra、RAG/vector/evidence、Blueprint/Autopilot 不要混成一个百分比。',
  '- 对 `mcp.call`、`skill.invoke`、`orchestrate.plan`、真实 vector retrieval 这类硬边界，若没有 audit/contract/smoke 证据，应要求补边界任务，而不是放大完成声明。',
  '- 小的文案或风格问题不要阻断；边界错、证据不足、任务越界、进度夸大才是 blocker/major。',
].join('\n');

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
  const missingGateFileBlock = buildMissingGateFileBlock({ taskText, gate });

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
    MIGRATION_BOUNDARY_GUARDRAILS,
    '',
    '## 失败信息',
    '',
    failureBlocks || '没有捕获到失败详情。',
    missingGateFileBlock ? ['', missingGateFileBlock].join('\n') : '',
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

function buildMissingGateFileBlock({ taskText, gate }) {
  const missingFiles = extractMissingGateFiles(gate)
    .filter((file) => taskAllowsPath(taskText, file));

  if (!missingFiles.length) return '';

  return [
    '## Missing gate file fast path',
    '',
    'The failing gate is pointing at file(s) that do not exist yet and are listed in the task allowed files.',
    'Create the missing gate file first, then add the smallest implementation needed for the gate; avoid broad repository exploration before creating these direct gate files.',
    '',
    ...missingFiles.map((file) => `- ${file}`),
  ].join('\n');
}

function extractMissingGateFiles(gate) {
  const files = [];
  const pattern = /file or directory not found:\s*([^\r\n]+)/gi;
  for (const run of gate?.runs || []) {
    const output = [run.stdout || '', run.stderr || ''].join('\n');
    for (const match of output.matchAll(pattern)) {
      const file = normalizePromptPath(match[1]);
      if (file) files.push(file);
    }
  }
  return Array.from(new Set(files));
}

function taskAllowsPath(taskText, file) {
  const task = normalizePromptPath(taskText);
  const target = normalizePromptPath(file);
  if (!task || !target) return false;
  return task.includes(target) || task.includes(`/${target}`);
}

function normalizePromptPath(value) {
  return String(value || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\/g, '/');
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
    MIGRATION_BOUNDARY_GUARDRAILS,
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

export function buildAgentReviewFixPrompt({ taskText, review = {}, gate = null, diffText = '', workerAgent = 'grok' }) {
  const findings = Array.isArray(review?.findings) ? review.findings : [];
  const findingsBlock = findings.length
    ? findings.map((finding, index) => [
      `### Finding ${index + 1}（${finding?.severity || 'unspecified'}）`,
      finding?.path ? `- 文件: ${finding.path}` : '',
      finding?.message ? `- 问题: ${finding.message}` : '',
    ].filter(Boolean).join('\n')).join('\n\n')
    : '- 审查未给出结构化 findings，请依据下方 summary 判断需要修改的内容。';

  const diffBlock = String(diffText || '').trim()
    ? ['```diff', truncate(diffText, 12000), '```'].join('\n')
    : '（当前没有未提交 diff。）';

  return [
    `# AgentLoop ${workerAgent} 审查回修请求`,
    '',
    '你是修复执行者。gate 已通过，但代码审查认为当前改动还不能合并，请根据审查意见继续修改。',
    '',
    '## 任务',
    '',
    taskText,
    '',
    '## 审查结论',
    '',
    `- verdict: ${review?.verdict || 'needs_changes'}`,
    review?.summary ? `- summary: ${review.summary}` : '',
    '',
    '## 审查 findings',
    '',
    findingsBlock,
    '',
    '## Safety Guardrails',
    '',
    '- Do not delete, weaken, skip, or rewrite tests to make the gate pass.',
    '- Do not change gate commands, test scripts, CI config, or test runner config unless the task explicitly asks for that.',
    '- Do not bypass assertions, mark tests skipped/only, lower coverage, or replace checks with placeholders.',
    '',
    MIGRATION_BOUNDARY_GUARDRAILS,
    '',
    '## 当前未提交 diff',
    '',
    diffBlock,
    '',
    '## 规则',
    '',
    '- 只处理审查 findings 指出的问题，以及与任务目标直接相关的修改。',
    '- 不要为了「绕过审查」而隐藏问题或伪造完成。',
    '- 不要提交、不要 git add、不要改写历史。',
    '- 不要做无关重构。',
    '- 如果审查意见无法实现或你不认同，请输出 blocked 并说明，不要假装修好。',
    '- 修改完成后，只输出 JSON，不要 markdown fence。',
    '',
    '## 输出格式',
    '',
    '{"verdict":"changed|blocked","summary":"简短说明","files":["相对路径"]}',
  ].filter(Boolean).join('\n');
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
    '## 强制要求',
    '',
    '- 禁止调用 Shell / Read / 任何工具；只根据下方证据判断。',
    '- 你的回复必须且只能是 JSON verdict（见文末格式），不要 markdown fence，不要解释性前言。',
    '- gate 结果已由 AgentLoop 验证；未提交 diff 为空时，默认审查 HEAD 中允许文件的已实现内容。',
    '',
    '## 判断权（你说了算）',
    '',
    '- 对照任务的「## 成功标准」判断是否达标，达标即可放行；你拥有 ship / no-ship 的最终决定权。',
    '- 只有**真正阻断达标**的问题才用 `needs_changes`；小瑕疵、风格、可选优化写进 `summary` 但仍判 `pass`，不要因为吹毛求疵让任务无谓回炉。',
    '- 若你判断任务在当前约束下根本做不出来、或多轮仍无法满足成功标准，用 `blocked` 并在 summary 说明原因——这会交还给人。',
    '- `findings[].severity` 由你定（blocker / major / minor）；只有 blocker / major 才应配 `needs_changes`。',
    '',
    REVIEW_BOUNDARY_CHECKLIST,
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
