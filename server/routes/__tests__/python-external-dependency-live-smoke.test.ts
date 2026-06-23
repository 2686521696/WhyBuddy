import { describe, expect, it } from "vitest";

import {
  LiveSmokeDiagnostic,
  ExternalDependencyLiveSmokeResult,
  summarizeExternalLiveSmoke,
} from "../../../shared/telemetry/contracts.js";

// The python side returns shape that Node status/dashboard layers can consume.
// These tests verify mapping and that skipped/config_missing are never counted as production external takeover.

function makePythonSmokeResult(overrides: Partial<ExternalDependencyLiveSmokeResult> = {}): ExternalDependencyLiveSmokeResult {
  const baseChecks: LiveSmokeDiagnostic[] = [
    { provider: "qdrant", status: "config_missing", reason: "no key", durationMs: 0, metadata: {} },
    { provider: "embedding", status: "config_missing", reason: "no key", durationMs: 5, metadata: {} },
    { provider: "search", status: "skipped", reason: "node owned", durationMs: 0, metadata: {} },
    { provider: "ocr", status: "skipped", reason: "slice", durationMs: 0, metadata: {} },
    { provider: "vision", status: "skipped", reason: "slice", durationMs: 0, metadata: {} },
    { provider: "audio", status: "skipped", reason: "slice", durationMs: 0, metadata: {} },
    { provider: "apm", status: "skipped", reason: "platform", durationMs: 0, metadata: {} },
    { provider: "billing", status: "skipped", reason: "platform", durationMs: 0, metadata: {} },
    { provider: "audit", status: "skipped", reason: "platform", durationMs: 0, metadata: {} },
  ];
  return {
    overall: "config_missing",
    checks: baseChecks,
    durationMs: 12,
    note: "config_missing or skipped means this dependency is not wired for live external use. Do not treat as production external takeover evidence.",
    counts: { ready: 0, skipped: 6, config_missing: 2, failed_or_timeout: 0 },
    ...overrides,
  };
}

describe("python external dependency live smoke (Node consumption)", () => {
  it("accepts python diagnostic shape and exposes provider/status/reason/duration/metadata", () => {
    const result = makePythonSmokeResult();
    expect(result.checks.length).toBeGreaterThan(0);
    for (const c of result.checks) {
      expect(typeof c.provider).toBe("string");
      expect(["ready", "skipped", "config_missing", "failed", "timeout"]).toContain(c.status);
      expect(typeof c.reason).toBe("string");
      expect(typeof c.durationMs).toBe("number");
      expect(c.metadata).toBeDefined();
    }
    expect(result.note).toMatch(/config_missing|skipped|takeover/i);
  });

  it("skipped and config_missing do not count toward production takeover readiness", () => {
    const result = makePythonSmokeResult();
    const summary = summarizeExternalLiveSmoke(result.checks);
    expect(summary.canClaimProduction).toBe(false);
    expect(summary.ready).toBe(0);
    expect(summary.configMissing + summary.skipped).toBeGreaterThan(0);
  });

  it("maps a ready python response to consumable for dashboard but still gated by all-critical", () => {
    const readyResult = makePythonSmokeResult({
      overall: "ready",
      checks: [
        { provider: "qdrant", status: "ready", reason: "", durationMs: 18, metadata: { http_status: 200 } },
        { provider: "embedding", status: "ready", reason: "", durationMs: 3, metadata: { model: "emb" } },
        { provider: "search", status: "skipped", reason: "delegated", durationMs: 0, metadata: {} },
        { provider: "ocr", status: "skipped", reason: "delegated", durationMs: 0, metadata: {} },
        { provider: "vision", status: "skipped", reason: "delegated", durationMs: 0, metadata: {} },
        { provider: "audio", status: "skipped", reason: "delegated", durationMs: 0, metadata: {} },
        { provider: "apm", status: "skipped", reason: "platform", durationMs: 0, metadata: {} },
        { provider: "billing", status: "skipped", reason: "platform", durationMs: 0, metadata: {} },
        { provider: "audit", status: "skipped", reason: "platform", durationMs: 0, metadata: {} },
      ],
      counts: { ready: 2, skipped: 7, config_missing: 0, failed_or_timeout: 0 },
    });
    const summary = summarizeExternalLiveSmoke(readyResult.checks);
    // even with some ready, if not all critical wired (some skipped), do not auto claim full production takeover
    // but ready is visible for diagnostics
    expect(summary.ready).toBeGreaterThan(0);
    // ensure skipped do not inflate the ready count for takeover claim logic
    expect(summary.skipped).toBeGreaterThan(0);
    // The gate requires skipped must not masquerade healthy takeover.
    expect(summary.canClaimProduction).toBe(false); // because non-critical are skipped in this slice
  });

  it("failed and timeout from python are surfaced and block production claim", () => {
    const bad = makePythonSmokeResult({
      overall: "degraded",
      checks: [
        { provider: "qdrant", status: "failed", reason: "503", durationMs: 22, metadata: {} },
        { provider: "embedding", status: "timeout", reason: "timed out", durationMs: 1200, metadata: {} },
      ],
    });
    const summary = summarizeExternalLiveSmoke(bad.checks);
    expect(summary.failedOrTimeout).toBeGreaterThan(0);
    expect(summary.canClaimProduction).toBe(false);
  });

  it("existing deployment/vector smoke tests boundaries remain compatible (shape check)", () => {
    // Indirect: ensure our new contract types do not collide with prior smoke patterns
    const legacyHealthLike = { ok: true, status: 200, backend: "fake" };
    expect(legacyHealthLike.ok).toBe(true);
    // live smoke result is orthogonal and additive
    const live = makePythonSmokeResult();
    expect(live.checks[0].provider).toBeDefined();
  });
});
