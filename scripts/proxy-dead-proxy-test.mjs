/**
 * Definitive NO_PROXY test: point HTTP_PROXY at a dead port.
 * If NO_PROXY lists the LLM host, fetch should still succeed (direct).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

async function run(label, patch) {
  const env = loadEnv();
  const baseUrl = env.LLM_BASE_URL.replace(/\/$/, "");
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY"];
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(patch)) process.env[k] = v;

  const started = performance.now();
  let ok = false;
  let error = null;
  let status = 0;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL || "gpt-5.5",
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    ok = res.ok;
    if (!res.ok) error = (await res.text()).slice(0, 120);
  } catch (e) {
    error = String(e?.message || e).slice(0, 120);
  }

  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  console.log(
    JSON.stringify({
      tag: "dead-proxy-test",
      label,
      ok,
      status,
      elapsedMs: Math.round(performance.now() - started),
      error,
      NO_PROXY: patch.NO_PROXY,
    })
  );
}

const env = loadEnv();
const deadProxy = "http://127.0.0.1:1";
const noProxy = env.NO_PROXY || "localhost,127.0.0.1";

await run("with_noproxy_should_direct", {
  HTTP_PROXY: deadProxy,
  HTTPS_PROXY: deadProxy,
  NO_PROXY: noProxy,
  no_proxy: noProxy,
  NODE_USE_ENV_PROXY: "1",
});

await run("without_noproxy_should_fail", {
  HTTP_PROXY: deadProxy,
  HTTPS_PROXY: deadProxy,
  NO_PROXY: "localhost,127.0.0.1",
  no_proxy: "localhost,127.0.0.1",
  NODE_USE_ENV_PROXY: "1",
});