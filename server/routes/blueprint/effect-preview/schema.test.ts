import { describe, it, expect } from "vitest";
import { EffectPreviewLlmResponseSchema } from "./schema.js";

/**
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 9.2
 *
 * ~14 example-based unit tests covering the zod strict schema for the
 * Effect Preview LLM response payload, including:
 *  - Minimal + full valid payloads
 *  - Top-level bounds (summary / architectureNotes / prototypeNotes / progressPlan)
 *  - `.superRefine()` cross-field invariants (trim non-empty, case-insensitive
 *    unique `progressPlan[].title`, case-insensitive unique `logTimeline[].id`)
 *  - runtimeProjection / hudState bounds and enum constraints
 *  - consoleLines / logTimeline bounds and level enum
 *  - Optional browserPreview + unknown top-level field strip behavior
 */

// ---------------------------------------------------------------------------
// Factory helpers: build a baseline valid payload, then mutate per test case.
// ---------------------------------------------------------------------------

interface BuildPayloadOverrides {
  summary?: unknown;
  architectureNotes?: unknown;
  prototypeNotes?: unknown;
  progressPlan?: unknown;
  runtimeProjection?: unknown;
  extra?: Record<string, unknown>;
}

function buildMinimalPayload(overrides: BuildPayloadOverrides = {}) {
  const base = {
    summary: "Baseline preview summary for validation tests.",
    architectureNotes: ["Anchor implementation around the primary route."],
    prototypeNotes: ["Render hero cockpit with HUD badges."],
    progressPlan: [
      {
        title: "Ship beta",
        summary: "Deliver the first releasable cockpit slice.",
        target: "Internal demo milestone",
      },
    ],
    runtimeProjection: {
      hudState: {
        title: "Release Dashboard HUD",
        summary: "HUD surfaces progress, risk and takeover.",
        progressPercent: 42,
      },
      consoleLines: ["preview: cockpit boot sequence ready"],
      logTimeline: [
        {
          level: "info" as const,
          message: "preview: cockpit log stream initialized",
        },
      ],
    },
    ...(overrides.extra ?? {}),
  };

  const merged: Record<string, unknown> = { ...base };

  if ("summary" in overrides) merged.summary = overrides.summary;
  if ("architectureNotes" in overrides)
    merged.architectureNotes = overrides.architectureNotes;
  if ("prototypeNotes" in overrides)
    merged.prototypeNotes = overrides.prototypeNotes;
  if ("progressPlan" in overrides) merged.progressPlan = overrides.progressPlan;
  if ("runtimeProjection" in overrides)
    merged.runtimeProjection = overrides.runtimeProjection;

  return merged;
}

function buildMilestone(title: string) {
  return {
    title,
    summary: `Summary for ${title}.`,
    target: `Target for ${title}.`,
  };
}

function buildLogEntry(level: "info" | "warning" | "success", index: number) {
  return {
    level,
    message: `preview: log entry #${index}`,
  };
}

function issuesContain(
  result: ReturnType<typeof EffectPreviewLlmResponseSchema.safeParse>,
  needle: string,
): boolean {
  if (result.success) return false;
  return result.error.issues.some((issue) => issue.message.includes(needle));
}

// ---------------------------------------------------------------------------
// 4.1 — Minimal valid payload
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.1 minimal valid payload", () => {
  it("accepts the baseline minimal payload", () => {
    const result = EffectPreviewLlmResponseSchema.safeParse(
      buildMinimalPayload(),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4.2 — Full valid payload at upper bounds
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.2 full valid payload", () => {
  it("accepts a payload at architecture/prototype/progressPlan/consoleLines/logTimeline upper bounds with all optional fields", () => {
    const architectureNotes = Array.from(
      { length: 8 },
      (_, i) => `architecture note ${i + 1}`,
    );
    const prototypeNotes = Array.from(
      { length: 12 },
      (_, i) => `prototype note ${i + 1}`,
    );
    const progressPlan = Array.from({ length: 20 }, (_, i) =>
      buildMilestone(`Milestone ${i + 1}`),
    );
    const consoleLines = Array.from(
      { length: 40 },
      (_, i) => `preview: console line ${i + 1}`,
    );
    const levels: Array<"info" | "warning" | "success"> = [
      "info",
      "warning",
      "success",
    ];
    const logTimeline = Array.from({ length: 40 }, (_, i) => ({
      id: `log-${i + 1}`,
      level: levels[i % levels.length],
      message: `preview: log timeline entry ${i + 1}`,
      timestamp: `2026-05-07T00:00:${String(i % 60).padStart(2, "0")}Z`,
    }));

    const payload = {
      summary: "Full payload covering every optional field and upper bound.",
      architectureNotes,
      prototypeNotes,
      progressPlan,
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          status: "preview" as const,
          stage: "effect_preview" as const,
          progressPercent: 100,
          activeNodeId: "node-hero-cockpit",
          badges: ["ready", "hero", "verified"],
        },
        consoleLines,
        logTimeline,
        browserPreview: {
          title: "Browser preview surface",
          summary: "Browser projection of the cockpit.",
          url: "https://example.com/preview",
        },
      },
    };

    const result = EffectPreviewLlmResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4.3 — `summary` missing / empty / whitespace
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.3 summary invariants", () => {
  it("fails when summary is missing", () => {
    const payload = buildMinimalPayload({ summary: undefined });
    delete (payload as { summary?: unknown }).summary;
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when summary is an empty string", () => {
    const payload = buildMinimalPayload({ summary: "" });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when summary is whitespace-only (.superRefine)", () => {
    const payload = buildMinimalPayload({ summary: "     " });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.4 — architectureNotes / prototypeNotes / progressPlan length bounds
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.4 top-level array length bounds", () => {
  it("fails when architectureNotes is empty", () => {
    const payload = buildMinimalPayload({ architectureNotes: [] });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when architectureNotes exceeds 8 entries", () => {
    const payload = buildMinimalPayload({
      architectureNotes: Array.from(
        { length: 9 },
        (_, i) => `architecture note ${i + 1}`,
      ),
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when prototypeNotes is empty", () => {
    const payload = buildMinimalPayload({ prototypeNotes: [] });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when prototypeNotes exceeds 12 entries", () => {
    const payload = buildMinimalPayload({
      prototypeNotes: Array.from(
        { length: 13 },
        (_, i) => `prototype note ${i + 1}`,
      ),
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when progressPlan is empty", () => {
    const payload = buildMinimalPayload({ progressPlan: [] });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when progressPlan exceeds 20 entries", () => {
    const payload = buildMinimalPayload({
      progressPlan: Array.from({ length: 21 }, (_, i) =>
        buildMilestone(`Milestone ${i + 1}`),
      ),
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.5 — progressPlan[*].title missing + case-insensitive duplicate
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.5 progressPlan title invariants", () => {
  it("fails when progressPlan[*].title is missing", () => {
    const milestoneWithoutTitle = {
      summary: "Summary without a title.",
      target: "Target without a title.",
    };
    const payload = buildMinimalPayload({
      progressPlan: [milestoneWithoutTitle],
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it('fails with "duplicated" message when two titles clash case-insensitively ("Ship" + "ship")', () => {
    const payload = buildMinimalPayload({
      progressPlan: [buildMilestone("Ship"), buildMilestone("ship")],
    });
    const result = EffectPreviewLlmResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(issuesContain(result, "duplicated")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4.6 — runtimeProjection / hudState presence + hudState.title invariants
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.6 runtimeProjection/hudState presence", () => {
  it("fails when runtimeProjection is missing", () => {
    const payload = buildMinimalPayload({ runtimeProjection: undefined });
    delete (payload as { runtimeProjection?: unknown }).runtimeProjection;
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when runtimeProjection.hudState is missing", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when hudState.title is missing", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when hudState.title is empty", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when hudState.title is whitespace-only (.superRefine)", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "     ",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.7 — hudState.progressPercent bounds
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.7 hudState.progressPercent bounds", () => {
  it("fails when progressPercent is -1", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: -1,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when progressPercent is 101", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 101,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.8 — hudState.status enum
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.8 hudState.status enum", () => {
  it('fails when status = "unknown"', () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
          status: "unknown",
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it.each(["preview", "completed"] as const)(
    "accepts status = %s",
    (status) => {
      const payload = buildMinimalPayload({
        runtimeProjection: {
          hudState: {
            title: "Release Dashboard HUD",
            summary: "HUD surfaces progress, risk and takeover.",
            progressPercent: 42,
            status,
          },
          consoleLines: ["preview: cockpit boot sequence ready"],
          logTimeline: [
            {
              level: "info" as const,
              message: "preview: cockpit log stream initialized",
            },
          ],
        },
      });
      expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
        true,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// 4.9 — hudState.stage enum
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.9 hudState.stage enum", () => {
  it('fails when stage = "invalid_stage"', () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
          stage: "invalid_stage",
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  const validStages = [
    "intake",
    "routeset",
    "spec_tree",
    "spec_document",
    "effect_preview",
    "prompt_package",
    "engineering_handoff",
  ] as const;

  it.each(validStages)("accepts stage = %s", (stage) => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
          stage,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.10 — consoleLines bounds + whitespace entry
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.10 consoleLines bounds/whitespace", () => {
  function buildPayloadWithConsoleLines(consoleLines: unknown) {
    return buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines,
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
      },
    });
  }

  it("fails when consoleLines is empty", () => {
    const payload = buildPayloadWithConsoleLines([]);
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when consoleLines exceeds 40 entries", () => {
    const payload = buildPayloadWithConsoleLines(
      Array.from({ length: 41 }, (_, i) => `preview: console line ${i + 1}`),
    );
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when a consoleLines entry is whitespace-only (.superRefine)", () => {
    const payload = buildPayloadWithConsoleLines(["     "]);
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.11 — logTimeline bounds + level enum + message non-empty
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.11 logTimeline bounds/level/message", () => {
  function buildPayloadWithLogTimeline(logTimeline: unknown) {
    return buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline,
      },
    });
  }

  it("fails when logTimeline is empty", () => {
    const payload = buildPayloadWithLogTimeline([]);
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when logTimeline exceeds 40 entries", () => {
    const payload = buildPayloadWithLogTimeline(
      Array.from({ length: 41 }, (_, i) => buildLogEntry("info", i)),
    );
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it('fails when level = "debug"', () => {
    const payload = buildPayloadWithLogTimeline([
      { level: "debug", message: "preview: invalid level entry" },
    ]);
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when message is empty", () => {
    const payload = buildPayloadWithLogTimeline([
      { level: "info", message: "" },
    ]);
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.12 — logTimeline[*].id case-insensitive uniqueness
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.12 logTimeline id uniqueness", () => {
  it('fails with "duplicated logTimeline id" when ids collide case-insensitively', () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          { id: "log-alpha", level: "info", message: "first entry" },
          { id: "LOG-ALPHA", level: "warning", message: "second entry" },
        ],
      },
    });
    const result = EffectPreviewLlmResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(issuesContain(result, "duplicated logTimeline id")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4.13 — browserPreview optional + title/url constraints
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.13 browserPreview", () => {
  it("accepts the payload when browserPreview is omitted", () => {
    const result = EffectPreviewLlmResponseSchema.safeParse(
      buildMinimalPayload(),
    );
    expect(result.success).toBe(true);
  });

  it("fails when browserPreview.title is empty", () => {
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
        browserPreview: {
          title: "",
          summary: "Browser projection of the cockpit.",
        },
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when browserPreview.url length is 1025 (> 1024)", () => {
    const longUrl = `https://example.com/${"a".repeat(1025 - "https://example.com/".length)}`;
    expect(longUrl.length).toBe(1025);
    const payload = buildMinimalPayload({
      runtimeProjection: {
        hudState: {
          title: "Release Dashboard HUD",
          summary: "HUD surfaces progress, risk and takeover.",
          progressPercent: 42,
        },
        consoleLines: ["preview: cockpit boot sequence ready"],
        logTimeline: [
          {
            level: "info" as const,
            message: "preview: cockpit log stream initialized",
          },
        ],
        browserPreview: {
          title: "Browser preview surface",
          summary: "Browser projection of the cockpit.",
          url: longUrl,
        },
      },
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4.14 — string out-of-bounds + unknown top-level field is stripped
// ---------------------------------------------------------------------------

describe("EffectPreviewLlmResponseSchema — 4.14 string bounds + strip unknown", () => {
  it("fails when summary.length is 501", () => {
    const payload = buildMinimalPayload({ summary: "a".repeat(501) });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it("fails when architectureNotes[0].length is 401", () => {
    const payload = buildMinimalPayload({
      architectureNotes: ["a".repeat(401)],
    });
    expect(EffectPreviewLlmResponseSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  it('strips an unknown top-level field (author: "alice") without affecting success', () => {
    const payload = buildMinimalPayload({ extra: { author: "alice" } });
    const result = EffectPreviewLlmResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).author).toBeUndefined();
    }
  });
});
