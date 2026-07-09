/**
 * BlueprintWallProcessGraphHud - blueprint-mode wall graph HUD (skeleton).
 *
 * Renders an Ant Design Graphs `FlowGraph` embedded directly on the 3D back wall
 * through a drei `<Html transform>` surface, using `deriveBlueprintWallProcessData(...)`
 * as the single source of graph content.
 *
 * 本文件已从骨架推进为 live 数据驱动图（Task 6.2），在 Task 1.2 骨架 +
 * Task 5.1/5.2/5.3 墙面 overlay 之上，正式把映射后的真实图数据接入 FlowGraph：
 *  - 已挂载墙面 `<Html transform>` 容器（沿用 SandboxMonitor 的 group + Html 模式）。
 *  - 已 import 并调用 `deriveBlueprintWallProcessData(...)`（useMemo 记忆），其输出再经
 *    `mapWallDataToFlowGraph(...)`（同目录纯映射器，Task 3）映射为 FlowGraph 可消费的
 *    `{ data: { nodes, edges }, layout }`，**作为 `<FlowGraph data>` 的唯一数据来源**
 *    （Req 3.1/3.2/3.3：图节点/边只来自 deriver → mapper，单一数据源）。
 *  - 已把自定义节点卡片 `BlueprintWallGraphNodeCard`（Task 4）经 G6 v5
 *    `@antv/g6-extension-react` 的 React 节点机制接线：FlowGraph 默认 `node.type:
 *    "react"`，自定义渲染走 `node.style.component`——一个 `(datum) => ReactElement`
 *    回调，从 `datum.data`（即 mapper 写入的 `BlueprintFlowGraphNodeData`）取出
 *    type/status/title/body/sourceRefs/accent 渲染成卡片（Req 5.1-5.7）。preview 节点
 *    额外把 `wallData.previewSummary` 透传给卡片（Req 5.5/3.6）。
 *  - 已正式化视口配置（Task 6.2，Req 2.6/2.7/9.1-9.9）：
 *      · 初次渲染铺满取景由 `autoFit="view"` 负责；
 *      · **job 变化后**经 `graphRef` 命令式 `graph.fitView()` 重新适配（useEffect 依赖
 *        映射结果，job-scoped 输入变化 → 重新 fit）；
 *      · `zoomRange={BLUEPRINT_WALL_ZOOM_RANGE}` 约束 min/max 缩放（Req 9.7）；
 *      · `behaviors={[]}` 关闭画布内 pan/zoom 与一切编辑/连边交互（Task 1.4 spike 锁定，
 *        Req 9.2/9.3/9.4），fit/zoom 改由右上外部按钮命令式驱动；
 *      · `layout={BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT}`（空数组）关闭内建 dagre，让节点保留
 *        mapper 写入的固定 `style.x/y`（Req 2.8）。
 *  - 已接入左侧遥测栏 `BlueprintWallMetricsRail`（Task 5.1）：以绝对定位浮于墙面图
 *    画布左侧，消费 `wallData.metrics`；当前 deriver 的 token/source/remaining/time
 *    恒为 `null`，故首版四项均渲染为 muted 占位（Req 7.1 / 7.2 / 7.3）。
 *  - 已接入底部 console overlay `BlueprintWallConsoleOverlay`（Task 5.2）：以绝对定位
 *    贴墙面底沿，消费 `wallData.consoleLines`；空时渲染空 console 壳，非空时渲染各行
 *    （Req 7.4 / 7.5 / 7.6 / 7.7）。`pointerEvents: "none"` 不拦截墙面图指针事件。
 *  - 已接入右下 minimap 与右上外部控件（Task 5.3，Req 2.3 / 2.4 / 7.3 / 9.1-9.7）：
 *      · minimap 走 G6 v5 内置 `minimap` 插件，经 `<FlowGraph plugins={...}>` 启用，
 *        `position: "right-bottom"` 落在墙面**右下角**（与底部 console 预留的 right:232
 *        位互不遮挡）。
 *      · 因 Task 1.4 spike 已禁用画布内 pan/zoom（`behaviors={[]}`，transform 下指针
 *        hit-testing 不可靠），fit/zoom 改由**右上角外部按钮**
 *        `BlueprintWallGraphControls` 命令式驱动：组件通过 FlowGraph 转发的 ref 拿到
 *        G6 `Graph` 实例，点击时调用 `graph.fitView()` / `graph.zoomTo(...)`。
 *      · 缩放被 `zoomRange={BLUEPRINT_WALL_ZOOM_RANGE}` 约束在 wall-safe 区间
 *        （Req 9.7），外部 zoom 步进同样经 `clampWallZoom` 夹紧。
 *
 *  - 已正式化墙面摆放 / 尺寸常量（Task 6.1，Req 8.1-8.7）：position [0, 2.05, -4.87]、
 *    1680 × 760、distanceFactor 4.0、panelZ 0.008 已抽到独立纯模块
 *    `blueprint-wall-placement.ts`，成为单一可读 / 可复用 / 可测试的真相源；墙面比
 *    mission-first monitor（1416 × 243）显著更高、呈竖向大画布，与 monitor 互斥渲染、
 *    不复制其尺寸常量（mission-first monitor 维持不变，NFR-1）。
 *
 *  - 已正式化空态 overlay（Task 6.3 / Fix 3，Req 4.2 / 10.6）：无活动蓝图作业（deriver
 *    产出零节点）时，**完全不渲染 `<FlowGraph>`**——只渲染 `BlueprintWallEmptyState`
 *    居中空态文案（外加左侧遥测栏 / console / 禁用态控件，它们本就是空态友好的）。
 *    这样底层 G6/Graphin 画布与 minimap 插件在空态下根本不会初始化，符合「干净空态、
 *    不挂载图」的契约（`@ant-design/graphs` 的 `BaseGraph` 用 lodash
 *    `isEmpty(options.data)` 判断是否挂载，而 `isEmpty({ nodes: [], edges: [] })` 为
 *    `false`，因此**不能**靠传空 data 来阻止挂载，必须在 JSX 层直接 gate 掉
 *    `<FlowGraph>`）。`!isEmpty` 时才渲染 `<FlowGraph data={flowGraph.data} ...>`。
 *    空态**不**落任何 mission-first 兜底数据（无终端日志 / 截图 / 任务摘要 / 臆造节点边）；
 *    空态由 deriver 的 job 隔离保证（无 job → 零节点 → 空图），本组件只是其视觉收尾，
 *    并透传 `emptyReason` 供测试断言空态来源。
 *
 * 后续任务接入：浏览器视觉 QA（Task 7）。
 *
 * 作用域护栏（Req 3.7 / 4.4 / 4.5）：本组件**不得**读取 mission-first 沙箱状态
 * （`useSandboxStore`），也不引用 `SandboxMonitor` / `MissionWallTaskPanel`。
 */

import { FlowGraph } from "@ant-design/graphs";
import { Html } from "@react-three/drei";
import {
  type ComponentRef,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationJob,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintEffectPreviewSnapshot } from "@/lib/blueprint-api";
import type { AppLocale } from "@/lib/locale";

import { BlueprintWallConsoleOverlay } from "./BlueprintWallConsoleOverlay";
import { BlueprintWallEmptyState } from "./BlueprintWallEmptyState";
import { BlueprintWallGraphControls } from "./BlueprintWallGraphControls";
import {
  BlueprintWallGraphNodeCard,
  CARD_WIDTH,
} from "./BlueprintWallGraphNodeCard";
import { BlueprintWallMetricsRail } from "./BlueprintWallMetricsRail";
import {
  BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT,
  BLUEPRINT_WALL_PLUGINS,
  BLUEPRINT_WALL_ZOOM_IN_RATIO,
  BLUEPRINT_WALL_ZOOM_OUT_RATIO,
  BLUEPRINT_WALL_ZOOM_RANGE,
  clampWallZoom,
  mapWallDataToFlowGraph,
  type BlueprintFlowGraphNodeData,
} from "./blueprint-wall-flow-graph-map";
// ─── Wall placement constants（Task 6.1，design「### 3D Wall Placement」） ────
//
// 墙面摆放 / 尺寸常量已正式化到独立纯模块 `blueprint-wall-placement.ts`：单一可读、
// 可复用、可测试的真相源（Task 6.4 可直接 import 断言其稳定，无需渲染 FlowGraph）。
// 墙面比 mission-first monitor（1416 × 243）显著更高，呈 1680 × 760 竖向大画布；
// 与 monitor 互斥渲染、不复制其尺寸常量，mission-first monitor 维持不变（NFR-1）。
import {
  BLUEPRINT_WALL_GRAPH_BACKING_COLOR,
  BLUEPRINT_WALL_GRAPH_BACKING_DEPTH,
  BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT,
  BLUEPRINT_WALL_GRAPH_BACKING_WIDTH,
  BLUEPRINT_WALL_GRAPH_BACKING_Z,
  BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR,
  BLUEPRINT_WALL_GRAPH_HEIGHT,
  BLUEPRINT_WALL_GRAPH_PANEL_Z,
  BLUEPRINT_WALL_GRAPH_POSITION,
  BLUEPRINT_WALL_GRAPH_WIDTH,
} from "./blueprint-wall-placement";
import {
  deriveBlueprintWallProcessData,
  type BlueprintWallArtifactInput,
  type BlueprintWallProcessData,
  type CapabilityOwner,
  type CapabilityStatus,
  type RolePhase,
} from "./blueprint-wall-process-data";

// ─── Component props ─────────────────────────────────────────────────────────

/**
 * 蓝图墙面流程图 HUD 的 props。
 *
 * 镜像 `DeriveBlueprintWallProcessDataInput` 的输入形状：除 `job` 外其余均为可选，
 * 由 `/autopilot` 页面 / 实时 store 切片在 Task 2.2 注入当前 job-scoped 数据。
 */
export interface BlueprintWallProcessGraphHudProps {
  /** 当前蓝图作业；为空时渲染干净的空图状态（Req 4.2）。 */
  job: BlueprintGenerationJob | null | undefined;
  routeSet?: BlueprintRouteSet | null;
  specTree?: BlueprintSpecTree | null;
  effectPreviews?: BlueprintEffectPreviewSnapshot[];
  agentReasoningEntries?: AgentReasoningEntry[];
  capabilityStatuses?: Record<string, CapabilityStatus>;
  capabilityOwners?: Record<string, CapabilityOwner>;
  rolePhases?: Record<string, RolePhase>;
  artifacts?: BlueprintWallArtifactInput[];
  locale?: AppLocale;
}

/**
 * 自定义节点卡片的 G6 节点渲染回调（Req 5.1-5.7）。
 *
 * FlowGraph 默认 `node.type: "react"`（见 `@ant-design/graphs` `flow-graph/options`），
 * 自定义 React 节点通过 `node.style.component: (datum) => ReactElement` 渲染——G6 v5 的
 * `@antv/g6-extension-react` `ReactNode` 把该回调的返回元素挂到节点的 HTML 容器上。
 *
 * `datum` 是 G6 `NodeData`，其 `datum.data` 即 mapper 写入的
 * `BlueprintFlowGraphNodeData`（type/status/title/body/accent/sourceRefs/...）。这里把
 * 它原样交给纯组件 `BlueprintWallGraphNodeCard` 渲染，保证「活图节点」与 SSR 测试用的
 * 是**同一张卡片组件**（Task 4 / Task 4.4 一致）。
 *
 * 工厂签名带 `previewSummary`：preview 节点需要 `wallData.previewSummary` 才能渲染
 * browser/architecture/empty marker（Req 5.5/3.6）。非 preview 节点忽略该参数。
 */
function makeNodeComponent(
  previewSummary: BlueprintWallProcessData["previewSummary"],
  locale: AppLocale | undefined
): (datum: { data?: BlueprintFlowGraphNodeData }) => ReactElement {
  return datum => {
    // datum.data 由 mapper 保证存在；防御性兜底避免回调在异常数据下抛错冒泡进 G6。
    const data = datum.data as BlueprintFlowGraphNodeData;
    return (
      <BlueprintWallGraphNodeCard
        data={data}
        previewSummary={data?.type === "preview" ? previewSummary : undefined}
        locale={locale}
      />
    );
  };
}

export function BlueprintWallProcessGraphHud({
  job,
  routeSet,
  specTree,
  effectPreviews,
  agentReasoningEntries,
  capabilityStatuses,
  capabilityOwners,
  rolePhases,
  artifacts,
  locale,
}: BlueprintWallProcessGraphHudProps) {
  // 单一数据源（Req 3.1）：以 job-scoped 输入记忆派生结果（NFR-2.4），避免每次
  // render 重新计算。其输出经下方 `mapWallDataToFlowGraph(...)` 映射为 FlowGraph 数据。
  const wallData = useMemo(
    () =>
      deriveBlueprintWallProcessData({
        job,
        routeSet,
        specTree,
        effectPreviews,
        agentReasoningEntries,
        capabilityStatuses,
        capabilityOwners,
        rolePhases,
        artifacts,
        locale,
      }),
    [
      job,
      routeSet,
      specTree,
      effectPreviews,
      agentReasoningEntries,
      capabilityStatuses,
      capabilityOwners,
      rolePhases,
      artifacts,
      locale,
    ]
  );

  // 空态判定（Req 4.2）：派生结果无节点 → 走空图数据 + 空态 overlay
  // `BlueprintWallEmptyState`（Task 6.3 已正式化空态视觉）。
  const isEmpty = wallData.nodes.length === 0;

  // 唯一图数据源（Req 3.1/3.2/3.3）：deriver 输出 → 纯映射器 → FlowGraph-ready
  // `{ data: { nodes, edges }, layout }`。同样以 `wallData` 为依赖记忆，避免每次 render
  // 重新映射（NFR-2.4）。`layout` 恒为空数组（关闭 dagre，Req 2.8）。仅在非空态
  // （`!isEmpty`）下才把 `flowGraph.data` 喂给 `<FlowGraph>`（见下方 JSX gate）。
  const flowGraph = useMemo(() => mapWallDataToFlowGraph(wallData), [wallData]);

  // 自定义节点配置（Req 5.1-5.7）：`type: "react"` + `style.component` 回调，把每个
  // 节点渲染成 `BlueprintWallGraphNodeCard`。`size` 与卡片固定宽度对齐，让 G6 给节点
  // 容器留出与卡片一致的盒尺寸（高度给一个保守上限，卡片内部自适应内容）。
  // 以 previewSummary / locale 为依赖记忆回调，保证引用稳定（避免 FlowGraph 每帧重建
  // 节点渲染器）。
  const nodeConfig = useMemo(
    () => ({
      type: "react" as const,
      style: {
        component: makeNodeComponent(wallData.previewSummary, locale),
        size: [CARD_WIDTH, 120] as [number, number],
        ports:
          // 阶段道左→右流动：入/出端口分别贴卡片左/右沿，与曲线水平边对齐（Req 6.5）。
          [{ placement: "left" as const }, { placement: "right" as const }],
      },
    }),
    [wallData.previewSummary, locale]
  );

  // ─── G6 图实例 ref + 外部 fit/zoom 控制（Task 5.3，Req 2.4 / 9.1 / 9.5 / 9.7）───
  //
  // `FlowGraph` 经 forwardRef 把内部 G6 v5 `Graph` 实例转发出来（见
  // `@ant-design/graphs` `FlowGraph` 类型：`RefAttributes<Graph>`）。我们用
  // `ComponentRef<typeof FlowGraph>` 取得该 ref 类型，**无需**直接 import `@antv/g6`
  // 运行时/类型（与同目录 map 模块保持一致的「不拉传递依赖」口径）。
  //
  // 由于 Task 1.4 spike 已禁用画布内 pan/zoom（transform 下指针 hit-testing 不可靠），
  // fit/zoom 全部走这里的命令式调用：右上角外部按钮点击 → 经 ref 调 `graph.fitView()` /
  // `graph.zoomTo(...)`。缩放目标先用 `clampWallZoom` 夹紧到 wall-safe 区间（与
  // `zoomRange` 双保险，Req 9.7）。
  const graphRef = useRef<ComponentRef<typeof FlowGraph> | null>(null);

  const handleFitView = useCallback(() => {
    // fitView 在空图 / 布局未测量时可能 reject；吞掉异常避免冒泡到 R3F 渲染树。
    void graphRef.current?.fitView?.();
  }, []);

  const applyZoomRatio = useCallback((ratio: number) => {
    const graph = graphRef.current;
    if (!graph) return;
    // 以当前缩放为基准乘以步进倍率，再夹紧到 wall-safe 区间后绝对设值（zoomTo），
    // 比 zoomBy 更可控：任何路径都不会越过 min/max（Req 9.7）。
    const current = typeof graph.getZoom === "function" ? graph.getZoom() : 1;
    const target = clampWallZoom(current * ratio);
    void graph.zoomTo?.(target);
  }, []);

  const handleZoomIn = useCallback(
    () => applyZoomRatio(BLUEPRINT_WALL_ZOOM_IN_RATIO),
    [applyZoomRatio]
  );
  const handleZoomOut = useCallback(
    () => applyZoomRatio(BLUEPRINT_WALL_ZOOM_OUT_RATIO),
    [applyZoomRatio]
  );

  // ─── Fit view on job (data) change（Task 6.2，Req 2.6 / 9.5） ────────────────
  //
  // 初次渲染铺满取景由 `<FlowGraph autoFit="view">` 负责（每次 `render()` 都按 autoFit
  // 适配）。但 G6 在数据更新后不会自动重新 fit，因此 **job 变化** → `wallData` 重算 →
  // `flowGraph` 重映射后，这里命令式补一次 `graph.fitView()`，让新 job 的图重新铺满
  // 墙面取景（Req 9.5「fit-to-view on initial render and after job changes」）。
  //
  // 依赖 `flowGraph`（映射结果）而非裸 `job`：任何 job-scoped 输入变化都会重算 wallData /
  // flowGraph，从而触发重新 fit；空图（无节点）时跳过，避免对空画布 fit 抛错。fitView
  // 可能在布局尚未测量时 reject，故 `void` 吞掉 promise，异常不冒泡进 R3F 渲染树。
  useEffect(() => {
    if (flowGraph.data.nodes.length === 0) return;
    void graphRef.current?.fitView?.();
  }, [flowGraph]);

  return (
    <group position={BLUEPRINT_WALL_GRAPH_POSITION}>
      {/*
       * 3D 墙板背板（修复「HUD 没贴墙」/ 2026-05-31 用户 QA，第三轮）。
       *
       * 没有这块 3D 网格时，drei `<Html transform>` 的 DOM 面板始终在 WebGL 之前合成，
       * 视觉上像飘在房间里的半透明薄片。这里在同一 group 内渲染一片极薄的 3D 板
       * （0.004m 厚），参与 WebGL 深度测试：
       *  - 背板背面 z = -0.002（世界 -4.810）正好与高墙前墙面齐平 → 视觉上**与墙面贴合**；
       *  - 背板正面 z = +0.002（世界 -4.806）→ DOM HUD（panelZ=0.005）在正面外
       *    仅 0.003m，避免 z-fighting，呈「嵌入式墙挂显示屏」（与墙面齐平、不凸出）。
       *  - 不再叠单独的暗色外框 mesh：上一版 0.04m 厚 + 暗色外框让 HUD 看着像「墙上挂着
       *    的独立设备」，与「与墙面完美贴合」诉求相反。本版直接由背板 + DOM 自身边框
       *    充当屏幕边沿。
       */}
      <mesh position={[0, 0, BLUEPRINT_WALL_GRAPH_BACKING_Z]} receiveShadow>
        <boxGeometry
          args={[
            BLUEPRINT_WALL_GRAPH_BACKING_WIDTH,
            BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT,
            BLUEPRINT_WALL_GRAPH_BACKING_DEPTH,
          ]}
        />
        <meshStandardMaterial
          color={BLUEPRINT_WALL_GRAPH_BACKING_COLOR}
          roughness={0.92}
          metalness={0.04}
        />
      </mesh>

      <Html
        transform
        position={[0, 0, BLUEPRINT_WALL_GRAPH_PANEL_Z]}
        center
        // occlude={true}：让 DOM 受 WebGL 深度遮挡——当摄像机视角下 backing mesh 在
        // HUD 之前（如人物从右侧绕到墙后），DOM 会被正确隐藏，不再透出墙面。这是让
        // HUD 真正「装在墙上」的关键。
        occlude
        distanceFactor={BLUEPRINT_WALL_GRAPH_DISTANCE_FACTOR}
        style={{
          pointerEvents: "auto",
          width: BLUEPRINT_WALL_GRAPH_WIDTH,
          height: BLUEPRINT_WALL_GRAPH_HEIGHT,
        }}
      >
        {/* 浅色画布外壳：完全不透明，让 HUD 视觉上是「显示器屏幕」而不是磨砂玻璃片。 */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            borderRadius: 6,
            background:
              "linear-gradient(180deg, rgb(248,250,252), rgb(237,241,247))",
            border: "1px solid rgb(203,213,225)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.62), inset 0 0 0 1px rgba(148,163,184,0.18)",
          }}
        >
          {/*
           * Transform interaction spike (Task 1.4) decision:
           *
           * drei `<Html transform>` 给这层 DOM 画布套了 CSS transform（scale/rotate
           * 以贴合 3D 墙面）。G6 v5 的 canvas 平移（`drag-canvas`）和缩放
           * （`zoom-canvas`）依赖**屏幕空间的 pointer/client 坐标**做 hit-testing，
           * 而事件坐标在 transform 之后与画布坐标不再线性对应，墙面内的指针手势
           * 因此不可靠（拖拽/缩放命中点会漂移）。
           *
           * 据 Req 9.9 采取保守锁定：本首版**禁用 canvas pan/zoom**，墙面只用
           * 「fitted / 非交互画布」视图——`autoFit="view"` 负责初始铺满取景，
           * fit/zoom 改由 Task 5.3 的**外部墙面按钮**命令式调用 graph API 实现，
           * 不依赖 transform 空间内的指针手势。
           *
           * 实现手段：`behaviors={[]}` 显式覆盖 FlowGraph 默认的
           * `[{ type: "zoom-canvas" }, { type: "drag-canvas" }]`（来自
           * `@ant-design/graphs` COMMON_OPTIONS）。空数组即「纯观察」交互集——
           * 不含 pan/zoom，也不含 drag-element / create-edge（FlowGraph 默认本就没有
           * 这两项），同时满足 Req 9.2/9.3/9.4 的「不可编辑、不可连边」安全默认。
           *
           * 若 Task 7.3 浏览器 QA 证明 transform 空间内手势其实可用，可再放开为
           * 受限的 `['drag-canvas', 'zoom-canvas']` 并约束 min/max zoom。
           */}
          {/* Live 数据图：映射后的节点/边作为唯一数据源透传给 FlowGraph。
              **空态（isEmpty）下完全不渲染 `<FlowGraph>`**（Fix 3）：`@ant-design/graphs`
              的 `BaseGraph` 用 `isEmpty(options.data)` 判断是否挂载，而
              `isEmpty({ nodes: [], edges: [] })` 为 `false`，传空 data 仍会初始化
              G6/Graphin 画布与 minimap 插件，违背「干净空态、不挂载图」契约。因此这里直接
              在 JSX 层 gate：`!isEmpty` 才渲染图，空态只由下方 `BlueprintWallEmptyState`
              文案 overlay 兜底。 */}
          {isEmpty ? null : (
            <FlowGraph
              ref={graphRef}
              data={flowGraph.data}
              node={nodeConfig}
              layout={BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT}
              autoFit="view"
              behaviors={[]}
              plugins={BLUEPRINT_WALL_PLUGINS}
              zoomRange={BLUEPRINT_WALL_ZOOM_RANGE}
              width={BLUEPRINT_WALL_GRAPH_WIDTH}
              height={BLUEPRINT_WALL_GRAPH_HEIGHT}
            />
          )}

          {/*
           * 右上角外部 fit/zoom 控件（Task 5.3，Req 2.4 / 9.1 / 9.5 / 9.7）。
           *
           * 因 Task 1.4 spike 禁用了画布内 pan/zoom（transform 下指针 hit-testing 不可靠），
           * fit/zoom 改由这组按钮命令式驱动同一张图（经 `graphRef` 调 G6 API）。位置贴
           * 右上角，参考图右上控件位；`pointerEvents: "auto"` 让按钮可点击（与遥测栏 / console
           * 的 `none` 不同，本控件需要交互）。空图时禁用控件，避免对空画布 fit/zoom。
           *
           * 与右下 minimap（`position: "right-bottom"`）错位（一个右上、一个右下），互不遮挡。
           */}
          <div
            style={{
              position: "absolute",
              top: 22,
              right: 22,
              pointerEvents: "auto",
              zIndex: 3,
            }}
          >
            <BlueprintWallGraphControls
              onZoomOut={handleZoomOut}
              onZoomIn={handleZoomIn}
              onFitView={handleFitView}
              disabled={isEmpty}
              locale={locale}
            />
          </div>

          {/*
           * 左侧遥测栏（Task 5.1，Req 7.1 / 7.2 / 7.3）。
           *
           * 绝对定位浮于画布左侧（参考图：左侧竖向计数栏）。消费唯一数据源
           * `wallData.metrics`，缺失字段渲染为 muted 占位 `--`，不臆造数值。
           * 当前 deriver 的 token/source/remaining/time 恒为 `null`，故首版四项均为占位。
           *
           * `pointerEvents: "none"` 让遥测栏不拦截墙面图的指针事件；栏体本身也只读，
           * 无需交互。位置贴左上、留出与画布边的安全间距，避免覆盖关键图内容
           * （Req 7.8 overlay 不外溢墙面 + 不遮挡核心图内容）。
           */}
          <div
            style={{
              position: "absolute",
              top: 22,
              left: 22,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <BlueprintWallMetricsRail
              metrics={wallData.metrics}
              locale={locale}
            />
          </div>

          {/*
           * 底部 console overlay（Task 5.2，Req 7.4 / 7.5 / 7.6 / 7.7）。
           *
           * 绝对定位贴墙面底沿（参考图：底部流程 console 条）。消费唯一数据源
           * `wallData.consoleLines`，空时渲染空 console 壳、非空时渲染各行；行数已由
           * deriver 端 `maxConsoleLines` 截断（默认 8），此处不再二次扩展（Req 7.7）。
           *
           * `pointerEvents: "none"` 让 console 不拦截墙面图的指针事件；overlay 本身只读。
           * 左侧留出与遥测栏一致的安全间距、右侧留出 minimap（Task 5.3）的预留位，限定
           * 在墙面底部带内，避免覆盖 fit view 下的关键图内容（Req 7.6 / overlay 不外溢
           * 墙面 Req 7.8）。
           */}
          <div
            style={{
              position: "absolute",
              left: 22,
              right: 232,
              bottom: 18,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <BlueprintWallConsoleOverlay
              consoleLines={wallData.consoleLines}
              locale={locale}
            />
          </div>

          {/*
           * 空态 overlay（Task 6.3 / Fix 3，Req 4.2 / 10.6）。
           *
           * 无活动蓝图作业（deriver 产出零节点）时，上方 `<FlowGraph>` **完全不渲染**
           * （见上方 `isEmpty ? null : <FlowGraph .../>` gate，避免空 data 仍初始化
           * G6/Graphin 画布），由这块**干净空态** overlay 视觉收尾：浅色画布上居中的
           * 本地化短文案，明确「暂无进行中的蓝图作业」。**不**落任何 mission-first 兜底数据（无终端日志 /
           * 截图 / 任务摘要 / 臆造节点边）——空态由 deriver 的 job 隔离保证（无 job → 零节点
           * → 空图），本组件只是其视觉收尾。透传 `wallData.emptyReason` 供测试断言空态来源。
           */}
          {isEmpty ? (
            <BlueprintWallEmptyState
              reason={wallData.emptyReason}
              locale={locale}
            />
          ) : null}
        </div>
      </Html>
    </group>
  );
}
