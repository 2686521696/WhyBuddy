import { describe, expect, it } from "vitest";

import type { BlueprintSpecTree } from "@shared/blueprint/contracts";

import {
  selectAutoAdvanceSpecTree,
  selectAutoAdvanceSubStage,
} from "../use-auto-advance";

function specTree(id: string): BlueprintSpecTree {
  return {
    id,
    rootNodeId: `${id}-root`,
    version: 1,
    nodes: [],
    documents: [],
  } as unknown as BlueprintSpecTree;
}

describe("selectAutoAdvanceSpecTree", () => {
  it("uses the right-rail SPEC tree when the page-level state is stale", () => {
    const railTree = specTree("rail-tree");

    expect(selectAutoAdvanceSpecTree(null, railTree)).toBe(railTree);
  });

  it("keeps the page-level SPEC tree as the primary source when present", () => {
    const pageTree = specTree("page-tree");
    const railTree = specTree("rail-tree");

    expect(selectAutoAdvanceSpecTree(pageTree, railTree)).toBe(pageTree);
  });
});

describe("selectAutoAdvanceSubStage", () => {
  it("maps a successful spec_docs advance back to the SPEC tree rail sub-stage", () => {
    expect(selectAutoAdvanceSubStage("spec_docs")).toBe("spec_tree");
  });
});

describe("useAutoAdvance generation action injection", () => {
  it("accepts injected generation actions so static Pages mode can avoid backend APIs", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../use-auto-advance.ts"),
      "utf8"
    );

    expect(source).toMatch(/generationActions\?:\s*UseAutoAdvanceActions/);
    expect(source).toMatch(
      /generationActions\?\.generateSpecDocuments\s*\?\?\s*generateBlueprintSpecDocuments/
    );
    expect(source).toMatch(/actions\.generateSpecDocuments\(jobId/);
    expect(source).toMatch(/actions\.generateEffectPreview\(jobId/);
    expect(source).toMatch(/actions\.generatePromptPackages\(jobId/);
    expect(source).toMatch(/actions\.generateEngineeringLanding\(jobId/);
  });

  it("generates downstream previews and prompt packages from draft handoff assets during full-flow smoke", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../use-auto-advance.ts"),
      "utf8"
    );

    expect(source).toMatch(
      /actions\.generateEffectPreview\(jobId,\s*\{\s*includeDrafts:\s*true,?\s*\}/
    );
    expect(source).toMatch(
      /actions\.generatePromptPackages\(jobId,\s*\{\s*includeDrafts:\s*true,\s*includePreviewDrafts:\s*true,?\s*\}/
    );
  });
});
