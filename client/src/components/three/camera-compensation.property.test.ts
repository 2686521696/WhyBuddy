import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { computeFovCompensation } from './camera-compensation';

describe('computeFovCompensation – property-based tests', () => {
  it('is bounded within [0, 6] for any non-negative width', () => {
    fc.assert(
      fc.property(fc.nat(10_000), (width) => {
        const c = computeFovCompensation(width);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(6);
      })
    );
  });

  it('is monotonically non-increasing: wider viewport → smaller or equal compensation', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000),
        fc.nat(10_000),
        (a, b) => {
          const wider = Math.max(a, b);
          const narrower = Math.min(a, b);
          expect(computeFovCompensation(wider)).toBeLessThanOrEqual(
            computeFovCompensation(narrower)
          );
        }
      )
    );
  });

  it('returns exactly 0 for any width >= 1200', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1200, max: 10_000 }), (width) => {
        expect(computeFovCompensation(width)).toBe(0);
      })
    );
  });

  it('returns exactly 6 for any width <= 800', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 800 }), (width) => {
        expect(computeFovCompensation(width)).toBe(6);
      })
    );
  });
});
