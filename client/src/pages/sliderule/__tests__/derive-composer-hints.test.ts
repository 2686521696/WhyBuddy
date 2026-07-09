import { describe, it, expect } from "vitest";
import { deriveComposerHintChips } from "../derive-composer-hints";
import { buildClearStateWithPreview } from "@/lib/sliderule-fullpath-fixtures";

describe("deriveComposerHintChips (S20 UI)", () => {
  it("surfaces RV and ITER chips when converged with report + preview", () => {
    const { state } = buildClearStateWithPreview("hints");
    const chips = deriveComposerHintChips(state);
    expect(chips.some((c) => c.includes("评审通过"))).toBe(true);
    expect(chips.some((c) => c.includes("评审打回"))).toBe(true);
    expect(chips.some((c) => c.includes("不满意"))).toBe(true);
  });

  it("uses post-delivery chips when runtimePhase is done", () => {
    const { state } = buildClearStateWithPreview("hints-done");
    const chips = deriveComposerHintChips({ ...state, runtimePhase: "done", deliveryPhase: "shipped" });
    expect(chips).toContain("继续补充想法");
  });
});