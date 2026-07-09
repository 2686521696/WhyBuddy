/**
 * 蓝图墙面流程图 — Wall_Process_Data → Ant Design Graphs `FlowGraph` 映射纯函数。
 *
 * 把 `deriveBlueprintWallProcessData(...)` 的输出（`BlueprintWallProcessData`）映射为
 * FlowGraph / G6 v5 可直接消费的 graph-ready 数据（`{ data: { nodes, edges }, layout }`），
 * 供 `BlueprintWallProcessGraphHud`（Task 6.2）渲染。
 *
 * 设计要点（对应 design.md「### Column Remap」「### `mapWallDataToFlowGraph(data)`」
 * 「### Deterministic Layout vs FlowGraph Default Dagre」）：
 *  - **纯函数 / React-free**：本模块不 import 任何 `@ant-design/graphs` /
 *    `@antv/g6` 运行时值，只 `import type` G6 的数据类型（编译期擦除，零运行时依赖），
 *    因此可在不挂载 FlowGraph 的情况下被单元测试（Task 3.3）。
 *  - **列重映射（Column Remap）**：deriver 输出混用两套列方案——阶段主干用
 *    `column = stageIndex`（0..8），分支节点用类目列（user_goal=0 / route=1 / spec=2 /
 *    reasoning·capability=3 / preview·artifact·final=4）。直接 `x = column * 330` 会把
 *    分支节点画到错误的阶段道下。映射器先用确定性查找表把每个节点解析到唯一的
 *    `visualStageLane`（一个 0..8 的 stageIndex），再据此算 `x`。重映射**只**改写 x 方向，
 *    `node.row` 原样保留并驱动 `y`。
 *  - **确定性像素布局**：`x = visualStageLane * LANE_X + OFFSET_X`、
 *    `y = effectiveRow * ROW_Y + OFFSET_Y`，相同输入恒产出相同坐标（NFR：不让节点在
 *    两次渲染之间跳动）。其中 `effectiveRow` 是 per-lane 行去冲突（见
 *    `mapWallDataToFlowGraph` 步骤 1b）后的行号：deriver 刻意把「精确不重叠」留给可视层，
 *    因此映射器在同一 `visualStageLane` 内按 deriver 数组顺序确定性地为每个节点占行，
 *    首选原始 `row`、被占则顺延到下一个空闲整数行，保证不会有两个节点落在同一
 *    `(visualStageLane, effectiveRow)` → 同一 (x, y)。
 *  - **禁用 dagre 自动布局（Req 2.8）**：FlowGraph 默认 `layout: { type: "dagre" }`，
 *    会无视节点自带的 `style.x/style.y` 重排所有节点，破坏阶段道对齐。本映射器导出
 *    `BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT = []`（空布局流水线）。G6 v5 的
 *    `LayoutController.postLayout` 对空数组管线直接跳过（for 循环不执行），因此节点保留
 *    我们写入的固定 `style.x/style.y`。这一手段**无需**下沉到底层 `@antv/g6` Graph API
 *    （Req 2.9 的 fallback 未触发），FlowGraph 即可承载固定坐标。
 *
 * 边映射（Task 3.2 增强）：每条 deriver 边除了透传 id/source/target + kind/priority/label
 * 进 `data` 外，还产出 G6 v5 可直接消费的曲线虚线样式——`type: "cubic-horizontal"`
 * （墙面阶段道左→右流动，用水平三阶贝塞尔曲线）、`style.lineDash` 默认虚线、
 * `style.stroke` 按 `kind` 取色（`EDGE_KIND_COLOR`，覆盖全部 7 种 kind）、
 * `style.lineWidth`/`style.opacity` 按 `priority` 强调（`EDGE_PRIORITY_STYLE`），
 * 并在 `edge.label` 存在时写入 `style.labelText`。映射器只映射 deriver 真实产出的边，
 * 绝不臆造新边（Req 6.6/6.7 由 deriver 负责，省略不确定关系）。
 *
 * 类型说明：本模块**不**直接 import `@antv/g6` 的类型。`@antv/g6` 是
 * `@ant-design/graphs` 的传递依赖，无法从工作区 tsconfig 直接解析；而
 * `@ant-design/graphs` 仅以**运行时命名空间值**（`export { G6 }`）暴露 G6，type-only
 * 引用会拉入运行时。为保持本模块纯净 / 轻量（Task 要求可选择自定义最小接口），这里
 * 定义与 G6 v5 **字段名完全一致**的最小结构接口：固定坐标用 `style.x` / `style.y`，
 * 自定义负载用 `data`（已对照安装的 `@antv/g6@5.1.1` 类型确认，见
 * `lib/spec/data.d.ts` 的 `GraphData` 示例 `{ id, style: { x, y } }` 与
 * `NodeData.data: Record<string, unknown>`）。这些接口结构上兼容 G6 `NodeData` /
 * `EdgeData` / `GraphData`，组件（Task 6.2）可直接透传给 `<FlowGraph>`。
 */

import {
  BLUEPRINT_SCENE_STAGES,
  type BlueprintSceneStageKey,
} from "./blueprint-stage-signal";
import type {
  BlueprintWallGraphEdge,
  BlueprintWallGraphEdgeKind,
  BlueprintWallGraphNode,
  BlueprintWallGraphNodeStatus,
  BlueprintWallGraphNodeType,
  BlueprintWallProcessData,
} from "./blueprint-wall-process-data";

// ─── Deterministic pixel-layout constants ────────────────────────────────────
//
// 来自 design「Initial pixel layout after remap」：
//   x = visualStageLane * LANE_X + OFFSET_X
//   y = row * ROW_Y + OFFSET_Y
// LANE_X 与 design 文本一致（330）；OFFSET_X / OFFSET_Y 取 design 给的小常量起步值
// （80 / 60），把整张图从画布左上角推开一点，留出墙面左侧遥测 rail（Task 5.1）与
// 顶部空隙。这些是确定性常量，Task 6/7 据浏览器 QA 可微调。
//
// ROW_Y（行距）由 Task 7.4 浏览器视觉 QA 从 design 起步值 150 上调到 180：QA 证据
// （`.tmp/blueprint-wall-qa/geom.json`）显示在「仅早期阶段被填充」的稀疏作业里，9 条
// 阶段道让内容**宽 ~3100px、高仅 ~780px**（≈4:1），而墙面画布是 1680×760（≈2.2:1），
// 因此 `fitView` 受**宽度**约束并把这块「又宽又矮」的内容垂直居中，留出上下各 ~168px
// 空白（墙面下半部空置）。把行距从 150 提到 180 让被填充的行在 y 方向铺得更开，fitView
// 后占用更多竖直空间（稀疏作业的竖直填充率 ~56% → ~64%），且**不**改变卡片渲染尺寸
// （宽度受限时 fit 缩放与行距无关）、**不**触碰水平列距（卡片宽 300 vs 列距 330，无法
// 再压缩）。design「### Column Remap」的像素公式已同步更新为 `row * 180`。

/** 每个阶段道的水平像素跨度（x 方向）。 */
export const LANE_X = 330;
/**
 * 每一行的垂直像素跨度（y 方向）。
 *
 * Task 7.4 据浏览器 QA 由 design 起步值 150 上调到 180，让稀疏作业的图在竖直方向铺得
 * 更开、更充分利用 1680×760 的高画布（详见上方常量块注释）。仍是确定性常量：相同输入
 * 恒产出相同坐标，不在两次渲染之间漂移。
 */
export const ROW_Y = 180;
/** 整张图的水平起始偏移，避免贴左边缘。 */
export const OFFSET_X = 80;
/** 整张图的垂直起始偏移，避免贴上边缘。 */
export const OFFSET_Y = 60;

/**
 * 禁用 FlowGraph 内建 dagre 自动布局的 layout 配置（Req 2.8）。
 *
 * 空数组 = 空布局流水线。G6 v5 `LayoutController.postLayout` 对数组型 layout 逐项执行，
 * 空数组时 for 循环不执行 → 不跑任何布局 → 节点保留我们写入的固定 `style.x/style.y`。
 *
 * FlowGraph 通过 `mergeOptions(COMMON_OPTIONS, DEFAULT_OPTIONS, ..., restProps)` 合并配置，
 * 顶层 `layout` prop（restProps，优先级最高）会覆盖 `DEFAULT_OPTIONS.layout`
 * （`{ type: "dagre" }`）——合并逻辑里「数组覆盖普通对象」，因此传入空数组即可干净地
 * 关闭 dagre，无需下沉到 `@antv/g6` Graph API（Req 2.9 fallback 未触发）。
 *
 * 组件（Task 6.2）只需把该常量透传给 `<FlowGraph layout={BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT} />`。
 */
export const BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT: FlowGraphLayoutOptions = [];

// ─── Minimap + zoom/fit config (Task 5.3) ────────────────────────────────────
//
// 墙面图的 minimap 插件与受约束的 fit/zoom 配置（Req 2.3 / 2.4 / 7.3 / 9.1-9.7）。
// 这些都是**纯数据常量**（无运行时 import），既可被组件（Task 6.2 / 本任务）透传给
// `<FlowGraph>`，也可被源码 / 配置级测试断言其存在与取值（Task 5.4）。
//
// 交互前提（Task 1.4 spike 决策，见 `BlueprintWallProcessGraphHud.tsx` JSDoc）：墙面
// 经 drei `<Html transform>` 套了 CSS transform，G6 v5 的画布平移/缩放手势依赖屏幕空间
// 指针坐标做 hit-testing，在 transform 后不可靠，故首版**禁用** canvas pan/zoom
// （`behaviors={[]}`）。因此 fit/zoom 不走画布内手势，而是由墙面**外部按钮**命令式调用
// graph API（`graph.fitView()` / `graph.zoomTo(...)`）。本组常量服务于该外部控制方案。

/**
 * 写入 FlowGraph `plugins` 的最小插件配置结构（对齐 G6 v5 `CustomPluginOption`：
 * 必须有 `type: string`，可选 `key` 唯一标识）。本地最小结构，避免 import
 * `@antv/g6` 运行时/类型；结构上可赋给 G6 `PluginOptions` 数组元素。
 */
export interface FlowGraphPluginOption {
  /** 插件类型（G6 注册名）。 */
  type: string;
  /** 插件唯一 key，便于后续 `graph.getPluginInstance(key)` 等操作。 */
  key?: string;
  [key: string]: unknown;
}

/** FlowGraph `plugins` prop 的最小结构类型（插件配置数组）。 */
export type FlowGraphPluginOptions = FlowGraphPluginOption[];

/**
 * 右下角 minimap 插件配置（Req 2.3 / 7.4）。
 *
 * `type: "minimap"` 是 G6 v5 内置插件注册名（已对照安装的 `@antv/g6@5.1.1`
 * `lib/registry/build-in.js` 确认：`{ 'grid-line', background, fullscreen, minimap,
 * toolbar }`）。`position: "right-bottom"` 即墙面**右下角**（G6 `Placement`
 * 的 `CornerPlacement` 之一；亦为 minimap 默认值，这里显式写出以满足「下右」诉求）。
 * `size` 取一个克制的缩略图尺寸，给墙面右下留出概览但不喧宾夺主。
 */
export const BLUEPRINT_WALL_MINIMAP_PLUGIN: FlowGraphPluginOption = {
  type: "minimap",
  key: "blueprint-wall-minimap",
  size: [220, 140],
  position: "right-bottom",
  padding: 8,
};

/**
 * 透传给 `<FlowGraph plugins={...}>` 的插件数组（当前仅 minimap）。
 *
 * 显式覆盖 FlowGraph 的默认空插件集，启用右下角 minimap（Req 2.3）。后续若需 G6 内置
 * toolbar/background 等，可在此数组追加，无需改组件。
 */
export const BLUEPRINT_WALL_PLUGINS: FlowGraphPluginOptions = [
  BLUEPRINT_WALL_MINIMAP_PLUGIN,
];

/** 墙面图最小缩放（wall-safe 下限，Req 9.7：不让图缩到不可读）。 */
export const BLUEPRINT_WALL_MIN_ZOOM = 0.2;

/** 墙面图最大缩放（wall-safe 上限，Req 9.7：不让图放到溢出墙面）。 */
export const BLUEPRINT_WALL_MAX_ZOOM = 2;

/**
 * 透传给 `<FlowGraph zoomRange={...}>` 的缩放范围（G6 `ViewportOptions.zoomRange`）。
 *
 * 把 G6 默认的 `[0.01, 10]` 收紧到 wall-safe 的 `[min, max]`，让任何缩放路径（外部
 * 按钮、minimap mask 拖拽）都被约束在墙面可读区间内（Req 9.1 / 9.7）。
 */
export const BLUEPRINT_WALL_ZOOM_RANGE: [number, number] = [
  BLUEPRINT_WALL_MIN_ZOOM,
  BLUEPRINT_WALL_MAX_ZOOM,
];

/** 外部「放大」按钮的单步缩放倍率（>1）。 */
export const BLUEPRINT_WALL_ZOOM_IN_RATIO = 1.2;

/** 外部「缩小」按钮的单步缩放倍率（<1）。 */
export const BLUEPRINT_WALL_ZOOM_OUT_RATIO = 0.8;

/**
 * 把一个目标缩放值夹紧到 wall-safe 区间 `[BLUEPRINT_WALL_MIN_ZOOM,
 * BLUEPRINT_WALL_MAX_ZOOM]`（纯函数，供外部 zoom 按钮命令式调用前做约束，Req 9.7）。
 */
export function clampWallZoom(zoom: number): number {
  if (zoom < BLUEPRINT_WALL_MIN_ZOOM) return BLUEPRINT_WALL_MIN_ZOOM;
  if (zoom > BLUEPRINT_WALL_MAX_ZOOM) return BLUEPRINT_WALL_MAX_ZOOM;
  return zoom;
}

// ─── Edge styling constants (Task 3.2) ───────────────────────────────────────
//
// 把 deriver 边的语义（kind / priority / label）确定性映射到 G6 v5 边样式。所有取值
// 都是固定常量，相同输入恒产出相同样式（NFR：不让边在两次渲染之间跳动）。

/**
 * 曲线边类型（G6 v5 注册名）。
 *
 * 已对照安装的 `@antv/g6@5.1.1` `lib/registry/build-in.js` 的 `edge` 注册表确认其为
 * 内置类型之一：`{ cubic, line, polyline, quadratic, 'cubic-horizontal', 'cubic-radial',
 * 'cubic-vertical' }`。墙面阶段道沿 x 轴左→右流动，水平三阶贝塞尔曲线
 * （`cubic-horizontal`）的控制点沿水平方向展开，最贴合该流向，故选它（Req 6.2 曲线）。
 */
export const EDGE_CURVE_TYPE = "cubic-horizontal" as const;

/**
 * 默认虚线 dash/gap（Req 6.2 默认虚线）。
 *
 * `[dash, gap] = [6, 4]`：6px 实线段 + 4px 空隙，在浅色画布上是清晰但低噪的虚线。
 * 结构上对应 G6 `PathStyleProps.lineDash`（`number[]`）。每条边恒带此 lineDash。
 */
export const EDGE_DEFAULT_LINE_DASH: [number, number] = [6, 4];

/**
 * 边按 `kind` 取色（Req 6.3）。覆盖全部 7 种 `BlueprintWallGraphEdgeKind`，颜色方向对齐
 * design「### Edge Styling」表：
 *
 * | kind             | 方向          | 取值       |
 * | ---------------- | ------------- | ---------- |
 * | `supports`       | muted blue-gray | `#64748b`（slate-500，柔和蓝灰） |
 * | `depends_on`     | teal          | `#0d9488`（teal-600）            |
 * | `produces`       | blue          | `#2563eb`（blue-600）            |
 * | `uses_capability`| amber/teal    | `#d97706`（amber-600，取琥珀向） |
 * | `refines`        | purple        | `#7c3aed`（violet-600）          |
 * | `blocks`         | red           | `#dc2626`（red-600）             |
 * | `answers`        | green / final | `#16a34a`（green-600）           |
 *
 * 注：deriver 当前只产出 `depends_on` / `supports` / `produces` / `answers`，但这里防御性地
 * 覆盖全部 7 种 kind，未来 deriver 扩展新边时无需改本映射。
 */
export const EDGE_KIND_COLOR: Record<BlueprintWallGraphEdgeKind, string> = {
  supports: "#64748b",
  depends_on: "#0d9488",
  produces: "#2563eb",
  uses_capability: "#d97706",
  refines: "#7c3aed",
  blocks: "#dc2626",
  answers: "#16a34a",
};

/** 边按 priority 强调的样式（线宽 + 不透明度）。 */
export interface EdgePriorityStyle {
  lineWidth: number;
  opacity: number;
}

/**
 * 边按 `priority` 强调（Req 6.3「kind OR priority」）。确定性映射 deriver 的三档
 * priority 到 G6 `PathStyleProps.lineWidth` / `opacity`：
 *
 * | priority    | lineWidth | opacity | 含义                                   |
 * | ----------- | --------: | ------: | -------------------------------------- |
 * | `primary`   |       2.5 |    1    | 主脊 / 主干边，最粗最实                 |
 * | `secondary` |       1.5 |    0.85 | 次级关系边，中等                        |
 * | `ambient`   |       1   |    0.6  | 环境 / 弱关系边，最细最淡               |
 *
 * 线宽递减 + 不透明度递减一起，把视觉权重从主干边到环境边平滑降级，但不改变颜色（颜色
 * 仍由 kind 决定），因此 kind 与 priority 两个维度互不干扰、可叠加读出。
 */
export const EDGE_PRIORITY_STYLE: Record<
  BlueprintWallGraphEdge["priority"],
  EdgePriorityStyle
> = {
  primary: { lineWidth: 2.5, opacity: 1 },
  secondary: { lineWidth: 1.5, opacity: 0.85 },
  ambient: { lineWidth: 1, opacity: 0.6 },
};

/**
 * 把单条 deriver 边映射成 G6 v5 可消费的边样式（曲线虚线 + 按 kind 着色 + 按 priority
 * 强调 + 可选标签）。纯函数，相同输入恒产出相同样式。
 *
 * - `stroke`：`EDGE_KIND_COLOR[edge.kind]`（Req 6.3）。
 * - `lineDash`：`EDGE_DEFAULT_LINE_DASH`（Req 6.2 默认虚线，每条边都有）。
 * - `lineWidth` / `opacity`：`EDGE_PRIORITY_STYLE[edge.priority]`（Req 6.3）。
 * - `labelText` 等：仅当 `edge.label` 存在且非空时写入（Req 6.4）；否则完全省略标签字段，
 *   保持 style 干净，避免渲染空标签背景。
 */
export function deriveEdgeStyle(
  edge: Pick<BlueprintWallGraphEdge, "kind" | "priority" | "label">
): FlowGraphEdgeStyle {
  const priorityStyle = EDGE_PRIORITY_STYLE[edge.priority];
  const style: FlowGraphEdgeStyle = {
    stroke: EDGE_KIND_COLOR[edge.kind],
    lineDash: EDGE_DEFAULT_LINE_DASH,
    lineWidth: priorityStyle.lineWidth,
    opacity: priorityStyle.opacity,
  };

  // 标签仅在 deriver 真正提供非空 label 时写入（Req 6.4），否则不渲染标签。
  if (edge.label !== undefined && edge.label.length > 0) {
    style.labelText = edge.label;
    style.labelFill = EDGE_KIND_COLOR[edge.kind];
    style.labelFontSize = 11;
    style.labelBackground = true;
  }

  return style;
}

// ─── FlowGraph-ready data types ──────────────────────────────────────────────
//
// 以下接口与 G6 v5（`@antv/g6@5.1.1`）的 `NodeData` / `EdgeData` / `GraphData` /
// `LayoutOptions` 结构对齐（字段名一致、必填项一致），但本地定义以避免 import 传递依赖
// `@antv/g6` 的类型 / 运行时。组件层（Task 6.2）把本模块产出的对象透传给
// `<FlowGraph data={...} layout={...} />` 时结构兼容。

/**
 * FlowGraph / G6 布局配置类型（本 spec 用空数组关闭 dagre）。
 *
 * G6 v5 的 `LayoutOptions = SingleLayoutOptions | SingleLayoutOptions[]`，其中数组元素
 * （`BaseLayoutOptions`）只要求 `type: string`。本模块只用「空数组 = 关闭布局流水线」这一
 * 形态，用 `Array<{ type: string }>` 的最小结构表达，结构上可赋给 G6 `LayoutOptions`，
 * 供 Task 6.2 透传给 `<FlowGraph layout={...}>`。
 */
export type FlowGraphLayoutOptions = Array<{ type: string }>;

/**
 * 写入 FlowGraph 节点 `data` 字段的蓝图自定义负载。
 *
 * Task 4 的自定义节点卡片（`BlueprintWallGraphNodeCard`）从这里读取渲染所需信息。
 * 保留 deriver 的 `type` / `status` / `title` / `body` / `accent` / `sourceRefs`
 * （Req 5.1-5.7），并附带重映射算出的 `visualStageLane` 及原始 `row` / `column`，
 * 方便后续布局 / 调试。
 *
 * 显式 `[key: string]: unknown` 索引签名让该接口可赋给 G6 `NodeData.data`
 * （`Record<string, unknown>`）。
 */
export interface BlueprintFlowGraphNodeData {
  /** deriver 节点类型（user_goal / stage / reasoning / route / ...）。 */
  type: BlueprintWallGraphNodeType;
  /** deriver 节点状态（empty / queued / active / ready / completed / warning / failed）。 */
  status: BlueprintWallGraphNodeStatus;
  /** 节点标题。 */
  title: string;
  /** 节点正文（可选）。 */
  body?: string;
  /** 强调色提示（可选）。 */
  accent?: BlueprintWallGraphNode["accent"];
  /** deriver 来源引用，原样保留（Req 5）。 */
  sourceRefs: BlueprintWallGraphNode["sourceRefs"];
  /** 列重映射算出的视觉阶段道（0..8 的 stageIndex），驱动 x。 */
  visualStageLane: number;
  /**
   * deriver 原始行号，原样保留（调试 / 既有消费方）。
   *
   * 注意：自 per-lane 行去冲突（见 `mapWallDataToFlowGraph` 步骤 1b）引入后，**驱动 y
   * 的不再是这个原始 row，而是去冲突后的 `effectiveRow`**。两者在无冲突时相等，发生
   * 同道同行碰撞时 `effectiveRow` 会被下移到该道内下一个空闲整数行。
   */
  row: number;
  /**
   * per-lane 行去冲突后**实际驱动 y** 的有效行号（见 `mapWallDataToFlowGraph`）。
   *
   * 无碰撞时 `effectiveRow === row`；同一 `visualStageLane` 内若多个节点抢同一原始 row，
   * 按 deriver 数组顺序（确定性）依次下移到下一个空闲整数行，保证同道内不出现两个节点
   * 落在同一 `(visualStageLane, effectiveRow)` → 同一 (x, y)。
   */
  effectiveRow: number;
  /** deriver 原始（类目 / 阶段）列号，仅作保留 / 调试用，不再驱动 x。 */
  column: number;
  [key: string]: unknown;
}

/**
 * FlowGraph / G6 v5 节点数据（本地最小结构，对齐 G6 `NodeData`）。
 *
 * - `id`：与 deriver 节点 id **完全一致**（稳定 id，Req 3.9）。
 * - `type`：可选 G6 节点类型字符串（本 spec 暂不指定，留给 Task 4 自定义节点注册）。
 * - `style.x` / `style.y`：固定像素坐标。G6 v5 从 `style.x/style.y` 读取节点固定位置
 *   （见 `@antv/g6@5.1.1` `lib/spec/data.d.ts` `GraphData` 示例：`{ id, style: { x, y } }`）。
 * - `data`：蓝图自定义负载，供 Task 4 自定义卡片消费。
 *
 * 结构兼容 G6 `NodeData`，可直接赋给 `<FlowGraph data={...}>`（`GraphData.nodes`）。
 */
export interface FlowGraphNodeData {
  id: string;
  type?: string;
  style: { x: number; y: number; [key: string]: unknown };
  data: BlueprintFlowGraphNodeData;
  // 显式索引签名让该接口可赋给 G6 `NodeData`（`NodeData` 自带 `[key: string]: unknown`，
  // TS 要求目标的索引签名在源类型上也存在才认定可赋值），从而能直接透传给
  // `<FlowGraph data={...}>`（`GraphData.nodes`）。
  [key: string]: unknown;
}

/**
 * 写入 FlowGraph 边 `data` 字段的蓝图自定义负载（最小版，Task 3.2 增强样式）。
 *
 * 显式索引签名让该接口可赋给 G6 `EdgeData.data`。
 */
export interface BlueprintFlowGraphEdgeData {
  /** deriver 边语义（supports / depends_on / produces / ...）。 */
  kind: BlueprintWallGraphEdgeKind;
  /** deriver 边优先级（primary / secondary / ambient）。 */
  priority: "primary" | "secondary" | "ambient";
  /** 边标签（可选，Req 6 保留标签）。 */
  label?: string;
  [key: string]: unknown;
}

/**
 * FlowGraph / G6 v5 边样式（本地最小结构，对齐 G6 `EdgeStyle` / `BaseEdgeStyleProps`）。
 *
 * 字段名与 `@antv/g6@5.1.1` 完全一致（见 `lib/elements/edges/base-edge.d.ts` 的
 * `BaseEdgeStyleProps`，它继承 `PathStyleProps`，并通过 `Prefix<'label', EdgeLabelStyleProps>`
 * 暴露 `labelText`）：
 *  - `stroke`：线条颜色（来自 `PathStyleProps`），本 spec 按 `kind` 取 `EDGE_KIND_COLOR`。
 *  - `lineDash`：虚线 dash/gap 数组（来自 `PathStyleProps`），本 spec 恒为虚线（Req 6.2）。
 *  - `lineWidth` / `opacity`：线宽 / 不透明度（来自 `PathStyleProps`），按 `priority` 强调。
 *  - `labelText`：边标签文本（`Prefix<'label'>` + `TextStyleProps.text`），仅在
 *    `edge.label` 存在时写入（Req 6.4）。
 *  - `labelFill` / `labelFontSize` / `labelBackground`：最小标签样式，让标签在浅色画布上可读。
 *
 * 结构上可赋给 G6 `EdgeData.style`（`EdgeStyle = Partial<BaseEdgeStyleProps> & 索引签名`）。
 */
export interface FlowGraphEdgeStyle {
  /** 线条颜色，按 kind 取自 `EDGE_KIND_COLOR`。 */
  stroke: string;
  /** 虚线 dash/gap，恒为 `EDGE_DEFAULT_LINE_DASH`（Req 6.2 默认虚线）。 */
  lineDash: [number, number];
  /** 线宽，按 priority 取自 `EDGE_PRIORITY_STYLE`。 */
  lineWidth: number;
  /** 不透明度，按 priority 取自 `EDGE_PRIORITY_STYLE`。 */
  opacity: number;
  /** 边标签文本，仅在 `edge.label` 存在时写入（G6 v5 字段名 `labelText`）。 */
  labelText?: string;
  /** 标签字色（仅在有 labelText 时写入）。 */
  labelFill?: string;
  /** 标签字号（仅在有 labelText 时写入）。 */
  labelFontSize?: number;
  /** 标签背景开关（仅在有 labelText 时写入，提升浅色画布可读性）。 */
  labelBackground?: boolean;
  [key: string]: unknown;
}

/**
 * FlowGraph / G6 v5 边数据（本地最小结构，对齐 G6 `EdgeData`）。
 *
 * - `id`：与 deriver 边 id 一致（稳定 id）。
 * - `source` / `target`：映射自 deriver 的 `edge.from` / `edge.to`。
 * - `type`：G6 v5 注册的曲线边类型字符串，本 spec 恒为 `"cubic-horizontal"`
 *   （已对照安装的 `@antv/g6@5.1.1` `lib/registry/build-in.js` 的 `edge` 注册表确认：
 *   `{ cubic, line, polyline, quadratic, 'cubic-horizontal', 'cubic-radial', 'cubic-vertical' }`，
 *   水平三阶贝塞尔曲线契合墙面阶段道左→右的流动方向）。
 * - `style`：曲线虚线 / 按 kind 着色 / 按 priority 强调 / 可选标签样式（Task 3.2）。
 * - `data`：最小语义负载（kind / priority / 可选 label），供后续节点卡 / 调试消费。
 *
 * 结构兼容 G6 `EdgeData`，可直接赋给 `<FlowGraph data={...}>`（`GraphData.edges`）。
 */
export interface FlowGraphEdgeData {
  id: string;
  source: string;
  target: string;
  type: string;
  style: FlowGraphEdgeStyle;
  data: BlueprintFlowGraphEdgeData;
  // 显式索引签名让该接口可赋给 G6 `EdgeData`（同 NodeData 口径），从而能直接透传给
  // `<FlowGraph data={...}>`（`GraphData.edges`）。
  [key: string]: unknown;
}

/** `mapWallDataToFlowGraph` 的返回形状（design 提案）。 */
export interface MapWallDataToFlowGraphResult {
  data: {
    nodes: FlowGraphNodeData[];
    edges: FlowGraphEdgeData[];
  };
  /** 禁用 dagre 的 layout（恒为空数组，见 BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT）。 */
  layout: FlowGraphLayoutOptions;
}

// ─── Column Remap lookup ─────────────────────────────────────────────────────

/**
 * 把一个 deriver 节点解析到唯一的视觉阶段道（`visualStageLane`，0..8 的 stageIndex）。
 *
 * 实现 design「### Column Remap」表格（每个节点类型恰好产出一个 stageIndex，无区间、
 * 无「按 kind 拆分」、无 future-data fallback）：
 *
 * | 节点类型      | 视觉阶段道 (stageIndex)                                   |
 * | ------------- | -------------------------------------------------------- |
 * | `stage`       | 自身 stageIndex（= `node.column`，不重映射）              |
 * | `user_goal`   | 0（input），固定                                          |
 * | `reasoning`   | `sourceRefs` 中 `kind==="stage"` 项对应的 stageIndex；    |
 * |               | 缺失时回退 `data.stageSignal.stageIndex`（当前阶段道）    |
 * | `route`       | 2（route_generation），固定                               |
 * | `spec_node`   | 4（spec_tree），固定                                      |
 * | `capability`  | `data.stageSignal.stageIndex`（当前阶段道），固定规则     |
 * | `preview`     | 6（effect_preview），固定                                 |
 * | `artifact`    | 8（engineering_handoff），固定（与 final 共道、不同行）   |
 * | `final`       | 8（engineering_handoff），固定                            |
 *
 * reasoning 细则：deriver 仅当 reasoning entry 的 `stageId` 命中已知阶段时，才向其
 * `sourceRefs` 追加 `{ kind: "stage", id: stageKey }`。因此这里先找 `kind==="stage"` 的
 * ref，用 `BLUEPRINT_SCENE_STAGES.indexOf(ref.id)` 求道号；indexOf 为 -1（未知 / 防御）
 * 或根本没有该 ref 时，回退当前阶段道 `data.stageSignal.stageIndex`。
 *
 * capability 细则：数据层没有可靠的 capability→stage 归属（`capabilityOwners` 只映射到
 * 角色，角色不是图节点，deriver 也不画 capability→stage 边），因此不臆造固定阶段，统一
 * 放到当前阶段道，与 reasoning 的「无已知 stage」回退一致（Req 5.6 / 5.7）。
 */
export function resolveVisualStageLane(
  node: BlueprintWallGraphNode,
  data: Pick<BlueprintWallProcessData, "stageSignal">
): number {
  const currentStageLane = data.stageSignal.stageIndex;

  switch (node.type) {
    case "stage":
      // 阶段主干节点：deriver 的 column 即 stageIndex，直接用，不重映射。
      return node.column;
    case "user_goal":
      return 0; // input
    case "route":
      return 2; // route_generation（非 clarification=1，非 route_selection=3）
    case "spec_node":
      return 4; // spec_tree（非 route_generation=2，非 spec_docs=5）
    case "brainstorm":
      return 5; // spec_docs lane: second-stage branch convergence
    case "preview":
      return 6; // effect_preview
    case "artifact":
      return 8; // engineering_handoff（与 final 共道，不同 row 不重叠）
    case "final":
      return 8; // engineering_handoff
    case "capability":
      // 无可靠 stage 归属 → 当前阶段道（不臆造固定阶段）。
      return currentStageLane;
    case "reasoning": {
      // 读 sourceRefs 里的已知 stage；缺失 / 未知 → 当前阶段道。
      const stageRef = node.sourceRefs.find((ref) => ref.kind === "stage");
      if (stageRef) {
        const laneIndex = BLUEPRINT_SCENE_STAGES.indexOf(
          stageRef.id as BlueprintSceneStageKey
        );
        if (laneIndex >= 0) return laneIndex;
      }
      return currentStageLane;
    }
    default: {
      // 类型穷尽兜底：未知类型不臆测阶段，落到当前阶段道（确定性、不抛错）。
      return currentStageLane;
    }
  }
}

// ─── Main mapper ─────────────────────────────────────────────────────────────

/**
 * 把 `BlueprintWallProcessData` 映射为 FlowGraph / G6 可直接消费的 graph-ready 数据。
 *
 * 步骤：
 *  1. 对每个 deriver 节点用 `resolveVisualStageLane` 求视觉阶段道 `visualStageLane`。
 *  1b. **per-lane 行去冲突（Fix 1）**：deriver 刻意不在数据层做 exact non-overlap
 *     （它在文档里把「精确不重叠」留给可视层），因此同一 `visualStageLane` 内不同节点
 *     可能携带相同的原始 `row`——例如当前阶段为 route_generation 时，`capability:*`
 *     （lane = 当前阶段道 2、row index+1）会与某条「当前阶段」的 `reasoning:*`
 *     （同样 fall back 到 lane 2、row index+1）撞到同一 `(lane, row)`，两张 ~300px 宽的
 *     卡片完全重叠。这里**在可视层**按确定性顺序为每个节点分配一个 `effectiveRow`：
 *       - 按 deriver 数组顺序（已确定性）逐个处理节点（不引入 Date.now / 不重排序）；
 *       - 优先保留节点的原始 `row` 作为首选槽位；
 *       - 若该道内该整数行已被占用，则线性 +1 顺延到下一个空闲整数行；
 *       - 记录每条 lane 已占用的行集合，保证同道内不会有两个节点落在同一 effectiveRow。
 *     stage 主干节点（row 0，各自独占 lane）与 user_goal 一般不会碰撞，但本算法对它们
 *     同样成立——首选槽空闲就用首选槽，被占才顺延。
 *  2. 用**去冲突后的** `effectiveRow` 算 `y`，用 `visualStageLane` 算 `x`，写入 G6
 *     `style.x/y`；deriver 的 `type/status/title/body/accent/sourceRefs` +
 *     `visualStageLane/row/effectiveRow/column` 原样保留进节点 `data`（供 Task 4 卡片 /
 *     调试）。节点 id 与 deriver 完全一致。
 *  3. 对每条 deriver 边映射 `{ id, source: from, target: to, type: "cubic-horizontal",
 *     style, data: { kind, priority, label? } }`——`type` 选水平曲线、`style` 由
 *     `deriveEdgeStyle` 产出（默认虚线 + 按 kind 着色 + 按 priority 强调 + 可选标签）。
 *     映射器只映射 deriver 真实产出的边，绝不臆造新边（Req 6.6/6.7）。
 *  4. 返回 `layout = []` 关闭 dagre，让节点保留固定坐标（Req 2.8）。
 *
 * 纯函数：相同输入恒产出相同输出，无副作用、无 hook、无 DOM。
 */
export function mapWallDataToFlowGraph(
  data: BlueprintWallProcessData
): MapWallDataToFlowGraphResult {
  // per-lane 行占用表：lane → 已占用的 effectiveRow 集合。按 deriver 数组顺序填充，
  // 保证去冲突是确定性的（同输入恒产出同结果）。
  const laneOccupancy = new Map<number, Set<number>>();

  /**
   * 为某条 lane 内的节点分配一个空闲的 effectiveRow：首选 `preferredRow`，被占则线性 +1
   * 顺延到下一个空闲整数行。返回值即写入占用表并驱动 y 的最终行号。
   */
  const claimRow = (lane: number, preferredRow: number): number => {
    let occupied = laneOccupancy.get(lane);
    if (!occupied) {
      occupied = new Set<number>();
      laneOccupancy.set(lane, occupied);
    }
    let row = preferredRow;
    while (occupied.has(row)) {
      row += 1;
    }
    occupied.add(row);
    return row;
  };

  const nodes: FlowGraphNodeData[] = data.nodes.map((node) => {
    const visualStageLane = resolveVisualStageLane(node, data);
    // 首选原始 row；同道同行碰撞时顺延到下一个空闲行（确定性）。
    const effectiveRow = claimRow(visualStageLane, node.row);
    const x = visualStageLane * LANE_X + OFFSET_X;
    const y = effectiveRow * ROW_Y + OFFSET_Y;

    const nodeData: BlueprintFlowGraphNodeData = {
      type: node.type,
      status: node.status,
      title: node.title,
      sourceRefs: node.sourceRefs,
      visualStageLane,
      row: node.row,
      effectiveRow,
      column: node.column,
    };
    // 可选字段仅在存在时写入，保持 data 干净。
    if (node.body !== undefined) nodeData.body = node.body;
    if (node.accent !== undefined) nodeData.accent = node.accent;

    return {
      id: node.id,
      style: { x, y },
      data: nodeData,
    };
  });

  const edges: FlowGraphEdgeData[] = data.edges.map((edge) => {
    const edgeData: BlueprintFlowGraphEdgeData = {
      kind: edge.kind,
      priority: edge.priority,
    };
    if (edge.label !== undefined) edgeData.label = edge.label;

    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: EDGE_CURVE_TYPE,
      style: deriveEdgeStyle(edge),
      data: edgeData,
    };
  });

  return {
    data: { nodes, edges },
    layout: BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT,
  };
}
