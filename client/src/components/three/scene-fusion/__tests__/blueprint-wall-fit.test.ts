/**
 * blueprint-wall-process-graph-hud-2026-05-31 Task 6.4 —
 * 桌面 / 移动**适配检查**与「与旧 monitor 路径无明显重叠」的纯常量 + 源码级护栏测试。
 *
 * 与 Task 6.1 的 `blueprint-wall-placement.test.ts` 互补、不重复：
 *  - Task 6.1 锁定常量的**精确取值**（position/size/distanceFactor/panelZ）与基本的
 *    后墙摆放、比 monitor 更大、HUD 消费常量等护栏；
 *  - 本文件（Task 6.4）聚焦**适配 / 不重叠**这一层可在源码 / 常量级别检验的不变量：
 *      1. 常量是**确定性、有限**的字面量（Req 8.7 稳定性的前提，无 NaN / 非派生 / 不漂移）；
 *      2. 桌面适配中**可在常量级核对**的几何不变量：水平居中落在后墙水平范围内、竖直
 *         中心落在后墙高度带内、贴后墙面安装（z 接近后墙几何、面板朝观察者侧轻推）；
 *      3. 「与旧 monitor 路径无明显重叠」：蓝图墙面与 mission-first monitor 的**竖直位置
 *         不同**（蓝图更高）、**尺寸不同**，且二者由 `Scene3D` mode switch **互斥渲染**
 *         （永不同帧，复核 Req 8.5 / 1.1 / 1.2）；
 *      4. Req 8.7 **稳定尺寸 / 无布局抖动**：HUD 用**同一组固定常量**同时给 `<Html>` 墙面
 *         与 `<FlowGraph>` 画布定尺寸，尺寸不随图数据 / 视口变化（避免数据变化时墙面跳动）；
 *      5. 作用域护栏（Req 3.7 / 4.4 / 4.5）：常量级适配检查路径**不**牵入 mission-first 状态
 *         （placement 纯模块不 import `useSandboxStore` / `SandboxMonitor` /
 *         `MissionWallTaskPanel`）；本测试文件自身也只 import 纯常量 + 做 `node:fs` 源码读取。
 *
 * ── 明确**推迟到 Task 7.3 浏览器 QA** 的检查（不在此伪造通过） ─────────────────
 *
 * 以下属于「需要真实浏览器 / 相机取景」的检查，**无法**在 node 环境下如实验证，按任务
 * 约定推迟到 Task 7.3 Playwright 视觉 QA，本文件**不**对其做假断言：
 *  - Req 8.3 桌面端墙面**精确不裁切**（drei `<Html transform>` 的 px↔world 换算受
 *    `distanceFactor` 与经验系数影响，1680×760 起始值是否真的落在 15.42×3 后墙内、是否
 *    需要按可读性微调，由浏览器 QA 定稿，见 design「### 3D Wall Placement」）；
 *  - Req 8.4 默认相机下的**可读性**；
 *  - Req 8.5 与角色 / 桌面 / 地面 UI 的**实际像素级不重叠**（运行期由互斥渲染 + 后墙位置
 *    保证，最终以浏览器 QA 复核）；
 *  - Req 8.6 窄屏 / 移动端**实际回退表现**（相机分级 FOV 取景 + 墙面等比缩放的真实效果）。
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

// ── 仅作 review / 断言比对的本地参照常量（刻意不 import 重型 mission-first 组件，
//    遵守作用域护栏：蓝图墙面适配检查不引用 mission-first 墙面设备）。 ──────────────

// mission-first `SandboxMonitor`（client/src/components/three/SandboxMonitor.tsx）：
//   WALL_MONITOR_POSITION = [0, 1.5, -4.88]，DEVICE_WIDTH/HEIGHT = 1416 × 243。
const MONITOR_POSITION_Y = 1.5;
const MONITOR_POSITION_Z = -4.88;
const MONITOR_WIDTH = 1416;
const MONITOR_HEIGHT = 243;

// 办公室后墙（client/src/components/three/OfficeRoom.tsx `Walls()`）：
//   mesh position [0, 1.5, -4.9]，boxGeometry args [15.42, 3, 0.18]
//   → 宽 15.42m（中心 x=0 → x ∈ [-7.71, 7.71]）、高 3m（中心 y=1.5 → y ∈ [0, 3]）、
//     中心 z=-4.9、厚 0.18m。
const BACK_WALL_CENTER_Z = -4.9;
const BACK_WALL_WIDTH = 17.4;
const BACK_WALL_HEIGHT = 8.2;
const BACK_WALL_CENTER_Y = 4.1;
const BACK_WALL_HALF_WIDTH = BACK_WALL_WIDTH / 2;
const BACK_WALL_TOP_Y = BACK_WALL_CENTER_Y + BACK_WALL_HEIGHT / 2;
const BACK_WALL_BOTTOM_Y = BACK_WALL_CENTER_Y - BACK_WALL_HEIGHT / 2; // 0

const here = dirname(fileURLToPath(import.meta.url));
const hudSource = readFileSync(
  resolve(here, "../BlueprintWallProcessGraphHud.tsx"),
  "utf8"
);
const scene3dSource = readFileSync(
  resolve(here, "../../../Scene3D.tsx"),
  "utf8"
);
const placementSource = readFileSync(
  resolve(here, "../blueprint-wall-placement.ts"),
  "utf8"
);
const officeRoomSource = readFileSync(
  resolve(here, "../../OfficeRoom.tsx"),
  "utf8"
);
// placement 模块的 JSDoc **刻意**以注释记录 mission-first monitor 的对照值（含
// `SandboxMonitor` / `MissionWallTaskPanel` 文字）供 review 比对。作用域护栏针对的是
// **代码层依赖**（import / 引用），而非注释文字，故剥离行 / 块注释后再断言（沿用
// scene3d-mode-switch.test.ts 的做法），既保留强保证又不被对照文档误伤。
const placementCodeWithoutComments = placementSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("blueprint wall constants are deterministic & finite (Task 6.4, Req 8.7 stability)", () => {
  it("exposes a finite [x, y, z] world position tuple (no NaN / non-derived drift)", () => {
    expect(Array.isArray(BLUEPRINT_WALL_GRAPH_POSITION)).toBe(true);
    expect(BLUEPRINT_WALL_GRAPH_POSITION).toHaveLength(3);
    for (const component of BLUEPRINT_WALL_GRAPH_POSITION) {
      expect(typeof component).toBe("number");
      expect(Number.isFinite(component)).toBe(true);
    }
  });

  it("exposes finite, positive size / factor constants", () => {
    for (const value of [
      BLUEPRINT_WALL_GRAPH_WIDTH,
      BLUEPRINT_WALL_GRAPH_HEIGHT,
      BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR,
      BLUEPRINT_WALL_GRAPH_PANEL_Z,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("is a vertical large canvas (height > width-proportional strip; taller than it is a thin bar)", () => {
    // 竖向大画布的稳定形状特征：高度远超 monitor 横条高度，宽度有界（不会无限拉伸）。
    expect(BLUEPRINT_WALL_GRAPH_HEIGHT).toBeGreaterThan(MONITOR_HEIGHT * 3);
    // 形状稳定（非退化）：宽高比落在合理区间，避免「狭长一条」或「极端竖条」。
    const aspect = BLUEPRINT_WALL_GRAPH_WIDTH / BLUEPRINT_WALL_GRAPH_HEIGHT;
    expect(aspect).toBeGreaterThan(1); // 宽 > 高（横向铺开）
    expect(aspect).toBeLessThan(4); // 不退化为狭长横条
  });
});

describe("blueprint wall desktop geometric fit (Task 6.4, Req 8.3 constant-level part)", () => {
  it("is horizontally centered within the back-wall bounds (symmetric margins)", () => {
    const [x] = BLUEPRINT_WALL_GRAPH_POSITION;
    // x=0 → 后墙水平居中，左右留白对称；且严格落在后墙水平范围内。
    expect(x).toBe(0);
    expect(Math.abs(x)).toBeLessThan(BACK_WALL_HALF_WIDTH);
  });

  it("centers vertically inside the back-wall height band, in the upper bulletin area", () => {
    const [, y] = BLUEPRINT_WALL_GRAPH_POSITION;
    // 竖直中心落在后墙高度带 [0, 3] 内（可在常量级核对的桌面适配前提）。
    expect(y).toBeGreaterThan(BACK_WALL_BOTTOM_Y);
    expect(y).toBeLessThan(BACK_WALL_TOP_Y);
    // 位于公告板区域（高于后墙竖直中心 1.5），与抬高摆放一致。
    expect(y).toBeGreaterThan(3);
  });

  it("uses a taller real back wall in blueprint mode, not a floating graph over the old 3m wall", () => {
    expect(officeRoomSource).toContain("const wallHeight = tallBackWall ? 8.2 : 3");
    expect(officeRoomSource).toContain("const wallCenterY = tallBackWall ? 4.1 : 1.5");
    expect(officeRoomSource).toContain("const wallWidth = tallBackWall ? 17.4 : 15.42");
    expect(officeRoomSource).toContain("<Walls tallBackWall={useTallBlueprintWall} />");
    expect(officeRoomSource).toContain('const useTallBlueprintWall = mode === "blueprint"');
    expect(officeRoomSource).toContain("showMissionCorkBoard ? <CorkBoard /> : null");
  });

  it("is mounted on the back-wall plane and nudged toward the viewer (no float mid-room)", () => {
    const [, , z] = BLUEPRINT_WALL_GRAPH_POSITION;
    // group z 紧贴后墙几何中心（-4.9）附近，确认是「装在后墙」而非悬浮房间中央。
    expect(Math.abs(z - BACK_WALL_CENTER_Z)).toBeLessThanOrEqual(0.1);
    // 面板 z 偏移把 `<Html>` 面朝观察者侧（+z）轻推，避免与后墙几何 z-fighting。
    expect(BLUEPRINT_WALL_GRAPH_PANEL_Z).toBeGreaterThan(0);
    // 面板世界 z 仍在房间后侧（z < 0），即落在后墙这一侧。
    expect(z + BLUEPRINT_WALL_GRAPH_PANEL_Z).toBeLessThan(0);
  });
});

describe("no obvious overlap with the old mission-first monitor path (Task 6.4, Req 8.5)", () => {
  it("sits at a distinct (higher) vertical center than the monitor strip", () => {
    const [, y] = BLUEPRINT_WALL_GRAPH_POSITION;
    // 蓝图墙面抬高到公告板区，明显高于 monitor 的 1.5 横条位 → 竖直位不重合。
    expect(y).toBeGreaterThan(MONITOR_POSITION_Y);
  });

  it("uses distinct dimensions from the monitor (not a re-skinned 1416x243 strip)", () => {
    expect(BLUEPRINT_WALL_GRAPH_WIDTH).not.toBe(MONITOR_WIDTH);
    expect(BLUEPRINT_WALL_GRAPH_HEIGHT).not.toBe(MONITOR_HEIGHT);
    // 同为后墙设备但实质不同墙面平面值（仅微偏移共面），形状语义独立。
    const [, , z] = BLUEPRINT_WALL_GRAPH_POSITION;
    expect(z).not.toBe(MONITOR_POSITION_Z);
  });

  it("renders mutually exclusive with SandboxMonitor via the Scene3D mode switch (never co-mounted)", () => {
    // 复核「与旧 monitor 路径无重叠」的运行期根因：二者由 mode switch 互斥渲染。
    // 与 scene3d-mode-switch.test.ts 互补（此处从 Req 8.5「不与旧路径重叠」角度断言）。
    expect(scene3dSource.includes('mode === "blueprint"')).toBe(true);
    expect(scene3dSource.includes("BlueprintWallProcessGraphHud")).toBe(true);
    // 全文件仅一处 `<SandboxMonitor` JSX（位于 mission-first 分支），蓝图分支不复挂。
    expect((scene3dSource.match(/<SandboxMonitor/g) || []).length).toBe(1);
  });
});

describe("blueprint wall stable dimensions / no layout jumps (Task 6.4, Req 8.7)", () => {
  it("sizes both the <Html> surface and the <FlowGraph> canvas from the same fixed constants", () => {
    // `<Html style>` 用常量定墙面尺寸。
    expect(hudSource).toMatch(/width:\s*BLUEPRINT_WALL_GRAPH_WIDTH/);
    expect(hudSource).toMatch(/height:\s*BLUEPRINT_WALL_GRAPH_HEIGHT/);
    // `<FlowGraph>` 画布用**同一组**常量定尺寸（与墙面一致）。
    expect(hudSource).toMatch(/width=\{BLUEPRINT_WALL_GRAPH_WIDTH\}/);
    expect(hudSource).toMatch(/height=\{BLUEPRINT_WALL_GRAPH_HEIGHT\}/);
    // 宽 / 高常量各被引用 ≥ 2 次（墙面 + 画布共用），即尺寸不随图数据派生。
    expect(
      (hudSource.match(/BLUEPRINT_WALL_GRAPH_WIDTH/g) || []).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      (hudSource.match(/BLUEPRINT_WALL_GRAPH_HEIGHT/g) || []).length
    ).toBeGreaterThanOrEqual(2);
  });

  it("does not derive wall dimensions from the live viewport (stable across breakpoints)", () => {
    // 墙面尺寸是固定常量，不按 innerWidth / matchMedia 重算 → 数据 / 断点变化不引发墙面
    // 布局抖动；窄屏回退由相机分级 FOV + 等比缩放承接（真实效果由 Task 7.3 浏览器 QA 复核）。
    expect(hudSource.includes("innerWidth")).toBe(false);
    expect(hudSource.includes("matchMedia")).toBe(false);
  });
});

describe("constant-level fit path stays scope-safe (Task 6.4, Req 3.7 / 4.4 / 4.5)", () => {
  it("the placement module pulls in no mission-first sandbox/monitor state", () => {
    // 适配检查直接 import 的 placement 纯模块**代码层**不得牵入 mission-first 状态 /
    // 墙面设备（注释里的对照文字已剥离，见 placementCodeWithoutComments）。
    expect(placementCodeWithoutComments.includes("useSandboxStore")).toBe(false);
    expect(placementCodeWithoutComments.includes("SandboxMonitor")).toBe(false);
    expect(placementCodeWithoutComments.includes("MissionWallTaskPanel")).toBe(
      false
    );
  });
});
