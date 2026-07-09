import type { FC, KeyboardEvent } from "react";
import { RefreshCw } from "lucide-react";

import type { ReplanImpact, ReplanStage, ReplanStatus } from "./types";

export interface ReplanButtonProps {
  viewingStage: ReplanStage;
  stageStatus: ReplanStatus;
  jobStatus: ReplanStatus;
  impact: ReplanImpact;
  isViewingCompletedStage?: boolean;
  staticPreview?: boolean;
  downstreamRunningStage?: ReplanStage | null;
  label?: string;
  onOpen: () => void;
}

function disabledReason({
  jobStatus,
  staticPreview,
  downstreamRunningStage,
}: Pick<
  ReplanButtonProps,
  "jobStatus" | "staticPreview" | "downstreamRunningStage"
>): string | null {
  if (staticPreview) return "Static preview";
  if (downstreamRunningStage) {
    return `Downstream stage ${downstreamRunningStage} is running`;
  }
  if (jobStatus === "running") return "Job running";
  return null;
}

const REPLAN_TOOLTIP =
  "返回上一步只是回看，不删除产物；从这里重新规划会让下游内容过期或开新分支";

export const ReplanButton: FC<ReplanButtonProps> = ({
  viewingStage,
  stageStatus,
  jobStatus,
  impact,
  isViewingCompletedStage = stageStatus === "completed",
  staticPreview,
  downstreamRunningStage = null,
  label = "从这里重新规划",
  onOpen,
}) => {
  if (!isViewingCompletedStage || impact.artifactCount <= 0) {
    return null;
  }

  const reason = disabledReason({
    jobStatus,
    staticPreview,
    downstreamRunningStage,
  });
  const disabled = reason !== null;
  const impactLabel = `${impact.artifactCount} downstream`;
  const hintId = "autopilot-replan-disabled-hint";
  const activate = () => {
    if (disabled) return;
    onOpen();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };

  return (
    <button
      type="button"
      data-testid="autopilot-replan-from-stage-divider"
      data-stage={viewingStage}
      data-tooltip-hover-delay-ms={300}
      data-tooltip-long-press-ms={500}
      aria-disabled={disabled ? true : undefined}
      aria-describedby={disabled ? hintId : undefined}
      title={reason ?? REPLAN_TOOLTIP}
      onClick={activate}
      onKeyDown={onKeyDown}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
        {impactLabel}
      </span>
      {reason ? (
        <span id={hintId} data-testid="autopilot-replan-disabled-hint" className="sr-only">
          {reason}
        </span>
      ) : null}
    </button>
  );
};

export default ReplanButton;
