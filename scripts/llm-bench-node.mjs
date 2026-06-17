/**
 * LLM concurrency benchmark — Node.js
 * Usage: node scripts/llm-bench-node.mjs [--concurrency=40] [--use-proxy]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  const envPath = resolve(root, ".env");
  const text = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function parseArgs() {
  const concurrency = Number(
    process.argv.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? 40
  );
  const useProxy = process.argv.includes("--use-proxy");
  const model = process.argv.find(a => a.startsWith("--model="))?.split("=")[1];
  const reasoningEffort =
    process.argv.find(a => a.startsWith("--reasoning-effort="))?.split("=")[1];
  const label = process.argv.find(a => a.startsWith("--label="))?.split("=")[1];
  return { concurrency, useProxy, model, reasoningEffort, label };
}

async function oneCall({ baseUrl, apiKey, model, reasoningEffort, index, signal }) {
  const started = performance.now();
  const body = {
    model,
    messages: [{ role: "user", content: `Reply with exactly: pong-${index}` }],
    max_tokens: 128,
    temperature: 0,
  };
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const elapsed = performance.now() - started;
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  if (!raw.trim()) {
    throw new Error("Empty body");
  }
  let content = "";
  try {
    const data = JSON.parse(raw);
    content = data?.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error(`Bad JSON: ${raw.slice(0, 120)}`);
  }
  if (!String(content).trim()) {
    throw new Error("Empty content");
  }
  return elapsed;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const env = loadEnv();
  const { concurrency, useProxy, model: modelArg, reasoningEffort: reasoningArg, label } =
    parseArgs();
  const baseUrl = (env.LLM_BASE_URL || "https://api.rcouyi.com/v1").replace(/\/$/, "");
  const apiKey = env.LLM_API_KEY;
  const model = modelArg || env.LLM_MODEL || "ouyi-5-preview";
  const reasoningEffort = reasoningArg ?? env.LLM_REASONING_EFFORT ?? "";
  const timeoutMs = 120_000;

  if (!apiKey) {
    console.error("Missing LLM_API_KEY in .env");
    process.exit(1);
  }

  if (useProxy) {
    const proxyUrl = process.env.HTTP_PROXY || "http://127.0.0.1:7890";
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.NODE_USE_ENV_PROXY = "1";
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  } else {
    process.env.NO_PROXY = env.NO_PROXY || "api.rcouyi.com,localhost,127.0.0.1";
    process.env.no_proxy = process.env.NO_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NODE_USE_ENV_PROXY;
  }

  console.log(
    JSON.stringify(
      {
        label: label || null,
        runtime: "node",
        nodeVersion: process.version,
        concurrency,
        baseUrl,
        model,
        reasoningEffort: reasoningEffort || null,
        proxyMode: useProxy ? "via-proxy-no-noproxy" : "direct-noproxy",
        noProxy: process.env.NO_PROXY || null,
        httpProxy: process.env.HTTP_PROXY || null,
      },
      null,
      2
    )
  );

  const wallStart = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, (_, i) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return oneCall({
        baseUrl,
        apiKey,
        model,
        reasoningEffort: reasoningEffort || undefined,
        index: i + 1,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    })
  );
  const wallMs = performance.now() - wallStart;

  const ok = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "fulfilled") ok.push(r.value);
    else errors.push(r.reason?.message || String(r.reason));
  }
  ok.sort((a, b) => a - b);

  console.log(
    JSON.stringify(
      {
        success: ok.length,
        failed: errors.length,
        wallMs: Math.round(wallMs),
        latencyMs: ok.length
          ? {
              min: Math.round(ok[0]),
              p50: Math.round(percentile(ok, 50)),
              p95: Math.round(percentile(ok, 95)),
              max: Math.round(ok[ok.length - 1]),
              avg: Math.round(ok.reduce((s, v) => s + v, 0) / ok.length),
            }
          : null,
        sampleErrors: errors.slice(0, 5),
      },
      null,
      2
    )
  );

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
