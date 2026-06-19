import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLoopApplyPlan } from '../src/loopApply.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(agentLoopRoot, valueAfter(argv, '--cwd') || '..');
  const run = valueAfter(argv, '--run') || 'latest';
  const excludeTaskDoc = !argv.includes('--include-task-doc');
  const extraExcludes = valuesAfter(argv, '--exclude');
  const plan = await buildLoopApplyPlan({
    repoRoot,
    run,
    excludeTaskDoc,
    extraExcludes,
  });

  process.stdout.write(`${JSON.stringify({
    ...plan,
    nextSteps: [
      plan.checkCommand,
      plan.applyCommand,
      ...plan.gates,
      'node agent-loop/src/check-mojibake.js <changed-files>',
      'node agent-loop/scripts/secret-scan.mjs <changed-files>',
    ],
  }, null, 2)}\n`);
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function valuesAfter(argv, flag) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      values.push(value);
      i += 1;
    }
  }
  return values;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
