import { describe, expect, it } from "vitest";

import {
  DEFAULT_STAGE_ORDER,
  deriveDownstreamImpact,
} from "../derive-downstream-impact";

describe("deriveDownstreamImpact", () => {
  it("counts stages after the edited upstream stage using the local stage order", () => {
    expect(deriveDownstreamImpact({ fromStage: "clarification" })).toEqual({
      fromStage: "clarification",
      downstreamStages: DEFAULT_STAGE_ORDER.slice(
        DEFAULT_STAGE_ORDER.indexOf("clarification") + 1
      ),
      downstreamCount: DEFAULT_STAGE_ORDER.length - 2,
    });
  });

  it("returns zero downstream stages for the final local stage", () => {
    expect(
      deriveDownstreamImpact({ fromStage: "engineering_landing" })
    ).toEqual({
      fromStage: "engineering_landing",
      downstreamStages: [],
      downstreamCount: 0,
    });
  });

  it("supports an injected stage order as the future graph replacement boundary", () => {
    expect(
      deriveDownstreamImpact({
        fromStage: "route_generation",
        stageOrder: ["input", "route_generation", "spec_tree"],
      })
    ).toEqual({
      fromStage: "route_generation",
      downstreamStages: ["spec_tree"],
      downstreamCount: 1,
    });
  });
});
