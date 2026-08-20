/**
 * 欢迎页鼠标点阵：对照 interactive-dot-grid 的二次衰减，接线必须在空舞台。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cursorInfluence, HOME_HOVER_DOT, dotTileCss } from "../home-hover-dots";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("cursorInfluence 二次衰减", () => {
  it("圆心是 1，半径外是 0，半程是 0.25 不是 0.5", () => {
    expect(cursorInfluence(0, 100)).toBe(1);
    expect(cursorInfluence(100, 100)).toBe(0);
    expect(cursorInfluence(200, 100)).toBe(0);
    expect(cursorInfluence(50, 100)).toBe(0.25);
  });

  it("半径非法时不抛、不当成亮点", () => {
    expect(cursorInfluence(0, 0)).toBe(0);
    expect(cursorInfluence(10, -8)).toBe(0);
  });
});

describe("点色是浅灰不是粉紫", () => {
  it("暖灰，相对加浓那版再淡 2/3，密和小剩 1/3", () => {
    expect(HOME_HOVER_DOT.color).toBe("88,84,80");
    expect(HOME_HOVER_DOT.baseAlpha).toBeCloseTo((0.2 * 2) / 3, 5);
    expect(HOME_HOVER_DOT.maxAlpha).toBeCloseTo((0.78 * 2) / 3, 5);
    expect(HOME_HOVER_DOT.spacing).toBeCloseTo(24 / 3, 5);
    expect(HOME_HOVER_DOT.dotMin).toBeCloseTo(1.35 / 3, 5);
    expect(HOME_HOVER_DOT.dotMax).toBeCloseTo((1.35 / 3) * 1.8, 5);
    expect(HOME_HOVER_DOT.radiusEffect).toBe(72);
    expect(HOME_HOVER_DOT.dotMax).toBeLessThan(HOME_HOVER_DOT.spacing / 2);
    expect(HOME_HOVER_DOT.color).not.toMatch(/139,\s*92,\s*246/);
    const tile = dotTileCss(HOME_HOVER_DOT.dotMin, HOME_HOVER_DOT.baseAlpha);
    expect(tile).toContain("radial-gradient");
    expect(tile).toContain(HOME_HOVER_DOT.color);
    expect(tile).not.toContain("canvas");
  });
});

describe("活路径：只欢迎页挂，开聊不挂", () => {
  it("SlideRuleStudio 空舞台才渲染 HomeHoverDots，且听 window 不是听 canvas", () => {
    const studio = stripComments(
      readFileSync(
        fileURLToPath(new URL("../SlideRuleStudio.tsx", import.meta.url)),
        "utf8"
      )
    );
    const emptyAt = studio.indexOf("if (!showStage)");
    expect(emptyAt).toBeGreaterThan(-1);
    const empty = studio.slice(emptyAt, studio.indexOf("const stagePanel", emptyAt));
    expect(empty).toContain("HomeHoverDots");
    expect(empty).toContain("!stageVisible");
    // 变异：挂到有舞台的分栏上，欢迎页独占全宽这条就看不见。
    const split = studio.slice(studio.indexOf("const stagePanel"));
    expect(split).not.toContain("HomeHoverDots");

    const dotsRaw = readFileSync(
      fileURLToPath(new URL("../home-hover-dots.tsx", import.meta.url)),
      "utf8"
    );
    const dots = stripComments(dotsRaw);
    expect(dots).toContain("window.addEventListener(\"mousemove\"");
    expect(dots).not.toContain("canvas.addEventListener(\"mousemove\"");
    expect(dots).toContain("pointerEvents = \"none\"");
    expect(dots).toContain("sliderule-home-hover-dots");
    expect(dots).not.toContain("rgba(167,139,250");
    expect(dots).toContain("radial-gradient");
    expect(dots).toContain("maskImage");
    expect(dots).toContain("--mx");
    expect(dots).not.toContain('getContext("2d")');
    expect(dots).not.toContain("requestAnimationFrame");
    expect(dots).not.toContain("beginPath");
    const reducedAt = dots.indexOf("function prefersReducedMotion");
    const mountAt = dots.indexOf("export function mountHomeHoverDotGrid");
    const reducedFn = dots.slice(reducedAt, mountAt);
    expect(reducedFn).not.toContain("addEventListener");
    expect(dots).toContain("sliderule-home-hover-spot");
  });
});
