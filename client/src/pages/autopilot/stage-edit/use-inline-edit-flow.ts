import { useCallback } from "react";

export interface InlineEditStaleSummary {
  newlyStaleArtifactCount?: number;
}

export interface InlineEditSubmitResult {
  staleEdit?: InlineEditStaleSummary;
}

export interface InlineEditCoordinatorEvent {
  triggerSource: "inline_edit";
  apply: () => Promise<unknown> | unknown;
  toastPayload?: {
    key: string;
    level: "info" | "success" | "warn" | "error";
    message: string;
  };
}

export interface InlineEditCoordinator {
  submit: (submission: InlineEditCoordinatorEvent) => Promise<unknown> | unknown;
}

export interface InlineEditToast {
  tone: "success" | "error";
  message: string;
}

export interface InlineEditFlowDeps<Result extends InlineEditSubmitResult = InlineEditSubmitResult> {
  submitEdit: () => Promise<Result> | Result;
  refreshJob: (result: Result) => Promise<unknown> | unknown;
  coordinator?: InlineEditCoordinator | null;
  toastQueue?: {
    push: (toast: InlineEditToast) => void;
  };
}

export interface InlineEditFlowResult<Result extends InlineEditSubmitResult> {
  submit: () => Promise<Result>;
}

function savedMessage(result: InlineEditSubmitResult) {
  const staleCount = result.staleEdit?.newlyStaleArtifactCount ?? 0;
  return staleCount > 0
    ? `Saved edit. ${staleCount} downstream artifacts marked stale.`
    : "Saved edit.";
}

export async function runInlineEditFlow<
  Result extends InlineEditSubmitResult = InlineEditSubmitResult,
>({
  submitEdit,
  refreshJob,
  coordinator,
  toastQueue,
}: InlineEditFlowDeps<Result>): Promise<Result> {
  const result = await submitEdit();
  const message = savedMessage(result);

  if (coordinator?.submit) {
    await coordinator.submit({
      triggerSource: "inline_edit",
      apply: () => refreshJob(result),
      toastPayload: {
        key: "inline_edit.saved",
        level: "info",
        message,
      },
    });
  } else {
    await refreshJob(result);
    toastQueue?.push({
      tone: "success",
      message,
    });
  }

  return result;
}

export function useInlineEditFlow<
  Result extends InlineEditSubmitResult = InlineEditSubmitResult,
>(deps: InlineEditFlowDeps<Result>): InlineEditFlowResult<Result> {
  const submit = useCallback(() => runInlineEditFlow(deps), [deps]);

  return { submit };
}
