import { describe, expect, it } from "vitest";

import {
  getStatusMapping,
  getStatusLabel,
} from "../sidebar-status-utils";

// ---------------------------------------------------------------------------
// Unit: getStatusMapping — covers all driveState values
// ---------------------------------------------------------------------------

describe("getStatusMapping", () => {
  it("maps running to green pulse dot", () => {
    const m = getStatusMapping("running");
    expect(m.dotClass).toContain("bg-emerald-500");
    expect(m.dotClass).toContain("animate-pulse");
  });

  it("maps executing to green pulse dot", () => {
    const m = getStatusMapping("executing");
    expect(m.dotClass).toContain("bg-emerald-500");
    expect(m.dotClass).toContain("animate-pulse");
  });

  it("maps planning to amber dot", () => {
    const m = getStatusMapping("planning");
    expect(m.dotClass).toContain("bg-amber-500");
  });

  it("maps waiting to amber dot", () => {
    const m = getStatusMapping("waiting");
    expect(m.dotClass).toContain("bg-amber-500");
  });

  it("maps blocked to amber dot", () => {
    const m = getStatusMapping("blocked");
    expect(m.dotClass).toContain("bg-amber-500");
  });

  it("maps failed to red dot", () => {
    const m = getStatusMapping("failed");
    expect(m.dotClass).toContain("bg-red-500");
  });

  it("maps delivered to gray dot", () => {
    const m = getStatusMapping("delivered");
    expect(m.dotClass).toContain("bg-gray-400");
  });

  it("maps done to gray dot", () => {
    const m = getStatusMapping("done");
    expect(m.dotClass).toContain("bg-gray-400");
  });

  it("maps idle to gray dot (standby)", () => {
    const m = getStatusMapping("idle");
    expect(m.dotClass).toContain("bg-gray-400");
    expect(m.labelZh).toBe("待命中");
    expect(m.labelEn).toBe("Standby");
  });

  it("returns fallback for undefined", () => {
    const m = getStatusMapping(undefined);
    expect(m.dotClass).toContain("bg-gray-400");
    expect(m.labelEn).toBe("Standby");
    expect(m.labelZh).toBe("待命中");
  });

  it("returns fallback for null", () => {
    const m = getStatusMapping(null);
    expect(m.dotClass).toContain("bg-gray-400");
    expect(m.labelZh).toBe("待命中");
  });

  it("returns fallback for unknown string", () => {
    const m = getStatusMapping("some_unknown_state");
    expect(m.dotClass).toBeTruthy();
    expect(m.labelEn).toBe("Standby");
    expect(m.labelZh).toBe("待命中");
  });

  it("every known state returns non-empty dotClass and labels", () => {
    const knownStates = [
      "running",
      "executing",
      "planning",
      "waiting",
      "blocked",
      "failed",
      "delivered",
      "done",
      "idle",
    ];
    for (const state of knownStates) {
      const m = getStatusMapping(state);
      expect(m.dotClass).toBeTruthy();
      expect(m.labelZh).toBeTruthy();
      expect(m.labelEn).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: getStatusLabel — locale-aware label resolution
// ---------------------------------------------------------------------------

describe("getStatusLabel", () => {
  it("returns English label for en locale", () => {
    expect(getStatusLabel("running", "en-US")).toBe("Running");
    expect(getStatusLabel("planning", "en-US")).toBe("Planning");
    expect(getStatusLabel("waiting", "en-US")).toBe("Waiting");
    expect(getStatusLabel("failed", "en-US")).toBe("Error");
    expect(getStatusLabel("delivered", "en-US")).toBe("Done");
    expect(getStatusLabel("idle", "en-US")).toBe("Standby");
  });

  it("returns Chinese label for zh locale", () => {
    expect(getStatusLabel("running", "zh-CN")).toBe("自主执行中");
    expect(getStatusLabel("planning", "zh-CN")).toBe("规划中");
    expect(getStatusLabel("waiting", "zh-CN")).toBe("等待接管");
    expect(getStatusLabel("failed", "zh-CN")).toBe("异常");
    expect(getStatusLabel("delivered", "zh-CN")).toBe("已完成");
    expect(getStatusLabel("idle", "zh-CN")).toBe("待命中");
  });

  it("returns Standby for undefined driveState", () => {
    expect(getStatusLabel(undefined, "en-US")).toBe("Standby");
    expect(getStatusLabel(undefined, "zh-CN")).toBe("待命中");
  });

  it("returns Standby for null driveState", () => {
    expect(getStatusLabel(null, "en-US")).toBe("Standby");
    expect(getStatusLabel(null, "zh-CN")).toBe("待命中");
  });

  it("returns Standby for unknown driveState", () => {
    expect(getStatusLabel("xyz_unknown", "en-US")).toBe("Standby");
    expect(getStatusLabel("xyz_unknown", "zh-CN")).toBe("待命中");
  });
});
