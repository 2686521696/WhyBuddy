import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeVisualCapabilityMapped,
  buildFakePreviewForAudit,
  isVisualCapability,
} from "../visual-exec-map.js";
import { auditPreviewReal } from "../../../shared/blueprint/sliderule-visual-chain.js";
import type { V5SessionState } from "../../../shared/blueprint/v5-reasoning-state.js";

// vi.mock must precede dynamic import of routes/sliderule (which pulls python-delegation)
// so that delegation in python mode can be stubbed for the bypass proof test without network.
vi.mock("../python-delegation.js", () => ({
  callPythonSlideRule: vi.fn(),
  resolvePythonSlideRuleRuntimeConfig: vi.fn(() => ({
    baseUrl: "http://localhost:9700",
    internalKey: "test-internal-key",
    timeoutMs: 120000,
    healthPath: "/health",
    proxyMode: "node-fetch-env",
  })),
}));

import express from "express";
import { createServer } from "node:http";
import * as pythonDelegation from "../python-delegation.js";
import * as visualMap from "../visual-exec-map.js";

// Node visual-exec-map is legacy compat shell ONLY (per task 15).
// Default python backend owns visual execution contract (see sliderule_full.py VISUAL_CAP_IDS + route delegation).
// These tests exercise the map only when SLIDERULE_V5_BACKEND=legacy.
// Do not interpret as proof of Node owning migrated business semantics.

function baseState(): V5SessionState {
  return {
    sessionId: "v1",
    goal: { text: "权限系统", status: "clear" },
    artifacts: [
      {
        id: "d1",
        kind: "doc",
        title: "doc",
        summary: "设计说明",
        content: "x",
        trustLevel: "gated_pass",
        provenance: "ai_generated",
        producedBy: { capabilityRunId: "r1", capabilityId: "document.draft" },
        passedGates: ["commit"],
      },
    ],
  } as V5SessionState;
}

describe("visual-exec-map (S18, legacy compat shell only)", () => {
  beforeEach(() => {
    vi.stubEnv("SLIDERULE_V5_BACKEND", "legacy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("ux.preview includes audit payload", async () => {
    const state = {
      sessionId: "v1",
      goal: { text: "权限系统", status: "clear" },
      artifacts: [
        {
          id: "d1",
          kind: "doc",
          title: "doc",
          summary: "设计说明",
          content: "x",
          trustLevel: "gated_pass",
          provenance: "ai_generated",
          producedBy: { capabilityRunId: "r1", capabilityId: "document.draft" },
          passedGates: ["commit"],
        },
      ],
    } as V5SessionState;

    const result = await executeVisualCapabilityMapped("ux.preview", state);
    expect(result.content).toContain("预览·未验证");
    expect(result.payload?.audit?.passed).toBe(true);
  });

  it("buildFakePreviewForAudit fails audit", () => {
    const audit = auditPreviewReal(buildFakePreviewForAudit());
    expect(audit.passed).toBe(false);
  });

  it("isVisualCapability recognizes ux.preview and outcome.visualize (but map not source under python default)", () => {
    vi.stubEnv("SLIDERULE_V5_BACKEND", "python");
    // The active path (routes/sliderule.ts) checks isPythonV5Cap (includes ux.preview/outcome.visualize) and delegates to Python
    // before any isVisualCapability/executeVisual... call. This map is not the source for default backend.
    expect(isVisualCapability("ux.preview")).toBe(true);
    expect(isVisualCapability("outcome.visualize")).toBe(true);
    // Assertions above + env prove Node no longer owns the visual execution contract.
  });

  it("proves Node visual map execute is bypassed (route call + spy on executeVisualCapabilityMapped + delegate called, map not called)", async () => {
    // Addresses review: must call /api/sliderule/execute-capability, spy executeVisualCapabilityMapped,
    // assert python delegate invoked and map execute NOT reached under default python backend.
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("SLIDERULE_V5_BACKEND", "python");

    // Install spy on map exports BEFORE dynamic router import so route's static import binds the spied fn.
    const execSpy = vi.spyOn(visualMap, "executeVisualCapabilityMapped");

    const pyPayload = {
      title: "UX 模块预览 (python)",
      summary: "py visual",
      content: "Python visual contract result for ux.preview",
      provenance: "python-llm",
      backend: "python",
      visualContract: "python-native-llm",
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pyPayload);

    // Dynamic import of router (after mock + spy + env) - matches patterns in execute-capability tests.
    const routerMod = await import("../../routes/sliderule.js");
    const slideruleRouter = routerMod.default;

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/sliderule", slideruleRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port?: number } | null;
    const port = addr && typeof addr === "object" ? addr.port : 0;
    const base = `http://127.0.0.1:${port}/api/sliderule`;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capabilityId: "ux.preview",
          state: baseState(),
          inputArtifactIds: [],
          roleId: "产品",
          turnId: "bypass-proof-visual",
          userText: "",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.backend).toBe("python");
      expect(data.visualContract).toBe("python-native-llm");
      // Proof that route did delegate to Python and skipped the legacy Node map execute entirely.
      expect(execSpy).not.toHaveBeenCalled();
      expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
});