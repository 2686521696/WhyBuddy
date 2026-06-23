import { describe, expect, it, vi } from "vitest";

import { mirrorWebAigcRuntimeEvent, recordWebAigcProviderReadiness } from "../core/web-aigc-runtime-observability.js";
import { consumeWebAigcRealProviderReadinessMatrix } from "../core/web-aigc-runtime-extra-adapters.js";
import { summarizeWebAigcProviderReadiness } from "../../shared/telemetry/contracts.js";

const SAMPLE_READINESS_MATRIX = {
  contractVersion: "web_aigc.real_provider_readiness.v1",
  provenance: "python-web-aigc-real-provider-readiness",
  ok: false, // due to skipped-lives
  total: 10,
  counts: {
    ready: 4,
    skippedLive: 3,
    blocked: 1,
    degraded: 1,
    unsupported: 1,
  },
  providers: {
    web_search: { kind: "web_search", status: "skipped-live", category: "search", reason: "requires real external provider key; synthetic only", backend: "python", externalCalls: false, synthetic: false },
    file_generation: { kind: "file_generation", status: "ready", category: "file", reason: "synthetic python runtime", backend: "python", externalCalls: false, synthetic: true },
    vision_analysis: { kind: "vision_analysis", status: "skipped-live", category: "vision", reason: "requires real external", backend: "python", externalCalls: false, synthetic: false },
    ai_ppt_outline: { kind: "ai_ppt_outline", status: "ready", category: "ai_ppt", reason: "synthetic", backend: "python", externalCalls: false, synthetic: true },
    dynamic_chart: { kind: "dynamic_chart", status: "ready", category: "chart", reason: "synthetic", backend: "python", externalCalls: false, synthetic: true },
    transaction_flow: { kind: "transaction_flow", status: "ready", category: "transaction", reason: "synthetic", backend: "python", externalCalls: false, synthetic: true },
    ocr_recognition: { kind: "ocr_recognition", status: "skipped-live", category: "ocr", reason: "skipped-live", backend: "python", externalCalls: false, synthetic: false },
    graph_search: { kind: "graph_search", status: "blocked", category: "search", reason: "explicitly blocked for real provider", backend: "python", externalCalls: false, synthetic: false },
    audio_recognition: { kind: "audio_recognition", status: "degraded", category: "audio", reason: "degraded synthetic path", backend: "python", externalCalls: false, synthetic: false },
    static_webpage_read: { kind: "static_webpage_read", status: "unsupported", category: "search", reason: "not implemented in this slice", backend: "python", externalCalls: false, synthetic: false },
  },
  matrix: {
    search: ["web_search"],
    file: ["file_generation"],
    vision: ["vision_analysis"],
    audio: [],
    ocr: ["ocr_recognition"],
    static: [],
    ai_ppt: ["ai_ppt_outline"],
    chart: ["dynamic_chart"],
    transaction: ["transaction_flow"],
  },
  runtime: { owner: "python", mode: "real_provider_readiness", externalCalls: false },
  note: "skipped-live and synthetic entries MUST NOT be treated as real production provider takeover.",
};

describe("web AIGC real provider readiness 101 - node consumption and observability", () => {
  it("node test can consume python readiness matrix and distinguish skipped-live", () => {
    const matrix = SAMPLE_READINESS_MATRIX;
    expect(matrix.contractVersion).toBe("web_aigc.real_provider_readiness.v1");
    expect(matrix.counts.skippedLive).toBeGreaterThan(0);
    expect(matrix.counts.ready).toBeGreaterThan(0);
    // skipped-live must not be ready
    expect(matrix.providers.web_search.status).toBe("skipped-live");
    expect(matrix.providers.web_search.status).not.toBe("ready");
    expect(matrix.providers.file_generation.status).toBe("ready");
    // note prevents over-claiming
    expect(matrix.note).toContain("skipped-live");
    expect(matrix.note).toContain("MUST NOT");

    // actual consumption via Node bridge and record (review fix)
    const viaConsume = consumeWebAigcRealProviderReadinessMatrix(matrix);
    const viaRecord = recordWebAigcProviderReadiness(matrix);
    expect(viaConsume.skippedLive).toBeGreaterThan(0);
    expect(viaRecord.ready).toBeGreaterThan(0);
    // bridge returns full classification
    expect(viaConsume).toHaveProperty("blocked");
    expect(viaConsume).toHaveProperty("degraded");
    expect(viaConsume).toHaveProperty("unsupported");
    expect(viaRecord.blocked).toBeGreaterThan(0);
    expect(viaRecord.degraded).toBeGreaterThan(0);
    expect(viaRecord.unsupported).toBeGreaterThan(0);
  });

  it("readiness matrix can be forwarded into observability without claiming real takeover", () => {
    // simulate the matrix being passed to runtime/obs
    const readinessForObs = {
      ...SAMPLE_READINESS_MATRIX,
      providers: { ...SAMPLE_READINESS_MATRIX.providers },
    };
    // mirror event just to ensure no crash when observability touched
    const fakeEvent = {
      type: "web_aigc_runtime_event",
      eventKey: "node.completed",
      workflowId: "wf-101",
      instanceId: "inst-101",
      nodeId: "readiness-probe",
      status: "success",
      metadata: { providerReadiness: readinessForObs },
    } as any;
    // should not throw
    mirrorWebAigcRuntimeEvent(fakeEvent);

    // explicit: skipped live entries are distinct
    const skipped = Object.values(readinessForObs.providers).filter((p: any) => p.status === "skipped-live");
    expect(skipped.length).toBeGreaterThan(0);
    const readies = Object.values(readinessForObs.providers).filter((p: any) => p.status === "ready");
    expect(readies.length).toBeGreaterThan(0);
    // never treat skipped as ready
    for (const s of skipped) {
      expect((s as any).status).not.toBe("ready");
    }

    // record into observability and prove matrix consumed, skipped not real takeover
    const recorded = recordWebAigcProviderReadiness(readinessForObs);
    expect(recorded.skippedLive).toBeGreaterThan(0);
    expect(recorded.canClaimRealExternal).toBe(false);
    // full distinction from bridge/obs
    expect(typeof recorded.blocked).toBe("number");
    expect(typeof recorded.degraded).toBe("number");
    expect(typeof recorded.unsupported).toBe("number");
  });

  it("readiness counts confirm skipped-live separate from ready (no real takeover)", () => {
    const { counts } = SAMPLE_READINESS_MATRIX;
    expect(counts.skippedLive).toBeGreaterThan(0);
    expect(counts.ready).toBeGreaterThan(0);
    // canClaimReal would require zero skipped etc, but we don't compute here; just shape
    expect(counts.blocked + counts.degraded + counts.unsupported).toBeGreaterThan(0);

    // call summarize (used by record/bridge) directly and assert canClaim=false
    const summary = summarizeWebAigcProviderReadiness(SAMPLE_READINESS_MATRIX.providers);
    expect(summary.ready).toBeGreaterThan(0);
    expect(summary.skippedLive).toBeGreaterThan(0);
    expect(summary.canClaimRealExternal).toBe(false);
    expect(summary.blocked + summary.degraded + summary.unsupported).toBeGreaterThan(0);
  });

  it("all-synthetic ready matrix (no skipped etc) must never claim real external takeover", () => {
    // explicit case from review: fully ready synthetic matrix from python readiness (externalCalls:false, synthetic:true)
    const syntheticReadyProviders = {
      file_generation: {
        kind: "file_generation",
        status: "ready" as const,
        category: "file",
        reason: "synthetic python runtime",
        backend: "python" as const,
        externalCalls: false as const,
        synthetic: true,
      },
      ai_ppt_outline: {
        kind: "ai_ppt_outline",
        status: "ready" as const,
        category: "ai_ppt",
        reason: "synthetic",
        backend: "python" as const,
        externalCalls: false as const,
        synthetic: true,
      },
      dynamic_chart: {
        kind: "dynamic_chart",
        status: "ready" as const,
        category: "chart",
        reason: "synthetic",
        backend: "python" as const,
        externalCalls: false as const,
        synthetic: true,
      },
      transaction_flow: {
        kind: "transaction_flow",
        status: "ready" as const,
        category: "transaction",
        reason: "synthetic",
        backend: "python" as const,
        externalCalls: false as const,
        synthetic: true,
      },
    };
    const s = summarizeWebAigcProviderReadiness(syntheticReadyProviders);
    expect(s.ready).toBe(4);
    expect(s.skippedLive).toBe(0);
    expect(s.blocked).toBe(0);
    expect(s.degraded).toBe(0);
    expect(s.unsupported).toBe(0);
    // critical: must not claim real external even when counts would have allowed before the fix
    expect(s.canClaimRealExternal).toBe(false);
  });
});
