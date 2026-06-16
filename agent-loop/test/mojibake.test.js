import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMojibakeInText } from '../src/mojibake.js';
import { runProcess } from '../src/runProcess.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('findMojibakeInText flags common UTF-8 mojibake sequences', () => {
  const findings = findMojibakeInText({
    file: 'test.py',
    text: 'goal = "鍒嗘瀽鏉冮檺绯荤粺"\nsummary = "正常中文"',
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].excerpt, /鍒嗘瀽/);
});

test('findMojibakeInText ignores normal Chinese and ASCII', () => {
  const findings = findMojibakeInText({
    file: 'test.py',
    text: 'goal = "分析权限系统风险"\nsummary = "normal ascii"',
  });

  assert.deepEqual(findings, []);
});

test('check-mojibake CLI ignores generated agent-loop run artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-mojibake-'));
  await fs.mkdir(path.join(root, '.agent-loop', 'runs'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.agent-loop', 'runs', 'state.json'),
    '{"stderr":"�ַ���ȱ����ֹ��"}\n',
    'utf8'
  );
  await fs.writeFile(path.join(root, 'src', 'good.js'), 'const label = "正常中文";\n', 'utf8');

  const result = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'check-mojibake.js'),
    root,
  ], {
    cwd: agentLoopRoot,
    timeoutMs: 30000,
  });

  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No mojibake findings\./);
});
