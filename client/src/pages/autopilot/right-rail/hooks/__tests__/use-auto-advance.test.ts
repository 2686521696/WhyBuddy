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
