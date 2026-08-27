/**
 * 画布档：这一轮产出的**所有页面并排摊在一张无限画布上**，可平移、可缩放、
 * 可进板交互、可连线、可看属性、可导出，页面引的图也摊在下面。
 * 位置在顶栏档位组的第一片（画布 / 页面 / 代码）。
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
 * ## 连线 / 属性面板 / 右键菜单 / 素材图（2026-08-25 第二轮）
 *
 * 四件事的"数据从哪来"都在 canvas-board-graph.ts 的头注里，尤其是**为什么
 * 连线必须以手画为主**（自动派生在三个真机会话上只有 1/0/0 条，读
 * data-page-id 则是 20 条完全图的毛线团）。动这块之前先读那份。
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
  Handle,
  MarkerType,
  MiniMap,
  type NodeChange,
  Position,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ImageOff,
  Link2,
  Maximize2,
  Minus,
  MousePointerClick,
  PanelRight,
  Plus,
  LayoutGrid,
  RefreshCw,
  Scan,
} from "lucide-react";

import { HtmlAppSurface } from "./html-app-surface";
import { specPageViewport } from "./canvas-scale";
import { findDevicePreset, loadDevicePresetId } from "./device-presets";
import { STAGE_FRAME_FLAT } from "./stage-frame-style";
import { elementPath, type PathStep } from "./element-path";
import { blockIdentity, type BlockIdentity } from "./page-blocks";
import {
  frameRectToNodeRect,
  elementTitle,
  snapshotComputed,
  type Rect,
} from "./canvas-element-edit";
import { closestEditable } from "../../agent-loop/dashboard/ClickEditStage";
import { BINDING_ATTRS as BINDING_ATTR_LIST } from "./html-binding-runtime";
import { deriveBindingSource } from "./derive-binding-source";
import {
  boardPositionsStorageKey,
  isTypingTarget,
  readBoardPositions,
  writeBoardPositions,
  type BoardPosition,
  MAX_ZOOM,
  MIN_ZOOM,
  artboardLabel,
  boardsBounds,
  labelCounterScale,
  labelMaxCssWidth,
  layoutArtboards,
  pickLinkSides,
  shouldMountBoard,
  type ArtboardBox,
} from "./canvas-board-layout";
import {
  ASSET_TILE,
  addManualLink,
  boardFacts,
  deriveDataflowLinks,
  assetUseGroups,
  extractPageAssets,
  layoutAssets,
  planAssetReplacement,
  linkToRefineInstruction,
  manualLinksStorageKey,
  readManualLinks,
  removeLink,
  writeManualLinks,
  type BoardLink,
  type AssetUseGroup,
  type CanvasAsset,
} from "./canvas-board-graph";
import { exportBoardHtml, exportBoardPng } from "./canvas-board-export";
import { CanvasInspector } from "./CanvasInspector";
import { AssetReplacePanel } from "./AssetReplacePanel";
import { CanvasElementPanel } from "./CanvasElementPanel";
import { updateAppPage } from "../../agent-loop/dashboard/app-store-client";
import { CanvasBoardMenu } from "./CanvasBoardMenu";
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
  /** 手画连线按会话存档；不传的话存在 anon 键下（换会话会串味，宿主务必传）。 */
  sessionId?: string;
  /**
   * 这个会话背后已落库的应用 id。换图要写回 `pages_json`，没有它就换不了。
   *
   * ⚠ 会话不一定已经落库（推演没跑完/还没存），所以这里是可空的，
   *   而且**不能拿它当"功能坏了"处理**——要如实说"还没存成应用，先跑完一轮"。
   */
  appId?: string | null;
  /** 换图落库成功后把新 HTML 交回宿主（宿主用它更新 pageOverrides，
   *  否则画布上还是旧图：存了但看着没变，本仓最忌的那种）。 */
  onPagesReplaced?: (patch: Record<string, string>) => void;
  /**
   * Ctrl/⌘+Click 画板里的某个元素 → 宿主切到点选编辑，带上这一页和这个元素。
   *
   * ⚠ path 可能是 null：点在空白处、或点到的是**运行时克隆出来的**表格行
   *   （源 HTML 里没有对应元素）。宿主要如实说"定位不到"，别静默选别的。
   */
  /** 说明行右侧（角色切换）。跟页面档同一个位置。 */
  metaTrailing?: React.ReactNode;
  className?: string;
}

/**
 * 把一句话填进输入框并聚焦。
 *
 * ⚠ 用的是仓里**已有**的 `sliderule:fill-prompt` 事件（ComposerDock 在听，
 *   空态示例卡片走的就是它），不新造一条 prop 链路。这条也决定了这个功能的
 *   边界：**只填不发**。一轮推演是几分钟 + 真金白银的 token，右键点一下就
 *   开跑是敌意设计——按不按回车是用户的事。
 */
function fillComposer(text: string): void {
  window.dispatchEvent(
    new CustomEvent("sliderule:fill-prompt", { detail: { text } })
  );
}

interface ArtboardData extends Record<string, unknown> {
  page: SpecPageLive;
  box: ArtboardBox;
  index: number;
  label: string;
  fillPhone: boolean;
}

interface AssetData extends Record<string, unknown> {
  asset: CanvasAsset;
  w: number;
  h: number;
}

/**
 * 从画布上的一次点击，取出 iframe 里被点到的那个元素的结构路径。
 *
 * ⚠ 取不到就回 null，**不猜**。调用方据此如实告诉用户"这个位置定位不到"，
 *   而不是退而求其次选个别的元素——选错了用户改完保存才发现，代价是内容被
 *   改坏。iframe 是 srcdoc 同源，contentDocument 拿得到；拿不到（还没加载完 /
 *   被浏览器策略挡了）也是回 null。
 */
/**
 * 一个高亮框。hover 是细虚线，select 是实线 + 元素名标签——两种状态一眼能分开
 * （GrapesJS/Figma 都是这个区分法：悬停轻、选中重）。
 *
 * ⚠ 描边宽度和标签要**反缩放**：画布缩到 25% 时 1px 的框只有 0.25px，
 *   亚像素直接看不见——本仓在点阵那次已经栽过同一个坑。
 */
function ElementSpot({
  rect,
  kind,
  label,
}: {
  rect: Rect;
  kind: "hover" | "select";
  label?: string;
}): React.ReactElement {
  const zoom = useStore(s => s.transform[2]);
  const inv = zoom > 0 ? 1 / zoom : 1;
  const color = kind === "select" ? "#1677ff" : "#7aa2ff";
  return (
    <div
      className="pointer-events-none absolute"
      data-testid={`sliderule-canvas-element-${kind}`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        outline: `${(kind === "select" ? 2 : 1.5) * inv}px ${
          kind === "select" ? "solid" : "dashed"
        } ${color}`,
        outlineOffset: 0,
        background:
          kind === "select" ? "rgba(22,119,255,0.06)" : "rgba(22,119,255,0.04)",
        borderRadius: 2 * inv,
      }}
    >
      {label ? (
        <span
          className="absolute whitespace-nowrap rounded px-1 py-px text-white"
          style={{
            left: 0,
            top: 0,
            transform: `scale(${inv}) translateY(-100%)`,
            transformOrigin: "top left",
            background: color,
            fontSize: 11,
            marginTop: -2 * inv,
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 高亮框上那行字。
 *
 * 悬停只报**块**（「表格·待指派工单」），选中报「块 › 元素」。
 *
 * ⚠ 不在任何块里的元素（壳里的菜单、面包屑）报空，让 ElementSpot 不画标签
 *   ——不是报「未知块」。没有块身份和"块叫未知"是两回事。
 */
export function blockTag(p: PickedElement | null): string | undefined {
  if (!p?.block) return undefined;
  return `${p.block.kindLabel}·${p.block.label}`;
}

/** 选中态的标签：有块就「块 › 元素」，没块就只报元素。 */
export function pickTitle(p: PickedElement): string {
  const b = blockTag(p);
  return b ? `${b} › ${p.title}` : p.title;
}

/** 两次拾取是不是同一个元素（同页同路径）。悬停时用它收敛重渲。 */
export function samePick(
  a: PickedElement | null,
  b: PickedElement | null
): boolean {
  if (!a || !b) return a === b;
  if (a.pageId !== b.pageId) return false;
  if (a.path.length !== b.path.length) return false;
  return a.path.every(
    (s, i) => s.tag === b.path[i]!.tag && s.index === b.path[i]!.index
  );
}

/** 画布上选中/悬停到的那个元素——路径 + 在画板节点内的矩形 + 一点显示信息。 */
export interface PickedElement {
  pageId: string;
  path: PathStep[];
  /** 画板节点内坐标（React Flow 的平移缩放由节点自己带走） */
  rect: Rect;
  tag: string;
  title: string;
  /**
   * 这个元素属于**哪一块**（`data-block`，Python 那边划的）。不在任何块里
   * （壳里的菜单、面包屑）就是 null——**不就近兜底**，那会让用户以为自己
   * 选中了正文里的某一块。
   */
  block: BlockIdentity | null;
  /** 选中那一刻元素**真实**的样子（计算样式）。面板拿它当显示底值。 */
  computed: Record<string, string>;
}

/**
 * 从画布上的一次鼠标事件，取出 iframe 里那个元素。
 *
 * ⚠ 手势层盖在 iframe 上，事件落不到页面元素——所以**透过手势层去问 iframe**：
 *   把落点换算成 iframe 内坐标，用 elementFromPoint 取真正被指到的那个。
 *   让手势层在按住 Ctrl 时 pointer-events:none 也能做到，但那样平移/缩放/
 *   右键会在按键期间一起失灵。
 *
 * ⚠ 取不到就回 null，**不猜**。调用方据此不画高亮，而不是画一个位置存疑的框。
 *
 * ⚠ "什么算一个可编辑元素"用的是点选编辑那份 closestEditable——同一条规则，
 *   不在这里另写一套（各写一套的话两边选中的东西会不一样，还不报错）。
 */
function pickElementAtPoint(
  e: React.MouseEvent,
  pageId: string
): PickedElement | null {
  const shield = e.currentTarget as HTMLElement;
  const host = shield.parentElement;
  const frame = host?.querySelector("iframe");
  if (!frame) return null;
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return null; // 跨源，理论上不会走到（srcdoc 同源）
  }
  if (!doc?.body) return null;
  const box = frame.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const docW = doc.documentElement.clientWidth || frame.clientWidth;
  const docH = doc.documentElement.clientHeight || frame.clientHeight;
  if (!(docW > 0) || !(docH > 0)) return null;
  const hit = doc.elementFromPoint(
    ((e.clientX - box.left) / box.width) * docW,
    ((e.clientY - box.top) / box.height) * docH
  );
  if (!hit || hit === doc.body || hit === doc.documentElement) return null;
  const el = closestEditable(hit) ?? (hit as HTMLElement);
  const path = elementPath(el, doc.body);
  if (!path) return null;
  const r = el.getBoundingClientRect();
  /*
   * ⚠ 节点尺寸要用 **offsetWidth/offsetHeight（布局尺寸）**，不能用
   *   getBoundingClientRect（屏幕尺寸）。2026-08-25 真机踩到：
   *
   *     iframe 布局 1920×1080，屏幕 488×274，比值 0.254 = React Flow 的 zoom
   *
   *   高亮框画在 React Flow 的节点里，React Flow 已经会乘一次 zoom；这里再拿
   *   屏幕尺寸算比例等于**又除了一次**，框被缩两次。真机对过账：元素屏幕
   *   14×5，框画成 4×1（14×0.254≈3.5），正是这个平方误差。
   */
  const rect = frameRectToNodeRect(
    { left: r.left, top: r.top, width: r.width, height: r.height },
    { width: docW, height: docH },
    { width: frame.offsetWidth, height: frame.offsetHeight }
  );
  if (!rect) return null;
  const attrs = BINDING_ATTR_LIST.map(a =>
    el.hasAttribute(a) ? `${a}="${el.getAttribute(a)}"` : ""
  ).find(Boolean);
  return {
    pageId,
    path,
    rect,
    computed: snapshotComputed(el, doc.defaultView),
    block: blockIdentity(el),
    tag: el.tagName.toLowerCase(),
    title: elementTitle(
      el.tagName.toLowerCase(),
      el.textContent || "",
      attrs || ""
    ),
  };
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
  onBoardMenu: (pageId: string, x: number, y: number) => void;
  /** Ctrl/⌘+Click 选中画板里的某个元素（右侧面板变成它的编辑器）。
   *  null = 宿主没给 appId（这一轮还没落库），那就不接这条手势。 */
  onPickElement: ((picked: PickedElement | null) => void) | null;
  /** 当前选中的元素——画板据此画选中框（只画自己那一页的）。 */
  picked: PickedElement | null;
  /** 连线态：等着点第二块画板 */
  linkFrom: string | null;
  /** 连线态开着（画板边缘露出连线把手） */
  linkMode: boolean;
  /** 导出要拿到画板 DOM。挂载时登记，卸载时注销。 */
  registerBoardEl: (pageId: string, el: HTMLDivElement | null) => void;
  /** 素材高亮：点了素材卡，用到它的页面描边 */
  highlightPageIds: readonly string[];
  /** 点了素材卡：记下来给画板描边（"这张图哪几页在用"） */
  onSelectAsset: (asset: CanvasAsset) => void;
  /** 打开换图面板。null = 宿主没给 appId，卡片上就不摆这颗按钮。 */
  onReplaceAsset: ((asset: CanvasAsset) => void) | null;
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

/** 连线的两种来源用两种画法：派生=灰实线，手画=蓝虚线。 */
const EDGE_STYLE = {
  dataflow: { stroke: "#94a3b8", strokeWidth: 2 },
  manual: { stroke: "#1677ff", strokeWidth: 2, strokeDasharray: "8 6" },
} as const;

/**
 * 画板本体。
 *
 * ⚠ 这里**不做任何缩放**：宽高就是设计分辨率原值，缩放整个交给 React Flow
 *   的 viewport transform。两级缩放叠加会让放大后的字比页面档还糊
 *   （见 canvas-board-layout 头注的"三套坐标"）。
 */
function ArtboardNode({ data }: NodeProps<Node<ArtboardData>>) {
  /** 按住 Ctrl 滑过时高亮的那个元素（只高亮，不选中）。 */
  const [hover, setHover] = React.useState<PickedElement | null>(null);
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
  const isLinkSource = ctx?.linkFrom === page.pageId;
  const highlighted = ctx?.highlightPageIds.includes(page.pageId) ?? false;
  const labelScale = labelCounterScale(zoom);

  const outline = entered
    ? "3px solid #1677ff"
    : isLinkSource
      ? "3px dashed #1677ff"
      : highlighted
        ? "3px solid #C05621"
        : isActive
          ? "2px solid #1677ff"
          : "none";

  return (
    <div
      className="relative"
      style={{ width: box.w, height: box.h }}
      data-testid="sliderule-canvas-artboard"
      data-page-id={page.pageId}
      data-entered={entered ? "1" : undefined}
      data-mounted={mounted ? "1" : "0"}
      ref={el => ctx?.registerBoardEl(page.pageId, el)}
    >
      {/* 连线把手（四条边各一个）。
          ⚠ **永远渲染**，不能"连线态才挂"——React Flow 要靠 handle 的位置
          算边的起终点，把手不在时已有的边会直接画不出来（控制台 #008）。
          所以是常挂 + 连线态才可见可点。

          ⚠ 2026-08-25 真机：`zIndex` 那条**不是样式，是功能**。手势层是
          `absolute inset-0`，在 DOM 里排在把手后面，同一层里后来者居上——
          于是把手看得见（opacity 已经是 1）却**按不下去**，从把手拖出去
          什么都不发生。判据 L1「把手可见」全绿，L2「拖出一条连线」失败，
          又是一次"看着有、其实没通电"。把手必须浮在手势层之上。

          ⚠ 四个都声明成 type="source"，靠 <ReactFlow connectionMode="loose">
          让它们同时能当终点。声明成 source/target 各四个（八个重叠的把手）
          的话，命中的是哪一个取决于 DOM 顺序，拖上去时好时坏。 */}
      {(
        [
          ["t", Position.Top, "translate(-50%, -50%)"],
          ["r", Position.Right, "translate(50%, -50%)"],
          ["b", Position.Bottom, "translate(-50%, 50%)"],
          ["l", Position.Left, "translate(-50%, -50%)"],
        ] as const
      ).map(([id, pos, shift]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          isConnectable={ctx?.linkMode ?? false}
          style={{
            width: 14,
            height: 14,
            background: "#fff",
            border: "3px solid #1677ff",
            opacity: ctx?.linkMode ? 1 : 0,
            pointerEvents: ctx?.linkMode ? "auto" : "none",
            zIndex: 10,
            transform: `${shift} scale(${labelCounterScale(zoom)})`,
          }}
        />
      ))}

      {/* 标题条：画板**上方**，反缩放保持可读（Figma/tldraw 同款——画板名
          属于编辑器 chrome，不属于被缩放的内容）。 */}
      <div
        className="absolute left-0 flex origin-bottom-left cursor-default select-none items-center gap-1.5 overflow-hidden whitespace-nowrap"
        style={{
          bottom: box.h + 10,
          transform: `scale(${labelScale})`,
          // 反缩放的标签必须夹宽度，否则缩小时相邻画板的标题会压在一起
          // （见 labelMaxCssWidth 的注释——素材卡上先炸的，画板只是宽所以晚炸）。
          maxWidth: labelMaxCssWidth(box.w, zoom),
        }}
        onDoubleClick={e => {
          e.stopPropagation();
          ctx?.onEnter(page.pageId);
        }}
      >
        <span
          className={`min-w-0 truncate text-[13px] font-medium ${
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
        {isLinkSource ? (
          <span className="rounded bg-[#1677ff] px-1.5 py-px text-[10px] font-medium text-white">
            连线起点 · 点另一块连上
          </span>
        ) : null}
      </div>

      {/* 画板白底。选中描边用品牌蓝，跟顶栏「透视」「点选编辑」同一支。 */}
      <div
        className="absolute inset-0 overflow-hidden bg-white"
        style={{
          borderRadius: 6,
          boxShadow: STAGE_FRAME_FLAT,
          outline,
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
            /* Ctrl/⌘ + 单击 = **选中**这个元素，右侧面板变成它的编辑器。
               留在画布上，不跳去页面档（2026-08-25 用户裁决，参照 TRAE）。 */
            if (ctx?.onPickElement && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              ctx.onPickElement(pickElementAtPoint(e, page.pageId));
              return;
            }
            ctx?.onSelect(page.pageId);
          }}
          /*
           * 按住 Ctrl 滑过 = **只高亮不选中**（用户原话："鼠标没有按下去的
           * 时候选不中，只是纯高亮"）。GrapesJS 把 hover 和 select 做成两个
           * 独立的 canvas spot，就是这个道理——两种状态不能合成一个。
           *
           * ⚠ 同一个元素不重复 setState（samePick 收敛），否则一路滑过去
           *   会刷出几百次重渲，画布上还挂着 iframe。
           */
          onMouseMove={e => {
            if (!ctx?.onPickElement) return;
            if (!(e.ctrlKey || e.metaKey)) {
              setHover(prev => (prev ? null : prev));
              return;
            }
            const found = pickElementAtPoint(e, page.pageId);
            setHover(prev => (samePick(prev, found) ? prev : found));
          }}
          onMouseLeave={() => setHover(prev => (prev ? null : prev))}
          onDoubleClick={e => {
            e.stopPropagation();
            ctx?.onEnter(page.pageId);
          }}
          title={
            ctx?.onPickElement
              ? "单击选中 · 拖动重排 · 空格+拖动平移 · 双击进入交互 · Ctrl/⌘ 滑过高亮、单击改它 · 右键更多"
              : "单击选中 · 拖动重排 · 空格+拖动平移 · 双击进入交互 · 右键更多"
          }
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            ctx?.onBoardMenu(page.pageId, e.clientX, e.clientY);
          }}
        />
      )}

      {/*
        高亮层（GrapesJS 的 canvas spots 同款：hover 和 select 是两个独立的
        spot，不是一个状态的两种样式）。

        ⚠ 画在**节点里**：画布的平移/缩放由 React Flow 的 transform 自动带走，
          这里只剩画板自身的缩放要算（frameRectToNodeRect）。GrapesJS 要算
          四项是因为它的 spots 容器挂在画布外面。

        ⚠ pointer-events-none 是**功能**：这两个框盖在手势层上面，漏了它
          鼠标一移上去就把 mousemove/click 全吃掉——高亮会闪、点不中。
      */}
      {hover && !samePick(hover, ctx?.picked ?? null) ? (
        <ElementSpot rect={hover.rect} kind="hover" label={blockTag(hover)} />
      ) : null}
      {ctx?.picked && ctx.picked.pageId === page.pageId ? (
        <ElementSpot
          rect={ctx.picked.rect}
          kind="select"
          label={pickTitle(ctx.picked)}
        />
      ) : null}
    </div>
  );
}

/**
 * 素材卡：这套应用引用到的一张图。
 *
 * ⚠ 图是**外链**（真机上多为 placehold.co / flickr）。加载不出来时如实显示
 *   "加载不出来"，不摆一个灰方块假装是图——用户会以为图本身就长那样。
 *   `onError` 那条是这个功能唯一的失败态，别省。
 */
function AssetNode({ data }: NodeProps<Node<AssetData>>) {
  const ctx = React.useContext(CanvasContext);
  const { asset, w, h } = data;
  const zoom = useStore(s => s.transform[2]);
  const [failed, setFailed] = React.useState(false);
  /** 图的**真实像素尺寸**。设计师最想知道的一件事：一张 40×40 的图是不是被
   *  拉成了 banner。只有加载成功才有，加载不出来就不显示（不编）。 */
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const labelScale = labelCounterScale(zoom);
  const labelWidth = labelMaxCssWidth(w, zoom);
  /**
   * 窄到放不下整行时只留**名字**（外加一个占位图小点）。
   *
   * ⚠ 2026-08-25 真机第二次踩：加了宽度上限之后不炸了，但截断把文件名整个
   *   吃掉，三张卡只剩「占位图 5页」「占位图 1页」——**标签还在、信息没了**。
   *   夹宽度只解决了"不重叠"，没解决"读得出来"。名字是识别用的，最后才能丢。
   */
  const compact = labelWidth < 170;

  return (
    <div
      className="relative"
      /*
       * ⚠ 2026-08-25 用户报"换图点了没反应"，真机查出来的根因：
       *   素材节点建的时候写了 `selectable: false`，React Flow 据此给整个
       *   `react-flow__node-asset` 挂 **pointer-events:none**（它按"这个节点
       *   可不可交互"逐个决定；画板节点没写 selectable:false，所以是 all）。
       *   于是这张卡**整个点不动**——换图按钮点不了，点卡片高亮引用页也点不了。
       *   按钮画得好好的、位置也对，`elementFromPoint` 拿到的却是
       *   react-flow__pane。
       *
       *   这里显式把命中打开：子元素的 pointer-events:auto 能盖过父层的 none。
       *   不去掉 `selectable: false` —— 那会把 React Flow 的选中语义
       *   （选中框、Delete 键删节点）一并带进来，不是我们要的。
       *
       * ⚠ 判据教训：smoke 里那几条用的是 `btn.click()`（DOM 调用），**绕过命中
       *   测试**，所以一直是绿的。这类"点得到吗"的判据必须走真实鼠标坐标。
       */
      style={{ width: w, height: h, pointerEvents: "auto" }}
      data-testid="sliderule-canvas-asset"
      data-asset-url={asset.url}
      data-placeholder={asset.placeholder ? "1" : "0"}
      data-natural={dims ? `${dims.w}x${dims.h}` : undefined}
    >
      <div
        className="absolute left-0 flex origin-bottom-left select-none items-center gap-1.5 overflow-hidden whitespace-nowrap"
        style={{
          bottom: h + 8,
          transform: `scale(${labelScale})`,
          // ⚠ 这一行是 2026-08-25 真机截图上"三张素材卡的标签糊成一坨"的修复。
          //   素材卡只有 420 画布 px，适应画布时约 76 屏幕 px，而反缩放后的
          //   标签是恒定屏幕尺寸（150px 量级）——不夹宽度必然互相压。
          maxWidth: labelWidth,
        }}
      >
        {asset.placeholder && compact ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#C05621]"
            title="占位图"
            aria-hidden
          />
        ) : null}
        <span
          className="min-w-0 truncate text-[12px] font-medium text-stone-500"
          data-testid="sliderule-canvas-asset-label"
        >
          {asset.label}
        </span>
        {compact ? null : (
          <>
            {dims ? (
              <span
                className="shrink-0 font-mono text-[11px] tabular-nums text-stone-400"
                data-testid="sliderule-canvas-asset-dims"
                title="这张图的真实像素尺寸"
              >
                {dims.w}×{dims.h}
              </span>
            ) : null}
            {asset.placeholder ? (
              /* 占位图是**如实告警**：交付前这些图得换掉。真机团购那趟
                 3 张去重后的图全是占位图，一页一页翻根本看不出来。 */
              <span
                className="shrink-0 rounded bg-[#FDF6F1] px-1.5 py-px text-[10px] font-medium text-[#C05621]"
                data-testid="sliderule-canvas-asset-placeholder-badge"
              >
                占位图
              </span>
            ) : null}
            <span className="shrink-0 text-[11px] text-stone-400">
              {asset.pageIds.length} 页
            </span>
          </>
        )}
      </div>

      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-md border border-[#e9edf2] bg-white"
        style={{ boxShadow: STAGE_FRAME_FLAT }}
        title={asset.url}
        onClick={e => {
          e.stopPropagation();
          ctx?.onSelectAsset(asset);
        }}
      >
        {failed ? (
          /* ⚠ 加载不出来要**说出来**，不摆一个灰方块假装图本身就长那样。
             外链图（placehold.co / flickr）在内网或断网环境下常态失败。 */
          <div
            className="flex flex-col items-center gap-3 px-4 text-center text-stone-400"
            data-testid="sliderule-canvas-asset-failed"
          >
            <ImageOff style={{ width: 56, height: 56 }} />
            <span className="text-[22px] leading-7">加载不出来</span>
            <span className="max-w-full truncate font-mono text-[15px] text-stone-300">
              {asset.url}
            </span>
          </div>
        ) : (
          /* h/w-full + object-contain：小图会被放大到卡片大小。这不是"骗人"
             ——真实尺寸就印在标签上（dims），卡片只是预览。不放大的话
             一张 40×40 的图在 18% 缩放下是 7 个屏幕像素，等于没画。 */
          <img
            src={asset.url}
            alt={asset.label}
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain p-3"
            onLoad={e => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setDims({ w: el.naturalWidth, h: el.naturalHeight });
              }
            }}
            onError={() => setFailed(true)}
          />
        )}

        {/* 「换图」——反缩放，让它在任何缩放下都是可点的大小。
            ⚠ 没有 appId 时**不摆这颗按钮**，而不是摆一颗点了报错的：
              会话还没落库是正常状态（推演没跑完），不是错误。 */}
        {ctx?.onReplaceAsset ? (
          <button
            type="button"
            data-testid="sliderule-canvas-asset-replace-btn"
            title="换掉这张图"
            onClick={e => {
              e.stopPropagation();
              ctx.onReplaceAsset?.(asset);
            }}
            style={{
              transform: `scale(${labelScale})`,
              transformOrigin: "top right",
            }}
            className="absolute right-2 top-2 flex items-center gap-1 rounded bg-white/95 px-2 py-1 text-[11px] text-stone-600 shadow-sm ring-1 ring-stone-200 transition hover:text-[#1677ff] hover:ring-[#1677ff]"
          >
            <RefreshCw className="h-3 w-3" />
            换图
          </button>
        ) : null}
      </div>
    </div>
  );
}

const nodeTypes = { artboard: ArtboardNode, asset: AssetNode };

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
  sessionId,
  appId,
  onPagesReplaced,
  metaTrailing = null,
}: SpecPageCanvasStageProps): React.ReactElement {
  const flow = useReactFlow();
  const [entered, setEntered] = React.useState<string | null>(null);
  const [linkMode, setLinkMode] = React.useState(false);
  const [linkFrom, setLinkFrom] = React.useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [menu, setMenu] = React.useState<{
    pageId: string;
    x: number;
    y: number;
  } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [focusedAsset, setFocusedAsset] = React.useState<string | null>(null);

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

  const pageIds = React.useMemo(() => pages.map(p => p.pageId), [pages]);
  const labelOf = React.useCallback(
    (p: { pageId: string; name?: string; html?: string }) => artboardLabel(p),
    []
  );
  const nameOf = React.useCallback(
    (pageId: string) => {
      const p = pages.find(x => x.pageId === pageId);
      return p ? artboardLabel(p) : pageId;
    },
    [pages]
  );

  /* --------------------------------------------------------- 连线 */

  const storageKey = manualLinksStorageKey(sessionId);
  const [manualLinks, setManualLinks] = React.useState<BoardLink[]>([]);
  // 换会话 / 页面清单变了都要重读一次存档并按新清单过滤（存档里可能有指向
  // 已经不存在页面的线——那是用户浏览器里躺着的旧数据，永远会有）。
  React.useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      /* 隐私模式：连线只在本次会话内有效，功能本身照常 */
    }
    setManualLinks(readManualLinks(raw, pageIds));
  }, [storageKey, pageIds]);

  const persistManual = React.useCallback(
    (next: BoardLink[]) => {
      setManualLinks(next);
      try {
        localStorage.setItem(storageKey, writeManualLinks(next));
      } catch {
        /* 存不下就只在本次会话内有效，不影响画布 */
      }
    },
    [storageKey]
  );

  const dataflowLinks = React.useMemo(
    () => deriveDataflowLinks(model, pageIds),
    [model, pageIds]
  );
  const links = React.useMemo(
    () => [...dataflowLinks, ...manualLinks],
    [dataflowLinks, manualLinks]
  );

  const connect = React.useCallback(
    (from: string, to: string) => {
      const next = addManualLink(manualLinks, from, to);
      if (next === manualLinks) {
        setToast(from === to ? "同一块画板不用连自己" : "这条线已经有了");
        return;
      }
      persistManual(next as BoardLink[]);
      setToast(`已连上：${nameOf(from)} → ${nameOf(to)}`);
    },
    [manualLinks, persistManual, nameOf]
  );

  const dropLink = React.useCallback(
    (id: string) => persistManual(removeLink(manualLinks, id)),
    [manualLinks, persistManual]
  );

  /** 把一条连线落回一句话（页面作用域精修）。手画的线不许只是装饰。 */
  const applyLink = React.useCallback(
    (link: BoardLink) => {
      fillComposer(linkToRefineInstruction(link, nameOf));
      setToast("已填进输入框，看一眼再按回车");
    },
    [nameOf]
  );

  /* --------------------------------------------------------- 素材 */

  const assets = React.useMemo(() => extractPageAssets(pages), [pages]);

  /** 正在换的那张图（null = 面板关着）。存 URL 不存对象：pages 一变
   *  assets 会重算，存对象会拿着一份过期快照。 */
  /**
   * 画布上选中的那个元素（右侧面板据此变成它的编辑器）。
   *
   * ⚠ 存在这一层而不是画板节点里：右侧面板要读它，画板要据它画选中框，
   *   两处共用一份。存进节点的话面板读不到，就会各存一份、迟早分叉。
   */
  const [picked, setPicked] = React.useState<PickedElement | null>(null);
  // 换页面清单 / 换会话 → 之前选中的元素多半已经不在了，别留着一个悬空的框。
  React.useEffect(() => setPicked(null), [sessionId, pages.length]);

  /* ------------------------------------------------- 空格平移 / 画板重排 */

  /**
   * 按住空格 = 平移画布（Figma / excalidraw 那套）。
   *
   * 为什么需要它：画布上最高频的手势是"按住拖着看"，而画板可拖之后，
   * 在画板上按下就被 React Flow 的节点拖拽接管了，平移够不着。空格给平移
   * 留一条任何位置都走得通的路。
   *
   * ⚠ 四条都是从 excalidraw 抄的，缺一条都会出问题（App.tsx 里 isHoldingSpace
   *   那几处）：
   *     1. 只在**没有指针按下**时进入空格态——不在手势中途切模式；
   *     2. `preventDefault()`——否则空格把页面滚下去了；
   *     3. **窗口失焦要强制清掉**——Alt+Tab 走了 keyup 永远不来，
   *        回来就卡在平移态，这是这类实现最常见的 bug；
   *     4. 页面隐藏（切标签页）同样要清。
   *
   * ⚠ 第五条是我们特有的：excalidraw 把监听挂 document 上且没有输入框判断，
   *   因为它的文本编辑是自己那套 wysiwyg。我们页面里有真实 input/textarea
   *   （对话框、元素面板、搜索框），少了 isTypingTarget 这层，用户在输入框里
   *   **敲不出空格**。
   */
  const [spaceHeld, setSpaceHeld] = React.useState(false);
  /* 当前有没有按着指针。KeyboardEvent 上没有 buttons，excalidraw 用的是它自己
     维护的 gesture.pointers.size —— 这里同样自己记一个。 */
  const pointerDownRef = React.useRef(false);
  React.useEffect(() => {
    const onDown = () => {
      pointerDownRef.current = true;
    };
    const onUp = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, []);
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return;
      if (isTypingTarget(document.activeElement)) return;
      if (pointerDownRef.current) return; // 手势进行中，不切模式
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") setSpaceHeld(false);
    };
    const clear = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  /**
   * 手动挪过的画板位置。没挪过的页用自动排布算出来的位置。
   *
   * ⚠ 存档按会话分键并按当前页面清单过滤（readBoardPositions 里做）——
   *   重新推演之后 pageId 会变，留着旧 id 会让自动排布在某些页上莫名不生效。
   */
  const posKey = boardPositionsStorageKey(sessionId);
  const [boardPos, setBoardPos] = React.useState<Record<string, BoardPosition>>(
    {}
  );
  React.useEffect(() => {
    try {
      setBoardPos(
        readBoardPositions(
          window.localStorage.getItem(posKey),
          pages.map(p => p.pageId)
        )
      );
    } catch {
      setBoardPos({});
    }
  }, [posKey, pages]);
  const persistPos = React.useCallback(
    (next: Record<string, BoardPosition>) => {
      setBoardPos(next);
      try {
        window.localStorage.setItem(posKey, writeBoardPositions(next));
      } catch {
        /* 存档失败不拦交互——挪动本身已经生效了，只是下次打开回到自动排布 */
      }
    },
    [posKey]
  );

  const [replacingUrl, setReplacingUrl] = React.useState<string | null>(null);
  const replacingAsset = React.useMemo(
    () => assets.find(a => a.url === replacingUrl) ?? null,
    [assets, replacingUrl]
  );

  /**
   * 换图：纯字符串替换 → 既有 PATCH 落库 → 把新 HTML 交回宿主。**零 LLM**。
   *
   * ⚠ 三条边界，每条都对应一次真实的失败形态：
   *   1. `planAssetReplacement` 回空 = 画布上看到的图跟页面 HTML 已经对不上，
   *      **必须抛错**。悄悄"成功"就是本仓最忌的"闸全绿但东西没了"。
   *   2. 有一页写失败就整体报错，不吞——半换成功比没换更难排查。
   *   3. 落库成功必须 `onPagesReplaced`，否则画布还显示旧图：存了但看着没变。
   */
  /**
   * 元素编辑落库。跟换图**同一条写回路径**（PATCH /apps/{id}/pages/{pageId}），
   * 不另造。
   *
   * ⚠ 落库成功必须 onPagesReplaced：画板是按 pages 渲染的，不把新 HTML 交回
   *   宿主的话，库里改了、画布上还是旧的——"存了但看着没变"跟"没存上"在屏幕上
   *   长得一模一样。
   */
  const applyElementEdit = React.useCallback(
    async (pageId: string, nextHtml: string) => {
      if (!appId) throw new Error("这个会话还没存成应用，先跑完一轮推演");
      const res = await updateAppPage(appId, pageId, nextHtml);
      if (!res.ok) throw new Error(res.error);
      onPagesReplaced?.({ [pageId]: nextHtml });
      setToast("已改好并存进这一页");
    },
    [appId, onPagesReplaced]
  );

  const replaceAsset = React.useCallback(
    async (group: AssetUseGroup, nextUrl: string): Promise<number> => {
      if (!appId) throw new Error("这个会话还没存成应用，先跑完一轮推演");
      const patches = planAssetReplacement(pages, group, nextUrl);
      if (patches.length === 0) {
        throw new Error("页面里没找到这张图（可能刚被别处改过）——刷新一下再试");
      }
      const saved: Record<string, string> = {};
      for (const patch of patches) {
        const res = await updateAppPage(appId, patch.pageId, patch.html);
        if (!res.ok) {
          throw new Error(
            `「${nameOf(patch.pageId)}」保存失败：${res.error}` +
              (Object.keys(saved).length
                ? `（前 ${Object.keys(saved).length} 页已改）`
                : "")
          );
        }
        saved[patch.pageId] = patch.html;
      }
      onPagesReplaced?.(saved);
      const n = patches.reduce((acc, x) => acc + x.replaced, 0);
      setToast(`已换掉 ${n} 处，共 ${patches.length} 页`);
      return n;
    },
    [appId, pages, nameOf, onPagesReplaced]
  );

  const assetBoxes = React.useMemo(
    () => layoutAssets(assets, boardsBounds(boxes), ASSET_TILE),
    [assets, boxes]
  );
  const [assetsShown, setAssetsShown] = React.useState(true);
  const highlightPageIds = React.useMemo(
    () =>
      focusedAsset
        ? (assets.find(a => a.url === focusedAsset)?.pageIds ?? [])
        : [],
    [focusedAsset, assets]
  );

  /* --------------------------------------------------------- 节点 */

  const source = React.useMemo(
    () => deriveBindingSource(model, runtime),
    [model, runtime]
  );

  /**
   * 画板被拖动 → 记下新位置。
   *
   * ⚠ 只认 **artboard 节点**的位置变更：素材卡是自动排在画板下方的，
   *   让它也能挪等于多一套要存的位置，而且素材本来就按引用数排序。
   *
   * ⚠ 只在**拖完**（dragging === false）才落存档。拖动中每一帧都写
   *   localStorage 是几百次同步写，会把拖拽拖成一卡一卡。
   */
  /**
   * 最近挪过的那块画板，画在最上层。
   *
   * ⚠ 2026-08-25 真机同一趟：把一块拖到另一块身上，它整块**滑到人家底下**
   *   （React Flow 按数组顺序叠，我们的 selected 只跟 activePageId 走，拖动
   *   不会选中，所以 elevateNodesOnSelect 抬不起来）。用户看到的就是"页面
   *   没了"。Figma / TRAE 都是"谁刚被拖谁在最上面"，这里照抄。
   */
  const [frontId, setFrontId] = React.useState<string | null>(null);

  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      let next: Record<string, BoardPosition> | null = null;
      for (const c of changes) {
        if (c.type !== "position" || !c.position) continue;
        if (c.id.startsWith("asset:")) continue;
        setFrontId(c.id);
        next = { ...(next ?? boardPos), [c.id]: { ...c.position } };
        if (c.dragging) {
          // 拖动中：只更新内存，画板跟手；不写存档。
          setBoardPos(next);
          next = null;
        }
      }
      if (next) persistPos(next);
    },
    [boardPos, persistPos]
  );

  /**
   * 画板的**当前**位置：手动挪过的用存档，没挪过的用自动排布算出来的。
   *
   * ⚠ 存档里只会有当前页面清单里的 id（readBoardPositions 过滤过），
   *   所以新生成的页自然落在自动排布的位置上，不会挤在 (0,0)。
   *
   * ⚠ 2026-08-25 真机（校园二手书那趟，用户报"连线一拖动页面就没了"）：
   *   节点位置早就按 boardPos 画了，**连线的出入方向却还在按自动排布的
   *   boxes 挑**（pickLinkSides 吃的是 boxById，boxById 只依赖 boxes）。
   *   把第一块拖到右下角之后，线仍然从它的右边出发再绕回目标的左边，画出
   *   一个跟谁都不挨着的方框——不报错、边数不变、路径也不是 NaN，看起来
   *   就是"线没了"。典型的"只改一半必然静默失效"。
   *   **位置只留这一份**：节点、连线选边、定位都从 placedBoxes 取。
   *   没挪过的画板原样返回同一个对象，别让整排节点每拖一次就换身份。
   */
  const placedBoxes = React.useMemo(
    () =>
      boxes.map(box => {
        const p = boardPos[box.pageId];
        return p ? { ...box, x: p.x, y: p.y } : box;
      }),
    [boxes, boardPos]
  );

  const nodes = React.useMemo<Node[]>(() => {
    const boards: Node<ArtboardData>[] = placedBoxes.map((box, i) => ({
      id: box.pageId,
      type: "artboard",
      position: { x: box.x, y: box.y },
      // React Flow 要显式尺寸才能算 fitView 与 minimap；不给的话它得等
      // ResizeObserver 量一遍，首帧 fitView 会算在 0×0 上（全屏一团糊）。
      width: box.w,
      height: box.h,
      /* ⚠ 1001 不是 1：React Flow 的 elevateNodesOnSelect 给**选中**的节点
         加 1000，写 1 的话"刚拖过的那块"照样压在选中的那块底下——而这两件
         事经常不是同一块（选中跟着 activePageId 走，拖动不改选中）。 */
      zIndex: box.pageId === frontId ? 1001 : 0,
      selected: pages[i]?.pageId === activePageId,
      data: {
        page: pages[i]!,
        box,
        index: i,
        label: artboardLabel(pages[i]!),
        fillPhone: isPhone,
      },
    }));
    if (!assetsShown) return boards;
    const assetNodes: Node<AssetData>[] = assetBoxes.map((b, i) => ({
      id: `asset:${b.url}`,
      type: "asset",
      position: { x: b.x, y: b.y },
      width: b.w,
      height: b.h,
      selectable: false,
      data: { asset: assets[i]!, w: b.w, h: b.h },
    }));
    return [...boards, ...assetNodes];
  }, [
    placedBoxes,
    pages,
    isPhone,
    activePageId,
    assetBoxes,
    assets,
    assetsShown,
    frontId,
  ]);

  const boxById = React.useMemo(
    () => new Map(placedBoxes.map(b => [b.pageId, b])),
    [placedBoxes]
  );
  const edges = React.useMemo<Edge[]>(
    () =>
      links.map(l => {
        const a = boxById.get(l.from);
        const b = boxById.get(l.to);
        // 两端都在才挑得出边；缺一端时退回右→左（React Flow 至少画得出来）。
        const sides =
          a && b
            ? pickLinkSides(a, b)
            : { source: "r" as const, target: "l" as const };
        return {
          id: l.id,
          source: l.from,
          target: l.to,
          sourceHandle: sides.source,
          targetHandle: sides.target,
          type: "smoothstep",
          animated: l.kind === "manual",
          label: l.label,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92 },
          labelStyle: {
            fill: l.kind === "manual" ? "#1677ff" : "#64748b",
            fontSize: 26,
            fontWeight: 500,
          },
          style: EDGE_STYLE[l.kind],
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: EDGE_STYLE[l.kind].stroke,
          },
          data: { kind: l.kind },
        };
      }),
    [links, boxById]
  );

  /* --------------------------------------------------------- 交互 */

  const boardEls = React.useRef(new Map<string, HTMLDivElement>());
  const registerBoardEl = React.useCallback(
    (pageId: string, el: HTMLDivElement | null) => {
      if (el) boardEls.current.set(pageId, el);
      else boardEls.current.delete(pageId);
    },
    []
  );

  const zoomToBoard = React.useCallback(
    (pageId: string) => {
      // ⚠ 必须用 placedBoxes：拖走之后 boxes 里还是自动排布的老坐标，
      //   用它 fitBounds 会把镜头对到一块空地上。
      const box = placedBoxes.find(b => b.pageId === pageId);
      if (!box) return;
      // fitBounds 用 React Flow 自己的容器尺寸算，比我们手算稳（它知道
      // padding 与当前 transform）。自己再算一遍等于两份缩放，必然分叉。
      flow.fitBounds(
        { x: box.x, y: box.y, width: box.w, height: box.h },
        { padding: 0.12, duration: 260 }
      );
    },
    [placedBoxes, flow]
  );

  const select = React.useCallback(
    (pageId: string) => {
      // 连线态下点画板 = 连线（右键菜单「从这里连一条线」进来的那条路），
      // 不是选中。两种语义在同一次点击上，必须由 linkFrom 明确分流。
      if (linkFrom) {
        if (linkFrom !== pageId) connect(linkFrom, pageId);
        setLinkFrom(null);
        return;
      }
      onActivePageChange?.(pageId);
      setFocusedAsset(null);
    },
    [linkFrom, connect, onActivePageChange]
  );

  const enter = React.useCallback(
    (pageId: string) => {
      if (linkFrom) return; // 连线态下双击不进板，避免误触
      onActivePageChange?.(pageId);
      setEntered(pageId);
      zoomToBoard(pageId);
    },
    [linkFrom, onActivePageChange, zoomToBoard]
  );

  /** 页面自己的左侧菜单点了某一项：画布上滚到那块画板，而不是原地换内容。 */
  const navigate = React.useCallback(
    (pageId: string) => {
      if (!boxes.some(b => b.pageId === pageId)) return;
      onActivePageChange?.(pageId);
      setEntered(pageId);
      zoomToBoard(pageId);
    },
    [boxes, onActivePageChange, zoomToBoard]
  );

  const jumpTo = React.useCallback(
    (pageId: string) => {
      onActivePageChange?.(pageId);
      zoomToBoard(pageId);
    },
    [onActivePageChange, zoomToBoard]
  );

  const regenerate = React.useCallback(
    (pageId: string) => {
      // ⚠ 指令里要出现**人话页名**：后端判作用域那一步
      //   (services/refine_page_scope.py) 是拿指令文本点名页面的，
      //   只写 pageId 它点不到，会退回全量重画。
      fillComposer(`把「${nameOf(pageId)}」这一页重画一版，其余页面不要改。`);
      setToast("重画指令已填进输入框，看一眼再按回车");
    },
    [nameOf]
  );

  const doExportPng = React.useCallback(
    async (pageId: string) => {
      setToast("正在导出 PNG…");
      const ok = await exportBoardPng(
        boardEls.current.get(pageId) ?? null,
        nameOf(pageId)
      );
      // fail-open 不等于静静地什么都不发生：点了导出却没下载，
      // 比报个错更让人以为是自己点错了。
      setToast(ok ? "PNG 已导出" : "导出没成——画板还没渲染完，等一下再试");
    },
    [nameOf]
  );

  const doExportHtml = React.useCallback(
    (pageId: string) => {
      const page = pages.find(p => p.pageId === pageId);
      const ok = exportBoardHtml(page?.html ?? "", nameOf(pageId));
      setToast(ok ? "HTML 已导出" : "这一页没有可导出的 HTML");
    },
    [pages, nameOf]
  );

  const copyPageId = React.useCallback((pageId: string) => {
    navigator.clipboard?.writeText(pageId).then(
      () => setToast(`已复制 ${pageId}`),
      () => setToast("复制失败——浏览器没给剪贴板权限")
    );
  }, []);

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
      onBoardMenu: (pageId, x, y) => {
        onActivePageChange?.(pageId);
        setMenu({ pageId, x, y });
      },
      onSelectAsset: (a: CanvasAsset) => setFocusedAsset(a.url),
      onReplaceAsset: appId ? (a: CanvasAsset) => setReplacingUrl(a.url) : null,
      /* 选中→编辑整条收在画布内部（跟换图一样）。宿主只在落库后
         收一次新 HTML（onPagesReplaced），不用把选中态穿来穿去。 */
      onPickElement: appId ? setPicked : null,
      picked,
      linkFrom,
      linkMode,
      registerBoardEl,
      highlightPageIds,
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
      onActivePageChange,
      appId,
      picked,
      linkFrom,
      linkMode,
      registerBoardEl,
      highlightPageIds,
    ]
  );

  // Esc：先退连线态，再退进板态。⚠ 只在有态可退时挂监听——常挂会把
  // Studio 里其它 Esc 语义（系统屏抽屉）抢掉。
  React.useEffect(() => {
    if (!entered && !linkFrom && !picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 退的顺序：先撤选中的元素，再退连线态，最后退进板态。
      if (picked) setPicked(null);
      else if (linkFrom) setLinkFrom(null);
      else setEntered(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, linkFrom, picked]);

  // 提示条自己消失。⚠ 用 key 重置计时：连着点两次导出，第二次的提示
  // 不该被第一次的计时器提前掐掉。
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

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
   *   handleBounds，而画板节点当时没有任何 <Handle>。
   *   于是 effect 每次都早退，屏幕上是 2 列、缩放却是 3 列那次算出来的 12%。
   *   ——用一个"顺便还要求别的东西"的现成布尔值当守卫，是这类静默失效的
   *   标准来源。守卫要**直接问自己真正依赖的那个条件**：节点量完了没有。
   *
   *   ⚠ 第二轮加连线之后画板**有** Handle 了，nodesInitialized 大概会开始
   *     返回 true——但**别因此改回去**。它依赖的东西比这里需要的多，
   *     哪天连线态改成按需挂把手，它又会悄悄变回恒 false。
   *
   * ⚠ 素材卡也算节点，所以指纹里要把它们排除，只数画板：素材开关一开一关
   *   会让 nodeLookup.size 变，但**排版没变**，不该把用户的视口拽回原位。
   *
   * 想验证这条还通电：在下面 fitView 那行打一句 log，切到画布档看它有没有
   * 打出来。判据 canvas-board-layout.test.ts 钉的是纯函数那一半。
   */
  /*
   * ⚠ 2026-08-25 第三次栽在这儿，用户报的是"一拖动远一点，连接线就没了"。
   *
   *   指纹里的列数原来是数**store 里 y===0 的画板**。手动把一块拖走之后
   *   它的 y 不再是 0 —— 指纹从 "4:4" 变成 "4:3"，这条 effect 就当成
   *   "排版变了"，在**拖动过程中**调了一次 fitView。视口当场跳走，而拖拽
   *   是按指针在 flow 空间的位移算的，视口一换算，画板跟着甩到很远的地方，
   *   连着它的线自然跑出屏幕——看起来就是"拖远一点线就没了"。
   *   （真机复现：缩放 21% 时拖一下，松手后读数自己变回 52%，画板落到
   *   视口外。）
   *
   *   这条 effect 要盯的是**自动排版**变了没有（页数/列数），那是我们自己
   *   算出来的，跟用户手动挪画板无关。所以列数改从 boxes 里数。
   *
   *   但也不能就此不问 store —— 前两次栽的就是"拿自己的状态去问它的问题"
   *   （见上面）。守卫改成**直接问 store 追上没有**：每块画板都量到了尺寸，
   *   且位置跟我们给的 placedBoxes 对得上。没追上就返回空串，effect 早退，
   *   didFit 不动；追上之后指纹跟拖动前一样，也就不会再 fit 一次。
   */
  const autoCols = React.useMemo(
    () => boxes.reduce((n, b) => n + (b.y === 0 ? 1 : 0), 0),
    [boxes]
  );
  const flowLayoutKey = useStore(s => {
    let boards = 0;
    let ready = 0;
    for (const n of s.nodeLookup.values()) {
      if (n.type !== "artboard") continue;
      boards++;
      const want = boxById.get(n.id);
      if (
        (n.measured?.width ?? 0) > 0 &&
        (n.measured?.height ?? 0) > 0 &&
        want &&
        n.position.x === want.x &&
        n.position.y === want.y
      )
        ready++;
    }
    if (boards === 0 || ready < boards) return "";
    return `${boards}:${autoCols}`;
  });
  const didFit = React.useRef("");
  React.useEffect(() => {
    if (!flowLayoutKey || didFit.current === flowLayoutKey) return;
    didFit.current = flowLayoutKey;
    flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 });
  }, [flowLayoutKey, flow]);

  const zoom = useStore(s => s.transform[2]);
  const delivered = pages.filter(p => !p.missing).length;
  const placeholderCount = assets.filter(a => a.placeholder).length;

  const activePage = pages.find(p => p.pageId === activePageId) ?? null;
  const facts = React.useMemo(
    () =>
      activePage
        ? boardFacts(activePage, model, links, assets, design, labelOf)
        : null,
    [activePage, model, links, assets, design, labelOf]
  );

  const fitAll = React.useCallback(
    () => flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 }),
    [flow]
  );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      data-testid="sliderule-canvas-stage"
      data-page-count={pages.length}
      data-entered={entered ?? undefined}
      data-link-mode={linkMode ? "1" : "0"}
      data-link-count={links.length}
      data-asset-count={assets.length}
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
          {assets.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span data-testid="sliderule-canvas-asset-summary">
                {assets.length} 张图
                {placeholderCount > 0 ? (
                  <span className="ml-1 text-[#C05621]">
                    （{placeholderCount} 张占位图）
                  </span>
                ) : null}
              </span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span data-testid="sliderule-canvas-hint">
            {linkFrom
              ? "点另一块画板连上，Esc 取消"
              : entered
                ? "已进入画板，Esc 退出"
                : linkMode
                  ? /* ⚠ 派生边真机上经常是 0 条（三个会话量到 1/0/0，见
                       canvas-board-graph 头注）。开了连线态却一条线都没有时
                       必须**说出为什么**——静静地什么都不画，用户只会以为
                       功能坏了。这条是那份头注里写下的要求，不是文案润色。 */
                    dataflowLinks.length === 0
                    ? "模型里没有页面间的数据流可派生 · 从画板边缘的圆点拖到另一块画板即可自己连"
                    : "从画板边缘的圆点拖到另一块画板即可连线"
                  : "双击画板进入交互 · 右键更多"}
          </span>
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

      <div className="flex min-h-0 min-w-0 flex-1 gap-2">
        <div
          ref={flowHostRef}
          /*
           * 台面**完全透明**（2026-08-25 用户裁决："完全透明就行，现在就是有
           * 两层点阵背景了"）。不画底色、不画点阵、不描边——画布直接露出外壳
           * 那一层，只有一个背景。
           *
           * ⚠ 这一路走了三版才落到这儿，把过程记下来免得下一个人再走一遍：
           *   1) 深底 + 跟指针的聚光灯 + 全套前景改色 —— 做过头了，撤了。
           *   2) 浅灰台面 —— 顺带量到：字面意义上"去掉背景"是**看不见的**，
           *      台面原来 #fbfbfc，去掉后露出外壳 #f4f4f6，差一个色阶。
           *   3) 浅灰 + 自画点阵 —— 于是变成两层背景叠着。
           *   结论：这块地方**不该有自己的背景**。要改画布观感就去改外壳那层
           *   （--sr-shell-bg），别在这里再糊一层。
           */
          data-space-pan={spaceHeld ? "1" : "0"}
          /* 光标反馈跟 excalidraw 一致：按住空格是 grab，真拖起来是 grabbing。
             没有这层反馈，用户按了空格也不知道模式已经变了。 */
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-md ${
            spaceHeld ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          <CanvasContext.Provider value={ctx}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
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
              /* 只有连线态才允许拉线。常开的话画板边缘一直挂着两个能拖的
                 圆点，误触率高，而连线不是高频动作。 */
              nodesConnectable={linkMode}
              /* 四个把手都声明成 source，靠 loose 让它们同时能当终点
                 （见 ArtboardNode 里那段注释）。 */
              connectionMode={ConnectionMode.Loose}
              onConnect={c => {
                if (c.source && c.target) connect(c.source, c.target);
              }}
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
              /*
               * 空格按着时**画板不可拖**——只要节点 draggable，React Flow 就在
               * 节点上接管 mousedown，事件到不了 d3-zoom，平移就够不着画板
               * 底下那片区域（2026-08-25 第一版给标题条挂 dragHandle 失败的
               * 就是这条：dragHandle 只决定"从哪儿开始拖"，不决定"要不要拦"）。
               * 关掉 draggable，事件冒到缩放层，空格+拖就能在画板上平移。
               */
              nodesDraggable={!spaceHeld}
              onNodesChange={onNodesChange}
              proOptions={{ hideAttribution: true }}
              onPaneClick={() => {
                setEntered(null);
                setLinkFrom(null);
                setFocusedAsset(null);
              }}
              onEdgeClick={(_e, edge) => {
                const l = links.find(x => x.id === edge.id);
                if (l) {
                  onActivePageChange?.(l.from);
                  setInspectorOpen(true);
                }
              }}
              className="bg-transparent"
            >
              <MiniMap
                pannable
                zoomable
                ariaLabel="画布缩略图"
                maskColor="rgba(244,244,246,0.72)"
                nodeColor={n =>
                  n.type === "asset"
                    ? "#e2e8f0"
                    : n.id === activePageId
                      ? "#1677ff"
                      : "#cbd5e1"
                }
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
              onClick={fitAll}
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
              onClick={fitAll}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition hover:bg-[#f4f4f5] hover:text-stone-800"
              aria-label="适应画布"
              title="适应画布"
            >
              <Scan className="h-3.5 w-3.5" />
            </button>
            {/*
              恢复自动排布。⚠ 只在**真挪过**的时候出现——没挪过还摆一颗按钮，
              用户会以为当前就是"手动排的"。挪乱了必须有退路，否则重排是
              单向操作（这块画布没有撤销栈）。
            */}
            {Object.keys(boardPos).length > 0 ? (
              <button
                type="button"
                data-testid="sliderule-canvas-reset-layout"
                onClick={() => {
                  persistPos({});
                  window.setTimeout(fitAll, 60);
                  setToast("已恢复自动排布");
                }}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-stone-500 transition hover:bg-[#f4f4f5] hover:text-stone-800"
                title="把画板放回自动排布的位置"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                复位
              </button>
            ) : null}
            <span className="mx-0.5 h-4 w-px bg-[#e9edf2]" aria-hidden />
            <button
              type="button"
              onClick={() => {
                setLinkMode(v => !v);
                setLinkFrom(null);
              }}
              aria-pressed={linkMode}
              data-testid="sliderule-canvas-link-toggle"
              className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition ${
                linkMode
                  ? "bg-[#1677ff] text-white"
                  : "text-stone-600 hover:bg-[#f4f4f5] hover:text-stone-800"
              }`}
              title="连线：从画板右缘的圆点拖到另一块画板。连好的线可以一键写回页面。"
            >
              <Link2 className="h-3 w-3" />
              连线
              {links.length > 0 ? (
                <span className="font-mono tabular-nums">{links.length}</span>
              ) : null}
            </button>
            {assets.length > 0 ? (
              <button
                type="button"
                onClick={() => setAssetsShown(v => !v)}
                aria-pressed={assetsShown}
                data-testid="sliderule-canvas-assets-toggle"
                className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition ${
                  assetsShown
                    ? "text-stone-800"
                    : "text-stone-400 hover:bg-[#f4f4f5]"
                }`}
                title="页面引用到的图，摊在画板下方"
              >
                <ImageOff className="h-3 w-3" />
                素材
                <span className="font-mono tabular-nums">{assets.length}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setInspectorOpen(v => !v)}
              aria-pressed={inspectorOpen}
              data-testid="sliderule-canvas-inspector-toggle"
              className={`flex h-6 w-6 items-center justify-center rounded transition ${
                inspectorOpen
                  ? "bg-[#1677ff] text-white"
                  : "text-stone-500 hover:bg-[#f4f4f5] hover:text-stone-800"
              }`}
              aria-label="属性面板"
              title="属性面板：选中画板背后的数据、权限、连线与素材"
            >
              <PanelRight className="h-3.5 w-3.5" />
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

          {/* 操作回执。⚠ 增强类是 fail-open，但**失败也要说话**：
              点了导出却什么都没下载，比报个错更让人以为是自己点错了。 */}
          {toast ? (
            <div
              className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-stone-800/90 px-3 py-1.5 text-[11px] text-white shadow-lg"
              data-testid="sliderule-canvas-toast"
            >
              {toast}
            </div>
          ) : null}

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

        {picked ? (
          <CanvasElementPanel
            picked={picked}
            html={pages.find(p => p.pageId === picked.pageId)?.html ?? ""}
            pageName={nameOf(picked.pageId)}
            onApply={applyElementEdit}
            onClose={() => setPicked(null)}
          />
        ) : null}

        {replacingAsset ? (
          <AssetReplacePanel
            asset={replacingAsset}
            nameOf={nameOf}
            onReplace={replaceAsset}
            onClose={() => setReplacingUrl(null)}
            disabledReason={
              appId
                ? null
                : "这个会话还没存成应用（推演跑完才会落库），现在还改不了页面。"
            }
          />
        ) : null}

        {inspectorOpen ? (
          <CanvasInspector
            facts={facts}
            nameOf={nameOf}
            onClose={() => setInspectorOpen(false)}
            onJumpToPage={jumpTo}
            onOpenInPageView={pid => onOpenInPageView?.(pid)}
            onRegenerate={regenerate}
            onRemoveLink={dropLink}
            onApplyLink={applyLink}
            onFocusAsset={a => {
              setFocusedAsset(a.url);
              const b = assetBoxes.find(x => x.url === a.url);
              if (b) {
                setAssetsShown(true);
                flow.fitBounds(
                  { x: b.x, y: b.y, width: b.w, height: b.h },
                  { padding: 1.4, duration: 260 }
                );
              }
            }}
          />
        ) : null}
      </div>

      {menu ? (
        <CanvasBoardMenu
          x={menu.x}
          y={menu.y}
          pageName={nameOf(menu.pageId)}
          onClose={() => setMenu(null)}
          onEnter={() => enter(menu.pageId)}
          onOpenInPageView={() => onOpenInPageView?.(menu.pageId)}
          onStartLink={() => {
            setLinkMode(true);
            setLinkFrom(menu.pageId);
            setToast("点另一块画板连上，Esc 取消");
          }}
          onRegenerate={() => regenerate(menu.pageId)}
          onExportPng={() => void doExportPng(menu.pageId)}
          onExportHtml={() => doExportHtml(menu.pageId)}
          onCopyPageId={() => copyPageId(menu.pageId)}
        />
      ) : null}
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
