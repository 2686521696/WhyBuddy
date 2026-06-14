import { describe, it, expect } from "vitest";
import {
  makeEvent,
  makeEventSequence,
  sanitizeReasoningText,
  foldEventsForOverview,
  eventsByRun,
  FORBIDDEN_INTERNAL_TOKENS,
  type ReasoningEvent,
} from "../sliderule-reasoning-events.js";

describe("sliderule-reasoning-events (V5.3 P1)", () => {
  it("makeEvent fills id/order/ts and sanitizes text", () => {
    const e = makeEvent(
      { turnId: "t1", capabilityRunId: "t1-run-0", capabilityId: "gap.ask", kind: "think", text: "开始 GCOV 检查 baseline" },
      0
    );
    expect(e.id).toBe("t1-run-0-ev-0");
    expect(e.order).toBe(0);
    expect(e.ts).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(e.text).not.toMatch(/GCOV|baseline/); // 脱敏
  });

  it("sanitizeReasoningText strips internal tokens + source tags, idempotent", () => {
    const dirty = "基于 F2_Web_Search 取数,T_GATE 7/7 通过,DLEDGER 选定";
    const clean = sanitizeReasoningText(dirty);
    for (const tok of FORBIDDEN_INTERNAL_TOKENS) expect(clean).not.toContain(tok);
    expect(clean).toContain("外部检索"); // F2_Web_Search → 外部检索
    expect(sanitizeReasoningText(clean)).toBe(clean); // 幂等
  });

  it("makeEventSequence assigns ascending order", () => {
    const evs = makeEventSequence(
      { turnId: "t2", capabilityRunId: "t2-run-1", capabilityId: "critique.generate" },
      [
        { kind: "capability_start", text: "开始" },
        { kind: "role_position", roleId: "安全", text: "优先 RBAC" },
        { kind: "panel_converge", roleId: "综合", text: "收敛", meta: { convergenceScore: 0.82, consensusReached: true } },
        { kind: "capability_complete", text: "完成", refs: ["a1"] },
      ]
    );
    expect(evs.map((e) => e.order)).toEqual([0, 1, 2, 3]);
    expect(evs[2].meta?.convergenceScore).toBe(0.82);
    expect(evs[3].refs).toEqual(["a1"]);
  });

  it("foldEventsForOverview counts by kind family", () => {
    const evs = makeEventSequence(
      { turnId: "t3", capabilityRunId: "t3-run-0", capabilityId: "report.write" },
      [
        { kind: "think", text: "a" },
        { kind: "think", text: "b" },
        { kind: "observe", text: "c" },
        { kind: "tool_call", text: "d" },
        { kind: "role_position", roleId: "安全", text: "e" },
        { kind: "role_critique", roleId: "挑刺", targetRoleId: "安全", text: "f" },
      ]
    );
    expect(foldEventsForOverview(evs)).toEqual({ think: 2, observe: 1, tool: 1, role: 2 });
  });

  it("eventsByRun groups + sorts by order; undefined-safe", () => {
    const a: ReasoningEvent[] = [
      makeEvent({ turnId: "t", capabilityRunId: "r1", capabilityId: "x", kind: "think", text: "1" }, 2),
      makeEvent({ turnId: "t", capabilityRunId: "r1", capabilityId: "x", kind: "think", text: "0" }, 0),
      makeEvent({ turnId: "t", capabilityRunId: "r2", capabilityId: "y", kind: "think", text: "z" }, 0),
    ];
    const map = eventsByRun({ reasoningEvents: a });
    expect(map.get("r1")!.map((e) => e.order)).toEqual([0, 2]); // 排序
    expect(map.get("r2")).toHaveLength(1);
    expect(eventsByRun({}).size).toBe(0); // undefined 安全
  });
});
