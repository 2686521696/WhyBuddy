import type { FC } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { ReplanImpact, ReplanMode, ReplanStage } from "./types";

export interface ReplanConfirmationModalProps {
  open: boolean;
  mode: ReplanMode;
  reason: string;
  loading: boolean;
  impact: ReplanImpact;
  impactLoading?: boolean;
  impactError?: string | null;
  error?: string | null;
  storeSyncError?: string | null;
  runningStage?: ReplanStage | string | null;
  onModeChange: (mode: ReplanMode) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onClearError?: () => void;
}

const MAX_REASON_LENGTH = 1000;

export type ReplanConfirmationState =
  | { kind: "idle" }
  | { kind: "loading_impact" }
  | { kind: "ready" }
  | { kind: "impact_failed"; retryable: true }
  | { kind: "empty" }
  | { kind: "in_flight" }
  | { kind: "error" }
  | { kind: "store_sync_failed" };

export function deriveReplanConfirmationState(input: {
  open: boolean;
  loading: boolean;
  impact: ReplanImpact;
  impactLoading?: boolean;
  impactError?: string | null;
  error?: string | null;
  storeSyncError?: string | null;
}): ReplanConfirmationState {
  if (!input.open) return { kind: "idle" };
  if (input.storeSyncError) return { kind: "store_sync_failed" };
  if (input.error) return { kind: "error" };
  if (input.loading) return { kind: "in_flight" };
  if (input.impactLoading) return { kind: "loading_impact" };
  if (input.impactError) return { kind: "impact_failed", retryable: true };
  if (input.impact.artifactCount <= 0) return { kind: "empty" };
  return { kind: "ready" };
}

function modeClassName(active: boolean): string {
  return [
    "inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold transition",
    active
      ? "border-slate-950 bg-slate-950 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

export const ReplanConfirmationModal: FC<ReplanConfirmationModalProps> = ({
  open,
  mode,
  reason,
  loading,
  impact,
  impactLoading = false,
  impactError = null,
  error = null,
  storeSyncError = null,
  runningStage = null,
  onModeChange,
  onReasonChange,
  onConfirm,
  onCancel,
  onClearError,
}) => {
  if (!open) return null;

  const modalState = deriveReplanConfirmationState({
    open,
    loading,
    impact,
    impactLoading,
    impactError,
    error,
    storeSyncError,
  });
  const inFlight = modalState.kind === "in_flight";
  const stageLabel =
    impact.stages.length > 0 ? impact.stages.join(", ") : "none";
  const confirmLabel = loading ? "Replanning..." : "Confirm replan";
  const reasonTooLong = reason.length > MAX_REASON_LENGTH;
  const confirmDisabled =
    reasonTooLong ||
    modalState.kind === "loading_impact" ||
    modalState.kind === "impact_failed" ||
    modalState.kind === "empty" ||
    modalState.kind === "in_flight" ||
    modalState.kind === "store_sync_failed";
  const modeSummary =
    mode === "branch"
      ? "新分支会保留严格上游产物，并从当前阶段重新开始独立生成。"
      : "原地标记过期会保留当前 job，并让下游内容进入重新生成队列。";
  const preventOrCancel = (event?: { preventDefault?: () => void }) => {
    if (inFlight) {
      event?.preventDefault?.();
      return;
    }
    onCancel();
  };
  const changeReason = (value: string) => {
    onReasonChange(value);
    if (error || storeSyncError) onClearError?.();
  };
  const modalInteractionProps = {
    onEscapeKeyDown: preventOrCancel,
    onPointerDownOutside: preventOrCancel,
  } as Record<string, (event?: { preventDefault?: () => void }) => void>;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) preventOrCancel();
      }}
    >
      <DialogContent
        {...modalInteractionProps}
        data-testid="autopilot-replan-confirmation-modal"
        data-replan-modal-state={modalState.kind}
        role="dialog"
        aria-modal="true"
        aria-labelledby="replan-modal-title"
        aria-busy={inFlight ? true : undefined}
        data-dialog-width="720-960"
        data-dialog-max-height="90vh"
        showCloseButton={!inFlight}
        className="min-w-[720px] max-w-[960px] max-h-[90vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
      >
        <div className="space-y-3">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle
              id="replan-modal-title"
              className="text-sm font-bold text-slate-950"
            >
            从这里重新规划
            </DialogTitle>
            <DialogDescription
              data-testid="replan-modal-impact"
              className="text-xs text-slate-500"
            >
              {modalState.kind === "loading_impact"
                ? "Loading downstream impact..."
                : modalState.kind === "impact_failed"
                  ? impactError || "Failed to load downstream impact."
                  : modalState.kind === "empty"
                    ? "0 downstream artifacts across none"
                    : `${impact.artifactCount} downstream artifacts across ${stageLabel}`}
            </DialogDescription>
            <p
              data-testid="replan-modal-mode-summary"
              className="text-xs text-slate-600"
            >
              {modeSummary}
            </p>
          </DialogHeader>

        {error || storeSyncError ? (
          <div
            data-testid="replan-modal-error"
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-700"
          >
            {storeSyncError || error}
            {runningStage ? ` (${runningStage})` : ""}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5" role="group">
          <button
            type="button"
            data-testid="replan-modal-mode-in-place"
            aria-pressed={mode === "in_place"}
            className={modeClassName(mode === "in_place")}
            onClick={() => onModeChange("in_place")}
          >
            原地标记过期
          </button>
          <button
            type="button"
            data-testid="replan-modal-mode-branch"
            aria-pressed={mode === "branch"}
            className={modeClassName(mode === "branch")}
            onClick={() => onModeChange("branch")}
          >
            新分支
          </button>
        </div>

        <label className="block text-xs font-semibold text-slate-700">
          Reason
          <textarea
            data-testid="replan-modal-reason"
            value={reason}
            onChange={(event) => changeReason(event.currentTarget.value)}
            className="mt-1 min-h-16 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-slate-500"
            placeholder="What changed upstream?"
          />
          <span
            data-testid="replan-modal-reason-count"
            className={
              reasonTooLong
                ? "mt-1 block text-[11px] font-semibold text-red-600"
                : "mt-1 block text-[11px] text-slate-500"
            }
          >
            {reason.length} / {MAX_REASON_LENGTH}
            {reasonTooLong ? " - reason 不能超过 1000 个字符" : ""}
          </span>
        </label>

        <DialogFooter className="flex-row justify-end gap-1.5">
          <button
            type="button"
            data-testid="replan-modal-cancel"
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            onClick={() => preventOrCancel()}
            disabled={inFlight}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="replan-modal-confirm"
            className="inline-flex h-8 items-center rounded-md bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={() => {
              if (!confirmDisabled) onConfirm();
            }}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReplanConfirmationModal;
