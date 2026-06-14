import { spawn } from "node:child_process";
import net from "node:net";
import dotenv from "dotenv";
import Dockerode from "dockerode";

dotenv.config();

const children = [];
let shuttingDown = false;

function resolveCommand(command) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npx")
  ) {
    return `${command}.cmd`;
  }
  return command;
}

function quoteShellArg(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function defaultDockerHost() {
  return process.platform === "win32"
    ? "npipe:////./pipe/docker_engine"
    : "/var/run/docker.sock";
}

function parseDockerOptions(dockerHost) {
  if (!dockerHost) return {};

  if (dockerHost.startsWith("npipe:")) {
    return {
      socketPath: dockerHost.replace(/^npipe:\/\//, "").replace(/\//g, "\\"),
    };
  }

  if (dockerHost.startsWith("/") || dockerHost.startsWith("\\\\.\\pipe\\")) {
    return { socketPath: dockerHost };
  }

  try {
    const url = new URL(dockerHost.replace(/^tcp:\/\//, "http://"));
    return {
      host: url.hostname,
      port: url.port || "2375",
      protocol: "http",
    };
  } catch {
    return { host: dockerHost };
  }
}

function resolveRequestedExecutionMode() {
  const requestedMode = process.env.LOBSTER_EXECUTION_MODE;
  if (requestedMode === "mock" || requestedMode === "native") {
    return requestedMode;
  }
  return "real";
}

/**
 * `blueprint-v4-full-alignment`：把 v4 全流程的 5 个 env gate 在 dev:all 启动的
 * 子进程里默认翻转为 "true"（opt-out on），让 checks-ledger / content-quality /
 * companion / traceability-matrix / preview-audit 在本地开发链路里默认上电。
 *
 * 与 AUTOPILOT_REAL_RUNTIME 同款语义：用户在 `.env` / shell 里显式设置的值始终
 * 优先（`process.env.X ?? "true"`）。`BUILD_TARGET=test` 路径不经过本脚本，
 * 既有 85+ E2E 基线（gates-off）不受影响。
 */
function resolveV4AlignmentGates() {
  return {
    BLUEPRINT_CHECKS_LEDGER_ENABLED:
      process.env.BLUEPRINT_CHECKS_LEDGER_ENABLED ?? "true",
    BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED:
      process.env.BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED ?? "true",
    BLUEPRINT_COMPANION_ENABLED:
      process.env.BLUEPRINT_COMPANION_ENABLED ?? "true",
    BLUEPRINT_TRACEABILITY_MATRIX_ENABLED:
      process.env.BLUEPRINT_TRACEABILITY_MATRIX_ENABLED ?? "true",
    BLUEPRINT_PREVIEW_AUDIT_ENABLED:
      process.env.BLUEPRINT_PREVIEW_AUDIT_ENABLED ?? "true",
  };
}

async function isDockerReachable(dockerHost) {
  try {
    const docker = new Dockerode(parseDockerOptions(dockerHost));
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

function hasExplicitProxyEnv() {
  return Boolean(
    process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.ALL_PROXY ||
      process.env.http_proxy ||
      process.env.https_proxy ||
      process.env.all_proxy ||
      process.env.NODE_USE_ENV_PROXY
  );
}

function canConnectToLocalPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Poll a local TCP port until it either accepts a connection or the timeout expires.
 *
 * Used by `run()` with `portGuard` to distinguish a real crash from a harmless wrapper
 * exit on Windows. On Windows, `npm run` / `npx` goes through `cmd.exe /c` which spawns
 * the real Node process as a separate child; the cmd wrapper often exits with code -1
 * (0xFFFFFFFF / 4294967295) while the underlying listener stays alive. Before treating
 * such an exit as a fatal failure, we verify whether the advertised port is still
 * bound.
 */
async function waitForPortListening(port, { timeoutMs = 800 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnectToLocalPort(port)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function resolveProxyEnvironment() {
  if (hasExplicitProxyEnv()) {
    return {};
  }

  const localProxyPort = Number(process.env.DEV_AUTO_PROXY_PORT || 7890);
  if (!Number.isFinite(localProxyPort) || localProxyPort <= 0) {
    return {};
  }

  if (!(await canConnectToLocalPort(localProxyPort))) {
    return {};
  }

  const proxyUrl = `http://127.0.0.1:${localProxyPort}`;
  console.warn(
    `[dev:all] Detected local proxy at ${proxyUrl}. Enabling Node env proxy (HTTP_PROXY/HTTPS_PROXY + NODE_USE_ENV_PROXY=1) for dev child processes.`
  );

  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: process.env.NO_PROXY || "localhost,127.0.0.1",
    no_proxy: process.env.NO_PROXY || process.env.no_proxy || "localhost,127.0.0.1",
    NODE_USE_ENV_PROXY: "1",
  };
}

async function resolveDevEnvironment() {
  const requestedExecutionMode = resolveRequestedExecutionMode();
  // Task 14（`.kiro/specs/autopilot-capability-runtime-enablement`）：
  // 为所有 dev:all 启动的子进程默认注入 AUTOPILOT_REAL_RUNTIME=true，让
  // blueprint capability bridge 的 env resolver 把 5 条桥的 tier-1 门禁
  // 默认翻转为 "true"。用户显式设置的值始终优先（requirement 1.6）。
  const masterSwitch = process.env.AUTOPILOT_REAL_RUNTIME ?? "true";
  const v4Gates = resolveV4AlignmentGates();
  const proxyEnv = await resolveProxyEnvironment();

  if (requestedExecutionMode !== "real") {
    return {
      LOBSTER_EXECUTION_MODE: requestedExecutionMode,
      AUTOPILOT_REAL_RUNTIME: masterSwitch,
      ...v4Gates,
      ...proxyEnv,
    };
  }

  const dockerHost =
    process.env.LOBSTER_DOCKER_HOST ||
    process.env.DOCKER_HOST ||
    defaultDockerHost();
  const dockerReachable = await isDockerReachable(dockerHost);

  if (dockerReachable) {
    return {
      LOBSTER_EXECUTION_MODE: "real",
      AUTOPILOT_REAL_RUNTIME: masterSwitch,
      ...v4Gates,
      ...proxyEnv,
    };
  }

  console.warn(
    `[dev:all] Docker is unavailable at "${dockerHost}". Falling back to ` +
      `LOBSTER_EXECUTION_MODE=native so the dev stack can keep running.`
  );

  return {
    LOBSTER_EXECUTION_MODE: "native",
    AUTOPILOT_REAL_RUNTIME: masterSwitch,
    ...v4Gates,
    ...proxyEnv,
  };
}

function terminateChild(child) {
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore shutdown races
    }
  }

  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore shutdown races
      }
    }
  }, 1500);
  forceKillTimer.unref?.();
}

function run(name, command, args = [], extraEnv = {}, options = {}) {
  const { waitForReady = false, readyText = "", portGuard } = options;
  const resolvedCommand = resolveCommand(command);
  const child = spawn(
    process.platform === "win32"
      ? [resolvedCommand, ...args].map(quoteShellArg).join(" ")
      : resolvedCommand,
    process.platform === "win32" ? [] : args,
    {
      stdio: waitForReady ? ["inherit", "pipe", "pipe"] : "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    }
  );

  let readyResolve;
  let readyReject;
  let isReady = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  const readyPromise = waitForReady
    ? new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      })
    : Promise.resolve();

  if (waitForReady) {
    child.stdout?.on("data", chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer += text;

      if (!isReady && readyText && stdoutBuffer.includes(readyText)) {
        isReady = true;
        readyResolve?.();
      }
    });

    child.stderr?.on("data", chunk => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer += text;
    });
  }

  child.on("error", error => {
    if (waitForReady && !isReady) {
      readyReject?.(error);
    }

    if (shuttingDown) return;
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (waitForReady && !isReady) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      const output = [stdoutBuffer.trim(), stderrBuffer.trim()]
        .filter(Boolean)
        .join("\n");
      readyReject?.(
        new Error(
          output
            ? `[${name}] exited with ${reason}\n${output}`
            : `[${name}] exited with ${reason}`
        )
      );
    }

    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;

    // On Windows, `npm run` / `npx` spawns the real Node process through a `cmd.exe /c`
    // wrapper. The wrapper sometimes exits with code 4294967295 (-1) after forwarding
    // control to the child, while the underlying listener stays alive. If a `portGuard`
    // is configured and the advertised port is still bound, treat this as a benign
    // wrapper exit instead of tearing down the whole dev stack.
    if (portGuard && process.platform === "win32") {
      waitForPortListening(portGuard, { timeoutMs: 800 })
        .then(stillListening => {
          if (shuttingDown) return;
          if (stillListening) {
            console.warn(
              `[${name}] wrapper exited with ${reason}, but port ${portGuard} is still bound. ` +
                `Keeping the dev stack running.`
            );
            return;
          }
          console.error(`[${name}] exited with ${reason}`);
          shutdown(code ?? 1);
        })
        .catch(() => {
          if (shuttingDown) return;
          console.error(`[${name}] exited with ${reason}`);
          shutdown(code ?? 1);
        });
      return;
    }

    console.error(`[${name}] exited with ${reason}`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return { child, readyPromise };
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    terminateChild(child);
  }

  const exitTimer = setTimeout(
    () => process.exit(exitCode),
    process.platform === "win32" ? 1800 : 400
  );
  exitTimer.unref?.();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const sharedDevEnv = await resolveDevEnvironment();

  // Explicit visibility: the server child will receive the resolved proxy env (if any).
  if (sharedDevEnv.HTTP_PROXY || sharedDevEnv.HTTPS_PROXY) {
    console.log(
      `[dev:all] Starting server child with proxy: HTTP_PROXY=${sharedDevEnv.HTTP_PROXY ? "set" : ""} ` +
      `HTTPS_PROXY=${sharedDevEnv.HTTPS_PROXY ? "set" : ""} NODE_USE_ENV_PROXY=${sharedDevEnv.NODE_USE_ENV_PROXY || ""}`
    );
  }

  const server = run(
    "server",
    "npm",
    ["run", "dev:server"],
    {
      PORT: "3001",
      ...sharedDevEnv,
    },
    {
      waitForReady: true,
      readyText: "Server running on http://localhost:3001/",
    }
  );

  try {
    await Promise.race([
      server.readyPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("Timed out waiting for dev server readiness log.")
            ),
          180000
        )
      ),
    ]);
  } catch (error) {
    console.error(
      `[dev:all] ${error instanceof Error ? error.message : String(error)}`
    );
    shutdown(1);
    return;
  }

  run("client", "npm", ["run", "dev"], sharedDevEnv);
  run(
    "executor",
    "npx",
    ["tsx", "services/lobster-executor/src/index.ts"],
    sharedDevEnv,
    {
      // On Windows the `npx` wrapper sits behind `cmd.exe /c`, which forwards control
      // to the real Node child and then exits with code 4294967295. Guard the exit
      // handler with the executor's listening port (3031) so a benign wrapper exit
      // does not tear down the dev stack.
      portGuard: Number(process.env.LOBSTER_EXECUTOR_PORT ?? 3031),
    }
  );
}

void main();
