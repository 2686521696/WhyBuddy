/**
 * BlueprintWallGraphNodeCard - 蓝图墙面流程图自定义节点卡片（纯 React 组件）。
 *
 * 把 `mapWallDataToFlowGraph(...)` 写入每个 FlowGraph 节点 `data` 的蓝图负载
 * （`BlueprintFlowGraphNodeData`）渲染为一张「浅色画布友好」的可读卡片：紧凑的
 * 类型头（小色块 + 类型/状态标签）、标题、可选正文，并按节点类型 / 状态做克制的
 * 视觉变体（Task 4.1 / 4.2），以及 preview 节点的浏览器 / 架构 / 空态处理（Task 4.3）。
 *
 * 设计要点（对应 design「### `BlueprintWallGraphNodeCard`」+ 视觉映射表，Req 5.1-5.8 / 3.6）：
 *  - **纯函数组件**：不使用任何依赖活图 / G6 运行时的 hook，也不 import
 *    `@ant-design/graphs` / `@antv/g6` 运行时；可被 `react-dom/server`
 *    `renderToStaticMarkup` 直接渲染（Task 4.4 SSR/source 测试），也可在 Task 6.2 被
 *    `@ant-design/graphs` 的 `RCNode` 包裹用于活图渲染（本文件**不**接 RCNode）。
 *  - **自包含内联样式**：墙面通过 drei `<Html>` 渲染，内联样式最稳妥（沿用
 *    `BlueprintWallProcessGraphHud` 的 pale-canvas 内联风格）。固定可预测宽度
 *    （`CARD_WIDTH ≈ 300`，与 `LANE_X=330` 的列距留 gap），正文做受控换行
 *    （`-webkit-line-clamp` + `overflow:hidden`）保持墙面可读（Req 5.4）。
 *  - **可测 DOM**：根节点带 `data-node-type` / `data-node-status`，供 Task 4.4 断言。
 *  - **不臆造**：preview 缩略图仅当未来数据源提供 `thumbnailUrl` 时才渲染 `<img>`，
 *    否则只渲染 URL / marker 文本（Req 5.6 不臆造缩略图）。
 *
 * 作用域护栏（Req 3.7 / 4.4）：本组件**不得** import `useSandboxStore` /
 * `SandboxMonitor` / `MissionWallTaskPanel`，也不引用 `@ant-design/graphs` 运行时。
 */

import type { AppLocale } from "@/lib/locale";

import type {
  BlueprintWallGraphNodeStatus,
  BlueprintWallGraphNodeType,
  BlueprintWallPreviewSummary,
} from "./blueprint-wall-process-data";
import type { BlueprintFlowGraphNodeData } from "./blueprint-wall-flow-graph-map";

// ─── Component props ─────────────────────────────────────────────────────────

/**
 * 节点卡片 props。
 *
 * - `data`：mapper 透传保留的节点负载（type / status / title / body? / accent? /
 *   sourceRefs / visualStageLane / row / column）。
 * - `previewSummary`：preview 节点（Req 5.5 / 3.6）渲染 browser-url / architecture /
 *   empty marker 所需的 `Wall_Process_Data.previewSummary`；非 preview 节点忽略。
 * - `locale`：本地化短标签的语言；缺省回退 `DEFAULT_CARD_LOCALE`（zh-CN）。
 */
export interface BlueprintWallGraphNodeCardProps {
  data: BlueprintFlowGraphNodeData;
  previewSummary?: BlueprintWallPreviewSummary;
  locale?: AppLocale;
}

// ─── Layout constants ────────────────────────────────────────────────────────

/** 卡片固定宽度（px）。与 `LANE_X=330` 列距留 ~30px gap，保证墙面列对齐不挤压。 */
export const CARD_WIDTH = 300;

/** 卡片缺省 locale（与 deriver 的 `locale ?? "zh-CN"` 口径一致）。 */
const DEFAULT_CARD_LOCALE: AppLocale = "zh-CN";

/** 正文受控换行的最大行数（超出省略号截断，保持墙面可读，Req 5.4）。 */
const BODY_MAX_LINES = 3;

// ─── Per-type visual variants (Task 4.2) ─────────────────────────────────────

/** 单个节点类型的视觉描述：本地化短标签 + 类型色（色块 / 头部强调）。 */
export interface NodeTypeVisual {
  /** 类型头的本地化短标签。 */
  label: Record<AppLocale, string>;
  /** 类型代表色（色块 / 头部强调）；`accent` 存在时优先用 accent 覆盖色块。 */
  color: string;
}

/**
 * 全部 9 种节点类型的视觉变体（Task 4.2，覆盖 `BlueprintWallGraphNodeType` 全集）。
 *
 * 颜色方向对齐 design「### `BlueprintWallGraphNodeCard`」视觉映射表（克制、浅色画布
 * 友好的取色）：
 *
 * | type        | 方向        | 取值                       |
 * | ----------- | ----------- | -------------------------- |
 * | `user_goal` | blue        | `#2563eb`（blue-600）       |
 * | `stage`     | slate       | `#64748b`（slate-500）      |
 * | `reasoning` | teal        | `#0d9488`（teal-600）       |
 * | `route`     | violet      | `#7c3aed`（violet-600）     |
 * | `spec_node` | purple      | `#9333ea`（purple-600）     |
 * | `capability`| amber       | `#d97706`（amber-600）      |
 * | `preview`   | blue        | `#2563eb`（blue-600）       |
 * | `artifact`  | slate       | `#64748b`（slate-500）      |
 * | `final`     | green       | `#16a34a`（green-600）      |
 */
export const NODE_TYPE_VISUAL: Record<
  BlueprintWallGraphNodeType,
  NodeTypeVisual
> = {
  user_goal: {
    label: { "zh-CN": "用户目标", "en-US": "User Goal" },
    color: "#2563eb",
  },
  stage: {
    label: { "zh-CN": "阶段", "en-US": "Stage" },
    color: "#64748b",
  },
  reasoning: {
    label: { "zh-CN": "推理", "en-US": "Reasoning" },
    color: "#0d9488",
  },
  route: {
    label: { "zh-CN": "路线", "en-US": "Route" },
    color: "#7c3aed",
  },
  spec_node: {
    label: { "zh-CN": "规格", "en-US": "Spec" },
    color: "#9333ea",
  },
  capability: {
    label: { "zh-CN": "能力", "en-US": "Capability" },
    color: "#d97706",
  },
  preview: {
    label: { "zh-CN": "预览", "en-US": "Preview" },
    color: "#2563eb",
  },
  artifact: {
    label: { "zh-CN": "产物", "en-US": "Artifact" },
    color: "#64748b",
  },
  final: {
    label: { "zh-CN": "最终交付", "en-US": "Final" },
    color: "#16a34a",
  },
};

/** `accent` 提示 → 色块覆盖色（`accent` 存在时优先于 per-type 色）。 */
const ACCENT_COLOR: Record<
  NonNullable<BlueprintFlowGraphNodeData["accent"]>,
  string
> = {
  teal: "#0d9488",
  purple: "#9333ea",
  red: "#dc2626",
  blue: "#2563eb",
  slate: "#64748b",
};

// ─── Status visual variants (Req 5.7) ────────────────────────────────────────

/** 单个状态的视觉描述：边框/徽章色 + 本地化短标签 + 是否加柔和 glow。 */
interface NodeStatusVisual {
  /** 边框 / 徽章强调色。 */
  color: string;
  /** 状态本地化短标签（徽章文本）。 */
  label: Record<AppLocale, string>;
  /** 是否给卡片加一圈柔和 glow（用于 active 等需要强调的状态）。 */
  glow?: boolean;
}

/**
 * 全部 7 种状态的视觉变体（覆盖 `BlueprintWallGraphNodeStatus` 全集，Req 5.7）。
 *
 * 状态通过卡片边框色 + 右上角徽章体现（克制，不喧宾夺主）：
 *  - `active`    → teal，带柔和 glow（进行中强调）
 *  - `completed` → green（完成）
 *  - `warning`   → amber（告警）
 *  - `failed`    → red（失败）
 *  - `ready`     → sky blue（就绪）
 *  - `queued`    → slate（排队）
 *  - `empty`     → pale slate（空，最弱）
 */
const NODE_STATUS_VISUAL: Record<
  BlueprintWallGraphNodeStatus,
  NodeStatusVisual
> = {
  empty: {
    color: "#cbd5e1",
    label: { "zh-CN": "空", "en-US": "Empty" },
  },
  queued: {
    color: "#94a3b8",
    label: { "zh-CN": "排队", "en-US": "Queued" },
  },
  active: {
    color: "#0d9488",
    label: { "zh-CN": "进行中", "en-US": "Active" },
    glow: true,
  },
  ready: {
    color: "#0ea5e9",
    label: { "zh-CN": "就绪", "en-US": "Ready" },
  },
  completed: {
    color: "#16a34a",
    label: { "zh-CN": "完成", "en-US": "Done" },
  },
  warning: {
    color: "#d97706",
    label: { "zh-CN": "警告", "en-US": "Warning" },
  },
  failed: {
    color: "#dc2626",
    label: { "zh-CN": "失败", "en-US": "Failed" },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 解析卡片实际使用的 locale（缺省回退 zh-CN）。 */
function resolveLocale(locale: AppLocale | undefined): AppLocale {
  return locale ?? DEFAULT_CARD_LOCALE;
}

/** 解析色块颜色：`accent` 优先，否则回退 per-type 色。 */
function resolveSwatchColor(data: BlueprintFlowGraphNodeData): string {
  if (data.accent) return ACCENT_COLOR[data.accent];
  return NODE_TYPE_VISUAL[data.type].color;
}

/** 受控多行截断的通用样式（`-webkit-line-clamp`，浅色画布友好）。 */
function clampStyle(lines: number): React.CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    wordBreak: "break-word",
  };
}

// ─── Preview node treatment (Task 4.3 / Req 5.5 / 5.6 / 3.6) ──────────────────

/** preview marker 的本地化短文案。 */
const PREVIEW_TEXT: Record<
  "browser" | "architecture" | "empty",
  Record<AppLocale, string>
> = {
  browser: { "zh-CN": "浏览器预览", "en-US": "Browser preview" },
  architecture: { "zh-CN": "架构草图", "en-US": "Architecture draft" },
  empty: { "zh-CN": "暂无预览", "en-US": "No preview" },
};

/**
 * 渲染 preview 节点的预览区（Task 4.3）。
 *
 * 分支（必须在 `previewSummary` 为 undefined 时不抛错）：
 *  - `ready` + `browser`：浏览器 marker + URL 文本；仅当 `thumbnailUrl` 为非空字符串
 *    时才渲染 `<img>`（Req 5.6 不臆造缩略图）。
 *  - `ready` + `architecture`：架构草图 fallback marker（无图）。
 *  - 其它（`empty` / 无 previewSummary）：muted 空预览 marker。
 *
 * 用 `data-preview-kind` 暴露分支结果，供 Task 4.4 断言。
 */
function renderPreviewBody(
  previewSummary: BlueprintWallPreviewSummary | undefined,
  locale: AppLocale
): React.ReactElement {
  // ready + browser：URL marker（+ 可选真实缩略图）。
  if (
    previewSummary &&
    previewSummary.status === "ready" &&
    previewSummary.kind === "browser"
  ) {
    const hasThumbnail =
      typeof previewSummary.thumbnailUrl === "string" &&
      previewSummary.thumbnailUrl.length > 0;
    return (
      <div data-preview-kind="browser" style={previewBoxStyle("#2563eb")}>
        <div style={previewMarkerRowStyle}>
          <span aria-hidden style={previewGlyphStyle("#2563eb")}>
            ◷
          </span>
          <span style={previewLabelStyle("#1d4ed8")}>
            {PREVIEW_TEXT.browser[locale]}
          </span>
        </div>
        {hasThumbnail ? (
          // 仅在未来数据源提供 thumbnailUrl 时渲染真实缩略图（Req 5.6）。
          <img
            src={previewSummary.thumbnailUrl}
            alt={previewSummary.title}
            style={{
              width: "100%",
              height: 84,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid rgba(148,163,184,0.4)",
            }}
          />
        ) : null}
        {typeof previewSummary.url === "string" &&
        previewSummary.url.length > 0 ? (
          <div style={previewUrlStyle}>{previewSummary.url}</div>
        ) : null}
      </div>
    );
  }

  // ready + architecture：架构草图 fallback marker（无图）。
  if (
    previewSummary &&
    previewSummary.status === "ready" &&
    previewSummary.kind === "architecture"
  ) {
    return (
      <div data-preview-kind="architecture" style={previewBoxStyle("#7c3aed")}>
        <div style={previewMarkerRowStyle}>
          <span aria-hidden style={previewGlyphStyle("#7c3aed")}>
            ◫
          </span>
          <span style={previewLabelStyle("#6d28d9")}>
            {PREVIEW_TEXT.architecture[locale]}
          </span>
        </div>
      </div>
    );
  }

  // empty / 无 previewSummary：muted 空预览 marker。
  return (
    <div data-preview-kind="empty" style={previewBoxStyle("#cbd5e1")}>
      <div style={previewMarkerRowStyle}>
        <span aria-hidden style={previewGlyphStyle("#94a3b8")}>
          ○
        </span>
        <span style={previewLabelStyle("#64748b")}>
          {PREVIEW_TEXT.empty[locale]}
        </span>
      </div>
    </div>
  );
}

function previewBoxStyle(accent: string): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 8,
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(248,250,252,0.8)",
    border: `1px dashed ${accent}55`,
  };
}

const previewMarkerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

function previewGlyphStyle(color: string): React.CSSProperties {
  return { color, fontSize: 13, lineHeight: 1 };
}

function previewLabelStyle(color: string): React.CSSProperties {
  return { color, fontSize: 12, fontWeight: 600, letterSpacing: 0.2 };
}

const previewUrlStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 11,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  ...clampStyle(1),
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * 蓝图墙面流程图自定义节点卡片。
 *
 * 纯 React 函数组件：渲染稳定可测的 DOM（根节点带 `data-node-type` /
 * `data-node-status`），按节点类型 / 状态做克制视觉变体，并对 preview 节点做
 * browser / architecture / empty 处理。无副作用、无 hook、确定性输出。
 */
export function BlueprintWallGraphNodeCard({
  data,
  previewSummary,
  locale,
}: BlueprintWallGraphNodeCardProps): React.ReactElement {
  const activeLocale = resolveLocale(locale);
  const typeVisual = NODE_TYPE_VISUAL[data.type];
  const statusVisual = NODE_STATUS_VISUAL[data.status];
  const swatchColor = resolveSwatchColor(data);
  const isPreview = data.type === "preview";

  return (
    <div
      data-node-type={data.type}
      data-node-status={data.status}
      style={{
        boxSizing: "border-box",
        width: CARD_WIDTH,
        padding: "10px 12px",
        borderRadius: 12,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.95))",
        border: `1px solid ${statusVisual.color}`,
        borderLeft: `4px solid ${swatchColor}`,
        boxShadow: statusVisual.glow
          ? `0 8px 20px rgba(15,118,110,0.16), 0 0 0 3px ${statusVisual.color}22`
          : "0 8px 18px rgba(86,105,126,0.12)",
        color: "#1e293b",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
      }}
    >
      {/* 类型头：小色块 + 类型短标签 + 右上角状态徽章。 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: 3,
            background: swatchColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: typeVisual.color,
            flex: 1,
            ...clampStyle(1),
          }}
        >
          {typeVisual.label[activeLocale]}
        </span>
        <span
          data-node-status-badge={data.status}
          style={{
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1.4,
            padding: "1px 7px",
            borderRadius: 999,
            color: statusVisual.color,
            background: `${statusVisual.color}1a`,
            border: `1px solid ${statusVisual.color}55`,
            flexShrink: 0,
          }}
        >
          {statusVisual.label[activeLocale]}
        </span>
      </div>

      {/* 标题：受控单/双行截断。 */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.35,
          color: "#0f172a",
          ...clampStyle(2),
        }}
      >
        {data.title}
      </div>

      {/* 正文：仅在存在时渲染，受控多行截断（Req 5.4）。 */}
      {data.body !== undefined && data.body.length > 0 ? (
        <div
          style={{
            marginTop: 5,
            fontSize: 12,
            lineHeight: 1.45,
            color: "#475569",
            ...clampStyle(BODY_MAX_LINES),
          }}
        >
          {data.body}
        </div>
      ) : null}

      {/* preview 节点专属处理（Task 4.3）：browser / architecture / empty。 */}
      {isPreview ? renderPreviewBody(previewSummary, activeLocale) : null}
    </div>
  );
}
