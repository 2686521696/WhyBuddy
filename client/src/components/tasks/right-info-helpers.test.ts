import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatRelativeTime,
  deriveSubMetrics,
  dotColorClass,
  prepareTimelineEvents,
} from "./right-info-helpers";
import type {
  MissionTaskDetail,
  TaskAutopilotSummary,
  TaskTimelineEvent,
} from "@/lib/tasks-store";

/* ------------------------------------------------------------------ */
/*  Minimal factory helpers                                            */
/* ------------------------------------------------------------------ */

function makeEvent(overrides: Partial<TaskTimelineEvent> = {}): TaskTimelineEvent {
  return {
    id: "evt-1",
    type: "log",
    time: Date.now(),
    level: "info",
    title: "Test event",
    description: "desc",
    ...overrides,
  };
}

/** Minimal MissionTaskDetail stub with only the fields deriveSubMetrics needs. */
function makeDetail(
  overrides: Partial<
    Pick<MissionTaskDetail, "stages" | "taskCount" | "completedTaskCount">
  > = {},
): MissionTaskDetail {
  return {
    stages: [],
    taskCount: 0,
    completedTaskCount: 0,
    ...overrides,
  } as unknown as MissionTaskDetail;
}

/* ================================================================== */
/*  formatDuration                                                     */
/* ================================================================== */

describe("formatDuration", () => {
  it("returns '—' for NaN", () => {
    expect(formatDuration(NaN)).toBe("—");
  });

  it("returns '—' for negative values", () => {
    expect(formatDuration(-1000)).toBe("—");
  });

  it("returns '—' for Infinity", () => {
    expect(formatDuration(Infinity)).toBe("—");
  });

  it("returns '0s' for 0ms", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns seconds for < 60s (e.g. 59s)", () => {
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("returns 'Xm Ys' for durations under 1h", () => {
    expect(formatDuration(5 * 60_000 + 30_000)).toBe("5m 30s");
  });

  it("returns 'Xh Ym' for 1h", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m");
  });

  it("returns 'Xh Ym' for 25h (still under 48h but >= 24h → days)", () => {
    // 25h = 1d 1h
    expect(formatDuration(25 * 3_600_000)).toBe("1d 1h");
  });

  it("returns 'Xd Yh' for 3d", () => {
    expect(formatDuration(3 * 86_400_000)).toBe("3d 0h");
  });

  it("returns 'Xd Yh' for 3d 5h", () => {
    expect(formatDuration(3 * 86_400_000 + 5 * 3_600_000)).toBe("3d 5h");
  });
});

/* ================================================================== */
/*  formatRelativeTime                                                 */
/* ================================================================== */

describe("formatRelativeTime", () => {
  it("returns '—' for 0", () => {
    expect(formatRelativeTime(0)).toBe("—");
  });

  it("returns '—' for NaN", () => {
    expect(formatRelativeTime(NaN)).toBe("—");
  });

  it("returns '—' for negative timestamp", () => {
    expect(formatRelativeTime(-1)).toBe("—");
  });

  it("returns minutes ago for recent timestamps (en-US)", () => {
    const fiveMinAgo = Date.now() - 5 * 60_000;
    expect(formatRelativeTime(fiveMinAgo, "en-US")).toBe("5m ago");
  });

  it("returns minutes ago for recent timestamps (zh-CN)", () => {
    const threeMinAgo = Date.now() - 3 * 60_000;
    expect(formatRelativeTime(threeMinAgo, "zh-CN")).toBe("3分钟前");
  });

  it("returns hours ago for timestamps within 48h", () => {
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    expect(formatRelativeTime(twoHoursAgo, "en-US")).toBe("2h ago");
  });

  it("returns days ago for timestamps older than 48h", () => {
    const threeDaysAgo = Date.now() - 3 * 86_400_000;
    expect(formatRelativeTime(threeDaysAgo, "en-US")).toBe("3d ago");
  });
});

/* ================================================================== */
/*  deriveSubMetrics                                                   */
/* ================================================================== */

describe("deriveSubMetrics", () => {
  it("uses autopilot route stages when available (priority 1)", () => {
    const detail = makeDetail({ taskCount: 10, completedTaskCount: 5 });
    const autopilot = {
      route: {
        stages: [
          { key: "s1", label: "Planning", status: "done" as const, detail: null, isCurrent: false },
          { key: "s2", label: "Execution", status: "running" as const, detail: null, isCurrent: true },
          { key: "s3", label: "Review", status: "pending" as const, detail: null, isCurrent: false },
        ],
      },
    } as unknown as TaskAutopilotSummary;

    const result = deriveSubMetrics(detail, autopilot);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ label: "Planning", value: 100 });
    expect(result[1]).toEqual({ label: "Execution", value: 50 });
    expect(result[2]).toEqual({ label: "Review", value: 0 });
  });

  it("limits autopilot route stages to 4", () => {
    const detail = makeDetail();
    const autopilot = {
      route: {
        stages: [
          { key: "s1", label: "A", status: "done" as const, detail: null, isCurrent: false },
          { key: "s2", label: "B", status: "done" as const, detail: null, isCurrent: false },
          { key: "s3", label: "C", status: "running" as const, detail: null, isCurrent: true },
          { key: "s4", label: "D", status: "pending" as const, detail: null, isCurrent: false },
          { key: "s5", label: "E", status: "pending" as const, detail: null, isCurrent: false },
        ],
      },
    } as unknown as TaskAutopilotSummary;

    const result = deriveSubMetrics(detail, autopilot);
    expect(result).toHaveLength(4);
  });

  it("uses detail stages when autopilot has no route stages (priority 2)", () => {
    const detail = makeDetail({
      stages: [
        { key: "stage-a", label: "Design", status: "done", progress: 100, arcStart: 0, arcEnd: 90, midAngle: 45 },
        { key: "stage-b", label: "Build", status: "running", progress: 60, arcStart: 90, arcEnd: 180, midAngle: 135 },
      ] as MissionTaskDetail["stages"],
      taskCount: 10,
      completedTaskCount: 5,
    });

    const result = deriveSubMetrics(detail, undefined);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ label: "Design", value: 100 });
    expect(result[1]).toEqual({ label: "Build", value: 60 });
  });

  it("falls back to completedTaskCount/taskCount (priority 3)", () => {
    const detail = makeDetail({
      taskCount: 10,
      completedTaskCount: 7,
    });

    const result = deriveSubMetrics(detail, undefined, "en-US");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ label: "Tasks Done", value: 70 });
  });

  it("falls back with zh-CN locale label", () => {
    const detail = makeDetail({
      taskCount: 4,
      completedTaskCount: 1,
    });

    const result = deriveSubMetrics(detail, undefined, "zh-CN");
    expect(result[0].label).toBe("任务完成");
    expect(result[0].value).toBe(25);
  });

  it("handles taskCount=0 without division by zero", () => {
    const detail = makeDetail({ taskCount: 0, completedTaskCount: 0 });
    const result = deriveSubMetrics(detail, undefined);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it("returns at least one SubMetric when autopilot is null", () => {
    const detail = makeDetail({ taskCount: 1, completedTaskCount: 0 });
    const result = deriveSubMetrics(detail, undefined);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */
/*  dotColorClass                                                      */
/* ================================================================== */

describe("dotColorClass", () => {
  it("maps 'info' to blue", () => {
    expect(dotColorClass("info")).toBe("bg-blue-500");
  });

  it("maps 'success' to green", () => {
    expect(dotColorClass("success")).toBe("bg-green-500");
  });

  it("maps 'warning' to amber", () => {
    expect(dotColorClass("warning")).toBe("bg-amber-500");
  });

  it("maps 'warn' to amber (alias)", () => {
    expect(dotColorClass("warn")).toBe("bg-amber-500");
  });

  it("maps 'error' to red", () => {
    expect(dotColorClass("error")).toBe("bg-red-500");
  });

  it("maps unknown level to muted-foreground gray", () => {
    expect(dotColorClass("unknown")).toBe("bg-[var(--muted-foreground)]");
  });

  it("maps empty string to muted-foreground gray", () => {
    expect(dotColorClass("")).toBe("bg-[var(--muted-foreground)]");
  });

  it("always returns a non-empty string", () => {
    for (const level of ["info", "success", "warning", "error", "debug", "trace", ""]) {
      const result = dotColorClass(level);
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    }
  });
});

/* ================================================================== */
/*  prepareTimelineEvents                                              */
/* ================================================================== */

describe("prepareTimelineEvents", () => {
  it("sorts events by time descending (newest first)", () => {
    const events = [
      makeEvent({ id: "a", time: 1000 }),
      makeEvent({ id: "b", time: 3000 }),
      makeEvent({ id: "c", time: 2000 }),
    ];

    const result = prepareTimelineEvents(events, 10);
    expect(result.map(e => e.id)).toEqual(["b", "c", "a"]);
  });

  it("truncates to maxCount", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, time: i * 1000 }),
    );

    const result = prepareTimelineEvents(events, 5);
    expect(result).toHaveLength(5);
    // Should be the 5 most recent (highest time values)
    expect(result[0].id).toBe("evt-19");
    expect(result[4].id).toBe("evt-15");
  });

  it("returns all events when count <= maxCount", () => {
    const events = [
      makeEvent({ id: "a", time: 1000 }),
      makeEvent({ id: "b", time: 2000 }),
    ];

    const result = prepareTimelineEvents(events, 10);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(prepareTimelineEvents([], 10)).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const events = [
      makeEvent({ id: "a", time: 1000 }),
      makeEvent({ id: "b", time: 3000 }),
      makeEvent({ id: "c", time: 2000 }),
    ];
    const originalOrder = events.map(e => e.id);

    prepareTimelineEvents(events, 10);
    expect(events.map(e => e.id)).toEqual(originalOrder);
  });
});
