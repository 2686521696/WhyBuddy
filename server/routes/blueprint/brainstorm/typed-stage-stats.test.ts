/**
 * Unit tests for typed-stage debate-impact stats
 * (autopilot-brainstorm-real-collaboration).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  recordTypedStageOutcome,
  getTypedStageStats,
  __resetTypedStageStatsForTest,
} from "./typed-stage-stats.js";

afterEach(() => {
  __resetTypedStageStatsForTest();
});

describe("typed-stage debate-impact stats", () => {
  it("reports 0 rate with no samples", () => {
    const s = getTypedStageStats();
    expect(s.parsed).toBe(0);
    expect(s.fallback).toBe(0);
    expect(s.parseSuccessRate).toBe(0);
    expect(s.perStage).toEqual({});
  });

  it("computes parse-success rate per stage and overall", () => {
    recordTypedStageOutcome("spec_tree", "parsed");
    recordTypedStageOutcome("spec_tree", "parsed");
    recordTypedStageOutcome("spec_tree", "fallback");
    recordTypedStageOutcome("route_generation", "fallback");

    const s = getTypedStageStats();
    expect(s.parsed).toBe(2);
    expect(s.fallback).toBe(2);
    expect(s.parseSuccessRate).toBeCloseTo(0.5, 5);
    expect(s.perStage.spec_tree).toEqual({
      parsed: 2,
      fallback: 1,
      parseSuccessRate: 2 / 3,
    });
    expect(s.perStage.route_generation.parseSuccessRate).toBe(0);
  });

  it("attaches lowImpactWarning when rate below threshold after enough samples", () => {
    // 3 parsed, 4 fallback => rate 3/7 ≈ 0.428 < 0.5, samples=7 >=5
    for (let i = 0; i < 3; i++) recordTypedStageOutcome("spec_tree", "parsed");
    for (let i = 0; i < 4; i++) recordTypedStageOutcome("spec_tree", "fallback");

    const s = getTypedStageStats();
    expect(s.parseSuccessRate).toBeCloseTo(3 / 7, 5);
    expect(s.lowImpactWarning).toBeDefined();
    expect(s.lowImpactWarning?.rate).toBeCloseTo(3 / 7, 5);
    expect(s.lowImpactWarning?.totalSamples).toBe(7);
    expect(s.lowImpactWarning?.threshold).toBe(0.5);
    expect(s.lowImpactWarning?.minSamples).toBe(5);

    // Below threshold but not enough samples => no warning
    __resetTypedStageStatsForTest();
    recordTypedStageOutcome("spec_tree", "parsed");
    recordTypedStageOutcome("spec_tree", "fallback"); // 1/2 = 0.5 not <0.5, and samples=2 <5
    const s2 = getTypedStageStats();
    expect(s2.lowImpactWarning).toBeUndefined();
  });
});
