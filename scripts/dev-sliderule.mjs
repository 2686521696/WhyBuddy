#!/usr/bin/env node
/**
 * dev:sliderule - start only what is needed for direct-to-Python SlideRule work.
 *
 * - Runs Vite dev server at :3000
 * - Runs slide-rule-python uvicorn at :9700 when the local venv exists
 * - Does not start the Node server at :3001
 */

import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const children = [];
let shuttingDown = false;

// 与 dev-all.mjs 同步：把根目录与 slide-rule-python/.env 都装进进程环境，
// python 子进程（uvicorn）继承后 LLM key / SLIDERULE_LLM_GENERATE_ENABLED
// 等 os.environ 读取的配置才生效（pydantic 只覆盖自己声明的字段）。
try {
  const dotenv = (await import("dotenv")).default;
  dotenv.config({ path: resolve(root, ".env"), override: true });
  dotenv.config({ path: resolve(root, "slide-rule-python", ".env"), override: false });
} catch {
  /* dotenv 缺失时保持旧行为 */
}

function waitForPortListening(port, { timeoutMs = 800 } = {}) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;

    const probe = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(probe, 80);
      });
    };

    probe();
  });
}

function run(name, command, args = [], options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
  });

  child.on("exit", (code) => {
    if (shuttingDown) return;
    const portGuard = Number(options.portGuard || 0);
    if (portGuard && process.platform === "win32") {
      waitForPortListening(portGuard).then(stillListening => {
        if (shuttingDown) return;
        if (stillListening) {
          console.warn(
            `[${name}] wrapper exited with code ${code ?? 0}, but port ${portGuard} is still bound. Keeping dev:sliderule running.`
          );
          return;
        }
        console.log(`[${name}] exited with code ${code}`);
        shutdown(code ?? 1);
      });
      return;
    }
    console.log(`[${name}] exited with code ${code}`);
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev:sliderule] Starting Vite + Python backend only. No Node server.");
console.log("[dev:sliderule] /api/sliderule and /api/agent-loop proxy directly to :9700");

run("vite", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
  portGuard: Number(process.env.VITE_PORT || 3000),
});

const pythonDir = resolve(root, "slide-rule-python");
const pythonExe = process.platform === "win32"
  ? resolve(pythonDir, ".venv", "Scripts", "python.exe")
  : resolve(pythonDir, ".venv", "bin", "python");

if (existsSync(pythonExe)) {
  const port = process.env.SLIDE_RULE_PYTHON_PORT || "9700";
  console.log(`[dev:sliderule] Starting slide-rule-python on :${port}`);
  run("python", pythonExe, [
    "-m", "uvicorn",
    "app:app",
    "--host", "127.0.0.1",
    "--port", port,
    "--reload",
  ], { cwd: pythonDir, portGuard: Number(port) });
} else {
  console.warn("[dev:sliderule] Python venv not found. Start uvicorn manually if needed:");
  console.warn("  cd slide-rule-python && .venv/bin/python -m uvicorn app:app --port 9700 --reload");
}

console.log("\n[dev:sliderule] Ready. Visit http://localhost:3000/agent-loop/sliderule");
console.log("API calls go straight to Python (no Node proxy process).");
