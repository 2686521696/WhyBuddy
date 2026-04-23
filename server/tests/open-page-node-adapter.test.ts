import { describe, expect, it, vi } from "vitest";

import { executeOpenPageNode } from "../routes/node-adapters/open-page-node-adapter.js";

function makeDeps(overrides?: {
  withPermissionEngine?: boolean;
  permission?: {
    allowed: boolean;
    reason?: string;
    suggestion?: string;
  };
}) {
  return {
    ...(overrides?.withPermissionEngine
      ? {
          permissionEngine: {
            checkPermission: vi.fn(() => ({
              allowed: overrides?.permission?.allowed ?? true,
              reason: overrides?.permission?.reason,
              suggestion: overrides?.permission?.suggestion,
            })),
          },
        }
      : {}),
  };
}

describe("executeOpenPageNode", () => {
  it("returns an internal route target with params and query passthrough", async () => {
    const deps = makeDeps();

    const result = await executeOpenPageNode(
      {
        nodeType: "open_page",
        input: {
          pageId: "mission-detail",
          route: "/missions/:missionId",
          title: "任务详情",
          params: {
            missionId: "mission-1",
          },
          query: {
            tab: "timeline",
            from: "agent-panel",
          },
          context: {
            workflowId: "wf-1",
            sourceNodeId: "open-page-node-1",
          },
        },
      },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.target).toEqual({
      kind: "internal_route",
      pageId: "mission-detail",
      href: "/missions/mission-1?tab=timeline&from=agent-panel",
      route: "/missions/mission-1",
      params: {
        missionId: "mission-1",
      },
      query: {
        tab: "timeline",
        from: "agent-panel",
      },
      title: "任务详情",
      openMode: "push",
    });
    expect(result.output.payload).toEqual({
      params: {
        missionId: "mission-1",
      },
      query: {
        tab: "timeline",
        from: "agent-panel",
      },
      context: {
        workflowId: "wf-1",
        sourceNodeId: "open-page-node-1",
      },
    });
  });

  it("returns an external target description consumable by the frontend shell", async () => {
    const deps = makeDeps();

    const result = await executeOpenPageNode(
      {
        nodeType: "open_page",
        input: {
          pageId: "docs-home",
          href: "https://docs.example.com/start",
          targetKind: "external_url",
          openMode: "new_tab",
          query: {
            utm_source: "cube",
          },
        },
      },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(result.output.target).toEqual({
      kind: "external_url",
      pageId: "docs-home",
      href: "https://docs.example.com/start?utm_source=cube",
      route: "/external",
      params: {},
      query: {
        utm_source: "cube",
      },
      openMode: "new_tab",
      external: true,
    });
  });

  it("returns denied when permission engine blocks page opening", async () => {
    const deps = makeDeps({
      withPermissionEngine: true,
      permission: {
        allowed: false,
        reason: "No allow rule found for api:call",
        suggestion: "Request open_page permission",
      },
    });

    const result = await executeOpenPageNode(
      {
        nodeType: "open_page",
        input: {
          pageId: "mission-detail",
          route: "/missions/:missionId",
          params: {
            missionId: "mission-1",
          },
          agentId: "agent-1",
          token: "token-1",
        },
      },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.output.status).toBe("denied");
    expect(result.output.error).toContain("No allow rule found");
    expect(result.output.governance.permission).toEqual({
      allowed: false,
      reason: "No allow rule found for api:call",
      suggestion: "Request open_page permission",
    });
  });

  it("requires a resolvable target descriptor", async () => {
    await expect(
      executeOpenPageNode({
        nodeType: "open_page",
        input: {
          query: {
            tab: "overview",
          },
        },
      }),
    ).rejects.toThrow("pageId, route, or href");
  });
});
