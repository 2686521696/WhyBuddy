import fs from 'node:fs/promises';
import { scanTextForSecrets, summarizeSecretFindings } from '../src/secretScan.js';

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('secret-scan requires at least one file path');

  const findings = [];
  for (const filePath of paths) {
    const text = await fs.readFile(filePath, 'utf8');
    findings.push(...scanTextForSecrets({ path: filePath, text }));
  }

  const summary = summarizeSecretFindings(findings);
  process.stdout.write(`${JSON.stringify({ summary, findings }, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
