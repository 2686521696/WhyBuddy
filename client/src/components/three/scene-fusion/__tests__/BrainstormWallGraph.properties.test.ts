/**
 * Property-based tests for the BrainstormWallGraph renderer logic.
 *
 * Property 17: Node type color mapping uniqueness
 * Property 18: Title truncation invariant
 * Property 19: Adaptive scaling fits wall bounds
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md
 * Requirements: 7.3, 7.5, 7.7
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  truncateTitle,
  computeAdaptiveScale,
  BRAINSTORM_NODE_COLORS,
  BRAINSTORM_NODE_W,
  BRAINSTORM_NODE_H,
  BRAINSTORM_PADDING,
  MAX_TITLE_LENGTH,
  CANVAS_W,
  CANVAS_H,
} from "../brainstorm-wall-graph-logic";
import type { BranchNodeType } from "@shared/blueprint/brainstorm-contracts";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const nodeTypeArb = fc.constantFrom(
  "decision", "thinking", "action", "observation", "synthesis", "error"
) as fc.Arbitrary<BranchNodeType>;

describe("Feature: autopilot-multi-agent-brainstorm, Wall Graph Properties", () => {
  // ─── Property 17: Node type color mapping uniqueness ───────────────────

  it("Property 17: For any two distinct BranchNodeType values, they map to distinct colors", () => {
    /**
     * **Validates: Requirements 7.3**
     */
    fc.assert(
      fc.property(
        nodeTypeArb,
        nodeTypeArb,
        (typeA, typeB) => {
          const colorA = BRAINSTORM_NODE_COLORS[typeA];
          const colorB = BRAINSTORM_NODE_COLORS[typeB];

          // Both types must have a defined color
          expect(colorA).toBeDefined();
          expect(colorB).toBeDefined();

          // If types are different, colors must be different
          if (typeA !== typeB) {
            expect(colorA).not.toBe(colorB);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 18: Title truncation invariant ───────────────────────────

  it("Property 18: For any title, displayed title is at most 22 characters; longer titles get ellipsis", () => {
    /**
     * **Validates: Requirements 7.5**
     */
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (title) => {
          const truncated = truncateTitle(title);

          if (title.length <= MAX_TITLE_LENGTH) {
            // Short titles are unchanged
            expect(truncated).toBe(title);
            expect(truncated.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
          } else {
            // Long titles are truncated with ellipsis
            expect(truncated.length).toBe(MAX_TITLE_LENGTH + 1); // +1 for the ellipsis char
            expect(truncated).toMatch(/…$/);
            expect(truncated.slice(0, MAX_TITLE_LENGTH)).toBe(
              title.slice(0, MAX_TITLE_LENGTH)
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 19: Adaptive scaling fits wall bounds ────────────────────

  it("Property 19: For any graph dimensions, scaled layout fits within wall bounds", () => {
    /**
     * **Validates: Requirements 7.7**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }), // graphWidth
        fc.integer({ min: 1, max: 5000 }), // graphHeight
        (graphWidth, graphHeight) => {
          const scale = computeAdaptiveScale(
            graphWidth,
            graphHeight,
            CANVAS_W,
            CANVAS_H,
            BRAINSTORM_PADDING
          );

          // Scale is always in valid range
          expect(scale).toBeGreaterThanOrEqual(0.2);
          expect(scale).toBeLessThanOrEqual(1.5);

          // After scaling, the graph should fit within canvas bounds
          const scaledWidth = graphWidth * scale;
          const scaledHeight = graphHeight * scale;
          const availableWidth = CANVAS_W - BRAINSTORM_PADDING * 2;
          const availableHeight = CANVAS_H - BRAINSTORM_PADDING * 2;

          // The scaled graph should fit within the available area
          // (allowing for the scale clamp at 0.2 which may not perfectly fit)
          if (scale > 0.2) {
            expect(scaledWidth).toBeLessThanOrEqual(availableWidth * 1.01); // tiny float tolerance
            expect(scaledHeight).toBeLessThanOrEqual(availableHeight * 1.01);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
