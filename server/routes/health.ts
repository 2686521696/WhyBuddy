/**
 * Thin PYTHON_FIRST_COMPAT proxy for unified /api/health (and readiness).
 * Python (slide-rule-python /api/health) is the backend API source of truth.
 * Node server/index.ts health route is explicit thin compatibility shell only:
 *   - forwards Python response (incl. source/backend/provenance/readiness)
 *   - surfaces explicit degraded/502 on Python failure (no silent Node success, no fake features dict)
 * Supports __TEST_FETCH_OVERRIDE for deterministic Vitest coverage (same pattern as agent-loop proxy).
 */
import type { Request, Response } from "express";
import express from "express";

const DEFAULT_PYTHON_BASE = "http://localhost:9700";

export function createHealthProxyHandler() {
  return async (req: Request, res: Response) => {
    const base = (process.env.PYTHON_API_TARGET || process.env.AGENT_LOOP_API_TARGET || DEFAULT_PYTHON_BASE).replace(/\/+$/, "");
    const doFetch: typeof fetch = (globalThis as any).__TEST_FETCH_OVERRIDE || fetch;
    try {
      const r = await doFetch(`${base}/api/health`, { method: "GET" });
      const text = await r.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      res.status(r.status).json(json);
    } catch (err: any) {
      // Do not hide Python errors; degraded visible (per rules)
      res.status(502).json({
        status: "degraded",
        error: "python-health-proxy-failed",
        detail: String(err?.message || err),
        pythonBase: base,
        note: "Node is thin compat shell only; Python is backend health source."
      });
    }
  };
}

export function attachHealthProxy(app: express.Express) {
  const handler = createHealthProxyHandler();
  app.get("/api/health", handler);
}
