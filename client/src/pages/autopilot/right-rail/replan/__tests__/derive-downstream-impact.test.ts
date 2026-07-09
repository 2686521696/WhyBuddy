import { describe, expect, it } from "vitest";

import { deriveDownstreamImpact } from "../derive-downstream-impact";
import type { ReplanArtifact } from "../types";

function artifact(id: string, type: string, stage?: string): ReplanArtifact {
  return {
    id,
    type,
    title: id,
    createdAt: `2026-05-23T00:00:00.000Z`,
    ...(stage ? { stage } : {}),
  };
}

describe("deriveDownstreamImpact", () => {
  it("returns downstream artifact ids, count, and ordered stages from the local generation chain", () => {
    const impact = deriveDownstreamImpact({
      fromStage: "spec_tree",
      artifacts: [
        artifact("tree", "spec_tree"),
        artifact("req", "requirements"),
        artifact("design", "design"),
        artifact("preview", "effect_preview"),
        artifact("prompt", "prompt_pack"),
        artifact("runtime", "capability_invocation"),
      ],
    });

    expect(impact.artifactIds).toEqual([
      "req",
      "design",
      "preview",
      "prompt",
      "runtime",
    ]);
    expect(impact.artifactCount).toBe(5);
    expect(impact.stages).toEqual([
      "spec_docs",
      "effect_preview",
      "prompt_packaging",
      "runtime_capability",
    ]);
  });

  it("keeps spec_tree and spec_docs on the same page but still treats spec_docs artifacts as downstream of spec_tree", () => {
    const fromSpecTree = deriveDownstreamImpact({
      fromStage: "spec_tree",
      artifacts: [artifact("tree", "spec_tree"), artifact("tasks", "tasks")],
    });
    const fromSpecDocs = deriveDownstreamImpact({
      fromStage: "spec_docs",
      artifacts: [artifact("tree", "spec_tree"), artifact("tasks", "tasks")],
    });

    expect(fromSpecTree.artifactIds).toEqual(["tasks"]);
    expect(fromSpecTree.stages).toEqual(["spec_docs"]);
    expect(fromSpecDocs.artifactIds).toEqual([]);
    expect(fromSpecDocs.stages).toEqual([]);
  });

  it("honors an explicit artifact stage before falling back to the type mapping", () => {
    const impact = deriveDownstreamImpact({
      fromStage: "effect_preview",
      artifacts: [
        artifact("legacy-preview", "preview"),
        artifact("handoff", "unknown_type", "engineering_handoff"),
      ],
    });

    expect(impact.artifactIds).toEqual(["handoff"]);
    expect(impact.stages).toEqual(["engineering_handoff"]);
  });
});
