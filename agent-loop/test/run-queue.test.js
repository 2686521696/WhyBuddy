import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../src/gates.js';
import {
  buildLoopArgsForQueueEntry,
  buildQueueSummaryFromState,
  resolveEntryGates,
  resolvePythonExe,
  resolveQueueGate,
} from '../src/runQueue.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = 'C:\\repo';
const workspaceRoot = path.resolve(agentLoopRoot, '..');

test('resolveEntryGates throws for unknown gatesKey', () => {
  assert.throws(
    () => resolveEntryGates({
      entry: { gatesKey: 'missing' },
      gateSets: { gates: ['npm test'] },
      defaultGates: ['npm test'],
      label: 'task-a',
    }),
    /unknown gatesKey: missing/,
  );
});

test('resolveQueueGate substitutes repo-root pythonExe for worktree gates', () => {
  const gate = 'cd tws-ai-slide-rule-python; & "{{pythonExe}}" -m pytest tests/test_client_parity.py -q';
  const resolved = resolveQueueGate(gate, {
    repoRoot,
    pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe',
  });

  assert.equal(
    resolved,
    `cd tws-ai-slide-rule-python; & "${path.join(repoRoot, 'tws-ai-slide-rule-python', '.venv', 'Scripts', 'python.exe')}" -m pytest tests/test_client_parity.py -q`,
  );
  assert.match(resolved, /& "/);
  assert.equal(resolvePythonExe(repoRoot, null).endsWith(`${path.sep}python.exe`), process.platform === 'win32');
});

test('evaluateGate runs powershell call operator with resolved pythonExe', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('powershell python gate is Windows-specific');
    return;
  }

  const pythonExe = resolvePythonExe(workspaceRoot, 'tws-ai-slide-rule-python/.venv/Scripts/python.exe');
  try {
    await fs.access(pythonExe);
  } catch {
    t.skip(`python venv not present at ${pythonExe}`);
    return;
  }

  const command = resolveQueueGate(
    'cd tws-ai-slide-rule-python; & "{{pythonExe}}" -c "print(\'ok\')"',
    { repoRoot: workspaceRoot, pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe' },
  );
  const gate = await evaluateGate({
    cwd: workspaceRoot,
    commands: [command],
    timeoutMs: 30000,
  });

  assert.equal(gate.ok, true, gate.runs[0]?.stderr || gate.runs[0]?.stdout);
  assert.match(gate.runs[0].stdout, /ok/);
});

test('buildLoopArgsForQueueEntry uses worktree and omits fix-cwd', () => {
  const args = buildLoopArgsForQueueEntry({
    agentLoopRoot,
    repoRoot,
    entry: {
      id: 'backend-python-llm-client-parity',
      task: 'agent-loop/tasks/backend-python-llm-client-parity.md',
      gatesKey: 'infraGates',
    },
    defaults: {
      useWorktree: true,
      autoFix: true,
      skipReview: false,
      fixAgent: 'grok',
      reviewAgent: 'codex',
      guardTests: true,
      maxIterations: 3,
      timeoutMs: 600000,
      lang: 'zh-CN',
      pythonExe: 'tws-ai-slide-rule-python/.venv/Scripts/python.exe',
    },
    index: 0,
    gateSets: {
      gates: ['default-gate'],
      infraGates: ['cd tws-ai-slide-rule-python; & "{{pythonExe}}" -m pytest tests/test_client_parity.py -q'],
    },
    defaultGates: ['default-gate'],
  });

  const gateIndex = args.indexOf('--gate');
  const gateArg = args[gateIndex + 1];

  assert.ok(args.includes('--create-worktree'));
  assert.ok(args.includes('backend-python-llm-client-parity'));
  assert.equal(args.includes('--fix-cwd'), false);
  assert.ok(args.includes('--auto-fix'));
  assert.equal(args.includes('--skip-review'), false);
  assert.ok(args.includes('--fix-agent'));
  assert.ok(args.includes('--review-agent'));
  assert.match(gateArg, /test_client_parity\.py/);
  assert.match(gateArg, /& "/);
  assert.match(gateArg, /tws-ai-slide-rule-python[\\/]\.venv[\\/]Scripts[\\/]python\.exe/);
});

test('buildQueueSummaryFromState exposes grokRan codexRan and runMode', () => {
  const summary = buildQueueSummaryFromState({
    entry: { id: 'task-a', task: 'agent-loop/tasks/task-a.md' },
    state: {
      runId: '2026-06-17T03-29-42-364Z',
      status: 'DONE_REVIEWED',
      iterations: [{ iteration: 1, grokFix: { exitCode: 0 } }],
      grokFix: { exitCode: 0 },
      codexReview: { exitCode: 0 },
    },
    exitCode: 0,
  });

  assert.equal(summary.grokRan, true);
  assert.equal(summary.codexRan, true);
  assert.equal(summary.runMode, 'grok-fix+codex-review');
  assert.equal(summary.status, 'DONE_REVIEWED');
});