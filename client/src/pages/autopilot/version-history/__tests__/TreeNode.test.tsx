import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TreeNode } from "../TreeNode";
import { deriveVersionTreeLayout } from "../derive-tree-layout";
import { artifact, job } from "./version-history-fixtures";

describe("<TreeNode>", () => {
  it("renders active, stale, branch-stage, and branch-time markers", () => {
    const node = deriveVersionTreeLayout([
      job("root"),
      job("branch-with-a-long-id", {
        parentJobId: "root",
        branchedFromStage: "spec_docs",
        branchedAt: "2026-05-23T05:00:00.000Z",
        artifacts: [
          artifact("artifact-1", "tasks", "2026-05-23T04:00:00.000Z", {
            staleSince: "2026-05-23T06:00:00.000Z",
          }),
        ],
      }),
    ]).nodesById["branch-with-a-long-id"];

    const markup = renderToStaticMarkup(
      <TreeNode
        node={node}
        activeJobId="branch-with-a-long-id"
        onSelectJob={() => {}}
      />
    );

    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('data-stale="true"');
    expect(markup).toContain("spec_docs");
    expect(markup).toContain("2026-05-23T05:00:00.000Z");
    expect(markup).toContain("branch-");
  });

  it("selects the job on click, Enter, and Space", () => {
    const onSelectJob = vi.fn();
    const node = deriveVersionTreeLayout([job("branch")]).nodesById.branch;
    const element = TreeNode({
      node,
      activeJobId: "root",
      onSelectJob,
    }) as React.ReactElement<{
      onClick: () => void;
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
    }>;
    const preventDefault = vi.fn();

    element.props.onClick();
    element.props.onKeyDown({ key: "Enter", preventDefault });
    element.props.onKeyDown({ key: " ", preventDefault });

    expect(onSelectJob).toHaveBeenCalledTimes(3);
    expect(onSelectJob).toHaveBeenCalledWith("branch");
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
});
