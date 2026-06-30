/**
 * Node thin proxy / compatibility shell for Python-owned AgentLoop dashboard APIs.
 *
 * Purpose (105): wire dashboard panels (runs/overview, queue/overview, settings, health, provider-health, run detail)
 * to Python-first /api/agent-loop/* . Node does NOT own business semantics for these.
 * - Always delegates to PYTHON_API_TARGET (default localhost:9700) or env.
 * - Errors and degraded states from Python are forwarded verbatim (no silent Node success wrap).
 * - Explicit retained boundary only if Python unavailable would be documented here; current is Python baseline.
 * - Public compat preserved via this bridge.
 */

import { Router, type Request, type Response } from "express";

const DEFAULT_PYTHON_BASE = "http://localhost:9700";
const AGENT_LOOP_PREFIX = "/api/agent-loop";

function getPythonBase(): string {
  return (process.env.PYTHON_API_TARGET || process.env.AGENT_LOOP_API_TARGET || DEFAULT_PYTHON_BASE).replace(/\/+$/, "");
}

async function proxyFetch(req: Request, res: Response, subpath: string, init?: RequestInit) {
  const base = getPythonBase();
  const url = `${base}${AGENT_LOOP_PREFIX}${subpath}`;
  // Support test override without clobbering global.fetch used by outer test http calls
  const doFetch: typeof fetch = (globalThis as any).__TEST_FETCH_OVERRIDE || fetch;
  try {
    const method = (init?.method || req.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    // forward select headers but drop host
    if (req.headers["accept"]) headers.accept = String(req.headers["accept"]);
    const body = method !== "GET" && method !== "HEAD" ? JSON.stringify(req.body || {}) : undefined;
    const r = await doFetch(url, {
      method,
      headers,
      body,
      ...(init || {}),
    });
    const text = await r.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    // forward status + body; degraded/fail visible
    res.status(r.status).json(json);
  } catch (err: any) {
    // surface Python failure, do not wrap as Node success
    res.status(502).json({
      ok: false,
      error: "python-agent-loop-proxy-failed",
      detail: String(err?.message || err),
      pythonBase: getPythonBase(),
      path: subpath,
    });
  }
}

export function createAgentLoopPythonProxyRouter() {
  const router = Router();

  // Health & provenance
  router.get("/health", (req, res) => proxyFetch(req, res, "/health"));
  router.get("/capabilities", (req, res) => proxyFetch(req, res, "/capabilities"));
  router.get("/provider-health", (req, res) => proxyFetch(req, res, "/provider-health"));

  // Runs / queue overview for dashboard panels
  router.get("/runs/overview", (req, res) => proxyFetch(req, res, "/runs/overview"));
  router.get("/queue/overview", (req, res) => proxyFetch(req, res, "/queue/overview"));
  router.get("/runs", (req, res) => proxyFetch(req, res, "/runs"));

  // Run detail
  router.get("/runs/:runId", (req, res) => proxyFetch(req, res, `/runs/${encodeURIComponent(req.params.runId)}`));
  router.get("/runs/:runId/snapshot", (req, res) => proxyFetch(req, res, `/runs/${encodeURIComponent(req.params.runId)}/snapshot`));
  router.get("/runs/:runId/events", (req, res) => proxyFetch(req, res, `/runs/${encodeURIComponent(req.params.runId)}/events`));
  router.get("/runs/:runId/events/stream", (req, res) => proxyFetch(req, res, `/runs/${encodeURIComponent(req.params.runId)}/events/stream`));
  router.get("/runs/:runId/events/stream/v2", (req, res) => proxyFetch(req, res, `/runs/${encodeURIComponent(req.params.runId)}/events/stream/v2`));
  router.get("/runs/:runId/artifacts/:name", (req, res) => proxyFetch(req, res, `/runs/${encodeURIComponent(req.params.runId)}/artifacts/${encodeURIComponent(req.params.name)}`));

  // Settings
  router.get("/settings", (req, res) => proxyFetch(req, res, "/settings"));
  router.post("/settings", (req, res) => proxyFetch(req, res, "/settings", { method: "POST" }));

  // Control (queue/task/cancel) - thin proxy, execution bridged in Python
  router.post("/queue/run", (req, res) => proxyFetch(req, res, "/queue/run", { method: "POST" }));
  router.post("/task/run", (req, res) => proxyFetch(req, res, "/task/run", { method: "POST" }));
  router.post("/rerun", (req, res) => proxyFetch(req, res, "/rerun", { method: "POST" }));
  router.post("/cancel", (req, res) => proxyFetch(req, res, "/cancel", { method: "POST" }));

  return router;
}

// default export for easy import in tests / mount
export default createAgentLoopPythonProxyRouter;
