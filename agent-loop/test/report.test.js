import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentNotFoundReport, buildProbeReport } from '../src/report.js';

const sampleReportInput = {
  runId: '2026-06-16T08-24-33-531Z',
  agents: {
    codex: 'C:\\tools\\codex.exe',
    grok: 'C:\\tools\\grok.exe',
  },
  tmpRepo: 'C:\\repo\\tmp\\probe-repo',
  commandResults: [
    {
      label: 'codex review --help',
      result: {
        exitCode: 0,
        timedOut: false,
        stdout: 'help',
        stderr: '',
      },
      parsed: null,
    },
    {
      label: 'grok --prompt-file ... --output-format json',
      result: {
        exitCode: 0,
        timedOut: false,
        stdout: '{"ok":true}',
        stderr: 'warning',
      },
      parsed: { ok: true },
    },
  ],
  parserRecommendation: {
    codexParsed: null,
    grokParsed: { text: '{"ok":true}' },
    grokTextParsed: { ok: true },
  },
};

test('builds an English probe report by default', () => {
  const report = buildProbeReport(sampleReportInput);

  assert.match(report, /^# AgentLoop Phase 0 Probe Report$/m);
  assert.match(report, /^Run ID: `2026-06-16T08-24-33-531Z`$/m);
  assert.match(report, /^## Agents$/m);
  assert.match(report, /^## Probe Repo$/m);
  assert.match(report, /^## Command Results$/m);
  assert.match(report, /^- Exit code: `0`$/m);
  assert.match(report, /^- Timed out: `false`$/m);
  assert.match(report, /^- Parsed JSON: `yes`$/m);
  assert.match(report, /^## Parser Recommendation$/m);
  assert.match(report, /Codex review parse strategy/);
  assert.match(report, /^## Next Step$/m);
  assert.doesNotMatch(report, /探测报告|运行 ID|解析器建议/);
});

test('builds a Chinese probe report when lang is zh-CN', () => {
  const report = buildProbeReport({
    ...sampleReportInput,
    lang: 'zh-CN',
  });

  assert.match(report, /^# AgentLoop Phase 0 探测报告$/m);
  assert.match(report, /^运行 ID: `2026-06-16T08-24-33-531Z`$/m);
  assert.match(report, /^## 代理$/m);
  assert.match(report, /^## 探测仓库$/m);
  assert.match(report, /^## 命令结果$/m);
  assert.match(report, /^- 退出码: `0`$/m);
  assert.match(report, /^- 是否超时: `false`$/m);
  assert.match(report, /^- 已解析 JSON: `yes`$/m);
  assert.match(report, /^## 解析器建议$/m);
  assert.match(report, /Codex review 解析策略/);
  assert.match(report, /^## 下一步$/m);
});

test('builds localized agent-not-found reports', () => {
  const english = buildAgentNotFoundReport({
    runId: 'run-1',
    agents: { codex: null, grok: 'grok.exe' },
  });
  const chinese = buildAgentNotFoundReport({
    runId: 'run-1',
    agents: { codex: null, grok: 'grok.exe' },
    lang: 'zh-CN',
  });

  assert.match(english, /^## Verdict$/m);
  assert.match(english, /One or more required agent executables were not found\./);
  assert.match(chinese, /^## 结论$/m);
  assert.match(chinese, /一个或多个必需的代理可执行文件未找到。/);
});
