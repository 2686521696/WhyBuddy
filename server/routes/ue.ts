/**
 * UE5 Local Streaming Runtime Routes
 *
 * Provides health check and debug mode endpoints for the UE5
 * Pixel Streaming runtime.
 *
 * Endpoints:
 *   GET  /api/ue/health  — Returns UE process status & performance metrics
 *   GET  /api/ue/debug   — Returns current debug state
 *   POST /api/ue/debug   — Toggles debug mode (body: { enabled: boolean })
 */

import { Router } from "express";

import type { UEDebugService } from "../core/ue-debug-service.js";

export interface UERouterDeps {
  debugService: UEDebugService;
}

export function createUERouter(deps: UERouterDeps): Router {
  const router = Router();
  const { debugService } = deps;

  // ── GET /health ─────────────────────────────────────────────

  router.get("/health", (_req, res) => {
    const health = debugService.getHealth();
    return res.status(200).json(health);
  });

  // ── GET /debug ──────────────────────────────────────────────

  router.get("/debug", (_req, res) => {
    const state = debugService.getDebugState();
    return res.status(200).json(state);
  });

  // ── POST /debug ─────────────────────────────────────────────

  router.post("/debug", (req, res) => {
    const { enabled } = req.body ?? {};

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        error: "Request body must include { enabled: boolean }",
      });
    }

    debugService.toggle(enabled);

    const state = debugService.getDebugState();
    return res.status(200).json(state);
  });

  return router;
}
