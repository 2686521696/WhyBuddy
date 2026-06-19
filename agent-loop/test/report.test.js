import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentNotFoundReport, buildProbeReport } from '../src/report.js';
import { buildLoopReport, buildLoopReportJson } from '../src/loopReport.js';

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

test('buildLoopReport marks run mode and localizes status notes', () => {
  const report = buildLoopReport({
    runId: '2026-06-16T11-08-17-334Z',
    cwd: 'C:\\repo',
    fixCwd: 'C:\\repo',
    task: 'tasks/a.md',
    gates: ['npm test'],
    baselineGate: { ok: true, failureCount: 0, progress: { effectiveFailureCount: 0 } },
    finalState: 'DONE_GATE_ONLY',
    iterations: [],
    maxIterations: 3,
    lang: 'zh-CN',
    runMode: 'gate-only',
    grokRan: false,
    codexRan: false,
    runTimeLocal: '2026-06-16 19:08:17 (Asia/Shanghai)',
    runTimeUtc: '2026-06-16 11:08:17 (UTC)',
  });

  assert.match(report, /^# AgentLoop 闭环报告$/m);
  assert.match(report, /^本地时间: `2026-06-16 19:08:17 \(Asia\/Shanghai\)`$/m);
  assert.match(report, /^UTC 时间: `2026-06-16 11:08:17 \(UTC\)`$/m);
  assert.match(report, /^运行模式: `gate-only`$/m);
  assert.match(report, /^Grok 已运行: `false`$/m);
  assert.match(report, /^Codex 已运行: `false`$/m);
  assert.match(report, /^## 状态说明$/m);
  assert.match(report, /`DONE_GATE_ONLY`：基线 gate 已通过，且跳过 review。/);
  assert.match(report, /最终审查成功/);
});

test('buildLoopReportJson exposes stable structured fields for dashboards', () => {
  const report = buildLoopReportJson({
    runId: 'run-json',
    cwd: 'C:\\repo',
    fixCwd: 'C:\\repo\\.worktrees\\task-a',
    task: 'agent-loop/tasks/task-a.md',
    gates: ['npm test'],
    baselineGate: { ok: false, failureCount: 1, progress: { effectiveFailureCount: 1 } },
    finalState: 'DONE_REVIEWED',
    fixAgent: 'codex',
    reviewAgent: 'codex',
    iterations: [
      {
        iteration: 1,
        diff: { bytes: 123 },
        gate: { ok: true, failureCount: 0 },
        diffGuard: { findings: [{ path: 'test/a.test.js', reason: 'protected_path_changed' }] },
      },
    ],
    reviewRounds: [
      {
        round: 1,
        verdict: 'pass',
        decision: 'pass',
        summary: '中文 summary stays utf8',
        riskLevel: 'low',
        applyRecommendation: 'apply',
        verifiedBoundaries: ['gate green', 'allowed files'],
        findings: [],
      },
    ],
    maxIterations: 2,
    lang: 'zh-CN',
    runMode: 'codex-fix+codex-review',
    grokRan: false,
    codexRan: true,
    runTimeLocal: '2026-06-20 05:00:00 (Asia/Shanghai)',
    runTimeUtc: '2026-06-19 21:00:00 (UTC)',
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.runId, 'run-json');
  assert.equal(report.status, 'DONE_REVIEWED');
  assert.equal(report.task, 'agent-loop/tasks/task-a.md');
  assert.equal(report.runMode, 'codex-fix+codex-review');
  assert.equal(report.agents.fixAgent, 'codex');
  assert.equal(report.agents.reviewAgent, 'codex');
  assert.equal(report.baselineGate.ok, false);
  assert.equal(report.iterations[0].diffGuard.findings[0].path, 'test/a.test.js');
  assert.equal(report.reviewRounds[0].summary, '中文 summary stays utf8');
  assert.equal(report.reviewRounds[0].riskLevel, 'low');
  assert.equal(report.reviewRounds[0].applyRecommendation, 'apply');
  assert.deepEqual(report.reviewRounds[0].verifiedBoundaries, ['gate green', 'allowed files']);
});

test('buildLoopReport survives codex fix attempts without grokFix fields', () => {
  const report = buildLoopReport({
    runId: '2026-06-16T11-08-17-334Z',
    cwd: 'C:\\repo',
    fixCwd: 'C:\\repo',
    task: 'tasks/a.md',
    gates: ['npm test'],
    baselineGate: { ok: false, failureCount: 2 },
    finalState: 'DONE_FIXED',
    fixAgent: 'codex',
    reviewAgent: 'grok',
    agentFix: { exitCode: 0, timedOut: false },
    iterations: [
      {
        iteration: 1,
        agentFix: { exitCode: 0, timedOut: false },
        attempts: [
          {
            attempt: 1,
            agentFix: { exitCode: 0 },
            failure: { kind: 'none', retryable: false },
            diffChanged: true,
          },
        ],
        gate: { ok: true, failureCount: 0 },
      },
    ],
    maxIterations: 3,
    lang: 'en',
    runMode: 'codex-fix',
    grokRan: false,
    codexRan: true,
  });

  assert.match(report, /^## codex Fix Iterations$/m);
  assert.match(report, /codex exitCode: `0`/);
  assert.match(report, /Attempt 1: Exit code=`0`/);
  assert.match(report, /^## grok Review$/m);
  assert.doesNotMatch(report, /Cannot read properties of null/);
});

test('buildLoopReport localizes iteration detail labels when lang is zh-CN', () => {
  const report = buildLoopReport({
    runId: '2026-06-16T11-08-17-334Z',
    cwd: 'C:\\repo',
    fixCwd: 'C:\\repo',
    task: 'tasks/a.md',
    gates: ['npm test'],
    baselineGate: { ok: false, failureCount: 2 },
    finalState: 'DONE_FIXED',
    iterations: [
      {
        iteration: 1,
        grokFix: { exitCode: 0, timedOut: false },
        attempts: [
          {
            attempt: 1,
            grokFix: { exitCode: 1 },
            failure: { kind: 'timeout', retryable: true },
            diffChanged: false,
          },
        ],
        gate: { ok: true, failureCount: 0 },
        gateProgress: { innerFailureCount: 1, effectiveFailureCount: 0 },
        diff: { bytes: 120 },
        diffGuard: {
          findings: [
            {
              reason: 'protected_path_changed',
              path: 'test.js',
              addedLines: 1,
              deletedLines: 0,
            },
          ],
        },
      },
    ],
    maxIterations: 3,
    lang: 'zh-CN',
    runMode: 'grok-fix',
    grokRan: true,
    codexRan: false,
    runTimeLocal: '2026-06-16 19:08:17 (Asia/Shanghai)',
    runTimeUtc: '2026-06-16 11:08:17 (UTC)',
  });

  assert.match(report, /grok 退出码: `0`/);
  assert.match(report, /grok 是否超时: `false`/);
  assert.match(report, /grok 尝试次数: `1`/);
  assert.match(report, /尝试 1: 退出码=`1`, 失败=`timeout`, 可重试=`true`, diff 已变化=`false`/);
  assert.match(report, /内部失败数: `1`/);
  assert.match(report, /Diff 字节数: `120`/);
  assert.match(report, /Diff 保护检查: `1`/);
  assert.match(report, /受保护路径被修改: `test.js`/);
  assert.match(report, /文件: `grok-request.1.md, grok-output.1.\*, diff.1.patch`/);
});

test('buildLoopReport localizes gate-not-run and unknown counts when lang is zh-CN', () => {
  const report = buildLoopReport({
    runId: '2026-06-16T11-08-17-334Z',
    cwd: 'C:\\repo',
    fixCwd: 'C:\\repo',
    task: 'tasks/a.md',
    gates: ['npm test'],
    baselineGate: { ok: false, failureCount: 2 },
    finalState: 'HALT_HUMAN',
    iterations: [
      {
        iteration: 1,
        grokFix: { exitCode: 1, timedOut: false },
      },
      {
        iteration: 2,
        grokFix: { exitCode: 0, timedOut: false },
        gate: { ok: false, failureCount: 2 },
        gateProgress: { innerFailureCount: null, effectiveFailureCount: 2 },
      },
    ],
    maxIterations: 3,
    lang: 'zh-CN',
    runMode: 'halt-human-after-grok',
    grokRan: true,
    codexRan: false,
  });

  assert.match(report, /Gate 结果: `未运行`/);
  assert.match(report, /Gate 结果: `失败`/);
  assert.match(report, /内部失败数: `未知`/);
  assert.match(report, /缺少本次运行真正需要的 agent/);
});
