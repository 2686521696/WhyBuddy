import { listRuns, formatRunList } from './listRuns.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runs = await listRuns(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatRunList(runs, { lang: options.lang }));
}

function parseArgs(argv) {
  const parsed = {
    cwd: process.cwd(),
    limit: 20,
    lang: 'en',
    json: false,
    modes: [],
    statuses: [],
    tasks: [],
    timeZone: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cwd') {
      parsed.cwd = readValue(argv, ++i, '--cwd');
    } else if (arg === '--limit') {
      parsed.limit = Number.parseInt(readValue(argv, ++i, '--limit'), 10);
      if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
        throw new Error('--limit must be a positive integer');
      }
    } else if (arg === '--lang') {
      parsed.lang = readValue(argv, ++i, '--lang');
      if (!['en', 'zh-CN'].includes(parsed.lang)) {
        throw new Error('--lang must be one of: en, zh-CN');
      }
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--mode') {
      parsed.modes.push(readValue(argv, ++i, '--mode'));
    } else if (arg === '--status') {
      parsed.statuses.push(readValue(argv, ++i, '--status'));
    } else if (arg === '--task') {
      parsed.tasks.push(readValue(argv, ++i, '--task'));
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
