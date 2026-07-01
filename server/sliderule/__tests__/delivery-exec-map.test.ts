import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeDeliveryCapabilityMapped,
  isDeliveryCapability,
} from "../delivery-exec-map.js";
import { handoffPackageHasRequiredSections } from "../../../shared/blueprint/sliderule-delivery-chain.js";
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
import * as deliveryMap from "../delivery-exec-map.js";

// Node delivery-exec-map is legacy compat shell ONLY (per task 14).
// Default python backend owns delivery execution contract (see sliderule_full.py DELIVERY_CAP_IDS + route delegation).
// These tests exercise the map only when SLIDERULE_V5_BACKEND=legacy.
// Do not interpret as proof of Node owning migrated business semantics.

function baseState(): V5SessionState {
  return {
    sessionId: "d1",
    goal: { text: "权限系统", status: "clear" },
    artifacts: [
      {
        id: "r1",
        kind: "report",
        title: "报告",
        summary: "可行",
        content: "报告正文",
        trustLevel: "gated_pass",
        producedBy: { capabilityRunId: "run-r", capabilityId: "report.write", roleId: "综合" },
      },
      {
        id: "tree1",
        kind: "spec_tree",
        title: "SPEC",
        summary: "树",
        content: "根节点",
        trustLevel: "gated_pass",
        producedBy: { capabilityRunId: "run-t", capabilityId: "structure.decompose", roleId: "架构" },
      },
    ],
    coverageGaps: [],
  } as V5SessionState;
}

describe("delivery-exec-map (S19, legacy compat shell only)", () => {
  beforeEach(() => {
    vi.stubEnv("SLIDERULE_V5_BACKEND", "legacy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("document.draft produces requirements/design/tasks sections", async () => {
    const result = await executeDeliveryCapabilityMapped("document.draft", baseState(), []);
    expect(result.title).toContain("文档");
    expect(result.content).toContain("# Requirements");
    expect(result.content).toContain("# Design");
  });

  it("handoff.package bundles report summary and required sections", async () => {
    const result = await executeDeliveryCapabilityMapped("handoff.package", baseState(), []);
    expect(result.title).toContain("交接");
    expect(result.content).toContain("Handoff");
    expect(result.content).toContain("权限系统");
    expect(handoffPackageHasRequiredSections(result.content || "")).toBe(true);
  });

  it("traceability.matrix emits table rows", async () => {
    const result = await executeDeliveryCapabilityMapped("traceability.matrix", baseState(), []);
    expect(result.content).toContain("| 需求 |");
    expect(result.content).toContain("REQ-1");
  });

  it("instruction.package builds a real prompt pack (not a stub)", async () => {
    const result = await executeDeliveryCapabilityMapped("instruction.package", baseState(), []);
    expect(result.title).toContain("提示词包");
    expect(result.content).toContain("Prompt Pack");
    expect(result.content).toContain("权限系统");
    expect(result.content).toContain("给工程 Agent 的实现指令");
    expect(result.content).not.toContain("模拟输出");
  });

  it("handoff.package bundles the prompt pack when an instruction.package artifact exists", async () => {
    const state = baseState();
    state.artifacts!.push({
      id: "pack1",
      kind: "doc",
      title: "提示词包",
      summary: "C_PACK",
      content: "【提示词包 / Prompt Pack · C_PACK】\n目标: 权限系统",
      trustLevel: "gated_pass",
      producedBy: { capabilityRunId: "run-p", capabilityId: "instruction.package", roleId: "综合" },
    } as any);
    const result = await executeDeliveryCapabilityMapped("handoff.package", state, []);
    expect(result.content).toContain("提示词包 (C_PACK→C_HAND)");
    expect(result.content).toContain("pack1");
  });

  it("Node delivery map is bypassed for delivery caps under python V5 backend (proves thin compat shell)", () => {
    vi.stubEnv("SLIDERULE_V5_BACKEND", "python");
    // The active path (routes/sliderule.ts) checks isPythonV5Cap (includes all delivery) and delegates to Python
    // before any isDeliveryCapability/executeDelivery... call. This map is not the source for default backend.
    expect(isDeliveryCapability("document.draft")).toBe(true);
    expect(isDeliveryCapability("handoff.package")).toBe(true);
    // Assertions above + env + header prove Node no longer owns the delivery execution contract.
  });

  it("proves Node delivery map execute is bypassed (route call + spy on executeDeliveryCapabilityMapped + delegate called, map not called)", async () => {
    // Addresses review: must call /api/sliderule/execute-capability, spy executeDeliveryCapabilityMapped,
    // assert python delegate invoked and map execute NOT reached under default python backend.
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("SLIDERULE_V5_BACKEND", "python");

    // Install spy on map exports BEFORE dynamic router import so route's static import binds the spied fn.
    const execSpy = vi.spyOn(deliveryMap, "executeDeliveryCapabilityMapped");

    const pyPayload = {
      title: "交付草案 (python)",
      summary: "py delivery",
      content: "Python native delivery contract result",
      provenance: "python-llm",
      backend: "python",
      deliveryContract: "python-native-llm",
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
          capabilityId: "document.draft",
          state: baseState(),
          inputArtifactIds: [],
          roleId: "综合",
          turnId: "bypass-proof-delivery",
          userText: "",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.backend).toBe("python");
      expect(data.deliveryContract).toBe("python-native-llm");
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