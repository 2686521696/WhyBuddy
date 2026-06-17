import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/runProcess.js';
import { createSmokeRepo, runSmokeLoop, writeStubAgents } from '../scripts/smoke-lib.mjs';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('smoke stub runs loop.js and records a real Grok fix artifact', async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-smoke-'));

  const result = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'scripts', 'smoke-stub.mjs'),
    '--output-root',
    outputRoot,
  ], {
    cwd: agentLoopRoot,
    timeoutMs: 60000,
  });

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'DONE_FIXED');
  assert.equal(summary.runMode, 'grok-fix');
  assert.equal(summary.grokRan, true);
  assert.equal(summary.codexRan, false);

  const statePath = path.join(summary.repo, '.agent-loop', 'latest', 'state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(state.status, 'DONE_FIXED');
  assert.match(await fs.readFile(path.join(summary.repo, 'value.js'), 'utf8'), /value = 2/);
  await fs.access(path.join(summary.repo, '.agent-loop', 'latest', 'grok-output.1.exit.json'));
  await fs.access(path.join(summary.repo, '.agent-loop', 'latest', 'diff.1.patch'));
});

test('smoke live only requires a Grok executable when review is skipped', async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-smoke-live-'));
  const { repo } = await createSmokeRepo({ outputRoot });
  const { grokStub } = await writeStubAgents({ outputRoot });
  const env = {
    ...process.env,
    AGENT_LOOP_GROK_COMMAND_JSON: JSON.stringify([
      process.execPath,
      grokStub,
    ]),
  };

  await assert.doesNotReject(async () => {
    const summary = await runSmokeLoop({ repo, env, timeoutMs: 60000 });
    assert.equal(summary.status, 'DONE_FIXED');
    assert.equal(summary.runMode, 'grok-fix');
  });
});

test('smoke live rejects missing Grok even when Codex exists', async () => {
  const script = path.join(agentLoopRoot, 'scripts', 'smoke-live.mjs');
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-no-grok-home-'));
  const result = await runProcess(process.execPath, [script], {
    cwd: agentLoopRoot,
    timeoutMs: 30000,
    env: {
      ...process.env,
      PATH: '',
      USERPROFILE: fakeHome,
      HOME: fakeHome,
      AGENT_LOOP_GROK_EXE: '',
      AGENT_LOOP_GROK_COMMAND_JSON: '',
      AGENT_LOOP_CODEX_COMMAND_JSON: JSON.stringify([
        process.execPath,
        path.join(agentLoopRoot, 'fixtures', 'grok-stub.mjs'),
      ]),
    },
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /live smoke requires a Grok executable/);
});
