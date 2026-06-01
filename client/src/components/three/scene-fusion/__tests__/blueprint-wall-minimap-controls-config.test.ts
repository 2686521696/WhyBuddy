/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 5.3 / 5.4 —
 * 墙面 minimap 插件 + 受约束 fit/zoom 的**配置级 / 源码级**护栏测试。
 *
 * 为什么是 config / source 级而不是活图渲染：`<FlowGraph>` 需要真实 canvas，无法在
 * node 测试环境（无 DOM canvas）下完整渲染，因此沿用同目录数据 spec / HUD 护栏的做法
 * （`blueprint-wall-process-data.test.ts` / `blueprint-wall-process-graph-hud.test.tsx`）：
 *  - 对纯数据常量（minimap 插件配置 / zoomRange / 缩放夹紧函数）做直接断言；
 *  - 对宿主组件 `BlueprintWallProcessGraphHud.tsx` 源码做精确的「确实把这些配置接到了
 *    `<FlowGraph>` / 外部控件」断言（读磁盘文本，不渲染重型图）。
 *
 * 覆盖（Req 2.3 / 2.4 / 7.3 / 9.1 / 9.5 / 9.7）：
 *  1. minimap 插件 type=minimap、位置在右下（right-bottom）。
 *  2. zoomRange 是收紧后的 wall-safe 区间，min<max 且在 G6 默认 [0.01,10] 之内。
 *  3. clampWallZoom 把越界值夹紧到 [min,max]。
 *  4. zoom-in 倍率 >1、zoom-out 倍率 <1。
 *  5. 源码级：HUD 给 `<FlowGraph>` 接了 plugins / zoomRange / ref，且渲染了外部控件。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_WALL_MAX_ZOOM,
  BLUEPRINT_WALL_MINIMAP_PLUGIN,
  BLUEPRINT_WALL_MIN_ZOOM,
  BLUEPRINT_WALL_PLUGINS,
  BLUEPRINT_WALL_ZOOM_IN_RATIO,
  BLUEPRINT_WALL_ZOOM_OUT_RATIO,
  BLUEPRINT_WALL_ZOOM_RANGE,
  clampWallZoom,
} from "../blueprint-wall-flow-graph-map";

// ─── Pure config assertions ──────────────────────────────────────────────────

describe("blueprint wall minimap plugin config (Req 2.3 / 7.4)", () => {
  it("enables a G6 built-in minimap plugin", () => {
    expect(BLUEPRINT_WALL_MINIMAP_PLUGIN.type).toBe("minimap");
    // 插件被纳入透传给 <FlowGraph plugins={...}> 的数组。
    expect(BLUEPRINT_WALL_PLUGINS).toContain(BLUEPRINT_WALL_MINIMAP_PLUGIN);
  });

  it("places the minimap in the lower-right corner (right-bottom)", () => {
    expect(BLUEPRINT_WALL_MINIMAP_PLUGIN.position).toBe("right-bottom");
  });

  it("gives the minimap a stable key and a bounded size", () => {
    expect(BLUEPRINT_WALL_MINIMAP_PLUGIN.key).toBe("blueprint-wall-minimap");
    expect(BLUEPRINT_WALL_MINIMAP_PLUGIN.size).toEqual([220, 140]);
  });
});

describe("blueprint wall constrained zoom config (Req 9.1 / 9.7)", () => {
  it("constrains zoomRange to a wall-safe band within G6 defaults [0.01, 10]", () => {
    const [min, max] = BLUEPRINT_WALL_ZOOM_RANGE;
    expect(min).toBe(BLUEPRINT_WALL_MIN_ZOOM);
    expect(max).toBe(BLUEPRINT_WALL_MAX_ZOOM);
    expect(min).toBeLessThan(max);
    // Tighter than G6's permissive default.
    expect(min).toBeGreaterThan(0.01);
    expect(max).toBeLessThan(10);
  });

  it("clampWallZoom clamps out-of-range zoom values to [min, max]", () => {
    expect(clampWallZoom(0.001)).toBe(BLUEPRINT_WALL_MIN_ZOOM);
    expect(clampWallZoom(999)).toBe(BLUEPRINT_WALL_MAX_ZOOM);
    // In-range values pass through unchanged.
    const mid = (BLUEPRINT_WALL_MIN_ZOOM + BLUEPRINT_WALL_MAX_ZOOM) / 2;
    expect(clampWallZoom(mid)).toBe(mid);
  });

  it("zoom-in ratio is >1 and zoom-out ratio is <1", () => {
    expect(BLUEPRINT_WALL_ZOOM_IN_RATIO).toBeGreaterThan(1);
    expect(BLUEPRINT_WALL_ZOOM_OUT_RATIO).toBeLessThan(1);
  });
});

// ─── Source-level wiring guard for the HUD host ──────────────────────────────

describe("BlueprintWallProcessGraphHud wires minimap + controls (source guards)", () => {
  const moduleSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../BlueprintWallProcessGraphHud.tsx"
    ),
    "utf8"
  );

  it("passes the minimap plugins and constrained zoomRange into <FlowGraph>", () => {
    expect(moduleSource).toContain("plugins={BLUEPRINT_WALL_PLUGINS}");
    expect(moduleSource).toContain("zoomRange={BLUEPRINT_WALL_ZOOM_RANGE}");
  });

  it("captures the G6 graph instance via a forwarded ref for imperative fit/zoom", () => {
    expect(moduleSource).toContain("ref={graphRef}");
    // 命令式 fit/zoom：组件经 ref 调 G6 API。
    expect(moduleSource).toContain("fitView");
    expect(moduleSource).toContain("zoomTo");
  });

  it("renders the external fit/zoom controls overlay", () => {
    expect(moduleSource).toContain("BlueprintWallGraphControls");
    expect(moduleSource).toContain("onFitView=");
    expect(moduleSource).toContain("onZoomOut=");
    expect(moduleSource).toContain("onZoomIn=");
  });

  it("does not re-enable in-canvas pan/zoom behaviors (Task 1.4 spike lock)", () => {
    // 画布内手势仍被显式禁用（空 behaviors）；fit/zoom 走外部按钮。
    expect(moduleSource).toContain("behaviors={[]}");
  });
});
