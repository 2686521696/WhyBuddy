/**
 * UE5 Reconnection Handler
 *
 * Client-side reconnection handler that implements automatic reconnection
 * with configurable retry limits and incremental backoff strategy.
 *
 * When a WebRTC connection drop is detected, the handler:
 * 1. Attempts to reconnect using the provided `connect` function
 * 2. Applies incremental backoff delays between attempts (default: 1s / 3s / 5s)
 * 3. Notifies via callbacks on each attempt, success, or degradation
 * 4. Transitions to 'degraded' state when all retries are exhausted
 *
 * The handler is idempotent: calling `attemptReconnect()` while already
 * reconnecting returns the existing promise.
 */

// ── Types ───────────────────────────────────────────────────────

export type UEReconnectState = "idle" | "reconnecting" | "degraded";

export interface UEReconnectConfig {
  /** Maximum number of reconnection attempts. Default: 3 */
  maxRetries: number;
  /** Backoff intervals in ms for each retry. Default: [1000, 3000, 5000] */
  backoffIntervals: number[];
  /** Callback invoked on each reconnection attempt */
  onAttempt?: (attempt: number, delayMs: number) => void;
  /** Callback invoked on successful reconnection */
  onReconnected?: () => void;
  /** Callback invoked when all retries are exhausted — triggers degraded mode */
  onDegraded?: () => void;
  /** The actual reconnect function — returns true if reconnection succeeded */
  connect: () => Promise<boolean>;
}

// ── Default configuration ───────────────────────────────────────

export const UE_RECONNECT_DEFAULTS = {
  maxRetries: 3,
  backoffIntervals: [1000, 3000, 5000],
} as const;

// ── Helper ──────────────────────────────────────────────────────

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * The returned object includes an `abort` function to cancel the delay early.
 */
function createCancellableDelay(ms: number): {
  promise: Promise<void>;
  abort: () => void;
} {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let rejectFn: (() => void) | undefined;

  const promise = new Promise<void>((resolve, reject) => {
    rejectFn = reject;
    timeoutId = setTimeout(resolve, ms);
  });

  return {
    promise,
    abort() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      rejectFn?.();
    },
  };
}

// ── UEReconnectHandler ──────────────────────────────────────────

export class UEReconnectHandler {
  private config: UEReconnectConfig;
  private state: UEReconnectState = "idle";
  private currentAttempt = 0;
  private activePromise: Promise<boolean> | null = null;
  private pendingDelay: { abort: () => void } | null = null;
  private cancelled = false;

  constructor(config: UEReconnectConfig) {
    this.config = config;
  }

  /**
   * Trigger the reconnection sequence. Returns true if reconnected successfully.
   *
   * Idempotent: if already reconnecting, returns the existing promise.
   */
  attemptReconnect(): Promise<boolean> {
    // Idempotency: return existing promise if already reconnecting
    if (this.state === "reconnecting" && this.activePromise) {
      return this.activePromise;
    }

    // Cannot reconnect from degraded state — must reset first
    if (this.state === "degraded") {
      return Promise.resolve(false);
    }

    this.state = "reconnecting";
    this.currentAttempt = 0;
    this.cancelled = false;

    this.activePromise = this.runReconnectLoop().then((result) => {
      this.activePromise = null;
      return result;
    });
    return this.activePromise;
  }

  /**
   * Reset the handler state (e.g. after a successful manual reconnect).
   */
  reset(): void {
    this.cancelPendingDelay();
    this.state = "idle";
    this.currentAttempt = 0;
    this.activePromise = null;
    this.cancelled = false;
  }

  /**
   * Get current state: 'idle' | 'reconnecting' | 'degraded'
   */
  getState(): UEReconnectState {
    return this.state;
  }

  /**
   * Cancel an in-progress reconnection sequence.
   * Resets to 'idle' state.
   */
  cancel(): void {
    this.cancelled = true;
    this.cancelPendingDelay();
    this.state = "idle";
    this.currentAttempt = 0;
    this.activePromise = null;
  }

  // ── Internal ────────────────────────────────────────────────

  private async runReconnectLoop(): Promise<boolean> {
    const { maxRetries, backoffIntervals, connect, onAttempt, onReconnected, onDegraded } =
      this.config;

    while (this.currentAttempt < maxRetries) {
      if (this.cancelled) {
        return false;
      }

      const attempt = this.currentAttempt;
      // Use the interval at the current index, or the last one if we've exceeded the array
      const delayMs =
        backoffIntervals[Math.min(attempt, backoffIntervals.length - 1)] ?? 1000;

      // Notify about the attempt
      onAttempt?.(attempt + 1, delayMs);

      // Wait for the backoff delay
      try {
        const cancellable = createCancellableDelay(delayMs);
        this.pendingDelay = cancellable;
        await cancellable.promise;
        this.pendingDelay = null;
      } catch {
        // Delay was cancelled
        this.pendingDelay = null;
        return false;
      }

      if (this.cancelled) {
        return false;
      }

      // Attempt to reconnect
      this.currentAttempt++;
      try {
        const success = await connect();
        if (success) {
          this.state = "idle";
          this.currentAttempt = 0;
          onReconnected?.();
          return true;
        }
      } catch {
        // connect() threw — treat as failure, continue to next attempt
      }
    }

    // All retries exhausted — enter degraded mode
    this.state = "degraded";
    onDegraded?.();
    return false;
  }

  private cancelPendingDelay(): void {
    if (this.pendingDelay) {
      this.pendingDelay.abort();
      this.pendingDelay = null;
    }
  }
}
