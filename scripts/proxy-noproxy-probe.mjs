/**
 * Probe whether Node fetch honors NO_PROXY for the configured LLM host
 * when HTTP_PROXY + NODE_USE_ENV_PROXY are set (dev-all simulation).
 *
 * Usage: node scripts/proxy-noproxy-probe.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

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

async function probe(label, envPatch) {
  const env = loadEnv();
  const baseUrl = (env.LLM_BASE_URL || "").replace(/\/$/, "");
  const apiKey = env.LLM_API_KEY || "";
  const host = new URL(baseUrl).hostname;

  const prev = {};
  for (const [k, v] of Object.entries(envPatch)) {
    prev[k] = process.env[k];
    if (v === null || v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }

  const meta = {
    label,
    nodeVersion: process.version,
    host,
    HTTP_PROXY: process.env.HTTP_PROXY || null,
    HTTPS_PROXY: process.env.HTTPS_PROXY || null,
    NO_PROXY: process.env.NO_PROXY || null,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || null,
  };

  const started = performance.now();
  let status = 0;
  let error = null;
  let ok = false;
  let bodyLength = 0;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL || "gpt-5.5",
        messages: [{ role: "user", content: "Reply with exactly: proxy-probe-ok" }],
        max_tokens: 32,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    const text = await res.text();
    bodyLength = text.length;
    if (!res.ok) {
      error = text.slice(0, 160);
    } else if (!text.trim()) {
      error = "Empty response body";
    } else {
      try {
        const json = JSON.parse(text);
        const content = json?.choices?.[0]?.message?.content ?? "";
        if (!String(content).trim()) error = "Empty response content";
      } catch {
        error = `Invalid JSON response: ${text.slice(0, 120)}`;
      }
    }
    ok = res.ok && !error;
  } catch (e) {
    error = String(e?.message || e).slice(0, 160);
  }

  const elapsed = Math.round(performance.now() - started);

  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return { ...meta, status, ok, elapsedMs: elapsed, bodyLength, error };
}

async function main() {
  const env = loadEnv();
  const host = new URL(env.LLM_BASE_URL).hostname;
  const noProxy = env.NO_PROXY || `${host},localhost,127.0.0.1`;
  const proxyUrl = process.env.HTTP_PROXY || "http://127.0.0.1:7890";

  const inNoProxy = noProxy
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => host.toLowerCase() === entry || host.toLowerCase().endsWith(`.${entry}`));

  console.log(
    JSON.stringify(
      {
        tag: "proxy-probe.config",
        llmHost: host,
        noProxyFromEnv: noProxy,
        hostListedInNoProxy: inNoProxy,
        note: inNoProxy
          ? "hostname is listed — Node should bypass proxy when NODE_USE_ENV_PROXY=1"
          : "WARNING: LLM host NOT in NO_PROXY list",
      },
      null,
      2
    )
  );

  const scenarios = [
    {
      label: "A_direct_no_proxy_env",
      patch: {
        HTTP_PROXY: null,
        HTTPS_PROXY: null,
        NO_PROXY: null,
        no_proxy: null,
        NODE_USE_ENV_PROXY: null,
      },
    },
    {
      label: "B_dev_all_with_noproxy",
      patch: {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        NO_PROXY: noProxy,
        no_proxy: noProxy,
        NODE_USE_ENV_PROXY: "1",
      },
    },
    {
      label: "C_proxy_without_noproxy",
      patch: {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        NO_PROXY: "localhost,127.0.0.1",
        no_proxy: "localhost,127.0.0.1",
        NODE_USE_ENV_PROXY: "1",
      },
    },
  ];

  const results = [];
  for (const s of scenarios) {
    results.push(await probe(s.label, s.patch));
    console.log(JSON.stringify({ tag: "proxy-probe.result", ...results.at(-1) }, null, 2));
  }

  const b = results.find((r) => r.label === "B_dev_all_with_noproxy");
  const c = results.find((r) => r.label === "C_proxy_without_noproxy");
  const a = results.find((r) => r.label === "A_direct_no_proxy_env");

  let verdict = "inconclusive";
  if (b?.ok && c?.ok) {
    verdict =
      Math.abs((b.elapsedMs || 0) - (c.elapsedMs || 0)) < 500
        ? "NO_PROXY may NOT be bypassing (B and C similar)"
        : "likely_ok_both_paths_work";
  } else if (b?.ok && !c?.ok) {
    verdict = "NO_PROXY likely working (B ok, C failed)";
  } else if (!b?.ok && c?.ok) {
    verdict = "NO_PROXY likely BROKEN (C ok via proxy, B failed direct)";
  } else if (b?.ok && a?.ok) {
    const delta = Math.abs((b.elapsedMs || 0) - (a.elapsedMs || 0));
    verdict =
      delta > 800
        ? "NO_PROXY likely NOT applied (B much slower than A)"
        : "NO_PROXY likely working (B ~ A latency)";
  }

  console.log(
    JSON.stringify(
      {
        tag: "proxy-probe.verdict",
        verdict,
        compareMs: { A: a?.elapsedMs, B: b?.elapsedMs, C: c?.elapsedMs },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
