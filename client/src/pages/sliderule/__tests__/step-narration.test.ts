import { describe, it, expect } from "vitest";
import { buildStepNarration } from "../step-narration";

describe("buildStepNarration (S8)", () => {
  it("quotes summary first sentence for LLM artifacts", () => {
    const text = buildStepNarration({
      capabilityId: "risk.analyze",
      realLlm: true,
      summary: "识别到 3 项高风险。审计链路需要补强。",
    });
    expect(text).toContain("识别到 3 项高风险");
    expect(text).not.toContain("capability");
  });

  it("uses generic completion line for rule artifacts without quoting summary", () => {
    const text = buildStepNarration({
      capabilityId: "risk.analyze",
      realLlm: false,
      summary: "risk.analyze via PilotReal internal marker",
    });
    expect(text).toBe("已完成分析风险。");
    expect(text).not.toContain("PilotReal");
  });
});