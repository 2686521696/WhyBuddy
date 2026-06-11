import { describe, it, expect } from "vitest";
import {
  deriveTurnRoute,
  buildRouteSummary,
  assertRouteCopySanitized,
} from "@shared/blueprint/whybuddy-turn-route";

/** S9 client smoke — full matrix lives in shared/blueprint/__tests__/whybuddy-turn-route.test.ts */
describe("deriveTurnRoute client smoke (S9)", () => {
  it("S9-A1/A5: normal path summary matches expanded tokens", () => {
    const stations = deriveTurnRoute({
      turnId: "turn-smoke",
      planReason: "picked",
      planSelectedCount: 2,
      planSource: "local_heuristic",
      dledgerDecisionId: "turn-smoke-dledger",
      trustPassedCount: 2,
      trustTotalCount: 2,
      goalStatusAfter: "clear",
      runtimePhase: "awaiting",
    });
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "plan",
      "execution",
      "trust_gate",
      "verdict",
      "await",
    ]);
    const summary = buildRouteSummary(stations);
    expect(summary).toContain("推演 2");
    expect(summary).toContain("已收敛");
    assertRouteCopySanitized(stations);
  });
});