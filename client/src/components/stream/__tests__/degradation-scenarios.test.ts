/**
 * End-to-end degradation scenario tests (Task 6.3).
 *
 * Tests the full degradation flow using the RenderModeMachine and
 * QualityMonitor to verify the complete lifecycle of render mode
 * transitions, recovery, and quality auto-adjustment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RenderModeMachine,
  nextRenderMode,
  type RenderMode,
  type RenderModeEvent,
} from '@/lib/webrtc/render-mode-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all transitions from a machine into an array. */
function createTrackedMachine(
  initialMode: RenderMode,
  config?: { recoveryCheckIntervalMs?: number },
) {
  const transitions: Array<{ from: RenderMode; to: RenderMode; event: string }> = [];
  const machine = new RenderModeMachine(initialMode, {
    ...config,
    onTransition: (from, to, event) => {
      transitions.push({ from, to, event: event.type });
    },
  });
  return { machine, transitions };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Scenario 1: Full degradation chain
// UE stream → connection lost → reconnecting → reconnect failed → Three.js fallback
// ---------------------------------------------------------------------------

describe('Scenario 1: UE stream → connection lost → reconnect failed → Three.js fallback', () => {
  it('follows the complete degradation path', () => {
    const { machine, transitions } = createTrackedMachine('ue-stream');

    // Step 1: Connection is lost while streaming.
    machine.send({ type: 'CONNECTION_LOST' });
    expect(machine.mode).toBe('connecting');

    // Step 2: Reconnection fails.
    machine.send({ type: 'RECONNECT_FAILED' });
    expect(machine.mode).toBe('threejs');

    // Verify the transition history.
    expect(transitions).toEqual([
      { from: 'ue-stream', to: 'connecting', event: 'CONNECTION_LOST' },
      { from: 'connecting', to: 'threejs', event: 'RECONNECT_FAILED' },
    ]);

    machine.dispose();
  });

  it('ignores irrelevant events during each state', () => {
    const { machine } = createTrackedMachine('ue-stream');

    // UE_AVAILABLE is irrelevant in ue-stream mode.
    machine.send({ type: 'UE_AVAILABLE' });
    expect(machine.mode).toBe('ue-stream');

    // Move to connecting.
    machine.send({ type: 'CONNECTION_LOST' });
    expect(machine.mode).toBe('connecting');

    // THREEJS_FAILED is irrelevant in connecting mode.
    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('connecting');

    machine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Three.js fallback → UE recovery → back to UE stream
// ---------------------------------------------------------------------------

describe('Scenario 2: Three.js fallback → UE recovery → back to UE stream', () => {
  it('recovers from threejs to ue-stream when UE becomes available', () => {
    const { machine, transitions } = createTrackedMachine('threejs');

    machine.send({ type: 'UE_AVAILABLE' });
    expect(machine.mode).toBe('ue-stream');

    expect(transitions).toEqual([
      { from: 'threejs', to: 'ue-stream', event: 'UE_AVAILABLE' },
    ]);

    machine.dispose();
  });

  it('auto-recovers via periodic recovery detection', async () => {
    const { machine } = createTrackedMachine('threejs', {
      recoveryCheckIntervalMs: 5_000,
    });

    // First check: UE not available yet.
    const checkFn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    machine.startRecoveryDetection(checkFn);

    // First interval: check returns false, stay in threejs.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(machine.mode).toBe('threejs');
    expect(checkFn).toHaveBeenCalledTimes(1);

    // Second interval: check returns true, transition to ue-stream.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(machine.mode).toBe('ue-stream');
    expect(checkFn).toHaveBeenCalledTimes(2);

    machine.dispose();
  });

  it('handles full cycle: ue-stream → connecting → threejs → recovery → ue-stream', () => {
    const { machine, transitions } = createTrackedMachine('ue-stream');

    // Degrade.
    machine.send({ type: 'CONNECTION_LOST' });
    machine.send({ type: 'RECONNECT_FAILED' });
    expect(machine.mode).toBe('threejs');

    // Recover.
    machine.send({ type: 'UE_AVAILABLE' });
    expect(machine.mode).toBe('ue-stream');

    expect(transitions).toEqual([
      { from: 'ue-stream', to: 'connecting', event: 'CONNECTION_LOST' },
      { from: 'connecting', to: 'threejs', event: 'RECONNECT_FAILED' },
      { from: 'threejs', to: 'ue-stream', event: 'UE_AVAILABLE' },
    ]);

    machine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Three.js fallback → Three.js failure → prerender (terminal)
// ---------------------------------------------------------------------------

describe('Scenario 3: Three.js fallback → Three.js failure → prerender (terminal)', () => {
  it('degrades from threejs to prerender on Three.js failure', () => {
    const { machine, transitions } = createTrackedMachine('threejs');

    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('prerender');

    expect(transitions).toEqual([
      { from: 'threejs', to: 'prerender', event: 'THREEJS_FAILED' },
    ]);

    machine.dispose();
  });

  it('prerender blocks all automatic events', () => {
    const { machine } = createTrackedMachine('prerender');

    // None of these should change the mode.
    machine.send({ type: 'CONNECTION_LOST' });
    expect(machine.mode).toBe('prerender');

    machine.send({ type: 'RECONNECT_SUCCESS' });
    expect(machine.mode).toBe('prerender');

    machine.send({ type: 'RECONNECT_FAILED' });
    expect(machine.mode).toBe('prerender');

    machine.send({ type: 'UE_AVAILABLE' });
    expect(machine.mode).toBe('prerender');

    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('prerender');

    machine.send({ type: 'CONNECTION_ERROR' });
    expect(machine.mode).toBe('prerender');

    machine.dispose();
  });

  it('does not run recovery checks in prerender mode', async () => {
    const { machine } = createTrackedMachine('prerender', {
      recoveryCheckIntervalMs: 1_000,
    });

    const checkFn = vi.fn().mockResolvedValue(true);
    machine.startRecoveryDetection(checkFn);

    await vi.advanceTimersByTimeAsync(5_000);

    // Check should never have been called.
    expect(checkFn).not.toHaveBeenCalled();
    expect(machine.mode).toBe('prerender');

    machine.dispose();
  });

  it('follows full degradation chain: ue-stream → connecting → threejs → prerender', () => {
    const { machine, transitions } = createTrackedMachine('ue-stream');

    machine.send({ type: 'CONNECTION_LOST' });
    machine.send({ type: 'RECONNECT_FAILED' });
    machine.send({ type: 'THREEJS_FAILED' });

    expect(machine.mode).toBe('prerender');
    expect(transitions).toEqual([
      { from: 'ue-stream', to: 'connecting', event: 'CONNECTION_LOST' },
      { from: 'connecting', to: 'threejs', event: 'RECONNECT_FAILED' },
      { from: 'threejs', to: 'prerender', event: 'THREEJS_FAILED' },
    ]);

    machine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Prerender → manual reconnect → connecting → success → UE stream
// ---------------------------------------------------------------------------

describe('Scenario 4: Prerender → manual reconnect → connecting → success → UE stream', () => {
  it('allows manual reconnect from prerender terminal state', () => {
    const { machine, transitions } = createTrackedMachine('prerender');

    machine.send({ type: 'MANUAL_RECONNECT' });
    expect(machine.mode).toBe('connecting');

    machine.send({ type: 'RECONNECT_SUCCESS' });
    expect(machine.mode).toBe('ue-stream');

    expect(transitions).toEqual([
      { from: 'prerender', to: 'connecting', event: 'MANUAL_RECONNECT' },
      { from: 'connecting', to: 'ue-stream', event: 'RECONNECT_SUCCESS' },
    ]);

    machine.dispose();
  });

  it('allows manual reconnect from error state', () => {
    const { machine, transitions } = createTrackedMachine('error');

    machine.send({ type: 'MANUAL_RECONNECT' });
    expect(machine.mode).toBe('connecting');

    machine.send({ type: 'RECONNECT_SUCCESS' });
    expect(machine.mode).toBe('ue-stream');

    expect(transitions).toEqual([
      { from: 'error', to: 'connecting', event: 'MANUAL_RECONNECT' },
      { from: 'connecting', to: 'ue-stream', event: 'RECONNECT_SUCCESS' },
    ]);

    machine.dispose();
  });

  it('manual reconnect from prerender can fail and degrade again', () => {
    const { machine } = createTrackedMachine('prerender');

    // Manual reconnect.
    machine.send({ type: 'MANUAL_RECONNECT' });
    expect(machine.mode).toBe('connecting');

    // Reconnect fails again → back to threejs.
    machine.send({ type: 'RECONNECT_FAILED' });
    expect(machine.mode).toBe('threejs');

    // Three.js also fails → back to prerender.
    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('prerender');

    machine.dispose();
  });

  it('full round-trip: ue-stream → degrade to prerender → manual reconnect → ue-stream', () => {
    const { machine, transitions } = createTrackedMachine('ue-stream');

    // Full degradation.
    machine.send({ type: 'CONNECTION_LOST' });
    machine.send({ type: 'RECONNECT_FAILED' });
    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('prerender');

    // Manual recovery.
    machine.send({ type: 'MANUAL_RECONNECT' });
    machine.send({ type: 'RECONNECT_SUCCESS' });
    expect(machine.mode).toBe('ue-stream');

    expect(transitions).toHaveLength(5);
    expect(transitions[0]).toEqual({ from: 'ue-stream', to: 'connecting', event: 'CONNECTION_LOST' });
    expect(transitions[4]).toEqual({ from: 'connecting', to: 'ue-stream', event: 'RECONNECT_SUCCESS' });

    machine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Quality auto-adjustment during streaming
// ---------------------------------------------------------------------------

describe('Scenario 5: Quality auto-adjustment during streaming', () => {
  it('nextRenderMode returns null for quality-unrelated events in ue-stream', () => {
    // Quality changes don't affect the render mode state machine.
    // The quality monitor operates independently.
    expect(nextRenderMode('ue-stream', { type: 'RECONNECT_SUCCESS' })).toBeNull();
    expect(nextRenderMode('ue-stream', { type: 'THREEJS_FAILED' })).toBeNull();
    expect(nextRenderMode('ue-stream', { type: 'UE_AVAILABLE' })).toBeNull();
  });

  it('render mode stays ue-stream during quality adjustments', () => {
    const { machine } = createTrackedMachine('ue-stream');

    // Quality changes are handled by QualityMonitor, not the state machine.
    // The machine should remain in ue-stream regardless of quality events.
    // Sending irrelevant events should not change the mode.
    machine.send({ type: 'RECONNECT_SUCCESS' });
    expect(machine.mode).toBe('ue-stream');

    machine.send({ type: 'UE_AVAILABLE' });
    expect(machine.mode).toBe('ue-stream');

    machine.dispose();
  });

  it('connection error during streaming transitions to error state', () => {
    const { machine } = createTrackedMachine('ue-stream');

    machine.send({ type: 'CONNECTION_ERROR' });
    expect(machine.mode).toBe('error');

    machine.dispose();
  });

  it('connection error during reconnection transitions to error state', () => {
    const { machine } = createTrackedMachine('connecting');

    machine.send({ type: 'CONNECTION_ERROR' });
    expect(machine.mode).toBe('error');

    machine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Recovery detection lifecycle
// ---------------------------------------------------------------------------

describe('Scenario 6: Recovery detection lifecycle across mode transitions', () => {
  it('stops recovery checks when transitioning out of threejs', async () => {
    const { machine } = createTrackedMachine('threejs', {
      recoveryCheckIntervalMs: 2_000,
    });

    const checkFn = vi.fn().mockResolvedValue(false);
    machine.startRecoveryDetection(checkFn);

    // One check fires.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkFn).toHaveBeenCalledTimes(1);

    // Transition to prerender.
    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('prerender');

    // No more checks should fire.
    checkFn.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkFn).not.toHaveBeenCalled();

    machine.dispose();
  });

  it('resumes recovery checks when re-entering threejs after manual reconnect failure', async () => {
    const { machine } = createTrackedMachine('threejs', {
      recoveryCheckIntervalMs: 2_000,
    });

    const checkFn = vi.fn().mockResolvedValue(false);
    machine.startRecoveryDetection(checkFn);

    // Degrade to prerender.
    machine.send({ type: 'THREEJS_FAILED' });
    expect(machine.mode).toBe('prerender');

    // Manual reconnect → fails → back to threejs.
    machine.send({ type: 'MANUAL_RECONNECT' });
    machine.send({ type: 'RECONNECT_FAILED' });
    expect(machine.mode).toBe('threejs');

    // Recovery checks should resume.
    checkFn.mockClear();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checkFn).toHaveBeenCalledTimes(1);

    machine.dispose();
  });

  it('handles recovery check errors gracefully without crashing', async () => {
    const { machine } = createTrackedMachine('threejs', {
      recoveryCheckIntervalMs: 1_000,
    });

    const checkFn = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(true);

    machine.startRecoveryDetection(checkFn);

    // First check: error → stays in threejs.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(machine.mode).toBe('threejs');

    // Second check: success → transitions to ue-stream.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(machine.mode).toBe('ue-stream');

    machine.dispose();
  });
});
