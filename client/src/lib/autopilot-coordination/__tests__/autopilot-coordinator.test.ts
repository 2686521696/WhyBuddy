import { afterEach, describe, expect, it, vi } from "vitest";

import { createAutopilotCoordinator } from "../AutopilotCoordinator.js";
import { createToastQueue } from "../ToastQueue.js";

describe("AutopilotCoordinator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits the synchronous apply path, enqueues toast, and returns success", () => {
    const toastQueue = createToastQueue();
    const apply = vi.fn();
    const stageAnimator = { transition: vi.fn() };
    const pageChoreographer = { transition: vi.fn() };
    const readThreeLayerSnapshot = vi.fn(() => ({
      urlPin: "spec_tree",
      workflowStageOverride: "input",
      activeJobStage: "runtime_capability",
    }));
    const resetPin = vi.fn();
    const fallbackWorkflowStageOverride = vi.fn();

    const coordinator = createAutopilotCoordinator({
      toastQueue,
      readThreeLayerSnapshot,
      consistencyActions: {
        resetPin,
        fallbackWorkflowStageOverride,
      },
      stageAnimator,
      pageChoreographer,
    });

    const result = coordinator.submit({
      triggerSource: "replan",
      apply,
      toastPayload: {
        key: "replan-success",
        level: "info",
        message: "replan finished",
      },
      stageTransition: {
        fromStage: "input",
        toStage: "clarification",
      },
      pageTransition: {
        fromPage: 1,
        toPage: 1,
      },
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.warned).toBe(false);
    expect(toastQueue.peekVisible()).toMatchObject({
      key: "replan-success",
      level: "info",
      message: "replan finished",
    });
    expect(resetPin).not.toHaveBeenCalled();
    expect(fallbackWorkflowStageOverride).not.toHaveBeenCalled();
    expect(stageAnimator.transition).toHaveBeenCalledWith("input", "clarification");
    expect(pageChoreographer.transition).not.toHaveBeenCalled();
  });

  it("uses the page choreographer for cross-page transitions", () => {
    const stageAnimator = { transition: vi.fn() };
    const pageChoreographer = { transition: vi.fn() };
    const coordinator = createAutopilotCoordinator({
      readThreeLayerSnapshot: () => ({
        urlPin: null,
        workflowStageOverride: null,
        activeJobStage: "runtime_capability",
      }),
      stageAnimator,
      pageChoreographer,
    });

    const result = coordinator.submit({
      triggerSource: "switch_active",
      apply: () => undefined,
      stageTransition: {
        fromStage: "runtime_capability",
        toStage: "input",
      },
      pageTransition: {
        fromPage: 3,
        toPage: 1,
      },
    });

    expect(result.ok).toBe(true);
    expect(pageChoreographer.transition).toHaveBeenCalledWith(3, 1);
    expect(stageAnimator.transition).not.toHaveBeenCalled();
  });

  it("returns a warning result when the consistency checker resets an illegal pin", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const toastQueue = createToastQueue();
    const coordinator = createAutopilotCoordinator({
      toastQueue,
      readThreeLayerSnapshot: () => ({
        urlPin: "engineering_handoff",
        workflowStageOverride: "input",
        activeJobStage: "spec_tree",
      }),
    });

    const result = coordinator.submit({
      triggerSource: "inline_edit",
      apply: () => undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.warned).toBe(true);
    expect(result.consistency?.mismatchReason).toBe("illegal_url_pin");
    expect(result.consistency?.correctedTo).toBe("spec_tree");
    expect(result.failure).toBeUndefined();
  });

  it("reports atomic refresh failures and enqueues a single error toast", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const toastQueue = createToastQueue();
    const coordinator = createAutopilotCoordinator({
      toastQueue,
      readThreeLayerSnapshot: () => ({
        urlPin: "spec_tree",
        workflowStageOverride: "input",
        activeJobStage: "spec_tree",
      }),
    });

    const result = coordinator.submit({
      triggerSource: "switch_active",
      apply: () => {
        throw new Error("write failed");
      },
      toastPayload: {
        key: "should-not-show",
        level: "info",
        message: "never shown",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.warned).toBe(false);
    expect(result.failure?.message).toBe("write failed");
    expect(toastQueue.peekVisible()).toMatchObject({
      key: "coordination.batch_failed.switch_active",
      level: "error",
      message: "Front-end state sync failed. Refresh the page or try again.",
    });
  });

  it("enqueues an error toast when three-layer correction exceeds budget", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const toastQueue = createToastQueue();
    const coordinator = createAutopilotCoordinator({
      toastQueue,
      readThreeLayerSnapshot: () => ({
        urlPin: "engineering_landing",
        workflowStageOverride: "runtime_capability",
        activeJobStage: "spec_tree",
      }),
      consistencyActions: {
        now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(101),
      },
    });

    const result = coordinator.submit({
      triggerSource: "replan",
      apply: () => undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe("three_layer_mismatch_failed");
    expect(toastQueue.peekVisible()).toMatchObject({
      key: "coordination.three_layer.replan",
      level: "error",
      message: "Front-end state sync failed. Refresh the page or try again.",
    });
  });
});
