import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  normalizeAutopilotStage,
  type AutopilotBackendStage,
} from "./page-mapping.js";
import { prefersReducedMotion as readPrefersReducedMotion } from "./reduced-motion.js";

export const TRANSITION_DURATION_MS = 300;

export type StageTransitionDirection = "advance" | "retreat" | "fade";

export interface StageTransitionState {
  inFlight: boolean;
  direction: StageTransitionDirection | null;
  prevStage: string | null;
  nextStage: string | null;
}

export interface StageTransitionResult {
  started: boolean;
  direction: StageTransitionDirection | null;
  reducedMotion: boolean;
}

export interface StageTransitionAnimator {
  getState(): StageTransitionState;
  subscribe(listener: () => void): () => void;
  transition(prevStage: string, nextStage: string): StageTransitionResult;
  dispose(): void;
}

export interface StageTransitionAnimatorOptions {
  prefersReducedMotion?: () => boolean;
  durationMs?: number;
  now?: () => number;
}

const IDLE_STAGE_TRANSITION_STATE: StageTransitionState = {
  inFlight: false,
  direction: null,
  prevStage: null,
  nextStage: null,
};

const STAGE_ORDER: readonly AutopilotBackendStage[] = [
  "input",
  "clarification",
  "route_generation",
  "spec_tree",
  "spec_docs",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
];

function deriveStageTransitionDirection(
  prevStage: string,
  nextStage: string
): StageTransitionDirection {
  const prev = normalizeAutopilotStage(prevStage);
  const next = normalizeAutopilotStage(nextStage);
  const prevIndex = prev ? STAGE_ORDER.indexOf(prev) : -1;
  const nextIndex = next ? STAGE_ORDER.indexOf(next) : -1;

  if (prevIndex < 0 || nextIndex < 0 || prevIndex === nextIndex) {
    return "fade";
  }

  return nextIndex > prevIndex ? "advance" : "retreat";
}

function freezeState(state: StageTransitionState): StageTransitionState {
  return Object.freeze({ ...state }) as StageTransitionState;
}

export function createStageTransitionAnimator(
  options: StageTransitionAnimatorOptions = {}
): StageTransitionAnimator {
  const durationMs = options.durationMs ?? TRANSITION_DURATION_MS;
  const getPrefersReducedMotion =
    options.prefersReducedMotion ?? readPrefersReducedMotion;
  const now =
    options.now ??
    (() =>
      typeof performance === "undefined" ? Date.now() : performance.now());
  const listeners = new Set<() => void>();
  let state = freezeState(IDLE_STAGE_TRANSITION_STATE);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let transitionStartedAt: number | null = null;

  function emit() {
    for (const listener of listeners) listener();
  }

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function finish() {
    timer = null;
    transitionStartedAt = null;
    state = freezeState({
      ...state,
      inFlight: false,
    });
    emit();
  }

  function transition(
    prevStage: string,
    nextStage: string
  ): StageTransitionResult {
    if (prevStage === nextStage) {
      return {
        started: false,
        direction: null,
        reducedMotion: getPrefersReducedMotion(),
      };
    }

    if (state.inFlight) {
      console.debug("coordination.animation_aborted", {
        previousTrigger: `${state.prevStage}->${state.nextStage}`,
        newTrigger: `${prevStage}->${nextStage}`,
        elapsedMs:
          transitionStartedAt === null
            ? 0
            : Math.max(0, now() - transitionStartedAt),
      });
      clearTimer();
    }

    const direction = deriveStageTransitionDirection(prevStage, nextStage);
    const reducedMotion = getPrefersReducedMotion();
    state = freezeState({
      inFlight: !reducedMotion,
      direction,
      prevStage,
      nextStage,
    });
    transitionStartedAt = reducedMotion ? null : now();
    emit();

    if (!reducedMotion) {
      timer = setTimeout(finish, durationMs);
    }

    return {
      started: true,
      direction,
      reducedMotion,
    };
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transition,
    dispose() {
      clearTimer();
      listeners.clear();
    },
  };
}

export function useStageTransitionAnimator(
  options: StageTransitionAnimatorOptions = {}
): StageTransitionAnimator & { state: StageTransitionState } {
  const animator = useMemo(() => createStageTransitionAnimator(options), []);
  const state = useSyncExternalStore(
    animator.subscribe,
    animator.getState,
    animator.getState
  );
  const transition = useCallback(
    (prevStage: string, nextStage: string) =>
      animator.transition(prevStage, nextStage),
    [animator]
  );

  return {
    ...animator,
    transition,
    state,
  };
}
