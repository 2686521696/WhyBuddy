import { describe, it, expect } from "vitest";
import { ALL_V5_CAPABILITIES } from "../contracts.js";
import { CAPABILITY_PROCESS_LABELS, getLiveAction } from "../capability-process-labels.js";

describe("CAPABILITY_PROCESS_LABELS (B1)", () => {
  it("covers every capability in ALL_V5_CAPABILITIES", () => {
    for (const id of ALL_V5_CAPABILITIES) {
      expect(CAPABILITY_PROCESS_LABELS[id], `missing label for ${id}`).toBeDefined();
      expect(CAPABILITY_PROCESS_LABELS[id].liveLabel).toBeTruthy();
    }
    expect(Object.keys(CAPABILITY_PROCESS_LABELS).length).toBe(ALL_V5_CAPABILITIES.length);
  });

  it("action live labels include concrete targets, not generic external-tool phrasing", () => {
    const repo = getLiveAction("repo.inspect", { repoSlug: "facebook/react" });
    expect(repo.label).toContain("facebook/react");
    expect(repo.label).not.toMatch(/调用了外部工具/);

    const mcp = getLiveAction("mcp.call", { toolName: "github-search" });
    expect(mcp.label).toContain("github-search");
    expect(mcp.label).not.toMatch(/调用了外部工具/);
  });
});