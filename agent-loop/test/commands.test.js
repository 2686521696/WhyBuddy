import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArgs, buildCodexReviewArgs, buildGrokJsonArgs } from '../src/commands.js';
import { parseProbeArgs } from '../src/indexArgs.js';

test('codex review args use current working directory and uncommitted diff', () => {
  assert.deepEqual(buildCodexReviewArgs(), ['review', '--uncommitted']);
  assert.deepEqual(buildCodexReviewArgs({ readPromptFromStdin: true }), ['review', '--uncommitted', '-']);
});

test('codex review args allow model override', () => {
  assert.deepEqual(buildCodexReviewArgs({ model: 'gpt-5.5' }), [
    '-m',
    'gpt-5.5',
    'review',
    '--uncommitted',
  ]);
});

test('codex exec args target fix cwd and read prompt from stdin', () => {
  assert.deepEqual(buildCodexExecArgs({ cwd: 'C:\\repo' }), [
    'exec',
    '--cd',
    'C:\\repo',
    '--dangerously-bypass-approvals-and-sandbox',
    '-',
  ]);
});

test('codex exec args allow model override', () => {
  assert.deepEqual(buildCodexExecArgs({ cwd: 'C:\\repo', model: 'gpt-5.5' }), [
    'exec',
    '-m',
    'gpt-5.5',
    '--cd',
    'C:\\repo',
    '--dangerously-bypass-approvals-and-sandbox',
    '-',
  ]);
});

test('grok json args request approved non-planning turns in the target cwd', () => {
  assert.deepEqual(buildGrokJsonArgs({ promptFile: 'prompt.md', cwd: 'repo' }), [
    '--prompt-file',
    'prompt.md',
    '--output-format',
    'json',
    '--cwd',
    'repo',
    '--max-turns',
    '4',
    '--no-plan',
    '--always-approve',
  ]);
});

test('grok json args allow overriding max turns', () => {
  assert.deepEqual(buildGrokJsonArgs({ promptFile: 'prompt.md', cwd: 'repo', maxTurns: 7 }), [
    '--prompt-file',
    'prompt.md',
    '--output-format',
    'json',
    '--cwd',
    'repo',
    '--max-turns',
    '7',
    '--no-plan',
    '--always-approve',
  ]);
});

test('grok json args allow model override', () => {
  assert.deepEqual(buildGrokJsonArgs({ promptFile: 'prompt.md', cwd: 'repo', model: 'grok-build' }), [
    '-m',
    'grok-build',
    '--prompt-file',
    'prompt.md',
    '--output-format',
    'json',
    '--cwd',
    'repo',
    '--max-turns',
    '4',
    '--no-plan',
    '--always-approve',
  ]);
});

test('parseProbeArgs defaults to English and accepts zh-CN', () => {
  assert.deepEqual(parseProbeArgs([]), { lang: 'en' });
  assert.deepEqual(parseProbeArgs(['--lang', 'zh-CN']), { lang: 'zh-CN' });
});

test('parseProbeArgs rejects unknown flags and languages', () => {
  assert.throws(() => parseProbeArgs(['--lang', 'fr']), /--lang must be one of: en, zh-CN/);
  assert.throws(() => parseProbeArgs(['--unknown']), /unknown argument: --unknown/);
});
