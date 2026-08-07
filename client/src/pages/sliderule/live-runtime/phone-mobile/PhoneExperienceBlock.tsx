import React from "react";
import { PHONE_BLOCK_TYPES } from "../block-registry";
import {
  Button,
  Card,
  CalendarPicker,
  ErrorBlock,
  Form,
  Grid,
  List,
  Picker,
  Selector,
  Space,
  Steps,
} from "antd-mobile";
import { computeAggregate, parseAggregate } from "../block-data";
import type {
  ExperienceBlockRendererProps,
  FilterFieldOption,
  PageFilterState,
} from "../block-registry";

/**
 * 手机档有没有专属渲染器 —— **从区块定义表派生**（2026-08-08）。
 *
 * 此前这里是一张手写名单，与 block-registry 那边各写各的。两处对不上时
 * 没有任何东西会报错：手机档会静静地拿桌面渲染器顶上，而"顶上了"和"本来
 * 就该这样"在界面上长得一模一样。500 个组件时这种沉默漂移必然发生。
 *
 * 现在唯一真相是 BLOCK_DEFINITIONS 里那条记录的 `phone` 字段。
 */
export function isPhoneExperienceBlock(type: string): boolean {
  return PHONE_BLOCK_TYPES.has(type);
}

function titleOf(props: ExperienceBlockRendererProps) {
  return String(props.block.props?.title ?? "").trim();
}

/**
 * 手机档外壳 —— 与桌面 BlockShell 同一条规矩（2026-08-08）：
 * **标题是这个区块自己的，卡片只是可选的表面**。
 *
 * 此前这四个手机渲染器各自直接套 antd-mobile 的 `<Card title=…>`，于是
 * 标题又一次由壳提供。桌面那边刚改完，手机这条路径**完全没被碰到**——
 * 我当时以为改的是"渲染器"，实际只改了走 BlockShell 的那八个，手机档
 * 走的是另一套代码。用户一眼看出来卡片还在。
 *
 * surface 的判据与桌面逐字一致（props.surface === "plain"），这样同一个
 * 区块在两个档位下的行为不会分叉——分叉了也没人看得出来，因为多一层白底
 * 和本来就该有一层长得一样。
 */
function PhoneShell({
  block,
  title,
  testid,
  children,
}: {
  block: ExperienceBlockRendererProps["block"];
  title?: string;
  testid: string;
  children: React.ReactNode;
}) {
  const plain = block?.props?.surface === "plain";
  if (plain) {
    return (
      <div data-testid={testid}>
        {title && (
          <div
            data-testid={`${testid}-header`}
            style={{ fontSize: 15, fontWeight: 600, padding: "0 0 8px" }}
          >
            {title}
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <Card title={title || undefined} data-testid={testid}>
      {children}
    </Card>
  );
}

function MobileEmpty({ description }: { description: string }) {
  return (
    <ErrorBlock
      status="empty"
      title={description}
      style={{ padding: "12px 0", "--image-height": "52px" } as React.CSSProperties}
    />
  );
}

function FilterSelector({
  field,
  value,
  onChange,
}: {
  field: FilterFieldOption;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const useSelector = field.options.length <= 6;

  return (
    <Form.Item label={field.label} layout="vertical">
      {useSelector ? (
        <Selector
          columns={2}
          options={field.options}
          value={value ? [value] : []}
          onChange={values => onChange(values[0])}
          showCheckMark={false}
        />
      ) : (
        <>
          <List mode="card" style={{ margin: 0 }}>
            <List.Item
              clickable
              arrowIcon
              onClick={() => setVisible(true)}
              extra={field.options.find(option => option.value === value)?.label ?? "未选择"}
              data-testid={`phone-filter-picker-${field.id}`}
            >
              选择{field.label}
            </List.Item>
          </List>
          <Picker
            columns={[field.options]}
            visible={visible}
            value={value ? [value] : []}
            title={field.label}
            onClose={() => setVisible(false)}
            onConfirm={values => {
              const next = values[0];
              onChange(typeof next === "string" ? next : undefined);
              setVisible(false);
            }}
          />
        </>
      )}
    </Form.Item>
  );
}

function DateRangeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [string, string] | null;
  onChange: (value: [string, string] | null) => void;
}) {
  const [active, setActive] = React.useState(false);
  const parse = (raw?: string) => (raw ? new Date(`${raw}T00:00:00`) : undefined);
  const format = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const start = value?.[0];
  const end = value?.[1];
  const selectedRange = start && end
    ? ([parse(start)!, parse(end)!] as [Date, Date])
    : null;

  return (
    <Form.Item label={label} layout="vertical">
      <List mode="card" style={{ margin: 0 }}>
        <List.Item
          clickable
          arrowIcon
          extra={start && end ? `${start} - ${end}` : "未选择"}
          onClick={() => setActive(true)}
          data-testid="phone-filter-date-range"
        >
          选择日期范围
        </List.Item>
      </List>
      <CalendarPicker
        visible={active}
        selectionMode="range"
        value={selectedRange}
        title={label}
        onClose={() => setActive(false)}
        onConfirm={range => {
          onChange(range ? [format(range[0]), format(range[1])] : null);
          setActive(false);
        }}
      />
    </Form.Item>
  );
}

function PhoneFilterBar(props: ExperienceBlockRendererProps) {
  const fields = props.filterFieldOptions ?? [];
  const showDateRange =
    props.block.props?.showDateRange === true && Boolean(props.dateRangeField);
  const [draft, setDraft] = React.useState<PageFilterState>(() => ({
    enumFilters: { ...(props.filterState?.enumFilters ?? {}) },
    dateRange: props.filterState?.dateRange ?? null,
  }));

  React.useEffect(() => {
    setDraft({
      enumFilters: { ...(props.filterState?.enumFilters ?? {}) },
      dateRange: props.filterState?.dateRange ?? null,
    });
  }, [props.filterState]);

  if (!showDateRange && fields.length === 0) {
    return (
      <PhoneShell block={props.block} testid="phone-filter-bar-empty">
        <MobileEmpty description="本页无可筛选字段" />
      </PhoneShell>
    );
  }

  const reset = () => {
    const next = {
      enumFilters: Object.fromEntries(fields.map(field => [field.id, undefined])),
      dateRange: null,
    } satisfies PageFilterState;
    setDraft(next);
    props.onFilterChange?.(next);
  };

  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-filter-bar">
      <Form layout="vertical" mode="card" style={{ margin: 0 }}>
        {showDateRange && props.dateRangeField && (
          <DateRangeField
            label={props.dateRangeField.label}
            value={draft.dateRange ?? null}
            onChange={dateRange => setDraft(current => ({ ...current, dateRange }))}
          />
        )}
        {fields.map(field => (
          <FilterSelector
            key={field.id}
            field={field}
            value={draft.enumFilters[field.id]}
            onChange={value =>
              setDraft(current => ({
                ...current,
                enumFilters: { ...current.enumFilters, [field.id]: value },
              }))
            }
          />
        ))}
      </Form>
      <Grid columns={2} gap={8} style={{ marginTop: 12 }}>
        <Grid.Item>
          <Button block fill="outline" onClick={reset}>
            重置
          </Button>
        </Grid.Item>
        <Grid.Item>
          <Button block color="primary" onClick={() => props.onFilterChange?.(draft)}>
            查询
          </Button>
        </Grid.Item>
      </Grid>
    </PhoneShell>
  );
}

function PhoneMetricGrid(props: ExperienceBlockRendererProps) {
  const entityRef = String(props.block.binding?.entityRef ?? "").trim();
  const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  const aggregate = parseAggregate(props.block.binding?.aggregate);
  const value = rows ? computeAggregate(rows, aggregate) : null;
  const label =
    aggregate.kind === "count"
      ? "记录数"
      : `${aggregate.kind === "sum" ? "合计" : "平均"} · ${aggregate.fieldId}`;
  const displayValue =
    value === null ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-metric-grid">
      {rows ? (
        <List mode="card" style={{ margin: 0 }}>
          <List.Item title={label} extra={displayValue} />
        </List>
      ) : (
        <MobileEmpty description="指标未绑定到有效实体" />
      )}
    </PhoneShell>
  );
}

function PhoneWorkflowTimeline(props: ExperienceBlockRendererProps) {
  const chainRef = String(props.block.props?.chainRef ?? "").trim();
  const chain = chainRef
    ? props.workflow?.chains?.find(item => item.id === chainRef || item.name === chainRef)
    : undefined;
  const nodes = (chainRef ? chain?.nodes : props.workflow?.nodes) ?? [];
  const transitions = (chainRef ? chain?.transitions : props.workflow?.transitions) ?? [];
  const conditionByFrom = new Map(
    transitions.filter(item => item.condition).map(item => [item.from, item.condition])
  );

  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-workflow-timeline">
      {nodes.length > 0 ? (
        <Steps
          direction="vertical"
          current={-1}
        >
          {nodes.map(node => (
            <Steps.Step
              key={node.id}
              title={node.name || node.id}
              description={[node.assigneeRole, conditionByFrom.get(node.id)]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Steps>
      ) : (
        <MobileEmpty description="暂无可展示的流程节点" />
      )}
    </PhoneShell>
  );
}

function PhoneQuickActionPanel(props: ExperienceBlockRendererProps) {
  const actions = props.pageActions ?? [];
  // 与桌面档同一条纪律（2026-08-07）：一个候选动作都没有时整块不渲染。
  // 手机档屏幕更窄，一张只写着"暂无可用操作"的卡代价比桌面还大。
  // 理由与边界见 block-registry.tsx 的 QuickActionPanelRenderer。
  //
  // 两档要一起改：只改桌面会造成"同一个应用，手机上多出一张空卡"这种
  // 档位不对称——这类不对称在这个项目里踩过（见任务 17 那轮）。
  if (actions.length === 0) return null;
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-quick-action-panel">
      {actions.length > 0 ? (
        <Space direction="vertical" block style={{ "--gap": "8px" } as React.CSSProperties}>
          {actions.map(action => (
            <Button
              key={action.id}
              block
              fill="outline"
              disabled={!action.permitted}
              onClick={() => props.onAction?.(action.id)}
            >
              {action.label}
            </Button>
          ))}
        </Space>
      ) : (
        <MobileEmpty description="暂无可用操作" />
      )}
    </PhoneShell>
  );
}

export default function PhoneExperienceBlock(props: ExperienceBlockRendererProps) {
  switch (props.block.type) {
    case "FilterBar":
      return <PhoneFilterBar {...props} />;
    case "MetricGrid":
      return <PhoneMetricGrid {...props} />;
    case "WorkflowTimeline":
      return <PhoneWorkflowTimeline {...props} />;
    case "QuickActionPanel":
      return <PhoneQuickActionPanel {...props} />;
    default:
      return null;
  }
}
