#!/usr/bin/env node
/**
 * A2A API smoke proving A2A uses Python backend (task 51).
 *
 * Proves the A2A API paths use Python backend by:
 * - Mounting the actual Node thin shell router from server/routes/a2a.ts (via tsx for .ts)
 * - Making real HTTP requests to /api/a2a/agents, /sessions, /analytics, /analytics/inc, /chat, /report
 * - Asserting success responses carry explicit Python provenance signals (source: "python-a2a-registry", "python-a2a-analytics", "python-a2a-chat-projection" etc.)
 *
 * This exercises the thin proxy handlers (not direct python import), so HTTP/API path + route code is proven.
 * No browser needed (per task 49: 0 frontend callsites to /api/a2a/*).
 *
 * Run (smallest):
 *   node scripts/a2a-api-smoke-python-only-105.mjs
 *
 * (Internally uses `pnpm --package tsx dlx tsx` to load the TS route for HTTP mount; works in pnpm envs even without pre-populated node_modules.)
 *
 * Exit 0 if Python source proven via the A2A API thin shell; non-zero otherwise.
 * Degraded states remain visible (no silent Node path in this smoke).
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const isWin = process.platform === "win32";

async function main() {
  console.log("[a2a-api-smoke-python-only-105] starting A2A API HTTP smoke (via thin shell route)");
  // Use pnpm dlx to obtain tsx on-demand (works even if no local node_modules/.bin materialized in worktree).
  // This keeps the smoke runnable via plain `node scripts/...` and still loads the real .ts route.
  const tsxCmdPrefix = "pnpm --package tsx dlx tsx";

  const tmpDir = "slide-rule-python/tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpMts = path.join(tmpDir, `a2a_route_smoke_${Date.now()}_${Math.random().toString(36).slice(2)}.mts`);

  // The verifier mounts the *actual* router from server/routes/a2a.ts and hits the HTTP paths.
  // This ensures the smoke goes through the Node thin shell handlers (callPython* bridges) and proves python source on API responses.
  const verifierSrc = `
import express from "express";
import a2aRouter from "../../server/routes/a2a.ts";

const app = express();
app.use(express.json());
app.use("/api/a2a", a2aRouter);

const server = app.listen(0, "127.0.0.1", async () => {
  const addr: any = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const base = "http://127.0.0.1:" + port + "/api/a2a";
  const results: any = {};
  let failed = false;

  function hasPySignal(o: any, tag?: string) {
    if (!o || typeof o !== "object") return false;
    const s = JSON.stringify(o).toLowerCase();
    const ok = s.includes("python-a2a") || s.includes("python-contract") || (o.source && String(o.source).startsWith("python-a2a"));
    if (tag && o.source && !String(o.source).includes(tag)) return false;
    return ok;
  }

  try {
    // 1. GET /agents (success path now carries source per task 51 hardening)
    const aRes = await fetch(base + "/agents");
    const aJson = await aRes.json();
    results.agents = aJson;
    if (aRes.status !== 200 || aJson.source !== "python-a2a-registry" || !Array.isArray(aJson.agents)) {
      console.error("[verifier] /agents missing python source or shape", aJson);
      failed = true;
    } else {
      console.log("[verifier] /agents source:", aJson.source, "len=", (aJson.agents || []).length);
    }

    // 2. GET /sessions
    const sRes = await fetch(base + "/sessions");
    const sJson = await sRes.json();
    results.sessions = sJson;
    if (sRes.status !== 200 || sJson.source !== "python-a2a-registry" || !Array.isArray(sJson.sessions)) {
      console.error("[verifier] /sessions missing python source or shape", sJson);
      failed = true;
    } else {
      console.log("[verifier] /sessions source:", sJson.source, "len=", (sJson.sessions || []).length);
    }

    // 3. GET /analytics (no auth; python source)
    const anRes = await fetch(base + "/analytics");
    const anJson = await anRes.json();
    results.analytics = anJson;
    if (anRes.status !== 200 || anJson.source !== "python-a2a-analytics") {
      console.error("[verifier] /analytics missing python source", anJson);
      failed = true;
    } else {
      console.log("[verifier] /analytics source:", anJson.source);
    }

    // 4. POST /analytics/inc (no auth)
    const incRes = await fetch(base + "/analytics/inc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a2a.smoke.http", delta: 1 }),
    });
    const incJson = await incRes.json();
    results.inc = incJson;
    if (incRes.status !== 200 || incJson.source !== "python-a2a-analytics") {
      console.error("[verifier] /analytics/inc missing python source", incJson);
      failed = true;
    } else {
      console.log("[verifier] /analytics/inc source:", incJson.source);
    }

    // 5. POST /chat (requires auth presence only)
    const chatRes = await fetch(base + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer smoke-token" },
      body: JSON.stringify({ sessionId: "a2a-smoke-http", role: "user", content: "hello via http smoke" }),
    });
    const chatJson = await chatRes.json();
    results.chat = chatJson;
    if (chatRes.status !== 200 || chatJson.source !== "python-a2a-chat-projection") {
      console.error("[verifier] /chat missing python source", chatJson);
      failed = true;
    } else {
      console.log("[verifier] /chat source:", chatJson.source);
    }

    // 6. POST /report (auth)
    const repRes = await fetch(base + "/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer smoke-token" },
      body: JSON.stringify({ sessionId: "a2a-smoke-http", kind: "summary" }),
    });
    const repJson = await repRes.json();
    results.report = repJson;
    if (repRes.status !== 200 || repJson.source !== "python-a2a-report-projection") {
      console.error("[verifier] /report missing python source", repJson);
      failed = true;
    } else {
      console.log("[verifier] /report source:", repJson.source);
    }

    if (failed) {
      console.error("[verifier] FAIL: one or more A2A API responses lacked python provenance");
      process.exit(1);
    }
    console.log("[verifier] ALL A2A HTTP API paths returned python-a2a-* provenance");
    process.exit(0);
  } catch (e) {
    console.error("[verifier] ERROR during HTTP smoke:", e && e.message || e);
    process.exit(1);
  } finally {
    server.close();
  }
});

server.on("error", (e) => {
  console.error("[verifier] server error", e);
  process.exit(1);
});
`.trim();

  fs.writeFileSync(tmpMts, verifierSrc, "utf8");
  console.log("[a2a-api-smoke-python-only-105] wrote verifier to", tmpMts);

  let exitCode = 0;
  try {
    const out = execSync(`${tsxCmdPrefix} "${tmpMts}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
    console.log(out.trim());
  } catch (e) {
    exitCode = (typeof e.status === 'number') ? e.status : 1;
    if (e.stdout) console.log(String(e.stdout).trim());
    if (e.stderr) console.error(String(e.stderr).trim());
  } finally {
    try { fs.unlinkSync(tmpMts); } catch {}
  }

  if (exitCode !== 0) {
    console.error("[a2a-api-smoke-python-only-105] FAIL: A2A API smoke via route did not pass");
    process.exit(1);
  }
  console.log("[a2a-api-smoke-python-only-105] ALL CHECKS PASSED - A2A API paths use Python backend (proven via thin shell HTTP responses)");
  console.log("[a2a-api-smoke-python-only-105] observed sources: python-a2a-registry, python-a2a-analytics, python-a2a-*-projection");
}

main().catch((e) => {
  console.error("[a2a-api-smoke-python-only-105] ERROR:", e && e.message || e);
  process.exit(1);
});
