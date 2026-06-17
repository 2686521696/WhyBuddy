import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncTaskStatus } from '../src/syncTaskStatusCore.js';

const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await syncTaskStatus(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    cwd: path.resolve(agentLoopRoot, '..'),
    taskPaths: [],
    all: false,
    dryRun: false,
    includeMigrationStatus: false,
    timeZone: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cwd') {
      parsed.cwd = path.resolve(readValue(argv, ++i, '--cwd'));
    } else if (arg === '--task') {
      parsed.taskPaths.push(readValue(argv, ++i, '--task'));
    } else if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--include-migration-status') {
      parsed.includeMigrationStatus = true;
    } else if (arg === '--time-zone') {
      parsed.timeZone = readValue(argv, ++i, '--time-zone');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});