/**
 * 体验区块渲染表。
 *
 * 目录定义在 experience_block_catalog.json；这里登记可信的 React 渲染边界。
 * Phase 1（Step 6）起 QuickActionPanel/FilterBar 接了真实渲染；WorkflowTimeline
 * （2026-07-23）接了真实渲染，绑定 workflow 系统数据。其余类型
 * （MetricGrid/TrendChart/RankedList/ActivityFeed/DataTable）仍是占位，
 * 留给后续阶段接入。legacy 转换来的区块（_fromLegacy）不进这条渲染路径，
 * 视觉零变化。
 */
import React from "react";
import { Button, Select } from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  UserOutlined,
  MessageOutlined,
  FlagOutlined,
  ThunderboltOutlined,
  InfoCircleOutlined,
  RightOutlined,
  StarOutlined,
  RiseOutlined,
} from "@ant-design/icons";

import catalogJson from "@experience-blocks";
import type { WorkflowSection } from "../system-screens/five-system-model";
import type { RuntimeRow } from "./live-runtime";
import { buildEchartsOption } from "./build-echarts-option";

// ECharts 基建走独立 chunk（跟 AppRuntimeScreen 里那份同一个组件/同一个
// import()，Vite 按 module 去重成一个 chunk，不会重复打包）。
const LazyEchartsChart = React.lazy(() => import("./EchartsChart"));

export interface ExperienceBlockCatalogEntry {
  type: string;
  description: string;
  rendererKey: string;
  propsSchema: Record<string, unknown>;
  dataKinds: string[];
  allowedSlots: string[];
  events: string[];
}

/** FreeformInsight（2026-07-23）：二段生成产出的内容树，Python
 * freeform_block.py 用 Pydantic 深校验过（标签/样式/图标白名单 + dataRef
 * 强类型引用），前端渲染器仍然二次过滤，不单方面信任上游。 */
export interface FreeformDataRef {
  entityRef: string;
  aggregate?: string;
}
/** 真图表声明（2026-07-24）——不是 CSS 画的近似形状，是运行时拿真实行
 * 数据现算的 ECharts option，复用 build-echarts-option.ts 那套已经在用
 * 的确定性配色/分组逻辑，数据随真实数据变化自动更新。 */
export interface FreeformChartSpec {
  type: "bar" | "line" | "pie" | "donut";
  entityRef: string;
  dimensionFieldId: string;
  metric: "count" | "sum";
  metricFieldId?: string;
  metricLabel: string;
}
export interface FreeformNode {
  tag: string;
  style?: Record<string, string>;
  text?: string;
  iconRef?: string;
  dataRef?: FreeformDataRef;
  chart?: FreeformChartSpec;
  children?: FreeformNode[];
}

export interface ExperienceBlockInstance {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  /** FreeformInsight 专用：二段生成回填的内容树（生成失败时区块已被整体
   * 摘掉，不会出现"有 block 没内容"的悬空态，这里仍按 optional 处理是
   * 防御性的，不代表这是正常态）。类型收窄成 FreeformNode 在渲染器内部做
   * （renderFreeformNode 本来就要逐节点跑白名单校验，不能只在类型层面假装
   * 收窄过就信任内容）。 */
  freeformContent?: { root: Record<string, unknown> };
  _fromLegacy?: boolean;
  _legacyStat?: unknown;
  _legacyChart?: unknown;
  _legacyRanking?: unknown;
  _legacyFeed?: unknown;
}

/** Step 6 QuickActionPanel：已算好本页权限（permitted）+ 可读标签的候选按钮。 */
export interface QuickActionButtonSpec {
  id: string;
  label: string;
  permitted: boolean;
}

/** Step 6 FilterBar：本页过滤态——本地视图态，不进 STATE/RBAC/门禁。 */
export interface PageFilterState {
  enumFilters: Record<string, string | undefined>;
  dateRange?: [string, string] | null;
}

/** Step 6 FilterBar：可筛选的枚举字段及其取值选项（来自本页主实体）。 */
export interface FilterFieldOption {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface ExperienceBlockRendererProps {
  block: ExperienceBlockInstance;
  children?: React.ReactNode;
  /** Step 5：区块事件触发动作时的回调（actionId, eventData）。 */
  onAction?: (actionId: string, eventData?: Record<string, unknown>) => void;
  /** Step 6 QuickActionPanel 专用：本页 navigate/createRecord 候选动作。 */
  pageActions?: QuickActionButtonSpec[];
  /** Step 6 FilterBar 专用：当前过滤态。 */
  filterState?: PageFilterState;
  /** Step 6 FilterBar 专用：本页可筛的枚举字段。 */
  filterFieldOptions?: FilterFieldOption[];
  /** Step 6 FilterBar 专用：本页可用的日期范围字段（无则不渲染日期筛选）。 */
  dateRangeField?: { id: string; label: string } | null;
  /** Step 6 FilterBar 专用：过滤态变更回调（局部合并）。 */
  onFilterChange?: (patch: Partial<PageFilterState>) => void;
  /** WorkflowTimeline 专用：整份 workflow 系统数据，chainRef 从这里解析节点/连线，
   * 不接受自由文案——Gate 已校验 chainRef 能在这里面查到（留空=主链路）。 */
  workflow?: WorkflowSection | null;
  /** FreeformInsight chart 节点专用：entityId → 运行时真实行数据，key 是否
   * 存在本身就是"这个实体是否真实存在"的校验（initRuntimeState 会给数据
   * 模型里每个真实实体建 key，哪怕值是空数组）。 */
  entityRows?: Record<string, RuntimeRow[]>;
  /** FreeformInsight chart 节点专用：身份主题的图表配色（2026-07-24）——
   * 之前图表颜色是 build-echarts-option.ts 写死的几个常量，跟侧边栏/按钮
   * 用的身份主题完全无关；现在传主题自己的 primary/charts，颜色才能跟壳
   * 统一。不传时 buildEchartsOption 落到它自己的默认值，不会崩。 */
  chartPalette?: { primary: string; categorical: readonly string[] };
}

export type ExperienceBlockRenderer =
  React.ComponentType<ExperienceBlockRendererProps>;

interface ExperienceBlockCatalogFile {
  version: number;
  allowedSlots: string[];
  dataKinds: string[];
  eventTypes: string[];
  freeformAllowedTags: string[];
  freeformAllowedIconRefs: string[];
  freeformAllowedStyleProps: string[];
  blocks: ExperienceBlockCatalogEntry[];
}

export const EXPERIENCE_BLOCK_CATALOG =
  catalogJson as unknown as ExperienceBlockCatalogFile;

// 本阶段先把现有页面内容包进可信边界；真实区块内容在第三阶段接入。
const ExistingContentAdapter: ExperienceBlockRenderer = ({
  block,
  children,
}) =>
  children !== undefined && children !== null ? (
    <>{children}</>
  ) : (
    <div
      data-testid="pending-experience-block"
      className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500"
    >
      区块已登记，内容将在下一阶段接入：{block.type}
    </div>
  );

/**
 * Step 6：快捷操作面板——按钮来源是本页 pageActions 里 type 为
 * navigate/createRecord 的项（AppRuntimeScreen 已按当前角色算好 permitted）。
 * 无候选动作时如实显示"暂无可用操作"，不假装有按钮。
 */
const QuickActionPanelRenderer: ExperienceBlockRenderer = ({
  block,
  pageActions,
  onAction,
}) => {
  const title = String(block.props?.title ?? "").trim();
  const columnsRaw = Number(block.props?.columns);
  const columns =
    Number.isFinite(columnsRaw) && columnsRaw >= 1 && columnsRaw <= 4
      ? columnsRaw
      : 2;
  const actions = pageActions ?? [];
  return (
    <div
      data-testid="quick-action-panel"
      className="rounded border border-stone-200 bg-white px-3 py-2"
    >
      {title && (
        <div className="mb-2 text-xs font-medium text-stone-500">{title}</div>
      )}
      {actions.length === 0 ? (
        <div className="text-xs text-stone-400">暂无可用操作</div>
      ) : (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
        >
          {actions.map(a => (
            <Button
              key={a.id}
              size="small"
              disabled={!a.permitted}
              title={a.permitted ? undefined : "当前角色无此操作权限"}
              onClick={() => onAction?.(a.id)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Step 6：筛选栏——枚举字段来自本页主实体（AppRuntimeScreen 已过滤出
 * 有选项的 enum 字段）；日期范围仅当 props.showDateRange===true 且本页主
 * 实体确有 date/datetime 字段时渲染。变更经 onFilterChange 合并进页面级
 * 过滤态，同页 Table/看板/日历同步生效（同实体行数据共用一份过滤）。
 */
const FilterBarRenderer: ExperienceBlockRenderer = ({
  block,
  filterState,
  filterFieldOptions,
  dateRangeField,
  onFilterChange,
}) => {
  const title = String(block.props?.title ?? "").trim();
  const showDateRange = block.props?.showDateRange === true && !!dateRangeField;
  const fields = filterFieldOptions ?? [];
  if (!showDateRange && fields.length === 0) {
    return (
      <div
        data-testid="filter-bar-empty"
        className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-400"
      >
        筛选栏：本页无可筛选字段
      </div>
    );
  }
  const enumFilters = filterState?.enumFilters ?? {};
  const dateRange = filterState?.dateRange ?? null;
  const hasActive = Object.values(enumFilters).some(Boolean) || !!dateRange;
  return (
    <div
      data-testid="filter-bar"
      className="flex flex-wrap items-center gap-2 rounded border border-stone-200 bg-white px-3 py-2"
    >
      {title && (
        <span className="text-xs font-medium text-stone-500">{title}</span>
      )}
      {showDateRange && dateRangeField && (
        <span className="flex items-center gap-1 text-xs text-stone-500">
          <input
            type="date"
            className="rounded border border-stone-200 px-1.5 py-0.5 text-xs"
            value={dateRange?.[0]?.slice(0, 10) ?? ""}
            onChange={e => {
              const from = e.target.value;
              const to = dateRange?.[1] ?? e.target.value;
              onFilterChange?.({
                dateRange: from ? [from, to] : null,
              });
            }}
          />
          <span>至</span>
          <input
            type="date"
            className="rounded border border-stone-200 px-1.5 py-0.5 text-xs"
            value={dateRange?.[1]?.slice(0, 10) ?? ""}
            onChange={e => {
              const to = e.target.value;
              const from = dateRange?.[0] ?? e.target.value;
              onFilterChange?.({
                dateRange: to ? [from, to] : null,
              });
            }}
          />
        </span>
      )}
      {fields.map(f => (
        <Select
          key={f.id}
          size="small"
          allowClear
          placeholder={f.label}
          style={{ minWidth: 120 }}
          value={enumFilters[f.id]}
          options={f.options}
          onChange={v => onFilterChange?.({ enumFilters: { [f.id]: v } })}
          onClear={() => onFilterChange?.({ enumFilters: { [f.id]: undefined } })}
        />
      ))}
      {hasActive && (
        <Button
          size="small"
          type="link"
          onClick={() =>
            onFilterChange?.({
              enumFilters: Object.fromEntries(fields.map(f => [f.id, undefined])),
              dateRange: null,
            })
          }
        >
          重置
        </Button>
      )}
    </div>
  );
};

/**
 * 横向连接的流程阶段条——节点/顺序/条件全部从 workflow 系统机械派生，
 * 不接受自由文案。props.chainRef 留空指主链路（workflow.nodes/transitions），
 * 填值时必须能在 workflow.chains 里查到（Gate 已校验，这里直接信）。
 */
const WorkflowTimelineRenderer: ExperienceBlockRenderer = ({ block, workflow }) => {
  const title = String(block.props?.title ?? "").trim();
  const chainRef = String(block.props?.chainRef ?? "").trim();
  const chain = chainRef
    ? workflow?.chains?.find(c => c.id === chainRef || c.name === chainRef)
    : undefined;
  const nodes = (chainRef ? chain?.nodes : workflow?.nodes) ?? [];
  const transitions = (chainRef ? chain?.transitions : workflow?.transitions) ?? [];

  if (!workflow || nodes.length === 0) {
    return (
      <div
        data-testid="workflow-timeline-empty"
        className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-400"
      >
        流程步骤条：暂无可展示的流程节点
      </div>
    );
  }

  const conditionByFrom = new Map(
    transitions.filter(t => t.condition).map(t => [t.from, t.condition])
  );

  return (
    <div
      data-testid="workflow-timeline"
      className="rounded border border-stone-200 bg-white px-3 py-3"
    >
      {title && (
        <div className="mb-2 text-xs font-medium text-stone-500">{title}</div>
      )}
      <div className="flex flex-wrap items-stretch gap-1.5">
        {nodes.map((node, i) => (
          <React.Fragment key={node.id || i}>
            <div
              data-testid="workflow-timeline-node"
              className="flex min-w-[120px] flex-1 flex-col gap-1 rounded border border-stone-200 bg-stone-50 px-2.5 py-2"
            >
              <span className="text-[10px] font-mono text-stone-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-xs font-medium text-stone-700">
                {node.name || node.id}
              </span>
              {node.assigneeRole && (
                <span className="text-[10px] text-stone-400">
                  {node.assigneeRole}
                </span>
              )}
              {conditionByFrom.get(node.id) && (
                <span className="text-[10px] text-amber-600">
                  {conditionByFrom.get(node.id)}
                </span>
              )}
            </div>
            {i < nodes.length - 1 && (
              <ArrowRightOutlined className="self-center text-stone-300" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

/**
 * FreeformInsight（2026-07-23）安全渲染——只用 React.createElement 安全 API
 * 拼装，绝不 dangerouslySetInnerHTML/eval 任何 LLM 产出内容。白名单跟
 * Python 侧的 freeform_block.py 读同一份目录数据（@experience-blocks），
 * 改一处两边同步。这里是纵深防御的第二道：Python 已经用 Pydantic 深校验过
 * 才会落进 block.freeformContent，前端仍然过一遍白名单，不单方面信任上游。
 */
const FREEFORM_DANGEROUS_VALUE_RE = /url\(|javascript:|expression\(|import\b|@import/i;

// 2026-07-23：改用 @ant-design/icons（本文件其它渲染器、AppRuntimeScreen 顶栏/
// 侧栏早就在用同一套），跟应用其它地方的图标语言一致，线宽/比例也比手绘 SVG
// 路径更精细——手绘版视觉粗糙的问题就出在这批 path 数据本身。
const FREEFORM_ICONS: Record<string, React.ReactNode> = {
  "check-circle": <CheckCircleOutlined />,
  clock: <ClockCircleOutlined />,
  "alert-triangle": <WarningOutlined />,
  "arrow-right": <ArrowRightOutlined />,
  user: <UserOutlined />,
  "message-circle": <MessageOutlined />,
  flag: <FlagOutlined />,
  zap: <ThunderboltOutlined />,
  circle: <InfoCircleOutlined />,
  "chevron-right": <RightOutlined />,
  star: <StarOutlined />,
  "trending-up": <RiseOutlined />,
};

function sanitizeFreeformStyle(
  style: Record<string, string> | undefined
): React.CSSProperties {
  const allowed = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedStyleProps);
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const [k, v] of Object.entries(style)) {
    if (!allowed.has(k)) continue;
    if (FREEFORM_DANGEROUS_VALUE_RE.test(String(v))) continue;
    out[k] = v;
  }
  return out as React.CSSProperties;
}

const FREEFORM_CHART_TYPES = new Set(["bar", "line", "pie", "donut"]);

/** chart 节点二次校验（不单方面信任 Python 端 Pydantic 已经查过）：type
 * 在允许集合内、entityRef 在真实运行时行数据里存在这个 key（数据模型没有
 * 的实体，entityRows 里不会有这个 key）、dimensionFieldId 非空、metric 是
 * sum 时 metricFieldId 必须非空。任一条不满足就不渲染图表（不猜测、不
 * 崩溃），交回上层显示"内容生成中或暂不可用"同款诚实占位。 */
function renderFreeformChart(
  chart: FreeformChartSpec | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined,
  chartPalette: { primary: string; categorical: readonly string[] } | undefined,
  key: React.Key
): React.ReactNode {
  if (!chart || typeof chart !== "object") return null;
  if (!FREEFORM_CHART_TYPES.has(chart.type)) return null;
  if (!chart.entityRef || !entityRows || !(chart.entityRef in entityRows)) return null;
  if (!chart.dimensionFieldId) return null;
  if (chart.metric !== "count" && chart.metric !== "sum") return null;
  if (chart.metric === "sum" && !chart.metricFieldId) return null;

  const option = buildEchartsOption(
    {
      id: `freeform-chart-${key}`,
      label: chart.metricLabel || "",
      type: chart.type,
      entityId: chart.entityRef,
      dimensionFieldId: chart.dimensionFieldId,
      dimensionLabel: chart.dimensionFieldId,
      metric: chart.metric,
      metricFieldId: chart.metricFieldId,
      metricLabel: chart.metricLabel || "",
    },
    entityRows[chart.entityRef] ?? [],
    chartPalette
  );
  if (!option) {
    return (
      <div key={key} className="px-2 py-6 text-center text-xs text-stone-400">
        暂无数据 — 图表将在有真实记录后显示
      </div>
    );
  }
  return (
    <React.Suspense
      key={key}
      fallback={<div style={{ height: 200 }} className="animate-pulse bg-stone-50" />}
    >
      <LazyEchartsChart option={option} height={200} ariaLabel={chart.metricLabel} />
    </React.Suspense>
  );
}

/** dataRef 聚合 → 真实数字（2026-07-24 修复真实撞到的坑）：dataRef 之前
 * 只在 Python 侧校验过"entityRef/字段是否真实存在"，从没真正驱动过显示
 * 内容——渲染的其实是 LLM 自己写的 text 字面量，"数字必须真实、不能编"
 * 这个贯穿全链路的承诺在渲染这最后一步从没兑现：校验通过不等于数字是真
 * 的，LLM 写死一个假数字、只要字段名对得上一样能过 Pydantic 校验。这里
 * 直接从 entityRows 现算，不信任 LLM 写的 text。
 *
 * 只在 aggregate 存在时接管——aggregate 为空表示"纯引用实体、不声称具体
 * 数值"（Python 侧允许省略），那种场景本来就没有"数字对不对"的问题，
 * 留给 text 自己处理。 */
function computeDataRefText(
  dataRef: FreeformDataRef | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined
): string | null {
  if (!dataRef?.aggregate) return null;
  const rows = (entityRows ?? {})[dataRef.entityRef];
  if (!rows) return null;
  if (dataRef.aggregate === "count") {
    return rows.length.toLocaleString("zh-CN");
  }
  const m = /^(sum|avg):(.+)$/.exec(dataRef.aggregate);
  if (!m) return null;
  const [, kind, fieldId] = m;
  const nums = rows
    .map(r => Number(r.values[fieldId]))
    .filter(v => Number.isFinite(v));
  if (kind === "sum") {
    return nums
      .reduce((a, b) => a + b, 0)
      .toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  if (nums.length === 0) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return avg.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function renderFreeformNode(
  node: unknown,
  key: React.Key,
  entityRows?: Record<string, RuntimeRow[]>,
  chartPalette?: { primary: string; categorical: readonly string[] }
): React.ReactNode {
  if (!node || typeof node !== "object") return null;
  const n = node as FreeformNode;
  const allowedTags = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedTags);
  const tag = typeof n.tag === "string" && allowedTags.has(n.tag) ? n.tag : "div";
  const allowedIcons = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedIconRefs);
  const icon =
    n.iconRef && allowedIcons.has(n.iconRef) ? FREEFORM_ICONS[n.iconRef] : null;
  const chartNode = n.chart ? renderFreeformChart(n.chart, entityRows, chartPalette, "chart") : null;
  // chart 节点接管这块区域的内容，不再渲染 children/text（跟 Python 侧 prompt
  // 的约定一致：有 chart 字段的节点不该再让模型塞 children 进来画图表本身）。
  const children = chartNode
    ? []
    : (Array.isArray(n.children) ? n.children : []).map((child, i) =>
        renderFreeformNode(child, i, entityRows, chartPalette)
      );
  // dataRef 声明了 aggregate 就是"这是个数字承诺"——现算不出来（实体在
  // entityRows 里查不到/avg 没有合法数值行）也不能退回 LLM 写的 text 掩盖
  // 过去，如实显示「—」，跟别处"暂无数据"占位是同一套诚实原则。
  const hasNumericClaim = Boolean(n.dataRef?.aggregate);
  const dataRefText = hasNumericClaim
    ? (computeDataRefText(n.dataRef, entityRows) ?? "—")
    : null;
  return React.createElement(
    tag,
    { key, style: sanitizeFreeformStyle(n.style) },
    icon ? (
      <span
        key="icon"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "1em",
          height: "1em",
        }}
      >
        {icon}
      </span>
    ) : null,
    dataRefText ?? (typeof n.text === "string" ? n.text : null),
    chartNode,
    ...children
  );
}

const FreeformInsightRenderer: ExperienceBlockRenderer = ({ block, entityRows, chartPalette }) => {
  const root = block.freeformContent?.root;
  if (!root) {
    return (
      <div
        data-testid="freeform-insight-empty"
        className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-400"
      >
        洞察卡片：内容生成中或暂不可用
      </div>
    );
  }
  return (
    <div data-testid="freeform-insight" className="overflow-hidden rounded">
      {renderFreeformNode(root, "root", entityRows, chartPalette)}
    </div>
  );
};

export const EXPERIENCE_BLOCK_RENDERERS: Readonly<
  Record<string, ExperienceBlockRenderer>
> = Object.freeze({
  "metric-grid": ExistingContentAdapter,
  "trend-chart": ExistingContentAdapter,
  "ranked-list": ExistingContentAdapter,
  "activity-feed": ExistingContentAdapter,
  "data-table": ExistingContentAdapter,
  // Step 6：QuickActionPanel/FilterBar 真渲染（Phase 1）
  "quick-action-panel": QuickActionPanelRenderer,
  "filter-bar": FilterBarRenderer,
  "workflow-timeline": WorkflowTimelineRenderer,
  "freeform-insight": FreeformInsightRenderer,
});

export function experienceBlockEntry(
  type: string
): ExperienceBlockCatalogEntry | undefined {
  return EXPERIENCE_BLOCK_CATALOG.blocks.find(entry => entry.type === type);
}

/** 未知 type 或漏登记 renderer 时明确报不支持，不能白屏或假装成功。 */
export function ExperienceBlockBoundary({
  block,
  children,
  onAction,
  pageActions,
  filterState,
  filterFieldOptions,
  dateRangeField,
  onFilterChange,
  workflow,
  entityRows,
  chartPalette,
}: ExperienceBlockRendererProps) {
  const entry = experienceBlockEntry(block.type);
  const Renderer = entry
    ? EXPERIENCE_BLOCK_RENDERERS[entry.rendererKey]
    : undefined;
  if (!entry || !Renderer) {
    return (
      <div
        role="alert"
        data-testid="unsupported-experience-block"
        className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        暂不支持此区块：{block.type || "未声明类型"}
      </div>
    );
  }
  return (
    <Renderer
      block={block}
      onAction={onAction}
      pageActions={pageActions}
      filterState={filterState}
      filterFieldOptions={filterFieldOptions}
      dateRangeField={dateRangeField}
      onFilterChange={onFilterChange}
      workflow={workflow}
      entityRows={entityRows}
      chartPalette={chartPalette}
    >
      {children}
    </Renderer>
  );
}
