import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRANSITION_DURATION_MS,
  createStageTransitionAnimator,
} from "../StageTransitionAnimator.js";

describe("StageTransitionAnimator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not start an animation for the same stage", () => {
    const animator = createStageTransitionAnimator({
      prefersReducedMotion: () => false,
    });

    const result = animator.transition("spec_tree", "spec_tree");

    expect(result.started).toBe(false);
    expect(animator.getState()).toEqual({
      inFlight: false,
      direction: null,
      prevStage: null,
      nextStage: null,
    });
  });

  it("keeps snapshot identity stable when no stage transition emits", () => {
    const animator = createStageTransitionAnimator({
      prefersReducedMotion: () => false,
    });

    const first = animator.getState();
    const second = animator.getState();

    expect(second).toBe(first);
  });

  it("derives advance and retreat directions from stage order", () => {
    const animator = createStageTransitionAnimator({
      prefersReducedMotion: () => false,
    });

    expect(animator.transition("input", "spec_docs")).toMatchObject({
      started: true,
      direction: "advance",
    });
    expect(animator.getState()).toMatchObject({
      inFlight: true,
      direction: "advance",
      prevStage: "input",
      nextStage: "spec_docs",
    });

    vi.advanceTimersByTime(TRANSITION_DURATION_MS);

    expect(animator.transition("engineering_handoff", "clarification")).toMatchObject({
      started: true,
      direction: "retreat",
    });
    expect(animator.getState()).toMatchObject({
      direction: "retreat",
      prevStage: "engineering_handoff",
      nextStage: "clarification",
    });
  });

  it("finishes immediately when reduced motion is preferred", () => {
    const animator = createStageTransitionAnimator({
      prefersReducedMotion: () => true,
    });

    const result = animator.transition("input", "spec_docs");

    expect(result).toMatchObject({
      started: true,
      direction: "advance",
      reducedMotion: true,
    });
    expect(animator.getState()).toMatchObject({
      inFlight: false,
      direction: "advance",
      prevStage: "input",
      nextStage: "spec_docs",
    });
  });

  it("aborts an in-flight animation before starting the next one", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const animator = createStageTransitionAnimator({
      prefersReducedMotion: () => false,
    });

    animator.transition("input", "clarification");
    animator.transition("clarification", "effect_preview");

    expect(debug).toHaveBeenCalledWith("coordination.animation_aborted", {
      previousTrigger: "input->clarification",
      newTrigger: "clarification->effect_preview",
      elapsedMs: expect.any(Number),
    });
    expect(animator.getState()).toMatchObject({
      inFlight: true,
      direction: "advance",
      prevStage: "clarification",
      nextStage: "effect_preview",
    });
  });
});
