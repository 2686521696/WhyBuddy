/**
 * WhyBuddy V5 Session Store HTTP API (skeleton / prototype).
 *
 * Provides the 4 endpoints requested for the productionization store adapter phase:
 *   GET    /api/whybuddy/sessions           -> list
 *   GET    /api/whybuddy/sessions/:sessionId -> load one
 *   PUT    /api/whybuddy/sessions/:sessionId -> save (upsert)
 *   DELETE /api/whybuddy/sessions/:sessionId -> delete
 *
 * Backed by a trivial process-local Map (no real DB, no persistence across server restarts).
 * This is intentional for the "骨架" (skeleton) step — the contract + wiring is the value.
 *
 * Later a real implementation can swap the backing store for MySQL/Redis/file/etc.
 * while keeping the exact same HTTP surface and the client HttpWhyBuddySessionStore unchanged.
 *
 * The client HttpWhyBuddySessionStore (in client/src/lib/whybuddy-http-store.ts)
 * is the matching consumer and implements the same WhyBuddySessionStore interface
 * used by the runtime (now async).
 */

import express, { Router, type Request, type Response } from "express";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";

const router = Router();

// Process-local in-memory backing store for the skeleton.
// Keyed by sessionId. Values are the full V5SessionState as persisted by the client.
const sessions = new Map<string, V5SessionState>();

// GET /api/whybuddy/sessions
// Returns { sessions: [...] } for easy consumption (also accepts raw array on client).
router.get("/sessions", (_req: Request, res: Response) => {
  const list = Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    goal: s.goal?.text || "",
    createdAt: (s as any).createdAt,
    lastActive: (s as any).lastActive,
    artifactCount: (s.artifacts || []).length,
    phase: (s as any).runtimePhase,
  }));
  res.json({ sessions: list });
});

// GET /api/whybuddy/sessions/:sessionId
router.get("/sessions/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const s = sessions.get(sid);
  if (!s) {
    return res.status(404).json({ error: "not_found", sessionId: sid });
  }
  res.json(s);
});

// PUT /api/whybuddy/sessions/:sessionId
// Body: the full V5SessionState (or a partial that we treat as the new truth for the session).
// We trust the client for the prototype phase (same as the in-memory client store did).
router.put("/sessions/:sessionId", express.json({ limit: "2mb" }), (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const body = (req.body || {}) as Partial<V5SessionState> & { sessionId?: string };

  // Force the key from the URL (defense in depth)
  const state: V5SessionState = {
    ...(body as V5SessionState),
    sessionId: sid,
  };

  // Stamp lastActive for list views (client also does this, server does it too for purity)
  (state as any).lastActive = new Date().toISOString();
  if (!(state as any).createdAt) {
    const existing = sessions.get(sid);
    (state as any).createdAt = (existing as any)?.createdAt || (state as any).lastActive;
  }

  sessions.set(sid, state);
  res.status(200).json(state);
});

// DELETE /api/whybuddy/sessions/:sessionId
router.delete("/sessions/:sessionId", (req: Request, res: Response) => {
  const sid = req.params.sessionId;
  const existed = sessions.delete(sid);
  // 204 No Content is conventional for successful DELETE even if it didn't exist
  res.status(204).end();
});

// (Optional nicety) allow a manual clear for dev / tests against the real server
// Not part of the official 4-endpoint contract.
router.post("/sessions/__clear", (_req: Request, res: Response) => {
  sessions.clear();
  res.status(204).end();
});

export default router;
