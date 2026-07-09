import type {
  ReplanImpact,
  ReplanMode,
  ReplanPostRequest,
  ReplanPostResult,
  ReplanStage,
} from "./types";

export interface ConfirmReplanInput {
  jobId: string;
  fromStage: ReplanStage;
  mode: ReplanMode;
  reason: string;
  impact: ReplanImpact;
}

export interface ReplanNavigationCallbacks {
  applyInPlace: (result: ReplanPostResult) => void | Promise<void>;
  activeJob: (jobId: string, result: ReplanPostResult) => void | Promise<void>;
}

export interface ReplanToastQueue {
  push: (toast: {
    tone: "success" | "error";
    title: string;
    message: string;
  }) => void;
}

export interface ReplanBranchIndex {
  append: (parentJobId: string, branchJobId: string) => void;
}

export interface ReplanCoordinationStageTransition {
  fromStage: string;
  toStage: string;
}

export interface ReplanCoordinationPageTransition {
  fromPage: 1 | 2 | 3;
  toPage: 1 | 2 | 3;
}

export interface ReplanCoordinationTransitions {
  stageTransition?: ReplanCoordinationStageTransition;
  pageTransition?: ReplanCoordinationPageTransition;
}

export interface ReplanCoordinator {
  submit: (submission: {
    triggerSource: "replan";
    apply: () => void;
    toastPayload?: {
      key: string;
      level: "info" | "warn" | "error";
      message: string;
    };
    stageTransition?: ReplanCoordinationStageTransition;
    pageTransition?: ReplanCoordinationPageTransition;
  }) => unknown;
}

export interface ReplanPostOptions {
  signal?: AbortSignal;
}

export interface UseReplanFlowOptions {
  postReplan: (
    request: ReplanPostRequest,
    options?: ReplanPostOptions
  ) => Promise<ReplanPostResult>;
  refreshJob?: (jobId: string) => Promise<void> | void;
  applyNavigation: ReplanNavigationCallbacks;
  branchIndex?: ReplanBranchIndex;
  coordinator?: ReplanCoordinator | null;
  getCoordinationTransitions?: (
    input: ConfirmReplanInput,
    result: ReplanPostResult
  ) => ReplanCoordinationTransitions;
  toastQueue?: ReplanToastQueue;
  timeoutMs?: number;
}

export interface UseReplanFlowResult {
  confirmReplan: (input: ConfirmReplanInput) => Promise<ReplanPostResult>;
}

function successToast(input: ConfirmReplanInput, result: ReplanPostResult) {
  const branch = input.mode === "branch";
  return {
    tone: "success" as const,
    title: branch ? "Replan branch created" : "Replan applied",
    message: branch
      ? `Created branch ${result.job.id} from ${input.jobId}.`
      : `${input.impact.artifactCount} downstream artifacts queued for regeneration.`,
  };
}

function coordinatorToast(input: ConfirmReplanInput, result: ReplanPostResult) {
  const branch = input.mode === "branch";
  return {
    key: branch
      ? `replan.branch.${result.job.id}`
      : `replan.in_place.${input.jobId}`,
    level: "info" as const,
    message: branch
      ? `Created replan branch ${result.job.id}.`
      : `${input.impact.artifactCount} downstream artifacts queued for regeneration.`,
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

export function useReplanFlow({
  postReplan,
  refreshJob,
  applyNavigation,
  branchIndex,
  coordinator,
  getCoordinationTransitions,
  toastQueue,
  timeoutMs = 30_000,
}: UseReplanFlowOptions): UseReplanFlowResult {
  async function confirmReplan(
    input: ConfirmReplanInput
  ): Promise<ReplanPostResult> {
    const request: ReplanPostRequest = {
      jobId: input.jobId,
      fromStage: input.fromStage,
      mode: input.mode,
      reason: input.reason,
      impactArtifactIds: input.impact.artifactIds,
      ...(coordinator ? { triggerSource: "replan" as const } : {}),
    };
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    let result: ReplanPostResult;
    try {
      result = await postReplan(request, { signal: abortController.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (refreshJob) {
      await refreshJob(input.jobId);
    }

    const apply = () => {
      if (input.mode === "branch") {
        branchIndex?.append(input.jobId, result.job.id);
        const applyResult = applyNavigation.activeJob(result.job.id, result);
        if (isThenable(applyResult)) {
          throw new Error(
            "Replan coordinator apply must complete synchronously"
          );
        }
        return;
      }

      const applyResult = applyNavigation.applyInPlace(result);
      if (isThenable(applyResult)) {
        throw new Error("Replan coordinator apply must complete synchronously");
      }
    };

    if (coordinator?.submit) {
      const transitions = getCoordinationTransitions?.(input, result) ?? {};
      await coordinator.submit({
        triggerSource: "replan",
        apply,
        toastPayload: coordinatorToast(input, result),
        ...transitions,
      });
    } else {
      if (input.mode === "branch") {
        branchIndex?.append(input.jobId, result.job.id);
        await applyNavigation.activeJob(result.job.id, result);
      } else {
        await applyNavigation.applyInPlace(result);
      }
      toastQueue?.push(successToast(input, result));
    }

    return result;
  }

  return { confirmReplan };
}
