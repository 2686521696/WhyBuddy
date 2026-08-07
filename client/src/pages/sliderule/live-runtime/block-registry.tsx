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
import dayjs from "dayjs";
import {
  Button,
  Card,
  Empty,
  Flex,
  List,
  Progress,
  Steps,
  Table,
  Tag,
  theme as antdTheme,
  Timeline,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import {
  ProCard,
  ProFormDateRangePicker,
  ProFormSelect,
  QueryFilter,
  StatisticCard,
} from "@ant-design/pro-components";
// WorkflowTimeline 自己的节点箭头（组件 UI，用静态 import；freeform 的
// 动态图标解析走下面的 AntdIcons 命名空间 + 目录别名表，两回事）。
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
import {
  buildSparklineOption,
  computeDataRefTrend,
  formatTrendLabel,
  type DataRefTrend,
} from "./dataref-trend";

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
  type FeedItem,
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
  /** 同实体下的日期字段。给了就在大数字下面出环比 + 迷你走势线（2026-07-29）。 */
  trendFieldRef?: string;
  /** 分桶粒度 day|week|month，默认 day。 */
  trendGrain?: string;
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
/**
 * 逐行真实数据（2026-08-03）——排行榜/动态流/最近记录这类"一行一行"的内容。
 *
 * 取代了此前的 blockRef（从固定积木清单里挑一个摆进来）。blockRef 存在的
 * 唯一理由是 dataRef 只能取聚合值、设计模型画不了逐行内容；但固定积木长什么
 * 样由组件写死，参照图上的版式落不了地。现在把逐行能力直接补给设计模型：
 * **版式它自由画，数据我们喂真的**，固定积木那条通道整体删除。
 *
 * 声明这个字段的节点是列表容器，它的 children 是**一行**的模板，按取到的
 * 行数重复渲染；模板里带 fieldRef 的节点替换成那一行的真实值。
 */
export interface FreeformRowsRef {
  entityRef: string;
  /** 模板里允许读取的字段白名单（Python 侧强制非空并逐个校验存在）。 */
  fieldRefs: string[];
  sortByRef?: string;
  order?: "asc" | "desc";
  limit?: number;
}

export interface FreeformNode {
  tag: string;
  style?: Record<string, string>;
  text?: string;
  iconRef?: string;
  imageRef?: "landing-hero";
  imageAlt?: string;
  dataRef?: FreeformDataRef;
  chart?: FreeformChartSpec;
  rowsRef?: FreeformRowsRef;
  /** 取当前行的字段值——只在 rowsRef 子树内有意义。 */
  fieldRef?: string;
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
  /** Resolves trusted generated assets; never accepts a model-provided URL. */
  sessionId?: string;
  /** One-time self-review token; resolves only the trusted landing hero endpoint. */
  previewId?: string;
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
 *
 * 2026-08-07：**一个候选动作都没有时整块不渲染**（原来是画一张卡 + 一个
 * "暂无可用操作"的空态）。
 *
 * 原注释的理由是"如实显示，不假装有按钮"——返回 null 同样没有假装任何东西，
 * 而那张空卡是有代价的：实测首页上它占 115px，而它上面/下面还排着别的积木，
 * 一起把 KPI 挤出首屏。产品在别处已经表过同一个态：喂给设计 LLM 的 brief 里
 * 明说过逐行内容"只能画出表头+空表身，比留白还难看"，所以刻意不让 LLM 画
 * （freeform_block._monitor_overview_design_brief）。渲染端理应同一条纪律。
 *
 * ⚠️ 这不是把信息藏起来：区块的声明仍然在模型里、门禁照常能标它，
 * "这一页没有可用动作"这件事本身由"没有按钮"表达得很清楚，不需要再用
 * 一张卡去说一遍。真正需要解释"为什么没有"的场景（比如权限不足），走的是
 * 按钮 disabled + title 提示那条路，不是这里。
 */
const QuickActionPanelRenderer: ExperienceBlockRenderer = ({
  block,
  pageActions,
  onAction,
}) => {
  if ((pageActions ?? []).length === 0) return null;
  const title = String(block.props?.title ?? "").trim();
  const columnsRaw = Number(block.props?.columns);
  const columns =
    Number.isFinite(columnsRaw) && columnsRaw >= 1 && columnsRaw <= 4
      ? columnsRaw
      : 2;
  const actions = pageActions ?? [];
  return (
    <ProCard
      data-testid="quick-action-panel"
      size="small"
      title={title || undefined}
      bordered
    >
      {actions.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用操作" />
      ) : (
        <Flex wrap gap="small">
          {actions.map(a => (
            <Button
              key={a.id}
              size="small"
              disabled={!a.permitted}
              title={a.permitted ? undefined : "当前角色无此操作权限"}
              onClick={() => onAction?.(a.id)}
              style={{ flex: `1 1 calc(${100 / columns}% - 8px)` }}
            >
              {a.label}
            </Button>
          ))}
        </Flex>
      )}
    </ProCard>
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
      <ProCard data-testid="filter-bar-empty" size="small" bordered>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="本页无可筛选字段"
        />
      </ProCard>
    );
  }
  const enumFilters = filterState?.enumFilters ?? {};
  const dateRange = filterState?.dateRange ?? null;
  const initialValues: Record<string, unknown> = { ...enumFilters };
  if (showDateRange && dateRange) {
    initialValues.dateRange = dateRange.map(value => dayjs(value));
  }

  const applyValues = (values: Record<string, unknown>) => {
    const nextEnumFilters = Object.fromEntries(
      fields.map(field => [
        field.id,
        typeof values[field.id] === "string"
          ? (values[field.id] as string)
          : undefined,
      ])
    );
    const rawDateRange = values.dateRange;
    const nextDateRange =
      Array.isArray(rawDateRange) && rawDateRange.length === 2
        ? (rawDateRange.map(value => {
            if (typeof value === "string") return value.slice(0, 10);
            if (
              value &&
              typeof value === "object" &&
              "format" in value &&
              typeof value.format === "function"
            ) {
              return value.format("YYYY-MM-DD");
            }
            return "";
          }) as [string, string])
        : null;

    onFilterChange?.({
      enumFilters: nextEnumFilters,
      dateRange:
        nextDateRange?.[0] && nextDateRange[1] ? nextDateRange : null,
    });
  };

  const filterForm = (
    <QueryFilter
      data-testid="filter-bar"
      defaultCollapsed={false}
      span={{ xs: 24, sm: 24, md: 12, lg: 12, xl: 8, xxl: 8 }}
      initialValues={initialValues}
      onFinish={async values => {
        applyValues(values);
        return true;
      }}
      onReset={() =>
        onFilterChange?.({
          enumFilters: Object.fromEntries(fields.map(field => [field.id, undefined])),
          dateRange: null,
        })
      }
    >
      {showDateRange && dateRangeField && (
        <ProFormDateRangePicker
          name="dateRange"
          label={dateRangeField.label}
          fieldProps={{ style: { width: "100%" } }}
        />
      )}
      {fields.map(f => (
        <ProFormSelect
          key={f.id}
          name={f.id}
          label={f.label}
          options={f.options}
          fieldProps={{ allowClear: true, style: { width: "100%" } }}
        />
      ))}
    </QueryFilter>
  );
  return title ? (
    <ProCard size="small" title={title} bordered bodyStyle={{ padding: 0 }}>
      {filterForm}
    </ProCard>
  ) : (
    filterForm
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
      <ProCard data-testid="workflow-timeline-empty" size="small" bordered>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无可展示的流程节点"
        />
      </ProCard>
    );
  }

  const conditionByFrom = new Map(
    transitions.filter(t => t.condition).map(t => [t.from, t.condition])
  );

  return (
    <ProCard
      data-testid="workflow-timeline"
      size="small"
      title={title || undefined}
      bordered
    >
      <Steps
        size="small"
        responsive
        current={-1}
        items={nodes.map((node, index) => ({
          key: node.id || String(index),
          title: (
            <span data-testid="workflow-timeline-node">
              {node.name || node.id}
            </span>
          ),
          description: (
            <Flex vertical gap={2}>
              {node.assigneeRole && (
                <Typography.Text type="secondary">
                  {node.assigneeRole}
                </Typography.Text>
              )}
              {conditionByFrom.get(node.id) && (
                <Typography.Text type="warning">
                  {conditionByFrom.get(node.id)}
                </Typography.Text>
              )}
            </Flex>
          ),
        }))}
      />
    </ProCard>
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

/** lineHeight 不带单位时是字号的倍数（CSS 规范特例），不是像素值——真机
 * 逮到过 LLM 把它当像素写（比如给 28px 字号配 lineHeight: 32，本意是"行高
 * 32px"），结果渲染成 32 倍字号 = 896px 的行高，整行 KPI 卡被撑到 1000+px，
 * 后面的图表/列表全被挤出可视区域。Python 侧 freeform_block.py 的
 * check_style 已经在生成时拦这个模式，但持久化的历史产物/快照恢复不走那
 * 条校验，这里是渲染层的第二道防线：裸数字倍数超过这个阈值直接丢弃该
 * 属性（回退浏览器默认行高），不静默"纠正"成某个猜测值——安全，但不会
 * 把版式挤爆。 */
const LINE_HEIGHT_RATIO_MAX = 4;
const BARE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

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
    if (k === "lineHeight" && BARE_NUMBER_RE.test(String(v)) && Number(v) > LINE_HEIGHT_RATIO_MAX) {
      continue; // 裸数字倍数离谱地大——多半是把像素值当倍数写，丢弃回退默认行高
    }
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

/** rowsRef 单次取行上限——与 Python 侧 ROWS_REF_MAX_LIMIT 同值。
 *
 * Python 那边 Pydantic 已经夹过一次，这里是纵深防御第二道：持久化快照恢复
 * 走的是渲染这条路，不再过 Pydantic，老快照或手工改过的数据一样能进来。 */
export const ROWS_REF_MAX_LIMIT = 20;
export const ROWS_REF_DEFAULT_LIMIT = 5;

/**
 * rowsRef → 真实行数据（排序 + 截断）。
 *
 * 跟 computeDataRefText 同一套诚实原则：查不到实体就返回空数组，让上层如实
 * 显示空态，绝不编造占位行——"这一行看起来像真的但其实是假的"比空着更糟。
 */
function resolveRowsRef(
  rowsRef: FreeformRowsRef | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined
): RuntimeRow[] {
  if (!rowsRef || typeof rowsRef !== "object") return [];
  const rows = (entityRows ?? {})[rowsRef.entityRef];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const limit = Math.max(
    1,
    Math.min(
      ROWS_REF_MAX_LIMIT,
      Number.isFinite(rowsRef.limit) ? Number(rowsRef.limit) : ROWS_REF_DEFAULT_LIMIT
    )
  );
  const sortBy = rowsRef.sortByRef;
  if (!sortBy) return rows.slice(0, limit);
  // 不给的字段/不可比的值一律沉底，保持排序稳定——排序键缺失时保持原顺序，
  // 不让"没有这个字段的行"随机跳到榜首。
  const dir = rowsRef.order === "asc" ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, v: row.values?.[sortBy] }));
  keyed.sort((a, b) => {
    const an = Number(a.v);
    const bn = Number(b.v);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum && an !== bn) return (an - bn) * dir;
    if (!aNum || !bNum) {
      const as = a.v == null ? "" : String(a.v);
      const bs = b.v == null ? "" : String(b.v);
      if (as !== bs) return as.localeCompare(bs, "zh-CN") * dir;
    }
    return a.i - b.i;
  });
  return keyed.slice(0, limit).map(k => k.row);
}

/** 一个单元格的显示值。空/不可读一律显「—」，跟 dataRef 算不出来时同一个记号。 */
function formatRowCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  const s = String(value);
  return s.trim() === "" ? "—" : s;
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

/** 环比方向 → 颜色。用的是 antd 的状态色，跟 PageViews 的 TONE_COLORS 同一组。
 *
 * 按**方向**上色而不是按好坏——"涨了是不是好事"取决于这个指标是营收还是
 * 退款率，schema 里没有这个信息，我们也不该猜。参考图和 antd Statistic 文档
 * 都是这个做法（涨绿跌红），这是这类卡片的既定读法，不另发明一套。 */
const TREND_COLORS: Record<DataRefTrend["direction"], string> = {
  up: "#52c41a",
  down: "#ff4d4f",
  flat: "#8c8c8c",
};
const TREND_ARROWS: Record<DataRefTrend["direction"], string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

/**
 * KPI 数字的第二、三层：环比文案 + 迷你走势线（2026-07-29）。
 *
 * 形状对标 ant-design/pro-components 的 StatisticCard——Statistic 出
 * `trend: 'up' | 'down'` + `description`，StatisticCard 出 `chart` 槽位
 * （`chartPlacement: 'bottom'`）。参考图上每张 KPI 卡都是这三层，我们此前
 * 只有第一层，schema 也表达不了后两层。
 *
 * 字号/字重/行高**显式重置**：挂 dataRef 的那个节点通常自带 `fontSize: 32`
 * `fontWeight: 700`（它是大数字本体），环比小字若继承下来会变成第二个大数字。
 * 外层一律用 `display: block` 的 span：dataRef 节点可能是 `<span>`，往里塞
 * `<div>` 是非法嵌套。
 */
function renderDataRefTrend(
  dataRef: FreeformDataRef | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined,
  chartPalette: { primary: string; categorical: readonly string[] } | undefined
): React.ReactNode {
  if (!dataRef?.trendFieldRef) return null;
  const trend = computeDataRefTrend((entityRows ?? {})[dataRef.entityRef], dataRef);
  if (!trend) return null;
  const color = TREND_COLORS[trend.direction];
  const sparkOption = buildSparklineOption(trend.spark, chartPalette?.primary || "#1677ff");
  return (
    <span key="dataref-trend" data-testid="dataref-trend" style={{ display: "block" }}>
      <span
        data-testid="dataref-trend-delta"
        data-direction={trend.direction}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginTop: 4,
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.4,
          letterSpacing: 0,
          color,
        }}
      >
        <span aria-hidden="true">{TREND_ARROWS[trend.direction]}</span>
        {formatTrendLabel(trend)}
      </span>
      {sparkOption ? (
        <span data-testid="dataref-sparkline" style={{ display: "block", marginTop: 6 }}>
          <React.Suspense fallback={<span style={{ display: "block", height: 32 }} />}>
            <LazyEchartsChart option={sparkOption} height={32} ariaLabel="走势" />
          </React.Suspense>
        </span>
      ) : null}
    </span>
  );
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

/**
 * 渲染 freeform 子树需要的全套上下文。
 *
 * 2026-07-29 从三个散参（entityRows / chartPalette / enumOptionsOf）改成一个
 * 对象：继续加散参会让这个函数的位置参数上到十个，漏传一个又是一次
 * "类型全绿、真跑没效果"（enumOptionsOf 刚这么栽过）。
 */
interface FreeformRenderCtx {
  /** 区块渲染 props（entityRows / chartPalette / enumOptionsOf 等都在里面） */
  blockProps: ExperienceBlockRendererProps;
  /**
   * 当前行——只在 rowsRef 展开出来的那棵子树里有值（2026-08-03）。
   * fieldRef 节点从这里取值；不在 rowsRef 内时是 undefined，fieldRef 渲染成
   * 「—」而不是崩掉（Python 侧已经拦过作用域外的 fieldRef，这里是第二道）。
   */
  row?: RuntimeRow;
  /** 当前行允许读取的字段白名单，同上，来自最近一层 rowsRef.fieldRefs。 */
  rowFields?: ReadonlySet<string>;
}

function renderFreeformNode(
  node: unknown,
  key: React.Key,
  ctx: FreeformRenderCtx,
  // 根节点记 depth=1（与 Python _freeform_tree_bounds 同一计法——两侧
  // 上限必须真同值，root=0 会让前端多放一层）。
  depth = 1,
  budget?: FreeformRenderBudget
): React.ReactNode {
  const { entityRows, chartPalette, enumOptionsOf } = ctx.blockProps;
  if (!node || typeof node !== "object") return null;
  if (!budget) budget = { remaining: FREEFORM_MAX_NODES, truncated: false };
  if (depth > FREEFORM_MAX_DEPTH || budget.remaining <= 0) {
    budget.truncated = true;
    return null;
  }
  budget.remaining -= 1;
  const n = node as FreeformNode;
  // blockRef 时代的存量节点：整个不渲染，**连位置也不占**（2026-08-04）。
  //
  // blockRef 通道在 rowsRef 上线时整条删掉了（schema + 渲染器），但**库里已经
  // 存着的模型没人管**——那些节点还在设计树里，带着自己的 style（flex:1 /
  // width:32%）却没有任何渲染器认领它，于是变成一块**撑着版面的空白**。
  // 真机长这样：绘本小站首页 KPI 行右边空掉三分之一、图表行右边又空掉一块，
  // 分别对应存量树里的 QuickActionPanel / WorkflowTimeline / ActivityFeed
  // 三个 children 为空的 blockRef 节点。
  //
  // 为什么在渲染端跳过而不是写迁移脚本改库：这跟 generatedTheme 那个字段是同一
  // 类问题（存量数据带着一个已经没有消费方的字段），仓库既有的处理方式就是
  // "读进来直接忽略，不需要迁移" —— 迁移脚本要跑、要回滚、还会在跑完之前留下
  // 一段新旧混杂的中间态，而这里想要的效果只是"当它不存在"。
  //
  // 判定条件带上 children 为空：blockRef 节点按当年的约定本来就不写 children
  // （积木接管那块区域）。万一有哪个节点既挂 blockRef 又有真实 children，
  // 那些 children 是真内容，不能跟着一起丢。
  if (
    (n as { blockRef?: unknown }).blockRef &&
    !(Array.isArray(n.children) && n.children.length > 0)
  ) {
    return null;
  }
  const allowedTags = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedTags);
  const tag = typeof n.tag === "string" && allowedTags.has(n.tag) ? n.tag : "div";
  // 图标不再查 catalog 白名单，改成按 Ant Design 组件名动态解析（老 kebab
  // 名走别名表）——放开图标集，非法/查不到的名字 resolveFreeformIcon 返回
  // null，渲染成空、优雅降级。
  const icon = resolveFreeformIcon(typeof n.iconRef === "string" ? n.iconRef : undefined);
  const chartNode = n.chart
    ? renderFreeformChart(n.chart, entityRows, chartPalette, enumOptionsOf, "chart")
    : null;
  // rowsRef：这个节点是列表容器，children 是**一行**的模板，按真实行数重复。
  // 展开发生在这里（渲染期）而不是设计树里——模板只写一次，所以设计树不会
  // 因为行数多而变大；重复出来的节点照样逐个扣 budget，行数再多也吃不穿预算。
  const rowsNode = (() => {
    if (!n.rowsRef) return null;
    const rows = resolveRowsRef(n.rowsRef, entityRows);
    // 一行都没有时如实空着，交给设计里自己写的空态文案/上层占位——绝不
    // 编造占位行冒充真实数据（同 computeDataRefText 的诚实原则）。
    if (rows.length === 0) return null;
    const template = Array.isArray(n.children) ? n.children : [];
    const fields: ReadonlySet<string> = new Set(
      Array.isArray(n.rowsRef.fieldRefs) ? n.rowsRef.fieldRefs : []
    );
    return rows.map((row, ri) =>
      template.map((child, ci) =>
        renderFreeformNode(
          child,
          `r${ri}-${ci}`,
          { ...ctx, row, rowFields: fields },
          depth + 1,
          budget
        )
      )
    );
  })();
  // chart / rowsRef 节点接管这块区域的内容，不再走普通 children 渲染（跟
  // Python 侧 prompt 的约定一致：挂了这两个字段的节点不自己另画一套）。
  //
  // ⚠ rowsRef 判定看的是**字段在不在**，不是 rowsNode 有没有值：一行数据都
  // 取不到时 rowsNode 是 null，若在这里 fall through 去渲染 children，等于把
  // "一行的模板"当普通内容画一遍——屏幕上出现一条所有字段都是「—」的行，
  // 看着像真有这么一条记录。那正是这次要消灭的东西，所以空数据时渲染成空。
  const children = chartNode
    ? []
    : n.rowsRef
      ? (rowsNode ?? [])
      : (Array.isArray(n.children) ? n.children : []).map((child, i) =>
          renderFreeformNode(child, i, ctx, depth + 1, budget)
        );
  // dataRef 声明了 aggregate 就是"这是个数字承诺"——现算不出来（实体在
  // entityRows 里查不到/avg 没有合法数值行）也不能退回 LLM 写的 text 掩盖
  // 过去，如实显示「—」，跟别处"暂无数据"占位是同一套诚实原则。
  const hasNumericClaim = Boolean(n.dataRef?.aggregate);
  const dataRefText = hasNumericClaim
    ? (computeDataRefText(n.dataRef, entityRows) ?? "—")
    : null;
  // 环比/走势线只在数字真算出来时才挂：主数字都是「—」还配一条走势线，
  // 等于用图形给一个不存在的数字背书。
  const trendNode =
    dataRefText && dataRefText !== "—"
      ? renderDataRefTrend(n.dataRef, entityRows, chartPalette)
      : null;
  // fieldRef → 当前行的真实字段值。跟 dataRefText 同一个位置、同一套纪律：
  // 取不到就是「—」，不回落 LLM 写的 text 假装有值。
  //
  // 白名单在这里再查一遍（Python 侧 FreeformDesign 已经拦过一次）：快照恢复
  // 走渲染这条路，不再过 Pydantic，声明外的字段不能因为换了条路就读得到。
  const fieldRefText =
    typeof n.fieldRef === "string"
      ? ctx.row && ctx.rowFields?.has(n.fieldRef)
        ? formatRowCell(ctx.row.values?.[n.fieldRef])
        : "—"
      : null;
  const landingHeroSrc =
    n.imageRef === "landing-hero"
      ? ctx.blockProps.previewId
        ? `/api/sliderule/freeform-preview/${encodeURIComponent(ctx.blockProps.previewId)}/media/landing-hero`
        : ctx.blockProps.sessionId
          ? `/api/sliderule/sessions/${encodeURIComponent(ctx.blockProps.sessionId)}/preview?source=sheet`
          : null
      : null;
  const imageNode =
    landingHeroSrc ? (
      <img
        key="image"
        src={landingHeroSrc}
        alt={typeof n.imageAlt === "string" ? n.imageAlt : ""}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    ) : null;
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
    fieldRefText ?? dataRefText ?? (typeof n.text === "string" ? n.text : null),
    trendNode,
    imageNode,
    chartNode,
    ...children
  );
}

const FreeformInsightRenderer: ExperienceBlockRenderer = props => {
  const { block } = props;
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
  // 整包透传：嵌进来的积木要拿到跟 page.blocks 一模一样的 props，
  // 逐个列举等于每加一个 prop 就埋一次漏传（见 ExperienceBlockBoundary 那次）。
  const rendered = renderFreeformNode(root, "root", { blockProps: props }, 1, budget);
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
      // 2026-07-28：去掉边框。区块永远渲染在页卡（defaultPageContent 的
      // 那张 Card）里面，两层都画边框就是圆角套圆角——真跑截图上很扎眼。
      //
      // 解法照 ant-design/pro-components 的 ProCard `ghost`
      //（src/card/components/Card/style.ts 的 '&&-ghost'：backgroundColor
      // transparent / border none / boxShadow none）：**卡片表面由最外层容器
      // 提供一次，内层只保留结构**。这里比 ghost 保守一档——只去边框，留白底
      // 和内边距，区块之间仍有分块感，不至于糊成一片。
      variant="borderless"
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
      <StatisticCard title={title || undefined} data-testid="metric-grid">
        <BlockEmpty hint="指标未绑定到有效实体" />
      </StatisticCard>
    );
  const spec = parseAggregate(block.binding?.aggregate);
  const value = computeAggregate(bound.rows, spec);
  const label =
    spec.kind === "count"
      ? "记录数"
      : `${spec.kind === "sum" ? "合计" : "平均"} · ${spec.fieldId}`;
  return (
    <StatisticCard
      data-testid="metric-grid"
      title={title || undefined}
      statistic={{
        title: <span data-testid="metric-grid-item">{label}</span>,
        value: value ?? "—",
        precision: value !== null && Number.isInteger(value) ? 0 : 1,
        description:
          value === null ? (
            <Typography.Text type="secondary">该字段暂无有效数值</Typography.Text>
          ) : undefined,
      }}
      bodyStyle={{ height: "100%" }}
    />
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

/**
 * 动态流的宽行档（2026-07-29）。
 *
 * 起因是拿参考图跟真实渲染对照：参考图把动态流画成一条满宽的信息行
 *（状态 | 单号 | 描述 | 关联单据 | 时间），真实渲染是一条窄时间轴，右边三分之二
 * 全空。宽度不是 bug——积木拿到的就是满宽，是时间轴这个形态本身撑不满。
 *
 * 用 **antd Table**，不是 List 里手拼 flex 行。前两版都是 flex（先 List.Item.Meta
 * 两层、后单行 flex 分栏），真跑截图上露了同一个馅：每行的状态标签宽度不一样
 *（待审核/烘焙中/已退回），后面几列的起点就**逐行错开**几像素，一眼能看出来歪。
 * flex 行没有跨行约束，每行各算各的宽度，对齐只能靠内容碰巧一样长。
 *
 * Table 靠 `<colgroup>` 从结构上解决：rc-table 的 ColGroup 按列发一个
 * `<col style={{width}}>`（es/ColGroup.js），所有行共享同一组列宽，对不齐这件事
 * 在这个方案里不可能发生。而且只要有一列声明 `ellipsis`，rc-table 就把
 * `tableLayout` 切到 `fixed`（es/Table.js:447-463），没写宽度的列均分剩余空间——
 * 正好是"明细列铺满整行"要的行为，不用自己算百分比。
 *
 * 列构成：状态点 | 单号+标签 | 明细列… | 时间，跟参考图那条 feed 行一一对应。
 * 中段明细由 binding.detailFieldRefs 声明——只加 variant 不加字段的话，宽行只是
 * 把同样三条信息摊开，比时间轴更空。
 */
function FeedRowList({
  items,
  entityRef,
  detailFields,
  levelDecl,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
}: {
  items: FeedItem[];
  entityRef: string;
  detailFields: string[];
  levelDecl: Map<string, NormalizedFieldOption> | null;
  onAction?: ExperienceBlockRendererProps["onAction"];
  fieldLabelOf?: FieldLabelLookup;
  enumOptionsOf?: EnumOptionsLookup;
}) {
  const { token } = antdTheme.useToken();
  // 明细列的枚举取值表一次建好：跟 DataTable 同一条纪律——同一份数据在别处
  // 显示「已冻结」，这里不能显示 `frozen`。
  const detailLabelOf = new Map(
    detailFields.map(f => [
      f,
      new Map((enumOptionsOf?.(entityRef, f) ?? []).map(o => [o.id, o.label])),
    ])
  );

  const columns: TableColumnsType<FeedItem> = [
    {
      key: "__tone",
      width: 20,
      render: (_, item) => {
        const decl = item.level ? levelDecl?.get(item.level) : undefined;
        // 时间轴的节点色在宽行里退化成一个小圆点：颜色语义（tone）保留，
        // 但不再画那条竖线——一行一行的表里画竖轴反而干扰阅读。
        return (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: toneDotColor(decl?.tone, token.colorPrimary),
            }}
          />
        );
      },
    },
    {
      key: "__title",
      width: 220,
      ellipsis: true,
      render: (_, item) => {
        const decl = item.level ? levelDecl?.get(item.level) : undefined;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Typography.Text ellipsis={{ tooltip: item.title }} style={{ fontSize: 12 }}>
              {item.title}
            </Typography.Text>
            {item.level && (
              // 出声明里的 label（「可用」），不是取值 id（`available`）
              <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>{decl?.label ?? item.level}</Tag>
            )}
          </span>
        );
      },
    },
    // 明细列不给 width：table-layout:fixed 下没写宽度的列**均分剩余空间**，
    // 于是几列自然铺满整行，不用自己算百分比。
    ...detailFields.map(f => ({
      key: f,
      ellipsis: true,
      render: (_: unknown, item: FeedItem) => {
        const raw = String(item.row.values?.[f] ?? "").trim();
        if (!raw) return <Typography.Text type="secondary">—</Typography.Text>;
        const label = fieldLabelOf?.(entityRef, f) ?? f;
        const value = detailLabelOf.get(f)?.get(raw) ?? raw;
        // 值本身已经以字段名开头时不再重复标签——「使用生豆 使用生豆 1」读起来
        // 像口吃。演示种子数据正是这个形状（string/ref 字段的种子值就是
        // 「字段名 序号」），真实数据里也有「状态：状态待定」这类。
        const prefix = value.startsWith(label) ? "" : `${label} `;
        return (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {prefix}
            <Typography.Text style={{ fontSize: 11 }}>{value}</Typography.Text>
          </Typography.Text>
        );
      },
    })),
    {
      key: "__date",
      width: 92,
      align: "right" as const,
      render: (_: unknown, item: FeedItem) => (
        <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
          {item.dateKey}
        </Typography.Text>
      ),
    },
  ];

  return (
    <Table
      size="small"
      rowKey={item => item.row.id}
      // 动态流不是数据表：参考图上这块也没有表头，一行就是一条动态。列头交给
      // 单元格里那个灰色小标签（「出豆重量 136」），比一整条表头更轻。
      // showHeader=false 不影响 <colgroup>——rc-table 的 bodyColGroup 是独立
      // 渲染的（es/Table.js:583），列宽照样逐列对齐。
      showHeader={false}
      columns={columns}
      dataSource={items}
      pagination={false}
      onRow={item => ({
        onClick: () => onAction?.("itemSelect", { rowId: item.row.id }),
        style: { cursor: onAction ? "pointer" : undefined },
        // onRow 的返回值原样摊到 <tr> 上（rc-table GetComponentProps），
        // data-* 一并透传，测试和截图脚本靠它数行数
        "data-testid": "activity-feed-row",
      })}
      // 不给 scroll.x，理由同 DataTable：区块是页面里的一块，横向滚动条藏在
      // 卡片里没人会去拉。列共享可用宽度 + 省略号（带 tooltip）才对。
    />
  );
}

const ActivityFeedRenderer: ExperienceBlockRenderer = ({
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
  // 表现档位：宽行 vs 时间轴。未声明/写了个不认识的值一律回默认时间轴——
  // 档位是长相不是数据，认不出来时给个能看的形态，不能白屏。
  if (String(block.props?.variant ?? "").trim() === "row") {
    const detailFields = (
      Array.isArray(block.binding?.detailFieldRefs) ? block.binding.detailFieldRefs : []
    )
      .map(f => String(f ?? "").trim())
      // 运行时再判一次字段是否真的在行里（门禁看的是模型声明，这里拿到的是
      // 用户真写进去的行）；顺带排掉已经在标题/标签/时间位置露过面的字段，
      // 同一个值在一行里出现两次比不显示更糟。
      .filter(f => f && f !== timeField && f !== levelField)
      .filter(f => items.some(it => String(it.row.values?.[f] ?? "").trim() !== ""))
      .slice(0, 3);
    return (
      <BlockShell title={title} testid="activity-feed">
        <FeedRowList
          items={items}
          entityRef={bound.entityRef}
          detailFields={detailFields}
          levelDecl={levelDecl}
          onAction={onAction}
          fieldLabelOf={fieldLabelOf}
          enumOptionsOf={enumOptionsOf}
        />
      </BlockShell>
    );
  }
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

/**
 * 同样的 tone，宽行档要的是**真 CSS 色值**。
 *
 * 不能直接复用 toneTimelineColor：那个返回的是 antd Timeline 的预设名
 *（"red"/"green"/"blue"），只有 Timeline 认得，塞进 background 是个非法值，
 * 圆点会渲染成透明。状态三色跟 PageViews 的 TONE_COLORS 同一组。
 *
 * processing/default 落到主题色，由调用方从 `theme.useToken()` 传进来——
 * 第一版写的是 `var(--sr-primary, #1677ff)`，那个变量**整个代码库里没人定义**
 * （连隔壁的 --sr-text-muted 也一直在吃 fallback），等于把"跟随主题"写成了
 * 永远的品牌蓝，在这次的墨绿主题里就是一个突兀的蓝点。
 */
function toneDotColor(tone: string | undefined, primary: string): string {
  if (tone === "danger") return "#ff4d4f";
  if (tone === "warning") return "#faad14";
  if (tone === "success") return "#52c41a";
  return primary;
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
