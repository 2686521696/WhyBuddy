/**
 * Degradation State Machine for the Video Stream Player.
 *
 * Implements the render mode degradation chain:
 *
 *   ue-stream ──(连接断开)──→ connecting
 *   connecting ──(重连成功)──→ ue-stream
 *   connecting ──(重连失败)──→ threejs
 *   threejs ──(UE 恢复可用)──→ ue-stream
 *   threejs ──(Three.js 也失败)──→ prerender
 *
 * Key invariants:
 *   1. Only one render mode is active at any time.
 *   2. `prerender` is a terminal state — no automatic upgrade back to ue-stream.
 *   3. Manual reconnect from `prerender` is allowed via explicit user action.
 */

// ---------------------------------------------------------------------------
// Types (Task 3.1)
// ---------------------------------------------------------------------------

/** All possible render modes the player can be in. */
export type RenderMode =
  | 'ue-stream'
  | 'threejs'
  | 'prerender'
  | 'connecting'
  | 'error';

/** Events that drive state transitions in the degradation machine. */
export type RenderModeEvent =
  | { type: 'CONNECTION_LOST' }
  | { type: 'RECONNECT_SUCCESS' }
  | { type: 'RECONNECT_FAILED' }
  | { type: 'UE_AVAILABLE' }
  | { type: 'THREEJS_FAILED' }
  | { type: 'MANUAL_RECONNECT' }
  | { type: 'CONNECTION_ERROR' };

/** Configuration for the state machine. */
export interface RenderModeMachineConfig {
  /** Interval in ms for checking UE recovery when in threejs mode. @default 30_000 */
  recoveryCheckIntervalMs?: number;
  /** Callback invoked on every mode transition. */
  onTransition?: (from: RenderMode, to: RenderMode, event: RenderModeEvent) => void;
}

// ---------------------------------------------------------------------------
// Transition table (Task 3.1)
// ---------------------------------------------------------------------------

/**
 * Pure function that computes the next render mode given the current mode
 * and an incoming event. Returns `null` if the transition is not valid.
 */
export function nextRenderMode(
  current: RenderMode,
  event: RenderModeEvent,
): RenderMode | null {
  switch (current) {
    case 'ue-stream':
      if (event.type === 'CONNECTION_LOST') return 'connecting';
      if (event.type === 'CONNECTION_ERROR') return 'error';
      return null;

    case 'connecting':
      if (event.type === 'RECONNECT_SUCCESS') return 'ue-stream';
      if (event.type === 'RECONNECT_FAILED') return 'threejs';
      if (event.type === 'CONNECTION_ERROR') return 'error';
      return null;

    case 'threejs':
      if (event.type === 'UE_AVAILABLE') return 'ue-stream';
      if (event.type === 'THREEJS_FAILED') return 'prerender';
      return null;

    case 'prerender':
      // Terminal state: only manual reconnect can escape.
      if (event.type === 'MANUAL_RECONNECT') return 'connecting';
      return null;

    case 'error':
      if (event.type === 'MANUAL_RECONNECT') return 'connecting';
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// State Machine class (Task 3.2 + 3.3)
// ---------------------------------------------------------------------------

export class RenderModeMachine {
  private _mode: RenderMode;
  private _config: Required<Pick<RenderModeMachineConfig, 'recoveryCheckIntervalMs'>> & RenderModeMachineConfig;
  private _recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private _checkUeAvailability: (() => Promise<boolean>) | null = null;
  private _disposed = false;

  constructor(
    initialMode: RenderMode = 'connecting',
    config: RenderModeMachineConfig = {},
  ) {
    this._mode = initialMode;
    this._config = {
      recoveryCheckIntervalMs: config.recoveryCheckIntervalMs ?? 30_000,
      ...config,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Current active render mode. */
  get mode(): RenderMode {
    return this._mode;
  }

  /** Whether the machine has been disposed. */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Send an event to the state machine. Returns the new mode, or the
   * current mode if the transition was invalid.
   */
  send(event: RenderModeEvent): RenderMode {
    if (this._disposed) return this._mode;

    const next = nextRenderMode(this._mode, event);
    if (next === null) return this._mode;

    const prev = this._mode;
    this._mode = next;
    this._config.onTransition?.(prev, next, event);

    // Manage recovery timer based on new state (Task 3.3).
    this.manageRecoveryTimer();

    return this._mode;
  }

  /**
   * Start periodic UE recovery detection (Task 3.3).
   *
   * When in `threejs` mode, the machine will periodically call the provided
   * check function. If it returns `true`, the machine transitions to
   * `ue-stream` via the `UE_AVAILABLE` event.
   *
   * The check is NOT performed in `prerender` mode (terminal state protection).
   */
  startRecoveryDetection(checkFn: () => Promise<boolean>): void {
    this._checkUeAvailability = checkFn;
    this.manageRecoveryTimer();
  }

  /** Stop periodic UE recovery detection. */
  stopRecoveryDetection(): void {
    this._checkUeAvailability = null;
    this.clearRecoveryTimer();
  }

  /**
   * Dispose the machine: stop all timers and prevent further transitions.
   * Satisfies the resource release completeness property.
   */
  dispose(): void {
    this._disposed = true;
    this.clearRecoveryTimer();
    this._checkUeAvailability = null;
  }

  // -------------------------------------------------------------------------
  // Internal: recovery timer management (Task 3.3)
  // -------------------------------------------------------------------------

  private manageRecoveryTimer(): void {
    // Only run recovery checks in threejs mode.
    if (this._mode === 'threejs' && this._checkUeAvailability) {
      if (!this._recoveryTimer) {
        this._recoveryTimer = setInterval(
          () => this.performRecoveryCheck(),
          this._config.recoveryCheckIntervalMs,
        );
      }
    } else {
      this.clearRecoveryTimer();
    }
  }

  private async performRecoveryCheck(): Promise<void> {
    if (this._disposed || this._mode !== 'threejs' || !this._checkUeAvailability) {
      return;
    }

    try {
      const available = await this._checkUeAvailability();
      if (available && this._mode === 'threejs' && !this._disposed) {
        this.send({ type: 'UE_AVAILABLE' });
      }
    } catch {
      // Recovery check failure is non-fatal; we'll try again next interval.
    }
  }

  private clearRecoveryTimer(): void {
    if (this._recoveryTimer !== null) {
      clearInterval(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }
}
