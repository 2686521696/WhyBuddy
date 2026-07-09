import { Check, Pencil, X } from "lucide-react";
import {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import type { AutopilotLocalStage } from "./derive-downstream-impact";
import { InlineConfirmation } from "./InlineConfirmation";

export interface EditModeFieldImpactSummary {
  downstreamCount: number;
}

export type EditModeState =
  | {
      mode: "view";
      value: string;
      draftValue: string;
      errorMessage?: undefined;
    }
  | {
      mode: "editing";
      value: string;
      draftValue: string;
      errorMessage?: undefined;
    }
  | {
      mode: "submitting";
      value: string;
      draftValue: string;
      errorMessage?: undefined;
    }
  | { mode: "error"; value: string; draftValue: string; errorMessage: string };

export type EditModeAction =
  | { type: "syncValue"; value: string }
  | { type: "startEditing" }
  | { type: "changeDraft"; value: string }
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "submitSuccess"; value: string }
  | { type: "submitError"; message: string };

export interface EditModeFieldProps {
  value: string;
  onSubmit: (value: string) => Promise<unknown> | unknown;
  canEdit: boolean;
  impactSummary: EditModeFieldImpactSummary;
  fieldKey: string;
  fromStage?: AutopilotLocalStage;
  isAdvancingThroughStage?: boolean;
  isStaticPreview?: boolean;
  isViewingCompletedStage?: boolean;
  label?: string;
  placeholder?: string;
}

const EDITABLE_UPSTREAM_STAGES = new Set<AutopilotLocalStage>([
  "input",
  "clarification",
  "route_generation",
]);

export type EditModeFieldKeyIntent = "submit" | "cancel" | "none";

export function getEditModeFieldKeyIntent(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, "key" | "shiftKey">
): EditModeFieldKeyIntent {
  if (event.key === "Escape") {
    return "cancel";
  }

  if (event.key === "Enter" && !event.shiftKey) {
    return "submit";
  }

  return "none";
}

export function initialEditModeState(value: string): EditModeState {
  return {
    mode: "view",
    value,
    draftValue: value,
  };
}

export function editModeReducer(
  state: EditModeState,
  action: EditModeAction
): EditModeState {
  switch (action.type) {
    case "syncValue":
      if (state.mode === "view") {
        return initialEditModeState(action.value);
      }
      return state;
    case "startEditing":
      if (state.mode === "view") {
        return { mode: "editing", value: state.value, draftValue: state.value };
      }
      return state;
    case "changeDraft":
      if (state.mode === "editing" || state.mode === "error") {
        return {
          mode: "editing",
          value: state.value,
          draftValue: action.value,
        };
      }
      return state;
    case "cancel":
      return initialEditModeState(state.value);
    case "submit":
      if (state.mode === "editing" || state.mode === "error") {
        return {
          mode: "submitting",
          value: state.value,
          draftValue: state.draftValue,
        };
      }
      return state;
    case "submitSuccess":
      return initialEditModeState(action.value);
    case "submitError":
      return {
        mode: "error",
        value: state.value,
        draftValue: state.draftValue,
        errorMessage: action.message,
      };
  }
}

export function deriveEditErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as {
      code?: unknown;
      runningStage?: unknown;
      message?: unknown;
      status?: unknown;
    };

    if (maybeError.code === "downstream_running" || maybeError.status === 409) {
      const runningStage =
        typeof maybeError.runningStage === "string"
          ? maybeError.runningStage
          : "a downstream stage";
      return `${runningStage} is still running. Please wait for completion.`;
    }

    if (
      typeof maybeError.message === "string" &&
      maybeError.message.length > 0
    ) {
      return maybeError.message;
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Could not save this edit. Please try again.";
}

export function deriveEditModeFieldCanEdit({
  canEdit,
  fromStage,
  isAdvancingThroughStage,
  isStaticPreview,
  isViewingCompletedStage,
}: Pick<
  EditModeFieldProps,
  | "canEdit"
  | "fromStage"
  | "isAdvancingThroughStage"
  | "isStaticPreview"
  | "isViewingCompletedStage"
>): boolean {
  if (!canEdit) {
    return false;
  }

  const hasStageGate =
    fromStage !== undefined ||
    isAdvancingThroughStage !== undefined ||
    isStaticPreview !== undefined ||
    isViewingCompletedStage !== undefined;

  if (!hasStageGate) {
    return true;
  }

  return Boolean(
    isViewingCompletedStage &&
      fromStage &&
      EDITABLE_UPSTREAM_STAGES.has(fromStage) &&
      !isAdvancingThroughStage &&
      !isStaticPreview
  );
}

export function EditModeField({
  value,
  onSubmit,
  canEdit,
  impactSummary,
  fieldKey,
  fromStage,
  isAdvancingThroughStage,
  isStaticPreview,
  isViewingCompletedStage,
  label = "field",
  placeholder,
}: EditModeFieldProps) {
  const [state, setState] = useState<EditModeState>(() =>
    initialEditModeState(value)
  );

  useEffect(() => {
    setState(current => editModeReducer(current, { type: "syncValue", value }));
  }, [value]);

  const startEditing = () => {
    setState(current => editModeReducer(current, { type: "startEditing" }));
  };

  const cancelEditing = () => {
    setState(current => editModeReducer(current, { type: "cancel" }));
  };

  const submitDraft = async () => {
    const draftValue = state.draftValue;
    setState(current => editModeReducer(current, { type: "submit" }));

    try {
      await onSubmit(draftValue);
      setState(current =>
        editModeReducer(current, { type: "submitSuccess", value: draftValue })
      );
    } catch (error) {
      setState(current =>
        editModeReducer(current, {
          type: "submitError",
          message: deriveEditErrorMessage(error),
        })
      );
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const intent = getEditModeFieldKeyIntent(event);
    if (intent === "cancel") {
      event.preventDefault();
      cancelEditing();
    }
    if (intent === "submit") {
      event.preventDefault();
      void submitDraft();
    }
  };
  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setState(current =>
      editModeReducer(current, {
        type: "changeDraft",
        value,
      })
    );
  };

  const isEditing =
    state.mode === "editing" ||
    state.mode === "submitting" ||
    state.mode === "error";
  const isSubmitting = state.mode === "submitting";
  const effectiveCanEdit = deriveEditModeFieldCanEdit({
    canEdit,
    fromStage,
    isAdvancingThroughStage,
    isStaticPreview,
    isViewingCompletedStage,
  });

  if (!isEditing) {
    return (
      <div
        aria-disabled={!effectiveCanEdit}
        className="group rounded-md border border-transparent px-2 py-1"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="block text-xs font-medium uppercase tracking-normal text-slate-500">
              {label}
            </span>
            <p className="m-0 whitespace-pre-wrap text-sm text-slate-900">
              {state.value}
            </p>
          </div>
          {effectiveCanEdit ? (
            <button
              aria-label={`Edit ${label}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
              data-testid={`autopilot-edit-${fieldKey}`}
              onClick={startEditing}
              title={`Edit ${label}`}
              type="button"
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-2">
      <label className="block text-xs font-medium uppercase tracking-normal text-slate-500">
        {label}
      </label>
      <textarea
        className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-900 disabled:bg-slate-50"
        disabled={isSubmitting}
        onChange={handleDraftChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        value={state.draftValue}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          aria-label={`Save ${label}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-white disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => void submitDraft()}
          title={`Save ${label}`}
          type="button"
        >
          <Check aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          aria-label={`Cancel ${label}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-60"
          disabled={isSubmitting}
          onClick={cancelEditing}
          title={`Cancel ${label}`}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
        {isSubmitting ? (
          <span className="text-xs text-slate-500">Saving...</span>
        ) : null}
      </div>
      {state.mode === "error" ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {state.errorMessage}
        </p>
      ) : null}
      <InlineConfirmation
        disabled={isSubmitting}
        downstreamCount={impactSummary.downstreamCount}
        onCancel={cancelEditing}
        onConfirm={() => void submitDraft()}
      />
    </div>
  );
}
