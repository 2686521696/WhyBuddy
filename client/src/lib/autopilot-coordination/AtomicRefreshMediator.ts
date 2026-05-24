import { useMemo } from "react";
import { flushSync } from "react-dom";

export type AtomicRefreshTriggerSource =
  | "replan"
  | "inline_edit"
  | "switch_active"
  | "manual";

export interface AtomicRefreshOptions {
  triggerSource?: AtomicRefreshTriggerSource;
  failedStore?: string;
  onCommit?: () => void;
}

export interface AtomicRefreshResult<T = void> {
  ok: boolean;
  value?: T;
  error?: Error;
  triggerSource?: AtomicRefreshTriggerSource;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "Atomic refresh failed");
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function truncateErrorMessage(error: Error): string {
  return error.message.slice(0, 200);
}

function logBatchRollback(error: Error, options: AtomicRefreshOptions) {
  console.error("coordination.batch_rolled_back", {
    event: "coordination.batch_rolled_back",
    triggerSource: options.triggerSource ?? "manual",
    failedStore: options.failedStore ?? "(unknown)",
    errorMessage: truncateErrorMessage(error),
  });
}

export function runAtomicRefresh<T>(
  apply: () => T,
  options: AtomicRefreshOptions = {}
): AtomicRefreshResult<T> {
  try {
    let value: T;

    flushSync(() => {
      value = apply();
    });

    if (isThenable(value!)) {
      return {
        ok: false,
        error: new Error("Atomic refresh apply must complete synchronously"),
        triggerSource: options.triggerSource,
      };
    }

    options.onCommit?.();

    return {
      ok: true,
      value: value!,
      triggerSource: options.triggerSource,
    };
  } catch (error) {
    const normalizedError = toError(error);
    logBatchRollback(normalizedError, options);

    return {
      ok: false,
      error: normalizedError,
      triggerSource: options.triggerSource,
    };
  }
}

export function useAtomicRefreshMediator() {
  return useMemo(
    () => ({
      flush: runAtomicRefresh,
    }),
    []
  );
}
