/**
 * 输入条闭环胶囊：GitHub Checks 式裁决，分数不进主文案。
 * 变异：label 再拼 6/6，或 blocked 仍写「闭环」，必红。
 */
import { describe, expect, it } from "vitest";
import { formatComposerClosurePill } from "../composer-closure-pill";

describe("formatComposerClosurePill", () => {
  it("收口只写已收口，分数进 title", () => {
    const pill = formatComposerClosurePill({
      blocked: false,
      evidencePresentCount: 6,
      skillCount: 6,
    });
    expect(pill.label).toBe("已收口");
    expect(pill.blocked).toBe(false);
    expect(pill.title).toBe("证据 6/6");
    expect(pill.label).not.toMatch(/\d+\/\d+/);
  });

  it("被闸只写未收口，不许装闭环", () => {
    const pill = formatComposerClosurePill({
      blocked: true,
      evidencePresentCount: 4,
      skillCount: 6,
    });
    expect(pill.label).toBe("未收口");
    expect(pill.blocked).toBe(true);
    expect(pill.title).toBe("证据 4/6");
    expect(pill.label).not.toContain("闭环");
    expect(pill.label).not.toMatch(/\d+\/\d+/);
  });
});
