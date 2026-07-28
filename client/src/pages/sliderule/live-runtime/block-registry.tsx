/**
 * 体验区块渲染表。
 *
 * 目录定义在 experience_block_catalog.json；这里登记可信的 React 渲染边界。
 * Phase 1（Step 6）起 QuickActionPanel/FilterBar 接了真实渲染；WorkflowTimeline
 * 与 FreeformInsight（2026-07-23）接了真实渲染。其余类型
 * （MetricGrid/TrendChart/RankedList/ActivityFeed/DataTable）仍是占位，
 * 留给后续阶段接入。legacy 转换来的区块（_fromLegacy）不进这条渲染路径，
 * 视觉零变化。
 *
 * 这张表是「渲染器到底有没有」的唯一事实源。目录里每个区块的
 * rendererStatus 必须与这里一致，__tests__/ssot-parity.test.ts 对账——
 * 因为生成侧的放开名单（generationEnabled）以 rendererStatus 为前提，
 * 两边说法一旦分家，就会重演"放开了却渲染成惰性占位卡"的事故。
 */
import React from "react";
import {
  Button,
  Card,
  Empty,
  List,
  Progress,
  Select,
  Statistic,
  Table,
  Tag,
  theme as antdTheme,
  Timeline,
  Typography,
} from "antd";
// WorkflowTimeline 自己的节点箭头（组件 UI，用静态 import；freeform 的
// 动态图标解析走下面的 AntdIcons 命名空间 + 目录别名表，两回事）。
import { ArrowRightOutlined } from "@ant-design/icons";
// 全量图标命名空间——FreeformInsight 的 iconRef 按名字动态解析成任意 Ant
// Design 图标，不再限定在一个手维护的小集合里（2026-07-24）。legacy kebab
// 别名也走这条动态解析（映射表在目录 JSON 里，与 Python 侧同源），不再
// 静态 import 单个图标。
import * as AntdIcons from "@ant-design/icons";

import catalogJson from "@experience-blocks";
import type { WorkflowSection } from "../system-screens/five-system-model";
import type { RuntimeRow } from "./live-runtime";
import type { NormalizedFieldOption } from "./field-display";
import { buildEchartsOption } from "./build-echarts-option";

/** enum 字段取值声明的按需查询（entityId + fieldId → 归一化 options）。 */
export type EnumOptionsLookup = (
  entityId: string,
  fieldId: string
) => NormalizedFieldOption[];

/**
 * 字段显示名的按需查询（entityId + fieldId → 中文名）。
 *
 * DataTable 的列头本来直接打印字段 id（`lot_code` / `supplier_id`），跟同页
 * 其它表格的中文列名坐在一起格外刺眼。列定义在模型里，区块渲染器手里没有，
 * 所以跟 enumOptionsOf 一样按需查。查不到回落字段 id（不猜、不留空）。
 */
export type FieldLabelLookup = (
  entityId: string,
  fieldId: string
) => string | undefined;
import {
  buildFeedRows,
  buildRankedRows,
  buildTrendSeries,
  computeAggregate,
  parseAggregate,
  type TimeGrain,
} from "./block-data";

// ECharts 基建走独立 chunk（跟 AppRuntimeScreen 里那份同一个组件/同一个
// import()，Vite 按 module 去重成一个 chunk，不会重复打包）。
const LazyEchartsChart = React.lazy(() => import("./EchartsChart"));

export interface ExperienceBlockCatalogEntry {
  type: string;
  description: string;
  rendererKey: string;
  /** 事实：本文件的渲染表登记的是真渲染器还是 ExistingContentAdapter 占位。 */
  rendererStatus: "real" | "placeholder";
  /** 灰度决定：准不准让 LLM 往 page.blocks 里写这个类型（前提是 real）。 */
  generationEnabled: boolean;
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
  /**
   * FreeformInsight chart 节点专用：enum 字段的取值声明查询（2026-07-28）。
   * 页面图表的 options 在 schema 派生时就带上了，但 freeform 的 chart 节点
   * 是 LLM 现写的 `{entityRef, dimensionFieldId}`，手里没有字段定义——不给
   * 这个查询，环图图例就只能写取值 id（`refunded` / `unpaid`）。查不到返回
   * 空数组，图例回落原值。
   */
  enumOptionsOf?: EnumOptionsLookup;
  /** DataTable 专用：字段 id → 显示名，用于列头（2026-07-28）。 */
  fieldLabelOf?: FieldLabelLookup;
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
  /** 图标组件名形状正则（与 Python freeform_block.py 同源派生） */
  freeformIconNamePattern: string;
  /** 老 kebab 语义名 → Ant Design 组件名（与 Python 侧同源派生） */
  freeformLegacyIconAliases: Record<string, string>;
  freeformAllowedStyleProps: string[];
  blocks: ExperienceBlockCatalogEntry[];
}

export const EXPERIENCE_BLOCK_CATALOG =
  catalogJson as unknown as ExperienceBlockCatalogFile;

// 本阶段先把现有页面内容包进可信边界；真实区块内容在第三阶段接入。
// 导出仅为 SSOT 对账：测试据此判定某个 rendererKey 登记的是真渲染器还是占位。
export const ExistingContentAdapter: ExperienceBlockRenderer = ({
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

// 老的 kebab 语义名 → Ant Design 组件名（放开图标白名单之前用的 12 个，历史
// 生成产物里可能还有，保留兼容）。2026-07-26 起映射表不再在 TS 手抄——从
// 目录 JSON 派生（Python freeform_block.py 用同一份的键集合做校验），改目录
// 一处两端同步。新产物直接用 Ant Design 组件名（见 resolveFreeformIcon）。
const LEGACY_FREEFORM_ICONS: Record<string, string> =
  EXPERIENCE_BLOCK_CATALOG.freeformLegacyIconAliases;

// 合法的 Ant Design 图标组件名形状：PascalCase + Outlined/Filled/TwoTone 结尾。
// 这个正则同时是安全边界——只让"图标组件名"形状的字符串进来，挡掉
// @ant-design/icons 里那些非图标导出（createFromIconfontCN / getTwoToneColor
// 之类工具函数，它们不以这三个后缀结尾），也挡掉 __proto__/constructor 这类
// 原型链名字（首字符要求大写字母、且整体匹配）。定义在目录 JSON 里，与
// Python 侧 _ANTD_ICON_NAME_RE 同源派生。
export const FREEFORM_ICON_NAME_RE = new RegExp(
  EXPERIENCE_BLOCK_CATALOG.freeformIconNamePattern
);

/** iconRef → React 节点：老 kebab 别名走静态表，其余按 Ant Design 组件名
 * 动态解析。名字非法/在包里查不到（拼错、编造、非图标导出）一律返回 null，
 * 渲染成空、优雅降级——图标名永远只当组件名查表，从不被当代码执行。 */
function resolveFreeformIcon(iconRef: string | undefined): React.ReactNode {
  if (!iconRef) return null;
  // hasOwnProperty 保护：普通对象取键会落到原型链上（"__proto__" 会取到
  // Object.prototype、"constructor" 取到 Object），不 guard 的话这些名字会
  // 返回一个非 React 元素的对象、渲染时崩。别名表和命名空间取值都要 guard。
  let componentName = iconRef;
  if (Object.prototype.hasOwnProperty.call(LEGACY_FREEFORM_ICONS, iconRef)) {
    componentName = LEGACY_FREEFORM_ICONS[iconRef];
  }
  if (!FREEFORM_ICON_NAME_RE.test(componentName)) return null;
  if (!Object.prototype.hasOwnProperty.call(AntdIcons, componentName)) return null;
  const Cmp = (AntdIcons as Record<string, unknown>)[componentName];
  if (typeof Cmp !== "object" && typeof Cmp !== "function") return null;
  return React.createElement(Cmp as React.ComponentType);
}

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
  enumOptionsOf: EnumOptionsLookup | undefined,
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
      // 维度是 enum 时，图例照声明的 label 显示，不写取值 id
      dimensionOptions: enumOptionsOf?.(chart.entityRef, chart.dimensionFieldId),
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
  // SQL/pandas 语义（SUM over 空集 = NULL；pandas sum(min_count=1) = NaN）：
  // 一行合法数值都没有时 sum 不能显 "0" 冒充真值——用户分不清"真的是 0"
  // 和"根本没数据"。sum/avg 统一：无合法数值 → null → 上层如实显「—」。
  if (nums.length === 0) return null;
  if (kind === "sum") {
    return nums
      .reduce((a, b) => a + b, 0)
      .toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return avg.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

/** 不可信内容树的硬上限（micromark/cmark 同款纪律：解析不可信输入必须带
 * 嵌套/规模上限，超限截断降级，而不是任由深树把递归栈打爆、整个应用舞台
 * 白屏）。Python 生成侧 freeform_block.py 有同值的校验拦在 reask 环里；
 * 这里是纵深防御第二道——持久化快照恢复、历史产物同样走这条路径。 */
export const FREEFORM_MAX_DEPTH = 12;
export const FREEFORM_MAX_NODES = 300;

interface FreeformRenderBudget {
  remaining: number;
  truncated: boolean;
}

function renderFreeformNode(
  node: unknown,
  key: React.Key,
  entityRows?: Record<string, RuntimeRow[]>,
  chartPalette?: { primary: string; categorical: readonly string[] },
  enumOptionsOf?: EnumOptionsLookup,
  // 根节点记 depth=1（与 Python _freeform_tree_bounds 同一计法——两侧
  // 上限必须真同值，root=0 会让前端多放一层）。
  depth = 1,
  budget?: FreeformRenderBudget
): React.ReactNode {
  if (!node || typeof node !== "object") return null;
  if (!budget) budget = { remaining: FREEFORM_MAX_NODES, truncated: false };
  if (depth > FREEFORM_MAX_DEPTH || budget.remaining <= 0) {
    budget.truncated = true;
    return null;
  }
  budget.remaining -= 1;
  const n = node as FreeformNode;
  const allowedTags = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedTags);
  const tag = typeof n.tag === "string" && allowedTags.has(n.tag) ? n.tag : "div";
  // 图标不再查 catalog 白名单，改成按 Ant Design 组件名动态解析（老 kebab
  // 名走别名表）——放开图标集，非法/查不到的名字 resolveFreeformIcon 返回
  // null，渲染成空、优雅降级。
  const icon = resolveFreeformIcon(typeof n.iconRef === "string" ? n.iconRef : undefined);
  const chartNode = n.chart
    ? renderFreeformChart(n.chart, entityRows, chartPalette, enumOptionsOf, "chart")
    : null;
  // chart 节点接管这块区域的内容，不再渲染 children/text（跟 Python 侧 prompt
  // 的约定一致：有 chart 字段的节点不该再让模型塞 children 进来画图表本身）。
  const children = chartNode
    ? []
    : (Array.isArray(n.children) ? n.children : []).map((child, i) =>
        renderFreeformNode(
          child,
          i,
          entityRows,
          chartPalette,
          enumOptionsOf,
          depth + 1,
          budget
        )
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

const FreeformInsightRenderer: ExperienceBlockRenderer = ({
  block,
  entityRows,
  chartPalette,
  enumOptionsOf,
}) => {
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
  const budget: FreeformRenderBudget = {
    remaining: FREEFORM_MAX_NODES,
    truncated: false,
  };
  const rendered = renderFreeformNode(
    root,
    "root",
    entityRows,
    chartPalette,
    enumOptionsOf,
    1,
    budget
  );
  return (
    <div data-testid="freeform-insight" className="overflow-hidden rounded">
      {rendered}
      {budget.truncated ? (
        <div
          data-testid="freeform-insight-truncated"
          className="px-3 py-1 text-[11px] text-stone-400"
        >
          内容超出安全渲染上限，已截断
        </div>
      ) : null}
    </div>
  );
};


// ── 五个数据区块的真渲染器（2026-07-28）─────────────────────────────
// 此前它们登记的是 ExistingContentAdapter：页面上画一个灰框写"下一阶段接入"。
//
// 共同纪律（三条都来自这套代码库既有的诚实降级传统）：
// 1. binding 已经过门禁校验，但运行时**再判一次**——门禁看的是模型声明，
//    这里拿到的是用户真写进去的行，两者可能对不上（迭代改了字段名、
//    那一列全是空的）。判不了就出诚实空态，不猜也不崩。
// 2. "没有数据"和"算不出来"要显示成不同的东西，不能都糊成 0 或 —。
// 3. 数字格式化一律交给 antd Statistic，不自己拼（参考 ProComponents 的
//    Statistic：它本身就是 antd Statistic 的薄包装，只加 icon/描述/趋势，
//    格式化从不自己写）。

/**
 * 区块外壳：统一标题与留白，让区块在槽位里排起来是一套东西。
 *
 * 用 antd Card 而不是手写 div（原来是
 * `rounded border border-stone-200 bg-white px-3 py-2`，本质就是个简陋版
 * Card）。换过来的实际收益不是"少写几行"，是三件手写版做不到的事：
 *
 * 1. **吃主题**。外层 ConfigProvider 把 colorPrimary 设成了这个应用的身份
 *    主题色，antd 组件自动跟随；手写的 stone-200/白底不认这套，于是琥珀色
 *    的咖啡应用里混着一堆中性灰卡片。
 * 2. **吃 algorithm**。深色/紧凑/高对比是通过 antd 的 theme algorithm 全局
 *    切的，手写色值在深色模式下就是一块白斑。
 * 3. 头部/描边/圆角/hover 跟页面里其余 antd 组件严丝合缝，不用手动对齐。
 */
function BlockShell({
  title,
  testid,
  extra,
  children,
}: {
  title?: string;
  testid: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || extra);
  return (
    <Card
      data-testid={testid}
      size="small"
      title={title ? <span style={{ fontSize: 13 }}>{title}</span> : undefined}
      extra={extra}
      // 没标题时去掉 body 的额外内边距，免得纯图表区块上下各空一截
      styles={{ body: { padding: hasHeader ? 12 : 10 } }}
      style={{ height: "100%" }}
    >
      {children}
    </Card>
  );
}

/**
 * 空态：说清楚"为什么没有"，不是一句冷冰冰的暂无数据。
 *
 * 用 antd Empty 拿到统一的插画与留白；description 仍然是我们自己写的那句
 * 具体原因——Empty 默认文案是「暂无数据」，正是这里最不该出现的话。
 */
function BlockEmpty({ hint }: { hint: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      styles={{ image: { height: 40 } }}
      description={
        <span style={{ fontSize: 12, color: "var(--sr-text-muted, #8c8c8c)" }}>
          {hint}
        </span>
      }
    />
  );
}

/** binding 里取实体行；实体在运行时不存在（被迭代删掉等）时返回 null 而不是空数组，
 *  好让渲染器区分"这个实体没了"和"这个实体一条数据都没有"。 */
function rowsOfBinding(
  block: ExperienceBlockInstance,
  entityRows: Record<string, RuntimeRow[]> | undefined
): { entityRef: string; rows: RuntimeRow[] } | null {
  const entityRef = String(block.binding?.entityRef ?? "").trim();
  if (!entityRef || !entityRows || !(entityRef in entityRows)) return null;
  return { entityRef, rows: entityRows[entityRef] ?? [] };
}

const MetricGridRenderer: ExperienceBlockRenderer = ({ children, block, entityRows }) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell title={title} testid="metric-grid">
        <BlockEmpty hint="指标未绑定到有效实体" />
      </BlockShell>
    );
  const spec = parseAggregate(block.binding?.aggregate);
  const value = computeAggregate(bound.rows, spec);
  const label =
    spec.kind === "count"
      ? "记录数"
      : `${spec.kind === "sum" ? "合计" : "平均"} · ${spec.fieldId}`;
  return (
    <BlockShell title={title} testid="metric-grid">
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))" }}>
        <div data-testid="metric-grid-item" className="rounded bg-stone-50 px-3 py-2">
          {value === null ? (
            // 算不出来（该字段一行都没有效值）≠ 0，如实说
            <>
              <div className="text-[11px] text-stone-400">{label}</div>
              <div className="text-lg font-semibold text-stone-400">—</div>
              <div className="text-[10px] text-stone-400">该字段暂无有效数值</div>
            </>
          ) : (
            <Statistic
              title={<span className="text-[11px] text-stone-400">{label}</span>}
              value={value}
              precision={Number.isInteger(value) ? 0 : 1}
              valueStyle={{ fontSize: 20, fontWeight: 600 }}
            />
          )}
        </div>
      </div>
    </BlockShell>
  );
};

const TrendChartRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  chartPalette,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const timeField = String(block.binding?.timeDimensionRef ?? "").trim();
  if (!bound || !timeField)
    return (
      <BlockShell title={title} testid="trend-chart">
        <BlockEmpty hint="趋势未绑定到有效的时间字段" />
      </BlockShell>
    );
  const rawGrain = String(block.binding?.timeGrain ?? "day");
  const grain: TimeGrain =
    rawGrain === "week" || rawGrain === "month" ? rawGrain : "day";
  const series = buildTrendSeries(
    bound.rows,
    timeField,
    grain,
    parseAggregate(block.binding?.aggregate)
  );
  if (!series)
    return (
      <BlockShell title={title} testid="trend-chart">
        <BlockEmpty hint={`暂无数据 — 写入「${timeField}」后自动出图`} />
      </BlockShell>
    );
  const GRAIN_LABEL: Record<TimeGrain, string> = {
    day: "按天",
    week: "按周",
    month: "按月",
  };
  const option = {
    animation: false,
    tooltip: { confine: true, trigger: "axis" },
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: series.categories,
      axisLabel: { fontSize: 10, color: "#8c8c8c" },
    },
    yAxis: { type: "value", axisLabel: { fontSize: 10, color: "#8c8c8c" } },
    series: [
      {
        type: "line",
        smooth: false,
        showSymbol: series.categories.length <= 20,
        data: series.values,
        itemStyle: { color: chartPalette?.primary ?? "#1677ff" },
        areaStyle: { opacity: 0.08 },
      },
    ],
  };
  return (
    <BlockShell
      title={title}
      testid="trend-chart"
      extra={
        <span className="text-[10px] text-stone-400" data-testid="trend-chart-grain">
          {GRAIN_LABEL[series.grain]}
          {/* 粒度是被自动放粗的就说出来，否则用户会以为自己声明的粒度生效了 */}
          {series.coarsened ? "（区间过长已自动放粗）" : ""}
        </span>
      }
    >
      <React.Suspense
        fallback={<div className="px-2 py-6 text-center text-xs text-stone-400">图表加载中…</div>}
      >
        <LazyEchartsChart option={option} height={160} ariaLabel={title || "趋势"} />
      </React.Suspense>
    </BlockShell>
  );
};

const RankedListRenderer: ExperienceBlockRenderer = ({ children, block, entityRows, onAction }) => {
  // 取当前生效的主题 token：区块要跟应用的身份主题同色，写死色值做不到
  const { token } = antdTheme.useToken();
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const sortField = String(block.binding?.sortByRef ?? "").trim();
  if (!bound || !sortField)
    return (
      <BlockShell title={title} testid="ranked-list">
        <BlockEmpty hint="排行未绑定到有效的数值字段" />
      </BlockShell>
    );
  const order = block.binding?.sortOrder === "asc" ? "asc" : "desc";
  const items = buildRankedRows(
    bound.rows,
    sortField,
    undefined,
    order,
    Number(block.binding?.limit ?? 5)
  );
  if (items.length === 0)
    return (
      <BlockShell title={title} testid="ranked-list">
        <BlockEmpty hint={`暂无数据 — 写入「${sortField}」后自动排名`} />
      </BlockShell>
    );
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  return (
    <BlockShell title={title} testid="ranked-list">
      <List
        size="small"
        split={false}
        dataSource={items}
        renderItem={(item, i) => (
          <List.Item
            data-testid="ranked-list-item"
            style={{ padding: "4px 0", cursor: onAction ? "pointer" : undefined }}
            onClick={() => onAction?.("itemSelect", { rowId: item.row.id })}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              {/* 前三名用主题色实心徽标，其余中性——名次的强弱靠颜色区分，
                  但颜色取自 token，不再是写死的靛蓝（那会跟应用主题色打架） */}
              {/* 前三名用主题色，其余中性。
                  不能用 color="processing"——那是 antd 的固定语义蓝，不跟
                  colorPrimary 走；对照台上切成琥珀主题后名次标签仍然是蓝的。 */}
              <Tag
                color={i < 3 ? token.colorPrimary : undefined}
                style={{
                  marginInlineEnd: 0,
                  minWidth: 22,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {i + 1}
              </Tag>
              <Typography.Text
                ellipsis={{ tooltip: item.label }}
                style={{ flex: 1, minWidth: 0, fontSize: 12 }}
              >
                {item.label}
              </Typography.Text>
              {/* 条形只是相对长度，真值仍然写在右边——只给条不给数看不出量级。
                  Progress 自带主题色与无障碍语义，比手写的 span 条强。 */}
              {/* strokeColor 必须显式给：Progress 在 percent>=100 时会自动切成
                  success 绿，于是排行第一名的条永远是绿的、其余是默认蓝，
                  跟应用主题色全无关系（对照台上一眼看得出）。 */}
              <Progress
                percent={Math.round((Math.abs(item.value) / max) * 100)}
                showInfo={false}
                size={["small", 6]}
                strokeColor={token.colorPrimary}
                trailColor={token.colorFillSecondary}
                style={{ width: 72, marginBottom: 0 }}
              />
              <Typography.Text
                type="secondary"
                style={{
                  width: 52,
                  textAlign: "right",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isInteger(item.value) ? item.value : item.value.toFixed(1)}
              </Typography.Text>
            </div>
          </List.Item>
        )}
      />
    </BlockShell>
  );
};

const ActivityFeedRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  enumOptionsOf,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const timeField = String(block.binding?.timeFieldRef ?? "").trim();
  if (!bound || !timeField)
    return (
      <BlockShell title={title} testid="activity-feed">
        <BlockEmpty hint="动态未绑定到有效的时间字段" />
      </BlockShell>
    );
  const levelField = String(block.binding?.levelFieldRef ?? "").trim() || undefined;
  const items = buildFeedRows(bound.rows, timeField, levelField);
  // 等级字段的取值声明：拿它把 `available` 显示成「可用」，并用声明里的 tone
  // 决定节点颜色。查不到就原样显示取值，不猜。
  const levelDecl = levelField
    ? new Map(
        (enumOptionsOf?.(bound.entityRef, levelField) ?? []).map(o => [o.id, o])
      )
    : null;
  if (items.length === 0)
    return (
      <BlockShell title={title} testid="activity-feed">
        <BlockEmpty hint={`暂无动态 — 写入「${timeField}」后按时间倒序展示`} />
      </BlockShell>
    );
  return (
    <BlockShell title={title} testid="activity-feed">
      {/* 动态流就是 Timeline 的原型用法：一条时间轴串起按时间倒序的事件。
          手写版是"小圆点 + 两行字"，横向 90% 是空白、圆点还写死 #5b6cff，
          在琥珀色主题的应用里格外扎眼。Timeline 的轴线与节点都吃主题 token。 */}
      {/* Timeline 默认每项 padding-bottom:20px，8 条动态就有 480px 高，把总览页
          首屏吃光。收紧到 10px 后既保留时间轴的形态，密度又跟旧版相当。

          用**逐项 inline style**而不是 Tailwind 的 `[&_.ant-timeline-item]:pb-2.5`：
          试过了，不生效——antd v5 的 CSS-in-JS 在运行时往 head 注样式，
          跟 Tailwind 工具类同为 (0,2,0) 特异性，注入顺序又在后面，于是赢的
          是 antd。inline style 直接压过样式表，不用跟特异性较劲。 */}
      <Timeline
        style={{ marginTop: 4, marginBottom: 0 }}
        items={items.map((item, i) => {
          const decl = item.level ? levelDecl?.get(item.level) : undefined;
          return {
          // 最后一项去掉底部 padding，免得卡片底下空一截
          style: { paddingBottom: i === items.length - 1 ? 0 : 10 },
          key: item.row.id,
          // 用声明里的 tone 着色，把"这条是什么性质"直接画在轴上
          color: toneTimelineColor(decl?.tone),
          children: (
            <div
              data-testid="activity-feed-item"
              style={{ cursor: onAction ? "pointer" : undefined }}
              onClick={() => onAction?.("itemSelect", { rowId: item.row.id })}
            >
              {/* 标签紧跟在标题后面。第一版给标题加了 flex:1 又限了 maxWidth，
                  结果标签被推到 520px 那个边界上，孤零零飘在行中间——比原来
                  贴右边还怪。这里不给 flex，标题按内容宽度收缩（长了才省略），
                  标签自然紧随其后。 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Typography.Text
                  ellipsis={{ tooltip: item.title }}
                  style={{ maxWidth: 320, fontSize: 12 }}
                >
                  {item.title}
                </Typography.Text>
                {item.level && (
                  // 出声明里的 label（「可用」），不是取值 id（`available`）
                  <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    {decl?.label ?? item.level}
                  </Tag>
                )}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {item.dateKey}
              </Typography.Text>
            </div>
          ),
          };
        })}
      />
    </BlockShell>
  );
};

/**
 * 枚举 tone → Timeline 节点颜色。
 *
 * 第一版在这里写了个**关键词猜测器**（匹配「冻结/异常/warn/pending」之类），
 * 对照台一跑就露馅：枚举取值是 `available` / `frozen` 这种英文 id，中文规则
 * 一条都没命中，八个节点全是同一个颜色，等于白写。
 *
 * 真正的问题是不该猜——模型声明里每个枚举取值本来就带 `tone`
 *（success/processing/warning/danger/default，见 five_system_legal.json，
 * 而且门禁校验过）。同一份 tone 已经在驱动表格里的彩色标签，这里直接复用，
 * 颜色语义天然跟页面其它地方一致。
 */
function toneTimelineColor(tone: string | undefined): string {
  if (tone === "danger") return "red";
  if (tone === "warning") return "orange";
  if (tone === "success") return "green";
  // processing / default / 查不到 → 主题色（antd 的 "blue" 走 colorPrimary）
  return "blue";
}

const DataTableRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell title={title} testid="data-table">
        <BlockEmpty hint="表格未绑定到有效实体" />
      </BlockShell>
    );
  if (bound.rows.length === 0)
    return (
      <BlockShell title={title} testid="data-table">
        <BlockEmpty hint="暂无数据 — 点「新建」写入第一条真实数据" />
      </BlockShell>
    );
  // 列取自真实行的键（binding 只声明 entityRef，其余列由页面派生——
  // 见 catalog 里 DataTable 的 bindingSchema note）。最多 5 列，够看不挤。
  const cols = [...new Set(bound.rows.flatMap(r => Object.keys(r.values ?? {})))].slice(0, 5);
  const columns = cols.map(c => {
    // 枚举列出标签不出取值 id：同一份数据在页面自带表格里是「已冻结」，
    // 在区块里却是 `frozen`，坐在一起就露馅了
    const options = enumOptionsOf?.(bound.entityRef, c) ?? [];
    const labelOf = new Map(options.map(o => [o.id, o.label]));
    return {
      key: c,
      dataIndex: c,
      title: fieldLabelOf?.(bound.entityRef, c) ?? c,
      ellipsis: true,
      render: (_: unknown, row: RuntimeRow) => {
        const raw = row.values?.[c];
        const s = String(raw ?? "").trim();
        if (!s) return <Typography.Text type="secondary">—</Typography.Text>;
        return labelOf.get(s) ?? s;
      },
    };
  });
  return (
    <BlockShell
      title={title}
      testid="data-table"
      // 截断如实说在标题栏，不再是表格底下一行灰字（那行容易被当成数据）
      extra={
        bound.rows.length > 8 ? (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            共 {bound.rows.length} 条，显示前 8 条
          </Typography.Text>
        ) : undefined
      }
    >
      {/* 换 antd Table：拿到省略号 tooltip、粘性表头、紧凑尺寸与主题描边，
          手写 <table> 这些都得自己补，而且列头字号/颜色跟同页别的表格对不齐 */}
      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={bound.rows.slice(0, 8)}
        pagination={false}
        // 不给 scroll.x：区块是页面里的一块，横向滚动条藏在卡片里没人会去拉，
        // 对照台上表格直接被卡片右边缘切掉、最后一列看不见。列共享可用宽度 +
        // 省略号（有 tooltip）才是这个尺寸下该有的行为。
        tableLayout="fixed"
        onRow={row => ({
          "data-testid": "data-table-row",
          onClick: () => onAction?.("rowSelect", { rowId: row.id }),
          style: { cursor: onAction ? "pointer" : undefined },
        })}
      />
    </BlockShell>
  );
};

export const EXPERIENCE_BLOCK_RENDERERS: Readonly<
  Record<string, ExperienceBlockRenderer>
> = Object.freeze({
  // 2026-07-28：五个数据区块接真渲染（此前是 ExistingContentAdapter 占位）
  "metric-grid": MetricGridRenderer,
  "trend-chart": TrendChartRenderer,
  "ranked-list": RankedListRenderer,
  "activity-feed": ActivityFeedRenderer,
  "data-table": DataTableRenderer,
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
/**
 * 区块渲染分发口。
 *
 * 这里**整包透传 props**，不逐个列举。2026-07-28 之前是把每个 prop 解构出来
 * 再手写一遍转发，于是新增 enumOptionsOf 时漏了这一处——类型全绿、单测全绿，
 * 环图图例照样写着取值 id，只有真跑截图才看得出来。逐个列举等于每加一个
 * prop 就埋一次同样的雷，改成 {...props} 之后这一类漏传不可能再发生。
 */
export function ExperienceBlockBoundary(props: ExperienceBlockRendererProps) {
  const { block } = props;
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
  return <Renderer {...props} />;
}
