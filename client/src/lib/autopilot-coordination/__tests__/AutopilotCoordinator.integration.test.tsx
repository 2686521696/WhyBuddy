import { afterEach, describe, expect, it, vi } from "vitest";

import { createAutopilotCoordinator } from "../AutopilotCoordinator.js";
import { createPageTransitionChoreographer } from "../PageTransitionChoreographer.js";
import { createStageTransitionAnimator } from "../StageTransitionAnimator.js";
import { createToastQueue } from "../ToastQueue.js";

interface CoordinationStore {
  activeJobId: string;
  activeJobStage: string;
  staleArtifactIds: string[];
  urlPin: string | null;
  workflowStageOverride: string | null;
}

function createStore(overrides: Partial<CoordinationStore> = {}): CoordinationStore {
  return {
    activeJobId: "job-root",
    activeJobStage: "runtime_capability",
    staleArtifactIds: [],
    urlPin: null,
    workflowStageOverride: null,
    ...overrides,
  };
}

function snapshot(store: CoordinationStore): CoordinationStore {
  return {
    activeJobId: store.activeJobId,
    activeJobStage: store.activeJobStage,
    staleArtifactIds: [...store.staleArtifactIds],
    urlPin: store.urlPin,
    workflowStageOverride: store.workflowStageOverride,
  };
}

function restore(store: CoordinationStore, saved: CoordinationStore) {
  store.activeJobId = saved.activeJobId;
  store.activeJobStage = saved.activeJobStage;
  store.staleArtifactIds = [...saved.staleArtifactIds];
  store.urlPin = saved.urlPin;
  store.workflowStageOverride = saved.workflowStageOverride;
}

function createHarness(options: {
  store?: CoordinationStore;
  reducedMotion?: boolean;
} = {}) {
  const store = options.store ?? createStore();
  const toastQueue = createToastQueue();
  const stageAnimator = createStageTransitionAnimator({
    prefersReducedMotion: () => options.reducedMotion ?? false,
    durationMs: 20,
  });
  const pageChoreographer = createPageTransitionChoreographer({
    prefersReducedMotion: () => options.reducedMotion ?? false,
    durationMs: 20,
  });
  const resetPin = vi.fn(() => {
    store.urlPin = null;
  });
  const fallbackWorkflowStageOverride = vi.fn((stage: string) => {
    store.workflowStageOverride = stage;
  });
  const coordinator = createAutopilotCoordinator({
    toastQueue,
    stageAnimator,
    pageChoreographer,
    readThreeLayerSnapshot: () => ({
      urlPin: store.urlPin,
      workflowStageOverride: store.workflowStageOverride,
      activeJobStage: store.activeJobStage,
    }),
    consistencyActions: {
      resetPin,
      fallbackWorkflowStageOverride,
    },
  });

  return {
    coordinator,
    store,
    toastQueue,
    stageAnimator,
    pageChoreographer,
    resetPin,
    fallbackWorkflowStageOverride,
  };
}

describe("AutopilotCoordinator integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coordinates a replan branch by switching the active job and starting a page transition", () => {
    const harness = createHarness({
      store: createStore({
        activeJobId: "job-root",
        activeJobStage: "runtime_capability",
      }),
    });

    const result = harness.coordinator.submit({
      triggerSource: "replan",
      apply: () => {
        harness.store.activeJobId = "job-branch";
        harness.store.activeJobStage = "spec_tree";
      },
      toastPayload: {
        key: "replan.branch.job-branch",
        level: "info",
        message: "Created a replan branch.",
      },
      stageTransition: {
        fromStage: "runtime_capability",
        toStage: "spec_tree",
      },
      pageTransition: {
        fromPage: 3,
        toPage: 2,
      },
    });

    expect(result.ok).toBe(true);
    expect(harness.store.activeJobId).toBe("job-branch");
    expect(harness.store.activeJobStage).toBe("spec_tree");
    expect(harness.pageChoreographer.getState()).toMatchObject({
      inFlight: true,
      direction: "backward",
      prevPage: 3,
      nextPage: 2,
    });
    expect(harness.stageAnimator.getState().inFlight).toBe(false);
    expect(harness.toastQueue.peekVisible()).toMatchObject({
      key: "replan.branch.job-branch",
      level: "info",
    });
  });

  it("coordinates inline edit without page or stage transitions and keeps its toast separate from replan", () => {
    const harness = createHarness({
      store: createStore({
        activeJobStage: "spec_docs",
        workflowStageOverride: "spec_docs",
      }),
    });

    harness.toastQueue.enqueue({
      key: "replan.in_place.job-root",
      level: "info",
      message: "Replan finished.",
    });

    const result = harness.coordinator.submit({
      triggerSource: "inline_edit",
      apply: () => {
        harness.store.staleArtifactIds = ["prompt-packaging", "runtime-capability"];
      },
      toastPayload: {
        key: "inline_edit.spec_docs.job-root",
        level: "info",
        message: "Saved edit and marked downstream artifacts stale.",
      },
    });

    expect(result.ok).toBe(true);
    expect(harness.store.staleArtifactIds).toEqual([
      "prompt-packaging",
      "runtime-capability",
    ]);
    expect(harness.pageChoreographer.getState().inFlight).toBe(false);
    expect(harness.stageAnimator.getState().inFlight).toBe(false);
    expect([
      harness.toastQueue.peekVisible()?.key,
      ...harness.toastQueue.getPending().map(toast => toast.key),
    ]).toEqual(["replan.in_place.job-root", "inline_edit.spec_docs.job-root"]);
  });

  it("coordinates switch active by triggering the page choreographer for cross-page movement", () => {
    const harness = createHarness({
      store: createStore({
        activeJobId: "job-current",
        activeJobStage: "engineering_handoff",
      }),
    });

    const result = harness.coordinator.submit({
      triggerSource: "switch_active",
      apply: () => {
        harness.store.activeJobId = "job-older";
        harness.store.activeJobStage = "input";
        harness.store.workflowStageOverride = "input";
        harness.store.urlPin = "input";
      },
      stageTransition: {
        fromStage: "engineering_handoff",
        toStage: "input",
      },
      pageTransition: {
        fromPage: 3,
        toPage: 1,
      },
    });

    expect(result.ok).toBe(true);
    expect(harness.store.activeJobId).toBe("job-older");
    expect(harness.pageChoreographer.getState()).toMatchObject({
      inFlight: true,
      direction: "backward",
      prevPage: 3,
      nextPage: 1,
    });
    expect(harness.stageAnimator.getState().inFlight).toBe(false);
  });

  it("rolls back local coordination state and only emits an error toast when refresh fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness({
      store: createStore({
        activeJobId: "job-current",
        activeJobStage: "runtime_capability",
        staleArtifactIds: ["existing"],
      }),
    });
    const before = snapshot(harness.store);

    const result = harness.coordinator.submit({
      triggerSource: "replan",
      apply: () => {
        harness.store.activeJobId = "half-written";
        harness.store.activeJobStage = "input";
        harness.store.staleArtifactIds = ["half-written-stale"];
        throw new Error("job store failed");
      },
      rollback: () => restore(harness.store, before),
      toastPayload: {
        key: "replan.success.should-not-render",
        level: "info",
        message: "Should not render.",
      },
      stageTransition: {
        fromStage: "runtime_capability",
        toStage: "input",
      },
      pageTransition: {
        fromPage: 3,
        toPage: 1,
      },
    });

    expect(result.ok).toBe(false);
    expect(harness.store).toEqual(before);
    expect(harness.pageChoreographer.getState().inFlight).toBe(false);
    expect(harness.stageAnimator.getState().inFlight).toBe(false);
    expect(harness.toastQueue.peekVisible()).toMatchObject({
      key: "coordination.batch_failed.replan",
      level: "error",
    });
    expect(harness.toastQueue.getPending()).toEqual([]);
  });

  it("preserves legal review overrides without warning or automatic reset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createHarness({
      store: createStore({
        activeJobStage: "runtime_capability",
        urlPin: "spec_tree",
        workflowStageOverride: "spec_docs",
      }),
      reducedMotion: true,
    });

    const result = harness.coordinator.submit({
      triggerSource: "switch_active",
      apply: () => {
        harness.store.staleArtifactIds = ["effect-preview"];
      },
      stageTransition: {
        fromStage: "spec_docs",
        toStage: "runtime_capability",
      },
      pageTransition: {
        fromPage: 2,
        toPage: 3,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.consistency).toMatchObject({
      ok: true,
      reviewOverride: true,
      warned: false,
    });
    expect(harness.store.urlPin).toBe("spec_tree");
    expect(harness.store.workflowStageOverride).toBe("spec_docs");
    expect(harness.resetPin).not.toHaveBeenCalled();
    expect(harness.fallbackWorkflowStageOverride).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(harness.pageChoreographer.getState()).toMatchObject({
      inFlight: false,
      direction: "forward",
    });
  });
});
