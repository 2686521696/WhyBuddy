/**
 * 画布档：这一轮产出的**所有页面并排摊在一张无限画布上**，可平移、可缩放、
 * 可进板交互。位置在顶栏档位组的第一片（画布 / 页面 / 代码）。
 *
 * ## 为什么要它（2026-08-25 用户提的）
 *
 * 页面档一次只看得见一页，而 spec-first 一轮交五页。"这个应用长什么样"
 * 是个**整体**问题：五页的版式一不一致、配色是不是一套、导航有没有断，
 * 一页一页翻是看不出来的——翻到第四页时第一页长什么样已经忘了。
 * 同类工具（Stitch / TRAE Design / Onlook / v0）全都有这一档，就是这个原因。
 *
 * ⚠ 画布**不替代**页面档。页面档是"用这个应用"，画布是"看这套应用"。
 *   两个都留着，这不是重复：页面档有点选编辑、透视、角色切换，画布有全局。
 *
 * ## 底座选 React Flow，不自己写 d3-zoom
 *
 * 仓里已经有 @xyflow/react（SystemLinkageGraph / WorkflowGraph /
 * EntityRelationGraph 三处在用），平移缩放、fitView、minimap、
 * 触控板双指与 ctrl+滚轮的分流全都是它现成的。自己写这一套要踩的坑
 * （缩放锚点漂移、触控板惯性、pinch 与 wheel 分不清）Onlook 的
 * canvas/index.tsx 里那句 `TODO: Debug where this offset is coming from`
 * 就是活证据——他们自己写的，锚点至今在漂。
 *
 * ## iframe 会吞掉画布手势 —— 必须盖一层手势层
 *
 * 这是本档唯一的**结构性**坑，第一版就踩了：滚轮停在画板上时缩放整个失灵。
 * 原因不是 React Flow 的问题——**wheel 事件进了 iframe 的文档，根本没冒泡
 * 到父页面**。同源不同源都一样，iframe 是独立的事件目标。
 *
 * 解法是 Onlook 的做法（apps/web/client/.../canvas/frame/gesture.tsx）：
 * 每块画板上盖一张 `absolute inset-0 bg-transparent` 的透明层，事件落在父
 * 文档里，正常冒泡给 React Flow。只有"进板"之后才把这层撤掉，让 iframe
 * 拿回点击权。
 *
 * ⚠ 别想着用 `pointer-events:none` 给 iframe 代替这层。那样确实能平移，
 *   但进板之后要一个一个把它加回来，而且 hover 态在切换的那一帧会闪。
 *   盖一层是加法，撤一层是减法，减法更不容易漏。
 *
 * ## 挂载是懒的，卸载不是
 *
 * 画板进入视口（含 MOUNT_MARGIN 余量）才挂 HtmlAppSurface；**挂上之后不再
 * 卸**。理由是 iframe 重挂要重写 srcdoc + 等 Tailwind + 重新 applyBindings，
 * 真机 300~600ms，来回平移会看到白板闪。一轮页面数是个位数（真机最多见过
 * 8 页），全挂上也扛得住。
 *
 * ⚠ 如果哪天单轮页数上到 20+，这里要改成真剔除（出视口就卸），届时请连同
 *   MOUNT_MARGIN 一起重新量，别只改一个数。
 *
 * ## fail-open
 *
 * 画布是**增强类**（第七条纪律）：它自己炸了不许拖垮主链路。外面套
 * AppStageErrorBoundary，炸了收进降级卡并明确指路"切回页面档"——
 * 但**不自动切**。自动切就是本仓最恨的那个形状：同一个入口两种面孔，
 * 而且换脸发生在用户看不见的地方。
 */

import React from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minus, MousePointerClick, Plus, Scan } from "lucide-react";

import { HtmlAppSurface } from "./html-app-surface";
import { specPageViewport } from "./canvas-scale";
import { findDevicePreset, loadDevicePresetId } from "./device-presets";
import { STAGE_FRAME_SHADOW } from "./stage-frame-style";
import { deriveBindingSource } from "./derive-binding-source";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  artboardLabel,
  labelCounterScale,
  layoutArtboards,
  shouldMountBoard,
  type ArtboardBox,
} from "./canvas-board-layout";
import type { SpecPageLive } from "./SpecPageLiveStage";
import type { ActionGates, BindingActionEvent } from "./html-binding-runtime";
import type { RuntimeState } from "./live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

export interface SpecPageCanvasStageProps {
  pages: SpecPageLive[];
  /** 还在推演中：页面会陆续到达，标题条上如实说"还在画"。 */
  running?: boolean;
  model?: FiveSystemModel | null;
  runtime?: RuntimeState | null;
  gates?: ActionGates;
  onAction?: (event: BindingActionEvent) => void;
  onHoverBinding?: (
    info: { attr: string; value: string; el: Element } | null
  ) => void;
  /** 选中的画板 = 当前页（透视面板跟着它切片）。 */
  activePageId?: string | null;
  onActivePageChange?: (pageId: string) => void;
  /** 「在页面档打开」：把这一页送回单页舞台。 */
  onOpenInPageView?: (pageId: string) => void;
  /** 说明行右侧（角色切换）。跟页面档同一个位置。 */
  metaTrailing?: React.ReactNode;
  className?: string;
}

interface ArtboardData extends Record<string, unknown> {
  page: SpecPageLive;
  box: ArtboardBox;
  index: number;
  label: string;
  fillPhone: boolean;
}

/** 进板之后 iframe 才拿回点击权；没进板时手势层挡着。 */
interface CanvasCtx {
  enteredPageId: string | null;
  activePageId: string | null;
  source: ReturnType<typeof deriveBindingSource>;
  gates?: ActionGates;
  onAction?: (event: BindingActionEvent) => void;
  onHoverBinding?: SpecPageCanvasStageProps["onHoverBinding"];
  onSelect: (pageId: string) => void;
  onEnter: (pageId: string) => void;
  onNavigate: (pageId: string) => void;
  onOpenInPageView?: (pageId: string) => void;
}

const CanvasContext = React.createContext<CanvasCtx | null>(null);

/** 无模型时的空数据源。`deriveBindingSource(null, null)` 本身就是纯的，
 *  比在渲染处手搓一个 `{} as never` 强——那种写法一旦 BindingSource 加字段
 *  就会在运行期而不是编译期炸。 */
const EMPTY_SOURCE = deriveBindingSource(null, null);

/**
 * fitView 的留白。⚠ React Flow 把它当**外接盒的乘数**（bounds × (1+padding)），
 * 不是视口的百分比——写 0.14 是"盒子四周各留 7% 盒宽"，不是"视口各留 14%"。
 * 列数已经按容器长宽比配过了，两轴都贴得紧，留白直接吃缩放，所以取小值。
 */
const FIT_PADDING = 0.08;

/**
 * 画板本体。
 *
 * ⚠ 这里**不做任何缩放**：宽高就是设计分辨率原值，缩放整个交给 React Flow
 *   的 viewport transform。两级缩放叠加会让放大后的字比页面档还糊
 *   （见 canvas-board-layout 头注的"三套坐标"）。
 */
function ArtboardNode({ data, selected }: NodeProps<Node<ArtboardData>>) {
  const ctx = React.useContext(CanvasContext);
  const { page, box, index, label, fillPhone } = data;

  // 自己订阅视口：只有**这一块**的可见性翻面时才重渲染，平移不会把
  // 所有画板一起拖着重渲染。选择器返回布尔值，React Flow 的浅比较即够。
  const inRange = useStore(
    React.useCallback(
      s =>
        shouldMountBoard(
          box,
          { x: s.transform[0], y: s.transform[1], zoom: s.transform[2] },
          { width: s.width, height: s.height }
        ),
      [box]
    )
  );
  const zoom = useStore(s => s.transform[2]);

  // 挂上就不再卸（见文件头注）。用 ref 记住"曾经进过视口"。
  const everInRange = React.useRef(false);
  if (inRange) everInRange.current = true;
  const mounted = everInRange.current;

  const entered = ctx?.enteredPageId === page.pageId;
  const isActive = ctx?.activePageId === page.pageId;
  const labelScale = labelCounterScale(zoom);

  return (
    <div
      className="relative"
      style={{ width: box.w, height: box.h }}
      data-testid="sliderule-canvas-artboard"
      data-page-id={page.pageId}
      data-entered={entered ? "1" : undefined}
      data-mounted={mounted ? "1" : "0"}
    >
      {/* 标题条：画板**上方**，反缩放保持可读（Figma/tldraw 同款——画板名
          属于编辑器 chrome，不属于被缩放的内容）。 */}
      <div
        className="absolute left-0 flex origin-bottom-left cursor-default select-none items-center gap-1.5 whitespace-nowrap"
        style={{
          bottom: box.h + 10,
          transform: `scale(${labelScale})`,
        }}
        onDoubleClick={e => {
          e.stopPropagation();
          ctx?.onEnter(page.pageId);
        }}
      >
        <span
          className={`text-[13px] font-medium ${
            isActive ? "text-[#1677ff]" : "text-stone-500"
          }`}
          data-testid="sliderule-canvas-artboard-label"
        >
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-stone-400">
          {index + 1}
        </span>
        {page.missing ? (
          <span
            className="rounded bg-[#FDF6F1] px-1.5 py-px text-[10px] font-medium text-[#C05621]"
            data-testid="sliderule-canvas-artboard-missing"
          >
            未通过校验
          </span>
        ) : page.bound ? null : (
          <span className="rounded bg-[#f4f4f5] px-1.5 py-px text-[10px] text-stone-400">
            尚未接数据
          </span>
        )}
        {entered ? (
          <span className="rounded bg-[#1677ff] px-1.5 py-px text-[10px] font-medium text-white">
            已进入 · Esc 退出
          </span>
        ) : null}
      </div>

      {/* 画板白底。选中描边用品牌蓝，跟顶栏「透视」「点选编辑」同一支。 */}
      <div
        className="absolute inset-0 overflow-hidden bg-white"
        style={{
          borderRadius: 6,
          boxShadow: STAGE_FRAME_SHADOW,
          outline: entered
            ? "3px solid #1677ff"
            : isActive
              ? "2px solid #1677ff"
              : "none",
          outlineOffset: 2,
        }}
      >
        {mounted ? (
          <HtmlAppSurface
            key={page.pageId}
            html={page.html}
            fillPhone={fillPhone}
            className="bg-white"
            source={ctx?.source ?? EMPTY_SOURCE}
            gates={ctx?.gates}
            onAction={ctx?.onAction}
            onNavigate={pid => ctx?.onNavigate(pid)}
            onHoverBinding={entered ? ctx?.onHoverBinding : undefined}
          />
        ) : (
          /* 还没进视口：**画轮廓，不留白**。剔除是性能手段，不是可见性判定
             ——缩到看全景时正是最需要看见每块画板在哪的时候。 */
          <div
            className="flex h-full w-full items-center justify-center bg-[#fafafa]"
            data-testid="sliderule-canvas-artboard-placeholder"
          >
            <span className="text-[64px] font-medium text-stone-200">
              {label.slice(0, 8)}
            </span>
          </div>
        )}
      </div>

      {/* 手势层（Onlook 同款）：没进板时盖住 iframe，让滚轮/拖拽落在父文档里
          冒泡给 React Flow。进板之后撤掉，iframe 拿回点击权。
          ⚠ 撤这一层等于把画布手势让给 iframe——这是**双击进板**才该发生的，
            别为了"点着方便"默认撤掉。 */}
      {entered ? null : (
        <div
          className="absolute inset-0"
          data-testid="sliderule-canvas-gesture-shield"
          onClick={e => {
            e.stopPropagation();
            ctx?.onSelect(page.pageId);
          }}
          onDoubleClick={e => {
            e.stopPropagation();
            ctx?.onEnter(page.pageId);
          }}
          title="单击选中 · 双击进入交互 · 右键在页面档打开"
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            ctx?.onOpenInPageView?.(page.pageId);
          }}
        />
      )}
    </div>
  );
}

const nodeTypes = { artboard: ArtboardNode };

function CanvasInner({
  pages,
  running = false,
  model = null,
  runtime = null,
  gates,
  onAction,
  onHoverBinding,
  activePageId = null,
  onActivePageChange,
  onOpenInPageView,
  metaTrailing = null,
}: SpecPageCanvasStageProps): React.ReactElement {
  const flow = useReactFlow();
  const [entered, setEntered] = React.useState<string | null>(null);

  const device = pages.find(p => p.device)?.device;
  const isPhone = device === "phone";
  // 机型只决定**用多大画布看**（观看态），跟后端那个 device 决定"生成什么"
  // 是两件事——见 SpecPageLiveStage 里同一条注释。
  const preset = findDevicePreset(loadDevicePresetId());
  const design = isPhone
    ? { w: preset.width, h: preset.height }
    : { w: specPageViewport(device).w, h: specPageViewport(device).h };

  /**
   * 舞台长宽比 → 列数（见 canvas-board-layout.boardColumns 的头注）。
   *
   * ⚠ 量的是**画布容器**，不是窗口：这块舞台被左侧对话栏挤过，窗口尺寸
   *   跟它没关系。拖分栏时列数会重排，这是有意的——同一份内容在窄舞台上
   *   收成两列、宽舞台上摊成三列，才看得最大。
   */
  const flowHostRef = React.useRef<HTMLDivElement | null>(null);
  const [hostAspect, setHostAspect] = React.useState(0);
  React.useEffect(() => {
    const el = flowHostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r || !(r.width > 0) || !(r.height > 0)) return;
      // 量化到 0.02 一档再进 state：拖分栏时每帧一个新浮点会让排版
      // 每帧重算一次，节点位置抖动。列数本来就是离散的，这里跟着离散。
      const next = Math.round((r.width / r.height) * 50) / 50;
      setHostAspect(prev => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const boxes = React.useMemo(
    () => layoutArtboards(pages, design, hostAspect || undefined),
    [pages, design.w, design.h, hostAspect]
  );

  const source = React.useMemo(
    () => deriveBindingSource(model, runtime),
    [model, runtime]
  );

  const nodes = React.useMemo<Node<ArtboardData>[]>(
    () =>
      boxes.map((box, i) => ({
        id: box.pageId,
        type: "artboard",
        position: { x: box.x, y: box.y },
        // React Flow 要显式尺寸才能算 fitView 与 minimap；不给的话它得等
        // ResizeObserver 量一遍，首帧 fitView 会算在 0×0 上（全屏一团糊）。
        width: box.w,
        height: box.h,
        selected: pages[i]?.pageId === activePageId,
        data: {
          page: pages[i]!,
          box,
          index: i,
          label: artboardLabel(pages[i]!),
          fillPhone: isPhone,
        },
      })),
    [boxes, pages, isPhone, activePageId]
  );

  const select = React.useCallback(
    (pageId: string) => {
      onActivePageChange?.(pageId);
    },
    [onActivePageChange]
  );

  const enter = React.useCallback(
    (pageId: string) => {
      onActivePageChange?.(pageId);
      setEntered(pageId);
      const box = boxes.find(b => b.pageId === pageId);
      if (box) {
        // fitBounds 用 React Flow 自己的容器尺寸算，比我们手算稳（它知道
        // padding 与当前 transform）。自己再算一遍等于两份缩放，必然分叉。
        flow.fitBounds(
          { x: box.x, y: box.y, width: box.w, height: box.h },
          { padding: 0.12, duration: 260 }
        );
      }
    },
    [boxes, flow, onActivePageChange]
  );

  /** 页面自己的左侧菜单点了某一项：画布上滚到那块画板，而不是原地换内容。 */
  const navigate = React.useCallback(
    (pageId: string) => {
      const box = boxes.find(b => b.pageId === pageId);
      if (!box) return;
      onActivePageChange?.(pageId);
      setEntered(pageId);
      flow.fitBounds(
        { x: box.x, y: box.y, width: box.w, height: box.h },
        { padding: 0.12, duration: 260 }
      );
    },
    [boxes, flow, onActivePageChange]
  );

  const ctx = React.useMemo<CanvasCtx>(
    () => ({
      enteredPageId: entered,
      activePageId,
      source,
      gates,
      onAction,
      onHoverBinding,
      onSelect: select,
      onEnter: enter,
      onNavigate: navigate,
      onOpenInPageView,
    }),
    [
      entered,
      activePageId,
      source,
      gates,
      onAction,
      onHoverBinding,
      select,
      enter,
      navigate,
      onOpenInPageView,
    ]
  );

  // Esc 退出进板态。⚠ 只在进板时挂监听——常挂会把 Studio 里其它 Esc
  // 语义（系统屏抽屉）抢掉。
  React.useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEntered(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered]);

  /**
   * 页面数变了（推演中逐页到达）重新适应一次画布。
   *
   * ⚠ 2026-08-25 真机第一版就栽在这里：写的是 `setTimeout(fitView, 60)`，
   *   打开画布档停在 100%——**一屏只看得见一页**，正好把画布要解决的问题
   *   原样保留下来，而且不报错、判据全绿（画板确实渲染了 5 块）。
   *
   *   病因是 fitView 依赖 React Flow 已经量到容器尺寸和节点尺寸。挂载后
   *   60ms 这两样都还可能是 0，fitView 算在 0×0 上就直接放弃，静默返回。
   *   拿墙钟等一个**状态**，是这类 bug 的标准形状。
   *
   *   正确做法是等它自己说"量完了"——但**别用 useNodesInitialized()**，
   *   那条路第二次又栽了（原因写在下面 flowLayoutKey 那处）。判据要直接读
   *   nodeLookup 里每个节点的 measured 尺寸。同时给 <ReactFlow fitView>
   *   兜首帧：只等量完的话，推演中第 2、3 页陆续到达时首帧会闪一下空画布。
   *
   * ⚠ 只认**页数**变化：依赖写成 pages 会让每次填数刷新都把用户手动调好的
   *   视口拽回原位。
   */
  const pageCount = pages.length;
  /**
   * 排版指纹：节点数 + 首行块数（= 列数）。任一变了就重新适应一次画布。
   * 节点还没量完时返回空串——空串不触发 fit（fitView 在没量到尺寸的节点上
   * 会算在 0×0 上，静默返回）。
   *
   * ⚠ 2026-08-25 这里连栽两次，两次的形状都是"判据看着有、其实没通电"：
   *
   *   第一次：指纹从**我自己算的 boxes** 推。列数 3→2 重排之后，effect 跟
   *   nodes prop 在同一次提交里跑，我调 fitView 的那一刻 React Flow 的 store
   *   还是上一帧的位置——**拿自己的状态去问它的问题**。
   *
   *   第二次：改成读 store 了，但守卫写的是 `useNodesInitialized()`。
   *   真机日志（在这行打 console.log 打出来的）：
   *       fit-effect {nodesReady: false, flowLayoutKey: "5:2", did: ""}
   *   它**恒为 false**。因为 v12 的 nodesInitialized 除了尺寸还要
   *   handleBounds，而画板节点没有任何 <Handle>（这画布不画连线）。
   *   于是 effect 每次都早退，屏幕上是 2 列、缩放却是 3 列那次算出来的 12%。
   *   ——用一个"顺便还要求别的东西"的现成布尔值当守卫，是这类静默失效的
   *   标准来源。守卫要**直接问自己真正依赖的那个条件**：节点量完了没有。
   *
   * 想验证这条还通电：在下面 fitView 那行打一句 log，切到画布档看它有没有
   * 打出来。判据 canvas-refit-on-relayout.test.ts 钉的是纯函数那一半。
   */
  const flowLayoutKey = useStore(s => {
    const size = s.nodeLookup.size;
    if (size === 0) return "";
    let firstRow = 0;
    let measured = 0;
    for (const n of s.nodeLookup.values()) {
      if (n.position.y === 0) firstRow++;
      if ((n.measured?.width ?? 0) > 0 && (n.measured?.height ?? 0) > 0)
        measured++;
    }
    if (measured < size) return "";
    return `${size}:${firstRow}`;
  });
  const didFit = React.useRef("");
  React.useEffect(() => {
    if (!flowLayoutKey || didFit.current === flowLayoutKey) return;
    didFit.current = flowLayoutKey;
    flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 });
  }, [flowLayoutKey, flow]);

  const zoom = useStore(s => s.transform[2]);
  const delivered = pages.filter(p => !p.missing).length;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      data-testid="sliderule-canvas-stage"
      data-page-count={pages.length}
      data-entered={entered ?? undefined}
    >
      {/* 说明行：跟页面档同一形制（Primer PageHeader 的 description）。 */}
      <div
        className="flex shrink-0 items-center gap-2 px-0.5 text-[11px] leading-4 text-stone-400"
        data-testid="sliderule-canvas-meta"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="font-mono tabular-nums">
            {design.w}×{design.h} · {Math.round(zoom * 100)}%
          </span>
          <span aria-hidden>·</span>
          <span data-testid="sliderule-canvas-page-count">
            {running ? `界面生成中 ${delivered} 页` : `共 ${delivered} 页`}
          </span>
          <span aria-hidden>·</span>
          <span>{entered ? "已进入画板，Esc 退出" : "双击画板进入交互"}</span>
        </div>
        {metaTrailing ? (
          <div
            className="ml-auto shrink-0"
            data-testid="sliderule-canvas-meta-trailing"
          >
            {metaTrailing}
          </div>
        ) : null}
      </div>

      <div
        ref={flowHostRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-[#e9edf2] bg-[#fbfbfc]"
      >
        <CanvasContext.Provider value={ctx}>
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            /* Figma / Stitch 的滚动语义：滚轮=平移，ctrl/⌘+滚轮=缩放，
               触控板双指=平移、捏合=缩放。zoomOnScroll 开着的话（React Flow
               默认）滚一下就整屏跳缩放，跟同类工具全反。 */
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            panOnDrag={[0, 1, 2]}
            selectionOnDrag={false}
            nodesConnectable={false}
            /* ⚠ **别把 elementsSelectable 关掉。** 2026-08-25 真机踩到：
               写了 `elementsSelectable={false}` + `nodesDraggable={false}`
               之后，React Flow 判定这节点没人要事件，给它挂上
               `pointer-events: none`——于是每块画板上那层手势层**在 DOM 里、
               数量也对（5 块画板 5 层），但一个事件都收不到**。
               单击选中、双击进板全是哑的，而判据"手势层存在"照样全绿。
               真机 elementFromPoint(画板中心) 返回的是 .react-flow__pane，
               这一行才是证据。
               平移缩放当时看着还是好的，但那是**因为节点整个不吃事件**，
               跟手势层没关系——修好之后手势层才真的开始干它的活。 */
            /* ⚠ 画板**不可拖动**，这是拿真机换来的取舍，别顺手改回 true。
               2026-08-25 第一版给标题条挂了 dragHandle 想支持重排，真机实测
               D 项失败：**画板本体上按住拖拽不平移画布**。因为只要节点是
               draggable，React Flow 就会在节点上接管 mousedown，事件到不了
               d3-zoom（dragHandle 只决定"从哪儿开始拖"，不决定"要不要拦"）。
               而画布上最高频的手势就是按住拖着看——为了一个"能重排画板"
               （列数本来就按容器长宽比自动算了）去牺牲它，不划算。 */
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
            onPaneClick={() => setEntered(null)}
            className="bg-transparent"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={28}
              size={1.4}
              color="#d8dde4"
            />
            <MiniMap
              pannable
              zoomable
              ariaLabel="画布缩略图"
              maskColor="rgba(244,244,246,0.72)"
              nodeColor={n => (n.id === activePageId ? "#1677ff" : "#cbd5e1")}
              className="!bottom-3 !right-3 !h-[92px] !w-[148px] overflow-hidden rounded-md border border-[#e9edf2] !bg-white"
            />
          </ReactFlow>
        </CanvasContext.Provider>

        {/* 缩放药丸：位置对齐 Figma/Stitch（画布左下角），读数可点=适应画布。 */}
        <div
          className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-[#e9edf2] bg-white/95 p-1 shadow-sm backdrop-blur"
          data-testid="sliderule-canvas-zoom"
        >
          <button
            type="button"
            onClick={() => flow.zoomOut({ duration: 160 })}
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-[#f4f4f5] hover:text-stone-800"
            aria-label="缩小"
            title="缩小"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 })
            }
            className="min-w-[3.2rem] rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 transition hover:bg-[#f4f4f5]"
            data-testid="sliderule-canvas-zoom-readout"
            title="适应画布（看全所有页面）"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => flow.zoomIn({ duration: 160 })}
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-[#f4f4f5] hover:text-stone-800"
            aria-label="放大"
            title="放大"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-[#e9edf2]" aria-hidden />
          <button
            type="button"
            onClick={() =>
              flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 })
            }
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-[#f4f4f5] hover:text-stone-800"
            aria-label="适应画布"
            title="适应画布"
          >
            <Scan className="h-3.5 w-3.5" />
          </button>
          {activePageId && onOpenInPageView ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-[#e9edf2]" aria-hidden />
              <button
                type="button"
                onClick={() => onOpenInPageView(activePageId)}
                data-testid="sliderule-canvas-open-in-page"
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-stone-600 transition hover:bg-[#f4f4f5] hover:text-stone-800"
                title="把选中的这一页送回页面档（那里有点选编辑与透视）"
              >
                <Maximize2 className="h-3 w-3" />
                在页面档打开
              </button>
            </>
          ) : null}
        </div>

        {/* 空态：一页都还没到。⚠ 不画假画板占位——本仓不允许"看起来有东西"。 */}
        {pages.length === 0 ? (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-400"
            data-testid="sliderule-canvas-empty"
          >
            <MousePointerClick className="h-5 w-5" />
            <span className="text-[12px]">
              {running
                ? "页面还在生成，画好一页就落到这张画布上"
                : "这一轮没有可看的页面"}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 对外入口。ReactFlowProvider 必须在外层：useReactFlow / useStore 都要它，
 * 而画布本体自己就在用（缩放药丸、进板动画）。
 */
export function SpecPageCanvasStage(
  props: SpecPageCanvasStageProps
): React.ReactElement {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${props.className ?? ""}`}
    >
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
