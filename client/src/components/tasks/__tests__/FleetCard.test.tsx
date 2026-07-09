import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FleetCard,
  buildFleetCardData,
  type FleetCardProps,
  type FleetMemberItem,
} from "../FleetCard";

/* ─── Helpers ─── */

function makeProps(overrides?: Partial<FleetCardProps>): FleetCardProps {
  return {
    title: "Fleet Execution",
    members: [],
    locale: "en-US",
    ...overrides,
  };
}

function render(props: FleetCardProps): string {
  return renderToStaticMarkup(<FleetCard {...props} />);
}

/* ─── Tests ─── */

describe("FleetCard", () => {
  describe("empty state", () => {
    it("renders empty state message when members array is empty (en)", () => {
      const markup = render(makeProps({ members: [], locale: "en-US" }));
      expect(markup).toContain("No fleet available");
    });

    it("renders empty state message when members array is empty (zh-CN)", () => {
      const markup = render(makeProps({ members: [], locale: "zh-CN" }));
      expect(markup).toContain("暂无编队数据");
    });

    it("does not render member cards when members array is empty", () => {
      const markup = render(makeProps({ members: [] }));
      // Should not contain the member card background class
      expect(markup).not.toContain("bg-muted/50");
    });
  });

  describe("normal members rendering", () => {
    const sampleMembers: FleetMemberItem[] = [
      { id: "r-1", role: "Planner", roleType: "planner", status: "running", label: "Planner" },
      { id: "r-2", role: "Executor", roleType: "executor", status: "idle", label: "Executor" },
      { id: "r-3", role: "Reviewer", roleType: "reviewer", status: "waiting", label: "Reviewer" },
    ];

    it("renders all member labels", () => {
      const markup = render(makeProps({ members: sampleMembers }));
      expect(markup).toContain("Planner");
      expect(markup).toContain("Executor");
      expect(markup).toContain("Reviewer");
    });

    it("does not render empty state when members are present", () => {
      const markup = render(makeProps({ members: sampleMembers }));
      expect(markup).not.toContain("No fleet available");
      expect(markup).not.toContain("暂无编队数据");
    });

    it("renders correct number of member cards", () => {
      const markup = render(makeProps({ members: sampleMembers }));
      // Each member card has the bg-muted/50 class
      const matches = markup.match(/bg-muted\/50/g);
      expect(matches).toHaveLength(3);
    });
  });

  describe("status indicator colors", () => {
    it("renders green dot for running status", () => {
      const markup = render(
        makeProps({
          members: [{ id: "1", role: "R", roleType: "planner", status: "running", label: "R" }],
        }),
      );
      expect(markup).toContain("bg-emerald-500");
    });

    it("renders gray dot for idle status", () => {
      const markup = render(
        makeProps({
          members: [{ id: "1", role: "R", roleType: "planner", status: "idle", label: "R" }],
        }),
      );
      expect(markup).toContain("bg-slate-300");
    });

    it("renders amber dot for waiting status", () => {
      const markup = render(
        makeProps({
          members: [{ id: "1", role: "R", roleType: "planner", status: "waiting", label: "R" }],
        }),
      );
      expect(markup).toContain("bg-amber-400");
    });

    it("renders red dot for blocked status", () => {
      const markup = render(
        makeProps({
          members: [{ id: "1", role: "R", roleType: "planner", status: "blocked", label: "R" }],
        }),
      );
      expect(markup).toContain("bg-red-500");
    });

    it("renders red dot for failed status", () => {
      const markup = render(
        makeProps({
          members: [{ id: "1", role: "R", roleType: "planner", status: "failed", label: "R" }],
        }),
      );
      expect(markup).toContain("bg-red-500");
    });

    it("renders gray dot for done status", () => {
      const markup = render(
        makeProps({
          members: [{ id: "1", role: "R", roleType: "planner", status: "done", label: "R" }],
        }),
      );
      expect(markup).toContain("bg-slate-400");
    });
  });

  describe("layout", () => {
    it("uses flex-wrap for horizontal layout", () => {
      const members: FleetMemberItem[] = [
        { id: "1", role: "A", roleType: "planner", status: "running", label: "A" },
        { id: "2", role: "B", roleType: "executor", status: "idle", label: "B" },
      ];
      const markup = render(makeProps({ members }));
      expect(markup).toContain("flex-wrap");
    });
  });

  describe("design tokens", () => {
    it("uses card background and foreground tokens", () => {
      const markup = render(makeProps());
      expect(markup).toContain("bg-card");
      expect(markup).toContain("text-card-foreground");
    });

    it("uses border token", () => {
      const markup = render(makeProps());
      expect(markup).toContain("border");
    });

    it("uses rounded-lg for border radius", () => {
      const markup = render(makeProps());
      expect(markup).toContain("rounded-lg");
    });
  });
});

describe("buildFleetCardData", () => {
  it("returns empty members when autopilotSummary is null and selectedDetail is null", () => {
    const result = buildFleetCardData(null, null, "en-US");
    expect(result.members).toEqual([]);
    expect(result.title).toBe("Fleet Execution");
  });

  it("returns Chinese title for zh-CN locale", () => {
    const result = buildFleetCardData(null, null, "zh-CN");
    expect(result.title).toBe("编队执行");
  });

  it("builds members from fleet.roles when available", () => {
    const summary = {
      fleet: {
        roles: [
          {
            id: "role-1",
            roleType: "planner",
            title: "Planner",
            status: "running",
            responsibility: "Plans tasks",
            boundAgents: [],
            boundExecutors: [],
            currentFocus: null,
          },
          {
            id: "role-2",
            roleType: "executor",
            title: "Executor",
            status: "idle",
            responsibility: "Executes tasks",
            boundAgents: [],
            boundExecutors: [],
            currentFocus: null,
          },
        ],
        activeRoleCount: 1,
        blockedRoleCount: 0,
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildFleetCardData(summary, null, "en-US");
    expect(result.members).toHaveLength(2);
    expect(result.members[0].id).toBe("role-1");
    expect(result.members[0].role).toBe("Planner");
    expect(result.members[0].roleType).toBe("planner");
    expect(result.members[0].status).toBe("running");
    expect(result.members[1].id).toBe("role-2");
    expect(result.members[1].status).toBe("idle");
  });

  it("falls back to departmentLabels when fleet.roles is empty", () => {
    const summary = {
      fleet: {
        roles: [],
        activeRoleCount: 0,
        blockedRoleCount: 0,
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const detail = {
      departmentLabels: ["Engineering", "Design"],
    } as unknown as import("@/lib/tasks-store").MissionTaskDetail;

    const result = buildFleetCardData(summary, detail, "en-US");
    expect(result.members).toHaveLength(2);
    expect(result.members[0].label).toBe("Engineering");
    expect(result.members[0].roleType).toBe("custom");
    expect(result.members[0].status).toBe("idle");
    expect(result.members[1].label).toBe("Design");
  });

  it("falls back to departmentLabels when autopilotSummary is null", () => {
    const detail = {
      departmentLabels: ["QA"],
    } as unknown as import("@/lib/tasks-store").MissionTaskDetail;

    const result = buildFleetCardData(null, detail, "en-US");
    expect(result.members).toHaveLength(1);
    expect(result.members[0].label).toBe("QA");
  });

  it("returns empty members when all sources are empty", () => {
    const summary = {
      fleet: {
        roles: [],
        activeRoleCount: 0,
        blockedRoleCount: 0,
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const detail = {
      departmentLabels: [],
    } as unknown as import("@/lib/tasks-store").MissionTaskDetail;

    const result = buildFleetCardData(summary, detail, "en-US");
    expect(result.members).toEqual([]);
  });

  it("uses roleType as fallback label when title is empty", () => {
    const summary = {
      fleet: {
        roles: [
          {
            id: "role-1",
            roleType: "researcher",
            title: "",
            status: "running",
            responsibility: "",
            boundAgents: [],
            boundExecutors: [],
            currentFocus: null,
          },
        ],
        activeRoleCount: 1,
        blockedRoleCount: 0,
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildFleetCardData(summary, null, "en-US");
    expect(result.members[0].label).toBe("researcher");
    expect(result.members[0].role).toBe("researcher");
  });
});
