import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/runProcess.js';
import { summarizeRunRecord } from '../src/runSummary.js';

export const agentLoopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseSmokeArgs(argv) {
  const parsed = {
    outputRoot: null,
    timeoutMs: 120000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output-root') {
      parsed.outputRoot = readValue(argv, ++i, '--output-root');
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number.parseInt(readValue(argv, ++i, '--timeout-ms'), 10);
      if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive integer');
      }
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

export async function createSmokeRepo({ outputRoot, initialValue = 1, finalValue = 2 }) {
  const root = outputRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-smoke-'));
  await fs.mkdir(root, { recursive: true });
  const repo = await fs.mkdtemp(path.join(root, 'repo-'));
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: {
      test: 'node test.js',
    },
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(repo, 'value.js'), `export const value = ${initialValue};\n`, 'utf8');
  await fs.writeFile(path.join(repo, 'test.js'), [
    "import { value } from './value.js';",
    `if (value !== ${finalValue}) {`,
    "  console.error(`Expected value to be fixed, got ${value}`);",
    '  process.exit(1);',
    '}',
    "console.log('smoke fixture passed');",
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(repo, 'task.md'), [
    'Make npm test pass by changing value.js.',
    `Set the exported value to ${finalValue}.`,
    '',
  ].join('\n'), 'utf8');
  await runOk('git', ['init'], { cwd: repo });
  await runOk('git', ['config', 'user.email', 'agent-loop-smoke@example.test'], { cwd: repo });
  await runOk('git', ['config', 'user.name', 'Agent Loop Smoke'], { cwd: repo });
  await runOk('git', ['add', '.'], { cwd: repo });
  await runOk('git', ['commit', '-m', 'initial smoke fixture'], { cwd: repo });
  return { root, repo };
}

export async function writeStubAgents({ outputRoot, finalValue = 2 }) {
  const stubDir = path.join(outputRoot, 'stubs');
  await fs.mkdir(stubDir, { recursive: true });
  const grokStub = path.join(stubDir, 'grok-stub.mjs');
  const codexStub = path.join(stubDir, 'codex-stub.mjs');
  await fs.writeFile(grokStub, [
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "const cwdIndex = process.argv.indexOf('--cwd');",
    'const cwd = cwdIndex >= 0 ? process.argv[cwdIndex + 1] : process.cwd();',
    "await fs.writeFile(path.join(cwd, 'value.js'), 'export const value = " + finalValue + ";\\n', 'utf8');",
    'console.log(JSON.stringify({ verdict: "changed", source: "smoke-stub" }));',
    '',
  ].join('\n'), 'utf8');
  await fs.writeFile(codexStub, 'console.log("review skipped in smoke");\n', 'utf8');
  return { grokStub, codexStub };
}

export async function runSmokeLoop({ repo, env, timeoutMs = 120000 }) {
  const result = await runProcess(process.execPath, [
    path.join(agentLoopRoot, 'src', 'loop.js'),
    '--cwd',
    repo,
    '--fix-cwd',
    repo,
    '--task',
    'task.md',
    '--gate',
    'npm test',
    '--auto-fix',
    '--skip-review',
    '--timeout-ms',
    String(timeoutMs),
    '--max-iterations',
    '1',
  ], {
    cwd: agentLoopRoot,
    env,
    timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(`smoke loop failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const statePath = path.join(repo, '.agent-loop', 'latest', 'state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  return {
    ...summarizeRunRecord({
      runId: state.runId,
      status: state.status,
      task: state.options?.task,
      iterations: state.iterations,
      grokFix: state.grokFix,
      codexReview: state.codexReview,
    }),
    repo,
    latestDir: path.join(repo, '.agent-loop', 'latest'),
  };
}

async function runOk(command, args, options) {
  const result = await runProcess(command, args, { timeoutMs: 30000, ...options });
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}
