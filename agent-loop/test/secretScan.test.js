import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTextForSecrets, summarizeSecretFindings } from '../src/secretScan.js';

test('scanTextForSecrets flags likely real API keys', () => {
  const findings = scanTextForSecrets({
    path: 'src/config.js',
    text: 'const key = "sk-live_1234567890abcdef";\n',
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'blocker');
  assert.equal(findings[0].kind, 'openai_api_key');
  assert.equal(findings[0].line, 1);
});

test('scanTextForSecrets treats test keys as warnings', () => {
  const findings = scanTextForSecrets({
    path: 'tests/config.test.js',
    text: 'const key = "sk-test-observability-secret-one";\n',
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].kind, 'test_api_key');
});

test('scanTextForSecrets ignores ordinary secret-scan command names', () => {
  const findings = scanTextForSecrets({
    path: 'package.json',
    text: [
      '"secret-scan": "node scripts/secret-scan.mjs"',
      "'node agent-loop/scripts/secret-scan.mjs <changed-files>'",
      '',
    ].join('\n'),
  });

  assert.deepEqual(findings, []);
});

test('summarizeSecretFindings reports blockers separately from warnings', () => {
  const summary = summarizeSecretFindings([
    { severity: 'warning' },
    { severity: 'blocker' },
    { severity: 'blocker' },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    blockers: 2,
    warnings: 1,
    ok: false,
  });
});
