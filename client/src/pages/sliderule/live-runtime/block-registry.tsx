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
import { ArrowRightOutlined } from "@ant-design/icons";

import catalogJson from "@experience-blocks";
import type { WorkflowSection } from "../system-screens/five-system-model";

export interface ExperienceBlockCatalogEntry {
  type: string;
  description: string;
  rendererKey: string;
  propsSchema: Record<string, unknown>;
  dataKinds: string[];
  allowedSlots: string[];
  events: string[];
}

export interface ExperienceBlockInstance {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  binding?: Record<string, unknown>;
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
}

export type ExperienceBlockRenderer =
  React.ComponentType<ExperienceBlockRendererProps>;

interface ExperienceBlockCatalogFile {
  version: number;
  allowedSlots: string[];
  dataKinds: string[];
  eventTypes: string[];
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
    >
      {children}
    </Renderer>
  );
}
