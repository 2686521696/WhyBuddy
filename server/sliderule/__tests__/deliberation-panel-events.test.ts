import { describe, it, expect } from "vitest";
import { buildPanelEvents } from "../deliberation-exec-map.js";
import { buildCapabilityLlmFallback } from "../capability-llm-fallback.js";
import { FORBIDDEN_INTERNAL_TOKENS } from "../../../shared/blueprint/sliderule-reasoning-events.js";

/**
 * V5.3 P2.1 确定性单测:多角色面板 → ReasoningEvent 塑形(不打真实 LLM)。
 * 替代此前 route 层 live-LLM 测试,稳定验证 emit 契约。
 */
describe("buildPanelEvents (V5.3 P2.1 panel emit shaping)", () => {
  it("shapes positions/critiques/convergence into role_position + role_critique + panel_converge", () => {
    const events = buildPanelEvents({
      turnId: "t1",
      capabilityRunId: "t1-run-critique.generate",
      capabilityId: "critique.generate",
      positions: [
        { v5Role: "产品", roleId: "product", content: "RBAC 优先" },
        { v5Role: "安全", roleId: "security", content: "隔离必要" },
      ],
      critiques: [{ challengerRoleId: "安全", targetRoleId: "产品", critique: "成本过高" }],
      convergenceScore: 0.82,
      consensusReached: true,
      dissent: [],
    });

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("capability_start");
    expect(kinds.filter((k) => k === "role_position")).toHaveLength(2);
    expect(kinds).toContain("role_critique");
    expect(kinds).toContain("panel_converge");

    // role_critique 带 targetRoleId(谁质疑谁)
    const critique = events.find((e) => e.kind === "role_critique")!;
    expect(critique.roleId).toBe("安全");
    expect(critique.targetRoleId).toBe("产品");

    // panel_converge meta 透传收敛分/共识/异议
    const converge = events.find((e) => e.kind === "panel_converge")!;
    expect(converge.meta?.convergenceScore).toBe(0.82);
    expect(converge.meta?.consensusReached).toBe(true);

    // order 连续递增
    expect(events.map((e) => e.order)).toEqual(events.map((_, i) => i));
    // capabilityRunId 一致(投影挂接靠它)
    expect(events.every((e) => e.capabilityRunId === "t1-run-critique.generate")).toBe(true);
  });

  it("degraded panel (no positions) still emits start + converge", () => {
    const events = buildPanelEvents({
      turnId: "t2",
      capabilityRunId: "t2-run-critique.generate",
      capabilityId: "critique.generate",
      positions: [],
      critiques: [],
      convergenceScore: 0,
      consensusReached: false,
      dissent: [],
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("capability_start");
    expect(kinds).toContain("panel_converge");
    expect(kinds).not.toContain("role_position");
  });

  it("P2.6 sanitization: forbidden tokens in position/critique text are stripped from emitted events", () => {
    // Embed a forbidden token (G_READY) and a source tag (F1_Github_Source) in panel content
    const forbiddenToken = FORBIDDEN_INTERNAL_TOKENS[0]; // "G_READY"
    const events = buildPanelEvents({
      turnId: "t3",
      capabilityRunId: "t3-run-critique.generate",
      capabilityId: "critique.generate",
      positions: [
        { v5Role: "产品", content: `优先 RBAC ${forbiddenToken} 隔离方案` },
      ],
      critiques: [
        { challengerRoleId: "安全", targetRoleId: "产品", critique: `来自 F1_Github_Source 的证据支持此观点` },
      ],
      convergenceScore: 0.7,
      consensusReached: false,
      dissent: [],
    });

    for (const token of FORBIDDEN_INTERNAL_TOKENS) {
      for (const e of events) {
        expect(e.text, `event ${e.kind} must not contain forbidden token "${token}"`).not.toContain(token);
      }
    }
    // Source tag replaced with "外部检索"
    const critiqueEv = events.find((e) => e.kind === "role_critique")!;
    expect(critiqueEv.text).not.toMatch(/F\d+_[A-Za-z_]+/);
    expect(critiqueEv.text).toContain("外部检索");
  });
});

describe("buildCapabilityLlmFallback (V5.3 P2.4 fallback events)", () => {
  const baseState = {
    sessionId: "fb-test",
    goal: { text: "权限管理系统", status: "needs_refinement" as const },
    artifacts: [],
    staleArtifactIds: [],
    conversation: [],
  };

  it("dialogue fallback emits proper ReasoningEvent sequence (capability_start → think → capability_complete)", () => {
    const result = buildCapabilityLlmFallback({
      capabilityId: "gap.ask",
      state: baseState as any,
      turnId: "t-fb-1",
      reason: "llm_timeout",
    });

    expect(result).not.toBeNull();
    expect(result!.events).toBeDefined();
    const events = result!.events!;

    expect(events[0].kind).toBe("capability_start");
    expect(events[events.length - 1].kind).toBe("capability_complete");
    expect(events.some((e) => e.kind === "think")).toBe(true);

    const thinkEv = events.find((e) => e.kind === "think")!;
    expect(thinkEv.meta?.source).toBe("template_fallback");
  });

  it("fallback events have correct ReasoningEvent shape (id, turnId, capabilityRunId, order, ts)", () => {
    const result = buildCapabilityLlmFallback({
      capabilityId: "intent.clarify",
      state: baseState as any,
      turnId: "t-fb-2",
    });

    const events = result!.events!;
    expect(events.every((e) => typeof e.id === "string" && e.id.length > 0)).toBe(true);
    expect(events.every((e) => e.turnId === "t-fb-2")).toBe(true);
    expect(events.every((e) => e.capabilityRunId === "t-fb-2-run-intent.clarify")).toBe(true);
    expect(events.map((e) => e.order)).toEqual(events.map((_, i) => i));
    expect(events.every((e) => typeof e.ts === "string")).toBe(true);
  });

  it("deliberation fallback also emits events", () => {
    const result = buildCapabilityLlmFallback({
      capabilityId: "critique.generate",
      state: baseState as any,
      turnId: "t-fb-delib",
      reason: "pool_exhausted",
    });
    expect(result).not.toBeNull();
    expect(result!.events).toBeDefined();
    expect(result!.events!.length).toBeGreaterThanOrEqual(2);
    expect(result!.events![0].kind).toBe("capability_start");
  });

  it("fallback event text does not contain forbidden tokens", () => {
    const result = buildCapabilityLlmFallback({
      capabilityId: "route.generate",
      state: baseState as any,
      turnId: "t-fb-san",
      reason: `G_READY pilot-template baseline`, // reason that contains forbidden tokens
    });

    for (const token of FORBIDDEN_INTERNAL_TOKENS) {
      for (const e of result!.events!) {
        expect(e.text, `fallback event text must not contain "${token}"`).not.toContain(token);
      }
    }
  });
});
