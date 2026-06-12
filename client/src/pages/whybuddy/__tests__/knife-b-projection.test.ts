import { describe, expect, it } from "vitest";
import { buildClearStateWithTrustedReport } from "@/lib/whybuddy-fullpath-fixtures";
import { deriveWhyBuddyReasoningViewModel } from "../derive-reasoning-view-model";

describe("Knife B · projection density", () => {
  it("detailed mode expands evidence child nodes from evidenceRefs", () => {
    const { state, reportId, riskId } = buildClearStateWithTrustedReport("knife-b");
    const report = (state.artifacts || []).find((a) => a.id === reportId);
    if (report) {
      report.evidenceRefs = [riskId, "ev-ground-1"];
    }

    const compact = deriveWhyBuddyReasoningViewModel(state, { density: "compact" });
    const detailed = deriveWhyBuddyReasoningViewModel(state, { density: "detailed" });
    expect(detailed.visibleNodes.length).toBeGreaterThan(compact.visibleNodes.length);
    expect(detailed.visibleNodes.some((n) => n.id.includes("::ev-"))).toBe(true);
  });

  it("compact mode has no projection child node ids", () => {
    const { state } = buildClearStateWithTrustedReport("knife-b-compact");
    const vm = deriveWhyBuddyReasoningViewModel(state, { density: "compact" });
    expect(vm.visibleNodes.every((n) => !n.id.includes("::ev-"))).toBe(true);
    expect(vm.visibleNodes.every((n) => !n.id.includes("::phase-"))).toBe(true);
  });
});