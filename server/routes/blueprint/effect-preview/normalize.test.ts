import { describe, it, expect } from "vitest";
import { normalizeEffectPreviewResponse } from "./normalize.js";
import { createDefaultEffectPreviewLlmPolicy } from "./policy.js";
import type { EffectPreviewLlmResponse } from "./schema.js";

/**
 * Validates: Requirements 2.4, 2.6, 3.6
 *
 * ~6 example-based unit tests covering
 * `normalizeEffectPreviewResponse(validated, input)` (design §2.D8 /
 * §4.2 / §4.4 / §4.6):
 *
 *  8.1 Full payload with every optional field already trimmed —
 *      normalisation output is byte-equivalent to the LLM-supplied
 *      content and `renderedLogTimeline[*].id` uses the LLM-provided
 *      value verbatim (no backfill override).
 *  8.2 Missing `logTimeline[*].id` — backfilled with a
 *      `createId("blueprint-effect-preview-log")` prefix id and every
 *      synthesised id is unique within the preview.
 *  8.3 Missing `logTimeline[*].timestamp` — backfilled with
 *      `input.createdAt`.
 *  8.4 Missing `hudState.activeNodeId` — backfilled with
 *      `input.activeNodeId`.
 *  8.5 Leading / trailing whitespace in strings (summary /
 *      architectureNotes[*] / prototypeNotes[*] / progressPlan[*].title
 *      / hudState / consoleLines / logTimeline[*].message) — trimmed.
 *  8.6 `browserPreview` absent — `output.renderedBrowserPreview` is
 *      `undefined` so the outer assembly step decides whether to
 *      render the template default.
 */

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const CREATED_AT = "2026-05-07T10:30:00.000Z";
const ACTIVE_NODE_ID = "spec-tree-node-cockpit-root";

function buildNormalizeInput() {
  return {
    createdAt: CREATED_AT,
    activeNodeId: ACTIVE_NODE_ID,
    policy: createDefaultEffectPreviewLlmPolicy(),
  };
}

function buildFullValidatedPayload(): EffectPreviewLlmResponse {
  // All strings are pre-trimmed so 8.1 can assert byte-equivalence.
  return {
    summary: "Ship the cockpit preview with HUD, console and log timeline.",
    architectureNotes: [
      "Anchor implementation around the primary route steps.",
      "Keep runtime projection mutable behind the service boundary.",
    ],
    prototypeNotes: [
      "Render hero cockpit with HUD badges.",
      "Stream console lines via the runtime projection channel.",
    ],
    progressPlan: [
      {
        title: "Ship beta",
        summary: "Deliver the first releasable cockpit slice.",
        target: "Internal demo milestone",
      },
      {
        title: "Stabilise telemetry",
        summary: "Wire telemetry to the cockpit HUD badges.",
        target: "Observability review",
      },
    ],
    runtimeProjection: {
      hudState: {
        title: "Release Dashboard HUD",
        summary: "HUD surfaces progress, risk and takeover.",
        status: "preview",
        stage: "effect_preview",
        progressPercent: 42,
        activeNodeId: "llm-chosen-active-node",
        badges: ["preview", "runtime"],
      },
      consoleLines: [
        "preview: cockpit boot sequence ready",
        "preview: runtime projection warm",
      ],
      logTimeline: [
        {
          id: "llm-log-alpha",
          level: "info",
          message: "preview: cockpit log stream initialised",
          timestamp: "2026-05-07T10:31:00.000Z",
        },
        {
          id: "llm-log-beta",
          level: "warning",
          message: "preview: runtime projection degraded",
          timestamp: "2026-05-07T10:32:00.000Z",
        },
        {
          id: "llm-log-gamma",
          level: "success",
          message: "preview: takeover rehearsal passed",
          timestamp: "2026-05-07T10:33:00.000Z",
        },
      ],
      browserPreview: {
        title: "Cockpit Browser Preview",
        summary: "Browser preview mirrors the HUD state.",
        url: "https://preview.example.com/cockpit",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 8.1 Full payload with LLM-provided ids — normalize preserves content
// ---------------------------------------------------------------------------

describe("normalizeEffectPreviewResponse — full payload preservation", () => {
  it("preserves LLM content byte-for-byte and keeps LLM-provided log ids", () => {
    const validated = buildFullValidatedPayload();
    const input = buildNormalizeInput();

    const output = normalizeEffectPreviewResponse(validated, input);

    // Summary / architectureNotes / prototypeNotes preserved verbatim.
    expect(output.summary).toBe(validated.summary);
    expect(output.architectureNotes).toEqual(validated.architectureNotes);
    expect(output.prototypeNotes).toEqual(validated.prototypeNotes);

    // progressPlan content preserved (id is generated and
    // sourceDocumentIds is left empty for the outer assembly step).
    expect(output.progressPlan).toHaveLength(validated.progressPlan.length);
    for (let i = 0; i < validated.progressPlan.length; i++) {
      const milestone = output.progressPlan[i];
      const source = validated.progressPlan[i];
      expect(milestone.title).toBe(source.title);
      expect(milestone.summary).toBe(source.summary);
      expect(milestone.target).toBe(source.target);
      expect(milestone.sourceDocumentIds).toEqual([]);
      expect(milestone.id).toMatch(/^blueprint-effect-preview-milestone-/);
    }

    // HUD state preserved, including optional status / stage / badges /
    // LLM-chosen activeNodeId (not overridden by input.activeNodeId).
    expect(output.renderedHudState.title).toBe(
      validated.runtimeProjection.hudState.title,
    );
    expect(output.renderedHudState.summary).toBe(
      validated.runtimeProjection.hudState.summary,
    );
    expect(output.renderedHudState.progressPercent).toBe(
      validated.runtimeProjection.hudState.progressPercent,
    );
    expect(output.renderedHudState.status).toBe("preview");
    expect(output.renderedHudState.stage).toBe("effect_preview");
    expect(output.renderedHudState.activeNodeId).toBe(
      "llm-chosen-active-node",
    );
    expect(output.renderedHudState.badges).toEqual(["preview", "runtime"]);

    // Console lines + log timeline preserved, LLM-supplied ids kept.
    expect(output.renderedConsoleLines).toEqual(
      validated.runtimeProjection.consoleLines,
    );
    expect(output.renderedLogTimeline).toHaveLength(3);
    expect(output.renderedLogTimeline[0].id).toBe("llm-log-alpha");
    expect(output.renderedLogTimeline[1].id).toBe("llm-log-beta");
    expect(output.renderedLogTimeline[2].id).toBe("llm-log-gamma");
    expect(output.renderedLogTimeline[0].level).toBe("info");
    expect(output.renderedLogTimeline[1].level).toBe("warning");
    expect(output.renderedLogTimeline[2].level).toBe("success");
    expect(output.renderedLogTimeline[0].occurredAt).toBe(
      "2026-05-07T10:31:00.000Z",
    );
    expect(output.renderedLogTimeline[0].message).toBe(
      validated.runtimeProjection.logTimeline[0].message,
    );

    // Browser preview rendered with full payload.
    expect(output.renderedBrowserPreview).toBeDefined();
    expect(output.renderedBrowserPreview?.title).toBe(
      "Cockpit Browser Preview",
    );
    expect(output.renderedBrowserPreview?.summary).toBe(
      "Browser preview mirrors the HUD state.",
    );
    expect(output.renderedBrowserPreview?.url).toBe(
      "https://preview.example.com/cockpit",
    );
  });
});

// ---------------------------------------------------------------------------
// 8.2 Missing logTimeline[*].id — backfill with generated prefix + unique
// ---------------------------------------------------------------------------

describe("normalizeEffectPreviewResponse — logTimeline id backfill", () => {
  it("backfills missing logTimeline ids with the canonical prefix and keeps them unique", () => {
    const validated = buildFullValidatedPayload();
    // Strip all LLM-provided ids so the normaliser has to backfill.
    validated.runtimeProjection.logTimeline =
      validated.runtimeProjection.logTimeline.map((entry) => ({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
      }));

    const output = normalizeEffectPreviewResponse(
      validated,
      buildNormalizeInput(),
    );

    const ids = output.renderedLogTimeline.map((entry) => entry.id);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toMatch(/^blueprint-effect-preview-log-/);
    }
    // Every synthesised id is unique within the preview.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// 8.3 Missing logTimeline[*].timestamp — backfill with input.createdAt
// ---------------------------------------------------------------------------

describe("normalizeEffectPreviewResponse — logTimeline timestamp backfill", () => {
  it("backfills missing logTimeline timestamps with input.createdAt", () => {
    const validated = buildFullValidatedPayload();
    validated.runtimeProjection.logTimeline =
      validated.runtimeProjection.logTimeline.map((entry) => ({
        id: entry.id,
        level: entry.level,
        message: entry.message,
      }));

    const output = normalizeEffectPreviewResponse(
      validated,
      buildNormalizeInput(),
    );

    expect(output.renderedLogTimeline).toHaveLength(3);
    for (const entry of output.renderedLogTimeline) {
      expect(entry.occurredAt).toBe(CREATED_AT);
    }
  });
});

// ---------------------------------------------------------------------------
// 8.4 Missing hudState.activeNodeId — backfill with input.activeNodeId
// ---------------------------------------------------------------------------

describe("normalizeEffectPreviewResponse — hudState.activeNodeId backfill", () => {
  it("backfills missing hudState.activeNodeId with input.activeNodeId", () => {
    const validated = buildFullValidatedPayload();
    // Remove the LLM-supplied activeNodeId so the normaliser must fall
    // back to `input.activeNodeId`.
    delete validated.runtimeProjection.hudState.activeNodeId;

    const output = normalizeEffectPreviewResponse(
      validated,
      buildNormalizeInput(),
    );

    expect(output.renderedHudState.activeNodeId).toBe(ACTIVE_NODE_ID);
  });
});

// ---------------------------------------------------------------------------
// 8.5 Leading / trailing whitespace — trimmed across multiple fields
// ---------------------------------------------------------------------------

describe("normalizeEffectPreviewResponse — string trimming", () => {
  it("trims leading/trailing whitespace across summary, notes, milestones, HUD and console", () => {
    const validated: EffectPreviewLlmResponse = {
      summary: "  hello  ",
      architectureNotes: ["  architecture note one  "],
      prototypeNotes: ["  prototype note one  "],
      progressPlan: [
        {
          title: "  Ship beta  ",
          summary: "  Deliver the first cockpit slice.  ",
          target: "  Internal demo milestone  ",
        },
      ],
      runtimeProjection: {
        hudState: {
          title: "  Release Dashboard HUD  ",
          summary: "  HUD surfaces progress, risk and takeover.  ",
          progressPercent: 42,
          activeNodeId: "  active-node-from-llm  ",
          badges: ["  preview  ", "  runtime  "],
        },
        consoleLines: ["  preview: cockpit boot sequence ready  "],
        logTimeline: [
          {
            id: "  log-alpha  ",
            level: "info",
            message: "  preview: cockpit log stream initialised  ",
            timestamp: "  2026-05-07T10:31:00.000Z  ",
          },
        ],
      },
    };

    const output = normalizeEffectPreviewResponse(
      validated,
      buildNormalizeInput(),
    );

    expect(output.summary).toBe("hello");
    expect(output.architectureNotes).toEqual(["architecture note one"]);
    expect(output.prototypeNotes).toEqual(["prototype note one"]);
    expect(output.progressPlan[0].title).toBe("Ship beta");
    expect(output.progressPlan[0].summary).toBe(
      "Deliver the first cockpit slice.",
    );
    expect(output.progressPlan[0].target).toBe("Internal demo milestone");
    expect(output.renderedHudState.title).toBe("Release Dashboard HUD");
    expect(output.renderedHudState.summary).toBe(
      "HUD surfaces progress, risk and takeover.",
    );
    expect(output.renderedHudState.activeNodeId).toBe("active-node-from-llm");
    expect(output.renderedHudState.badges).toEqual(["preview", "runtime"]);
    expect(output.renderedConsoleLines).toEqual([
      "preview: cockpit boot sequence ready",
    ]);
    expect(output.renderedLogTimeline[0].id).toBe("log-alpha");
    expect(output.renderedLogTimeline[0].message).toBe(
      "preview: cockpit log stream initialised",
    );
    expect(output.renderedLogTimeline[0].occurredAt).toBe(
      "2026-05-07T10:31:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// 8.6 Missing browserPreview — output.renderedBrowserPreview === undefined
// ---------------------------------------------------------------------------

describe("normalizeEffectPreviewResponse — optional browserPreview", () => {
  it("leaves renderedBrowserPreview undefined when the LLM omits browserPreview", () => {
    const validated = buildFullValidatedPayload();
    delete validated.runtimeProjection.browserPreview;

    const output = normalizeEffectPreviewResponse(
      validated,
      buildNormalizeInput(),
    );

    expect(output.renderedBrowserPreview).toBeUndefined();
  });
});
