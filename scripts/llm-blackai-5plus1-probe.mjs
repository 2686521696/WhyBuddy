/**
 * Direct probe for the current 5+1 LLM architecture (blackaicoding).
 * - Primary high: LLM_* → gpt-5.5 (reasoning high)
 * - Low pool: BLUEPRINT_SPEC_DOCS_LLM_POOL_* → 5 keys (test001..test005) + gpt-5.4
 *
 * This bypasses all SlideRule / llm-client / pool wrapper logic.
 * It does raw fetch to /chat/completions exactly like the pool transport
 * and (mostly) like llm-client when NO_PROXY exempted.
 *
 * Recommended:
 *   - Close VPN / Clash (or at least ensure 7890 is not intercepting)
 *   - node scripts/llm-blackai-5plus1-probe.mjs
 *
 * To simulate exactly what dev:all child processes see:
 *   node scripts/llm-blackai-5plus1-probe.mjs --devall
 *
 * Flags:
 *   --devall     Inject HTTP_PROXY=127.0.0.1:7890 + NO_PROXY from .env + NODE_USE_ENV_PROXY=1
 *   --direct     Force clean direct (unset proxy vars) — default
 *   --timeout=MS (default 120000)
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
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    // strip trailing inline comments for a few known keys (e.g. "false   # comment")
    if (key === "LLM_STREAM" || key.endsWith("_ENABLED") || key === "LLM_MODEL_FALLBACKS") {
      val = val.split(/\s+#/)[0].trim();
    }
    env[key] = val;
  }
  return env;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const devall = args.includes("--devall");
  const direct = args.includes("--direct");
  const timeoutArg = args.find(a => a.startsWith("--timeout="));
  const timeoutMs = timeoutArg ? Number(timeoutArg.split("=")[1]) : 120_000;
  return { devall, direct, timeoutMs };
}

function maskKey(k) {
  if (!k) return "(missing)";
  if (k.length <= 12) return "****";
  return "****" + k.slice(-8);
}

/**
 * Try several payload shapes that commonly differ between raw Node fetch
 * and what VSCode editor extensions (Continue, Cline, etc.) send.
 */
async function tryVariant({ label, baseUrl, apiKey, model, reasoningEffort, variant, timeoutMs }) {
  const base = baseUrl.replace(/\/$/, "");
  const isResponses = variant === "responses";
  const url = isResponses ? `${base}/responses` : `${base}/chat/completions`;
  const started = performance.now();

  let body;
  if (isResponses) {
    // Shape used in llm-client createResponse when wireApi=responses
    body = {
      model,
      input: [{ role: "user", content: "Reply with the single word: PONG" }],
      max_output_tokens: 32,
      stream: false,
      store: false,
    };
    if (reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
    }
  } else if (variant === "chat-root-reasoning") {
    // Most common "works in VSCode" shape for reasoning-flavored OpenAI compat
    body = {
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Reply with the single word: PONG" },
      ],
      temperature: 0.3,
      max_tokens: 16000,
      stream: false,
      reasoning_effort: reasoningEffort || "high",
    };
  } else if (variant === "chat-nested-reasoning") {
    body = {
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Reply with the single word: PONG" },
      ],
      temperature: 0.3,
      max_tokens: 16000,
      stream: false,
    };
    if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
  } else if (variant === "chat-pool-like") {
    // Exact shape used by the SlideRule pool (llm-key-pool.ts callLlmWithPoolKey)
    body = {
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Reply with the single word: PONG" },
      ],
      temperature: 0.3,
      max_tokens: 16000,
    };
  } else if (variant === "chat-no-temp") {
    body = {
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Reply with the single word: PONG" },
      ],
      max_tokens: 16000,
      stream: false,
    };
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
  } else {
    // chat-minimal (original probe + what many simple scripts do)
    body = {
      model,
      messages: [{ role: "user", content: "Reply with the single word: PONG" }],
      max_tokens: 16,
      temperature: 0,
      stream: false,
    };
  }

  const meta = {
    label,
    model,
    baseUrl: base,
    keyPreview: maskKey(apiKey),
    variant,
    endpoint: isResponses ? "/responses" : "/chat/completions",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await res.text();
    const elapsed = Math.round(performance.now() - started);

    let contentPreview = null;
    let parseError = null;
    if (raw.trim()) {
      try {
        const json = JSON.parse(raw);
        // Try both chat/completions and responses shapes
        const c =
          json?.choices?.[0]?.message?.content ||
          json?.output?.[0]?.content?.[0]?.text ||
          json?.content?.[0]?.text ||
          (typeof json?.output_text === "string" ? json.output_text : null);
        if (c != null) contentPreview = String(c).slice(0, 120);
      } catch (e) {
        parseError = "bad-json";
      }
    }

    return {
      ...meta,
      status: res.status,
      ok: res.ok,
      elapsedMs: elapsed,
      bodyLength: raw.length,
      bodyEmpty: !raw.trim(),
      contentPreview,
      parseError,
      error: null,
      bodySent: JSON.stringify(body).slice(0, 300), // for diagnosis only
    };
  } catch (e) {
    const elapsed = Math.round(performance.now() - started);
    return {
      ...meta,
      status: 0,
      ok: false,
      elapsedMs: elapsed,
      bodyLength: 0,
      bodyEmpty: true,
      contentPreview: null,
      parseError: null,
      error: String(e?.message || e).slice(0, 160),
      bodySent: JSON.stringify(body).slice(0, 300),
    };
  }
}

async function probeOne({ label, baseUrl, apiKey, model, reasoningEffort, timeoutMs }) {
  // Back-compat: run the old "chat-minimal" as default single shot
  return tryVariant({ label, baseUrl, apiKey, model, reasoningEffort, variant: "chat-minimal", timeoutMs });
}

async function main() {
  const env = loadEnv();
  const { devall, direct, timeoutMs } = parseArgs();

  const primaryBase = (env.LLM_BASE_URL || "").replace(/\/$/, "");
  const primaryKey = env.LLM_API_KEY || "";
  const primaryModel = env.LLM_MODEL || "gpt-5.5";
  const primaryReasoning = env.LLM_REASONING_EFFORT || "";

  const poolBase = (env.BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL || primaryBase).replace(/\/$/, "");
  const poolModel = env.BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL || "gpt-5.4";
  const poolKeys = (env.BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
  const poolLabels = (env.BLUEPRINT_SPEC_DOCS_LLM_POOL_LABELS || "").split(",").map(s => s.trim()).filter(Boolean);

  // Prepare proxy environment exactly like dev:all child
  const proxyUrl = "http://127.0.0.1:7890";
  const noProxyFromEnv = env.NO_PROXY || "blackaicoding.com,localhost,127.0.0.1,::1";

  const prevProxy = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    no_proxy: process.env.no_proxy,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY,
  };

  if (devall) {
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.NODE_USE_ENV_PROXY = "1";
    process.env.NO_PROXY = noProxyFromEnv;
    process.env.no_proxy = noProxyFromEnv;
  } else {
    // clean direct recommended by user ("VPN关闭")
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NODE_USE_ENV_PROXY;
    // still set NO_PROXY so that if something else injects proxy we are protected
    process.env.NO_PROXY = noProxyFromEnv;
    process.env.no_proxy = noProxyFromEnv;
  }

  const effective = {
    mode: devall ? "devall-simulation (proxy+NO_PROXY)" : "direct (no HTTP_PROXY)",
    HTTP_PROXY: process.env.HTTP_PROXY || null,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || null,
    NO_PROXY: process.env.NO_PROXY || null,
  };

  console.log(JSON.stringify({
    tag: "blackai-5plus1-probe.config",
    primary: { base: primaryBase, model: primaryModel, reasoning: primaryReasoning || null, key: maskKey(primaryKey) },
    pool: {
      base: poolBase,
      model: poolModel,
      count: poolKeys.length,
      labels: poolLabels,
    },
    effectiveEnv: effective,
    timeoutMs,
    node: process.version,
  }, null, 2));

  const targets = [];

  if (primaryKey && primaryBase) {
    targets.push({
      label: "high-gpt-5.5",
      baseUrl: primaryBase,
      apiKey: primaryKey,
      model: primaryModel,
      reasoningEffort: primaryReasoning || undefined,
    });
  }

  for (let i = 0; i < poolKeys.length; i++) {
    const lbl = poolLabels[i] || `pool-${i + 1}`;
    targets.push({
      label: lbl,
      baseUrl: poolBase,
      apiKey: poolKeys[i],
      model: poolModel,
      reasoningEffort: undefined,
    });
  }

  if (targets.length === 0) {
    console.error("No targets found in .env (LLM_API_KEY or BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS)");
    process.exit(1);
  }

  // Variant sweep — the key experiment to explain "works in VSCode but not here"
  const VARIANTS = [
    "chat-minimal",
    "chat-pool-like",
    "chat-root-reasoning",   // ← most likely what VSCode extensions send for gpt-5.x thinking models
    "chat-nested-reasoning",
    "chat-no-temp",
    "responses",
  ];

  const results = [];

  // For the high model (gpt-5.5), try ALL variants — this is where the VSCode difference is most visible
  const highTarget = targets.find(t => t.label === "high-gpt-5.5");
  if (highTarget) {
    console.log(JSON.stringify({ tag: "blackai.variant-sweep", for: "high-gpt-5.5", variants: VARIANTS }));
    for (const v of VARIANTS) {
      const r = await tryVariant({ ...highTarget, variant: v, timeoutMs });
      results.push(r);
      const statusStr = r.status ? `HTTP ${r.status}` : "ERR";
      const bodyStr = r.bodyEmpty ? "EMPTY-BODY" : `${r.bodyLength}b`;
      const gotContent = r.contentPreview ? `SUCCESS content~="${r.contentPreview.slice(0,40)}"` : "";
      console.log(JSON.stringify({
        tag: "blackai.variant",
        variant: v,
        status: r.status,
        bodyEmpty: r.bodyEmpty,
        bodyLen: r.bodyLength,
        content: r.contentPreview,
        elapsedMs: r.elapsedMs,
        endpoint: r.endpoint,
        note: gotContent || (r.bodyEmpty ? "empty 200 — gateway dropped it" : ""),
      }));
      if (r.contentPreview && r.contentPreview.toUpperCase().includes("PONG")) {
        console.log(JSON.stringify({ tag: "blackai.variant-winner", variant: v, label: highTarget.label, content: r.contentPreview }));
        break; // stop early once we find one that works
      }
    }
  }

  // For pool keys, at minimum try the exact pool shape + the root-reasoning shape (fast check)
  const poolTargets = targets.filter(t => t.label.startsWith("test"));
  for (const t of poolTargets.slice(0, 2)) {  // only first 2 pool keys to keep runtime reasonable
    for (const v of ["chat-pool-like", "chat-root-reasoning"]) {
      const r = await tryVariant({ ...t, variant: v, timeoutMs });
      results.push(r);
      console.log(JSON.stringify({
        tag: "blackai.variant",
        label: t.label,
        variant: v,
        status: r.status,
        bodyEmpty: r.bodyEmpty,
        bodyLen: r.bodyLength,
        content: r.contentPreview,
        elapsedMs: r.elapsedMs,
      }));
    }
  }

  // Also do the old single-shot probeOne for the remaining pool keys so we have full coverage like before
  for (const t of targets) {
    if (t.label === "high-gpt-5.5") continue;
    if (poolTargets.slice(0, 2).some(p => p.label === t.label)) continue;
    const r = await probeOne({ ...t, timeoutMs });
    results.push(r);
    const statusStr = r.status ? `HTTP ${r.status}` : "ERR";
    const bodyStr = r.bodyEmpty ? "EMPTY-BODY" : `${r.bodyLength}b`;
    console.log(JSON.stringify({
      tag: "blackai.probe",
      ...r,
      statusStr,
      bodyStr,
    }));
  }

  // Restore env
  for (const [k, v] of Object.entries(prevProxy)) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = v;
  }

  const emptyBodies = results.filter(r => r.bodyEmpty && r.status === 200);
  const successes = results.filter(r => r.ok && r.contentPreview && r.contentPreview.toUpperCase().includes("PONG"));
  const http200ButEmptyOrNoContent = results.filter(r => r.status === 200 && (!r.contentPreview || !String(r.contentPreview).trim()));

  console.log(JSON.stringify({
    tag: "blackai-5plus1-probe.summary",
    total: results.length,
    successWithPong: successes.length,
    http200EmptyBody: emptyBodies.length,
    http200ButNoUsableContent: http200ButEmptyOrNoContent.length,
    otherFailures: results.length - successes.length - emptyBodies.length,
    labelsEmptyBody: emptyBodies.map(r => r.label),
    labelsSuccess: successes.map(r => r.label),
    mode: effective.mode,
  }, null, 2));

  if (successes.length > 0) {
    console.log("\n=== VARIANT SUCCESS ===");
    console.log("At least one payload shape returned usable content from blackaicoding.");
    console.log("This explains why it works in VSCode: the editor extension is sending a body shape (probably top-level reasoning_effort + certain headers/params) that the gateway accepts.");
    console.log("Our current Primary (chat_completions path) and Pool code are sending shapes that the gateway turns into 200 + empty body.");
    console.log("Winners:", successes.map(s => `${s.label}/${s.variant || "default"}`).join(", "));
  }

  if (emptyBodies.length > 0) {
    console.log("\n=== DIAGNOSIS (current code paths) ===");
    console.log("The shapes currently emitted by llm-client.ts (createChatCompletion for wire=chat_completions) and llm-key-pool.ts (pool) are getting 200 + empty body.");
    console.log("Notably: createChatCompletion NEVER injects reasoning_effort/reasoning for the chat_completions wire (only the responses wire path does).");
    console.log("Pool always sends a fixed plain body with temperature 0.3 + system+user.");
    console.log("If 'chat-root-reasoning' or 'responses' variant succeeds in this run, the fix is to either:");
    console.log("  1. Change LLM_WIRE_API=responses in .env for the high model, or");
    console.log("  2. Teach createChatCompletion to emit top-level reasoning_effort (or the nested form) when modelReasoningEffort is set + certain model names, or");
    console.log("  3. Add provider-specific adapters for blackaicoding / gpt-5.x aliases.");
  } else if (successes.length === 0 && emptyBodies.length === 0) {
    console.log("\n=== INCONCLUSIVE ===");
  }

  const hasAnyEmpty = emptyBodies.length > 0;
  process.exit(hasAnyEmpty ? 2 : (successes.length === results.length ? 0 : 1));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
