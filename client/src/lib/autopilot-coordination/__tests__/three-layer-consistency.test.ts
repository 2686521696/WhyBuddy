import { afterEach, describe, expect, it, vi } from "vitest";

import { checkThreeLayerConsistency } from "../ThreeLayerConsistencyChecker.js";

describe("ThreeLayerConsistencyChecker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows legal review override states without warnings or corrections", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();

    const result = checkThreeLayerConsistency(
      {
        urlPin: "spec_tree",
        workflowStageOverride: "input",
        activeJobStage: "runtime_capability",
      },
      {
        resetPin,
        fallbackWorkflowStageOverride,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.warned).toBe(false);
    expect(result.reviewOverride).toBe(true);
    expect(result.mismatchReason).toBeNull();
    expect(result.correctedTo).toBeNull();
    expect(resetPin).not.toHaveBeenCalled();
    expect(fallbackWorkflowStageOverride).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats same-page review between spec_tree and spec_docs as legal", () => {
    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();

    const result = checkThreeLayerConsistency(
      {
        urlPin: "spec_documents",
        workflowStageOverride: "spec_tree",
        activeJobStage: "spec_docs",
      },
      {
        resetPin,
        fallbackWorkflowStageOverride,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.warned).toBe(false);
    expect(result.reviewOverride).toBe(true);
    expect(resetPin).not.toHaveBeenCalled();
    expect(fallbackWorkflowStageOverride).not.toHaveBeenCalled();
  });

  it("resets illegal downstream pins and leaves legal overrides alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();

    const result = checkThreeLayerConsistency(
      {
        urlPin: "engineering_handoff",
        workflowStageOverride: "input",
        activeJobStage: "spec_tree",
      },
      {
        resetPin,
        fallbackWorkflowStageOverride,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.warned).toBe(true);
    expect(result.mismatchReason).toBe("illegal_url_pin");
    expect(result.correctedTo).toBe("spec_tree");
    expect(resetPin).toHaveBeenCalledTimes(1);
    expect(fallbackWorkflowStageOverride).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("coordination.three_layer_mismatch", {
      event: "coordination.three_layer_mismatch",
      urlPin: "engineering_handoff",
      workflowStageOverride: "input",
      activeJobStage: "spec_tree",
      mismatchReason: "illegal_url_pin",
      correctedTo: "spec_tree",
    });
  });

  it("falls back illegal downstream overrides without mutating backend stage", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();

    const result = checkThreeLayerConsistency(
      {
        urlPin: "input",
        workflowStageOverride: "engineering_landing",
        activeJobStage: "clarification",
      },
      {
        resetPin,
        fallbackWorkflowStageOverride,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.warned).toBe(true);
    expect(result.mismatchReason).toBe("illegal_workflow_stage_override");
    expect(result.correctedTo).toBe("clarification");
    expect(resetPin).not.toHaveBeenCalled();
    expect(fallbackWorkflowStageOverride).toHaveBeenCalledTimes(1);
    expect(fallbackWorkflowStageOverride).toHaveBeenCalledWith("clarification");
  });

  it("reports a failed correction when the check exceeds the frame budget", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(101);

    const result = checkThreeLayerConsistency(
      {
        urlPin: "engineering_landing",
        workflowStageOverride: "runtime_capability",
        activeJobStage: "spec_docs",
      },
      {
        resetPin,
        fallbackWorkflowStageOverride,
        now,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.elapsedMs).toBe(101);
    expect(result.mismatchReason).toBe(
      "illegal_url_pin_and_workflow_stage_override"
    );
    expect(resetPin).toHaveBeenCalledTimes(1);
    expect(fallbackWorkflowStageOverride).toHaveBeenCalledWith("spec_docs");
  });

  it("is idempotent after the caller applies the correction", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let urlPin: string | null = "engineering_landing";
    let workflowStageOverride: string | null = "runtime_capability";
    const activeJobStage = "spec_tree";

    const first = checkThreeLayerConsistency(
      {
        urlPin,
        workflowStageOverride,
        activeJobStage,
      },
      {
        resetPin: () => {
          urlPin = null;
        },
        fallbackWorkflowStageOverride: stage => {
          workflowStageOverride = stage;
        },
      }
    );
    const second = checkThreeLayerConsistency(
      {
        urlPin,
        workflowStageOverride,
        activeJobStage,
      },
      {
        resetPin: () => {
          throw new Error("resetPin should not run twice");
        },
        fallbackWorkflowStageOverride: () => {
          throw new Error("fallback should not run twice");
        },
      }
    );

    expect(first.warned).toBe(true);
    expect(second).toMatchObject({
      ok: true,
      warned: false,
      reviewOverride: false,
      mismatchReason: null,
      correctedTo: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
  it("returns ok without warnings when all three layers already match", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();

    const result = checkThreeLayerConsistency(
      {
        urlPin: "spec_docs",
        workflowStageOverride: "spec_docs",
        activeJobStage: "spec_docs",
      },
      {
        resetPin,
        fallbackWorkflowStageOverride,
      }
    );

    expect(result).toMatchObject({
      ok: true,
      warned: false,
      reviewOverride: false,
      mismatchReason: null,
      correctedTo: null,
    });
    expect(resetPin).not.toHaveBeenCalled();
    expect(fallbackWorkflowStageOverride).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
