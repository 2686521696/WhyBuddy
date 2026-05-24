import type { KeyboardEvent } from "react";

export interface InlineConfirmationProps {
  downstreamCount: number;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function InlineConfirmation({
  downstreamCount,
  disabled = false,
  onCancel,
  onConfirm,
}: InlineConfirmationProps) {
  const message =
    downstreamCount > 0
      ? `${downstreamCount} downstream items will become stale. Confirm?`
      : "No downstream items; this will save directly.";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    if (event.key === "Enter" && !disabled) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      data-testid="autopilot-inline-confirmation"
      onKeyDown={handleKeyDown}
    >
      <p className="m-0">{message}</p>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded-md bg-amber-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
          disabled={disabled}
          onClick={onConfirm}
          type="button"
        >
          Confirm
        </button>
        <button
          className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-950 disabled:opacity-60"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
