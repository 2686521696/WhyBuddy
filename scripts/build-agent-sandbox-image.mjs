import { spawnSync } from "node:child_process";

const image = process.env.LOBSTER_AGENT_IMAGE || "cube-ai-agent-sandbox:latest";
const baseImage = process.env.LOBSTER_AGENT_BASE_IMAGE || "node:20-slim";
const dockerfile = "services/lobster-executor/Dockerfile.agent";
const context = "services/lobster-executor";

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
    `[agent-image-build] Docker is unavailable. Start Docker Desktop or expose a Docker daemon before building. ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

console.log(`[agent-image-build] Building ${image} from ${dockerfile} with base ${baseImage}`);
run("docker", [
  "build",
  "--pull=false",
  "-f",
  dockerfile,
  "--build-arg",
  `BASE_IMAGE=${baseImage}`,
  "-t",
  image,
  context,
]);
console.log(`[agent-image-build] Built ${image}`);
