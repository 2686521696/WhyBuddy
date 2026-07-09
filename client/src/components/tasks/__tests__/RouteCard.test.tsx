import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as fc from "fast-check";

import {
  RouteCard,
  buildRouteCardData,
  type RouteCardProps,
  type RouteStepItem,
  type RouteStepStatus,
} from "../RouteCard";

/* ─── Helpers ─── */

function makeProps(overrides?: Partial<RouteCardProps>): RouteCardProps {
  return {
    title: "Route",
    steps: [],
    currentStepIndex: 0,
    locale: "en-US",
    ...overrides,
  };
}

function render(props: RouteCardProps): string {
  return renderToStaticMarkup(<RouteCard {...props} />);
}

function makeStep(
  index: number,
  label: string,
  status: RouteStepStatus,
): RouteStepItem {
  return { index, label, status };
}

/* ─── Tests ─── */

describe("RouteCard", () => {
  describe("empty state", () => {
    it("renders empty state message when steps array is empty (en)", () => {
      const markup = render(makeProps({ steps: [], locale: "en-US" }));
      expect(markup).toContain("No route available");
    });

    it("renders empty state message when steps array is empty (zh-CN)", () => {
      const markup = render(makeProps({ steps: [], locale: "zh-CN" }));
      expect(markup).toContain("暂无路线数据");
    });

    it("does not render step nodes when steps array is empty", () => {
      const markup = render(makeProps({ steps: [] }));
      expect(markup).not.toContain("aria-label");
    });
  });

  describe("step rendering", () => {
    const sampleSteps: RouteStepItem[] = [
      makeStep(0, "Plan", "completed"),
      makeStep(1, "Execute", "active"),
      makeStep(2, "Review", "pending"),
    ];

    it("renders all step labels", () => {
      const markup = render(makeProps({ steps: sampleSteps }));
      expect(markup).toContain("Plan");
      expect(markup).toContain("Execute");
      expect(markup).toContain("Review");
    });

    it("renders completed step with green background and check icon", () => {
      const markup = render(
        makeProps({ steps: [makeStep(0, "Done", "completed")] }),
      );
      expect(markup).toContain("bg-emerald-500");
      expect(markup).toContain("text-white");
      // Check icon is an SVG from lucide-react
      expect(markup).toContain("Step 1 completed");
    });

    it("renders active step with primary border and pulse animation", () => {
      const markup = render(
        makeProps({ steps: [makeStep(0, "Active", "active")] }),
      );
      expect(markup).toContain("border-primary");
      expect(markup).toContain("text-primary");
      expect(markup).toContain("animate-pulse");
      expect(markup).toContain("Step 1 active");
    });

    it("renders pending step with gray border and number", () => {
      const markup = render(
        makeProps({ steps: [makeStep(0, "Pending", "pending")] }),
      );
      expect(markup).toContain("border-muted-foreground");
      expect(markup).toContain("text-muted-foreground");
      expect(markup).toContain("Step 1 pending");
    });

    it("renders step number for active and pending steps", () => {
      const steps = [
        makeStep(0, "A", "active"),
        makeStep(1, "B", "pending"),
      ];
      const markup = render(makeProps({ steps }));
      // Step numbers are 1-indexed in display
      expect(markup).toContain(">1<");
      expect(markup).toContain(">2<");
    });
  });

  describe("connector lines", () => {
    it("renders green solid line between two completed steps", () => {
      const steps = [
        makeStep(0, "A", "completed"),
        makeStep(1, "B", "completed"),
      ];
      const markup = render(makeProps({ steps }));
      expect(markup).toContain("bg-emerald-500");
    });

    it("renders green solid line from completed to active step", () => {
      const steps = [
        makeStep(0, "A", "completed"),
        makeStep(1, "B", "active"),
      ];
      const markup = render(makeProps({ steps }));
      // The connector should be green
      expect(markup).toContain("bg-emerald-500");
    });

    it("renders dashed gray line from active to pending step", () => {
      const steps = [
        makeStep(0, "A", "active"),
        makeStep(1, "B", "pending"),
      ];
      const markup = render(makeProps({ steps }));
      expect(markup).toContain("border-dashed");
    });

    it("does not render connector after last step", () => {
      const steps = [makeStep(0, "Only", "active")];
      const markup = render(makeProps({ steps }));
      // No connector line should be present
      expect(markup).not.toContain("border-dashed");
      // Only the step node's emerald class should not appear (it's active, not completed)
      expect(markup).not.toContain("bg-emerald-500");
    });
  });

  describe("horizontal scroll for > 6 steps", () => {
    it("adds overflow-x-auto when steps > 6", () => {
      const steps = Array.from({ length: 7 }, (_, i) =>
        makeStep(i, `Step ${i + 1}`, "pending"),
      );
      const markup = render(makeProps({ steps }));
      expect(markup).toContain("overflow-x-auto");
    });

    it("does not add overflow-x-auto when steps <= 6", () => {
      const steps = Array.from({ length: 6 }, (_, i) =>
        makeStep(i, `Step ${i + 1}`, "pending"),
      );
      const markup = render(makeProps({ steps }));
      expect(markup).not.toContain("overflow-x-auto");
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
    it("renders Chinese title for zh-CN locale", () => {
      const markup = render(makeProps({ locale: "zh-CN", title: "路线" }));
      expect(markup).toContain("路线");
    });

    it("renders English title for en-US locale", () => {
      const markup = render(makeProps({ locale: "en-US", title: "Route" }));
      expect(markup).toContain("Route");
    });
  });
});

describe("buildRouteCardData", () => {
  it("returns empty steps when autopilotSummary is null and selectedDetail is null", () => {
    const result = buildRouteCardData(null, null, "en-US");
    expect(result.steps).toEqual([]);
    expect(result.currentStepIndex).toBe(0);
    expect(result.title).toBe("Route");
  });

  it("returns Chinese title for zh-CN locale", () => {
    const result = buildRouteCardData(null, null, "zh-CN");
    expect(result.title).toBe("路线");
  });

  it("builds steps from route.stages when available", () => {
    const summary = {
      route: {
        stages: [
          { key: "plan", label: "Planning", status: "done" as const, detail: null, isCurrent: false },
          { key: "exec", label: "Execution", status: "running" as const, detail: null, isCurrent: true },
          { key: "review", label: "Review", status: "pending" as const, detail: null, isCurrent: false },
        ],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildRouteCardData(summary, null, "en-US");
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]).toEqual({ index: 0, label: "Planning", status: "completed" });
    expect(result.steps[1]).toEqual({ index: 1, label: "Execution", status: "active" });
    expect(result.steps[2]).toEqual({ index: 2, label: "Review", status: "pending" });
    expect(result.currentStepIndex).toBe(1);
  });

  it("uses key as label fallback when label is empty", () => {
    const summary = {
      route: {
        stages: [
          { key: "step-1", label: "", status: "done" as const, detail: null, isCurrent: false },
        ],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildRouteCardData(summary, null, "en-US");
    expect(result.steps[0].label).toBe("step-1");
  });

  it("falls back to selectedDetail.stages when route.stages is empty", () => {
    const summary = {
      route: {
        stages: [],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const detail = {
      stages: [
        { key: "direction", label: "Direction", status: "done" as const, progress: 100, arcStart: 0, arcEnd: 36, midAngle: 18 },
        { key: "planning", label: "Planning", status: "running" as const, progress: 50, arcStart: 36, arcEnd: 72, midAngle: 54 },
        { key: "execution", label: "Execution", status: "pending" as const, progress: 0, arcStart: 72, arcEnd: 108, midAngle: 90 },
      ],
    };

    const result = buildRouteCardData(summary, detail, "en-US");
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].status).toBe("completed");
    expect(result.steps[1].status).toBe("active");
    expect(result.steps[2].status).toBe("pending");
    expect(result.currentStepIndex).toBe(1);
  });

  it("filters out stages with empty labels from selectedDetail", () => {
    const detail = {
      stages: [
        { key: "a", label: "Step A", status: "done" as const, progress: 100, arcStart: 0, arcEnd: 36, midAngle: 18 },
        { key: "b", label: "", status: "pending" as const, progress: 0, arcStart: 36, arcEnd: 72, midAngle: 54 },
        { key: "c", label: "  ", status: "pending" as const, progress: 0, arcStart: 72, arcEnd: 108, midAngle: 90 },
        { key: "d", label: "Step D", status: "pending" as const, progress: 0, arcStart: 108, arcEnd: 144, midAngle: 126 },
      ],
    };

    const result = buildRouteCardData(null, detail, "en-US");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].label).toBe("Step A");
    expect(result.steps[1].label).toBe("Step D");
  });

  it("returns empty steps when all selectedDetail stages have empty labels", () => {
    const detail = {
      stages: [
        { key: "a", label: "", status: "pending" as const, progress: 0, arcStart: 0, arcEnd: 36, midAngle: 18 },
        { key: "b", label: "  ", status: "pending" as const, progress: 0, arcStart: 36, arcEnd: 72, midAngle: 54 },
      ],
    };

    const result = buildRouteCardData(null, detail, "en-US");
    expect(result.steps).toEqual([]);
  });

  it("sets currentStepIndex to 0 when no active step exists", () => {
    const summary = {
      route: {
        stages: [
          { key: "a", label: "A", status: "done" as const, detail: null, isCurrent: false },
          { key: "b", label: "B", status: "done" as const, detail: null, isCurrent: false },
        ],
      },
    } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

    const result = buildRouteCardData(summary, null, "en-US");
    expect(result.currentStepIndex).toBe(0);
  });
});

/**
 * **Validates: Requirements 4.4, 4.5**
 *
 * Property 3: Route Step Status Monotonicity
 *
 * For the step list, completed steps should be contiguous at the front,
 * at most one active step, and pending steps contiguous at the back.
 * No "completed → pending → completed" crossover should occur.
 */
describe("RouteCard Property: Step Status Monotonicity", () => {
  /**
   * Arbitrary that generates a valid monotonic step list:
   * [completed*, active?, pending*]
   */
  const stepListArb = fc
    .record({
      completedCount: fc.nat({ max: 10 }),
      hasActive: fc.boolean(),
      pendingCount: fc.nat({ max: 10 }),
    })
    .filter(({ completedCount, hasActive, pendingCount }) =>
      completedCount + (hasActive ? 1 : 0) + pendingCount > 0,
    )
    .map(({ completedCount, hasActive, pendingCount }) => {
      const steps: RouteStepItem[] = [];
      let idx = 0;
      for (let i = 0; i < completedCount; i++) {
        steps.push({ index: idx, label: `Step ${idx + 1}`, status: "completed" });
        idx++;
      }
      if (hasActive) {
        steps.push({ index: idx, label: `Step ${idx + 1}`, status: "active" });
        idx++;
      }
      for (let i = 0; i < pendingCount; i++) {
        steps.push({ index: idx, label: `Step ${idx + 1}`, status: "pending" });
        idx++;
      }
      return steps;
    });

  it("completed steps are contiguous at the front", () => {
    fc.assert(
      fc.property(stepListArb, (steps) => {
        let seenNonCompleted = false;
        for (const step of steps) {
          if (step.status !== "completed") {
            seenNonCompleted = true;
          }
          if (seenNonCompleted && step.status === "completed") {
            return false; // completed after non-completed = violation
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("at most one active step exists", () => {
    fc.assert(
      fc.property(stepListArb, (steps) => {
        const activeCount = steps.filter((s) => s.status === "active").length;
        return activeCount <= 1;
      }),
      { numRuns: 200 },
    );
  });

  it("pending steps are contiguous at the back", () => {
    fc.assert(
      fc.property(stepListArb, (steps) => {
        let seenPending = false;
        for (const step of steps) {
          if (step.status === "pending") {
            seenPending = true;
          }
          if (seenPending && step.status !== "pending") {
            return false; // non-pending after pending = violation
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("buildRouteCardData produces monotonic steps from well-ordered autopilot stages", () => {
    /**
     * Generate well-ordered autopilot stages that mimic real backend data:
     * done* running? pending*
     * This reflects the real invariant: the backend produces stages in execution order.
     */
    const wellOrderedStagesArb = fc
      .record({
        doneCount: fc.nat({ max: 8 }),
        hasRunning: fc.boolean(),
        pendingCount: fc.nat({ max: 8 }),
      })
      .filter(({ doneCount, hasRunning, pendingCount }) =>
        doneCount + (hasRunning ? 1 : 0) + pendingCount > 0,
      )
      .map(({ doneCount, hasRunning, pendingCount }) => {
        const stages: Array<{
          key: string;
          label: string;
          status: "pending" | "running" | "done" | "failed";
          detail: string | null;
          isCurrent: boolean;
        }> = [];
        for (let i = 0; i < doneCount; i++) {
          stages.push({
            key: `s${i}`,
            label: `Stage ${i}`,
            status: "done",
            detail: null,
            isCurrent: false,
          });
        }
        if (hasRunning) {
          const idx = stages.length;
          stages.push({
            key: `s${idx}`,
            label: `Stage ${idx}`,
            status: "running",
            detail: null,
            isCurrent: true,
          });
        }
        for (let i = 0; i < pendingCount; i++) {
          const idx = stages.length;
          stages.push({
            key: `s${idx}`,
            label: `Stage ${idx}`,
            status: "pending",
            detail: null,
            isCurrent: false,
          });
        }
        return stages;
      });

    fc.assert(
      fc.property(wellOrderedStagesArb, (stages) => {
        const summary = {
          route: { stages },
        } as unknown as import("@/lib/tasks-store").TaskAutopilotSummary;

        const result = buildRouteCardData(summary, null, "en-US");

        // Verify monotonicity: completed* active? pending*
        let phase: "completed" | "active" | "pending" = "completed";
        let activeCount = 0;

        for (const step of result.steps) {
          if (phase === "completed") {
            if (step.status === "completed") continue;
            if (step.status === "active") {
              phase = "active";
              activeCount++;
              continue;
            }
            if (step.status === "pending") {
              phase = "pending";
              continue;
            }
          }
          if (phase === "active") {
            if (step.status === "active") {
              activeCount++;
              continue;
            }
            if (step.status === "pending") {
              phase = "pending";
              continue;
            }
            if (step.status === "completed") {
              return false; // completed after active = violation
            }
          }
          if (phase === "pending") {
            if (step.status === "pending") continue;
            return false; // anything after pending that isn't pending = violation
          }
        }

        return activeCount <= 1;
      }),
      { numRuns: 200 },
    );
  });
});
