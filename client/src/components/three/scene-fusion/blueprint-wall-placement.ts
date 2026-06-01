/**
 * 蓝图墙面流程图 — 3D 后墙摆放 / 尺寸常量（Task 6.1，design「### 3D Wall Placement」）。
 *
 * 本模块把 `BlueprintWallProcessGraphHud` 的墙面摆放参数正式化为一组**纯数据常量**
 * （无 React / 无 three / 无 `@ant-design/graphs` 运行时 import）。
 *
 * ── 取值依据（Req 8.1 / 8.2 / 8.3 / 8.7） ────────────────────────────────────
 *
 * 关键前提：blueprint 模式下 `OfficeRoom` 用的是 `tallBackWall`，后墙几何为
 *   `<mesh position={[0, 4.1, -4.9]}> <boxGeometry args={[17.4, 8.2, 0.18]}>`
 * → 墙带 `x ∈ [-8.7, 8.7]`、`y ∈ [0, 8.2]`、墙厚 0.18m，**前墙面 z = -4.81**
 *   （`-4.9 + 0.09`）。
 *
 * 用户视觉 QA 反馈（2026-05-31，三轮）：
 *  · 第一轮：原始 `[0, 2.05, -4.87]` 是按短墙算的，HUD 下沿穿到地板下；
 *  · 第二轮：把 y 抬到 4.1、z 推到 -4.79 后，HUD 与墙面有 0.04m 厚的暗色背板 + 外框，
 *    HUD 反而像「飘在房间里的大屏幕」；
 *  · 第三轮：要求**与墙面完美贴合**，不要凸出墙面的 3D 设备外观，要像直接嵌在墙上
 *    （类似海报 / 嵌入式显示屏）。
 *
 * 本轮（贴墙稿）：
 *  ```ts
 *  BLUEPRINT_WALL_GRAPH_POSITION       = [0, 4.1, -4.808]
 *  BLUEPRINT_WALL_GRAPH_WIDTH          = 1280  // 1680 → 1280：留出墙体 margin
 *  BLUEPRINT_WALL_GRAPH_HEIGHT         = 580   // 760 → 580：留出墙体 margin
 *  BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR = 4.0
 *  BLUEPRINT_WALL_GRAPH_PANEL_Z        = 0.005
 *  BACKING / FRAME 颜色 + 厚度变扁，且与墙面齐平（不再凸出）
 *  ```
 *
 * - **x = 0**：后墙水平居中。HUD 世界宽度 `1280 / 4 / 25.3 ≈ 12.65m`，x ∈ [-6.32, 6.32]；
 *   高墙 x ∈ [-8.7, 8.7]，HUD 两侧各留约 2.38m 墙体可见，给眼睛「贴在墙上」的空间参考。
 * - **y = 4.1**：与高墙竖直中心 `wallCenterY` 对齐。HUD 世界高度
 *   `580 / 4 / 25.3 ≈ 5.73m`，y ∈ [1.235, 6.965]；上下各留约 1.235m 墙体可见。
 * - **z = -4.808**：紧贴高墙前墙面（-4.81）外侧 0.002m，几乎齐平。
 *   `BACKING_DEPTH` 同步缩到 0.004m → 背板局部 z ∈ [-0.002, +0.002] → 世界 z ∈
 *   [-4.81, -4.806]，背面与墙面齐平，正面只凸出 0.004m，视觉上近似贴墙。
 *   `panelZ = 0.005` → DOM 在背板正面外 0.003m，避免 z-fighting，呈嵌入式显示屏。
 * - 不再使用单独的「外框」mesh：原版本叠了一层比背板大 0.2m 的暗色外框 → 视觉上反而
 *   像「墙上挂着一个独立设备」。本轮直接由背板自身充当墙板边沿，靠 DOM 内描边给「屏幕
 *   边」感。
 * - `distanceFactor = 4.0` 与 mission-first monitor 一致，沿用同一套像素 ↔ world 换算。
 *
 * ── 与 mission-first monitor 的关系（NFR-1 / Req 1.6） ───────────────────────
 *
 * 蓝图墙面与 mission-first `SandboxMonitor` 由 `Scene3D` 的 mode switch **互斥**渲染，
 * 二者**永不同时**出现在同一帧，因此不存在运行期视觉重叠 / 抢位。本模块**刻意不**
 * 复制或引用 monitor 的 `DEVICE_*` 常量：mission-first monitor 尺寸保持不变。
 *
 * 这里仅以注释**记录** monitor 的对照值供 review 比对，不在代码层建立依赖：
 *   mission-first monitor：position [0, 1.5, -4.88]，1416 × 243，distanceFactor 4.0。
 */

/**
 * 墙面 group 的世界坐标位置 `[x, y, z]`。
 *
 * - x = 0：后墙水平居中。
 * - y = 4.1：与 blueprint 高墙竖直中心对齐（高墙 y∈[0, 8.2]，中心 y=4.1）。
 * - z = -4.808：紧贴高墙前墙面（-4.81）外侧 0.002m，HUD 与墙面齐平贴合。
 */
export const BLUEPRINT_WALL_GRAPH_POSITION: [number, number, number] = [
  0, 4.1, -4.808,
];

/**
 * drei `<Html transform>` 的 `distanceFactor`，与 mission-first monitor 一致（4.0）。
 */
export const BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR = 4.0;

/**
 * 墙面图 DOM 画布宽度（px）。
 *
 * 1280 → 世界宽度 ≈ 12.65m，落在高墙 17.4m 内，两侧各留 ~2.38m 墙体。
 */
export const BLUEPRINT_WALL_GRAPH_WIDTH = 1280;

/**
 * 墙面图 DOM 画布高度（px）。
 *
 * 580 → 世界高度 ≈ 5.73m，落在高墙 8.2m 内，上下各留 ~1.235m 墙体。
 */
export const BLUEPRINT_WALL_GRAPH_HEIGHT = 580;

/**
 * `<Html>` 面相对 group 的 z 偏移（米）。
 *
 * 必须 > `BACKING_Z + BACKING_DEPTH / 2`，即在背板正面之前，否则 HTML 会几何嵌进背板。
 * 当前 `BACKING_Z = 0` / `BACKING_DEPTH = 0.004`：背板局部 z ∈ [-0.002, 0.002]。
 * `panelZ = 0.005` → HTML 局部 z = 0.005 → 在背板正面外 0.003m。
 *
 * group 在世界 z = -4.808 → HTML 世界 z = -4.803，距高墙前墙面 -4.81 共 0.007m，
 * 视觉上几乎齐平，呈「嵌入式墙挂显示屏」（而不是凸出墙面的独立设备）。
 */
export const BLUEPRINT_WALL_GRAPH_PANEL_Z = 0.005;

/**
 * 3D 墙板背板（backing mesh）中心 z（米，相对 group）。
 *
 * 设为 0 → 背板局部 z ∈ [-0.002, 0.002]：
 *  - 背面 z = -0.002 → 世界 z = -4.81，正好与高墙前墙面齐平（背板贴墙）。
 *  - 正面 z = +0.002 → 世界 z = -4.806，仅凸出墙面 0.004m，肉眼几乎看不出。
 *
 * 背板是 3D 网格（参与 WebGL 深度测试），给 drei `<Html transform>` 的 DOM 面板提供
 * 真正的「墙挂显示器外壳」语义；没有它，DOM 总在所有 3D 物体之前渲染，HUD 会被读成
 * 飘在房间里的薄片。
 */
export const BLUEPRINT_WALL_GRAPH_BACKING_Z = 0;

/**
 * 3D 背板宽度（米）。
 *
 * HUD 世界宽度 `1280 / 4 / 25.3 ≈ 12.65m`；背板比 HUD 多 0.2m / 边缘留出 0.1m 细边沿。
 */
export const BLUEPRINT_WALL_GRAPH_BACKING_WIDTH = 12.85;

/**
 * 3D 背板高度（米）。
 *
 * HUD 世界高度 `580 / 4 / 25.3 ≈ 5.73m`；背板比 HUD 多 0.2m / 边缘留出 0.1m 细边沿。
 */
export const BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT = 5.93;

/**
 * 3D 背板厚度（米）。
 *
 * 0.004m → 极薄板，只为参与 WebGL 深度测试给 HTML 当「显示屏面板」语义，
 * 视觉上几乎贴墙不凸出。
 */
export const BLUEPRINT_WALL_GRAPH_BACKING_DEPTH = 0.004;

/**
 * 背板色（HEX）。
 *
 * 取与项目「冷灰色板」一致的中性 slate 色（深一点点），让背板自身充当 HUD 屏幕边沿，
 * 不再叠暗色外框。这避免了「装在墙上的独立设备」观感，转而像「直接嵌在墙上的屏幕」。
 */
export const BLUEPRINT_WALL_GRAPH_BACKING_COLOR = "#cbd5e1";

/**
 * @deprecated Frame mesh removed — backing alone now serves as the screen bezel.
 * 保留导出仅为不破坏既有 import；HUD 不再渲染单独外框 mesh。
 */
export const BLUEPRINT_WALL_GRAPH_FRAME_COLOR = "#94a3b8";
