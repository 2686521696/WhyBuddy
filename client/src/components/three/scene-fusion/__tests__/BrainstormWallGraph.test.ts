/**
 * Unit tests for the BrainstormWallGraph rendering logic.
 *
 * Tests layout constants, color mapping, title truncation, and adaptive scaling
 * WITHOUT requiring Three.js or dagre dependencies.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §8
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { describe, it, expect } from "vitest";
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
  drawBrainstormGraph,
} from "../brainstorm-wall-graph-logic";
import type { LayoutResult } from "../brainstorm-wall-graph-logic";

// ---------------------------------------------------------------------------
// Title Truncation
// ---------------------------------------------------------------------------

describe("truncateTitle", () => {
  it("returns short titles unchanged", () => {
    expect(truncateTitle("Short")).toBe("Short");
    expect(truncateTitle("")).toBe("");
  });

  it("truncates titles exceeding 22 chars with ellipsis", () => {
    const longTitle = "This is a very long title that exceeds the limit";
    const result = truncateTitle(longTitle);
    expect(result.length).toBe(MAX_TITLE_LENGTH + 1); // 22 chars + ellipsis char
    expect(result).toMatch(/…$/);
  });

  it("handles exactly 22 character titles", () => {
    const title22 = "A".repeat(22);
    expect(truncateTitle(title22)).toBe(title22);
  });

  it("handles 23 character titles (truncated)", () => {
    const title23 = "A".repeat(23);
    const result = truncateTitle(title23);
    expect(result).toBe("A".repeat(22) + "…");
  });
});

// ---------------------------------------------------------------------------
// Adaptive Scaling
// ---------------------------------------------------------------------------

describe("computeAdaptiveScale", () => {
  it("returns 1 when graph fits within bounds", () => {
    const scale = computeAdaptiveScale(
      100, 100,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(scale).toBeLessThanOrEqual(1.5);
  });

  it("scales down when graph exceeds canvas", () => {
    const scale = computeAdaptiveScale(
      CANVAS_W * 3, CANVAS_H * 3,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.2);
  });

  it("never exceeds 1.5x scale", () => {
    const scale = computeAdaptiveScale(
      10, 10,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeLessThanOrEqual(1.5);
  });

  it("never goes below 0.2x scale", () => {
    const scale = computeAdaptiveScale(
      CANVAS_W * 100, CANVAS_H * 100,
      CANVAS_W, CANVAS_H,
      BRAINSTORM_PADDING
    );
    expect(scale).toBeGreaterThanOrEqual(0.2);
  });

  it("returns 1 for zero-size graph", () => {
    const scale = computeAdaptiveScale(0, 0, CANVAS_W, CANVAS_H, BRAINSTORM_PADDING);
    expect(scale).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Node Color Mapping
// ---------------------------------------------------------------------------

describe("BRAINSTORM_NODE_COLORS", () => {
  it("maps all 6 node types to distinct colors", () => {
    const types = ["decision", "thinking", "action", "observation", "synthesis", "error"];
    const colors = types.map((t) => BRAINSTORM_NODE_COLORS[t as keyof typeof BRAINSTORM_NODE_COLORS]);

    // All types have colors
    for (const color of colors) {
      expect(color).toBeDefined();
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    // All colors are unique
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Layout Constants
// ---------------------------------------------------------------------------

describe("Layout constants", () => {
  it("has correct node dimensions", () => {
    expect(BRAINSTORM_NODE_W).toBe(540);
    expect(BRAINSTORM_NODE_H).toBe(168);
    expect(BRAINSTORM_PADDING).toBe(90);
  });

  it("has correct canvas dimensions", () => {
    expect(CANVAS_W).toBe(3840);
    expect(CANVAS_H).toBe(1740);
  });

  it("MAX_TITLE_LENGTH is 22", () => {
    expect(MAX_TITLE_LENGTH).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// Canvas2D Drawing (smoke test - verify it doesn't throw)
// ---------------------------------------------------------------------------

describe("drawBrainstormGraph", () => {
  // Create a minimal canvas mock for Node.js environment
  function createMockCtx(): CanvasRenderingContext2D {
    return {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
      globalAlpha: 1,
      shadowColor: "",
      shadowBlur: 0,
      shadowOffsetY: 0,
      createLinearGradient: () => ({
        addColorStop: () => {},
      }),
      fillRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      moveTo: () => {},
      bezierCurveTo: () => {},
      fillText: () => {},
      roundRect: () => {},
      setLineDash: () => {},
    } as unknown as CanvasRenderingContext2D;
  }

  it("draws empty state without throwing", () => {
    const ctx = createMockCtx();
    expect(() => drawBrainstormGraph(ctx, null)).not.toThrow();
  });

  it("draws nodes without throwing", () => {
    const ctx = createMockCtx();
    const layout: LayoutResult = {
      nodes: [
        { id: "n1", x: 100, y: 100, title: "Decision point", type: "decision", status: "active", roleId: "planner", opacity: 1 },
        { id: "n2", x: 300, y: 100, title: "Thinking", type: "thinking", status: "completed", roleId: "architect", confidence: 0.85, opacity: 1 },
      ],
      edges: [
        { from: { x: 100, y: 100 }, to: { x: 300, y: 100 } },
      ],
      scale: 1,
    };

    expect(() => drawBrainstormGraph(ctx, layout)).not.toThrow();
  });

  it("handles fade-in opacity correctly", () => {
    const ctx = createMockCtx();
    const alphaValues: number[] = [];
    Object.defineProperty(ctx, "globalAlpha", {
      set(v: number) { alphaValues.push(v); },
      get() { return 1; },
    });

    const layout: LayoutResult = {
      nodes: [
        { id: "n1", x: 100, y: 100, title: "Test", type: "thinking", status: "active", roleId: "planner", opacity: 0.5 },
      ],
      edges: [],
      scale: 1,
    };

    drawBrainstormGraph(ctx, layout);
    // Opacity should have been set to 0.5 at some point (for the fading node)
    expect(alphaValues).toContain(0.5);
    // And reset back to 1
    expect(alphaValues).toContain(1);
  });
});
