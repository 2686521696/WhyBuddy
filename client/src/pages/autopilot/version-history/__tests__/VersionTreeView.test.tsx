import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VersionTreeView } from "../VersionTreeView";
import { family, job } from "./version-history-fixtures";

describe("<VersionTreeView>", () => {
  it.each([
    ["family-of-1", [job("root")], "single"],
    [
      "parent+1",
      [job("root"), job("branch-a", { parentJobId: "root" })],
      "ready",
    ],
    [
      "parent+3",
      [
        job("root"),
        job("branch-b", {
          parentJobId: "root",
          branchedAt: "2026-05-23T03:00:00.000Z",
        }),
        job("branch-a", {
          parentJobId: "root",
          branchedAt: "2026-05-23T01:00:00.000Z",
        }),
        job("branch-c", {
          parentJobId: "root",
          branchedAt: "2026-05-23T05:00:00.000Z",
        }),
      ],
      "ready",
    ],
    [
      "depth-2",
      [
        job("root"),
        job("branch-a", { parentJobId: "root" }),
        job("branch-a-child", { parentJobId: "branch-a" }),
      ],
      "ready",
    ],
  ])("renders %s family data from useFamilyData input", (_name, jobs, state) => {
    const markup = renderToStaticMarkup(
      <VersionTreeView
        jobId="root"
        activeJobId={jobs[0].id}
        initialData={family(jobs)}
        applySwitchActive={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="version-tree-view"');
    expect(markup).toContain(`data-state="${state}"`);
    for (const renderedJob of jobs) {
      expect(markup).toContain(renderedJob.id);
    }
  });

  it("renders loading, error, and static-preview fallback states", () => {
    const loading = renderToStaticMarkup(
      <VersionTreeView jobId="root" activeJobId="root" applySwitchActive={vi.fn()} />,
    );
    const error = renderToStaticMarkup(
      <VersionTreeView
        jobId="root"
        activeJobId="root"
        applySwitchActive={vi.fn()}
        familyState={{
          status: "error",
          data: null,
          loading: false,
          error: {
            kind: "error",
            source: "http",
            endpoint: "/api/blueprint/jobs/root/family",
            message: "family_cycle_detected",
            detail: "cycle",
            retryable: false,
            status: 500,
          },
        }}
      />,
    );
    const staticPreview = renderToStaticMarkup(
      <VersionTreeView
        jobId="root"
        activeJobId="root"
        staticPreview
        initialData={family([job("root")])}
        applySwitchActive={vi.fn()}
      />,
    );

    expect(loading).toContain('data-state="loading"');
    expect(error).toContain('data-state="error"');
    expect(error).toContain("family_cycle_detected");
    expect(staticPreview).toContain('data-state="static-preview"');
    expect(staticPreview).toContain("Static preview");
  });

  it("exposes switch-active callbacks on rendered tree nodes", () => {
    const markup = renderToStaticMarkup(
      <VersionTreeView
        jobId="root"
        activeJobId="root"
        initialData={family([job("root"), job("branch", { parentJobId: "root" })])}
        applySwitchActive={vi.fn()}
      />,
    );

    expect(markup).toContain('data-switch-active="true"');
    expect(markup).toContain('data-job-id="branch"');
  });

  it("keeps connection metadata on child tree items without nesting list items", () => {
    const markup = renderToStaticMarkup(
      <VersionTreeView
        jobId="root"
        activeJobId="branch-a-child"
        initialData={family([
          job("root"),
          job("branch-a", { parentJobId: "root" }),
          job("branch-a-child", { parentJobId: "branch-a" }),
        ])}
        applySwitchActive={vi.fn()}
      />,
    );

    expect(markup).toMatch(
      /<li(?=[^>]*data-tree-depth="1")(?=[^>]*data-connection="root-&gt;branch-a")[^>]*>/,
    );
    expect(markup).toMatch(
      /<li(?=[^>]*data-tree-depth="2")(?=[^>]*data-connection="branch-a-&gt;branch-a-child")[^>]*>/,
    );
    expect(markup).not.toMatch(/<li[^>]*data-connection="[^"]*"><li/);
  });
});
