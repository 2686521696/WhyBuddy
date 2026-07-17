/// <reference types="vitest/config" />
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
  const lines = entries.map(entry => {
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
        req.on("data", chunk => {
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

// Python-first API 路由守卫移至 ./api-target.ts（测试/脚本可直接引，
// 不连带 vite 插件链）；此处 import + re-export：配置体内 proxy 仍在用，
// 且保持既有 `node -e`/脚本的导入路径兼容。
import { resolveApiTarget } from "./api-target";
export { resolveApiTarget };

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
  // blob: 允许同文档内 createObjectURL（three.js GLTFLoader 解 GLB 内嵌贴图
  // 走 blob URL——Work 模式 3D 角色需要）；blob 只能由本页脚本创建，
  // 不放开任何外联，zero-trust 姿态不变。
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' blob: https://api.openai.com https://api.deepseek.com https://openrouter.ai https://api.anthropic.com https://api.groq.com data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:;" />`;
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
    // Manus 宿主运行时会向 index.html 内联 ~358KB 脚本（含整份 React 副本）。
    // GitHub Pages 静态演示不在 Manus 宿主里运行，用不到它——排除后 HTML 从
    // ~370KB 回到 ~12KB。本地 dev / 其他构建目标保持不变。
    ...(isGitHubPagesBuild ? [] : [vitePluginManusRuntime()]),
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
    // 测试提速：vmThreads 池在保留"每文件独立模块注册表"隔离语义的前提下
    // 共享编译缓存——本套件 collect 阶段（antd 等重依赖逐文件重载）是大头，
    // 全量 4500+ 例从 ~89s 降到 ~53s。不用 isolate:false：实测 103 例
    // 跨文件全局态污染（fetch/localStorage 模块级 stub），省的时间不值风险。
    test: {
      pool: "vmThreads",
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        // E40.1 合法域单一真相源：客户端与 python 门/修复器/生成契约同读一份账本
        "@legal": path.resolve(import.meta.dirname, "slide-rule-python/services/data/five_system_legal.json"),
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
