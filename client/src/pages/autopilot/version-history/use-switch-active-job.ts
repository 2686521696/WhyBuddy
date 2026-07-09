import { useCallback } from "react";

import { getAutopilotPageForStage } from "@/lib/autopilot-coordination";

import type {
  SwitchActiveApplyPayload,
  SwitchActiveCoordinator,
  SwitchActivePageTransition,
  SwitchActiveStageTransition,
  SwitchActiveSubmission,
  VersionHistoryJob,
} from "./types";

export interface ExecuteSwitchActiveJobOptions {
  fromJob?: VersionHistoryJob | null;
  job: VersionHistoryJob;
  apply: (payload: SwitchActiveApplyPayload) => void | Promise<void>;
  coordinator?: SwitchActiveCoordinator;
  pageTransition?: SwitchActivePageTransition | null;
}

function deriveStageTransition(
  fromJob: VersionHistoryJob,
  toJob: VersionHistoryJob,
): SwitchActiveStageTransition {
  return {
    fromStage: fromJob.stage,
    toStage: toJob.stage,
  };
}

function derivePageTransition(
  fromJob: VersionHistoryJob,
  toJob: VersionHistoryJob,
): SwitchActivePageTransition | undefined {
  const fromPage = getAutopilotPageForStage(fromJob.stage);
  const toPage = getAutopilotPageForStage(toJob.stage);

  if (fromPage === null || toPage === null) {
    return undefined;
  }

  return { fromPage, toPage };
}

export async function executeSwitchActiveJob({
  fromJob,
  job,
  apply,
  coordinator,
  pageTransition,
}: ExecuteSwitchActiveJobOptions): Promise<void> {
  const applyPayload: SwitchActiveApplyPayload = {
    jobId: job.id,
    stage: job.stage,
  };
  const runApply = () => apply(applyPayload);

  if (!coordinator) {
    await runApply();
    return;
  }

  const sourceJob = fromJob ?? job;
  const resolvedPageTransition =
    pageTransition ?? derivePageTransition(sourceJob, job);
  const submission: SwitchActiveSubmission = {
    triggerSource: "switch_active",
    apply: runApply,
    stageTransition: deriveStageTransition(sourceJob, job),
    ...(resolvedPageTransition
      ? { pageTransition: resolvedPageTransition }
      : {}),
  };

  await coordinator.submit(submission);
}

export type SwitchActiveRejectionReason = "not_in_family";

export interface SwitchActiveNavigationApplyOptions {
  setActiveJobId: (jobId: string) => void;
  resetSubStagePin?: () => void;
  setWorkflowStageOverride?: (stage: SwitchActiveApplyPayload["stage"]) => void;
  updateUrl?: (jobId: string) => void;
  refreshJob?: (jobId: string) => void | Promise<void>;
}

export function withActiveJobSearchParam(search: string, jobId: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("activeJob", jobId);
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function createSwitchActiveNavigationApply({
  setActiveJobId,
  resetSubStagePin,
  setWorkflowStageOverride,
  updateUrl,
  refreshJob,
}: SwitchActiveNavigationApplyOptions): (
  payload: SwitchActiveApplyPayload,
) => Promise<void> {
  return async ({ jobId, stage }) => {
    setActiveJobId(jobId);
    resetSubStagePin?.();
    setWorkflowStageOverride?.(stage);
    updateUrl?.(jobId);
    await refreshJob?.(jobId);
  };
}

export interface UseSwitchActiveJobOptions {
  jobs: VersionHistoryJob[];
  activeJobId?: string | null;
  apply: (payload: SwitchActiveApplyPayload) => void | Promise<void>;
  coordinator?: SwitchActiveCoordinator;
  pageTransition?: (
    fromJob: VersionHistoryJob,
    toJob: VersionHistoryJob,
  ) => SwitchActivePageTransition | null | undefined;
  onRejected?: (jobId: string, reason: SwitchActiveRejectionReason) => void;
  toast?: {
    error: (message: string) => void;
  };
}

export interface CreateSwitchActiveJobHandlerOptions extends UseSwitchActiveJobOptions {}

export function createSwitchActiveJobHandler({
  jobs,
  activeJobId,
  apply,
  coordinator,
  pageTransition,
  onRejected,
  toast,
}: CreateSwitchActiveJobHandlerOptions): (jobId: string) => Promise<boolean> {
  return async (jobId: string) => {
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      onRejected?.(jobId, "not_in_family");
      toast?.error("Selected job is outside the current version family.");
      return false;
    }
    const fromJob =
      jobs.find((candidate) => candidate.id === activeJobId) ?? job;

    await executeSwitchActiveJob({
      fromJob,
      job,
      apply,
      coordinator,
      pageTransition: pageTransition?.(fromJob, job),
    });
    return true;
  };
}

export function useSwitchActiveJob({
  jobs,
  apply,
  coordinator,
  pageTransition,
  onRejected,
  toast,
}: UseSwitchActiveJobOptions) {
  return useCallback(
    createSwitchActiveJobHandler({
      jobs,
      apply,
      coordinator,
      pageTransition,
      onRejected,
      toast,
    }),
    [apply, coordinator, jobs, pageTransition, onRejected, toast],
  );
}
