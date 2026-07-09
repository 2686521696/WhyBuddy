import { useMemo } from "react";

import { runAtomicRefresh, type AtomicRefreshOptions, type AtomicRefreshResult } from "./AtomicRefreshMediator.js";
import {
  type ToastPayload,
  type ToastQueue,
  createToastQueue,
} from "./ToastQueue.js";
import {
  checkThreeLayerConsistency,
  type ThreeLayerConsistencyActions,
  type ThreeLayerConsistencyResult,
  type ThreeLayerConsistencySnapshot,
} from "./ThreeLayerConsistencyChecker.js";

export type CoordinationTriggerSource =
  | "replan"
  | "inline_edit"
  | "switch_active"
  | "manual";

export interface CoordinationStageTransition {
  fromStage: string;
  toStage: string;
}

export interface CoordinationPageTransition {
  fromPage: 1 | 2 | 3;
  toPage: 1 | 2 | 3;
}

export interface CoordinationSubmission {
  triggerSource: CoordinationTriggerSource;
  apply: () => void;
  rollback?: () => void;
  toastPayload?: ToastPayload;
  stageTransition?: CoordinationStageTransition;
  pageTransition?: CoordinationPageTransition;
}

export interface AutopilotCoordinatorDeps {
  toastQueue?: ToastQueue;
  readThreeLayerSnapshot: () => ThreeLayerConsistencySnapshot;
  consistencyActions?: ThreeLayerConsistencyActions;
  stageAnimator?: {
    transition(fromStage: string, toStage: string): unknown;
  };
  pageChoreographer?: {
    transition(fromPage: 1 | 2 | 3, toPage: 1 | 2 | 3): unknown;
  };
  runAtomicRefresh?: <T>(
    apply: () => T,
    options?: AtomicRefreshOptions
  ) => AtomicRefreshResult<T>;
  checkThreeLayerConsistency?: (
    snapshot: ThreeLayerConsistencySnapshot,
    actions?: ThreeLayerConsistencyActions
  ) => ThreeLayerConsistencyResult;
}

export interface CoordinationFailure {
  kind: "atomic_refresh_failed" | "three_layer_mismatch_failed";
  message: string;
}

export interface CoordinationResult {
  ok: boolean;
  warned: boolean;
  failure?: CoordinationFailure;
  consistency?: ThreeLayerConsistencyResult;
  stageTransition?: CoordinationStageTransition;
  pageTransition?: CoordinationPageTransition;
}

export interface AutopilotCoordinator {
  submit(submission: CoordinationSubmission): CoordinationResult;
  toastQueue: ToastQueue;
}

const STATE_SYNC_FAILURE_MESSAGE =
  "Front-end state sync failed. Refresh the page or try again.";

export function createAutopilotCoordinator(
  deps: AutopilotCoordinatorDeps
): AutopilotCoordinator {
  const toastQueue = deps.toastQueue ?? createToastQueue();
  const runRefresh = deps.runAtomicRefresh ?? runAtomicRefresh;
  const checkConsistency =
    deps.checkThreeLayerConsistency ?? checkThreeLayerConsistency;

  function submit(submission: CoordinationSubmission): CoordinationResult {
    const refreshResult = runRefresh(submission.apply, {
      triggerSource: submission.triggerSource,
    });

    if (!refreshResult.ok) {
      submission.rollback?.();

      toastQueue.enqueue({
        key: `coordination.batch_failed.${submission.triggerSource}`,
        level: "error",
        message: STATE_SYNC_FAILURE_MESSAGE,
      });

      return {
        ok: false,
        warned: false,
        failure: {
          kind: "atomic_refresh_failed",
          message: refreshResult.error?.message ?? "Atomic refresh failed",
        },
        stageTransition: submission.stageTransition,
        pageTransition: submission.pageTransition,
      };
    }

    if (
      submission.pageTransition &&
      submission.pageTransition.fromPage !== submission.pageTransition.toPage
    ) {
      deps.pageChoreographer?.transition(
        submission.pageTransition.fromPage,
        submission.pageTransition.toPage
      );
    } else if (
      submission.stageTransition &&
      submission.stageTransition.fromStage !== submission.stageTransition.toStage
    ) {
      deps.stageAnimator?.transition(
        submission.stageTransition.fromStage,
        submission.stageTransition.toStage
      );
    }

    if (submission.toastPayload) {
      toastQueue.enqueue(submission.toastPayload);
    }

    const consistency = checkConsistency(deps.readThreeLayerSnapshot(), {
      resetPin: deps.consistencyActions?.resetPin,
      fallbackWorkflowStageOverride:
        deps.consistencyActions?.fallbackWorkflowStageOverride,
      now: deps.consistencyActions?.now,
    });

    if (!consistency.ok) {
      toastQueue.enqueue({
        key: `coordination.three_layer.${submission.triggerSource}`,
        level: "error",
        message: STATE_SYNC_FAILURE_MESSAGE,
      });

      return {
        ok: false,
        warned: consistency.warned,
        failure: {
          kind: "three_layer_mismatch_failed",
          message: STATE_SYNC_FAILURE_MESSAGE,
        },
        consistency,
        stageTransition: submission.stageTransition,
        pageTransition: submission.pageTransition,
      };
    }

    return {
      ok: true,
      warned: consistency.warned,
      consistency,
      stageTransition: submission.stageTransition,
      pageTransition: submission.pageTransition,
    };
  }

  return {
    submit,
    toastQueue,
  };
}

export function useAutopilotCoordination(deps: AutopilotCoordinatorDeps) {
  return useMemo(() => createAutopilotCoordinator(deps), [deps]);
}
