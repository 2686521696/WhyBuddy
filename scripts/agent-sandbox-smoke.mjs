import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const image = process.env.LOBSTER_AGENT_IMAGE || "cube-ai-agent-sandbox:latest";
const artifactsDir = resolve("tmp", "agent-sandbox-smoke");

function dockerArgsForVolume() {
  const target = "/workspace/artifacts";
  return [`${artifactsDir}:${target}`];
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

try {
  run("docker", ["version"]);
} catch (error) {
  console.error(
    `[agent-sandbox-smoke] Docker is unavailable. Start Docker Desktop or expose a Docker daemon before running the image smoke. ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

rmSync(artifactsDir, { recursive: true, force: true });
mkdirSync(artifactsDir, { recursive: true });

console.log(`[agent-sandbox-smoke] Running self-check in ${image}`);
run("docker", [
  "run",
  "--rm",
  "-v",
  ...dockerArgsForVolume(),
  "--entrypoint",
  "node",
  image,
  "/opt/cube-agent/self-check.js",
]);
console.log(`[agent-sandbox-smoke] Artifacts written to ${artifactsDir}`);
