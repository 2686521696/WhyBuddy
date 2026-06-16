import fs from 'node:fs/promises';
import path from 'node:path';
import { findMojibakeInText } from './mojibake.js';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('Usage: node src/check-mojibake.js <path> [path...]');
  process.exitCode = 2;
} else {
  const findings = [];
  for (const root of roots) {
    findings.push(...await scanPath(path.resolve(process.cwd(), root)));
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.log(`${finding.file}:${finding.line}: ${finding.excerpt}`);
    }
    console.error(`Found ${findings.length} mojibake finding(s).`);
    process.exitCode = 1;
  } else {
    console.log('No mojibake findings.');
  }
}

async function scanPath(target) {
  const results = [];
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return results;
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      results.push(...await scanPath(path.join(target, entry.name)));
    }
    return results;
  }

  if (!shouldScanFile(target)) return results;
  const text = await fs.readFile(target, 'utf8');
  return findMojibakeInText({
    file: path.relative(process.cwd(), target),
    text,
  });
}

function shouldSkip(name) {
  return [
    '.git',
    '.agent-loop',
    '.venv',
    '.pytest_cache',
    '__pycache__',
    'node_modules',
    'data',
    'probes',
    'tmp',
    'mojibake.js',
    'mojibake.test.js',
  ].includes(name);
}

function shouldScanFile(file) {
  if (/\.(stdout|stderr)\.log$/i.test(file)) return false;
  return /\.(py|md|ts|tsx|js|mjs|json)$/i.test(file);
}
