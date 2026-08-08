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
  Checkbox,
  Empty,
  Flex,
  List,
  Progress,
  Result,
  Space,
  Steps,
  Table,
  Tabs,
  Tag,
  theme as antdTheme,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import {
  CellEditorTable,
  DragSortTable,
  DrawerForm,
  ModalForm,
  ProCard,
  ProDescriptions,
  ProForm,
  ProFormDateRangePicker,
  ProFormDatePicker,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  QueryFilter,
  RowEditorTable,
  StatisticCard,
  StepsForm,
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

/**
 * 字段类型的按需查询（entityId + fieldId → 数据模型里声明的类型）。
 *
 * 表单族积木（RecordForm / RecordFormDialog / StepsForm）靠它决定每个字段
 * 出哪种控件：enum→下拉、number→数字、date→日期、text→多行。**查不到就按
 * string 处理，不猜**——跟 fieldLabelOf 查不到回落字段 id 是同一条纪律。
 */
export type FieldTypeLookup = (
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
  /** 这个区块能落在哪些页面区域（2026-08-08 从 allowedSlots 换过来）。 */
  allowedRegions: string[];
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

/**
 * 本页的行选择态 —— DataTable 勾选，BatchActionBar 读。
 *
 * 2026-08-08：跟 PageFilterState 同一套路（本地视图态，不进 STATE/RBAC/门禁）。
 * 单独拎出来是因为**批量操作栏没有选择态就是个空壳**——照 pro-components 的
 * `table/components/Alert`，它只在 selectedRowKeys 非空时才渲染。
 *
 * 这个项目刚踩过一次同类的坑：QuickActionPanel 第一行就是"没有 pageActions
 * 就返回 null"，而装配预览从来没传过，于是它一直渲染成空气、没人发现。所以
 * 这次先把数据通路接上，再建区块。
 */
export interface PageSelectionState {
  /** 被勾选的行 id。按实体分组——一页可能有不止一张表。 */
  rowIds: Record<string, string[]>;
}

/**
 * 一张表的列视图态 —— ColumnSettingPanel 改，DataTable 读。
 *
 * 2026-08-08 照 pro-components 的 ColumnSetting 建的（②批次 1）。它那边这些
 * 状态住在 TableContext 的 `columnsMap: Record<key, {show, fixed, order}>` 里；
 * 我们**按区块 id 存**，跟 ①b 的 targets 同一套路——一页可能有两张表，状态混
 * 在一起就是当初 filterState 串台的同一个 bug。
 *
 * 三样各存各的，而不是塞进一个 `Record<field, {...}>`：
 * 判断"这列被隐藏了吗"要遍历整表，而 `hidden.includes(f)` 一眼就懂。
 */
export interface BlockColumnState {
  /** 被取消勾选的字段 id。**存隐藏而不是存显示**——数据模型加字段时，
   *  新字段默认可见才是对的；存显示的话新字段会莫名其妙不出现。 */
  hidden: string[];
  /** 显式排过序的字段 id。只含被挪动过的，其余按原顺序补在后面。 */
  order: string[];
  /** 固定在左/右的列。不在表里就是不固定。 */
  fixed: Record<string, "left" | "right">;
}

/** 按区块 id 存的列视图态。key 是**目标表格区块的 id**，不是实体名。 */
export type PageColumnState = Record<string, BlockColumnState>;

export const EMPTY_COLUMN_STATE: BlockColumnState = { hidden: [], order: [], fixed: {} };

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
  /** DataTable 勾选 / BatchActionBar 读：本页的行选择态。 */
  selection?: PageSelectionState;
  /** 行选择变更回调（DataTable 勾选、BatchActionBar 清空都走它）。 */
  onSelectionChange?: (entityRef: string, rowIds: string[]) => void;
  /** ColumnSettingPanel 改 / DataTable 读：按区块 id 存的列视图态。 */
  columnState?: PageColumnState;
  /** 列视图态变更回调。blockId 是**目标表格的 id**，不是面板自己的 id。 */
  onColumnStateChange?: (blockId: string, next: BlockColumnState) => void;
  /** ColumnSettingPanel 专用：目标表格当前的列（字段 id，按当前顺序）。
   *  不传的话面板不知道该列出什么——它自己不绑行数据。 */
  targetColumns?: string[];
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
  /** 表单族专用：字段 id → 类型，决定出哪种控件（2026-08-07）。 */
  fieldTypeOf?: FieldTypeLookup;
}

export type ExperienceBlockRenderer =
  React.ComponentType<ExperienceBlockRendererProps>;

interface ExperienceBlockCatalogFile {
  version: number;
  /**
   * 页面区域目录 —— 键是区域名，值带中文名、摆在哪条带、以及它在
   * ant-design/pro-blocks 那 29 个真实页面里的出处。
   *
   * 2026-08-08 收编：此前区域语法只有 Python 有、前端手抄一份；现在两边同读
   * 这个文件。同时它取代了旧的 allowedSlots（五个名字实测只有两种行为）。
   */
  pageRegions: Record<string, { label: string; band: string; evidence: string }>;
  /** 范式语法：哪个范式有哪些区域、多重、必不必填、收哪类区块。 */
  pageArchetypes: Record<
    string,
    { label: string; when: string; pageOwnsMain?: boolean;
      regions: { key: string; why: string; weight: string; required: boolean;
                 accepts: string[]; maxBlocks: number }[] }
  >;
  pageRegionBands: string[];
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
/**
 * 区块外壳 —— **标题与操作区是这个区块自己的，卡片只是可选的表面**。
 *
 * ## 2026-08-08 为什么重做
 *
 * 用户的判断（原话）：「你把信息全绑在 card 上面了，这是不对的……你实际要把
 * 这些信息绑在组件上……你不可能每个外面都套一个 card。」
 *
 * 之前这个函数是一个 antd Card，标题走 Card 的 `title` 属性、右上角操作走
 * `extra`。后果是**信息由壳提供**：想去掉卡片，标题和「编辑」「共 N 条」
 * 这些就跟着一起没了。我上一轮的说法（"拆了就变成没标题的裸组件"）正是
 * 这个错误结构逼出来的。
 *
 * 现在拆成两件独立的事：
 *
 *   · 头部（标题 + 操作区）**由区块自己画**，是它 DOM 的一部分，
 *     跟外面有没有卡片无关
 *   · 表面（白底 + 内边距那层卡片）由 `props.surface` 决定，
 *     缺省 "card" —— 已生成的应用一个都不会变样
 *
 * ## 为什么留 surface 这个开关而不是直接删掉卡片
 *
 * 区块渲染在页卡里面时，白底叠白底确实多余；但它也会被摆在灰底网格上
 * （组装页、总览页），那时候没有白底就糊成一片。**这是排布决定的，不是
 * 区块决定的**，所以做成可切换，由组装方按位置选，默认保持今天的样子。
 *
 * 到三五百个组件之后这条更重要：卡片是 100 多种布局里的一种选择，
 * 不能是每个组件出厂就焊死的。
 */
function BlockShell({
  title,
  testid,
  extra,
  block,
  children,
}: {
  title?: string;
  testid: string;
  extra?: React.ReactNode;
  /** 传了就读 props.surface；不传等同于 "card"（老调用点无需改） */
  block?: ExperienceBlockInstance;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || extra);
  const plain = block?.props?.surface === "plain";

  // 头部：区块自己的 DOM。字号/间距照抄原先 Card title 的观感，
  // 这样默认档位下改完前后逐像素一致。
  const header = hasHeader ? (
    <div
      data-testid={`${testid}-header`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 38,
        padding: plain ? "0 0 8px" : "0 12px",
        borderBottom: plain ? "none" : "1px solid rgba(5,5,5,0.06)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{title}</span>
      {extra}
    </div>
  ) : null;

  const body = (
    <div style={{ padding: plain ? 0 : hasHeader ? 12 : 10 }}>{children}</div>
  );

  if (plain) {
    return (
      <div data-testid={testid} style={{ height: "100%" }}>
        {header}
        {body}
      </div>
    );
  }

  return (
    <Card
      data-testid={testid}
      size="small"
      // 注意：**不再走 Card 的 title/extra**。头部是上面那个 div，属于区块。
      styles={{ body: { padding: 0 } }}
      // 2026-07-28：去掉边框。区块常渲染在页卡里面，两层都画边框就是圆角套
      // 圆角——真跑截图上很扎眼。解法照 pro-components 的 ProCard `ghost`：
      // 卡片表面由最外层容器提供一次，内层只保留结构。这里比 ghost 保守一档
      // ——只去边框，留白底和内边距，区块之间仍有分块感。
      variant="borderless"
      style={{ height: "100%" }}
    >
      {header}
      {body}
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
      <BlockShell block={block} title={title} testid="trend-chart">
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
      <BlockShell block={block} title={title} testid="trend-chart">
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
    <BlockShell block={block}
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
      <BlockShell block={block} title={title} testid="ranked-list">
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
      <BlockShell block={block} title={title} testid="ranked-list">
        <BlockEmpty hint={`暂无数据 — 写入「${sortField}」后自动排名`} />
      </BlockShell>
    );
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  return (
    <BlockShell block={block} title={title} testid="ranked-list">
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
                aria-label={`${item.label}相对排名进度`}
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
      <BlockShell block={block} title={title} testid="activity-feed">
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
      <BlockShell block={block} title={title} testid="activity-feed">
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
      <BlockShell block={block} title={title} testid="activity-feed">
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
    <BlockShell block={block} title={title} testid="activity-feed">
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

/**
 * 页面头 —— 用户示范图顶上那一条（2026-08-08）。
 *
 * 「门店订单管理 / 管理门店订单、跟踪状态与处理进度 / 导出 · 新建订单」
 *
 * 此前一个都没有，所以生成的页面开头就是筛选条——用户进来看不到"这是什么
 * 页、我能干什么"。refine 的 Inferencer 里对应的是 <List> 那层壳（它自带
 * 标题与 CreateButton），@ant-design/pro-layout 里对应 PageContainer。
 *
 * 主动作用主按钮、次动作用普通按钮：一页只能有一个最主要的动作，两个都画成
 * 蓝色就等于没有主次——这跟区域权重是同一条道理，只是落在按钮上。
 */
const PageHeaderRenderer: ExperienceBlockRenderer = ({ block, onAction }) => {
  const title = String(block.props?.title ?? "").trim();
  const subtitle = String(block.props?.subtitle ?? "").trim();
  const primary = String(block.props?.primaryAction ?? "").trim();
  const secondary = String(block.props?.secondaryAction ?? "").trim();
  return (
    <div
      data-testid="page-header"
      style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{title || "未命名页面"}</div>
        {subtitle && (
          <div style={{ marginTop: 2, fontSize: 12.5, color: "#64748b" }}>{subtitle}</div>
        )}
      </div>
      <Space>
        {secondary && (
          <Button onClick={() => onAction?.("actionTrigger", { action: secondary })}>
            {secondary}
          </Button>
        )}
        {primary && (
          <Button type="primary" onClick={() => onAction?.("actionTrigger", { action: primary })}>
            {primary}
          </Button>
        )}
      </Space>
    </div>
  );
};

/**
 * 结果屏 —— 一次操作结束之后的那一页。
 *
 * ## 为什么补这个区块
 *
 * 2026-08-08 扒 `ant-design/pro-blocks` 的 29 个页面时发现：**7 页的主体是
 * `<Result>`**（403 / 404 / 500 / 提交成功 / 提交失败 / 注册结果 / 分步表单
 * 的最后一步），是那个库里最常见的一种页面形状，而我们一个都没有。
 *
 * 官方那两页的写法（ResultSuccess / ResultFail）是：
 *
 *     <Result status title subTitle extra={几个按钮}>
 *       {单据 Descriptions + 流程 Steps}
 *     </Result>
 *
 * 我们只画外面那层。里面那两样是 RecordDetail 和 WorkflowTimeline 的活，
 * 摆在 supplement 区里——**不在这儿重画一遍**。区块该是区域大小的一块，
 * 把三样东西焊死在一个区块里，等于回到"一个区块管一整页"。
 *
 * ## status 决定图标和颜色，不是装饰
 *
 * 成功给绿勾、失败给红叉、404 给插画。用户扫一眼要知道"成了没有"，这件事
 * 由图标承担；只有文字的话得读完标题才知道。所以 status 是必给的：漏了就
 * 退到 info（蓝色感叹号），那是"中性通知"，不会把失败伪装成成功。
 */
const ResultPanelRenderer: ExperienceBlockRenderer = ({ block, onAction }) => {
  const raw = String(block.props?.status ?? "").trim();
  const status = (
    ["success", "error", "info", "warning", "403", "404", "500"].includes(raw)
      ? raw
      : "info"
  ) as React.ComponentProps<typeof Result>["status"];
  const title = String(block.props?.title ?? "").trim();
  const subtitle = String(block.props?.subtitle ?? "").trim();
  const primary = String(block.props?.primaryAction ?? "").trim();
  const secondary = String(block.props?.secondaryAction ?? "").trim();

  return (
    <BlockShell block={block} title="" testid="result-panel">
      <Result
        status={status}
        title={title || "操作已完成"}
        subTitle={subtitle || undefined}
        // 结果屏本来就自带大量留白（图标 + 标题 + 副标题），外面那张卡再给
        // 一层内边距就空得离谱。这里压掉纵向的一半。
        style={{ padding: "24px 16px" }}
        extra={
          primary || secondary ? (
            <Space>
              {secondary && (
                <Button onClick={() => onAction?.("actionTrigger", { action: secondary })}>
                  {secondary}
                </Button>
              )}
              {primary && (
                <Button
                  type="primary"
                  onClick={() => onAction?.("actionTrigger", { action: primary })}
                >
                  {primary}
                </Button>
              )}
            </Space>
          ) : undefined
        }
      />
    </BlockShell>
  );
};

/**
 * 状态切换栏 —— 列表页顶上那排「全部 / 待办 / 进行中 / 已完成」。
 *
 * ## 出处
 *
 * `@ant-design/pro-components` 的 `ListToolBar.tabs`（契约是
 * `{activeKey, onChange, items:[{key, tab}]}`），配合 ProTable 时几乎是标配。
 * 用户给的那张门店订单参考图顶上就是这一排。
 *
 * ## 为什么它不是 FilterBar 的一部分
 *
 * 两者都在收窄同一批行，但**代价不同**：下拉筛选要点开、选、再点查询，是
 * 「我知道自己要找什么」时用的；状态页签一眼看得见全部选项和各自条数，是
 * 「让我先看看待办有几条」时用的。列表页里后者的使用频次高一个量级，所以它
 * 值得占页面顶上一整行，而不是折进筛选条里。
 *
 * ## 条数是真数出来的
 *
 * 每个页签后面的数字来自当前行数据，不是 props 里写死的。写死的话，用户删掉
 * 一条记录、页签还写着原来的数——那种不一致比不显示条数更糟。
 */
const StatusTabsRenderer: ExperienceBlockRenderer = ({
  block,
  entityRows,
  filterState,
  onFilterChange,
  fieldLabelOf,
  enumOptionsOf,
}) => {
  const bound = rowsOfBinding(block, entityRows);
  const field = String(block.binding?.statusField ?? "").trim();
  if (!bound || !field)
    return (
      <BlockShell block={block} title="" testid="status-tabs">
        <BlockEmpty hint="状态栏未绑定到实体的状态字段" />
      </BlockShell>
    );

  const options = enumOptionsOf?.(bound.entityRef, field) ?? [];
  if (options.length === 0)
    return (
      <BlockShell block={block} title="" testid="status-tabs">
        <BlockEmpty hint={`「${fieldLabelOf?.(bound.entityRef, field) ?? field}」不是枚举字段，没有状态可分`} />
      </BlockShell>
    );

  const countOf = (value?: string) =>
    value === undefined
      ? bound.rows.length
      : bound.rows.filter(r => String(r.values?.[field] ?? "") === value).length;

  const active = filterState?.enumFilters?.[field] ?? "";
  const items = [
    { key: "", label: `全部 ${countOf()}` },
    ...options.map(o => ({
      key: String(o.id),
      label: `${o.label} ${countOf(String(o.id))}`,
    })),
  ];

  return (
    <BlockShell block={block} title="" testid="status-tabs">
      <Tabs
        size="small"
        activeKey={active}
        items={items.map(i => ({ key: i.key, label: i.label }))}
        onChange={key =>
          onFilterChange?.({
            enumFilters: {
              ...(filterState?.enumFilters ?? {}),
              [field]: key || undefined,
            },
          })
        }
        // 只当导航用，不装内容 —— 内容是主体区那张表的事。
        tabBarStyle={{ marginBottom: 0 }}
      />
    </BlockShell>
  );
};

/**
 * 批量操作栏 —— 「已选择 N 项 · 清空 · 批量操作」。
 *
 * ## 出处
 *
 * `@ant-design/pro-components` 的 `table/components/Alert`。它的关键行为是
 * **选中为空时整条不渲染**（`selectedRowKeys.length < 1 && !alwaysShowAlert`
 * 直接 return null），只在真的选了东西之后才占位。
 *
 * ## 为什么先接数据通路再建这个区块
 *
 * 它依赖「选中了哪些行」。这个项目 2026-08-08 刚踩过同类的坑：
 * QuickActionPanel 第一行就是"没有 pageActions 就返回 null"，而装配预览从来
 * 没传过，于是它一直渲染成空气、没人发现——因为它总跟别的区块挤在一个区里，
 * 看不出少了谁。所以这次是先给 DataTable 接上 rowSelection、把选择态串通，
 * 再建这个区块。
 *
 * ## 未选中时显示什么
 *
 * 官方的判据是一行：`selectedRowKeys.length < 1 && !alwaysShowAlert` → 返回
 * null，整条消失。**它把"永远显示"做成了一个开关，而不是写死**——这是我们
 * 2026-08-08 回头补的那一条：原来我们把"永远显示一句引导"写死了，等于替使用
 * 者做了决定。
 *
 * 两边的默认值故意相反，理由也不同：
 *
 *   官方默认消失   —— 它是真实应用里表格上方的一条，没选中时消失最干净
 *   我们默认显示   —— 装配预览和组件库里，一个会凭空消失的区块没法审阅，
 *                     而"消失"和"坏了"长得一样
 *
 * 想要官方那种行为的，把 `props.alwaysShow` 设成 false。
 */
const BatchActionBarRenderer: ExperienceBlockRenderer = ({
  block,
  entityRows,
  selection,
  onSelectionChange,
  onAction,
}) => {
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title="" testid="batch-action-bar">
        <BlockEmpty hint="批量操作栏未绑定到有效实体" />
      </BlockShell>
    );

  const selected = selection?.rowIds?.[bound.entityRef] ?? [];
  const actions = Array.isArray(block.props?.actions)
    ? (block.props.actions as unknown[]).map(a => String(a)).filter(Boolean)
    : [];

  // 官方的 alwaysShowAlert，默认值反过来（见上面的说明）
  const alwaysShow = block.props?.alwaysShow !== false;
  if (selected.length === 0 && !alwaysShow) return null;

  return (
    <BlockShell block={block} title="" testid="batch-action-bar">
      {selected.length === 0 ? (
        <div
          data-testid="batch-action-bar-idle"
          style={{ fontSize: 12.5, color: "#94a3b8", padding: "6px 4px" }}
        >
          勾选左侧的行以批量处理
        </div>
      ) : (
        <Flex align="center" gap="small" wrap style={{ padding: "4px 0" }}>
          <span style={{ fontSize: 13, color: "#0f172a" }}>
            已选择 <b data-testid="batch-selected-count">{selected.length}</b> 项
          </span>
          <Button
            size="small"
            type="link"
            onClick={() => onSelectionChange?.(bound.entityRef, [])}
          >
            清空
          </Button>
          <span style={{ flex: 1 }} />
          {actions.map(label => (
            <Button
              key={label}
              size="small"
              onClick={() =>
                onAction?.("actionTrigger", {
                  action: label,
                  entityRef: bound.entityRef,
                  rowIds: selected,
                })
              }
            >
              {label}
            </Button>
          ))}
        </Flex>
      )}
    </BlockShell>
  );
};

/**
 * ── 列设置 —— 照 ant-design/pro-components 的 ColumnSetting（2026-08-08，②批次 1）──
 *
 * 源：`src/table/components/ColumnSetting/index.tsx`（605 行）。
 *
 * 搬的**不是**它那几行 JSX——我们没有 TableContext、没有 Tree、状态形状也不同。
 * 搬的是它替我们踩过的四条边界，每一条我们自己写都会漏：
 *
 * 1. **半选的分母是"面板里真的列出来的列"，不是状态表全量。** 它的注释原文：
 *    "columnsMap 可能含有 hideInSetting 列或运行时被删掉的过期 key，导致分子与
 *    分母不对齐，indeterminate 计算出现偏差"。我们同样会有过期 id——数据模型
 *    改过字段之后，hidden 里躺着的名字已经不存在了。
 *
 * 2. **改了固定之后必须重排顺序。**（它的 issue #9556）固定分左/不固定/右三段，
 *    顺序号却是全局的；只改固定不重排，一个「固定在左」的列可以排在中间那段
 *    的后面，分组和顺序自相矛盾。
 *
 * 3. **重置要连顺序一起重置。**（它的 issue #9558）只把显示状态复位、留着旧的
 *    排序数组，下一次挪动仍然基于旧顺序算，用户看到的是"重置了个寂寞"。
 *
 * 4. **没有任何固定列时不显示分组标题。**（`showTitle={showLeft || showRight}`）
 *    否则一个孤零零的「不固定」标题挂在那，用户以为还有别的组没展开。
 *
 * 一条我们做得比它多的：**全部取消勾选**时它照样把一张没有列的表交给 antd
 * Table（渲染出一片空白表头）。我们在 DataTable 里给了空态和一句话，见那边。
 */

/** 固定分组的顺序 —— 左、不固定、右。这个顺序就是列在表上的先后。 */
const FIXED_GROUPS: Array<{ key: "left" | "none" | "right"; title: string }> = [
  { key: "left", title: "固定在左侧" },
  { key: "none", title: "不固定" },
  { key: "right", title: "固定在右侧" },
];

function groupOf(field: string, state: BlockColumnState): "left" | "none" | "right" {
  return state.fixed[field] ?? "none";
}

/**
 * 把列视图态套到字段列表上 —— DataTable 和 ColumnSettingPanel 共用这一份。
 *
 * 三步的**先后不能换**（这是上面第 2 条的落点）：
 *   ① 去掉隐藏的  ② 按显式顺序排  ③ 按固定分组归拢
 * 分组必须在排序之后、并且盖过排序，否则「固定在左」的列会排在中间那段后面。
 */
export function applyColumnState(fields: string[], state?: BlockColumnState): string[] {
  if (!state) return fields;
  const hidden = new Set(state.hidden);
  const visible = fields.filter(f => !hidden.has(f));
  const rank = new Map(state.order.map((f, i) => [f, i]));
  // 没排过序的排在后面，组内保持原有相对顺序（稳定排序）
  const ordered = visible
    .map((f, i) => ({ f, i, r: rank.has(f) ? rank.get(f)! : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map(x => x.f);
  return [
    ...ordered.filter(f => state.fixed[f] === "left"),
    ...ordered.filter(f => !state.fixed[f]),
    ...ordered.filter(f => state.fixed[f] === "right"),
  ];
}

const ColumnSettingPanelRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  columnState,
  onColumnStateChange,
  targetColumns,
  fieldLabelOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim() || "列设置";
  const entityRef = String(block.binding?.entityRef ?? "").trim();
  const targets = (block.binding?.targets as string[] | undefined) ?? [];
  const targetId = targets[0];

  if (!targetId || !targetColumns || targetColumns.length === 0) {
    return (
      <BlockShell block={block} title={title} testid="column-setting-panel">
        <BlockEmpty hint="没有连到任何表格 —— 列设置要先在 binding.targets 里说清楚它管哪一张" />
      </BlockShell>
    );
  }

  const state = columnState?.[targetId] ?? EMPTY_COLUMN_STATE;
  const push = (next: BlockColumnState) => onColumnStateChange?.(targetId, next);

  // **分母只数面板里真的列出来的列**（pro-components 的那条注释）。state.hidden
  // 里可能躺着数据模型改过之后已经不存在的字段名，把它们算进去，全选框会永远
  // 停在半选。
  const hiddenHere = targetColumns.filter(f => state.hidden.includes(f));
  const allChecked = hiddenHere.length === 0;
  const indeterminate = hiddenHere.length > 0 && hiddenHere.length < targetColumns.length;

  // 重置 = 回到**表格自己声明的那一份**（targetColumns 就是它，宿主按表格的
  // fieldRefs 算好传进来的），并且**顺序和固定一起清掉**——只复位显示状态是
  // pro-components 的 issue #9558。
  //
  // 面板自己不再声明 fieldRefs（2026-08-08 当天改掉的）。一开始给了它一份，
  // 浏览器里当场露馅：面板说默认 4 列、表格自己声明 10 列，两份默认互相矛盾，
  // 结果是什么都没动过、「重置」却是可点的。同一件事不能有两个出处——列由表格
  // 声明，面板只负责在运行时改它。pro-components 也是这么分的：它的重置读的是
  // 表格的 `columnsState.defaultValue`，不是设置面板另存一份。
  const resetTo: BlockColumnState = { hidden: [], order: [], fixed: {} };
  const isPristine =
    state.hidden.length === 0 &&
    state.order.length === 0 &&
    Object.keys(state.fixed).length === 0;

  /**
   * 顺序永远按**全部列**算，不受当前隐藏影响。
   *
   * 写这个块的时候自己踩的：一开始直接把 applyColumnState 的结果存进 order，
   * 而它返回的是"可见的那些"——于是藏掉一列、挪一下别的、再把它勾回来，那一
   * 列因为丢了名次会跳到最末尾。隐藏是"这次不看"，不该顺手改掉它的位置。
   */
  const orderedAll = (s: BlockColumnState) =>
    applyColumnState(targetColumns, { ...s, hidden: [] });

  const toggle = (field: string, checked: boolean) =>
    push({
      ...state,
      hidden: checked ? state.hidden.filter(f => f !== field) : [...state.hidden, field],
    });

  const setFixed = (field: string, fixed: "left" | "right" | undefined) => {
    if ((state.fixed[field] ?? undefined) === fixed) return; // 跟当前一致就别产生一次无意义更新
    const nextFixed = { ...state.fixed };
    if (fixed) nextFixed[field] = fixed;
    else delete nextFixed[field];
    // 改完固定重排一次顺序 —— pro-components 的 issue #9556。不重排的话，
    // 分组把这一列拎到最左边，它的顺序号却还留在中段，下一次挪动就乱套。
    const next = { ...state, fixed: nextFixed };
    push({ ...next, order: orderedAll(next) });
  };

  /** 组内上移/下移。跨组挪没有意义——先后由固定分组决定，不由顺序号决定。 */
  const move = (field: string, delta: -1 | 1) => {
    const current = orderedAll(state);
    const group = groupOf(field, state);
    const peers = current.filter(f => groupOf(f, state) === group);
    const at = peers.indexOf(field);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= peers.length) return;
    const reordered = [...peers];
    reordered.splice(at, 1);
    reordered.splice(to, 0, field);
    // 只重写这一组的位置，别的组原样留在自己的位置上
    let cursor = 0;
    const merged = current.map(f => (groupOf(f, state) === group ? reordered[cursor++] : f));
    push({ ...state, order: merged });
  };

  // 面板里**连隐藏的列一起列出来**（唯一能把它们勾回来的地方），而且按它们
  // 真实的位置排——不是把隐藏的一律甩到末尾。上移/下移算的也是这一份，
  // 两处不一致的话按钮会挪走另一列。
  const rendered = orderedAll(state);
  const labelOf = (f: string) => fieldLabelOf?.(entityRef, f) ?? f;
  // 没有任何固定列时不出分组标题 —— 一个孤零零的「不固定」标题会让人以为
  // 还有别的组没展开（pro-components 的 showTitle={showLeft || showRight}）
  const anyFixed = targetColumns.some(f => state.fixed[f]);

  return (
    <BlockShell block={block}
      title={title}
      testid="column-setting-panel"
      extra={
        <Button
          size="small"
          type="link"
          disabled={isPristine}
          data-testid="column-setting-reset"
          onClick={() => push(resetTo)}
        >
          重置
        </Button>
      }
    >
      <Checkbox
        indeterminate={indeterminate}
        checked={allChecked}
        data-testid="column-setting-all"
        onChange={e =>
          push({ ...state, hidden: e.target.checked ? [] : [...targetColumns] })
        }
      >
        <span style={{ fontSize: 12 }}>
          列展示（{targetColumns.length - hiddenHere.length}/{targetColumns.length}）
        </span>
      </Checkbox>
      {FIXED_GROUPS.map(group => {
        const members = rendered.filter(f => groupOf(f, state) === group.key);
        if (members.length === 0) return null;
        return (
          <div key={group.key} style={{ marginTop: 8 }}>
            {anyFixed && (
              <div
                data-testid="column-setting-group-title"
                style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}
              >
                {group.title}
              </div>
            )}
            {members.map((f, i) => (
              <Flex key={f} align="center" gap={4} data-testid="column-setting-item">
                <Checkbox
                  checked={!state.hidden.includes(f)}
                  onChange={e => toggle(f, e.target.checked)}
                >
                  <span style={{ fontSize: 12 }}>{labelOf(f)}</span>
                </Checkbox>
                <span style={{ flex: 1 }} />
                <Tooltip title="上移">
                  <Button
                    size="small"
                    type="text"
                    disabled={i === 0}
                    data-testid="column-setting-up"
                    onClick={() => move(f, -1)}
                    icon={<AntdIcons.ArrowUpOutlined />}
                  />
                </Tooltip>
                <Tooltip title="下移">
                  <Button
                    size="small"
                    type="text"
                    disabled={i === members.length - 1}
                    data-testid="column-setting-down"
                    onClick={() => move(f, 1)}
                    icon={<AntdIcons.ArrowDownOutlined />}
                  />
                </Tooltip>
                <Tooltip title={group.key === "left" ? "取消固定" : "固定在左侧"}>
                  <Button
                    size="small"
                    type="text"
                    data-testid="column-setting-pin-left"
                    onClick={() => setFixed(f, group.key === "left" ? undefined : "left")}
                    // 左右固定用 PicLeft/PicRight（"内容靠左/靠右"），不用箭头——
                    // 同一行里再放两个箭头，跟上移下移分不开
                    icon={<AntdIcons.PicLeftOutlined />}
                  />
                </Tooltip>
                <Tooltip title={group.key === "right" ? "取消固定" : "固定在右侧"}>
                  <Button
                    size="small"
                    type="text"
                    data-testid="column-setting-pin-right"
                    onClick={() => setFixed(f, group.key === "right" ? undefined : "right")}
                    icon={<AntdIcons.PicRightOutlined />}
                  />
                </Tooltip>
              </Flex>
            ))}
          </div>
        );
      })}
    </BlockShell>
  );
};

/**
 * ── 字段渲染 —— 照 refinedev/refine 的 Inferencer 三层模型（2026-08-08）──
 *
 * ## 为什么重做
 *
 * 用户拿一张真实的「门店订单管理」页做示范，指出我们生成的表格差太远：
 * 状态该是彩色标签、金额该是 ¥428.00、时间该是完整时刻、末尾该有操作列、
 * 分页该带总数和跳页。而我此前**直接拿行数据的键当列**，没有语义、没有
 * 格式化、没有操作列——出来就是一张裸表。
 *
 * ## 抄的什么（packages/inferencer/src）
 *
 *   ① field-inferencers/     一条推断链，看 (key, value) 定字段语义。
 *                            date.ts 的判据很实在：key 匹配 /(_at|_on|At|On)$/
 *                            **且** dayjs 解析得通 **且** 含日期分隔符，三条
 *                            都满足才算 date。每条返回 {key, type, priority}，
 *                            priority 解冲突。
 *   ② inferencers/antd/list  每种语义配一个字段渲染器：
 *                            date→DateField / email→EmailField / url→UrlField /
 *                            boolean→BooleanField / relation→TagField
 *   ③ 表格自动追加操作列      EditButton / ShowButton / DeleteButton
 *
 * ## 我们比 refine 占一个便宜
 *
 * refine 只能从**值**去猜类型（所以才要那套正则和 dayjs 试解析）；我们的
 * 字段类型是数据模型里**声明**好的（string/number/date/enum/ref/text），
 * fieldTypeOf 直接查得到。所以推断链在这里退化成"声明优先、值兜底"：
 * 声明了就用声明的，没声明才按 refine 那套从值猜——那条兜底不能省，
 * 组件库对照台和遗留数据都可能没有字段声明。
 */

/**
 * 字段的展示语义。比数据类型更细：number 还要分金额与普通数字。
 *
 * 2026-08-08 从 7 种补到 13 种。补的六种（email / url / image / richtext /
 * boolean / relation）全部来自 refine 的 field-inferencers——不是想出来的，
 * 是照着它 13 个推断器逐个对的账。缺它们的后果很具体：邮箱不出 mailto、
 * 链接不可点、图片列印一串 URL、长文本把行高撑开。
 */
type FieldSemantic =
  | "money" | "number" | "boolean"
  | "date" | "datetime"
  | "email" | "url" | "image" | "richtext"
  | "enum" | "relation"
  | "text" | "id";

/** 名字里带这些词的数值列按金额显示。中英都收——生成的字段名两种都有。 */
const MONEY_HINT = /(amount|price|total|fee|cost|revenue|金额|价格|费用|总额)/i;
/** 名字里带这些词的字符串列按单号显示（等宽、不换行）。 */
const ID_HINT = /(^id$|_id$|code$|sku|no$|number$|单号|编号)/i;

// ── 值判据 —— 逐条抄自 refine 的 field-inferencers ────────────────────
// （/home/user/oss-blocks/refine/packages/inferencer/src/field-inferencers/）
//
// 抄正则而不是自己写，是因为这些边界情况人想不全：email 那条要处理引号包裹的
// local part 和 IP 字面量域名；url 那条要排掉 `a.-b` 这种；date 那条**三个条件
// 缺一不可**（见下）。
const EMAIL_RE =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const URL_RE = /^(https?|ftp):\/\/(-\.)?([^\s/?\.#-]+\.?)+(\/[^\s]*)?$/i;
const IMAGE_RE = /\.(gif|jpe?g|tiff?|png|webp|bmp|svg)$/i;
const RELATION_RE = /(-id|-ids|_id|_ids|Id|Ids|ID|IDs)(\[\])?$/;
const DATE_SUFFIX_RE = /(_at|_on|At|On|AT|ON)(\[\])?$/;
/**
 * 日期形状 —— **这一条我们比 refine 严，因为它那条有洞**。
 *
 * refine 的 dateInfer 展开之后是「有分隔符 且 dayjs 能解析」。实测
 * （node -e 跑 dayjs）：
 *
 *     dayjs("u-1").isValid()          → true，解析成 2001-01-01
 *     dayjs("SO-2026-001").isValid()  → true，解析成 2026-01-01
 *     dayjs("2").isValid()            → true，解析成 2001-02-01
 *
 * 也就是说在 refine 里，`owner_id: "u-1"` 和 `order_no: "SO-2026-001"` 都会被
 * 判成日期——而 date 的 priority(1) 还高于 relation(0)，它赢定了。这不是我们
 * 抄错，是它这条本身的缺口。
 *
 * 所以加一道形状闸：必须**以四位年份开头**，后面接分隔符和月日。真实业务里
 * 的日期长这样（我们的种子数据、用户给的参考图都是 `2026-08-06`），而单号、
 * 外键 id 不会。
 */
const DATE_SHAPE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2})?)?/;
const DATE_SEPARATORS = ["/", ":", "-", "."];
/** 超过这个长度按富文本处理（refine 的阈值）。 */
const RICHTEXT_MIN = 100;

/**
 * 定字段语义 —— **声明优先，值兜底**。
 *
 * ## 我们比 refine 占一个便宜
 *
 * refine 只能从**值**去猜（所以才要那套正则和 dayjs 试解析）；我们的字段类型
 * 是数据模型里**声明**好的，fieldTypeOf 直接查得到。所以推断链在这里退化成
 * "声明了就用声明的"，只有没声明时才走值判据——那条兜底不能省，组件库对照台
 * 和遗留数据都可能没有字段声明。
 *
 * ## 值兜底那一半用 refine 的**优先级**模型，不是先到先得
 *
 * 这是这次照着抄来的关键一条（`utilities/pick-inferred-field/`）：refine 让
 * **所有**推断器都跑，然后取 priority 最高的那个，而不是第一个命中的。
 *
 *     image    2   ← `avatar.png` 同时也是 url、也是 text
 *     email / url / date / richtext   1
 *     其余（number / boolean / relation / text）   0
 *
 * 先到先得会出错：`https://a.com/x.png` 按链序先撞上 url，就再也轮不到 image。
 */
function fieldSemantic(
  entityRef: string,
  fieldId: string,
  sample: unknown,
  fieldTypeOf?: FieldTypeLookup,
  options?: NormalizedFieldOption[]
): FieldSemantic {
  // **有枚举取值本身就是一种声明**，而且比 type 字段更直接：调用方能给出
  // id→label 的对照，就说明这一列是枚举。
  //
  // 2026-08-08 回归实测：只认 fieldTypeOf === "enum" 时，没传 fieldTypeOf 的
  // 调用方（对照台、老页面）枚举列会打印取值 id（`frozen` 而不是「已冻结」）
  // ——同一份数据在页面自带表格里是中文、在区块里是英文 id，坐在一起就露馅。
  if (options && options.length > 0) return "enum";

  const declared = fieldTypeOf?.(entityRef, fieldId);
  if (declared === "enum") return "enum";
  if (declared === "boolean") return "boolean";
  if (declared === "ref") return "relation";
  if (declared === "date") {
    // 值里带时刻就按时刻显示 —— 用户示范里「2025-08-06 14:28:32」这种
    const s = String(sample ?? "");
    return s.includes(":") || s.includes("T") ? "datetime" : "date";
  }
  if (declared === "number") return MONEY_HINT.test(fieldId) ? "money" : "number";
  if (declared === "string" || declared === "text") {
    // 声明成字符串**不代表没有更细的语义**：声明只说了"这是个字符串"，
    // 是不是邮箱/链接/图片得看值。所以这里不直接返回，落到下面的值判据。
    const byValue = inferByValue(fieldId, sample);
    if (byValue) return byValue;
    return ID_HINT.test(fieldId) ? "id" : "text";
  }

  // 完全没有声明：全靠值
  const byValue = inferByValue(fieldId, sample);
  if (byValue) return byValue;
  if (typeof sample === "number") return MONEY_HINT.test(fieldId) ? "money" : "number";
  if (typeof sample === "boolean") return "boolean";
  if (ID_HINT.test(fieldId)) return "id";
  return "text";
}

/**
 * 从值推语义 —— 照 refine 的优先级模型：**全跑一遍，取最高分**。
 *
 * 返回 null 表示"值里看不出更细的语义"，交回调用方按声明/名字兜底。
 */
function inferByValue(fieldId: string, sample: unknown): FieldSemantic | null {
  const hits: Array<{ semantic: FieldSemantic; priority: number }> = [];
  const str = typeof sample === "string" ? sample : "";

  if (str && IMAGE_RE.test(str)) hits.push({ semantic: "image", priority: 2 });
  if (str && EMAIL_RE.test(str)) hits.push({ semantic: "email", priority: 1 });
  if (str && URL_RE.test(str)) hits.push({ semantic: "url", priority: 1 });
  if (str.length > RICHTEXT_MIN) hits.push({ semantic: "richtext", priority: 1 });

  // 日期：refine 的两条（有分隔符 + dayjs 能解析）**再加一道形状闸**。
  //
  //   只看 key 后缀   → `create_at_count` 这种也被认成日期
  //   只看值能解析     → dayjs("2") 解析得通，"2" 就成了日期
  //   只看分隔符       → "a-b" 也有分隔符
  //   前三条都满足还不够 → "SO-2026-001" 全中，仍然不是日期（见 DATE_SHAPE_RE）
  const parseable = str !== "" && dayjs(str).isValid();
  const hasSeparator = DATE_SEPARATORS.some(sep => str.includes(sep));
  const looksLikeDate = DATE_SHAPE_RE.test(str);
  if (looksLikeDate && hasSeparator && parseable) {
    hits.push({ semantic: str.includes(":") ? "datetime" : "date", priority: 1 });
  }

  // 关联字段按**名字**判（refine 的 relationInfer 也是），值只要是标量或标量数组
  const scalar = typeof sample === "string" || typeof sample === "number";
  const scalarArray =
    Array.isArray(sample) && sample.every(v => typeof v === "string" || typeof v === "number");
  if (RELATION_RE.test(fieldId) && (scalar || scalarArray)) {
    hits.push({ semantic: "relation", priority: 0 });
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => b.priority - a.priority);
  return hits[0].semantic;
}

/**
 * 只给用例用的薄封装 —— fieldSemantic 的入参里有 entityRef 和 options 两个
 * 在语义判定里不参与的东西，用例每次都传 null 会把判据淹掉。
 */
export function fieldSemanticForTest(
  fieldId: string,
  sample: unknown,
  declared?: string
): string {
  return fieldSemantic("e", fieldId, sample, declared ? () => declared : undefined);
}

/** 枚举取值的色调 → antd Tag 的 color。空/未知一律不上色，不瞎猜。 */
const TONE_COLOR: Record<string, string | undefined> = {
  success: "success",
  processing: "processing",
  warning: "warning",
  danger: "error",
  default: undefined,
};

/** 长度不可控的单行语义 —— 表格列上要单行截断，不然会竖着折成一座塔。 */
const ELLIPSIS_SEMANTICS = new Set<FieldSemantic>(["text", "email", "url", "relation", "id"]);

/** 一个单元格怎么画 —— 每种语义一个渲染器（refine 的 ②）。 */
function renderCell(
  semantic: FieldSemantic,
  raw: unknown,
  options: NormalizedFieldOption[]
): React.ReactNode {
  const str = String(raw ?? "").trim();
  if (!str) return <Typography.Text type="secondary">—</Typography.Text>;

  switch (semantic) {
    case "enum": {
      // 出标签不出取值 id，并按 tone 上色。用户示范里「待处理」是橙的、
      // 「已完成」是绿的——那个颜色来自数据模型声明的 tone，不是我们编的。
      const opt = options.find(o => o.id === str);
      if (!opt) return str;
      const color = TONE_COLOR[opt.tone];
      return color ? <Tag color={color}>{opt.label}</Tag> : <Tag>{opt.label}</Tag>;
    }
    case "money": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return str;
      return (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          ¥{n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return str;
      return (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString("zh-CN")}</span>
      );
    }
    case "datetime": {
      const d = dayjs(str);
      return d.isValid() ? d.format("YYYY-MM-DD HH:mm:ss") : str;
    }
    case "date": {
      const d = dayjs(str);
      return d.isValid() ? d.format("YYYY-MM-DD") : str;
    }
    case "id":
      return (
        <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{str}</span>
      );
    // ── 2026-08-08 补的六种。缺它们的后果都很具体：邮箱不能点、链接是死的、
    //    图片列印一串 URL、长文本把行高撑开、布尔列显示 "true"。
    case "boolean": {
      const yes = raw === true || str === "true" || str === "1" || str === "是";
      return <Tag color={yes ? "success" : undefined}>{yes ? "是" : "否"}</Tag>;
    }
    case "email":
      // 邮箱要能一键写信 —— 这是它区别于普通文本的**全部意义**
      return (
        <Typography.Link href={`mailto:${str}`} onClick={e => e.stopPropagation()}>
          {str}
        </Typography.Link>
      );
    case "url":
      // 新窗口打开：表格行本身多半是可点的（选中/查看），链接抢走点击会让
      // 用户以为自己点错了
      return (
        <Typography.Link
          href={str}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
        >
          {str}
        </Typography.Link>
      );
    case "image":
      // 缩略图固定高度 —— 图片尺寸参差不齐时不给固定高度，一行高一行矮
      return (
        <img
          src={str}
          alt=""
          loading="lazy"
          style={{ height: 28, width: "auto", maxWidth: 64, objectFit: "cover", borderRadius: 4 }}
        />
      );
    case "richtext":
      // 长文本**不能整段铺进单元格**——一条 500 字的备注会把整行撑到半屏。
      // 截断 + tooltip 看全文，这是 x-render 的 tooltip widget 那条做法。
      return (
        <Typography.Text ellipsis={{ tooltip: str }} style={{ maxWidth: 240 }}>
          {str}
        </Typography.Text>
      );
    case "relation":
      // 关联字段展示的是被指向那条记录的标识，等宽不换行（同 id）
      return (
        <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {Array.isArray(raw) ? raw.join("、") : str}
        </span>
      );
    default:
      return str;
  }
}

const DataTableRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  selection,
  onSelectionChange,
  columnState,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty hint="表格未绑定到有效实体" />
      </BlockShell>
    );
  if (bound.rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty hint="暂无数据 — 点「新建」写入第一条真实数据" />
      </BlockShell>
    );
  // 列优先取 binding.fieldRefs；没声明才从真实行的键里派生。
  //
  // fieldRefs 是 2026-08-08 开给表格的（此前只有表单/详情族能声明）。表格是
  // 唯一"会显示字段却不能声明显示哪几个"的区块，这个例外没有道理：字段一多，
  // 派生 + 截断决定谁上榜的规则是键的顺序，模型和使用者都控制不了。对照台上
  // 就撞上了——十一个字段，截断正好切在第八个，布尔、关联、长文本三种语义
  // 全部看不见。
  //
  // 兜底上限从 5 提到 8：用户示范的订单页有 9 列，5 列砍掉的正是"支付状态"
  // "操作"这种一眼要看的东西——列少不等于清爽，等于信息不全。
  const declaredCols = boundFieldIds(block, bound.rows, 8);
  // 用户在 ColumnSettingPanel 里改过的隐藏/顺序/固定，最后套在这里。
  // 没有那个面板时 columnState 为空，applyColumnState 原样返回。
  const viewState = block.id ? columnState?.[block.id] : undefined;
  const cols = applyColumnState(declaredCols, viewState);
  // **全部列都被藏起来**是真会发生的：面板上把「列展示」的全选框取消掉就是。
  // pro-components 到这一步会把一张没有列的表交给 antd Table，渲染出一片
  // 空白表头——看起来像坏了。说清楚发生了什么，比默默画个空壳强。
  if (cols.length === 0)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty hint="所有列都被隐藏了 — 在「列设置」里勾回来" />
      </BlockShell>
    );
  const columns: TableColumnsType<RuntimeRow> = cols.map(c => {
    const options = enumOptionsOf?.(bound.entityRef, c) ?? [];
    // 取第一个非空值当样本定语义——照 refine 的 inferencer，它也是看值。
    const sample = bound.rows.find(r => r.values?.[c] != null)?.values?.[c];
    const semantic = fieldSemantic(bound.entityRef, c, sample, fieldTypeOf, options);
    return {
      key: c,
      dataIndex: c,
      title: fieldLabelOf?.(bound.entityRef, c) ?? c,
      // 会长的语义一律单行截断（2026-08-08 从只管 text 扩到五种）。邮箱、外链、
      // 关联 id 都是长度不可控的单行串，不截断的话 tableLayout="fixed" 会把它们
      // 竖着折成一座塔——列一多整张表就成了参差不齐的一片。richtext 不在这里，
      // 它在 renderCell 里自带截断 + tooltip。
      ellipsis: ELLIPSIS_SEMANTICS.has(semantic),
      // 数值右对齐是表格的基本功——左对齐的金额列没法竖着比大小
      align: semantic === "money" || semantic === "number" ? ("right" as const) : undefined,
      // 固定列。分组顺序 applyColumnState 已经排好了，这里只负责让 antd 真的粘住
      fixed: viewState?.fixed[c],
      render: (_: unknown, row: RuntimeRow) => renderCell(semantic, row.values?.[c], options),
    };
  });

  // 操作列 —— refine 的 ③：Inferencer 生成的每张表都自动追加
  // EditButton / ShowButton / DeleteButton。用户示范里那列「查看 编辑 取消」
  // 就是这个。此前我们一列都没有，于是表格看得见摸不着。
  //
  // 只在调用方接了 onAction 时出现：没人接的时候画一排点不动的链接，
  // 比不画更糟。
  if (onAction) {
    columns.push({
      key: "__actions",
      title: "操作",
      width: 120,
      fixed: undefined,
      render: (_: unknown, row: RuntimeRow) => (
        <Space size={4}>
          <Typography.Link
            style={{ fontSize: 12 }}
            onClick={e => {
              e.stopPropagation();
              onAction("rowSelect", { rowId: row.id });
            }}
          >
            查看
          </Typography.Link>
          <Typography.Link
            style={{ fontSize: 12 }}
            onClick={e => {
              e.stopPropagation();
              onAction("editRequest", { rowId: row.id });
            }}
          >
            编辑
          </Typography.Link>
        </Space>
      ),
    });
  }
  /**
   * 拖拽排序（2026-08-08，②批次 1）。
   *
   * **做成 DataTable 的一个 prop，而不是第四张表。** pro-components 那边
   * `DragSortTable` 独立成组件，是因为它得包住 ProTable 的 components/
   * tableViewRender 才能塞进 dnd 上下文——那是实现约束，不是概念区分：拖得动
   * 的表和拖不动的表是同一张表。我们这边已经有 DataTable，再建一个"能拖的
   * DataTable"就是把同一个东西讲两遍，模型还得在两个几乎一样的选项里挑。
   *
   * 它的 DragSortTable 就在我们已装的 pro-components 2.8.10 里导出着，不加
   * 新依赖。拖完的语义照它：**先本地生效，再把排好的新数组回调出去**——
   * 持久化时机归调用方，组件不等服务端（等的话手一松表格会弹回去）。
   *
   * 这一档故意关掉两样东西，都是因为**手势会打架**：
   *   分页 —— 跨页拖没有意义，第 9 条拖到第 1 页要先翻页，中途松手就散了
   *   勾选 —— 复选框和拖拽把手抢同一次按下；要批量操作就别开拖拽排序
   */
  const sortable = block.props?.sortable === true;
  if (sortable) {
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <DragSortTable
          rowKey="id"
          size="small"
          search={false}
          options={false}
          toolBarRender={false}
          pagination={false}
          // 把手挂在第一列上。不指定 dragSortKey 的话它让整行都能拖，而整行
          // 可拖会跟"点一行 = 选中/查看"打架——两个手势抢同一次按下。
          dragSortKey={cols[0]}
          columns={columns as never}
          dataSource={bound.rows}
          onDragSortEnd={(_before, _after, next) =>
            onAction?.("rowSelect", {
              reorderedRowIds: (next as RuntimeRow[]).map(r => r.id),
            })
          }
        />
      </BlockShell>
    );
  }

  return (
    <BlockShell block={block}
      title={title}
      testid="data-table"
    >
      {/* 换 antd Table：拿到省略号 tooltip、粘性表头、紧凑尺寸与主题描边，
          手写 <table> 这些都得自己补，而且列头字号/颜色跟同页别的表格对不齐 */}
      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={bound.rows}
        // 分页交给 Table 自己管（2026-08-08）。此前是 slice(0, 8) + 标题栏
        // 一行"共 N 条，显示前 8 条"——那不是分页，是截断，用户根本翻不到
        // 第 9 条。用户的示范图里那一行是「共 1,268 条 ‹ 1 2 3 … › 10/页
        // 跳至 __ 页」，都是 antd Table 自带的，只是要打开。
        //
        // 分页是表格的一部分，不是一个独立区块——用户指出的"Pagination 居然
        // 变成独立大卡片"，根子就在把它当成了平级组件。
        pagination={{
          size: "small",
          pageSize: 8,
          showSizeChanger: bound.rows.length > 8,
          showQuickJumper: bound.rows.length > 40,
          showTotal: total => `共 ${total.toLocaleString("zh-CN")} 条`,
        }}
        // 默认不给 scroll.x：区块是页面里的一块，横向滚动条藏在卡片里没人会去拉，
        // 对照台上表格直接被卡片右边缘切掉、最后一列看不见。列共享可用宽度 +
        // 省略号（有 tooltip）才是这个尺寸下该有的行为。
        //
        // **有固定列时例外**：固定的意义就是"横向滚的时候这列别走"，不给
        // scroll.x 的话 antd 的 fixed 无事发生（还会告警）。用户在列设置里
        // 主动固定了某一列，就是明确表示他要横着看。
        scroll={
          viewState && Object.keys(viewState.fixed).length > 0
            ? { x: "max-content" }
            : undefined
        }
        tableLayout={
          viewState && Object.keys(viewState.fixed).length > 0 ? undefined : "fixed"
        }
        // 勾选只在宿主真的接了选择态时才出现（2026-08-08）。没有 BatchActionBar
        // 的页面凭空多一列复选框是纯噪音——勾了也没地方用。
        rowSelection={
          onSelectionChange
            ? {
                selectedRowKeys: selection?.rowIds?.[bound.entityRef] ?? [],
                onChange: keys =>
                  onSelectionChange(bound.entityRef, keys.map(k => String(k))),
              }
            : undefined
        }
        onRow={row => ({
          "data-testid": "data-table-row",
          onClick: () => onAction?.("rowSelect", { rowId: row.id }),
          style: { cursor: onAction ? "pointer" : undefined },
        })}
      />
    </BlockShell>
  );
};

/**
 * ── 表单/详情族（2026-08-07）─────────────────────────────────────────────
 *
 * 用户裁决的方向："先补积木，门槛只收 Ant Design 官方能力"。表单、抽屉、
 * 弹窗、分步表单、详情这几样是业务系统里最费工的部分，而 ProComponents
 * 早就把它们做完了——**已经装在依赖里**（@ant-design/pro-components 2.8），
 * 此前一个都没包成积木。这一批不引入任何新依赖。
 *
 * 字段从哪来：binding.fieldRefs 声明要哪几个字段（entityFieldRefLists，
 * 门禁会校验字段真的属于那个实体）；没声明就从真实行数据的键里推前 6 个。
 * **不猜字段类型**——类型从 fieldTypeOf 查，查不到按 string 处理，
 * 与其它区块"查不到就回落、不编"的纪律一致。
 */

/** 字段 id → 该出哪种 ProForm 控件。类型来自数据模型，不猜。 */
function formItemFor(
  entityRef: string,
  fieldId: string,
  fieldLabelOf: FieldLabelLookup | undefined,
  enumOptionsOf: EnumOptionsLookup | undefined,
  fieldTypeOf: FieldTypeLookup | undefined
): React.ReactNode {
  const label = fieldLabelOf?.(entityRef, fieldId) ?? fieldId;
  const type = fieldTypeOf?.(entityRef, fieldId) ?? "string";
  const common = { key: fieldId, name: fieldId, label };
  if (type === "enum") {
    const options = (enumOptionsOf?.(entityRef, fieldId) ?? []).map(o => ({
      label: o.label,
      value: o.id,
    }));
    // 枚举没有取值时不出一个空下拉——那是个点开什么都没有的坑，
    // 退回文本框至少还能填。
    if (options.length > 0) return <ProFormSelect {...common} options={options} />;
    return <ProFormText {...common} />;
  }
  if (type === "number") return <ProFormDigit {...common} />;
  if (type === "date") return <ProFormDatePicker {...common} />;
  if (type === "text") return <ProFormTextArea {...common} />;
  return <ProFormText {...common} />;
}

/**
 * binding.fieldRefs 优先；没声明就从真实行的键里取前 `fallbackCap` 个（不编字段）。
 *
 * **声明了就全用，不再截断**——截断是给"没人说要哪几个"准备的兜底，模型明确
 * 写出来的列表再砍一刀等于把它的声明当建议。表单族兜底 6 个，表格族 8 个
 * （2026-08-08 表格从 5 提到 8 的那次判断，见 DataTableRenderer 的说明）。
 */
function boundFieldIds(
  block: ExperienceBlockInstance,
  rows: RuntimeRow[],
  fallbackCap = 6
): string[] {
  const declared = block.binding?.fieldRefs;
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map(f => String(f)).filter(Boolean);
  }
  return [...new Set(rows.flatMap(r => Object.keys(r.values ?? {})))].slice(0, fallbackCap);
}

const RecordFormRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="record-form">
        <BlockEmpty hint="表单未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  if (fields.length === 0)
    return (
      <BlockShell block={block} title={title} testid="record-form">
        <BlockEmpty hint="这个实体还没有可填写的字段" />
      </BlockShell>
    );
  const layout = block.props?.layout === "horizontal" ? "horizontal" : "vertical";
  return (
    <BlockShell block={block} title={title} testid="record-form">
      <ProForm
        layout={layout}
        submitter={{
          searchConfig: { submitText: String(block.props?.submitText ?? "提交") },
          resetButtonProps: false,
        }}
        onFinish={async values => {
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
      >
        {fields.map(f =>
          formItemFor(bound.entityRef, f, fieldLabelOf, enumOptionsOf, fieldTypeOf)
        )}
      </ProForm>
    </BlockShell>
  );
};

const RecordFormDialogRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="record-form-dialog">
        <BlockEmpty hint="表单未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  const triggerText = String(block.props?.triggerText ?? "").trim() || title || "新建";
  // 抽屉与弹窗只差呈现方式，共用同一份字段与提交回调。做成两个积木会让
  // 目录里出现一对只差一个词的孪生条目，AI 选型时也多一次无意义的分叉。
  const Dialog = block.props?.mode === "modal" ? ModalForm : DrawerForm;
  const trigger = <Button type="primary">{triggerText}</Button>;
  return (
    <div data-testid="record-form-dialog">
      <Dialog
        title={title || triggerText}
        trigger={trigger}
        onFinish={async values => {
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
      >
        {fields.map(f =>
          formItemFor(bound.entityRef, f, fieldLabelOf, enumOptionsOf, fieldTypeOf)
        )}
      </Dialog>
    </div>
  );
};

const RecordDetailRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="record-detail">
        <BlockEmpty hint="详情未绑定到有效实体" />
      </BlockShell>
    );
  if (bound.rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="record-detail">
        <BlockEmpty hint="暂无数据 — 先写入第一条真实数据" />
      </BlockShell>
    );
  // 详情展示的是"当前选中那条"。运行时还没有选中态时用第一条——**不是随机
  // 一条**，顺序稳定，截图/回归才可比。
  const row = bound.rows[0];
  const fields = boundFieldIds(block, bound.rows);
  const columns = Math.max(1, Math.min(3, Number(block.props?.columns ?? 2) || 2));
  return (
    <BlockShell block={block}
      title={title}
      testid="record-detail"
      extra={
        <Button size="small" onClick={() => onAction?.("editRequest", { rowId: row.id })}>
          编辑
        </Button>
      }
    >
      <ProDescriptions
        column={columns}
        size="small"
        dataSource={row.values ?? {}}
        columns={fields.map(f => {
          const options = enumOptionsOf?.(bound.entityRef, f) ?? [];
          // 走 DataTable 同一个 renderCell（2026-08-08）。此前这里只把枚举翻成
          // 标签，别的一律 String() 原样打印——同一条订单在表格里金额是
          // ¥428.00、邮箱能点，进了详情就变成 428 和一段死文本。"同一份数据在
          // 两个区块里必须读起来一样"这句纪律本来就写在这，只是当初只兑现了
          // 枚举那一条。
          const sample = row.values?.[f];
          const semantic = fieldSemantic(bound.entityRef, f, sample, fieldTypeOf, options);
          return {
            key: f,
            dataIndex: f,
            title: fieldLabelOf?.(bound.entityRef, f) ?? f,
            render: (_: unknown, record: Record<string, unknown>) =>
              renderCell(semantic, record?.[f], options),
          };
        })}
      />
    </BlockShell>
  );
};

const StepsFormRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  workflow,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="steps-form">
        <BlockEmpty hint="分步表单未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  if (fields.length === 0)
    return (
      <BlockShell block={block} title={title} testid="steps-form">
        <BlockEmpty hint="这个实体还没有可填写的字段" />
      </BlockShell>
    );
  // 分几步、每步叫什么：**优先跟着工作流的链路节点走**，而不是把字段机械
  // 均分。这一页的意义是"五系统关联"——步骤名来自 workflow 才叫关联上了，
  // 按字段数切段只是把一个长表单折起来。链路取不到时才回落到均分两步。
  const chainRef = String(block.props?.chainRef ?? "").trim();
  const chains = workflow?.chains ?? [];
  const chain = chainRef ? chains.find(c => c.id === chainRef) : chains[0];
  const nodeNames = (chain?.nodes ?? [])
    .map(n => String(n?.name ?? n?.id ?? "").trim())
    .filter(Boolean);
  const stepNames = nodeNames.length >= 2 ? nodeNames.slice(0, 4) : ["填写信息", "确认提交"];
  const per = Math.max(1, Math.ceil(fields.length / stepNames.length));
  return (
    <BlockShell block={block} title={title} testid="steps-form">
      <StepsForm
        onFinish={async values => {
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
        onCurrentChange={current => onAction?.("stepChange", { step: current })}
      >
        {stepNames.map((name, i) => (
          <StepsForm.StepForm key={name} name={`step-${i}`} title={name}>
            {fields
              .slice(i * per, (i + 1) * per)
              .map(f =>
                formItemFor(bound.entityRef, f, fieldLabelOf, enumOptionsOf, fieldTypeOf)
              )}
          </StepsForm.StepForm>
        ))}
      </StepsForm>
    </BlockShell>
  );
};

/**
 * ── 可编辑子表 —— 照 pro-components 的 EditableTable（2026-08-08，②批次 1）──
 *
 * 源：`src/table/components/EditableTable/{index,RowEditorTable,CellEditorTable}.tsx`
 *
 * **这次搬的是"接进契约"，不是重写渲染**——`EditableProTable` / `RowEditorTable`
 * / `CellEditorTable` 三个都在我们已装的 pro-components 2.8.10 里导出着，一个
 * 新依赖都不用加。所以真正的活是：把它们接到我们的 binding 上（列从 fieldRefs
 * 来、控件类型从数据模型来），再把它们内部那几条**不看源码就不知道**的行为
 * 用用例钉住，免得哪天换实现的时候悄悄丢掉：
 *
 * 1. **失焦延迟 150ms 才退出编辑。** 原注释：「如果焦点在同一行内的字段间切换
 *    （Tab），新字段的 onFocus 会在 blur 的 setTimeout 回调之前触发，从而取消
 *    定时器、保持编辑态」。立刻退出的话，用户按一下 Tab 就被踢出编辑。
 * 2. **整行编辑与单元格编辑是两套。** 单元格档还要记 activeColumnId，把别的列
 *    显式设成 `editable: false`——不然双击一格，整行都变成输入框。
 * 3. **列标识是 `${列序号}:${dataIndex}`**，不是光用 dataIndex。dataIndex 可能
 *    缺失、也可能重名，光用它会串格。
 * 4. **新行分两种**：`dataSource` 直接进数据（不能取消，只能删）；`cache` 进
 *    缓存（一取消就消失）。这两种在业务上是不同承诺，不是实现细节。
 * 5. **到了行数上限是把新建按钮藏掉**，不是让用户点了再报错。
 */
const EditableSubTableRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="editable-sub-table">
        <BlockEmpty hint="明细表未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  if (fields.length === 0)
    return (
      <BlockShell block={block} title={title} testid="editable-sub-table">
        <BlockEmpty hint="这个实体还没有可填写的字段" />
      </BlockShell>
    );

  // 单元格档 vs 整行档 —— pro-components 把它们做成了两个组件，我们照它分。
  // 默认整行：明细表一行几个字段是一起录的，一格一格双击太碎。
  const cellMode = String(block.props?.editMode ?? "row") === "cell";
  const Editor = cellMode ? CellEditorTable : RowEditorTable;
  const maxRows = Number(block.props?.maxRows);
  const hasLimit = Number.isFinite(maxRows) && maxRows > 0;
  const addText = String(block.props?.addText ?? "").trim() || "新增一行";
  // top / bottom：明细表默认往下加。往上加是"最近录的在最前"那种用法。
  const addPosition = block.props?.addPosition === "top" ? "top" : "bottom";
  // dataSource：新行直接进数据，不能取消只能删；cache：取消就消失。
  // 默认 cache——录一半反悔是常事，直接落进数据的那种更重，得显式选。
  const newRecordType = block.props?.newRecordType === "dataSource" ? "dataSource" : "cache";

  const value = bound.rows.map(r => ({ id: r.id, ...(r.values ?? {}) }));
  const columns = fields.map(f => {
    const options = enumOptionsOf?.(bound.entityRef, f) ?? [];
    const declared = fieldTypeOf?.(bound.entityRef, f);
    return {
      title: fieldLabelOf?.(bound.entityRef, f) ?? f,
      dataIndex: f,
      // valueType 从数据模型的字段类型来，不猜——与 formItemFor 同一条纪律。
      // 查不到按文本处理，跟别处"查不到就回落、不编"一致。
      valueType:
        options.length > 0 || declared === "enum"
          ? ("select" as const)
          : declared === "number"
            ? ("digit" as const)
            : declared === "date"
              ? ("date" as const)
              : declared === "text"
                ? ("textarea" as const)
                : ("text" as const),
      valueEnum:
        options.length > 0
          ? Object.fromEntries(options.map(o => [o.id, { text: o.label }]))
          : undefined,
    };
  });

  return (
    <BlockShell block={block} title={title} testid="editable-sub-table">
      <Editor
        rowKey="id"
        size="small"
        value={value}
        columns={columns}
        // 到上限就**不给按钮**（pro-components 的 shouldShowCreatorButton）。
        // 给了再报错是把"不行"推迟到用户已经动手之后。
        recordCreatorProps={
          hasLimit && value.length >= maxRows
            ? false
            : {
                position: addPosition,
                newRecordType,
                creatorButtonText: addText,
                record: () => ({ id: `new-${Date.now()}` }),
              }
        }
        maxLength={hasLimit ? maxRows : undefined}
        editable={{
          type: cellMode ? "single" : "multiple",
          onSave: async (_key, record) => {
            onAction?.("submitRequest", { entityRef: bound.entityRef, values: record });
          },
          onDelete: async (_key, record) => {
            onAction?.("editRequest", { entityRef: bound.entityRef, rowId: String(record?.id ?? "") });
          },
        }}
      />
    </BlockShell>
  );
};

/**
 * ContentCard —— **唯一一个"卡片"是显式选来的**积木（2026-08-08）。
 *
 * 用户裁决：「不要这个 card 的卡片包裹，组装的时候就要纯粹一点，该是啥就是
 * 啥，该是啥组件就是啥组件。当然了这个 card 它可以只是一个单独的组件，就是
 * 在真正需要包的时候，然后要让 AI 自己组装。」
 *
 * 在这之前，组装页和预设页给**每一个**积木都套了一层 Card。那是替模型做了
 * 决定：所有东西一律装进卡片。现在反过来——默认什么都不套，需要把几个积木
 * 圈在一起时，模型自己往组装结果里放一个 ContentCard，把它们写进 children。
 *
 * 它自己不取数、不发事件，binding 是空的：装什么由 children 决定，里面的
 * 积木各绑各的。
 */
const ContentCardRenderer: ExperienceBlockRenderer = ({ block, children }) => {
  const title = String(block.props?.title ?? "").trim();
  const subtitle = String(block.props?.subtitle ?? "").trim();
  return (
    <Card
      data-testid="content-card"
      size="small"
      variant={block.props?.bordered === true ? "outlined" : "borderless"}
      title={
        title ? (
          <div style={{ paddingTop: 2, paddingBottom: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11, fontWeight: 400, color: "#8c8c8c" }}>{subtitle}</div>
            )}
          </div>
        ) : undefined
      }
      styles={{ body: { padding: 12, display: "flex", flexDirection: "column", gap: 12 } }}
    >
      {/* children 由渲染宿主按 block.children 里的 id 解析后传进来。
          容器空着时如实说空——不画一个假的占位内容充数。 */}
      {children ?? <BlockEmpty hint="这张卡片还没有装任何区块" />}
    </Card>
  );
};

/**
 * ── 区块定义表：**一条记录 = 一个组件**（2026-08-08 重做）───────────────
 *
 * ## 为什么重做
 *
 * 用户要把组件从十几个扩到三五百个。而在此之前，**每加一个组件要手写 8 处**：
 * 目录 JSON、渲染器、注册表、组件库示例数据、HAS_DEMO、IMPL_BY_TYPE、
 * ssot 放开哨兵、手机档名单。14 个时这套很好（每一处都在防漂移，真拦下过
 * 三次）；500 × 8 = 4000 处，它就从护栏变路障了。
 *
 * ## 照着谁改的
 *
 * measuredco/puck 的 ComponentConfig（packages/core/types/Config.tsx）：
 *
 *     components: { [name]: { render, label, fields, defaultProps,
 *                             metadata, permissions, resolveFields, … } }
 *
 * 渲染器与它的全部元信息装在同一个对象里，加组件就是加一条，**没有第二处
 * 名单要同步**。这里照抄这个形状。
 *
 * ## 与 Puck 的一处必要偏离
 *
 * Puck 能把契约也塞进这个对象，因为它只有 TS 一边。我们的契约要跨语言——
 * Python 侧拿 propsSchema/bindingSchema 拼 prompt、跑门禁，
 * experience_block_catalog.json 是两边的共同真相源，挪不进 TS。
 *
 * 所以这里只收**渲染这一侧**的东西（render / phone / demo / impl / label），
 * 契约仍在那份 JSON 里。8 处于是收敛成 2 处，并由
 * ssot-parity 的对账用例钉住两边不许漂。
 *
 * 将来目录从数据库生成时，这个形状不用变。
 */
export interface BlockDefinition {
  /** 桌面渲染器 */
  render: ExperienceBlockRenderer;
  /**
   * 这个区块由哪些**基础组件**组装而成 —— 名字必须是 base-catalog 里真实存在的。
   *
   * 2026-08-08 用户把三层关系说清楚了：「基础组件相当于底层能力，就是素材；
   * 区块就是区域……区块它也是基础组件组装的。我们的流程就是先有基础组件，
   * 再组装成区块，再组装成模板。」
   *
   * 此前这里是一个手写的字符串（impl: "antd Table"），是给人看的散文，
   * 机器读不了。后果是**说不出 137 个基础组件里有多少真被用上了**——
   * 用户问"AI 组装真的是从 130 多个组件里组装的吗"，我只能靠翻 import 回答。
   *
   * 换成真名字数组之后：
   *   · 正着看  这个区块用了哪几个素材
   *   · 反着看  这个基础组件被哪些区块用到了；一个都没有就是**还没接上**
   *   · 对账    ssot 用例校验每个名字都真实存在，写错当场红
   */
  uses: string[];
  /** 中文名。目录 JSON 只有 description，缺一个短标题（lowcode-engine 的 title） */
  label: string;
  /**
   * 手机档有没有自己的渲染器。此前是 PhoneExperienceBlock 里另一张手写名单，
   * 与这里对不上时没有任何东西会报错——手机档会静静地拿桌面渲染器顶上。
   */
  phone?: boolean;
}

/** 目录里有、但渲染侧还没登记的类型会被 ssot 对账当场抓出来。 */
export const BLOCK_DEFINITIONS: Readonly<Record<string, BlockDefinition>> =
  Object.freeze({
    MetricGrid: { render: MetricGridRenderer, uses: ["StatisticCard"], label: "指标卡组", phone: true },
    TrendChart: { render: TrendChartRenderer, uses: ["ECharts"], label: "趋势图" },
    RankedList: { render: RankedListRenderer, uses: ["List", "Progress", "Tag"], label: "排行榜" },
    ActivityFeed: { render: ActivityFeedRenderer, uses: ["Timeline", "Tag"], label: "动态流" },
    DataTable: { render: DataTableRenderer, uses: ["Table", "Tag", "Typography", "Space", "Pagination"], label: "数据表格" },
    QuickActionPanel: { render: QuickActionPanelRenderer, uses: ["Card", "Button", "Space"], label: "快捷操作", phone: true },
    FilterBar: { render: FilterBarRenderer, uses: ["Select", "DatePicker", "Button"], label: "筛选条", phone: true },
    WorkflowTimeline: { render: WorkflowTimelineRenderer, uses: ["Card", "Steps"], label: "流程条", phone: true },
    FreeformInsight: { render: FreeformInsightRenderer, uses: [], label: "自由版式" },
    RecordForm: { render: RecordFormRenderer, uses: ["Form", "Input", "InputNumber", "Select", "DatePicker"], label: "记录表单" },
    RecordFormDialog: { render: RecordFormDialogRenderer, uses: ["Drawer", "Modal", "Form", "Input", "Select", "Button"], label: "弹层表单" },
    RecordDetail: { render: RecordDetailRenderer, uses: ["Descriptions", "Tag", "Button"], label: "记录详情" },
    StepsForm: { render: StepsFormRenderer, uses: ["Steps", "Form", "Input", "Select", "DatePicker"], label: "分步表单" },
    EditableSubTable: { render: EditableSubTableRenderer, uses: ["Table", "Form", "Input", "Select", "DatePicker", "InputNumber", "Button"], label: "可编辑子表" },
    ContentCard: { render: ContentCardRenderer, uses: ["Card"], label: "内容卡片" },
    PageHeader: { render: PageHeaderRenderer, uses: ["Button", "Space", "Typography"], label: "页面头" },
    ResultPanel: { render: ResultPanelRenderer, uses: ["Result", "Button", "Space"], label: "结果屏" },
    StatusTabs: { render: StatusTabsRenderer, uses: ["Tabs", "Badge"], label: "状态切换栏" },
    BatchActionBar: { render: BatchActionBarRenderer, uses: ["Alert", "Button", "Flex", "Checkbox"], label: "批量操作栏" },
    ColumnSettingPanel: { render: ColumnSettingPanelRenderer, uses: ["Checkbox", "Button", "Tooltip", "Flex"], label: "列设置" },
  });

/** 手机档有专属渲染器的类型 —— 从定义表派生，不再另立名单。 */
export const PHONE_BLOCK_TYPES: ReadonlySet<string> = new Set(
  Object.entries(BLOCK_DEFINITIONS)
    .filter(([, d]) => d.phone)
    .map(([type]) => type)
);

/**
 * rendererKey → 渲染器。**从定义表派生**，不再手写第二份。
 *
 * 保留这张表是因为目录 JSON 用 rendererKey 索引（区块 type 与渲染器实现是
 * 多对一的，将来一个渲染器要带多个行业变体时更是如此——见 lowcode-engine
 * 的 snippets）。这里只是把 type→render 换算成 rendererKey→render。
 */
export const EXPERIENCE_BLOCK_RENDERERS: Readonly<
  Record<string, ExperienceBlockRenderer>
> = Object.freeze(
  Object.fromEntries(
    EXPERIENCE_BLOCK_CATALOG.blocks
      .map(entry => [entry.rendererKey, BLOCK_DEFINITIONS[entry.type]?.render])
      .filter(([, render]) => Boolean(render))
  ) as Record<string, ExperienceBlockRenderer>
);

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
