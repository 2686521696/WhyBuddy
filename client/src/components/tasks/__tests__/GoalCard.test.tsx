import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GoalCard,
  buildGoalCardData,
  type GoalCardProps,
  type GoalItem,
} from "../GoalCard";

/* ─── Helpers ─── */

function makeProps(overrides?: Partial<GoalCardProps>): GoalCardProps {
  return {
    title: "Goals",
    goals: [],
    overallProgress: 0,
    locale: "en-US",
    ...overrides,
  };
}

function render(props: GoalCardProps): string {
  return renderToStaticMarkup(<GoalCard {...props} />);
}

/* ─── Tests ─── */

describe("GoalCard", () => {
  describe("empty state", () => {
    it("renders empty state message when goals array is empty (en)", () => {
      const markup = render(makeProps({ goals: [], locale: "en-US" }));
      expect(markup).toContain("No goals available");
    });

    it("renders empty state message when goals array is empty (zh-CN)", () => {
      const markup = render(makeProps({ goals: [], locale: "zh-CN" }));
      expect(markup).toContain("暂无目标数据");
    });

    it("does not render list items when goals array is empty", () => {
      const markup = render(makeProps({ goals: [] }));
      expect(markup).not.toContain("<li");
    });
  });

  describe("normal goals rendering", () => {
    const sampleGoals: GoalItem[] = [
      { label: "Complete analysis", status: "completed", progress: 100 },
      { label: "Write report", status: "in_progress", progress: 50 },
      { label: "Submit review", status: "pending" },
    ];

    it("renders all goal labels", () => {
      const markup = render(makeProps({ goals: sampleGoals }));
      expect(markup).toContain("Complete analysis");
      expect(markup).toContain("Write report");
      expect(markup).toContain("Submit review");
    });

    it("renders completed status icon (✓) with green color", () => {
      const markup = render(
        makeProps({ goals: [{ label: "Done goal", status: "completed" }] }),
      );
      expect(markup).toContain("✓");
      expect(markup).toContain("text-emerald-500");
    });

    it("renders in_progress status icon (●) with blue color and animation", () => {
      const markup = render(
        makeProps({ goals: [{ label: "Active goal", status: "in_progress" }] }),
      );
      expect(markup).toContain("●");
      expect(markup).toContain("text-blue-500");
      expect(markup).toContain("animate-pulse");
    });

    it("renders pending status icon (○) with muted color", () => {
      const markup = render(
        makeProps({ goals: [{ label: "Pending goal", status: "pending" }] }),
      );
      expect(markup).toContain("○");
      expect(markup).toContain("text-muted-foreground");
    });

    it("renders progress percentage when provided", () => {
      const markup = render(
        makeProps({
          goals: [{ label: "Goal with progress", status: "in_progress", progress: 75 }],
        }),
      );
      expect(markup).toContain("75%");
    });

    it("does not render per-item progress percentage when not provided", () => {
      // Render a goal with progress and one without
      const withProgress = render(
        makeProps({
          goals: [{ label: "With progress", status: "in_progress", progress: 75 }],
        }),
      );
      const withoutProgress = render(
        makeProps({
          goals: [{ label: "Without progress", status: "pending" }],
        }),
      );
      // The one with progress should have "75%" in the goal row
      expect(withProgress).toContain("75%");
      // The one without should NOT have a per-item percentage
      expect(withoutProgress).not.toContain("75%");
    });

    it("does not render empty state when goals are present", () => {
      const markup = render(makeProps({ goals: sampleGoals }));
      expect(markup).not.toContain("No goals available");
      expect(markup).not.toContain("暂无目标数据");
    });
  });

  describe("overall progress bar", () => {
    it("renders overall progress percentage", () => {
      const markup = render(makeProps({ overallProgress: 60 }));
      expect(markup).toContain("60%");
    });

    it("clamps progress to 0-100 range", () => {
      const markupOver = render(makeProps({ overallProgress: 150 }));
      expect(markupOver).toContain("100%");

      const markupUnder = render(makeProps({ overallProgress: -10 }));
      expect(markupUnder).toContain("0%");
    });

    it("uses primary color for progress fill", () => {
      const markup = render(makeProps({ overallProgress: 50 }));
      expect(markup).toContain("bg-primary");
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

  describe("i18n", () => {
    it("renders Chinese overall progress label for zh-CN locale", () => {
      const markup = render(makeProps({ locale: "zh-CN" }));
      expect(markup).toContain("整体进度");
    });

    it("renders English overall progress label for en-US locale", () => {
      const markup = render(makeProps({ locale: "en-US" }));
      expect(markup).toContain("Overall Progress");
    });
  });
});

describe("buildGoalCardData", () => {
  it("returns empty goals when autopilotSummary is null and selectedDetail is null", () => {
    const result = buildGoalCardData(null, null, "en-US");
    expect(result.goals).toEqual([]);
    expect(result.overallProgress).toBe(0);
    expect(result.title).toBe("Goals");
  });

  it("returns Chinese title for zh-CN locale", () => {
    const result = buildGoalCardData(null, null, "zh-CN");
    expect(result.title).toBe("目标");
  });

  it("builds goals from destination.subGoals when available", () => {
    const summary = {
      destination: {
        subGoals: [
          { id: "sg-1", title: "Sub Goal 1", source: "mission-text" as const, status: "done" as const },
          { id: "sg-2", title: "Sub Goal 2", source: "mission-text" as const, status: "running" as const },
          { id: "sg-3", title: "Sub Goal 3", source: "mission-text" as const, status: null },
        ],
        successCriteria: ["Should not use this"],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildGoalCardData(summary, null, "en-US");
    expect(result.goals).toHaveLength(3);
    expect(result.goals[0].label).toBe("Sub Goal 1");
    expect(result.goals[0].status).toBe("completed");
    expect(result.goals[1].status).toBe("in_progress");
    expect(result.goals[2].status).toBe("pending");
    // 1 out of 3 completed = 33%
    expect(result.overallProgress).toBe(33);
  });

  it("falls back to successCriteria when subGoals is empty", () => {
    const summary = {
      destination: {
        subGoals: [],
        successCriteria: ["Criterion A", "Criterion B"],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildGoalCardData(summary, null, "en-US");
    expect(result.goals).toHaveLength(2);
    expect(result.goals[0].label).toBe("Criterion A");
    expect(result.goals[0].status).toBe("pending");
    expect(result.overallProgress).toBe(0);
  });

  it("falls back to selectedDetail summary when autopilot data is empty", () => {
    const summary = {
      destination: {
        subGoals: [],
        successCriteria: [],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const detail = {
      summary: "Analyze customer data",
      title: "Data Analysis Task",
      progress: 40,
    };

    const result = buildGoalCardData(summary, detail, "en-US");
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].label).toBe("Analyze customer data");
    expect(result.overallProgress).toBe(40);
  });

  it("falls back to selectedDetail title when summary is empty", () => {
    const detail = {
      summary: "",
      title: "My Task Title",
      progress: 20,
    };

    const result = buildGoalCardData(null, detail, "en-US");
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].label).toBe("My Task Title");
    expect(result.overallProgress).toBe(20);
  });

  it("returns empty goals when all sources are empty", () => {
    const summary = {
      destination: {
        subGoals: [],
        successCriteria: [],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const detail = {
      summary: "",
      title: "",
      progress: 0,
    };

    const result = buildGoalCardData(summary, detail, "en-US");
    expect(result.goals).toEqual([]);
    expect(result.overallProgress).toBe(0);
  });
});
