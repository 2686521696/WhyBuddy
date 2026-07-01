// jsxLocPlugin removed to avoid R3F data-loc conflicts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",
    apply: "serve",

    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// === Python-first frontend API routing (backend-python-total-cutover-105) ===
// Local dev and frontend API calls prefer Python where a Python route exists (listed owned prefixes).
// Default is Python-first for /api/sliderule, /api/blueprint/spec-documents (and always /api/agent-loop);
// explicit Node legacy fallback for other /api/* (Node thin proxy / compat shell).
// Set VITE_PYTHON_FIRST_API=false (or FRONTEND_PYTHON_FIRST=false etc) to opt out for owned prefixes.
// PYTHON_API_TARGET overrides target. resolveApiTarget(path) is executable guard (importable for tests/verif).
// Placed at top level for tsx/node -e verification and vitest.
const PYTHON_DEFAULT_TARGET = "http://localhost:9700";
const NODE_DEFAULT_TARGET = "http://localhost:3001";
export function resolveApiTarget(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const pyTarget = env.PYTHON_API_TARGET || env.AGENT_LOOP_API_TARGET || PYTHON_DEFAULT_TARGET;
  if (path.startsWith("/api/agent-loop")) {
    return pyTarget; // explicit Python-owned (baseline, always)
  }
  if (path === "/api/health" || path.startsWith("/api/health/") || path === "/health" || path === "/ready") {
    return pyTarget; // health/readiness unified to Python per foundation task 04 + task 05 Vite default proxy
  }
  const hasExplicitDisable =
    env.VITE_PYTHON_FIRST_API === "false" ||
    env.FRONTEND_PYTHON_FIRST === "false" ||
    env.PYTHON_FIRST_PROXY === "false";
  const hasExplicitEnable =
    env.VITE_PYTHON_FIRST_API === "true" ||
    env.FRONTEND_PYTHON_FIRST === "true" ||
    env.PYTHON_FIRST_PROXY === "true" ||
    !!env.PYTHON_API_TARGET;
  const pythonFirstEnabled = hasExplicitEnable || !hasExplicitDisable;
  const pythonOwnedPrefixes = [
    "/api/sliderule",
    "/api/blueprint/spec-documents",
    "/api/health",
    // health/readiness unified under Python (task 04). Vite dev routing defaults Python for owned (task 05).
    // Non-listed /api/* stay Node explicit thin compat per policy.
  ];
  if (pythonFirstEnabled && pythonOwnedPrefixes.some((p) => path.startsWith(p))) {
    return pyTarget;
  }
  return NODE_DEFAULT_TARGET;
}

export default defineConfig(() => {
  const repository = process.env.GITHUB_REPOSITORY || "opencroc/sliderule";
  const repositoryName = repository.split("/")[1] || "sliderule";
  const repositoryUrl = `https://github.com/${repository}`;
  const isGitHubPagesBuild =
    process.env.GITHUB_PAGES === "true" ||
    process.env.DEPLOY_TARGET === "github-pages";

  // B5: CSP injection plugin - injects the strict connect-src policy for browser-llm zero-trust.
  // Done via transform (instead of hardcoded in index.html) to prevent Vite html-proxy / transformIndexHtml
  // module resolution errors during `vite build` for GitHub Pages static export.
  // Also applies in dev for the demo.
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://api.openai.com https://api.deepseek.com https://openrouter.ai https://api.anthropic.com https://api.groq.com data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:;" />`;
  const vitePluginCspForByok = {
    name: "csp-for-byok-pages",
    transformIndexHtml(html) {
      // Avoid duplicate if somehow present
      if (html.includes("Content-Security-Policy")) return html;
      // Insert early in <head>
      return html.replace(/<head>/i, `<head>\n    ${cspMeta}`);
    },
  };

  const plugins = [
    react(),
    tailwindcss(),
    vitePluginManusRuntime(),
    vitePluginManusDebugCollector(),
    vitePluginCspForByok,
  ];

  return {
    base: isGitHubPagesBuild ? `/${repositoryName}/` : "/",
    define: {
      __GITHUB_PAGES__: JSON.stringify(isGitHubPagesBuild),
      __GITHUB_REPOSITORY__: JSON.stringify(repository),
      __GITHUB_REPOSITORY_URL__: JSON.stringify(repositoryUrl),
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    envDir: path.resolve(import.meta.dirname),
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      strictPort: false, // Will find next available port if 3000 is busy
      host: true,
      allowedHosts: [
        ".manuspre.computer",
        ".manus.computer",
        ".manus-asia.computer",
        ".manuscomputer.ai",
        ".manusvm.computer",
        "localhost",
        "127.0.0.1",
      ],
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      proxy: {
        // Python-first default cutover (105): Vite dev routing now prefers Python backend APIs for owned surfaces.
        // Dedicated entries ensure /api/health, /health, /ready, /api/agent-loop etc target Python via resolve.
        // Unlisted /api/* fall to Node (explicit thin proxy/compat shell only). PYTHON_FIRST env controls listed.
        "/api/agent-loop": {
          target: resolveApiTarget("/api/agent-loop"),
          changeOrigin: true,
        },
        "/api/sliderule": {
          target: resolveApiTarget("/api/sliderule"),
          changeOrigin: true,
        },
        "/api/blueprint/spec-documents": {
          target: resolveApiTarget("/api/blueprint/spec-documents"),
          changeOrigin: true,
        },
        "/api/health": {
          target: resolveApiTarget("/api/health"),
          changeOrigin: true,
        },
        "/health": {
          target: resolveApiTarget("/health"),
          changeOrigin: true,
        },
        "/ready": {
          target: resolveApiTarget("/ready"),
          changeOrigin: true,
        },
        "/api": {
          target: resolveApiTarget("/api"),
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://localhost:3001",
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
