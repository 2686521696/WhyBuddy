import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './runProcess.js';

export async function captureDiff({ cwd, timeoutMs = 60000, run = runProcess }) {
  const result = await run('git', ['diff', '--binary'], { cwd, timeoutMs });
  const untracked = await captureUntrackedDiff({ cwd, timeoutMs, run });
  return {
    text: [result.stdout || '', untracked].filter(Boolean).join('\n'),
    run: result,
  };
}

export function hasDiffChanged(before, after) {
  return normalizeDiff(before) !== normalizeDiff(after) && normalizeDiff(after).length > 0;
}

function normalizeDiff(value) {
  return String(value || '').trim();
}

async function captureUntrackedDiff({ cwd, timeoutMs, run }) {
  const result = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, timeoutMs });
  if (result.exitCode !== 0 || !result.stdout) return '';

  const files = result.stdout.split('\0').filter(Boolean);
  const diffs = [];
  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    const buffer = await fs.readFile(absolutePath);
    diffs.push(renderNewFileDiff(file, buffer));
  }
  return diffs.join('\n');
}

function renderNewFileDiff(file, buffer) {
  const normalizedFile = file.replaceAll('\\', '/');
  if (buffer.includes(0)) {
    return [
      `diff --git a/${normalizedFile} b/${normalizedFile}`,
      'new file mode 100644',
      'index 0000000..0000000',
      'Binary files /dev/null and b/' + normalizedFile + ' differ',
      '',
    ].join('\n');
  }

  const text = buffer.toString('utf8');
  const lines = text.length === 0 ? [] : text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();

  return [
    `diff --git a/${normalizedFile} b/${normalizedFile}`,
    'new file mode 100644',
    'index 0000000..0000000',
    '--- /dev/null',
    `+++ b/${normalizedFile}`,
    lines.length === 0 ? '@@ -0,0 +0,0 @@' : `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    '',
  ].join('\n');
}
