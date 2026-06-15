import { describe, it, expect } from "vitest";
import { buildPanelEvents } from "../deliberation-exec-map.js";

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
});
