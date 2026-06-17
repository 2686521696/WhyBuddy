import { createSmokeRepo, parseSmokeArgs, runSmokeLoop } from './smoke-lib.mjs';
import { resolveAgents } from '../src/resolveAgents.js';

async function main() {
  const options = parseSmokeArgs(process.argv.slice(2));
  const agents = await resolveAgents();
  if (!agents.grok) {
    throw new Error('live smoke requires a Grok executable');
  }

  const { repo } = await createSmokeRepo({ outputRoot: options.outputRoot });
  const summary = await runSmokeLoop({
    repo,
    timeoutMs: options.timeoutMs,
    env: process.env,
  });
  process.stdout.write(`${JSON.stringify({
    ...summary,
    agents,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
