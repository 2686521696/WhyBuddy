import { createSmokeRepo, parseSmokeArgs, runSmokeLoop, writeStubAgents } from './smoke-lib.mjs';

async function main() {
  const options = parseSmokeArgs(process.argv.slice(2));
  const { root, repo } = await createSmokeRepo({ outputRoot: options.outputRoot });
  const { grokStub, codexStub } = await writeStubAgents({ outputRoot: root });
  const summary = await runSmokeLoop({
    repo,
    timeoutMs: options.timeoutMs,
    env: {
      ...process.env,
      AGENT_LOOP_GROK_COMMAND_JSON: JSON.stringify([process.execPath, grokStub]),
      AGENT_LOOP_CODEX_COMMAND_JSON: JSON.stringify([process.execPath, codexStub]),
      NODE_OPTIONS: '',
    },
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
