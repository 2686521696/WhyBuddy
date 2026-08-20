/**
 * 缩放系数必须能被变异咬住：拖分栏卡顿修的就是「每帧都 setScale」。
 * 公式写错、epsilon 放太大、paused 时仍提交，都会让修法失效。
 */
import { describe, expect, it } from "vitest";
import {
  SCALE_EPSILON,
  computeScaleToFit,
  scaleNeedsCommit,
  specPageViewport,
} from "../canvas-scale";

describe("computeScaleToFit", () => {
  it("contain 取宽高比里更小的那一档", () => {
    expect(computeScaleToFit(960, 540, 1920, 1080)).toBe(0.5);
    expect(computeScaleToFit(1920, 200, 1920, 1080)).toBeCloseTo(200 / 1080);
  });

  it("width 只跟容器宽走", () => {
    expect(computeScaleToFit(960, 10, 1920, 1080, "width")).toBe(0.5);
  });

  it("量不到容器就不要瞎给 1——1 会把 1920 画布撑出容器", () => {
    expect(computeScaleToFit(0, 540, 1920, 1080)).toBeNull();
    expect(computeScaleToFit(960, 0, 1920, 1080)).toBeNull();
    expect(computeScaleToFit(960, 0, 1920, 1080, "width")).toBe(0.5);
  });
});

describe("scaleNeedsCommit", () => {
  it("亚像素抖动不提交", () => {
    expect(scaleNeedsCommit(0.5, 0.5 + SCALE_EPSILON / 2)).toBe(false);
    expect(scaleNeedsCommit(0.5, 0.52)).toBe(true);
  });
});

describe("specPageViewport", () => {
  it("手机画布是 CSS 像素机身，不是 1080 物理像素", () => {
    /**
     * ⚠ 1080 下 Tailwind `lg:`（1024）着火，模型再套 max-w-md 机模，
     * 内容缩在框中间。钉「宽 < sm(640)」：改回 1080 这条必红。
     */
    expect(specPageViewport("phone")).toEqual({ w: 390, h: 844 });
    expect(specPageViewport("phone").w).toBeLessThan(640);
    expect(specPageViewport("desktop")).toEqual({ w: 1920, h: 1080 });
  });
});
