export function buildProbeReport({
  runId,
  agents,
  tmpRepo,
  commandResults,
  parserRecommendation,
  lang = 'en',
}) {
  const labels = getLabels(lang);
  const lines = [];
  lines.push(labels.title);
  lines.push('');
  lines.push(`${labels.runId}: \`${runId}\``);
  lines.push('');
  lines.push(`## ${labels.agents}`);
  lines.push('');
  lines.push(`- Codex: ${agents.codex ? `\`${agents.codex}\`` : '**NOT FOUND**'}`);
  lines.push(`- Grok: ${agents.grok ? `\`${agents.grok}\`` : '**NOT FOUND**'}`);
  lines.push('');
  lines.push(`## ${labels.probeRepo}`);
  lines.push('');
  lines.push(`- ${labels.path}: \`${tmpRepo}\``);
  lines.push(`- ${labels.change}: ${labels.changeValue}`);
  lines.push('');
  lines.push(`## ${labels.commandResults}`);
  lines.push('');

  for (const item of commandResults) {
    appendRun(lines, item.label, item.result, item.parsed, labels);
  }

  const { codexParsed, grokParsed, grokTextParsed } = parserRecommendation;
  lines.push(`## ${labels.parserRecommendation}`);
  lines.push('');
  lines.push(
    `- ${labels.codexParseStrategy}: ${
      codexParsed
        ? labels.codexJsonFound
        : labels.codexJsonMissing
    }`
  );
  lines.push(
    `- ${labels.grokJsonParseStrategy}: ${
      grokParsed
        ? labels.grokJsonFound
        : labels.grokJsonMissing
    }`
  );
  lines.push(
    `- ${labels.grokTextParseStrategy}: ${
      grokTextParsed
        ? labels.grokTextJsonFound
        : labels.grokTextJsonMissing
    }`
  );
  lines.push(`- ${labels.parseFailure}`);
  lines.push(`- ${labels.rawStreams}`);
  lines.push('');
  lines.push(`## ${labels.nextStep}`);
  lines.push('');
  lines.push(labels.nextStepText);
  return lines.join('\n');
}

export function buildAgentNotFoundReport({ runId, agents, lang = 'en' }) {
  const labels = getLabels(lang);
  const report = buildProbeReport({
    runId,
    agents,
    tmpRepo: labels.notCreated,
    commandResults: [],
    parserRecommendation: {
      codexParsed: null,
      grokParsed: null,
      grokTextParsed: null,
    },
    lang,
  });

  return [
    report,
    '',
    `## ${labels.verdict}`,
    '',
    labels.agentNotFound,
  ].join('\n');
}

function appendRun(lines, label, result, parsed, labels) {
  lines.push(`### ${label}`);
  lines.push('');
  lines.push(`- ${labels.exitCode}: \`${result.exitCode}\``);
  lines.push(`- ${labels.timedOut}: \`${result.timedOut}\``);
  lines.push(`- Stdout bytes: \`${Buffer.byteLength(result.stdout || '', 'utf8')}\``);
  lines.push(`- Stderr bytes: \`${Buffer.byteLength(result.stderr || '', 'utf8')}\``);
  lines.push(`- ${labels.parsedJson}: \`${parsed ? 'yes' : 'no'}\``);
  if (result.spawnError) lines.push(`- Spawn error: \`${result.spawnError}\``);
  lines.push('');
}

function getLabels(lang) {
  if (lang === 'zh-CN') {
    return {
      title: '# AgentLoop Phase 0 探测报告',
      runId: '运行 ID',
      agents: '代理',
      probeRepo: '探测仓库',
      path: '路径',
      change: '变更',
      changeValue: '初始提交后修改 README 中的一行',
      commandResults: '命令结果',
      exitCode: '退出码',
      timedOut: '是否超时',
      parsedJson: '已解析 JSON',
      parserRecommendation: '解析器建议',
      notCreated: '未创建',
      codexParseStrategy: 'Codex review 解析策略',
      codexJsonFound: 'stdout 包含可解析的 JSON。',
      codexJsonMissing: '除非后续提示词实验能产出 JSON，否则按 markdown 或混合自然语言处理。',
      grokJsonParseStrategy: 'Grok JSON 解析策略',
      grokJsonFound: '从 stdout 解析外层 CLI 信封。',
      grokJsonMissing: '检查原始 stdout；没有找到可直接解析的信封。',
      grokTextParseStrategy: 'Grok text 解析策略',
      grokTextJsonFound: '从信封 text 字段解析内层 JSON。',
      grokTextJsonMissing: '严格闭环中，将内层 text 解析失败视为 HALT_HUMAN。',
      parseFailure: '解析失败：HALT_HUMAN，不要推断通过或失败。',
      rawStreams: '原始流：解析前始终持久化 stdout、stderr 和退出码。',
      nextStep: '下一步',
      nextStepText: '用这份报告设计单轮 MVP 的解析器和提示词模板。',
      verdict: '结论',
      agentNotFound: 'HALT_AGENT_NOT_FOUND。一个或多个必需的代理可执行文件未找到。',
    };
  }

  return {
    title: '# AgentLoop Phase 0 Probe Report',
    runId: 'Run ID',
    agents: 'Agents',
    probeRepo: 'Probe Repo',
    path: 'Path',
    change: 'Change',
    changeValue: 'one-line README edit after initial commit',
    commandResults: 'Command Results',
    exitCode: 'Exit code',
    timedOut: 'Timed out',
    parsedJson: 'Parsed JSON',
    parserRecommendation: 'Parser Recommendation',
    notCreated: 'not created',
    codexParseStrategy: 'Codex review parse strategy',
    codexJsonFound: 'stdout contains parseable JSON.',
    codexJsonMissing: 'treat as markdown or mixed natural language unless prompt experiments produce JSON.',
    grokJsonParseStrategy: 'Grok JSON parse strategy',
    grokJsonFound: 'parse the outer CLI envelope from stdout.',
    grokJsonMissing: 'inspect raw stdout; no directly parseable envelope was found.',
    grokTextParseStrategy: 'Grok text parse strategy',
    grokTextJsonFound: 'parse nested JSON from the envelope text field.',
    grokTextJsonMissing: 'treat nested text parse failure as HALT_HUMAN for strict loops.',
    parseFailure: 'Parse failure: HALT_HUMAN, do not infer pass/fail.',
    rawStreams: 'Raw streams: always persist stdout, stderr, and exit code before parsing.',
    nextStep: 'Next Step',
    nextStepText: 'Use this report to design the parser and prompt templates for the single-loop MVP.',
    verdict: 'Verdict',
    agentNotFound: 'HALT_AGENT_NOT_FOUND. One or more required agent executables were not found.',
  };
}
