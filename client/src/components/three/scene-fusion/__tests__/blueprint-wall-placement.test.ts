/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 6.1 —
 * 墙面摆放 / 尺寸常量的**纯常量 + 源码级**护栏测试。
 *
 * 为什么是常量 / 源码级而不是活图渲染：墙面 HUD 静态依赖重型 `<FlowGraph>`（需真实
 * canvas，node 测试环境无法完整渲染），因此沿用同目录数据 spec / HUD / minimap 护栏的
 * 做法（`blueprint-wall-process-data.test.ts` /
 * `blueprint-wall-minimap-controls-config.test.ts`）：
 *  - 直接断言纯常量取值（墙面 position / size / distanceFactor / panelZ）已正式化且稳定；
 *  - 对宿主组件 `BlueprintWallProcessGraphHud.tsx` 源码断言它确实从
 *    `blueprint-wall-placement` 消费这些常量（不再使用本地内联常量）。
 *
 * 覆盖（Req 8.1 / 8.2 / 8.3 / 8.7）：
 *  1. 常量取值锁定在 design「### 3D Wall Placement」起始目标值（稳定，不在两次渲染间漂移）。
 *  2. 墙面贴**后墙**且水平居中（x=0、z<0）。
 *  3. 墙面**显著大于 / 高于** mission-first monitor 的 1416 × 243 横条（Req 8.1）。
 *  4. distanceFactor 与 monitor 一致（4.0），沿用同一像素 ↔ world 换算口径。
 *  5. 源码级：HUD 从 `./blueprint-wall-placement` import 这些常量，且不再内联定义。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR,
  BLUEPRINT_WALL_GRAPH_HEIGHT,
  BLUEPRINT_WALL_GRAPH_PANEL_Z,
  BLUEPRINT_WALL_GRAPH_POSITION,
  BLUEPRINT_WALL_GRAPH_WIDTH,
} from "../blueprint-wall-placement";

// mission-first `SandboxMonitor` 的对照值（仅作 review 比对，刻意不 import 该重型组件，
// 以遵守作用域护栏：blueprint 墙面不引用 mission-first 墙面设备）。
const MISSION_FIRST_MONITOR_WIDTH = 1416;
const MISSION_FIRST_MONITOR_HEIGHT = 243;
const MISSION_FIRST_MONITOR_DISTANCE_FACTOR = 4.0;

describe("blueprint wall placement constants (Task 6.1, Req 8.1-8.7)", () => {
  it("locks the formalized design target values (stable, no drift)", () => {
    // 当前正式值（演进史见 blueprint-wall-placement.ts 模块文档：
    // 位置对齐高墙竖直中心 y=4.1；画布 3x 分辨率 5280×2490 追求清晰；
    // panelZ=0.1 保证 HTML 面在背板正面之外）。守卫目的不变：值一旦再调，
    // 必须连同此处一起显式 re-lock，不允许静默漂移。
    expect(BLUEPRINT_WALL_GRAPH_POSITION).toEqual([0, 4.1, -4.81]);
    expect(BLUEPRINT_WALL_GRAPH_WIDTH).toBe(5280);
    expect(BLUEPRINT_WALL_GRAPH_HEIGHT).toBe(2490);
    expect(BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR).toBe(4.0);
    expect(BLUEPRINT_WALL_GRAPH_PANEL_Z).toBe(0.1);
  });

  it("places the wall on the back wall, horizontally centered (Req 8.2)", () => {
    const [x, y, z] = BLUEPRINT_WALL_GRAPH_POSITION;
    // x 居中。
    expect(x).toBe(0);
    // 抬高到后墙公告板区域（高于 monitor 的 1.5）。
    expect(y).toBeGreaterThan(1.5);
    // z<0 即贴后墙；与高墙前墙面 -4.81 齐平贴合（见 placement 模块文档）。
    expect(z).toBeLessThan(0);
    expect(Math.abs(z - -4.81)).toBeLessThanOrEqual(0.05);
  });

  it("is substantially taller/larger than the mission-first monitor strip (Req 8.1)", () => {
    // 蓝图墙面是竖向大画布，远高于 monitor 的 243 横条。
    expect(BLUEPRINT_WALL_GRAPH_HEIGHT).toBeGreaterThan(
      MISSION_FIRST_MONITOR_HEIGHT
    );
    expect(BLUEPRINT_WALL_GRAPH_HEIGHT).toBeGreaterThan(
      MISSION_FIRST_MONITOR_HEIGHT * 3
    );
    // 宽度也更大。
    expect(BLUEPRINT_WALL_GRAPH_WIDTH).toBeGreaterThan(
      MISSION_FIRST_MONITOR_WIDTH
    );
  });

  it("keeps distanceFactor aligned with the monitor's px<->world convention", () => {
    expect(BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR).toBe(
      MISSION_FIRST_MONITOR_DISTANCE_FACTOR
    );
  });
});

describe("BlueprintWallProcessGraphHud consumes the placement module (source guard)", () => {
  const moduleSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../BlueprintWallProcessGraphHud.tsx"
    ),
    "utf8"
  );

  it("imports placement constants from ./blueprint-wall-placement", () => {
    expect(
      /from\s+["']\.\/blueprint-wall-placement["']/.test(moduleSource)
    ).toBe(true);
    expect(moduleSource).toContain("BLUEPRINT_WALL_GRAPH_POSITION");
    expect(moduleSource).toContain("BLUEPRINT_WALL_GRAPH_WIDTH");
    expect(moduleSource).toContain("BLUEPRINT_WALL_GRAPH_HEIGHT");
    expect(moduleSource).toContain("BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR");
    expect(moduleSource).toContain("BLUEPRINT_WALL_GRAPH_PANEL_Z");
  });

  it("no longer defines the placement constants inline as local consts", () => {
    // 正式化后这些常量来自独立模块，宿主组件里不应再有 `const BLUEPRINT_WALL_GRAPH_* =`。
    expect(
      /const\s+BLUEPRINT_WALL_GRAPH_POSITION\s*[:=]/.test(moduleSource)
    ).toBe(false);
    expect(/const\s+BLUEPRINT_WALL_GRAPH_WIDTH\s*=/.test(moduleSource)).toBe(
      false
    );
    expect(/const\s+BLUEPRINT_WALL_GRAPH_HEIGHT\s*=/.test(moduleSource)).toBe(
      false
    );
  });

  it("uses 3D depth occlusion so foreground roles can occlude the wall graph", () => {
    // occlude（布尔形态，深度遮挡）：blending 模式后来因贴合背板的 z-fighting
    // 问题改回布尔 occlude（见 HUD 源码注释）——守卫要求深度遮挡仍然开启。
    expect(/\n\s+occlude\b/.test(moduleSource)).toBe(true);
    expect(moduleSource).not.toContain("0 22px 46px rgba");
  });
});
