import { describe, expect, it } from "vitest";

import {
  PYTHON_OBSERVABILITY_ROLLUP_CONTRACT_VERSION,
  isPythonObservabilityRollup,
} from "../../../shared/telemetry/contracts.js";

function buildRollup(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: PYTHON_OBSERVABILITY_ROLLUP_CONTRACT_VERSION,
    runtime: "python-observability-rollup",
    status: "degraded",
    generatedAt: "2026-06-20T00:00:00.000Z",
    provenance: {
      source: "node-route-contract",
      synthetic: true,
      externalMonitoringRequest: false,
      externalSink: false,
    },
    health: {
      status: "degraded",
      runtimeReachable: true,
      checkedAt: "2026-06-20T00:00:00.000Z",
      detail: "telemetry error envelope observed",
    },
    telemetry: {
      state: "present",
      totalCalls: 2,
      errorCount: 1,
      eventCount: 0,
      latencyMs: { average: 24, p95: 48 },
      tokens: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        source: "synthetic",
      },
      updatedAt: 1710000000000,
    },
    cost: {
      state: "present",
      amountUsd: 0.0015,
      estimatedUsd: 0.0015,
      actualUsd: null,
      source: "estimated",
      billingSource: "static_pricing_table",
      isEstimate: true,
      tokens: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        source: "estimated",
      },
    },
    error: {
      state: "present",
      count: 1,
      lastError: {
        code: "telemetry_contract_probe_failed",
        message: "Telemetry projection failed.",
        retryable: true,
      },
      envelopeStatus: "failed",
    },
    degradedReasons: ["telemetry_error_count_nonzero"],
    ...overrides,
  };
}

describe("Python observability rollup contract", () => {
  it("accepts a degraded health/error/telemetry/cost rollup without external sinks", () => {
    const rollup = buildRollup();

    expect(isPythonObservabilityRollup(rollup)).toBe(true);
    expect(rollup.status).toBe("degraded");
    expect(rollup.provenance).toMatchObject({
      externalMonitoringRequest: false,
      externalSink: false,
    });
  });

  it("preserves degraded status instead of coercing it to healthy", () => {
    const rollup = buildRollup({
      status: "degraded",
      health: {
        status: "degraded",
        runtimeReachable: true,
        checkedAt: "2026-06-20T00:00:00.000Z",
      },
      degradedReasons: ["telemetry_error_count_nonzero"],
    });

    expect(isPythonObservabilityRollup(rollup)).toBe(true);
    expect(rollup.status).toBe("degraded");
  });

  it("rejects unknown or missing metrics when the rollup claims healthy", () => {
    const unknownTelemetry = buildRollup({
      status: "healthy",
      health: {
        status: "healthy",
        runtimeReachable: true,
        checkedAt: "2026-06-20T00:00:00.000Z",
      },
      telemetry: {
        state: "unknown",
        totalCalls: null,
        errorCount: null,
        eventCount: null,
        latencyMs: null,
        tokens: null,
        updatedAt: null,
      },
      degradedReasons: [],
    });
    const missingCost = buildRollup({
      status: "healthy",
      health: {
        status: "healthy",
        runtimeReachable: true,
        checkedAt: "2026-06-20T00:00:00.000Z",
      },
      cost: {
        state: "missing",
        amountUsd: null,
        estimatedUsd: null,
        actualUsd: null,
        source: "estimated",
        billingSource: "static_pricing_table",
        isEstimate: true,
        tokens: null,
      },
      degradedReasons: [],
    });

    expect(isPythonObservabilityRollup(unknownTelemetry)).toBe(false);
    expect(isPythonObservabilityRollup(missingCost)).toBe(false);
  });

  it("rejects real external observability sink claims", () => {
    const rollup = buildRollup({
      provenance: {
        source: "node-route-contract",
        synthetic: true,
        externalMonitoringRequest: true,
        externalSink: true,
      },
    });

    expect(isPythonObservabilityRollup(rollup)).toBe(false);
  });
});
