import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "@shared/blueprint";

import { CompareView } from "../CompareView";
import { HistoryEntryPoint } from "../HistoryEntryPoint";
import { ReplanTimelineView } from "../ReplanTimelineView";
import { TreeNode } from "../TreeNode";
import { VersionTreeView } from "../VersionTreeView";
import { deriveVersionTreeLayout } from "../derive-tree-layout";
import { loadBlueprintFamilyData, useFamilyData } from "../use-family-data";
import {
  createSwitchActiveJobHandler,
  createSwitchActiveNavigationApply,
  executeSwitchActiveJob,
  useSwitchActiveJob,
  withActiveJobSearchParam,
} from "../use-switch-active-job";

type VersionHistoryJob = BlueprintGenerationJob & {
  parentJobId?: string;
  branchedAt?: string;
  branchedFromStage?: BlueprintGenerationStage;
  staleArtifactIds?: string[];
};

type StaleArtifact = BlueprintGenerationArtifact & {
  staleSince?: string;
};

function artifact(
  id: string,
  type: BlueprintGenerationArtifact["type"],
  createdAt: string,
  stale?: Pick<StaleArtifact, "staleSince" | "invalidatedBy">,
): StaleArtifact {
  return {
    id,
    type,
    title: `${type} ${id}`,
    summary: `${type} summary`,
    createdAt,
    ...stale,
  };
}

function job(
  id: string,
  overrides: Partial<VersionHistoryJob> = {},
): VersionHistoryJob {
  return {
    id,
    request: {
      githubUrl: "https://github.com/example/repo",
      projectName: "Example",
    },
    status: "completed",
    stage: "spec_tree",
    version: "v1",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    artifacts: [],
    events: [],
    ...overrides,
  } as VersionHistoryJob;
}

function event(
  id: string,
  type: string,
  occurredAt: string,
  message: string,
  payload?: unknown,
): BlueprintGenerationEvent {
  return {
    id,
    jobId: "job-root",
    type,
    family: "job",
    stage: "spec_tree",
    status: "completed",
    message,
    occurredAt,
    payload,
  } as unknown as BlueprintGenerationEvent;
}

describe("deriveVersionTreeLayout", () => {
  it("builds a depth layout and sorts siblings by branchedAt falling back to createdAt", () => {
    const layout = deriveVersionTreeLayout([
      job("branch-late", {
        parentJobId: "root",
        branchedAt: "2026-05-23T03:00:00.000Z",
      }),
      job("root", { stage: "route_generation" }),
      job("branch-early", {
        parentJobId: "root",
        branchedAt: "2026-05-23T01:00:00.000Z",
      }),
      job("branch-fallback", {
        parentJobId: "root",
        createdAt: "2026-05-23T02:00:00.000Z",
      }),
    ]);

    expect(layout.roots.map((node) => node.job.id)).toEqual(["root"]);
    expect(layout.nodesById["root"].depth).toBe(0);
    expect(layout.nodesById["branch-early"].depth).toBe(1);
    expect(layout.nodesById["root"].children.map((node) => node.job.id)).toEqual([
      "branch-early",
      "branch-fallback",
      "branch-late",
    ]);
  });

  it("keeps missing-parent jobs visible as roots and guards parent cycles", () => {
    const layout = deriveVersionTreeLayout([
      job("orphan", { parentJobId: "missing-parent" }),
      job("cycle-a", { parentJobId: "cycle-b" }),
      job("cycle-b", { parentJobId: "cycle-a" }),
    ]);

    expect(layout.roots.map((node) => node.job.id).sort()).toEqual([
      "cycle-a",
      "cycle-b",
      "orphan",
    ]);
    expect(layout.nodesById["orphan"].missingParent).toBe(true);
    expect(layout.nodesById["cycle-a"].cycleDetected).toBe(true);
    expect(layout.warnings).toContainEqual(
      expect.objectContaining({ type: "cycle", jobId: "cycle-a" }),
    );
  });
});

describe("<CompareView>", () => {
  it("compares stages by fresh, stale, missing, and timestamp without payload diffing", () => {
    const left = job("left", {
      artifacts: [
        artifact("route-left", "route_set", "2026-05-23T01:00:00.000Z"),
        artifact("tree-left", "spec_tree", "2026-05-23T02:00:00.000Z", {
          staleSince: "2026-05-23T04:00:00.000Z",
          invalidatedBy: {
            stage: "route_generation",
            artifactId: "route-left",
            artifactType: "route_set",
            reason: "upstream_route_selection_changed",
            triggeredAt: "2026-05-23T04:00:00.000Z",
          },
        }),
      ],
    });
    const right = job("right", {
      artifacts: [
        artifact("tree-right", "spec_tree", "2026-05-23T03:00:00.000Z"),
      ],
    });

    const markup = renderToStaticMarkup(
      <CompareView leftJob={left} rightJob={right} familyJobIds={["left", "right"]} />,
    );

    expect(markup).toContain('data-testid="version-compare-view"');
    expect(markup).toContain('data-stage="route_generation"');
    expect(markup).toContain("fresh");
    expect(markup).toContain("stale");
    expect(markup).toContain("—");
    expect(markup).toContain("2026-05-23T02:00:00.000Z");
    expect(markup).not.toContain("payload");
  });

  it("rejects comparisons for jobs outside the current family", () => {
    const markup = renderToStaticMarkup(
      <CompareView
        leftJob={job("left")}
        rightJob={job("external")}
        familyJobIds={["left"]}
      />,
    );

    expect(markup).toContain('data-state="cross-family"');
    expect(markup).toContain("not in the current family");
  });
});

describe("<ReplanTimelineView>", () => {
  it("renders only replan.triggered events newest first", () => {
    const markup = renderToStaticMarkup(
      <ReplanTimelineView
        events={[
          event("old", "replan.triggered", "2026-05-23T01:00:00.000Z", "old replan"),
          event("ignore", "job.stage", "2026-05-23T04:00:00.000Z", "stage changed"),
          event("new", "replan.triggered", "2026-05-23T03:00:00.000Z", "new replan"),
        ]}
      />,
    );

    expect(markup).toContain('data-testid="replan-timeline-view"');
    expect(markup).toContain("new replan");
    expect(markup).toContain("old replan");
    expect(markup).not.toContain("stage changed");
    expect(markup.indexOf("new replan")).toBeLessThan(markup.indexOf("old replan"));
  });

  it("renders safe timeline details with truncated plain-text reasons", () => {
    const longReason = `<script>alert(1)</script>${"x".repeat(210)}`;
    const markup = renderToStaticMarkup(
      <ReplanTimelineView
        events={[
          event(
            "event-branch",
            "replan.triggered",
            "2026-05-23T03:00:00.000Z",
            "branch replan",
            {
              mode: "branch",
              parentJobId: "job-root",
              fromStage: "spec_docs",
              triggeredAt: "2026-05-23T03:00:00.000Z",
              inheritedUpstreamArtifactCount: 2,
              reason: longReason,
            },
          ),
        ]}
      />,
    );

    expect(markup).toContain("branch");
    expect(markup).toContain("job-root");
    expect(markup).toContain("spec_docs");
    expect(markup).toContain("2");
    expect(markup).toContain("...");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});

describe("<VersionTreeView> and <TreeNode>", () => {
  it("renders a family-of-one as a single active node", () => {
    const markup = renderToStaticMarkup(
      <VersionTreeView jobs={[job("solo")]} activeJobId="solo" onSelectJob={() => {}} />,
    );

    expect(markup).toContain('data-testid="version-tree-view"');
    expect(markup).toContain('data-state="single"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain("solo");
  });

  it("renders parent-to-branch connections with active, stale, and branch metadata", () => {
    const markup = renderToStaticMarkup(
      <VersionTreeView
        jobs={[
          job("root"),
          job("branch", {
            parentJobId: "root",
            branchedAt: "2026-05-23T05:00:00.000Z",
            branchedFromStage: "spec_docs",
            staleArtifactIds: ["artifact-1"],
          }),
        ]}
        activeJobId="branch"
        onSelectJob={() => {}}
      />,
    );

    expect(markup).toContain('data-connection="root-&gt;branch"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('data-stale="true"');
    expect(markup).toContain("spec_docs");
    expect(markup).toContain("2026-05-23T05:00:00.000Z");
  });

  it("selects a node by click, Enter, and Space", () => {
    const onSelect = vi.fn();
    const node = deriveVersionTreeLayout([job("branch")]).nodesById["branch"];
    const element = TreeNode({ node, activeJobId: "root", onSelect }) as React.ReactElement<{
      onClick: () => void;
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
    }>;
    const preventDefault = vi.fn();

    element.props.onClick();
    element.props.onKeyDown({ key: "Enter", preventDefault });
    element.props.onKeyDown({ key: " ", preventDefault });

    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenCalledWith("branch");
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
});

describe("use-switch-active-job", () => {
  it("executes apply directly when no coordinator is provided", async () => {
    const apply = vi.fn();

    await executeSwitchActiveJob({
      job: job("branch", { stage: "effect_preview" }),
      apply,
    });

    expect(apply).toHaveBeenCalledWith({
      jobId: "branch",
      stage: "effect_preview",
    });
  });

  it("submits a narrow switch_active payload when a coordinator is provided", async () => {
    const apply = vi.fn();
    const submit = vi.fn(async (payload) => {
      payload.apply();
    });

    await executeSwitchActiveJob({
      fromJob: job("root", { stage: "spec_docs" }),
      job: job("branch", { stage: "engineering_handoff" }),
      apply,
      coordinator: { submit },
      pageTransition: { fromPage: 2, toPage: 3 },
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "switch_active",
        apply: expect.any(Function),
        stageTransition: {
          fromStage: "spec_docs",
          toStage: "engineering_handoff",
        },
        pageTransition: { fromPage: 2, toPage: 3 },
      }),
    );
    expect(apply).toHaveBeenCalledWith({
      jobId: "branch",
      stage: "engineering_handoff",
    });
  });

  it("builds the activeJob URL query without dropping existing history state", () => {
    expect(withActiveJobSearchParam("?history=1&panel=timeline", "job branch")).toBe(
      "?history=1&panel=timeline&activeJob=job+branch",
    );
    expect(withActiveJobSearchParam("", "job-2")).toBe("?activeJob=job-2");
  });

  it("applies switch-active navigation state in one narrow frontend-only write", async () => {
    const setActiveJobId = vi.fn();
    const resetSubStagePin = vi.fn();
    const setWorkflowStageOverride = vi.fn();
    const updateUrl = vi.fn();
    const refreshJob = vi.fn();
    const apply = createSwitchActiveNavigationApply({
      setActiveJobId,
      resetSubStagePin,
      setWorkflowStageOverride,
      updateUrl,
      refreshJob,
    });

    await apply({ jobId: "branch", stage: "effect_preview" });

    expect(setActiveJobId).toHaveBeenCalledWith("branch");
    expect(resetSubStagePin).toHaveBeenCalledOnce();
    expect(setWorkflowStageOverride).toHaveBeenCalledWith("effect_preview");
    expect(updateUrl).toHaveBeenCalledWith("branch");
    expect(refreshJob).toHaveBeenCalledWith("branch");
  });

  it("rejects cross-family switch attempts without applying state", async () => {
    const apply = vi.fn();
    const onRejected = vi.fn();
    const switchActive = createSwitchActiveJobHandler({
      jobs: [job("root"), job("branch", { parentJobId: "root" })],
      apply,
      onRejected,
    });

    await expect(switchActive("external")).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith("external", "not_in_family");
  });

  it("exports the React hook entrypoint for future route wiring", () => {
    expect(typeof useSwitchActiveJob).toBe("function");
  });
});

describe("use-family-data", () => {
  it("does not call the family backend when remote fetches are disabled", async () => {
    const fetchFamily = vi.fn();
    const initialData = {
      rootJobId: "root",
      jobs: [job("root")],
      replanEvents: [],
    };

    const state = await loadBlueprintFamilyData({
      jobId: "root",
      disableRemoteFetch: true,
      initialData,
      fetchFamily,
    });

    expect(fetchFamily).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: "static_unsupported",
      data: initialData,
      error: null,
      loading: false,
    });
  });

  it("loads the active job family through the injectable fetcher", async () => {
    const family = {
      rootJobId: "root",
      jobs: [job("root"), job("branch", { parentJobId: "root" })],
      replanEvents: [event("replan-1", "replan.triggered", "2026-05-23T05:00:00.000Z", "branch")],
    };
    const fetchFamily = vi.fn(async () => ({ ok: true as const, data: family }));

    const state = await loadBlueprintFamilyData({
      jobId: "branch",
      fetchFamily,
    });

    expect(fetchFamily).toHaveBeenCalledWith("branch", undefined);
    expect(state).toMatchObject({
      status: "ready",
      data: family,
      error: null,
      loading: false,
    });
  });

  it("exports the React hook entrypoint for future route wiring", () => {
    expect(typeof useFamilyData).toBe("function");
  });
});

describe("<HistoryEntryPoint>", () => {
  it("keeps the manual entry disabled in static preview mode", () => {
    const onOpen = vi.fn();
    const element = HistoryEntryPoint({
      jobId: "job-1",
      staticPreview: true,
      onOpen,
    }) as React.ReactElement<{ onClick: () => void }>;
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('data-openable="false"');
    element.props.onClick();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders a distinct manual history entry without replan or edit DOM markers", () => {
    const onOpen = vi.fn();
    const element = HistoryEntryPoint({
      jobId: "job-1",
      familyCount: 3,
      staleCount: 1,
      onOpen,
    }) as React.ReactElement<{ onClick: () => void }>;
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('data-testid="autopilot-history-entry"');
    expect(markup).toContain('data-history-entry="true"');
    expect(markup).not.toContain("replan");
    expect(markup).not.toContain("edit");

    expect(onOpen).not.toHaveBeenCalled();
    element.props.onClick();
    expect(onOpen).toHaveBeenCalledWith("job-1");
  });
});
