import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_TRANSITION_DURATION_MS,
  createPageTransitionChoreographer,
} from "../PageTransitionChoreographer.js";

describe("PageTransitionChoreographer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not start a page animation for the same page", () => {
    const choreographer = createPageTransitionChoreographer({
      prefersReducedMotion: () => false,
    });

    const result = choreographer.transition(2, 2);

    expect(result.started).toBe(false);
    expect(choreographer.getState()).toEqual({
      inFlight: false,
      direction: null,
      prevPage: null,
      nextPage: null,
    });
  });

  it("keeps snapshot identity stable when no page transition emits", () => {
    const choreographer = createPageTransitionChoreographer({
      prefersReducedMotion: () => false,
    });

    const first = choreographer.getState();
    const second = choreographer.getState();

    expect(second).toBe(first);
  });

  it("derives forward and backward directions from page order", () => {
    const choreographer = createPageTransitionChoreographer({
      prefersReducedMotion: () => false,
    });

    expect(choreographer.transition(1, 3)).toMatchObject({
      started: true,
      direction: "forward",
    });
    expect(choreographer.getState()).toMatchObject({
      inFlight: true,
      direction: "forward",
      prevPage: 1,
      nextPage: 3,
    });

    vi.advanceTimersByTime(PAGE_TRANSITION_DURATION_MS);

    expect(choreographer.transition(3, 1)).toMatchObject({
      started: true,
      direction: "backward",
    });
    expect(choreographer.getState()).toMatchObject({
      direction: "backward",
      prevPage: 3,
      nextPage: 1,
    });
  });

  it("finishes immediately when reduced motion is preferred", () => {
    const choreographer = createPageTransitionChoreographer({
      prefersReducedMotion: () => true,
    });

    const result = choreographer.transition(1, 3);

    expect(result).toMatchObject({
      started: true,
      direction: "forward",
      reducedMotion: true,
    });
    expect(choreographer.getState()).toMatchObject({
      inFlight: false,
      direction: "forward",
      prevPage: 1,
      nextPage: 3,
    });
  });

  it("aborts an in-flight page transition before starting the next one", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const choreographer = createPageTransitionChoreographer({
      prefersReducedMotion: () => false,
    });

    choreographer.transition(1, 3);
    choreographer.transition(3, 1);

    expect(debug).toHaveBeenCalledWith("coordination.animation_aborted", {
      previousTrigger: "1->3",
      newTrigger: "3->1",
      elapsedMs: expect.any(Number),
    });
    expect(choreographer.getState()).toMatchObject({
      inFlight: true,
      direction: "backward",
      prevPage: 3,
      nextPage: 1,
    });
  });
});
