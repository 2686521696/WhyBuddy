import { describe, expect, it } from 'vitest';

import {
  computeCameraXOffset,
  computeFovCompensation,
} from './camera-compensation';

describe('computeFovCompensation', () => {
  // ── Monotonicity ──────────────────────────────────────────────
  it('returns 0 at the wide threshold (1200)', () => {
    expect(computeFovCompensation(1200)).toBe(0);
  });

  it('returns MAX (6) at the narrow threshold (800)', () => {
    expect(computeFovCompensation(800)).toBe(6);
  });

  it('returns 0 for widths above the wide threshold', () => {
    expect(computeFovCompensation(1920)).toBe(0);
    expect(computeFovCompensation(2560)).toBe(0);
  });

  it('returns MAX for widths below the narrow threshold', () => {
    expect(computeFovCompensation(375)).toBe(6);
    expect(computeFovCompensation(0)).toBe(6);
  });

  it('is monotonically non-increasing (narrower → larger compensation)', () => {
    const widths = [1400, 1200, 1100, 1000, 900, 800, 600];
    const compensations = widths.map(computeFovCompensation);

    for (let i = 0; i < compensations.length - 1; i++) {
      expect(compensations[i]).toBeLessThanOrEqual(compensations[i + 1]);
    }
  });

  // ── Boundedness ───────────────────────────────────────────────
  it('is bounded within [0, 6] for representative widths', () => {
    const widths = [0, 100, 375, 600, 800, 900, 1000, 1100, 1200, 1400, 1920];
    for (const w of widths) {
      const c = computeFovCompensation(w);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(6);
    }
  });

  // ── Specific interpolation values ─────────────────────────────
  it('returns ~3 at the midpoint (1000px)', () => {
    // (1200 - 1000) / (1200 - 800) * 6 = 200/400 * 6 = 3
    expect(computeFovCompensation(1000)).toBeCloseTo(3, 5);
  });

  it('returns ~1.5 at 1100px', () => {
    // (1200 - 1100) / (1200 - 800) * 6 = 100/400 * 6 = 1.5
    expect(computeFovCompensation(1100)).toBeCloseTo(1.5, 5);
  });
});

describe('computeCameraXOffset', () => {
  it('returns 0 when sidebarWidth is 0', () => {
    expect(computeCameraXOffset(1280, 0)).toBe(0);
  });

  it('returns MAX_OFFSET (0.3) when sidebarWidth is 240', () => {
    expect(computeCameraXOffset(1040, 240)).toBeCloseTo(0.3, 5);
  });

  it('returns proportional offset for 64px sidebar', () => {
    // 64 / 240 * 0.3 = 0.08
    expect(computeCameraXOffset(1216, 64)).toBeCloseTo(0.08, 5);
  });

  it('clamps at MAX_OFFSET for sidebar wider than 240', () => {
    expect(computeCameraXOffset(800, 300)).toBeCloseTo(0.3, 5);
  });
});
