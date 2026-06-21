import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/runProcess.js';
import { applyQueueLandingToMain } from '../src/loopApply.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const repoRoot = valueAfter(argv, '--repo') || path.resolve(agentLoopRoot, '..');

  try {
    const result = await applyQueueLandingToMain({ repoRoot, runner: runProcess, check });
    if (check) {
      process.stderr.write(`[land] 预演通过：可以干净落地（${result.patchPath}）。\n`);
    } else {
      process.stderr.write(`[land] 已落地到 main：${result.patchPath}\n`);
    }
  } catch (error) {
    const kind = error?.kind || 'ERROR';
    process.stderr.write(`[land] ${check ? '预演' : '落地'}失败 (${kind}): ${error.message}\n`);
    if (Array.isArray(error?.files) && error.files.length) {
      process.stderr.write(`[land] 涉及文件：${error.files.join(', ')}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
