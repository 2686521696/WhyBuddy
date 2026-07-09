import { describe, expect, it } from "vitest";

import {
  STAGE_TO_PAGE,
  areStagesOnSamePage,
  getAutopilotPageForStage,
} from "../page-mapping.js";

describe("autopilot coordination page mapping", () => {
  it("maps canonical backend stages to the expected page buckets", () => {
    expect(STAGE_TO_PAGE.input).toBe(1);
    expect(STAGE_TO_PAGE.clarification).toBe(1);
    expect(STAGE_TO_PAGE.route_generation).toBe(1);
    expect(STAGE_TO_PAGE.spec_tree).toBe(2);
    expect(STAGE_TO_PAGE.spec_docs).toBe(2);
    expect(STAGE_TO_PAGE.effect_preview).toBe(3);
    expect(STAGE_TO_PAGE.prompt_packaging).toBe(3);
    expect(STAGE_TO_PAGE.runtime_capability).toBe(3);
    expect(STAGE_TO_PAGE.engineering_handoff).toBe(3);
    expect(STAGE_TO_PAGE.engineering_landing).toBe(3);
  });

  it("includes UI aliases in the public page mapping", () => {
    expect(getAutopilotPageForStage("route")).toBe(1);
    expect(getAutopilotPageForStage("spec_documents")).toBe(2);
    expect(getAutopilotPageForStage("prompt_package")).toBe(3);
    expect(getAutopilotPageForStage("preview")).toBe(3);

    expect(STAGE_TO_PAGE.route).toBe(1);
    expect(STAGE_TO_PAGE.spec_documents).toBe(2);
    expect(STAGE_TO_PAGE.prompt_package).toBe(3);
    expect(STAGE_TO_PAGE.preview).toBe(3);
  });

  it("treats stages on the same page as compatible across aliases", () => {
    expect(areStagesOnSamePage("route", "route_generation")).toBe(true);
    expect(areStagesOnSamePage("spec_tree", "spec_documents")).toBe(true);
    expect(areStagesOnSamePage("prompt_package", "engineering_handoff")).toBe(
      true
    );
    expect(areStagesOnSamePage("spec_docs", "engineering_landing")).toBe(
      false
    );
  });
});
