import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockedRealtime = vi.hoisted(() => ({
  state: {
    subscribedJobId: "job-realtime-stats",
    specDocsProgress: {
      batchStatus: "running",
      totalCount: 10,
      completedCount: 10,
      assembledCount: 0,
      processedCount: 10,
      nodeOrder: [],
      nodes: {},
      summary: null,
      dismissed: false,
    },
    agentReasoning: { entries: [] as unknown[] },
    rolePhases: {} as Record<string, unknown>,
    agentProgress: [] as unknown[],
    capabilityStatuses: {} as Record<string, unknown>,
  },
}));

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((
    selector?: (state: unknown) => unknown
  ) => {
    return selector ? selector(mockedRealtime.state) : mockedRealtime.state;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { AutopilotSpecDocumentsWorkbench } from "../AutopilotSpecDocumentsWorkbench";
import type { AutopilotSpecDocumentsWorkbenchProps } from "../AutopilotSpecDocumentsWorkbench";

function makeSpecTree(): NonNullable<
  AutopilotSpecDocumentsWorkbenchProps["specTree"]
> {
  return {
    id: "tree-realtime-stats",
    rootNodeId: "node-1",
    nodes: Array.from({ length: 10 }, (_, index) => ({
      id: `node-${index + 1}`,
      title: `Node ${index + 1}`,
      summary: "Node summary",
      type: "route_step",
      status: "draft",
      priority: index + 1,
      dependencies: [],
      outputs: [],
      children: [],
    })),
  } as unknown as NonNullable<AutopilotSpecDocumentsWorkbenchProps["specTree"]>;
}

describe("AutopilotSpecDocumentsWorkbench realtime stats", () => {
  it("uses specDocsProgress for bottom status counts while all-doc generation is in flight", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbench
        entries={[]}
        specDocuments={[]}
        specTree={makeSpecTree()}
        locale="zh-CN"
        generating="all"
        jobId="job-realtime-stats"
        job={
          {
            id: "job-realtime-stats",
            artifacts: [],
          } as unknown as AutopilotSpecDocumentsWorkbenchProps["job"]
        }
      />
    );

    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-docs"[^>]*>30 \/ 30</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-tasks"[^>]*>10 \/ 10</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-doctype-card-requirements"[\s\S]*>10 \/ 0</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-completion"[^>]*>0%<\/span>/
    );
  });
});
