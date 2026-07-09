/**
 * Tests for the degradation state machine (RenderModeMachine).
 *
 * Includes unit tests for specific transitions and property-based tests
 * using fast-check to verify invariants across all possible inputs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';

import {
  RenderModeMachine,
  nextRenderMode,
  type RenderMode,
  type RenderModeEvent,
} from './render-mode-machine';

// ---------------------------------------------------------------------------
// Arbitraries for property-based tests
// ---------------------------------------------------------------------------

const renderModeArb: fc.Arbitrary<RenderMode> = fc.constantFrom(
  'ue-stream',
  'threejs',
  'prerender',
  'connecting',
  'error',
);

const renderModeEventArb: fc.Arbitrary<RenderModeEvent> = fc.oneof(
  fc.constant({ type: 'CONNECTION_LOST' } as RenderModeEvent),
  fc.constant({ type: 'RECONNECT_SUCCESS' } as RenderModeEvent),
  fc.constant({ type: 'RECONNECT_FAILED' } as RenderModeEvent),
  fc.constant({ type: 'UE_AVAILABLE' } as RenderModeEvent),
  fc.constant({ type: 'THREEJS_FAILED' } as RenderModeEvent),
  fc.constant({ type: 'MANUAL_RECONNECT' } as RenderModeEvent),
  fc.constant({ type: 'CONNECTION_ERROR' } as RenderModeEvent),
);

const eventSequenceArb = fc.array(renderModeEventArb, { minLength: 1, maxLength: 50 });

// ---------------------------------------------------------------------------
// Unit tests: nextRenderMode pure function (Task 3.1)
// ---------------------------------------------------------------------------

describe('nextRenderMode (transition rules)', () => {
  describe('from ue-stream', () => {
    it('transitions to connecting on CONNECTION_LOST', () => {
      expect(nextRenderMode('ue-stream', { type: 'CONNECTION_LOST' })).toBe('connecting');
    });

    it('transitions to error on CONNECTION_ERROR', () => {
      expect(nextRenderMode('ue-stream', { type: 'CONNECTION_ERROR' })).toBe('error');
    });

    it('ignores irrelevant events', () => {
      expect(nextRenderMode('ue-stream', { type: 'RECONNECT_SUCCESS' })).toBeNull();
      expect(nextRenderMode('ue-stream', { type: 'THREEJS_FAILED' })).toBeNull();
      expect(nextRenderMode('ue-stream', { type: 'UE_AVAILABLE' })).toBeNull();
    });
  });

  describe('from connecting', () => {
    it('transitions to ue-stream on RECONNECT_SUCCESS', () => {
      expect(nextRenderMode('connecting', { type: 'RECONNECT_SUCCESS' })).toBe('ue-stream');
    });

    it('transitions to threejs on RECONNECT_FAILED', () => {
      expect(nextRenderMode('connecting', { type: 'RECONNECT_FAILED' })).toBe('threejs');
    });

    it('transitions to error on CONNECTION_ERROR', () => {
      expect(nextRenderMode('connecting', { type: 'CONNECTION_ERROR' })).toBe('error');
    });

    it('ignores irrelevant events', () => {
      expect(nextRenderMode('connecting', { type: 'CONNECTION_LOST' })).toBeNull();
      expect(nextRenderMode('connecting', { type: 'THREEJS_FAILED' })).toBeNull();
    });
  });

  describe('from threejs', () => {
    it('transitions to ue-stream on UE_AVAILABLE', () => {
      expect(nextRenderMode('threejs', { type: 'UE_AVAILABLE' })).toBe('ue-stream');
    });

    it('transitions to prerender on THREEJS_FAILED', () => {
      expect(nextRenderMode('threejs', { type: 'THREEJS_FAILED' })).toBe('prerender');
    });

    it('ignores irrelevant events', () => {
      expect(nextRenderMode('threejs', { type: 'CONNECTION_LOST' })).toBeNull();
      expect(nextRenderMode('threejs', { type: 'RECONNECT_SUCCESS' })).toBeNull();
    });
  });

  describe('from prerender (terminal state)', () => {
    it('only allows MANUAL_RECONNECT', () => {
      expect(nextRenderMode('prerender', { type: 'MANUAL_RECONNECT' })).toBe('connecting');
    });

    it('blocks all automatic transitions', () => {
      expect(nextRenderMode('prerender', { type: 'CONNECTION_LOST' })).toBeNull();
      expect(nextRenderMode('prerender', { type: 'RECONNECT_SUCCESS' })).toBeNull();
      expect(nextRenderMode('prerender', { type: 'RECONNECT_FAILED' })).toBeNull();
      expect(nextRenderMode('prerender', { type: 'UE_AVAILABLE' })).toBeNull();
      expect(nextRenderMode('prerender', { type: 'THREEJS_FAILED' })).toBeNull();
      expect(nextRenderMode('prerender', { type: 'CONNECTION_ERROR' })).toBeNull();
    });
  });

  describe('from error', () => {
    it('allows MANUAL_RECONNECT', () => {
      expect(nextRenderMode('error', { type: 'MANUAL_RECONNECT' })).toBe('connecting');
    });

    it('blocks other events', () => {
      expect(nextRenderMode('error', { type: 'CONNECTION_LOST' })).toBeNull();
      expect(nextRenderMode('error', { type: 'RECONNECT_SUCCESS' })).toBeNull();
      expect(nextRenderMode('error', { type: 'UE_AVAILABLE' })).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests: RenderModeMachine class (Task 3.2 + 3.3)
// ---------------------------------------------------------------------------

describe('RenderModeMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('degradation chain (Task 3.2)', () => {
    it('follows the full degradation path: ue-stream → connecting → threejs → prerender', () => {
      const machine = new RenderModeMachine('ue-stream');

      expect(machine.send({ type: 'CONNECTION_LOST' })).toBe('connecting');
      expect(machine.send({ type: 'RECONNECT_FAILED' })).toBe('threejs');
      expect(machine.send({ type: 'THREEJS_FAILED' })).toBe('prerender');
      expect(machine.mode).toBe('prerender');
    });

    it('recovers from connecting to ue-stream on reconnect success', () => {
      const machine = new RenderModeMachine('ue-stream');

      machine.send({ type: 'CONNECTION_LOST' });
      expect(machine.mode).toBe('connecting');

      machine.send({ type: 'RECONNECT_SUCCESS' });
      expect(machine.mode).toBe('ue-stream');
    });

    it('calls onTransition callback on valid transitions', () => {
      const transitions: Array<{ from: RenderMode; to: RenderMode }> = [];
      const machine = new RenderModeMachine('ue-stream', {
        onTransition: (from, to) => transitions.push({ from, to }),
      });

      machine.send({ type: 'CONNECTION_LOST' });
      machine.send({ type: 'RECONNECT_FAILED' });

      expect(transitions).toEqual([
        { from: 'ue-stream', to: 'connecting' },
        { from: 'connecting', to: 'threejs' },
      ]);
    });

    it('does not call onTransition for invalid events', () => {
      const onTransition = vi.fn();
      const machine = new RenderModeMachine('ue-stream', { onTransition });

      machine.send({ type: 'RECONNECT_SUCCESS' }); // invalid from ue-stream
      expect(onTransition).not.toHaveBeenCalled();
    });

    it('returns current mode for invalid transitions', () => {
      const machine = new RenderModeMachine('ue-stream');
      const result = machine.send({ type: 'THREEJS_FAILED' });
      expect(result).toBe('ue-stream');
    });
  });

  describe('upgrade detection (Task 3.3)', () => {
    it('transitions from threejs to ue-stream when UE becomes available', () => {
      const machine = new RenderModeMachine('threejs');
      machine.send({ type: 'UE_AVAILABLE' });
      expect(machine.mode).toBe('ue-stream');
    });

    it('runs periodic recovery checks in threejs mode', async () => {
      const checkFn = vi.fn().mockResolvedValue(false);
      const machine = new RenderModeMachine('threejs', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);

      // Advance past one interval.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(checkFn).toHaveBeenCalledTimes(1);

      // Advance past another interval.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(checkFn).toHaveBeenCalledTimes(2);

      machine.dispose();
    });

    it('auto-transitions to ue-stream when recovery check returns true', async () => {
      const checkFn = vi.fn().mockResolvedValue(true);
      const machine = new RenderModeMachine('threejs', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(machine.mode).toBe('ue-stream');
      machine.dispose();
    });

    it('stops recovery checks when leaving threejs mode', async () => {
      const checkFn = vi.fn().mockResolvedValue(false);
      const machine = new RenderModeMachine('threejs', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);

      // Transition away from threejs.
      machine.send({ type: 'THREEJS_FAILED' });
      expect(machine.mode).toBe('prerender');

      // Advance time — check should not be called.
      checkFn.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(checkFn).not.toHaveBeenCalled();

      machine.dispose();
    });

    it('does NOT run recovery checks in prerender mode', async () => {
      const checkFn = vi.fn().mockResolvedValue(true);
      const machine = new RenderModeMachine('prerender', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(checkFn).not.toHaveBeenCalled();
      expect(machine.mode).toBe('prerender');

      machine.dispose();
    });

    it('handles recovery check errors gracefully', async () => {
      const checkFn = vi.fn().mockRejectedValue(new Error('network error'));
      const machine = new RenderModeMachine('threejs', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);

      // Should not throw.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(machine.mode).toBe('threejs');

      machine.dispose();
    });

    it('stopRecoveryDetection stops the timer', async () => {
      const checkFn = vi.fn().mockResolvedValue(false);
      const machine = new RenderModeMachine('threejs', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(checkFn).toHaveBeenCalledTimes(1);

      machine.stopRecoveryDetection();
      checkFn.mockClear();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(checkFn).not.toHaveBeenCalled();

      machine.dispose();
    });
  });

  describe('dispose', () => {
    it('prevents further transitions after dispose', () => {
      const machine = new RenderModeMachine('ue-stream');
      machine.dispose();

      const result = machine.send({ type: 'CONNECTION_LOST' });
      expect(result).toBe('ue-stream');
      expect(machine.disposed).toBe(true);
    });

    it('clears recovery timer on dispose', async () => {
      const checkFn = vi.fn().mockResolvedValue(false);
      const machine = new RenderModeMachine('threejs', {
        recoveryCheckIntervalMs: 5_000,
      });

      machine.startRecoveryDetection(checkFn);
      machine.dispose();

      checkFn.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(checkFn).not.toHaveBeenCalled();
    });
  });

  describe('manual reconnect from terminal states', () => {
    it('allows manual reconnect from prerender', () => {
      const machine = new RenderModeMachine('prerender');
      machine.send({ type: 'MANUAL_RECONNECT' });
      expect(machine.mode).toBe('connecting');
    });

    it('allows manual reconnect from error', () => {
      const machine = new RenderModeMachine('error');
      machine.send({ type: 'MANUAL_RECONNECT' });
      expect(machine.mode).toBe('connecting');
    });
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (Task 3.4)
// ---------------------------------------------------------------------------

describe('RenderModeMachine property-based tests', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * Property 1: 渲染模式唯一性 (Render mode uniqueness)
   * At any point in time, the machine is in exactly one of the valid render modes.
   */
  it('always stays in a valid render mode after any sequence of events', () => {
    const validModes: RenderMode[] = ['ue-stream', 'threejs', 'prerender', 'connecting', 'error'];

    fc.assert(
      fc.property(
        renderModeArb,
        eventSequenceArb,
        (initialMode, events) => {
          const machine = new RenderModeMachine(initialMode);

          for (const event of events) {
            machine.send(event);
            expect(validModes).toContain(machine.mode);
          }

          machine.dispose();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property 2: 降级不可逆保护 (Prerender terminal state protection)
   * Once in prerender mode, no automatic event (anything except MANUAL_RECONNECT)
   * can transition the machine out of prerender.
   */
  it('prerender is terminal: only MANUAL_RECONNECT can escape', () => {
    const automaticEventArb: fc.Arbitrary<RenderModeEvent> = fc.oneof(
      fc.constant({ type: 'CONNECTION_LOST' } as RenderModeEvent),
      fc.constant({ type: 'RECONNECT_SUCCESS' } as RenderModeEvent),
      fc.constant({ type: 'RECONNECT_FAILED' } as RenderModeEvent),
      fc.constant({ type: 'UE_AVAILABLE' } as RenderModeEvent),
      fc.constant({ type: 'THREEJS_FAILED' } as RenderModeEvent),
      fc.constant({ type: 'CONNECTION_ERROR' } as RenderModeEvent),
    );

    fc.assert(
      fc.property(
        fc.array(automaticEventArb, { minLength: 1, maxLength: 50 }),
        (events) => {
          const machine = new RenderModeMachine('prerender');

          for (const event of events) {
            machine.send(event);
          }

          // Must still be in prerender after any number of automatic events.
          expect(machine.mode).toBe('prerender');
          machine.dispose();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property 3: 资源释放完整性 (Resource release on dispose)
   * After dispose, no event can change the mode.
   */
  it('after dispose, mode never changes regardless of events', () => {
    fc.assert(
      fc.property(
        renderModeArb,
        eventSequenceArb,
        (initialMode, events) => {
          const machine = new RenderModeMachine(initialMode);
          machine.dispose();

          const frozenMode = machine.mode;

          for (const event of events) {
            machine.send(event);
          }

          expect(machine.mode).toBe(frozenMode);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.3**
   *
   * Property 4: Degradation chain monotonicity
   * Without MANUAL_RECONNECT or UE_AVAILABLE, the degradation only moves
   * "downward" through the chain: ue-stream → connecting → threejs → prerender.
   * It never spontaneously upgrades.
   */
  it('without upgrade events, degradation only moves downward', () => {
    const degradationOrder: Record<RenderMode, number> = {
      'ue-stream': 0,
      'connecting': 1,
      'threejs': 2,
      'prerender': 3,
      'error': 4,
    };

    const degradationOnlyEventArb: fc.Arbitrary<RenderModeEvent> = fc.oneof(
      fc.constant({ type: 'CONNECTION_LOST' } as RenderModeEvent),
      fc.constant({ type: 'RECONNECT_FAILED' } as RenderModeEvent),
      fc.constant({ type: 'THREEJS_FAILED' } as RenderModeEvent),
      fc.constant({ type: 'CONNECTION_ERROR' } as RenderModeEvent),
    );

    fc.assert(
      fc.property(
        fc.array(degradationOnlyEventArb, { minLength: 1, maxLength: 30 }),
        (events) => {
          const machine = new RenderModeMachine('ue-stream');
          let maxLevel = degradationOrder['ue-stream'];

          for (const event of events) {
            machine.send(event);
            const currentLevel = degradationOrder[machine.mode];
            expect(currentLevel).toBeGreaterThanOrEqual(maxLevel);
            maxLevel = Math.max(maxLevel, currentLevel);
          }

          machine.dispose();
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Property 5: nextRenderMode is deterministic
   * The same (mode, event) pair always produces the same result.
   */
  it('nextRenderMode is deterministic', () => {
    fc.assert(
      fc.property(
        renderModeArb,
        renderModeEventArb,
        (mode, event) => {
          const result1 = nextRenderMode(mode, event);
          const result2 = nextRenderMode(mode, event);
          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 500 },
    );
  });
});
