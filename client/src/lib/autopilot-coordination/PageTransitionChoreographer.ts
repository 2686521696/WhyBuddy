import { useCallback, useMemo, useSyncExternalStore } from "react";

import { type AutopilotPage } from "./page-mapping.js";
import { prefersReducedMotion as readPrefersReducedMotion } from "./reduced-motion.js";

export const PAGE_TRANSITION_DURATION_MS = 300;

export type PageTransitionDirection = "forward" | "backward";

export interface PageTransitionState {
  inFlight: boolean;
  direction: PageTransitionDirection | null;
  prevPage: AutopilotPage | null;
  nextPage: AutopilotPage | null;
}

export interface PageTransitionResult {
  started: boolean;
  direction: PageTransitionDirection | null;
  reducedMotion: boolean;
}

export interface PageTransitionChoreographer {
  getState(): PageTransitionState;
  subscribe(listener: () => void): () => void;
  transition(
    prevPage: AutopilotPage,
    nextPage: AutopilotPage
  ): PageTransitionResult;
  dispose(): void;
}

export interface PageTransitionChoreographerOptions {
  prefersReducedMotion?: () => boolean;
  durationMs?: number;
  now?: () => number;
}

const IDLE_PAGE_TRANSITION_STATE: PageTransitionState = {
  inFlight: false,
  direction: null,
  prevPage: null,
  nextPage: null,
};

function freezeState(state: PageTransitionState): PageTransitionState {
  return Object.freeze({ ...state }) as PageTransitionState;
}

function derivePageTransitionDirection(
  prevPage: AutopilotPage,
  nextPage: AutopilotPage
): PageTransitionDirection {
  return nextPage > prevPage ? "forward" : "backward";
}

export function createPageTransitionChoreographer(
  options: PageTransitionChoreographerOptions = {}
): PageTransitionChoreographer {
  const durationMs = options.durationMs ?? PAGE_TRANSITION_DURATION_MS;
  const getPrefersReducedMotion =
    options.prefersReducedMotion ?? readPrefersReducedMotion;
  const now =
    options.now ??
    (() =>
      typeof performance === "undefined" ? Date.now() : performance.now());
  const listeners = new Set<() => void>();
  let state = freezeState(IDLE_PAGE_TRANSITION_STATE);
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
    prevPage: AutopilotPage,
    nextPage: AutopilotPage
  ): PageTransitionResult {
    if (prevPage === nextPage) {
      return {
        started: false,
        direction: null,
        reducedMotion: getPrefersReducedMotion(),
      };
    }

    if (state.inFlight) {
      console.debug("coordination.animation_aborted", {
        previousTrigger: `${state.prevPage}->${state.nextPage}`,
        newTrigger: `${prevPage}->${nextPage}`,
        elapsedMs:
          transitionStartedAt === null
            ? 0
            : Math.max(0, now() - transitionStartedAt),
      });
    }

    clearTimer();

    const direction = derivePageTransitionDirection(prevPage, nextPage);
    const reducedMotion = getPrefersReducedMotion();
    state = freezeState({
      inFlight: !reducedMotion,
      direction,
      prevPage,
      nextPage,
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

export function usePageTransitionChoreographer(
  options: PageTransitionChoreographerOptions = {}
): PageTransitionChoreographer & { state: PageTransitionState } {
  const choreographer = useMemo(
    () => createPageTransitionChoreographer(options),
    []
  );
  const state = useSyncExternalStore(
    choreographer.subscribe,
    choreographer.getState,
    choreographer.getState
  );
  const transition = useCallback(
    (prevPage: AutopilotPage, nextPage: AutopilotPage) =>
      choreographer.transition(prevPage, nextPage),
    [choreographer]
  );

  return {
    ...choreographer,
    transition,
    state,
  };
}
