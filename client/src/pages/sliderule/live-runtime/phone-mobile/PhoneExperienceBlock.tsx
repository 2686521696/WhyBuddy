import React from "react";
import { PHONE_BLOCK_TYPES } from "../block-registry";
import {
  Badge,
  Button,
  Card,
  CalendarPicker,
  Checkbox,
  Collapse,
  ErrorBlock,
  Form,
  Grid,
  Image,
  Input,
  List,
  Picker,
  Popup,
  ProgressBar,
  SearchBar,
  Segmented,
  Selector,
  Space,
  Steps,
  Tabs,
  TextArea,
} from "antd-mobile";
import { computeAggregate, parseAggregate } from "../block-data";
import type {
  ExperienceBlockRendererProps,
  FilterFieldOption,
  PageFilterState,
} from "../block-registry";

const PhoneLazyEchartsChart = React.lazy(() => import("../EchartsChart"));

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

function phoneField(props: ExperienceBlockRendererProps, key: string): string | undefined {
  const value = props.block.binding?.[key];
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function phoneFieldList(props: ExperienceBlockRendererProps, key: string): string[] {
  const value = props.block.binding?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function phoneRows(props: ExperienceBlockRendererProps) {
  const entityRef = String(props.block.binding?.entityRef ?? "").trim();
  if (!entityRef || !props.entityRows || !(entityRef in props.entityRows)) return null;
  return { entityRef, rows: props.entityRows[entityRef] ?? [] };
}

function formatPhoneSize(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function PhoneAttachmentPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const nameRef = phoneField(props, "fileNameFieldRef");
  const sizeRef = phoneField(props, "fileSizeFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const timeRef = phoneField(props, "uploadedAtFieldRef");
  if (!bound || !nameRef) {
    return (
      <PhoneShell block={props.block} title={titleOf(props)} testid="phone-attachment-panel">
        <MobileEmpty description="附件面板尚未绑定有效实体和文件名字段" />
      </PhoneShell>
    );
  }
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-attachment-panel">
      {bound.rows.length === 0 ? (
        <MobileEmpty description={String(props.block.props?.emptyText ?? "还没有附件")} />
      ) : (
        <List mode="card" style={{ margin: 0 }}>
          {bound.rows.map(row => {
            const status = statusRef ? String(row.values?.[statusRef] ?? "").trim() : "";
            const size = sizeRef ? formatPhoneSize(row.values?.[sizeRef]) : "";
            const time = timeRef ? String(row.values?.[timeRef] ?? "").trim() : "";
            const pending = status.includes("上传") || status.includes("等待");
            return (
              <List.Item
                key={row.id}
                clickable
                arrowIcon
                extra={size}
                description={[status, time].filter(Boolean).join(" · ")}
                onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
              >
                {String(row.values?.[nameRef] ?? "未命名附件")}
                {pending && <ProgressBar percent={25} style={{ marginTop: 6 }} />}
              </List.Item>
            );
          })}
        </List>
      )}
      {props.block.props?.allowUpload === true && (
        <Button
          block
          color="primary"
          fill="outline"
          style={{ marginTop: 10 }}
          onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef })}
        >
          {String(props.block.props?.uploadText ?? "添加附件")}
        </Button>
      )}
    </PhoneShell>
  );
}

function PhoneCommentThread(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const authorRef = phoneField(props, "authorFieldRef");
  const contentRef = phoneField(props, "contentFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const avatarRef = phoneField(props, "avatarFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const parentRef = phoneField(props, "parentFieldRef");
  const [draft, setDraft] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(Math.max(1, Number(props.block.props?.pageSize ?? 5) || 5));
  if (!bound || !authorRef || !contentRef || !timeRef) {
    return (
      <PhoneShell block={props.block} title={titleOf(props)} testid="phone-comment-thread">
        <MobileEmpty description="讨论区尚未绑定作者、内容和时间字段" />
      </PhoneShell>
    );
  }
  const roots = bound.rows.filter(row => !parentRef || !String(row.values?.[parentRef] ?? "").trim());
  const replies = (id: string) => parentRef
    ? bound.rows.filter(row => String(row.values?.[parentRef] ?? "").trim() === id)
    : [];
  const renderRow = (row: (typeof bound.rows)[number], nested = false) => (
    <List.Item
      key={row.id}
      prefix={
        avatarRef && row.values?.[avatarRef] ? (
          <Image src={String(row.values[avatarRef])} width={32} height={32} fit="cover" style={{ borderRadius: 16 }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 16, background: "#eef3ff", color: "#1677ff", display: "grid", placeItems: "center" }}>
            {String(row.values?.[authorRef] ?? "?").slice(0, 1)}
          </div>
        )
      }
      description={
        <div>
          <div style={{ color: "#999", fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}</div>
          <div style={{ marginTop: 4, color: "#333", whiteSpace: "normal" }}>{String(row.values?.[contentRef] ?? "")}</div>
          {statusRef && row.values?.[statusRef] != null && <div style={{ marginTop: 3, color: "#fa8c16", fontSize: 12 }}>{String(row.values[statusRef])}</div>}
          {!nested && props.block.props?.allowReply !== false && (
            <Button size="mini" fill="none" onClick={() => setReplyTo(replyTo === row.id ? null : row.id)}>
              {replyTo === row.id ? "取消回复" : "回复"}
            </Button>
          )}
        </div>
      }
      style={nested ? { paddingLeft: 32, background: "#fafafa" } : undefined}
    >
      {String(row.values?.[authorRef] ?? "未知用户")}
    </List.Item>
  );
  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    props.onAction?.("submitRequest", {
      entityRef: bound.entityRef,
      values: { [contentRef]: content, ...(parentRef && replyTo ? { [parentRef]: replyTo } : {}) },
    });
    setDraft("");
    setReplyTo(null);
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-comment-thread">
      {roots.length === 0 ? <MobileEmpty description="还没有讨论内容" /> : (
        <List mode="card" style={{ margin: 0 }}>
          {roots.slice(0, visible).flatMap(row => [renderRow(row), ...replies(row.id).map(reply => renderRow(reply, true))])}
        </List>
      )}
      {visible < roots.length && <Button block fill="none" onClick={() => setVisible(current => current + 5)}>加载更多</Button>}
      <TextArea
        value={draft}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={replyTo ? "写下回复" : String(props.block.props?.composerPlaceholder ?? "写下评论")}
        onChange={setDraft}
        style={{ marginTop: 10, padding: 10, background: "#f7f8fa", borderRadius: 6 }}
      />
      <Button block color="primary" disabled={!draft.trim()} onClick={submit} style={{ marginTop: 8 }}>
        {String(props.block.props?.submitText ?? "发布")}
      </Button>
    </PhoneShell>
  );
}

function PhoneRecordPicker(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const descRef = phoneField(props, "descFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const multiple = props.block.props?.selectionMode !== "single";
  const limit = Math.max(1, Number(props.block.props?.maxSelected ?? 100) || 100);
  if (!bound || !titleRef) {
    return (
      <PhoneShell block={props.block} title={titleOf(props)} testid="phone-record-picker">
        <MobileEmpty description="记录选择器尚未绑定有效实体和标题字段" />
      </PhoneShell>
    );
  }
  const shown = bound.rows.filter(row =>
    [row.values?.[titleRef], descRef ? row.values?.[descRef] : ""]
      .some(value => String(value ?? "").toLowerCase().includes(keyword.trim().toLowerCase()))
  );
  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? multiple ? [...selected.filter(value => value !== id), id].slice(-limit) : [id]
      : selected.filter(value => value !== id);
    setSelected(next);
    props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowIds: next });
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-record-picker">
      {props.block.props?.searchable !== false && <SearchBar value={keyword} onChange={setKeyword} placeholder="搜索可选记录" style={{ marginBottom: 8 }} />}
      {shown.length === 0 ? <MobileEmpty description={keyword ? "没有匹配的记录" : "暂无可选记录"} /> : (
        <List mode="card" style={{ margin: 0 }}>
          {shown.map(row => {
            const checked = selected.includes(row.id);
            return (
              <List.Item
                key={row.id}
                prefix={
                  <span onClick={event => event.stopPropagation()}>
                    <Checkbox checked={checked} onChange={value => toggle(row.id, value)} />
                  </span>
                }
                extra={statusRef ? String(row.values?.[statusRef] ?? "") : undefined}
                description={descRef ? String(row.values?.[descRef] ?? "") : undefined}
                onClick={() => toggle(row.id, !checked)}
              >
                {String(row.values?.[titleRef] ?? "未命名记录")}
              </List.Item>
            );
          })}
        </List>
      )}
      <Grid columns={2} gap={8} style={{ marginTop: 10 }}>
        <Grid.Item><Button block fill="outline" disabled={selected.length === 0} onClick={() => setSelected([])}>清空</Button></Grid.Item>
        <Grid.Item>
          <Button block color="primary" disabled={selected.length === 0} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: selected })}>
            {String(props.block.props?.confirmText ?? `确认选择 (${selected.length})`)}
          </Button>
        </Grid.Item>
      </Grid>
    </PhoneShell>
  );
}

function PhoneKanbanBoard(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const descRef = phoneField(props, "descFieldRef");
  const assigneeRef = phoneField(props, "assigneeFieldRef");
  const [active, setActive] = React.useState("");
  const [moving, setMoving] = React.useState<string | null>(null);
  if (!bound || !titleRef || !statusRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-kanban-board"><MobileEmpty description="看板尚未绑定标题和状态字段" /></PhoneShell>;
  }
  const declared = props.enumOptionsOf?.(bound.entityRef, statusRef) ?? [];
  const raw = Array.from(new Set(bound.rows.map(row => String(row.values?.[statusRef] ?? "").trim()).filter(Boolean)));
  const columns = declared.length > 0 ? declared.map(option => ({ label: option.label, value: option.id })) : raw.map(value => ({ label: value, value }));
  const current = columns.some(column => column.value === active) ? active : columns[0]?.value ?? "";
  const rows = bound.rows.filter(row => String(row.values?.[statusRef] ?? "") === current);
  const move = (status: string) => {
    if (!moving) return;
    props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: moving, values: { [statusRef]: status } });
    setMoving(null);
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-kanban-board">
      {columns.length === 0 ? <MobileEmpty description="状态字段还没有可用分组" /> : (
        <>
          <Segmented block value={current} options={columns} onChange={value => setActive(String(value))} />
          {rows.length === 0 ? <MobileEmpty description="这一列还没有记录" /> : (
            <List mode="card" style={{ margin: "10px 0 0" }}>
              {rows.map(row => (
                <List.Item
                  key={row.id}
                  clickable
                  arrowIcon
                  description={[descRef ? row.values?.[descRef] : "", assigneeRef ? row.values?.[assigneeRef] : ""].filter(Boolean).join(" · ")}
                  extra={props.block.props?.movable !== false ? <Button size="mini" fill="outline" onClick={event => { event.stopPropagation(); setMoving(row.id); }}>移动</Button> : undefined}
                  onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
                >
                  {String(row.values?.[titleRef] ?? "未命名记录")}
                </List.Item>
              ))}
            </List>
          )}
          <Picker
            columns={[columns]}
            visible={Boolean(moving)}
            value={[current]}
            title="移动到状态"
            onClose={() => setMoving(null)}
            onConfirm={values => move(String(values[0] ?? current))}
          />
        </>
      )}
    </PhoneShell>
  );
}

function PhoneScheduleCalendar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const startRef = phoneField(props, "startFieldRef");
  const endRef = phoneField(props, "endFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const initial = new Date(String(props.block.props?.initialDate ?? ""));
  const [selected, setSelected] = React.useState<Date>(Number.isNaN(initial.getTime()) ? new Date() : initial);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  if (!bound || !titleRef || !startRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-schedule-calendar"><MobileEmpty description="日历尚未绑定标题和开始时间字段" /></PhoneShell>;
  }
  const key = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`;
  const events = bound.rows.filter(row => String(row.values?.[startRef] ?? "").slice(0, 10) === key);
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-schedule-calendar">
      <List mode="card" style={{ margin: 0 }}>
        <List.Item clickable arrowIcon extra={key} onClick={() => setPickerVisible(true)}>选择日期</List.Item>
      </List>
      <CalendarPicker
        selectionMode="single"
        visible={pickerVisible}
        value={selected}
        onClose={() => setPickerVisible(false)}
        onConfirm={value => { if (value) setSelected(value); setPickerVisible(false); }}
        weekStartsOn="Monday"
        renderBottom={date => bound.rows.some(row => String(row.values?.[startRef] ?? "").slice(0, 10) === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`) ? <Badge content={Badge.dot} /> : null}
      />
      <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600 }}>{selected.getMonth() + 1} 月 {selected.getDate()} 日</div>
      {events.length === 0 ? <MobileEmpty description="这一天还没有日程" /> : (
        <List mode="card" style={{ margin: "8px 0 0" }}>
          {events.map(row => (
            <List.Item key={row.id} clickable arrowIcon description={(() => { const start = String(row.values?.[startRef] ?? ""); const end = endRef ? String(row.values?.[endRef] ?? "") : ""; const range = end && end !== start ? `${start} - ${end}` : start; const status = statusRef ? String(row.values?.[statusRef] ?? "") : ""; return [range, status].filter(Boolean).join(" · "); })()} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>
              {String(row.values?.[titleRef] ?? "未命名日程")}
            </List.Item>
          ))}
        </List>
      )}
      {props.block.props?.allowCreate === true && <Button block color="primary" fill="outline" style={{ marginTop: 10 }} onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef, date: key })}>新建日程</Button>}
    </PhoneShell>
  );
}

function PhoneNotificationInbox(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const contentRef = phoneField(props, "contentFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const categoryRef = phoneField(props, "categoryFieldRef");
  const readRef = phoneField(props, "readFieldRef");
  const [category, setCategory] = React.useState("全部");
  const [readIds, setReadIds] = React.useState<string[]>([]);
  const pageSize = Math.max(1, Number(props.block.props?.pageSize ?? 5) || 5);
  const [visible, setVisible] = React.useState(pageSize);
  if (!bound || !titleRef || !contentRef || !timeRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-notification-inbox"><MobileEmpty description="通知中心尚未绑定标题、内容和时间字段" /></PhoneShell>;
  }
  const isRead = (row: (typeof bound.rows)[number]) => readIds.includes(row.id) || (readRef ? [true, 1, "1", "true", "read", "已读"].includes(row.values?.[readRef] as never) : false);
  const categories = categoryRef ? Array.from(new Set(bound.rows.map(row => String(row.values?.[categoryRef] ?? "").trim()).filter(Boolean))) : [];
  const shown = (category === "全部" ? bound.rows : bound.rows.filter(row => String(row.values?.[categoryRef!] ?? "") === category)).slice(0, visible);
  const unread = bound.rows.filter(row => !isRead(row)).length;
  const mark = (row: (typeof bound.rows)[number]) => {
    if (!isRead(row)) {
      setReadIds(current => [...current, row.id]);
      if (readRef) props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, values: { [readRef]: "read" } });
    }
    props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id });
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-notification-inbox">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <Button size="mini" fill="none" disabled={unread === 0} onClick={() => { const ids = bound.rows.filter(row => !isRead(row)).map(row => row.id); setReadIds(current => Array.from(new Set([...current, ...ids]))); props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: ids, operation: "markRead" }); }}>全部已读</Button>
      </div>
      <Segmented block value={category} options={["全部", ...categories]} onChange={value => { setCategory(String(value)); setVisible(pageSize); }} style={{ marginBottom: 8 }} />
      {shown.length === 0 ? <MobileEmpty description="这个分类还没有通知" /> : (
        <List mode="card" style={{ margin: 0 }}>
          {shown.map(row => (
            <List.Item key={row.id} clickable arrowIcon prefix={!isRead(row) ? <Badge content={Badge.dot}><span style={{ width: 8 }} /></Badge> : <span style={{ width: 8 }} />} description={<><div style={{ whiteSpace: "normal", opacity: isRead(row) ? 0.55 : 1 }}>{String(row.values?.[contentRef] ?? "")}</div><div style={{ marginTop: 3, color: "#999", fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}</div></>} onClick={() => mark(row)}>
              <span style={{ opacity: isRead(row) ? 0.55 : 1 }}>{String(row.values?.[titleRef] ?? "未命名通知")}</span>
            </List.Item>
          ))}
        </List>
      )}
      {visible < (category === "全部" ? bound.rows.length : bound.rows.filter(row => String(row.values?.[categoryRef!] ?? "") === category).length) && <Button block fill="none" onClick={() => setVisible(current => current + pageSize)}>查看更多</Button>}
    </PhoneShell>
  );
}

type PhoneTreeNode = { id: string; label: string; desc: string; children: PhoneTreeNode[] };

function PhoneTreeNavigator(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const labelRef = phoneField(props, "labelFieldRef");
  const parentRef = phoneField(props, "parentFieldRef");
  const descRef = phoneField(props, "descFieldRef");
  const [keyword, setKeyword] = React.useState("");
  if (!bound || !labelRef || !parentRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-tree-navigator"><MobileEmpty description="层级导航尚未绑定名称和父节点字段" /></PhoneShell>;
  }
  const nodes = new Map<string, PhoneTreeNode>();
  for (const row of bound.rows) nodes.set(row.id, { id: row.id, label: String(row.values?.[labelRef] ?? "未命名节点"), desc: descRef ? String(row.values?.[descRef] ?? "") : "", children: [] });
  const roots: PhoneTreeNode[] = [];
  for (const row of bound.rows) {
    const node = nodes.get(row.id)!;
    const parent = nodes.get(String(row.values?.[parentRef] ?? ""));
    if (parent && parent.id !== row.id) parent.children.push(node); else roots.push(node);
  }
  const search = keyword.trim().toLowerCase();
  const filter = (items: PhoneTreeNode[]): PhoneTreeNode[] => items.flatMap(node => {
    const children = filter(node.children);
    return !search || node.label.toLowerCase().includes(search) || children.length ? [{ ...node, children }] : [];
  });
  const shown = filter(roots);
  const select = (id: string) => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: id });
  const render = (items: PhoneTreeNode[], depth = 0): React.ReactNode => (
    <Collapse accordion={false} defaultActiveKey={search ? items.map(item => item.id) : []}>
      {items.map(node => node.children.length > 0 ? (
        <Collapse.Panel key={node.id} title={<span>{node.label}{node.desc && <span style={{ marginLeft: 6, color: "#999", fontSize: 12 }}>{node.desc}</span>}</span>}>
          <Button size="mini" fill="none" onClick={() => select(node.id)}>查看当前节点</Button>
          <div style={{ marginLeft: Math.min(depth + 1, 2) * 8, marginTop: 6 }}>{render(node.children, depth + 1)}</div>
        </Collapse.Panel>
      ) : (
        <Collapse.Panel key={node.id} arrowIcon={false} title={<span onClick={() => select(node.id)}>{node.label}{node.desc && <span style={{ marginLeft: 6, color: "#999", fontSize: 12 }}>{node.desc}</span>}</span>} />
      ))}
    </Collapse>
  );
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-tree-navigator">
      {props.block.props?.searchable !== false && <SearchBar value={keyword} onChange={setKeyword} placeholder="搜索层级节点" style={{ marginBottom: 8 }} />}
      {shown.length === 0 ? <MobileEmpty description={search ? "没有匹配的层级节点" : "还没有层级数据"} /> : render(shown)}
    </PhoneShell>
  );
}

function PhoneApprovalQueue(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const applicantRef = phoneField(props, "applicantFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const summaryRef = phoneField(props, "summaryFieldRef");
  const pendingValue = String(props.block.props?.pendingValue ?? "pending");
  const approvedValue = String(props.block.props?.approvedValue ?? "approved");
  const rejectedValue = String(props.block.props?.rejectedValue ?? "rejected");
  const [tab, setTab] = React.useState("pending");
  const [decisions, setDecisions] = React.useState<Record<string, string>>({});
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  if (!bound || !titleRef || !statusRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-approval-queue"><MobileEmpty description="审批队列尚未绑定标题和状态字段" /></PhoneShell>;
  }
  const statusOf = (row: (typeof bound.rows)[number]) => decisions[row.id] ?? String(row.values?.[statusRef] ?? "");
  const pending = bound.rows.filter(row => statusOf(row) === pendingValue);
  const completed = bound.rows.filter(row => statusOf(row) !== pendingValue);
  const shown = tab === "pending" ? pending : completed;
  const submit = (rowId: string, outcome: string, comment = "") => {
    setDecisions(current => ({ ...current, [rowId]: outcome }));
    props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId, outcome, comment, values: { [statusRef]: outcome } });
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-approval-queue">
      <Segmented block value={tab} options={[{ label: `待处理 ${pending.length}`, value: "pending" }, { label: `已处理 ${completed.length}`, value: "completed" }]} onChange={value => setTab(String(value))} />
      {shown.length === 0 ? <MobileEmpty description={tab === "pending" ? "当前没有待审批任务" : "还没有已处理任务"} /> : (
        <List mode="card" style={{ margin: "8px 0 0" }}>
          {shown.map(row => {
            const status = statusOf(row);
            return <List.Item key={row.id} description={[applicantRef ? row.values?.[applicantRef] : "", timeRef ? row.values?.[timeRef] : "", summaryRef ? row.values?.[summaryRef] : ""].filter(Boolean).map(String).join(" · ")} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>
              <div>{String(row.values?.[titleRef] ?? "未命名审批")}</div>
              {status === pendingValue ? <Grid columns={2} gap={8} style={{ marginTop: 8 }}><Grid.Item><Button block size="small" color="danger" fill="outline" onClick={event => { event.stopPropagation(); setRejecting(row.id); setReason(""); }}>驳回</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" onClick={event => { event.stopPropagation(); submit(row.id, approvedValue); }}>通过</Button></Grid.Item></Grid> : <div style={{ marginTop: 5, color: status === approvedValue ? "#00b578" : "#ff3141", fontSize: 12 }}>{status === approvedValue ? "已通过" : "已驳回"}</div>}
            </List.Item>;
          })}
        </List>
      )}
      <Popup visible={Boolean(rejecting)} position="bottom" closeOnMaskClick onMaskClick={() => setRejecting(null)} bodyStyle={{ padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>填写驳回原因</div>
        <TextArea value={reason} onChange={setReason} placeholder="请输入驳回原因" autoSize={{ minRows: 3, maxRows: 6 }} style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }} />
        <Grid columns={2} gap={8} style={{ marginTop: 12 }}><Grid.Item><Button block fill="outline" onClick={() => setRejecting(null)}>取消</Button></Grid.Item><Grid.Item><Button block color="danger" disabled={!reason.trim()} onClick={() => { if (rejecting && reason.trim()) submit(rejecting, rejectedValue, reason.trim()); setRejecting(null); }}>确认驳回</Button></Grid.Item></Grid>
      </Popup>
    </PhoneShell>
  );
}

function PhoneAuditTrail(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const actorRef = phoneField(props, "actorFieldRef");
  const actionRef = phoneField(props, "actionFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const resultRef = phoneField(props, "resultFieldRef");
  const fieldNameRef = phoneField(props, "fieldNameFieldRef");
  const beforeRef = phoneField(props, "beforeFieldRef");
  const afterRef = phoneField(props, "afterFieldRef");
  const pageSize = Math.max(1, Number(props.block.props?.pageSize ?? 5) || 5);
  const [visible, setVisible] = React.useState(pageSize);
  if (!bound || !actorRef || !actionRef || !timeRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-audit-trail"><MobileEmpty description="审计记录尚未绑定操作人、动作和时间字段" /></PhoneShell>;
  }
  const rows = bound.rows.slice(0, visible);
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-audit-trail">
      {rows.length === 0 ? <MobileEmpty description="还没有审计记录" /> : (
        <Collapse accordion={false} onChange={keys => keys[0] && props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: keys[0] })}>
          {rows.map(row => <Collapse.Panel key={row.id} title={<div><div>{String(row.values?.[actorRef] ?? "未知用户")} · {String(row.values?.[actionRef] ?? "执行操作")}</div><div style={{ color: "#999", fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}{resultRef && row.values?.[resultRef] != null ? ` · ${String(row.values[resultRef])}` : ""}</div></div>}>
            {fieldNameRef && row.values?.[fieldNameRef] != null && <div style={{ marginBottom: 8 }}>变更字段：{String(row.values[fieldNameRef])}</div>}
            <div style={{ color: "#999", fontSize: 12 }}>变更前</div><div style={{ padding: 8, background: "#f5f5f5", borderRadius: 4, whiteSpace: "pre-wrap" }}>{beforeRef ? String(row.values?.[beforeRef] ?? "空") : "未记录"}</div>
            <div style={{ marginTop: 8, color: "#999", fontSize: 12 }}>变更后</div><div style={{ padding: 8, background: "#f5f5f5", borderRadius: 4, whiteSpace: "pre-wrap" }}>{afterRef ? String(row.values?.[afterRef] ?? "空") : "未记录"}</div>
          </Collapse.Panel>)}
        </Collapse>
      )}
      {visible < bound.rows.length && <Button block fill="none" onClick={() => setVisible(current => current + pageSize)}>查看更多</Button>}
    </PhoneShell>
  );
}

type PhoneImportPhase = "select" | "mapping" | "validated" | "submitted";

function PhoneDataImportWizard(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const sourceRef = phoneField(props, "sourceFieldRef");
  const targetRef = phoneField(props, "targetFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const issueRef = phoneField(props, "issueFieldRef");
  const initial = ["mapping", "validated", "submitted"].includes(String(props.block.props?.initialPhase)) ? String(props.block.props?.initialPhase) as PhoneImportPhase : "select";
  const [phase, setPhase] = React.useState<PhoneImportPhase>(initial);
  const [fileName, setFileName] = React.useState(String(props.block.props?.initialFileName ?? ""));
  if (!bound || !sourceRef || !targetRef || !statusRef) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-import-wizard"><MobileEmpty description="导入向导尚未绑定映射和校验字段" /></PhoneShell>;
  const invalid = bound.rows.filter(row => ["invalid", "error", "失败"].includes(String(row.values?.[statusRef] ?? "").toLowerCase()));
  const step = phase === "select" ? 0 : phase === "mapping" ? 1 : phase === "validated" ? 2 : 3;
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-import-wizard">
    <Steps current={step} style={{ marginBottom: 12 }}><Steps.Step title="文件" /><Steps.Step title="映射" /><Steps.Step title="校验" /><Steps.Step title="提交" /></Steps>
    {phase === "select" && <div style={{ padding: 16, textAlign: "center", background: "#f5f5f5", borderRadius: 6 }}><div style={{ marginBottom: 10, color: "#666" }}>选择 CSV、XLS 或 XLSX 文件</div><Button color="primary" onClick={() => document.getElementById(`import-${props.block.id}`)?.click()}>选择文件</Button><input id={`import-${props.block.id}`} hidden type="file" accept=".csv,.xls,.xlsx" onChange={event => { const file = event.target.files?.[0]; if (file) { setFileName(file.name); setPhase("mapping"); } }} /></div>}
    {phase !== "select" && phase !== "submitted" && <><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6, marginBottom: 8 }}><div>{fileName || "已选择导入文件"}</div><div style={{ color: invalid.length ? "#ff3141" : "#999", fontSize: 12 }}>共 {bound.rows.length} 个字段，{invalid.length} 个异常</div></div><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? "pending"); const failed = ["invalid", "error", "失败"].includes(status.toLowerCase()); return <List.Item key={row.id} description={<span style={{ color: failed ? "#ff3141" : "#999" }}>{failed && issueRef ? String(row.values?.[issueRef] ?? "映射异常") : status === "valid" || status === "通过" ? "校验通过" : "待校验"}</span>}>{String(row.values?.[sourceRef] ?? "未命名字段")} → {String(row.values?.[targetRef] ?? "未映射")}</List.Item>; })}</List></>}
    {phase === "submitted" && <div style={{ padding: 24, textAlign: "center" }}><div style={{ fontSize: 17, fontWeight: 600 }}>导入任务已提交</div><div style={{ color: "#999", marginTop: 6 }}>处理结果将通过任务状态回传</div></div>}
    <Grid columns={2} gap={8} style={{ marginTop: 12 }}>{phase !== "select" && phase !== "submitted" && <Grid.Item><Button block fill="outline" onClick={() => setPhase(phase === "validated" ? "mapping" : "select")}>上一步</Button></Grid.Item>}{phase === "mapping" && <Grid.Item><Button block color="primary" onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "validateImport", fileName }); setPhase("validated"); }}>校验数据</Button></Grid.Item>}{phase === "validated" && <Grid.Item><Button block color="primary" disabled={invalid.length > 0} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "startImport", fileName }); setPhase("submitted"); }}>开始导入</Button></Grid.Item>}</Grid>
  </PhoneShell>;
}

function PhoneAsyncTaskMonitor(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const currentRef = phoneField(props, "progressCurrentFieldRef");
  const totalRef = phoneField(props, "progressTotalFieldRef");
  const errorRef = phoneField(props, "errorFieldRef");
  const resultRef = phoneField(props, "resultFieldRef");
  if (!bound || !titleRef || !statusRef) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-async-task-monitor"><MobileEmpty description="任务监控尚未绑定标题和状态字段" /></PhoneShell>;
  const pending = String(props.block.props?.pendingValue ?? "pending");
  const running = String(props.block.props?.runningValue ?? "running");
  const succeeded = String(props.block.props?.succeededValue ?? "succeeded");
  const failed = String(props.block.props?.failedValue ?? "failed");
  const canceled = String(props.block.props?.canceledValue ?? "canceled");
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-async-task-monitor">{bound.rows.length === 0 ? <MobileEmpty description="当前没有后台任务" /> : <List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? pending); const current = currentRef ? Number(row.values?.[currentRef] ?? 0) : 0; const total = totalRef ? Number(row.values?.[totalRef] ?? 0) : 0; const percent = total > 0 ? Math.min(100, current / total * 100) : 0; const active = status === pending || status === running; const statusLabel = status === failed ? "失败" : status === succeeded ? "已完成" : status === canceled ? "已取消" : status === running ? "执行中" : "等待中"; return <List.Item key={row.id} description={<div>{active && total > 0 && <><ProgressBar percent={percent} style={{ marginTop: 6 }} /><div style={{ marginTop: 3, color: "#999" }}>{current}/{total}</div></>}{status === failed && errorRef && <div style={{ color: "#ff3141" }}>{String(row.values?.[errorRef] ?? "任务执行失败")}</div>}<Space style={{ marginTop: 8 }}>{active && props.block.props?.cancelable !== false && <Button size="mini" color="danger" fill="outline" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "cancelTask" })}>取消</Button>}{status === failed && <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryTask" })}>重试</Button>}{status === succeeded && resultRef && <Button size="mini" fill="none" onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id, result: row.values?.[resultRef] })}>查看结果</Button>}</Space></div>}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{String(row.values?.[titleRef] ?? "未命名任务")}</span><span style={{ color: status === failed ? "#ff3141" : status === succeeded ? "#00b578" : status === canceled ? "#999" : "#1677ff", fontSize: 12 }}>{statusLabel}</span></div></List.Item>; })}</List>}</PhoneShell>;
}

const PHONE_PERMISSION_KEYS = ["viewFieldRef", "createFieldRef", "editFieldRef", "deleteFieldRef"] as const;
const PHONE_PERMISSION_LABELS = ["查看", "新建", "编辑", "删除"] as const;

function PhonePermissionMatrix(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const resourceRef = phoneField(props, "resourceFieldRef");
  const refs = PHONE_PERMISSION_KEYS.map(key => phoneField(props, key));
  const [changes, setChanges] = React.useState<Record<string, Record<string, string>>>({});
  if (!bound || !resourceRef || !refs[0]) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-permission-matrix"><MobileEmpty description="权限矩阵尚未绑定资源和查看权限字段" /></PhoneShell>;
  const valueOf = (row: (typeof bound.rows)[number], ref: string) => changes[row.id]?.[ref] ?? String(row.values?.[ref] ?? "inherit");
  const setValue = (rowId: string, ref: string, value: string) => setChanges(current => ({ ...current, [rowId]: { ...current[rowId], [ref]: value } }));
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-permission-matrix">{bound.rows.length === 0 ? <MobileEmpty description="还没有可配置的资源" /> : <Collapse accordion defaultActiveKey={bound.rows[0]?.id}>{bound.rows.map(row => <Collapse.Panel key={row.id} title={String(row.values?.[resourceRef] ?? "未命名资源")}><List style={{ margin: 0 }}>{refs.flatMap((ref, index) => !ref ? [] : [<List.Item key={ref} description={<Selector columns={3} value={[valueOf(row, ref)]} options={[{ label: "继承", value: "inherit" }, { label: "允许", value: "allow" }, { label: "拒绝", value: "deny" }]} onChange={values => values[0] && setValue(row.id, ref, String(values[0]))} />}>{PHONE_PERMISSION_LABELS[index]}</List.Item>])}</List></Collapse.Panel>)}</Collapse>}<Button block color="primary" disabled={Object.keys(changes).length === 0} style={{ marginTop: 12 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "savePermissions", changes: bound.rows.map(row => ({ rowId: row.id, permissions: Object.fromEntries(refs.flatMap(ref => ref ? [[ref, valueOf(row, ref)]] : [])) })) })}>保存权限</Button></PhoneShell>;
}

function PhoneDataExportPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  if (!bound) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-export-panel"><MobileEmpty description="导出面板尚未绑定有效实体" /></PhoneShell>;
  const declared = phoneFieldList(props, "fieldRefs");
  const fields = declared.length > 0 ? declared : Array.from(new Set(bound.rows.flatMap(row => Object.keys(row.values ?? {})))).slice(0, 8);
  const selectedRowIds = props.selection?.rowIds?.[bound.entityRef] ?? [];
  const [scope, setScope] = React.useState(selectedRowIds.length > 0 ? "selected" : "all");
  const [selectedFields, setSelectedFields] = React.useState<string[]>(fields);
  const [format, setFormat] = React.useState("xlsx");
  const [submitted, setSubmitted] = React.useState(false);
  const limit = Math.max(1, Number(props.block.props?.maxRows ?? 2000) || 2000);
  const count = scope === "selected" ? selectedRowIds.length : Math.min(bound.rows.length, limit);
  const labelOf = (field: string) => props.fieldLabelOf?.(bound.entityRef, field) ?? field;
  if (fields.length === 0) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-export-panel"><MobileEmpty description="当前实体没有可导出的字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-export-panel">{submitted ? <div style={{ padding: 24, textAlign: "center" }}><div style={{ fontSize: 17, fontWeight: 600 }}>导出任务已提交</div><div style={{ color: "#999", margin: "6px 0 12px" }}>文件生成后由宿主提供下载结果</div><Button size="small" onClick={() => setSubmitted(false)}>继续导出</Button></div> : <Space direction="vertical" block style={{ "--gap": "12px" }}>
    <div style={{ padding: 10, background: "#fff7e6", borderRadius: 6 }}><div>单次最多导出 {limit} 条</div><div style={{ color: "#999", fontSize: 12 }}>当前范围预计导出 {count} 条</div></div>
    <Segmented block value={scope} options={[{ label: `全部 ${bound.rows.length}`, value: "all" }, { label: `已选 ${selectedRowIds.length}`, value: "selected", disabled: selectedRowIds.length === 0 }]} onChange={value => setScope(String(value))} />
    <div><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><strong>导出字段</strong><Button size="mini" fill="none" onClick={() => setSelectedFields(selectedFields.length === fields.length ? [] : fields)}>{selectedFields.length === fields.length ? "清空" : "全选"}</Button></div><Checkbox.Group value={selectedFields} onChange={values => setSelectedFields(values.map(String))}><Grid columns={2} gap={8}>{fields.map(field => <Grid.Item key={field}><Checkbox value={field}>{labelOf(field)}</Checkbox></Grid.Item>)}</Grid></Checkbox.Group></div>
    <Segmented block value={format} options={[{ label: "Excel", value: "xlsx" }, { label: "CSV", value: "csv" }]} onChange={value => setFormat(String(value))} />
    <Button block color="primary" disabled={selectedFields.length === 0 || count === 0} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "startExport", scope, rowIds: scope === "selected" ? selectedRowIds : undefined, fieldRefs: selectedFields, format, maxRows: limit }); setSubmitted(true); }}>开始导出</Button>
  </Space>}</PhoneShell>;
}

type PhoneBulkEditMode = "unchanged" | "set" | "clear";

function PhoneBulkEditPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  if (!bound) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-bulk-edit-panel"><MobileEmpty description="批量编辑尚未绑定有效实体" /></PhoneShell>;
  const declared = phoneFieldList(props, "fieldRefs");
  const fields = declared.length > 0 ? declared : Array.from(new Set(bound.rows.flatMap(row => Object.keys(row.values ?? {})))).slice(0, 6);
  const rowIds = props.selection?.rowIds?.[bound.entityRef] ?? [];
  const [modes, setModes] = React.useState<Record<string, PhoneBulkEditMode>>({});
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const labelOf = (field: string) => props.fieldSchemaOf?.(bound.entityRef, field)?.label ?? props.fieldLabelOf?.(bound.entityRef, field) ?? field;
  if (fields.length === 0) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-bulk-edit-panel"><MobileEmpty description="当前实体没有可批量编辑的字段" /></PhoneShell>;
  const submit = () => { const changed = fields.filter(field => (modes[field] ?? "unchanged") !== "unchanged"); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "bulkEdit", rowIds, values: Object.fromEntries(changed.map(field => [field, modes[field] === "clear" ? null : values[field]])) }); };
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-bulk-edit-panel">{rowIds.length === 0 ? <div style={{ padding: 12, color: "#ff8f1f", background: "#fff7e6", borderRadius: 6 }}>请先在目标列表选择要编辑的记录</div> : <><div style={{ padding: 10, background: "#e7f1ff", borderRadius: 6, marginBottom: 8 }}>将批量处理 {rowIds.length} 条记录</div><List mode="card" style={{ margin: 0 }}>{fields.map(field => { const mode = modes[field] ?? "unchanged"; const schema = props.fieldSchemaOf?.(bound.entityRef, field); const options = schema?.options ?? props.enumOptionsOf?.(bound.entityRef, field) ?? []; return <List.Item key={field} description={<div style={{ marginTop: 8 }}><Selector columns={3} value={[mode]} options={[{ label: "不变", value: "unchanged" }, { label: "改成", value: "set" }, { label: "清空", value: "clear" }]} onChange={next => next[0] && setModes(current => ({ ...current, [field]: String(next[0]) as PhoneBulkEditMode }))} />{mode === "set" && <div style={{ marginTop: 8 }}>{options.length > 0 ? <Selector columns={2} value={values[field] == null ? [] : [String(values[field])]} options={options.map(option => ({ label: option.label, value: option.id }))} onChange={next => setValues(current => ({ ...current, [field]: next[0] }))} /> : <Input type={schema?.type === "number" ? "number" : "text"} value={String(values[field] ?? "")} onChange={(value: string) => setValues(current => ({ ...current, [field]: schema?.type === "number" ? Number(value) : value }))} placeholder={`输入${labelOf(field)}`} style={{ padding: 8, background: "#f5f5f5", borderRadius: 4 }} />}</div>}</div>}>{labelOf(field)}</List.Item>; })}</List><Button block color="primary" disabled={!fields.some(field => (modes[field] ?? "unchanged") !== "unchanged")} style={{ marginTop: 12 }} onClick={submit}>更新 {rowIds.length} 条记录</Button></>}</PhoneShell>;
}

function PhoneMemberAssignment(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const nameRef = phoneField(props, "nameFieldRef");
  const membershipRef = phoneField(props, "membershipFieldRef");
  const accountRef = phoneField(props, "accountFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const memberValue = String(props.block.props?.memberValue ?? "member");
  const [tab, setTab] = React.useState("members");
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [localMembership, setLocalMembership] = React.useState<Record<string, string>>({});
  if (!bound || !nameRef || !membershipRef) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-member-assignment"><MobileEmpty description="成员分配尚未绑定姓名和成员状态字段" /></PhoneShell>;
  const isMember = (row: (typeof bound.rows)[number]) => (localMembership[row.id] ?? String(row.values?.[membershipRef] ?? "")) === memberValue;
  const members = bound.rows.filter(isMember); const candidates = bound.rows.filter(row => !isMember(row));
  const normalized = keyword.trim().toLowerCase(); const source = tab === "members" ? members : candidates;
  const shown = source.filter(row => !normalized || [row.values?.[nameRef], accountRef ? row.values?.[accountRef] : ""].some(value => String(value ?? "").toLowerCase().includes(normalized)));
  const add = () => { setLocalMembership(current => ({ ...current, ...Object.fromEntries(selected.map(id => [id, memberValue])) })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "addMembers", rowIds: selected }); setSelected([]); setTab("members"); };
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-member-assignment"><Segmented block value={tab} options={[{ label: `当前 ${members.length}`, value: "members" }, { label: `可添加 ${candidates.length}`, value: "candidates" }]} onChange={value => { setTab(String(value)); setSelected([]); }} /><SearchBar value={keyword} onChange={setKeyword} placeholder="搜索姓名或账号" style={{ margin: "8px 0" }} />{shown.length === 0 ? <MobileEmpty description={normalized ? "没有匹配的成员" : tab === "members" ? "当前还没有成员" : "没有可添加的候选人"} /> : <List mode="card" style={{ margin: 0 }}>{shown.map(row => <List.Item key={row.id} prefix={tab === "candidates" ? <Checkbox checked={selected.includes(row.id)} onChange={checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))} /> : undefined} description={[accountRef ? row.values?.[accountRef] : "", statusRef ? row.values?.[statusRef] : ""].filter(Boolean).map(String).join(" · ")} extra={tab === "members" ? <Button size="mini" color="danger" fill="none" onClick={() => { setLocalMembership(current => ({ ...current, [row.id]: "candidate" })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "removeMembers", rowIds: [row.id] }); }}>移除</Button> : undefined}>{String(row.values?.[nameRef] ?? "未命名成员")}</List.Item>)}</List>}{tab === "candidates" && <Button block color="primary" disabled={selected.length === 0} style={{ marginTop: 12 }} onClick={add}>添加所选 {selected.length || ""}</Button>}</PhoneShell>;
}

function PhoneAnalysisChart({ props, testid, option, hint }: { props: ExperienceBlockRendererProps; testid: string; option?: Record<string, unknown>; hint: string }) {
  return <PhoneShell block={props.block} title={titleOf(props)} testid={testid}>{option ? <React.Suspense fallback={<div style={{ height: 180 }} />}><PhoneLazyEchartsChart option={option} height={180} ariaLabel={titleOf(props) || testid} /></React.Suspense> : <MobileEmpty description={hint} />}</PhoneShell>;
}

function phoneGrouped(props: ExperienceBlockRendererProps, dimensionKey: string, valueKey?: string) {
  const bound = phoneRows(props); const dimension = phoneField(props, dimensionKey); const valueRef = valueKey ? phoneField(props, valueKey) : undefined; if (!bound || !dimension) return [];
  const values = new Map<string, number>(); bound.rows.forEach(row => { const key = String(row.values?.[dimension] ?? "").trim(); if (key) values.set(key, (values.get(key) ?? 0) + (valueRef ? Number(row.values?.[valueRef] ?? 0) : 1)); }); return [...values.entries()].map(([name, value]) => ({ name, value }));
}

function PhoneWaterfallChart(props: ExperienceBlockRendererProps) {
  const data = phoneGrouped(props, "categoryFieldRef", "valueFieldRef"); let running = 0; const base: number[] = []; const values: number[] = []; data.forEach(item => { const next = running + item.value; base.push(Math.min(running, next)); values.push(Math.abs(item.value)); running = next; });
  const option = data.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 4, right: 4, top: 12, bottom: 8, containLabel: true }, xAxis: { type: "category", data: data.map(item => item.name), axisLabel: { fontSize: 9 } }, yAxis: { type: "value" }, series: [{ type: "bar", stack: "total", silent: true, itemStyle: { color: "transparent" }, data: base }, { type: "bar", stack: "total", data: values, itemStyle: { color: (p: { dataIndex: number }) => data[p.dataIndex].value >= 0 ? "#1677ff" : "#cf1322" } }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-waterfall-chart" option={option} hint="当前没有可计算的增减值" />;
}

function PhoneFunnelChart(props: ExperienceBlockRendererProps) {
  const raw = phoneGrouped(props, "stageFieldRef", "valueFieldRef"); const declared = Array.isArray(props.block.props?.stages) ? props.block.props.stages.map(String) : []; const data = declared.length ? declared.flatMap(name => { const item = raw.find(row => row.name === name); return item ? [item] : []; }) : raw.sort((a, b) => b.value - a.value);
  const option = data.length ? { animation: false, tooltip: { trigger: "item", confine: true }, series: [{ type: "funnel", left: "4%", right: "4%", top: 6, bottom: 6, minSize: "20%", sort: "none", gap: 2, label: { show: true, position: "inside", color: "#fff", fontSize: 10, formatter: "{b} {c}" }, data }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-funnel-chart" option={option} hint="当前没有可用的漏斗阶段" />;
}

function PhoneDistributionHistogram(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const ref = phoneField(props, "valueFieldRef"); const values = bound && ref ? bound.rows.map(row => Number(row.values?.[ref])).filter(Number.isFinite) : []; const bins = Math.max(3, Math.min(8, Number(props.block.props?.bins ?? 5))); const min = values.length ? Math.min(...values) : 0; const max = values.length ? Math.max(...values) : 0; const width = max === min ? 1 : (max - min) / bins; const counts = Array.from({ length: bins }, () => 0); values.forEach(value => counts[Math.min(bins - 1, Math.floor((value - min) / width))] += 1); const labels = counts.map((_, i) => `${(min + i * width).toFixed(0)}-${(min + (i + 1) * width).toFixed(0)}`);
  const option = values.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 4, right: 4, top: 12, bottom: 8, containLabel: true }, xAxis: { type: "category", data: labels, axisLabel: { fontSize: 8, rotate: 30 } }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data: counts, itemStyle: { color: "#1677ff" } }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-distribution-histogram" option={option} hint="当前没有可计算的数值" />;
}

function PhoneHeatmapMatrix(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const xRef = phoneField(props, "xFieldRef"); const yRef = phoneField(props, "yFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); if (!bound || !xRef || !yRef) return <PhoneAnalysisChart props={props} testid="phone-heatmap-matrix" hint="热力矩阵尚未绑定横纵维度" />; const xs = Array.from(new Set(bound.rows.map(row => String(row.values?.[xRef] ?? "")).filter(Boolean))).slice(0, 8); const ys = Array.from(new Set(bound.rows.map(row => String(row.values?.[yRef] ?? "")).filter(Boolean))).slice(0, 8); const map = new Map<string, number>(); bound.rows.forEach(row => { const x = String(row.values?.[xRef] ?? ""); const y = String(row.values?.[yRef] ?? ""); if (x && y) map.set(`${x}\u0000${y}`, (map.get(`${x}\u0000${y}`) ?? 0) + (valueRef ? Number(row.values?.[valueRef] ?? 0) : 1)); }); const data = ys.flatMap((y, yi) => xs.map((x, xi) => [xi, yi, map.get(`${x}\u0000${y}`) ?? 0])); const max = Math.max(1, ...data.map(item => Number(item[2]))); const option = data.length ? { animation: false, tooltip: { position: "top", confine: true }, grid: { left: 4, right: 4, top: 4, bottom: 8, containLabel: true }, xAxis: { type: "category", data: xs, axisLabel: { fontSize: 8 } }, yAxis: { type: "category", data: ys, axisLabel: { fontSize: 8 } }, visualMap: { min: 0, max, show: false, inRange: { color: ["#f0f5ff", "#1677ff"] } }, series: [{ type: "heatmap", data }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-heatmap-matrix" option={option} hint="当前没有可组成矩阵的数据" />;
}

function PhoneTreemapBreakdown(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const labelRef = phoneField(props, "labelFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); const parentRef = phoneField(props, "parentFieldRef"); if (!bound || !labelRef || !valueRef) return <PhoneAnalysisChart props={props} testid="phone-treemap-breakdown" hint="矩形树图尚未绑定名称和数值字段" />; const nodes = new Map(bound.rows.map(row => [row.id, { name: String(row.values?.[labelRef] ?? row.id), value: Number(row.values?.[valueRef] ?? 0), children: [] as Array<Record<string, unknown>> }])); const roots: Array<Record<string, unknown>> = []; bound.rows.forEach(row => { const node = nodes.get(row.id)!; const owner = parentRef ? nodes.get(String(row.values?.[parentRef] ?? "")) : undefined; if (owner) owner.children.push(node); else roots.push(node); }); roots.forEach(node => { if ((node.children as unknown[]).length === 0) delete node.children; }); const option = roots.length ? { animation: false, tooltip: { confine: true }, series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, fontSize: 10, formatter: "{b}\n{c}" }, data: roots }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-treemap-breakdown" option={option} hint="当前没有层级构成数据" />;
}

function PhoneGaugeProgress(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const currentRef = phoneField(props, "currentFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const row = bound?.rows[0]; const current = row && currentRef ? Number(row.values?.[currentRef] ?? 0) : 0; const target = row && targetRef ? Number(row.values?.[targetRef] ?? 0) : 0; const percent = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0; const option = target > 0 ? { animation: false, series: [{ type: "gauge", startAngle: 210, endAngle: -30, min: 0, max: 100, progress: { show: true, width: 10 }, axisLine: { lineStyle: { width: 10 } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, detail: { formatter: `${percent.toFixed(0)}%\n${current}/${target}`, fontSize: 16 }, data: [{ value: percent }] }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-gauge-progress" option={option} hint="目标值必须大于零" />;
}

function PhoneAlertTriagePanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const stateRef = phoneField(props, "stateFieldRef"); const severityRef = phoneField(props, "severityFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const [scope, setScope] = React.useState("active"); if (!bound || !titleRef || !stateRef) return <PhoneShell block={props.block} title={titleOf(props) || "告警分诊"} testid="phone-alert-triage-panel"><MobileEmpty description="告警分诊尚未绑定标题和状态字段" /></PhoneShell>; const firing = String(props.block.props?.firingValue ?? "firing"); const pending = String(props.block.props?.pendingValue ?? "pending"); const active = bound.rows.filter(row => [firing, pending].includes(String(row.values?.[stateRef] ?? ""))); const shown = scope === "all" ? bound.rows : active;
  return <PhoneShell block={props.block} title={titleOf(props) || "告警分诊"} testid="phone-alert-triage-panel"><Segmented block value={scope} options={[{ label: `活动 ${active.length}`, value: "active" }, { label: `全部 ${bound.rows.length}`, value: "all" }]} onChange={value => setScope(String(value))} /><List mode="card" style={{ margin: "8px 0 0" }}>{shown.map(row => <List.Item key={row.id} description={[severityRef ? row.values?.[severityRef] : "", timeRef ? row.values?.[timeRef] : ""].filter(Boolean).join(" · ")} extra={<Button size="mini" onClick={() => props.onAction?.("actionTrigger", { operation: "openSilence", rowId: row.id, targets: phoneTargets(props) })}>静默</Button>} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>{String(row.values?.[titleRef] ?? "未命名告警")}</List.Item>)}</List></PhoneShell>;
}

function PhoneAlertSilenceForm(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const labelRef = phoneField(props, "labelFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const [duration, setDuration] = React.useState("2h"); const [comment, setComment] = React.useState(""); if (!bound || !row) return <PhoneShell block={props.block} title={titleOf(props) || "创建静默"} testid="phone-alert-silence-form"><MobileEmpty description="静默表单尚未找到目标告警" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "创建静默"} testid="phone-alert-silence-form"><div style={{ padding: 10, background: "#e7f1ff", borderRadius: 6, marginBottom: 8 }}><strong>{titleRef ? String(row.values?.[titleRef] ?? "当前告警") : "当前告警"}</strong>{labelRef && <div style={{ fontSize: 12, color: "#666" }}>{String(row.values?.[labelRef] ?? "")}</div>}</div><Selector columns={3} value={[duration]} options={[{ label: "30 分", value: "30m" }, { label: "2 小时", value: "2h" }, { label: "1 天", value: "1d" }]} onChange={values => values[0] && setDuration(String(values[0]))} /><TextArea value={comment} onChange={setComment} rows={3} placeholder="填写静默原因" style={{ margin: "10px 0", padding: 8, background: "#f5f5f5" }} /><Button block color="primary" disabled={!comment.trim()} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "createSilence", duration, comment, targets: phoneTargets(props) })}>创建静默</Button></PhoneShell>;
}

function PhoneAlertRoutingPolicy(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const parentRef = phoneField(props, "parentFieldRef"); const matcherRef = phoneField(props, "matcherFieldRef"); const receiverRef = phoneField(props, "receiverFieldRef"); if (!bound || !nameRef || !parentRef || !receiverRef) return <PhoneShell block={props.block} title={titleOf(props) || "告警路由策略"} testid="phone-alert-routing-policy"><MobileEmpty description="路由策略尚未绑定必要字段" /></PhoneShell>; const childrenOf = (parent: string) => bound.rows.filter(row => String(row.values?.[parentRef] ?? "") === parent); const render = (row: (typeof bound.rows)[number], depth = 0): React.ReactNode => <div key={row.id} style={{ marginLeft: depth * 12, padding: "9px 0", borderBottom: "1px solid #eee" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div><strong>{String(row.values?.[nameRef] ?? "未命名策略")}</strong><div style={{ color: "#999", fontSize: 12 }}>{matcherRef ? String(row.values?.[matcherRef] ?? "全部告警") : "全部告警"} → {String(row.values?.[receiverRef] ?? "未配置")}</div></div><Button size="mini" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editPolicy" })}>编辑</Button></div>{childrenOf(row.id).map(child => render(child, depth + 1))}</div>;
  return <PhoneShell block={props.block} title={titleOf(props) || "告警路由策略"} testid="phone-alert-routing-policy">{childrenOf("").map(row => render(row))}</PhoneShell>;
}

function PhoneDeletedRecordsRecovery(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const deletedAtRef = phoneField(props, "deletedAtFieldRef"); const deletedByRef = phoneField(props, "deletedByFieldRef"); const [confirmId, setConfirmId] = React.useState(""); if (!bound || !titleRef || !deletedAtRef) return <PhoneShell block={props.block} title={titleOf(props) || "已删除记录"} testid="phone-deleted-records-recovery"><MobileEmpty description="回收站尚未绑定标题和删除时间" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || `已删除记录 ${bound.rows.length}`} testid="phone-deleted-records-recovery"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[deletedAtRef] ?? "")} ${deletedByRef ? `· ${String(row.values?.[deletedByRef] ?? "")}` : ""}`} extra={<Space><Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "restore", targets: phoneTargets(props) })}>恢复</Button><Button size="mini" color="danger" onClick={() => setConfirmId(row.id)}>删除</Button></Space>}>{String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>)}</List><Popup visible={Boolean(confirmId)} onMaskClick={() => setConfirmId("")} bodyStyle={{ padding: 16 }}><strong>永久删除后无法恢复</strong><Button block color="danger" style={{ marginTop: 12 }} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: confirmId, operation: "hardDelete", targets: phoneTargets(props) }); setConfirmId(""); }}>确认永久删除</Button></Popup></PhoneShell>;
}

function PhoneRevisionHistoryPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const versionRef = phoneField(props, "versionFieldRef"); const authorRef = phoneField(props, "authorFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const summaryRef = phoneField(props, "summaryFieldRef"); const currentRef = phoneField(props, "currentFieldRef"); if (!bound || !versionRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "修订历史"} testid="phone-revision-history-panel"><MobileEmpty description="修订历史尚未绑定版本和时间" /></PhoneShell>; const rows = [...bound.rows].sort((a, b) => Number(b.values?.[versionRef] ?? 0) - Number(a.values?.[versionRef] ?? 0));
  return <PhoneShell block={props.block} title={titleOf(props) || "修订历史"} testid="phone-revision-history-panel"><List mode="card" style={{ margin: 0 }}>{rows.map(row => { const current = currentRef && [true, "true", "current"].includes(row.values?.[currentRef] as never); return <List.Item key={row.id} description={`${authorRef ? `${String(row.values?.[authorRef] ?? "")} · ` : ""}${String(row.values?.[timeRef] ?? "")}${summaryRef ? ` · ${String(row.values?.[summaryRef] ?? "")}` : ""}`} extra={current ? "当前" : <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "restoreRevision", targets: phoneTargets(props) })}>恢复</Button>}>版本 {String(row.values?.[versionRef] ?? "-")}</List.Item>; })}</List></PhoneShell>;
}

function PhoneRecordComparePanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fields = phoneFieldList(props, "fieldRefs"); const ids = bound ? props.selection?.rowIds?.[bound.entityRef] ?? [] : []; const rows = bound?.rows.filter(row => ids.includes(row.id)).slice(0, 2) ?? []; if (!bound || !fields.length) return <PhoneShell block={props.block} title={titleOf(props) || "记录对比"} testid="phone-record-compare-panel"><MobileEmpty description="记录对比尚未绑定字段" /></PhoneShell>; if (rows.length !== 2) return <PhoneShell block={props.block} title={titleOf(props) || "记录对比"} testid="phone-record-compare-panel"><div style={{ padding: 10, background: "#fff7e6", borderRadius: 6 }}>请选择恰好两条记录进行对比</div></PhoneShell>; const changed = fields.filter(field => String(rows[0].values?.[field] ?? "") !== String(rows[1].values?.[field] ?? ""));
  return <PhoneShell block={props.block} title={titleOf(props) || `记录对比 · ${changed.length} 项差异`} testid="phone-record-compare-panel"><List mode="card" style={{ margin: 0 }}>{fields.map(field => <List.Item key={field} description={<Grid columns={2} gap={8}><Grid.Item>{String(rows[0].values?.[field] ?? "-")}</Grid.Item><Grid.Item><span style={{ background: changed.includes(field) ? "#fff1b8" : undefined }}>{String(rows[1].values?.[field] ?? "-")}</span></Grid.Item></Grid>}>{props.fieldLabelOf?.(bound.entityRef, field) ?? field}</List.Item>)}</List><Grid columns={2} gap={8} style={{ marginTop: 8 }}><Grid.Item><Button block onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: rows[0].id, operation: "useAsCanonical", targets: phoneTargets(props) })}>采用左侧</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: rows[1].id, operation: "useAsCanonical", targets: phoneTargets(props) })}>采用右侧</Button></Grid.Item></Grid></PhoneShell>;
}

function PhoneGanttSchedule(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const labelRef = phoneField(props, "labelFieldRef"); const startRef = phoneField(props, "startFieldRef"); const endRef = phoneField(props, "endFieldRef"); const groupRef = phoneField(props, "groupFieldRef"); if (!bound || !labelRef || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "计划排期"} testid="phone-gantt-schedule"><MobileEmpty description="甘特排期尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "计划排期"} testid="phone-gantt-schedule"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[startRef] ?? "")} 至 ${String(row.values?.[endRef] ?? "")}${groupRef ? ` · ${String(row.values?.[groupRef] ?? "")}` : ""}`}>{String(row.values?.[labelRef] ?? "未命名任务")}</List.Item>)}</List></PhoneShell>;
}

function PhoneSankeyFlow(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const sourceRef = phoneField(props, "sourceFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); if (!bound || !sourceRef || !targetRef) return <PhoneAnalysisChart props={props} testid="phone-sankey-flow" hint="桑基图尚未绑定来源和目标" />; const links = bound.rows.flatMap(row => { const source = String(row.values?.[sourceRef] ?? "").trim(); const target = String(row.values?.[targetRef] ?? "").trim(); return source && target && source !== target ? [{ source, target, value: valueRef ? Number(row.values?.[valueRef] ?? 0) : 1 }] : []; }); const nodes = Array.from(new Set(links.flatMap(link => [link.source, link.target]))).map(name => ({ name })); const option = links.length ? { animation: false, tooltip: { trigger: "item", confine: true }, series: [{ type: "sankey", left: 4, right: 4, top: 4, bottom: 4, nodeWidth: 12, nodeGap: 8, lineStyle: { color: "gradient", curveness: 0.5 }, label: { fontSize: 9 }, data: nodes, links }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-sankey-flow" option={option} hint="当前没有有效关系流" />;
}

function phoneQuartiles(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const at = (p: number) => { const i = (sorted.length - 1) * p; const low = Math.floor(i); const high = Math.ceil(i); return sorted[low] + (sorted[high] - sorted[low]) * (i - low); }; return sorted.length ? [sorted[0], at(.25), at(.5), at(.75), sorted[sorted.length - 1]] : [0, 0, 0, 0, 0]; }

function PhoneBoxPlotDistribution(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const categoryRef = phoneField(props, "categoryFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); if (!bound || !categoryRef || !valueRef) return <PhoneAnalysisChart props={props} testid="phone-boxplot-distribution" hint="箱线图尚未绑定分类和数值" />; const groups = new Map<string, number[]>(); bound.rows.forEach(row => { const key = String(row.values?.[categoryRef] ?? ""); const value = Number(row.values?.[valueRef]); if (key && Number.isFinite(value)) groups.set(key, [...(groups.get(key) ?? []), value]); }); const entries = [...groups.entries()]; const option = entries.length ? { animation: false, tooltip: { trigger: "item", confine: true }, grid: { left: 4, right: 4, top: 8, bottom: 8, containLabel: true }, xAxis: { type: "category", data: entries.map(([name]) => name), axisLabel: { fontSize: 8 } }, yAxis: { type: "value" }, series: [{ type: "boxplot", data: entries.map(([, values]) => phoneQuartiles(values)), itemStyle: { color: "#91caff", borderColor: "#1677ff" } }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-boxplot-distribution" option={option} hint="当前没有可计算的分类数值" />;
}

function PhoneRadarComparison(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const fields = phoneFieldList(props, "metricFieldRefs").slice(0, 6); if (!bound || !nameRef || fields.length < 3) return <PhoneAnalysisChart props={props} testid="phone-radar-comparison" hint="雷达对比至少需要三个数值维度" />; const maxima = fields.map(field => Math.max(1, ...bound.rows.map(row => Number(row.values?.[field] ?? 0)))); const option = bound.rows.length ? { animation: false, tooltip: { trigger: "item", confine: true }, radar: { radius: "55%", indicator: fields.map((field, i) => ({ name: props.fieldLabelOf?.(bound.entityRef, field) ?? field, max: maxima[i] * 1.15 })), axisName: { fontSize: 8 } }, series: [{ type: "radar", data: bound.rows.slice(0, 3).map(row => ({ name: String(row.values?.[nameRef] ?? row.id), value: fields.map(field => Number(row.values?.[field] ?? 0)), areaStyle: { opacity: .08 } })) }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-radar-comparison" option={option} hint="当前没有可对比记录" />;
}

function PhoneAlertRuleEditor(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const nameRef = phoneField(props, "nameFieldRef"); const queryRef = phoneField(props, "queryFieldRef"); const thresholdRef = phoneField(props, "thresholdFieldRef"); const [name, setName] = React.useState(row && nameRef ? String(row.values?.[nameRef] ?? "") : ""); const [query, setQuery] = React.useState(row && queryRef ? String(row.values?.[queryRef] ?? "") : ""); const [threshold, setThreshold] = React.useState(row && thresholdRef ? String(row.values?.[thresholdRef] ?? "") : ""); const [evaluation, setEvaluation] = React.useState("1m"); if (!bound || !nameRef || !queryRef || !thresholdRef) return <PhoneShell block={props.block} title={titleOf(props) || "告警规则"} testid="phone-alert-rule-editor"><MobileEmpty description="告警规则尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "告警规则"} testid="phone-alert-rule-editor"><Space direction="vertical" block style={{ "--gap": "8px" }}><Input value={name} onChange={setName} placeholder="规则名称" style={{ padding: 9, background: "#f5f5f5" }} /><TextArea value={query} onChange={setQuery} rows={3} placeholder="查询表达式" style={{ padding: 9, background: "#f5f5f5" }} /><Input value={threshold} onChange={setThreshold} type="number" placeholder="阈值" style={{ padding: 9, background: "#f5f5f5" }} /><Selector columns={3} value={[evaluation]} options={[{ label: "1 分", value: "1m" }, { label: "5 分", value: "5m" }, { label: "15 分", value: "15m" }]} onChange={values => values[0] && setEvaluation(String(values[0]))} /><Button block color="primary" disabled={!name.trim() || !query.trim() || !threshold} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: row ? "updateAlertRule" : "createAlertRule", values: { name, query, threshold: Number(threshold), evaluation }, targets: phoneTargets(props) })}>保存并启用规则</Button></Space></PhoneShell>;
}

function PhoneMuteTimingSchedule(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const weekdaysRef = phoneField(props, "weekdaysFieldRef"); const startRef = phoneField(props, "startTimeFieldRef"); const endRef = phoneField(props, "endTimeFieldRef"); const timezoneRef = phoneField(props, "timezoneFieldRef"); if (!bound || !nameRef || !weekdaysRef || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "静默时段"} testid="phone-mute-timing-schedule"><MobileEmpty description="静默时段尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "静默时段"} testid="phone-mute-timing-schedule"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[weekdaysRef] ?? "")} · ${String(row.values?.[startRef] ?? "")}–${String(row.values?.[endRef] ?? "")}${timezoneRef ? ` · ${String(row.values?.[timezoneRef] ?? "")}` : ""}`} extra={<Button size="mini" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editMuteTiming" })}>编辑</Button>}>{String(row.values?.[nameRef] ?? "未命名时段")}</List.Item>)}</List><Button block color="primary" style={{ marginTop: 8 }} onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef, operation: "createMuteTiming" })}>新增时段</Button></PhoneShell>;
}

function PhoneContactPointManager(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const typeRef = phoneField(props, "typeFieldRef"); const addressRef = phoneField(props, "addressFieldRef"); const [testing, setTesting] = React.useState(""); if (!bound || !nameRef || !typeRef || !addressRef) return <PhoneShell block={props.block} title={titleOf(props) || "通知联络点"} testid="phone-contact-point-manager"><MobileEmpty description="联络点尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "通知联络点"} testid="phone-contact-point-manager"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[typeRef] ?? "")} · ${String(row.values?.[addressRef] ?? "")}`} extra={<Button size="mini" loading={testing === row.id} onClick={() => { setTesting(row.id); props.onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation: "testContactPoint", targets: phoneTargets(props) }); setTimeout(() => setTesting(""), 400); }}>测试</Button>}>{String(row.values?.[nameRef] ?? "未命名联络点")}</List.Item>)}</List><Button block color="primary" style={{ marginTop: 8 }} onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef, operation: "createContactPoint" })}>新增联络点</Button></PhoneShell>;
}

function PhoneReferenceManyManager(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const relationRef = phoneField(props, "relationFieldRef"); const linkedValue = String(props.block.props?.linkedValue ?? "linked"); const [tab, setTab] = React.useState("linked"); const [selected, setSelected] = React.useState<string[]>([]); const [local, setLocal] = React.useState<Record<string, string>>({}); if (!bound || !titleRef || !relationRef) return <PhoneShell block={props.block} title={titleOf(props) || "关联记录"} testid="phone-reference-many-manager"><MobileEmpty description="关联记录尚未绑定必要字段" /></PhoneShell>; const isLinked = (row: (typeof bound.rows)[number]) => (local[row.id] ?? String(row.values?.[relationRef] ?? "")) === linkedValue; const linked = bound.rows.filter(isLinked); const available = bound.rows.filter(row => !isLinked(row)); const shown = tab === "linked" ? linked : available;
  return <PhoneShell block={props.block} title={titleOf(props) || "关联记录"} testid="phone-reference-many-manager"><Segmented block value={tab} options={[{ label: `已关联 ${linked.length}`, value: "linked" }, { label: `可关联 ${available.length}`, value: "available" }]} onChange={value => { setTab(String(value)); setSelected([]); }} /><List mode="card" style={{ margin: "8px 0 0" }}>{shown.map(row => <List.Item key={row.id} prefix={tab === "available" ? <Checkbox checked={selected.includes(row.id)} onChange={checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))} /> : undefined} extra={tab === "linked" ? <Button size="mini" color="danger" fill="none" onClick={() => { setLocal(current => ({ ...current, [row.id]: "available" })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "unlinkRecords", rowIds: [row.id], targets: phoneTargets(props) }); }}>解除</Button> : undefined}>{String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>)}</List>{tab === "available" && <Button block color="primary" disabled={!selected.length} style={{ marginTop: 8 }} onClick={() => { setLocal(current => ({ ...current, ...Object.fromEntries(selected.map(id => [id, linkedValue])) })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "linkRecords", rowIds: selected, targets: phoneTargets(props) }); setSelected([]); }}>关联所选 {selected.length || ""}</Button>}</PhoneShell>;
}

function PhoneGlobalSearchPalette(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const categoryRef = phoneField(props, "categoryFieldRef"); const descRef = phoneField(props, "descFieldRef"); const [keyword, setKeyword] = React.useState(""); if (!bound || !titleRef) return <PhoneShell block={props.block} title={titleOf(props) || "全局搜索"} testid="phone-global-search-palette"><MobileEmpty description="全局搜索尚未绑定标题字段" /></PhoneShell>; const normalized = keyword.trim().toLowerCase(); const rows = bound.rows.filter(row => normalized && [row.values?.[titleRef], descRef ? row.values?.[descRef] : ""].some(value => String(value ?? "").toLowerCase().includes(normalized))).slice(0, 10);
  return <PhoneShell block={props.block} title={titleOf(props) || "全局搜索"} testid="phone-global-search-palette"><SearchBar value={keyword} onChange={setKeyword} placeholder="搜索页面、记录或操作" />{normalized ? <List mode="card" style={{ margin: "8px 0 0" }}>{rows.map(row => <List.Item key={row.id} description={[categoryRef ? row.values?.[categoryRef] : "", descRef ? row.values?.[descRef] : ""].filter(Boolean).map(String).join(" · ")} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>{String(row.values?.[titleRef] ?? "未命名结果")}</List.Item>)}</List> : <div style={{ color: "#999", fontSize: 12, padding: "10px 0" }}>输入关键词后显示匹配结果</div>}</PhoneShell>;
}

function PhoneLiveChangeReview(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const actionRef = phoneField(props, "actionFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const actorRef = phoneField(props, "actorFieldRef"); const [ignored, setIgnored] = React.useState<string[]>([]); const rows = bound?.rows.filter(row => !ignored.includes(row.id)) ?? []; if (!bound || !titleRef || !actionRef) return <PhoneShell block={props.block} title={titleOf(props) || "实时变更"} testid="phone-live-change-review"><MobileEmpty description="实时变更尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || `实时变更 ${rows.length}`} testid="phone-live-change-review"><div style={{ padding: 9, background: "#e7f1ff", borderRadius: 6, marginBottom: 8 }}>其他用户的变更不会直接覆盖当前视图</div>{rows.length ? <List mode="card" style={{ margin: 0 }}>{rows.map(row => <List.Item key={row.id} description={[actorRef ? row.values?.[actorRef] : "", timeRef ? row.values?.[timeRef] : ""].filter(Boolean).map(String).join(" · ")} extra={<Button size="mini" onClick={() => props.onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation: "refreshAfterLiveChange", targets: phoneTargets(props) })}>刷新</Button>}>{String(row.values?.[actionRef] ?? "更新")} · {String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>)}</List> : <MobileEmpty description="没有待处理的实时变更" />}</PhoneShell>;
}

const phoneTargets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String).filter(Boolean) : [];

function PhoneContextBreadcrumb(props: ExperienceBlockRendererProps) {
  const items = Array.isArray(props.block.props?.items) ? props.block.props.items.map(String).filter(Boolean) : [];
  if (items.length < 2) return null;
  const parent = items[items.length - 2];
  return <PhoneShell block={props.block} testid="phone-context-breadcrumb"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Button size="mini" fill="none" onClick={() => props.onAction?.("actionTrigger", { operation: "navigateBreadcrumb", index: items.length - 2, title: parent })}>‹ {parent}</Button><span style={{ color: "#999" }}>/</span><strong>{items[items.length - 1]}</strong></div></PhoneShell>;
}

function PhoneLiveRefreshControl(props: ExperienceBlockRendererProps) {
  const [polling, setPolling] = React.useState(false); const [lastAt, setLastAt] = React.useState(""); const targets = phoneTargets(props);
  return <PhoneShell block={props.block} title={titleOf(props) || "数据刷新"} testid="phone-live-refresh-control"><div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>{lastAt ? `最近刷新 ${lastAt}` : "尚未刷新"} · {polling ? "自动刷新中" : "已暂停"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!targets.length} onClick={() => { setLastAt(new Date().toLocaleTimeString("zh-CN", { hour12: false })); props.onAction?.("actionTrigger", { operation: "refresh", targets }); }}>刷新</Button></Grid.Item><Grid.Item><Button block color={polling ? "default" : "primary"} disabled={!targets.length} onClick={() => { const next = !polling; setPolling(next); props.onAction?.("actionTrigger", { operation: next ? "startPolling" : "stopPolling", targets }); }}>{polling ? "暂停轮询" : "开启轮询"}</Button></Grid.Item></Grid></PhoneShell>;
}

function PhoneActiveFilterSummary(props: ExperienceBlockRendererProps) {
  const entries = Object.entries(props.filterState?.enumFilters ?? {}).filter(([, value]) => value);
  if (!entries.length && !props.filterState?.dateRange) return null;
  return <PhoneShell block={props.block} title={titleOf(props) || "已应用条件"} testid="phone-active-filter-summary"><Space wrap>{entries.map(([key, value]) => <Button key={key} size="mini" onClick={() => { const next = { ...(props.filterState?.enumFilters ?? {}) }; delete next[key]; props.onFilterChange?.({ enumFilters: next }); props.onAction?.("filterChange", { operation: "remove", key, targets: phoneTargets(props) }); }}>{key}：{String(value)} ×</Button>)}{props.filterState?.dateRange && <Button size="mini" onClick={() => props.onFilterChange?.({ dateRange: null })}>{props.filterState.dateRange.join(" 至 ")} ×</Button>}</Space><Button block fill="none" size="small" style={{ marginTop: 6 }} onClick={() => { props.onFilterChange?.({ enumFilters: {}, enumMulti: {}, dateRange: null }); props.onAction?.("filterChange", { operation: "clearAll", targets: phoneTargets(props) }); }}>全部清除</Button></PhoneShell>;
}

function PhoneAnalyticsDateScope(props: ExperienceBlockRendererProps) {
  const [preset, setPreset] = React.useState(String(props.block.props?.defaultPreset ?? "month"));
  return <PhoneShell block={props.block} title={titleOf(props) || "时间口径"} testid="phone-analytics-date-scope"><Selector columns={4} value={[preset]} options={[{ label: "今日", value: "today" }, { label: "本周", value: "week" }, { label: "本月", value: "month" }, { label: "本年", value: "year" }]} onChange={values => { const value = String(values[0] ?? "month"); setPreset(value); props.onAction?.("filterChange", { operation: "dateScope", preset: value, targets: phoneTargets(props) }); }} /></PhoneShell>;
}

function PhoneHeaderEntitySummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const fields = phoneFieldList(props, "fieldRefs"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !row || !fields.length) return <PhoneShell block={props.block} testid="phone-header-entity-summary"><MobileEmpty description="页头实体摘要尚未绑定当前记录和关键字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={String(row.values?.[titleRef] ?? "当前记录")} testid="phone-header-entity-summary"><List mode="card" style={{ margin: 0 }}>{fields.slice(0, 4).map(field => <List.Item key={field} extra={String(row.values?.[field] ?? "-")}>{props.fieldLabelOf?.(bound.entityRef, field) ?? field}</List.Item>)}</List></PhoneShell>;
}

function PhoneHeaderProgressSummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const currentRef = phoneField(props, "currentFieldRef"); const totalRef = phoneField(props, "totalFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const nextRef = phoneField(props, "nextFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !currentRef || !totalRef || !row) return <PhoneShell block={props.block} testid="phone-header-progress-summary"><MobileEmpty description="页头进度摘要尚未绑定当前值和总量字段" /></PhoneShell>;
  const current = Number(row.values?.[currentRef] ?? 0); const total = Number(row.values?.[totalRef] ?? 0); const percent = total > 0 ? Math.min(100, Math.max(0, Math.round(current / total * 100))) : 0;
  return <PhoneShell block={props.block} title={titleRef ? String(row.values?.[titleRef] ?? "当前进度") : titleOf(props) || "当前进度"} testid="phone-header-progress-summary"><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><strong>{current} / {total}</strong><span style={{ color: "#1677ff" }}>{statusRef ? String(row.values?.[statusRef] ?? "") : `${percent}%`}</span></div><ProgressBar percent={percent} />{nextRef && <div style={{ color: "#999", fontSize: 12, marginTop: 8 }}>下一步：{String(row.values?.[nextRef] ?? "待确认")}</div>}</PhoneShell>;
}

function PhoneWorkspaceTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !titleRef || !bound.rows.length) return null; const selected = bound.rows.some(row => row.id === active) ? active : bound.rows[0].id;
  return <PhoneShell block={props.block} testid="phone-workspace-tabs"><Segmented block value={selected} options={bound.rows.slice(0, 4).map(row => ({ value: row.id, label: String(row.values?.[titleRef] ?? "未命名") }))} onChange={value => { setActive(String(value)); props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: String(value) }); }} /><Button size="mini" fill="none" style={{ marginTop: 6 }} onClick={() => props.onAction?.("actionTrigger", { operation: "openTabManager" })}>管理全部页签</Button></PhoneShell>;
}

function PhoneSavedViewTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const presetRef = phoneField(props, "presetKeyFieldRef"); const [active, setActive] = React.useState("all");
  if (!bound || !titleRef || !presetRef) return <PhoneShell block={props.block} testid="phone-saved-view-tabs"><MobileEmpty description="保存视图尚未绑定名称和预设键" /></PhoneShell>;
  const options = [{ label: "全部", value: "all" }, ...bound.rows.flatMap(row => { const value = String(row.values?.[presetRef] ?? ""); return value ? [{ value, label: String(row.values?.[titleRef] ?? "未命名") }] : []; })];
  return <PhoneShell block={props.block} testid="phone-saved-view-tabs"><Segmented block value={active} options={options} onChange={value => { const key = String(value); setActive(key); props.onAction?.("filterChange", { operation: key === "all" ? "clear" : "apply", presetKey: key, targets: phoneTargets(props) }); }} /><Button block fill="none" size="small" onClick={() => props.onAction?.("submitRequest", { operation: "saveView", targets: phoneTargets(props) })}>保存当前视图</Button></PhoneShell>;
}

function PhoneAdvancedFilterBuilder(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fields = phoneFieldList(props, "fieldRefs"); const [logic, setLogic] = React.useState("and"); const [field, setField] = React.useState(fields[0] ?? ""); const [value, setValue] = React.useState("");
  if (!bound || !fields.length) return <PhoneShell block={props.block} title={titleOf(props) || "高级筛选"} testid="phone-advanced-filter-builder"><MobileEmpty description="高级筛选尚未绑定字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "高级筛选"} testid="phone-advanced-filter-builder"><Selector columns={2} value={[logic]} options={[{ label: "全部满足", value: "and" }, { label: "任一满足", value: "or" }]} onChange={next => next[0] && setLogic(String(next[0]))} /><Picker columns={[fields.map(item => ({ label: props.fieldLabelOf?.(bound.entityRef, item) ?? item, value: item }))]} value={[field]} onConfirm={next => setField(String(next[0] ?? fields[0]))}>{(_, actions) => <Button block style={{ marginTop: 8 }} onClick={actions.open}>字段：{props.fieldLabelOf?.(bound.entityRef, field) ?? field}</Button>}</Picker><Input value={value} onChange={setValue} placeholder="输入条件值" style={{ margin: "8px 0", padding: 10, background: "#f5f5f5", borderRadius: 6 }} /><Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setValue("")}>重置</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!value.trim()} onClick={() => props.onAction?.("filterChange", { operation: "submit", logic, conditions: [{ field, operator: "equals", value }], targets: phoneTargets(props) })}>应用筛选</Button></Grid.Item></Grid></PhoneShell>;
}

function PhoneFacetedFilterPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fields = phoneFieldList(props, "fieldRefs"); const [selected, setSelected] = React.useState<Record<string, string[]>>({});
  if (!bound || fields.length < 2) return <PhoneShell block={props.block} title={titleOf(props) || "分面筛选"} testid="phone-faceted-filter-panel"><MobileEmpty description="分面筛选至少需要两个枚举字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "分面筛选"} testid="phone-faceted-filter-panel"><Collapse defaultActiveKey={fields}>{fields.map(field => { const options = props.enumOptionsOf?.(bound.entityRef, field) ?? Array.from(new Set(bound.rows.map(row => String(row.values?.[field] ?? "")).filter(Boolean))).map(value => ({ id: value, label: value })); return <Collapse.Panel key={field} title={props.fieldLabelOf?.(bound.entityRef, field) ?? field}><Selector columns={2} multiple value={selected[field] ?? []} options={options.map(option => ({ value: option.id, label: `${option.label} (${bound.rows.filter(row => String(row.values?.[field] ?? "") === option.id).length})` }))} onChange={values => { const next = { ...selected, [field]: values.map(String) }; setSelected(next); props.onAction?.("filterChange", { operation: "toggleValue", facets: next, targets: phoneTargets(props) }); }} /></Collapse.Panel>; })}</Collapse><Button block fill="none" onClick={() => { setSelected({}); props.onAction?.("filterChange", { operation: "clearAll", targets: phoneTargets(props) }); }}>全部清除</Button></PhoneShell>;
}

function PhoneWizardNavigationBar(props: ExperienceBlockRendererProps) {
  const steps = Array.isArray(props.block.props?.steps) ? props.block.props.steps.map(String) : []; const total = Math.max(steps.length, Number(props.block.props?.total ?? 3)); const [current, setCurrent] = React.useState(Math.min(total - 1, Math.max(0, Number(props.block.props?.initialStep ?? 0)))); const move = (next: number) => { setCurrent(next); props.onAction?.("stepChange", { current: next, total, direction: next > current ? "next" : "previous", targets: phoneTargets(props) }); };
  return <PhoneShell block={props.block} testid="phone-wizard-navigation-bar"><div style={{ marginBottom: 8 }}>第 {current + 1} / {total} 步{steps[current] ? ` · ${steps[current]}` : ""}</div><ProgressBar percent={Math.round((current + 1) / total * 100)} /><Grid columns={2} gap={8} style={{ marginTop: 10 }}><Grid.Item><Button block disabled={current === 0} onClick={() => move(current - 1)}>上一步</Button></Grid.Item><Grid.Item>{current < total - 1 ? <Button block color="primary" onClick={() => move(current + 1)}>下一步</Button> : <Button block color="primary" onClick={() => props.onAction?.("submitRequest", { operation: "finishWizard", current, total, targets: phoneTargets(props) })}>提交</Button>}</Grid.Item></Grid></PhoneShell>;
}

function PhoneApprovalDecisionBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const statusRef = phoneField(props, "statusFieldRef"); const titleRef = phoneField(props, "titleFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const pending = statusRef && row && String(row.values?.[statusRef] ?? "pending") === String(props.block.props?.pendingValue ?? "pending"); const [open, setOpen] = React.useState(false); const [reason, setReason] = React.useState("");
  if (!bound || !statusRef) return <PhoneShell block={props.block} testid="phone-approval-decision-bar"><MobileEmpty description="审批决策栏尚未绑定状态字段" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-approval-decision-bar"><div style={{ marginBottom: 8 }}>{row && titleRef ? String(row.values?.[titleRef] ?? "当前审批") : "当前审批"} · {pending ? "待处理" : "已结束"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!pending} onClick={() => setOpen(true)}>驳回</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!pending} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, decision: "approve" })}>通过</Button></Grid.Item></Grid><Popup visible={open} onMaskClick={() => setOpen(false)} bodyStyle={{ padding: 16 }}><strong>填写驳回原因</strong><TextArea value={reason} onChange={setReason} rows={4} placeholder="原因不能为空" style={{ margin: "12px 0" }} /><Button block color="danger" disabled={!reason.trim()} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, decision: "reject", reason }); setOpen(false); }}>确认驳回</Button></Popup></PhoneShell>;
}

function PhoneCheckoutSummaryBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const amountRef = phoneField(props, "amountFieldRef"); const discountRef = phoneField(props, "discountFieldRef"); const rowIds = bound ? props.selection?.rowIds?.[bound.entityRef] ?? [] : []; const rows = bound?.rows.filter(row => rowIds.includes(row.id)) ?? []; const amount = rows.reduce((sum, row) => sum + Number(row.values?.[amountRef ?? ""] ?? 0), 0); const discount = rows.reduce((sum, row) => sum + Number(row.values?.[discountRef ?? ""] ?? 0), 0); const [agreed, setAgreed] = React.useState(false);
  if (!bound || !amountRef) return <PhoneShell block={props.block} testid="phone-checkout-summary-bar"><MobileEmpty description="结算栏尚未绑定金额字段" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-checkout-summary-bar"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}><span>已选 {rows.length} 项</span><strong style={{ fontSize: 20, color: "#e5484d" }}>¥{Math.max(0, amount - discount).toFixed(2)}</strong></div><Checkbox checked={agreed} onChange={setAgreed}>已确认提交协议</Checkbox><Button block color="primary" disabled={!rows.length || !agreed} style={{ marginTop: 8 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "checkout", rowIds, amount, discount, total: Math.max(0, amount - discount), agreementAccepted: agreed })}>确认提交</Button></PhoneShell>;
}

function PhoneRecordLifecycleBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]); const [more, setMore] = React.useState(false);
  if (!bound) return <PhoneShell block={props.block} testid="phone-record-lifecycle-bar"><MobileEmpty description="记录操作栏尚未绑定实体" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-record-lifecycle-bar"><div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>{row ? `当前记录 ${row.id}` : "请先选择一条记录"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!row} onClick={() => setMore(true)}>更多</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!row} onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "save" })}>保存</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={() => setMore(false)} bodyStyle={{ padding: 16 }}><Space direction="vertical" block><Button block disabled={!row} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "archive" })}>归档</Button><Button block color="danger" disabled={!row} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "delete" })}>确认删除</Button></Space></Popup></PhoneShell>;
}

const phoneTruthy = (value: unknown, truthy = "true") =>
  [true, "true", "enabled", "available", "in_app", "breaking", truthy].includes(value as never);

const phoneTime = (value: unknown) => {
  const timestamp = new Date(String(value ?? "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

function PhoneAvailabilityPlanner(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const dayRef = phoneField(props, "dayFieldRef");
  const startRef = phoneField(props, "startTimeFieldRef");
  const endRef = phoneField(props, "endTimeFieldRef");
  const enabledRef = phoneField(props, "enabledFieldRef");
  if (!bound || !dayRef || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "可用时间"} testid="phone-availability-planner"><MobileEmpty description="可用时间尚未绑定星期和起止时间" /></PhoneShell>;
  const days = Array.from(new Set(bound.rows.map(row => String(row.values?.[dayRef] ?? "")).filter(Boolean)));
  return <PhoneShell block={props.block} title={titleOf(props) || "可用时间"} testid="phone-availability-planner">
    <div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>时区 · {String(props.block.props?.timezone ?? "Asia/Shanghai")}</div>
    {days.length === 0 ? <MobileEmpty description="还没有设置可用时间" /> : <Collapse defaultActiveKey={[days[0]]}>{days.map(day => <Collapse.Panel key={day} title={`${day} · ${bound.rows.filter(row => String(row.values?.[dayRef] ?? "") === day).length} 段`}><List style={{ margin: 0 }}>{bound.rows.filter(row => String(row.values?.[dayRef] ?? "") === day).map(row => { const enabled = !enabledRef || phoneTruthy(row.values?.[enabledRef], "enabled"); return <List.Item key={row.id} description={enabled ? "可预约" : "已停用"} extra={<Button size="mini" disabled={!enabled} onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editAvailability" })}>编辑</Button>}><span style={{ textDecoration: enabled ? undefined : "line-through", color: enabled ? undefined : "#999" }}>{String(row.values?.[startRef] ?? "")} - {String(row.values?.[endRef] ?? "")}</span></List.Item>; })}</List></Collapse.Panel>)}</Collapse>}
  </PhoneShell>;
}

function PhoneBookingSlotPicker(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const startRef = phoneField(props, "startFieldRef"); const endRef = phoneField(props, "endFieldRef"); const availableRef = phoneField(props, "availableFieldRef"); const capacityRef = phoneField(props, "capacityFieldRef"); const [selected, setSelected] = React.useState("");
  const dates = bound && startRef ? Array.from(new Set(bound.rows.map(row => String(row.values?.[startRef] ?? "").slice(0, 10)).filter(Boolean))) : [];
  const [date, setDate] = React.useState(dates[0] ?? "");
  React.useEffect(() => { if (!date && dates[0]) setDate(dates[0]); }, [date, dates]);
  if (!bound || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "选择时段"} testid="phone-booking-slot-picker"><MobileEmpty description="时段选择器尚未绑定开始和结束时间" /></PhoneShell>;
  const rows = bound.rows.filter(row => String(row.values?.[startRef] ?? "").slice(0, 10) === date);
  return <PhoneShell block={props.block} title={titleOf(props) || "选择时段"} testid="phone-booking-slot-picker">{dates.length === 0 ? <MobileEmpty description="当前没有可预约日期" /> : <><Segmented block value={date} options={dates.slice(0, 5).map(value => ({ label: value.slice(5), value }))} onChange={value => { setDate(String(value)); setSelected(""); }} /><Selector style={{ marginTop: 10 }} columns={2} value={selected ? [selected] : []} options={rows.map(row => { const available = !availableRef || phoneTruthy(row.values?.[availableRef], "available"); return { value: row.id, disabled: !available, label: `${String(row.values?.[startRef] ?? "").slice(11, 16)}-${String(row.values?.[endRef] ?? "").slice(11, 16)}${capacityRef ? ` · ${String(row.values?.[capacityRef] ?? 0)} 位` : ""}` }; })} onChange={values => setSelected(String(values[0] ?? ""))} /><Button block color="primary" disabled={!selected} style={{ marginTop: 10 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: selected, operation: "selectBookingSlot", targets: phoneTargets(props) })}>确认所选时段</Button></>}</PhoneShell>;
}

function PhoneScheduleConflictResolver(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const startRef = phoneField(props, "startFieldRef"); const endRef = phoneField(props, "endFieldRef"); const resourceRef = phoneField(props, "resourceFieldRef");
  if (!bound || !titleRef || !startRef || !endRef || !resourceRef) return <PhoneShell block={props.block} title={titleOf(props) || "排期冲突"} testid="phone-schedule-conflict-resolver"><MobileEmpty description="冲突解析尚未绑定标题、资源和起止时间" /></PhoneShell>;
  const conflicts: Array<{ left: (typeof bound.rows)[number]; right: (typeof bound.rows)[number] }> = [];
  for (let i = 0; i < bound.rows.length; i += 1) for (let j = i + 1; j < bound.rows.length; j += 1) { const left = bound.rows[i]; const right = bound.rows[j]; if (String(left.values?.[resourceRef] ?? "") === String(right.values?.[resourceRef] ?? "") && phoneTime(left.values?.[startRef]) < phoneTime(right.values?.[endRef]) && phoneTime(right.values?.[startRef]) < phoneTime(left.values?.[endRef])) conflicts.push({ left, right }); }
  return <PhoneShell block={props.block} title={titleOf(props) || `排期冲突 · ${conflicts.length}`} testid="phone-schedule-conflict-resolver">{conflicts.length === 0 ? <MobileEmpty description="当前没有排期冲突" /> : <List mode="card" style={{ margin: 0 }}>{conflicts.map(({ left, right }) => <List.Item key={`${left.id}-${right.id}`} description={`${String(left.values?.[resourceRef] ?? "")} · ${String(left.values?.[startRef] ?? "")} - ${String(left.values?.[endRef] ?? "")}`} extra={<Button size="mini" color="primary" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowIds: [left.id, right.id], operation: "resolveScheduleConflict", targets: phoneTargets(props) })}>调整</Button>}>{String(left.values?.[titleRef] ?? left.id)} / {String(right.values?.[titleRef] ?? right.id)}</List.Item>)}</List>}</PhoneShell>;
}

function PhoneStackTracePanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const functionRef = phoneField(props, "functionFieldRef"); const fileRef = phoneField(props, "fileFieldRef"); const lineRef = phoneField(props, "lineFieldRef"); const codeRef = phoneField(props, "codeFieldRef"); const inAppRef = phoneField(props, "inAppFieldRef");
  if (!bound || !functionRef || !fileRef || !lineRef) return <PhoneShell block={props.block} title={titleOf(props) || "异常堆栈"} testid="phone-stack-trace-panel"><MobileEmpty description="堆栈尚未绑定函数、文件和行号字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => Number(a.values?.[lineRef] ?? 0) - Number(b.values?.[lineRef] ?? 0)); const firstApp = rows.find(row => inAppRef && phoneTruthy(row.values?.[inAppRef], "in_app"))?.id;
  return <PhoneShell block={props.block} title={titleOf(props) || "异常堆栈"} testid="phone-stack-trace-panel">{rows.length === 0 ? <MobileEmpty description="没有可显示的堆栈帧" /> : <Collapse accordion defaultActiveKey={firstApp}>{rows.map(row => { const inApp = Boolean(inAppRef && phoneTruthy(row.values?.[inAppRef], "in_app")); return <Collapse.Panel key={row.id} title={`${inApp ? "应用" : "依赖"} · ${String(row.values?.[functionRef] ?? "anonymous")}`}><div style={{ color: "#666", fontSize: 12, overflowWrap: "anywhere" }}>{String(row.values?.[fileRef] ?? "")}:{String(row.values?.[lineRef] ?? "")}</div><pre style={{ margin: "8px 0", padding: 8, background: "#f5f5f5", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{codeRef ? String(row.values?.[codeRef] ?? "暂无源码上下文") : "暂无源码上下文"}</pre><Button size="mini" fill="none" onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>查看帧详情</Button></Collapse.Panel>; })}</Collapse>}</PhoneShell>;
}

function PhoneEventBreadcrumbTimeline(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const messageRef = phoneField(props, "messageFieldRef"); const categoryRef = phoneField(props, "categoryFieldRef"); const levelRef = phoneField(props, "levelFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const [scope, setScope] = React.useState("all");
  if (!bound || !messageRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "事件轨迹"} testid="phone-event-breadcrumb-timeline"><MobileEmpty description="事件轨迹尚未绑定消息和时间字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => phoneTime(a.values?.[timeRef]) - phoneTime(b.values?.[timeRef])).filter(row => scope === "all" || String(row.values?.[levelRef ?? ""] ?? "") === "error");
  return <PhoneShell block={props.block} title={titleOf(props) || "事件轨迹"} testid="phone-event-breadcrumb-timeline">{levelRef && <Segmented block value={scope} options={[{ label: `全部 ${bound.rows.length}`, value: "all" }, { label: "仅错误", value: "error" }]} onChange={value => setScope(String(value))} />}<Steps direction="vertical" style={{ marginTop: 10 }}>{rows.map(row => <Steps.Step key={row.id} status={String(row.values?.[levelRef ?? ""] ?? "") === "error" ? "error" : "finish"} title={String(row.values?.[messageRef] ?? "未命名事件")} description={`${categoryRef ? `${String(row.values?.[categoryRef] ?? "事件")} · ` : ""}${String(row.values?.[timeRef] ?? "")}`} />)}</Steps>{rows.length === 0 && <MobileEmpty description="当前范围没有事件" />}</PhoneShell>;
}

function PhoneSuspectCommitPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const hashRef = phoneField(props, "hashFieldRef"); const authorRef = phoneField(props, "authorFieldRef"); const messageRef = phoneField(props, "messageFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const scoreRef = phoneField(props, "scoreFieldRef");
  if (!bound || !hashRef || !messageRef) return <PhoneShell block={props.block} title={titleOf(props) || "可疑提交"} testid="phone-suspect-commit-panel"><MobileEmpty description="可疑提交尚未绑定哈希和说明字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => Number(b.values?.[scoreRef ?? ""] ?? 0) - Number(a.values?.[scoreRef ?? ""] ?? 0));
  return <PhoneShell block={props.block} title={titleOf(props) || "可疑提交"} testid="phone-suspect-commit-panel">{rows.length === 0 ? <MobileEmpty description="没有关联到可疑提交" /> : <List mode="card" style={{ margin: 0 }}>{rows.map(row => <List.Item key={row.id} description={[authorRef ? row.values?.[authorRef] : "", timeRef ? row.values?.[timeRef] : "", scoreRef ? `相关度 ${String(row.values?.[scoreRef] ?? 0)}%` : ""].filter(Boolean).join(" · ")} extra={<Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "markSuspectCommit", targets: phoneTargets(props) })}>标记根因</Button>}><div style={{ fontFamily: "monospace", fontSize: 12 }}>{String(row.values?.[hashRef] ?? "").slice(0, 8)}</div><div>{String(row.values?.[messageRef] ?? "未命名提交")}</div></List.Item>)}</List>}</PhoneShell>;
}

function PhoneConnectionTimeline(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const typeRef = phoneField(props, "typeFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const summaryRef = phoneField(props, "summaryFieldRef"); const recordsRef = phoneField(props, "recordsFieldRef"); const [scope, setScope] = React.useState("all");
  if (!bound || !typeRef || !statusRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "连接时间线"} testid="phone-connection-timeline"><MobileEmpty description="连接时间线尚未绑定类型、状态和时间字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => phoneTime(b.values?.[timeRef]) - phoneTime(a.values?.[timeRef])).filter(row => scope === "all" || String(row.values?.[statusRef] ?? "") === scope);
  return <PhoneShell block={props.block} title={titleOf(props) || "连接时间线"} testid="phone-connection-timeline"><Segmented block value={scope} options={[{ label: `全部 ${bound.rows.length}`, value: "all" }, { label: "失败", value: "failed" }]} onChange={value => setScope(String(value))} /><List style={{ marginTop: 8 }}>{rows.map(row => { const status = String(row.values?.[statusRef] ?? ""); return <List.Item key={row.id} description={[summaryRef ? row.values?.[summaryRef] : "", row.values?.[timeRef], recordsRef ? `${String(row.values?.[recordsRef] ?? 0)} 条` : ""].filter(Boolean).join(" · ")} extra={status === "failed" ? <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryConnectionJob", targets: phoneTargets(props) })}>重试</Button> : status}><strong>{String(row.values?.[typeRef] ?? "事件")}</strong></List.Item>; })}</List>{rows.length === 0 && <MobileEmpty description="当前范围没有连接事件" />}</PhoneShell>;
}

function PhoneSchemaChangeReview(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const streamRef = phoneField(props, "streamFieldRef"); const fieldNameRef = phoneField(props, "fieldNameFieldRef"); const changeRef = phoneField(props, "changeTypeFieldRef"); const beforeRef = phoneField(props, "beforeFieldRef"); const afterRef = phoneField(props, "afterFieldRef"); const breakingRef = phoneField(props, "breakingFieldRef");
  if (!bound || !streamRef || !fieldNameRef || !changeRef) return <PhoneShell block={props.block} title={titleOf(props) || "Schema 变更"} testid="phone-schema-change-review"><MobileEmpty description="Schema 审查尚未绑定数据流、字段和变更类型" /></PhoneShell>;
  const breaking = bound.rows.filter(row => breakingRef && phoneTruthy(row.values?.[breakingRef], "breaking"));
  return <PhoneShell block={props.block} title={titleOf(props) || `Schema 变更 · ${breaking.length} 项破坏性`} testid="phone-schema-change-review">{bound.rows.length === 0 ? <MobileEmpty description="没有待审查的 Schema 变更" /> : <><Collapse accordion>{bound.rows.map(row => { const dangerous = Boolean(breakingRef && phoneTruthy(row.values?.[breakingRef], "breaking")); return <Collapse.Panel key={row.id} title={`${dangerous ? "破坏性 · " : ""}${String(row.values?.[streamRef] ?? "")} / ${String(row.values?.[fieldNameRef] ?? "")}`}><div>{String(row.values?.[changeRef] ?? "变更")}</div><div style={{ color: "#666", marginTop: 6, overflowWrap: "anywhere" }}>{beforeRef ? String(row.values?.[beforeRef] ?? "-") : "-"} → {afterRef ? String(row.values?.[afterRef] ?? "-") : "-"}</div></Collapse.Panel>; })}</Collapse><Grid columns={2} gap={8} style={{ marginTop: 10 }}><Grid.Item><Button block onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "rejectSchemaChanges", rowIds: bound.rows.map(row => row.id), targets: phoneTargets(props) })}>暂不应用</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={breaking.length > 0 && props.block.props?.allowBreaking !== true} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "applySchemaChanges", rowIds: bound.rows.map(row => row.id), targets: phoneTargets(props) })}>应用安全变更</Button></Grid.Item></Grid></>}</PhoneShell>;
}

function PhoneStreamStatusMonitor(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const lastSyncRef = phoneField(props, "lastSyncFieldRef"); const freshnessRef = phoneField(props, "freshnessFieldRef"); const recordsRef = phoneField(props, "recordsFieldRef"); const errorRef = phoneField(props, "errorFieldRef");
  if (!bound || !nameRef || !statusRef) return <PhoneShell block={props.block} title={titleOf(props) || "数据流状态"} testid="phone-stream-status-monitor"><MobileEmpty description="数据流监控尚未绑定名称和状态字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "数据流状态"} testid="phone-stream-status-monitor">{bound.rows.length === 0 ? <MobileEmpty description="还没有数据流状态" /> : <List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? ""); return <List.Item key={row.id} description={<div>{[lastSyncRef ? row.values?.[lastSyncRef] : "", freshnessRef ? `新鲜度 ${String(row.values?.[freshnessRef] ?? "-")}` : "", recordsRef ? `${String(row.values?.[recordsRef] ?? 0)} 条` : ""].filter(Boolean).join(" · ")}{status === "failed" && errorRef && <div style={{ color: "#ff3141", marginTop: 4 }}>{String(row.values?.[errorRef] ?? "同步失败")}</div>}</div>} extra={status === "failed" ? <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryStream", targets: phoneTargets(props) })}>重试</Button> : status}><strong>{String(row.values?.[nameRef] ?? "未命名数据流")}</strong></List.Item>; })}</List>}</PhoneShell>;
}

function PhoneConnectionMappingPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const sourceRef = phoneField(props, "sourceFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const transformRef = phoneField(props, "transformFieldRef"); const statusRef = phoneField(props, "statusFieldRef");
  if (!bound || !sourceRef || !targetRef) return <PhoneShell block={props.block} title={titleOf(props) || "字段映射"} testid="phone-connection-mapping-panel"><MobileEmpty description="字段映射尚未绑定来源和目标字段" /></PhoneShell>;
  const invalid = bound.rows.filter(row => statusRef && String(row.values?.[statusRef] ?? "") === "invalid");
  return <PhoneShell block={props.block} title={titleOf(props) || `字段映射 · ${invalid.length ? `${invalid.length} 项异常` : "有效"}`} testid="phone-connection-mapping-panel">{bound.rows.length === 0 ? <MobileEmpty description="还没有字段映射" /> : <><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={transformRef ? String(row.values?.[transformRef] ?? "直接映射") : "直接映射"} extra={<Button size="mini" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editConnectionMapping" })}>编辑</Button>}><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", gap: 6, fontFamily: "monospace", fontSize: 12 }}><span style={{ overflowWrap: "anywhere" }}>{String(row.values?.[sourceRef] ?? "")}</span><span>→</span><span style={{ overflowWrap: "anywhere" }}>{String(row.values?.[targetRef] ?? "未映射")}</span></div></List.Item>)}</List><Button block color="primary" disabled={invalid.length > 0} style={{ marginTop: 10 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "saveConnectionMappings", rowIds: bound.rows.map(row => row.id), targets: phoneTargets(props) })}>保存映射</Button></>}</PhoneShell>;
}

function PhoneIssueCommandHeader(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const priorityRef = phoneField(props, "priorityFieldRef"); const assigneeRef = phoneField(props, "assigneeFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const [archiveOpen, setArchiveOpen] = React.useState(false);
  if (!bound || !titleRef || !statusRef || !row) return <PhoneShell block={props.block} testid="phone-issue-command-header"><MobileEmpty description="问题操作区尚未绑定当前问题、标题和状态" /></PhoneShell>;
  const status = String(row.values?.[statusRef] ?? "unresolved"); const complete = ["resolved", "ignored", "archived"].includes(status); const submit = (operation: string) => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} testid="phone-issue-command-header"><strong style={{ fontSize: 16, overflowWrap: "anywhere" }}>{String(row.values?.[titleRef] ?? "未命名问题")}</strong><div style={{ color: "#666", fontSize: 12, margin: "6px 0 10px" }}>{[status, priorityRef ? row.values?.[priorityRef] : "", assigneeRef ? `负责人 ${String(row.values?.[assigneeRef] ?? "未分配")}` : ""].filter(Boolean).join(" · ")}</div>{complete ? <Button block color="primary" onClick={() => submit("reopenIssue")}>重新打开</Button> : <Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setArchiveOpen(true)}>归档</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={() => submit("resolveIssue")}>解决</Button></Grid.Item></Grid>}<Popup visible={archiveOpen} onMaskClick={() => setArchiveOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认归档问题？</strong><div style={{ color: "#666", margin: "8px 0 12px" }}>归档后将从活动问题中移除。</div><Button block color="danger" onClick={() => { submit("archiveIssue"); setArchiveOpen(false); }}>确认归档</Button></Popup></PhoneShell>;
}

function PhoneConnectionControlHeader(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const syncRef = phoneField(props, "syncStatusFieldRef"); const scheduleRef = phoneField(props, "scheduleFieldRef"); const breakingRef = phoneField(props, "breakingFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const [cancelOpen, setCancelOpen] = React.useState(false);
  if (!bound || !titleRef || !statusRef || !syncRef || !row) return <PhoneShell block={props.block} testid="phone-connection-control-header"><MobileEmpty description="连接控制尚未绑定标题、连接状态和同步状态" /></PhoneShell>;
  const status = String(row.values?.[statusRef] ?? "inactive"); const sync = String(row.values?.[syncRef] ?? "idle"); const running = sync === "running"; const locked = status === "locked"; const breaking = Boolean(breakingRef && phoneTruthy(row.values?.[breakingRef], "breaking")); const action = (operation: string) => props.onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} testid="phone-connection-control-header"><strong style={{ fontSize: 16 }}>{String(row.values?.[titleRef] ?? "未命名连接")}</strong><div style={{ color: "#666", fontSize: 12, margin: "6px 0 10px" }}>{[status, sync, scheduleRef ? `计划 ${String(row.values?.[scheduleRef] ?? "手动")}` : ""].filter(Boolean).join(" · ")}</div>{breaking && <div style={{ background: "#fff7e6", color: "#ad6800", padding: 8, borderRadius: 6, marginBottom: 8 }}>存在破坏性 Schema 变更，暂不能启用或同步</div>}<Grid columns={2} gap={8}><Grid.Item><Button block disabled={locked || breaking || running} onClick={() => action(status === "active" ? "disableConnection" : "enableConnection")}>{status === "active" ? "停用连接" : "启用连接"}</Button></Grid.Item><Grid.Item>{running ? <Button block color="danger" onClick={() => setCancelOpen(true)}>取消运行</Button> : <Button block color="primary" disabled={status !== "active" || breaking} onClick={() => action("startConnectionSync")}>立即同步</Button>}</Grid.Item></Grid><Popup visible={cancelOpen} onMaskClick={() => setCancelOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认取消当前运行任务？</strong><Button block color="danger" style={{ marginTop: 12 }} onClick={() => { action("cancelConnectionJob"); setCancelOpen(false); }}>确认取消</Button></Popup></PhoneShell>;
}

function PhoneEventUserCountMetrics(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const eventRef = phoneField(props, "eventCountFieldRef"); const userRef = phoneField(props, "userCountFieldRef"); const row = bound?.rows[0];
  if (!bound || !eventRef || !userRef || !row) return <PhoneShell block={props.block} title={titleOf(props) || "问题影响"} testid="phone-event-user-count-metrics"><MobileEmpty description="影响指标尚未绑定事件数和用户数字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "问题影响"} testid="phone-event-user-count-metrics"><Grid columns={2} gap={8}><Grid.Item><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}><div style={{ color: "#666", fontSize: 12 }}>事件总数</div><strong style={{ fontSize: 22 }}>{Number(row.values?.[eventRef] ?? 0).toLocaleString()}</strong></div></Grid.Item><Grid.Item><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}><div style={{ color: "#666", fontSize: 12 }}>受影响用户</div><strong style={{ fontSize: 22 }}>{Number(row.values?.[userRef] ?? 0).toLocaleString()}</strong></div></Grid.Item></Grid></PhoneShell>;
}

function PhoneJobRunMetrics(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const bytesRef = phoneField(props, "bytesFieldRef"); const recordsRef = phoneField(props, "recordsFieldRef"); const rejectedRef = phoneField(props, "rejectedFieldRef"); const durationRef = phoneField(props, "durationFieldRef"); const attemptsRef = phoneField(props, "attemptsFieldRef"); const row = bound?.rows[0];
  if (!bound || !recordsRef || !durationRef || !row) return <PhoneShell block={props.block} title={titleOf(props) || "运行指标"} testid="phone-job-run-metrics"><MobileEmpty description="运行指标尚未绑定记录数和耗时字段" /></PhoneShell>;
  const bytes = bytesRef ? Number(row.values?.[bytesRef] ?? 0) : 0; const items = [["已加载记录", Number(row.values?.[recordsRef] ?? 0).toLocaleString()], ...(bytesRef ? [["数据量", bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`]] : []), ...(rejectedRef ? [["拒绝记录", String(row.values?.[rejectedRef] ?? 0)]] : []), ["耗时", String(row.values?.[durationRef] ?? "-")], ...(attemptsRef ? [["尝试次数", String(row.values?.[attemptsRef] ?? 1)]] : [])];
  return <PhoneShell block={props.block} title={titleOf(props) || "运行指标"} testid="phone-job-run-metrics"><Grid columns={2} gap={8}>{items.map(([label, value]) => <Grid.Item key={label}><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}><div style={{ color: "#666", fontSize: 12 }}>{label}</div><strong style={{ fontSize: 18 }}>{value}</strong></div></Grid.Item>)}</Grid></PhoneShell>;
}

function PhoneOccurrenceEvidenceSummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const row = bound?.rows[0]; const fields = [["环境", phoneField(props, "environmentFieldRef")], ["状态码", phoneField(props, "statusCodeFieldRef")], ["失败原因", phoneField(props, "reasonFieldRef")], ["上次成功", phoneField(props, "lastSuccessFieldRef")], ["中断时长", phoneField(props, "downtimeFieldRef")]] as const;
  if (!bound || !row || fields.every(([, ref]) => !ref)) return <PhoneShell block={props.block} title={titleOf(props) || "发生摘要"} testid="phone-occurrence-evidence-summary"><MobileEmpty description="发生摘要尚未绑定证据字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "发生摘要"} testid="phone-occurrence-evidence-summary"><List mode="card" style={{ margin: 0 }}>{fields.flatMap(([label, ref]) => ref ? [<List.Item key={label} extra={<span style={{ maxWidth: 150, overflowWrap: "anywhere", textAlign: "right" }}>{String(row.values?.[ref] ?? "-")}</span>}>{label}</List.Item>] : [])}</List></PhoneShell>;
}

function PhoneConnectionRouteSummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const sourceRef = phoneField(props, "sourceFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const sourceVersionRef = phoneField(props, "sourceVersionFieldRef"); const targetVersionRef = phoneField(props, "targetVersionFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const row = bound?.rows[0];
  if (!bound || !sourceRef || !targetRef || !row) return <PhoneShell block={props.block} title={titleOf(props) || "连接路径"} testid="phone-connection-route-summary"><MobileEmpty description="连接路径尚未绑定来源和目标字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "连接路径"} testid="phone-connection-route-summary"><div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>{statusRef ? String(row.values?.[statusRef] ?? "") : ""}</div><Grid columns={3} gap={6}><Grid.Item span={1}><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6, overflowWrap: "anywhere" }}><small>来源</small><div><strong>{String(row.values?.[sourceRef] ?? "-")}</strong></div>{sourceVersionRef && <small>{String(row.values?.[sourceVersionRef] ?? "")}</small>}</div></Grid.Item><Grid.Item><div style={{ textAlign: "center", paddingTop: 22 }}>→</div></Grid.Item><Grid.Item><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6, overflowWrap: "anywhere" }}><small>目标</small><div><strong>{String(row.values?.[targetRef] ?? "-")}</strong></div>{targetVersionRef && <small>{String(row.values?.[targetVersionRef] ?? "")}</small>}</div></Grid.Item></Grid></PhoneShell>;
}

function PhoneResourceDetailTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const keyRef = phoneField(props, "keyFieldRef"); const availableRef = phoneField(props, "availableFieldRef"); const countRef = phoneField(props, "countFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !titleRef || !keyRef) return <PhoneShell block={props.block} testid="phone-resource-detail-tabs"><MobileEmpty description="资源页签尚未绑定标题和稳定键" /></PhoneShell>; const rows = bound.rows.filter(row => String(row.values?.[keyRef] ?? "")); const usable = rows.filter(row => !availableRef || ![false, "false", "disabled"].includes(row.values?.[availableRef] as never)); const selected = usable.some(row => String(row.values?.[keyRef]) === active) ? active : String(usable[0]?.values?.[keyRef] ?? "");
  return <PhoneShell block={props.block} testid="phone-resource-detail-tabs"><Tabs activeKey={selected} onChange={key => { setActive(key); const row = rows.find(item => String(item.values?.[keyRef]) === key); props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row?.id, sectionKey: key, targets: phoneTargets(props) }); }}>{rows.map(row => <Tabs.Tab key={String(row.values?.[keyRef])} title={`${String(row.values?.[titleRef] ?? "未命名")}${countRef ? ` ${String(row.values?.[countRef] ?? 0)}` : ""}`} disabled={Boolean(availableRef && [false, "false", "disabled"].includes(row.values?.[availableRef] as never))} />)}</Tabs></PhoneShell>;
}

function PhoneInspectorModeTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const keyRef = phoneField(props, "keyFieldRef"); const titleRef = phoneField(props, "titleFieldRef"); const enabledRef = phoneField(props, "enabledFieldRef"); const issueRef = phoneField(props, "issueCountFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !keyRef || !titleRef) return <PhoneShell block={props.block} testid="phone-inspector-mode-tabs"><MobileEmpty description="检查器页签尚未绑定模式键和标题" /></PhoneShell>; const rows = bound.rows.filter(row => String(row.values?.[keyRef] ?? "")); const usable = rows.filter(row => !enabledRef || ![false, "false", "disabled"].includes(row.values?.[enabledRef] as never)); const selected = usable.some(row => String(row.values?.[keyRef]) === active) ? active : String(usable[0]?.values?.[keyRef] ?? "");
  return <PhoneShell block={props.block} testid="phone-inspector-mode-tabs"><Tabs activeKey={selected} onChange={key => { setActive(key); props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: rows.find(row => String(row.values?.[keyRef]) === key)?.id, mode: key }); }}>{rows.map(row => <Tabs.Tab key={String(row.values?.[keyRef])} title={`${String(row.values?.[titleRef] ?? "模式")}${issueRef && Number(row.values?.[issueRef] ?? 0) ? ` ${String(row.values?.[issueRef])}` : ""}`} disabled={Boolean(enabledRef && [false, "false", "disabled"].includes(row.values?.[enabledRef] as never))} />)}</Tabs></PhoneShell>;
}

function PhoneIssueEventFilter(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const environmentRef = phoneField(props, "environmentFieldRef"); const [environment, setEnvironment] = React.useState("all"); const [period, setPeriod] = React.useState("24h"); const [query, setQuery] = React.useState("");
  if (!bound || !environmentRef) return <PhoneShell block={props.block} title={titleOf(props) || "事件筛选"} testid="phone-issue-event-filter"><MobileEmpty description="事件筛选尚未绑定环境字段" /></PhoneShell>; const environments = Array.from(new Set(bound.rows.map(row => String(row.values?.[environmentRef] ?? "")).filter(Boolean))); const emit = (next: Record<string, unknown>) => props.onAction?.("filterChange", { environment, period, query: query.trim(), ...next, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} title={titleOf(props) || "事件筛选"} testid="phone-issue-event-filter"><Selector columns={2} value={[environment]} options={[{ label: "全部环境", value: "all" }, ...environments.map(value => ({ label: value, value }))]} onChange={values => { const value = String(values[0] ?? "all"); setEnvironment(value); emit({ environment: value }); }} /><Segmented block value={period} options={[{ label: "1h", value: "1h" }, { label: "24h", value: "24h" }, { label: "7d", value: "7d" }, { label: "首次以来", value: "sinceFirst" }]} onChange={value => { setPeriod(String(value)); emit({ period: String(value) }); }} style={{ marginTop: 8 }} /><SearchBar value={query} onChange={setQuery} onSearch={value => emit({ query: value.trim() })} placeholder="输入字段:值查询" style={{ marginTop: 8 }} /></PhoneShell>;
}

function PhoneTimelineFilterBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const typeRef = phoneField(props, "typeFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const [type, setType] = React.useState("all"); const [status, setStatus] = React.useState("all"); const [range, setRange] = React.useState<[Date, Date] | null>(null); const [calendarOpen, setCalendarOpen] = React.useState(false);
  if (!bound || !typeRef || !statusRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "时间线筛选"} testid="phone-timeline-filter-bar"><MobileEmpty description="时间线筛选尚未绑定类型、状态和时间字段" /></PhoneShell>; const types = Array.from(new Set(bound.rows.map(row => String(row.values?.[typeRef] ?? "")).filter(Boolean))); const statuses = Array.from(new Set(bound.rows.map(row => String(row.values?.[statusRef] ?? "")).filter(Boolean))); const supportsStatus = ["all", "sync", "clear", "refresh"].includes(type); const emit = (next: Record<string, unknown>) => props.onAction?.("filterChange", { eventType: type, status, dateRange: range?.map(value => value.toISOString().slice(0, 10)) ?? null, ...next, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} title={titleOf(props) || "时间线筛选"} testid="phone-timeline-filter-bar"><Selector columns={2} value={[type]} options={[{ label: "全部类型", value: "all" }, ...types.map(value => ({ label: value, value }))]} onChange={values => { const value = String(values[0] ?? "all"); setType(value); if (!["all", "sync", "clear", "refresh"].includes(value)) setStatus("all"); emit({ eventType: value, status: ["all", "sync", "clear", "refresh"].includes(value) ? status : "all" }); }} /><Selector columns={2} value={[supportsStatus ? status : "all"]} options={[{ label: "全部状态", value: "all" }, ...statuses.map(value => ({ label: value, value, disabled: !supportsStatus }))]} onChange={values => { const value = String(values[0] ?? "all"); setStatus(value); emit({ status: value }); }} style={{ marginTop: 8 }} /><Grid columns={2} gap={8} style={{ marginTop: 8 }}><Grid.Item><Button block onClick={() => setCalendarOpen(true)}>{range ? `${range[0].toISOString().slice(5, 10)} 至 ${range[1].toISOString().slice(5, 10)}` : "选择日期"}</Button></Grid.Item><Grid.Item><Button block disabled={type === "all" && status === "all" && !range} onClick={() => { setType("all"); setStatus("all"); setRange(null); emit({ eventType: "all", status: "all", dateRange: null }); }}>清除</Button></Grid.Item></Grid><CalendarPicker selectionMode="range" visible={calendarOpen} value={range} onClose={() => setCalendarOpen(false)} onConfirm={value => { const next = value?.[0] && value?.[1] ? [value[0], value[1]] as [Date, Date] : null; setRange(next); setCalendarOpen(false); emit({ dateRange: next?.map(item => item.toISOString().slice(0, 10)) ?? null }); }} /></PhoneShell>;
}

function PhoneUnsavedChangesBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fieldRef = phoneField(props, "fieldNameFieldRef"); const validRef = phoneField(props, "validFieldRef"); const [discardOpen, setDiscardOpen] = React.useState(false); const dirty = bound?.rows ?? []; const invalid = validRef ? dirty.filter(row => [false, "false", "invalid"].includes(row.values?.[validRef] as never)) : [];
  if (!bound || !fieldRef) return <PhoneShell block={props.block} testid="phone-unsaved-changes-bar"><MobileEmpty description="未保存变更栏尚未绑定变更字段" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-unsaved-changes-bar"><div style={{ marginBottom: 8 }}><strong>{dirty.length ? `${dirty.length} 项未保存变更` : "没有未保存变更"}</strong>{invalid.length > 0 && <div style={{ color: "#ff3141", fontSize: 12 }}>{invalid.length} 项校验未通过</div>}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!dirty.length} onClick={() => setDiscardOpen(true)}>放弃</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!dirty.length || invalid.length > 0} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "saveChanges", rowIds: dirty.map(row => row.id), targets: phoneTargets(props) })}>保存变更</Button></Grid.Item></Grid><Popup visible={discardOpen} onMaskClick={() => setDiscardOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认放弃本地变更？</strong><Button block color="danger" style={{ marginTop: 12 }} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "discardChanges", rowIds: dirty.map(row => row.id), targets: phoneTargets(props) }); setDiscardOpen(false); }}>确认放弃</Button></Popup></PhoneShell>;
}

function PhoneRunningJobControlBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const progressRef = phoneField(props, "progressFieldRef"); const typeRef = phoneField(props, "typeFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows.find(item => String(item.values?.[statusRef ?? ""]) === "running") ?? bound?.rows[0]; const [cancelOpen, setCancelOpen] = React.useState(false);
  if (!bound || !titleRef || !statusRef || !row) return <PhoneShell block={props.block} testid="phone-running-job-control-bar"><MobileEmpty description="运行任务栏尚未绑定任务标题和状态" /></PhoneShell>; const status = String(row.values?.[statusRef] ?? ""); const running = status === "running"; const failed = ["failed", "incomplete", "cancelled"].includes(status); const submit = (operation: string) => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} testid="phone-running-job-control-bar"><div><strong>{String(row.values?.[titleRef] ?? "未命名任务")}</strong><span style={{ color: "#666", marginLeft: 6 }}>{typeRef ? String(row.values?.[typeRef] ?? "") : ""} · {status}</span></div>{progressRef && <ProgressBar percent={Math.max(0, Math.min(100, Number(row.values?.[progressRef] ?? 0)))} style={{ margin: "8px 0" }} />}{running ? <Button block color="danger" onClick={() => setCancelOpen(true)}>取消任务</Button> : failed ? <Button block color="primary" onClick={() => submit("retryJob")}>重试任务</Button> : <div style={{ color: "#00b578", marginTop: 8 }}>任务已完成</div>}<Popup visible={cancelOpen} onMaskClick={() => setCancelOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认取消当前运行任务？</strong><div style={{ color: "#666", margin: "8px 0 12px" }}>已处理的数据不会自动回滚。</div><Button block color="danger" onClick={() => { submit("cancelRunningJob"); setCancelOpen(false); }}>确认取消</Button></Popup></PhoneShell>;
}

function PhoneBookingCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"statusFieldRef"),start=phoneField(props,"startFieldRef"),end=phoneField(props,"endFieldRef"),loc=phoneField(props,"locationFieldRef"),rec=phoneField(props,"recurringFieldRef"),paidRef=phoneField(props,"paidFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];const[confirm,setConfirm]=React.useState("");if(!b||!t||!s||!start||!r)return <PhoneShell block={props.block} testid="phone-booking-command-header"><MobileEmpty description="预约操作页头尚未绑定标题、状态和开始时间"/></PhoneShell>;const status=String(r.values?.[s]??"PENDING"),past=phoneTime(r.values?.[end??start])<Date.now(),recurring=Boolean(rec&&phoneTruthy(r.values?.[rec],"recurring")),paid=!paidRef||phoneTruthy(r.values?.[paidRef],"paid"),submit=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,scope:recurring?"series":"single",targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-booking-command-header"><strong>{String(r.values?.[t]??"未命名预约")}</strong><div style={{fontSize:12,color:"#666",margin:"6px 0 10px"}}>{status} · {String(r.values?.[start]??"")}{loc?` · ${String(r.values?.[loc]??"")}`:""}</div>{status==="PENDING"&&!past?<Grid columns={2} gap={8}><Grid.Item><Button block color="danger" onClick={()=>setConfirm("rejectBooking")}>拒绝</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!paid} onClick={()=>submit("confirmBooking")}>确认预约</Button></Grid.Item></Grid>:status==="ACCEPTED"&&!past?<Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"rescheduleBooking"})}>改期</Button></Grid.Item><Grid.Item><Button block color="danger" onClick={()=>setConfirm("cancelBooking")}>取消</Button></Grid.Item></Grid>:status==="ACCEPTED"&&past?<Button block onClick={()=>submit("toggleNoShow")}>标记未到场</Button>:<div style={{color:"#999"}}>当前状态无可用操作</div>}{status==="PENDING"&&!paid&&<div style={{color:"#ff8f1f",fontSize:12,marginTop:6}}>付款尚未完成，暂不能确认</div>}<Popup visible={Boolean(confirm)} onMaskClick={()=>setConfirm("")} bodyStyle={{padding:16}}><strong>确认执行此预约操作？</strong><Button block color="danger" style={{marginTop:12}} onClick={()=>{submit(confirm);setConfirm("")}}>确认</Button></Popup></PhoneShell>}

function PhoneAlertRuleCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"stateFieldRef"),editable=phoneField(props,"editableFieldRef"),prov=phoneField(props,"provisionedFieldRef"),silence=phoneField(props,"silenceableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];const[more,setMore]=React.useState(false);if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-alert-rule-command-header"><MobileEmpty description="告警规则操作尚未绑定标题和状态"/></PhoneShell>;const state=String(r.values?.[s]??"active"),canEdit=!editable||!([false,"false","readonly"].includes(r.values?.[editable] as never)),managed=Boolean(prov&&phoneTruthy(r.values?.[prov],"provisioned")),canSilence=!silence||!([false,"false","disabled"].includes(r.values?.[silence] as never)),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-alert-rule-command-header"><strong>{String(r.values?.[t]??"未命名规则")}</strong><div style={{fontSize:12,color:"#666",margin:"6px 0 10px"}}>{state}{managed?" · 受管规则":""}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!canEdit||managed} onClick={()=>act("editAlertRule","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block onClick={()=>setMore(true)}>更多操作</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={()=>setMore(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("duplicateAlertRule")}>复制</Button><Button block disabled={!canSilence} onClick={()=>act("silenceAlertRule")}>静默</Button><Button block onClick={()=>act(state==="paused"?"resumeAlertRule":"pauseAlertRule")}>{state==="paused"?"恢复":"暂停"}</Button><Button block color="danger" disabled={!canEdit||managed} onClick={()=>act("deleteAlertRule","submitRequest")}>删除</Button></Space></Popup></PhoneShell>}

function PhoneAlertStateMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),s=phoneField(props,"stateFieldRef"),rule=phoneField(props,"ruleIdFieldRef");if(!b||!s||!rule)return <PhoneShell block={props.block} title={titleOf(props)||"告警状态"} testid="phone-alert-state-metrics"><MobileEmpty description="告警状态指标尚未绑定状态和规则字段"/></PhoneShell>;const c=(x:string)=>b.rows.filter(r=>String(r.values?.[s])===x),u=(x:string)=>new Set(c(x).map(r=>String(r.values?.[rule]))).size,items=[["触发规则",u("firing")],["触发实例",c("firing").length],["等待规则",u("pending")],["等待实例",c("pending").length]];return <PhoneShell block={props.block} title={titleOf(props)||"告警状态"} testid="phone-alert-state-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={l}><div style={{background:"#f5f5f5",padding:10,borderRadius:6}}><small>{l}</small><div><strong style={{fontSize:20}}>{v}</strong></div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneBookingCapacityMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),cap=phoneField(props,"capacityFieldRef"),book=phoneField(props,"bookedFieldRef"),no=phoneField(props,"noShowFieldRef"),wait=phoneField(props,"waitlistFieldRef"),r=b?.rows[0];if(!b||!cap||!book||!r)return <PhoneShell block={props.block} title={titleOf(props)||"预约容量"} testid="phone-booking-capacity-metrics"><MobileEmpty description="预约容量尚未绑定容量和已预约字段"/></PhoneShell>;const total=Number(r.values?.[cap]??0),used=Number(r.values?.[book]??0),items=[["总席位",total],["已预约",used],["剩余",Math.max(0,total-used)],...(no?[["未到场",Number(r.values?.[no]??0)]]:[]),...(wait?[["候补",Number(r.values?.[wait]??0)]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"预约容量"} testid="phone-booking-capacity-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={l}><div style={{background:"#f5f5f5",padding:10,borderRadius:6}}><small>{l}</small><div><strong style={{fontSize:20}}>{v}</strong></div></div></Grid.Item>)}</Grid><ProgressBar percent={total?Math.min(100,Math.round(used/total*100)):0} style={{marginTop:10}}/></PhoneShell>}

function PhoneBookingContextSummary(props:ExperienceBlockRendererProps){const b=phoneRows(props),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],fields=[["主题",phoneField(props,"titleFieldRef")],["开始",phoneField(props,"startFieldRef")],["结束",phoneField(props,"endFieldRef")],["时区",phoneField(props,"timezoneFieldRef")],["地点",phoneField(props,"locationFieldRef")],["参与人",phoneField(props,"attendeeFieldRef")],["重复规则",phoneField(props,"recurringFieldRef")]] as const;if(!b||!r||!fields[0][1]||!fields[1][1])return <PhoneShell block={props.block} title={titleOf(props)||"预约上下文"} testid="phone-booking-context-summary"><MobileEmpty description="预约上下文尚未绑定标题和开始时间"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"预约上下文"} testid="phone-booking-context-summary"><List mode="card" style={{margin:0}}>{fields.flatMap(([l,f])=>f?[<List.Item key={l} extra={<span style={{maxWidth:150,textAlign:"right",overflowWrap:"anywhere"}}>{String(r.values?.[f]??"-")}</span>}>{l}</List.Item>]:[])}</List></PhoneShell>}

function PhoneAlertInstanceSummary(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),value=phoneField(props,"valueFieldRef"),labels=phoneField(props,"labelsFieldRef"),summary=phoneField(props,"summaryFieldRef"),started=phoneField(props,"startedFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!name||!value||!r)return <PhoneShell block={props.block} title={titleOf(props)||"告警实例"} testid="phone-alert-instance-summary"><MobileEmpty description="告警实例摘要尚未绑定名称和当前值"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"告警实例"} testid="phone-alert-instance-summary"><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{String(r.values?.[name]??"")}</strong><span style={{color:"#ff3141"}}>{String(r.values?.[value]??"")}</span></div>{summary&&<div style={{marginTop:8}}>{String(r.values?.[summary]??"")}</div>}{labels&&<div style={{fontSize:12,color:"#666",overflowWrap:"anywhere",marginTop:8}}>{String(r.values?.[labels]??"")}</div>}{started&&<div style={{fontSize:12,color:"#999",marginTop:6}}>开始于 {String(r.values?.[started]??"")}</div>}</PhoneShell>}

function PhoneBookingStatusTabs(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),key=phoneField(props,"keyFieldRef"),count=phoneField(props,"countFieldRef"),enabled=phoneField(props,"enabledFieldRef");const[active,setActive]=React.useState(String(props.block.props?.defaultKey??"upcoming"));if(!b||!t||!key)return <PhoneShell block={props.block} testid="phone-booking-status-tabs"><MobileEmpty description="预约页签尚未绑定标题和状态键"/></PhoneShell>;const selected=b.rows.some(x=>String(x.values?.[key])===active)?active:String(b.rows[0]?.values?.[key]??"");return <PhoneShell block={props.block} testid="phone-booking-status-tabs"><Tabs activeKey={selected} onChange={v=>{setActive(v);const r=b.rows.find(x=>String(x.values?.[key])===v);props.onAction?.("filterChange",{entityRef:b.entityRef,rowId:r?.id,statusKey:v,preserveExistingFilters:true,targets:phoneTargets(props)})}}>{b.rows.map(r=><Tabs.Tab key={String(r.values?.[key])} title={`${String(r.values?.[t]??"")}${count?` ${String(r.values?.[count]??0)}`:""}`} disabled={Boolean(enabled&&[false,"false","disabled"].includes(r.values?.[enabled] as never))}/>)}</Tabs></PhoneShell>}

function PhoneValidatedFormTabs(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),key=phoneField(props,"keyFieldRef"),err=phoneField(props,"errorCountFieldRef"),dirty=phoneField(props,"dirtyCountFieldRef");const[active,setActive]=React.useState("");if(!b||!t||!key||!err)return <PhoneShell block={props.block} testid="phone-validated-form-tabs"><MobileEmpty description="表单页签尚未绑定标题、键和错误数"/></PhoneShell>;const selected=b.rows.some(x=>String(x.values?.[key])===active)?active:String(b.rows[0]?.values?.[key]??"");return <PhoneShell block={props.block} testid="phone-validated-form-tabs"><Tabs activeKey={selected} onChange={v=>{setActive(v);const r=b.rows.find(x=>String(x.values?.[key])===v);props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r?.id,tabKey:v,targets:phoneTargets(props)})}}>{b.rows.map(r=>{const e=Number(r.values?.[err]??0),d=dirty?Number(r.values?.[dirty]??0):0;return <Tabs.Tab key={String(r.values?.[key])} title={`${String(r.values?.[t]??"")}${e?` 错误${e}`:d?` ${d}`:""}`}/>})}</Tabs></PhoneShell>}

function PhoneAlertMatcherFilter(props:ExperienceBlockRendererProps){const[q,setQ]=React.useState(String(props.block.props?.defaultQuery??"")),trim=q.trim().replace(/^\{|\}$/g,""),parts=trim?trim.split(",").map(x=>x.trim()):[],valid=!trim||parts.every(x=>/^[A-Za-z_][\w.-]*\s*(=~|!~|!=|=)\s*"[^"]*"$/.test(x)&&!/[=!~]\s+"/.test(x));return <PhoneShell block={props.block} title={titleOf(props)||"标签匹配"} testid="phone-alert-matcher-filter"><Input value={q} onChange={setQ} placeholder={'severity="critical"'} style={{padding:10,background:"#f5f5f5",borderRadius:6}}/>{!valid&&<div style={{color:"#ff3141",fontSize:12,marginTop:6}}>表达式无效，值必须使用双引号</div>}<Button block color="primary" disabled={!valid} style={{marginTop:8}} onClick={()=>props.onAction?.("filterChange",{matcherQuery:trim,matchers:parts,targets:phoneTargets(props)})}>应用标签匹配</Button></PhoneShell>}

function PhoneBookingDirectoryFilter(props:ExperienceBlockRendererProps){const b=phoneRows(props),type=phoneField(props,"typeFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef"),[selected,setSelected]=React.useState<Record<string,string[]>>({}),[query,setQuery]=React.useState(""),[range,setRange]=React.useState<[Date,Date]|null>(null),[calendar,setCalendar]=React.useState(false);if(!b||!type||!key||!title)return <PhoneShell block={props.block} title={titleOf(props)||"预约目录筛选"} testid="phone-booking-directory-filter"><MobileEmpty description="预约目录筛选尚未绑定类型、键和标题"/></PhoneShell>;const types=Array.from(new Set(b.rows.map(x=>String(x.values?.[type]??"")).filter(Boolean))),emit=(next:Record<string,unknown>)=>props.onAction?.("filterChange",{facets:selected,attendeeQuery:query.trim(),dateRange:range?.map(x=>x.toISOString().slice(0,10))??null,...next,targets:phoneTargets(props)});return <PhoneShell block={props.block} title={titleOf(props)||"预约目录筛选"} testid="phone-booking-directory-filter">{types.map(v=><div key={v} style={{marginBottom:8}}><small>{v}</small><Selector columns={2} multiple value={selected[v]??[]} options={b.rows.filter(x=>String(x.values?.[type])===v).map(x=>({value:String(x.values?.[key]),label:String(x.values?.[title])}))} onChange={vals=>{const next={...selected,[v]:vals.map(String)};setSelected(next);emit({facets:next})}}/></div>)}<SearchBar value={query} onChange={setQuery} onSearch={v=>emit({attendeeQuery:v.trim()})} placeholder="姓名、邮箱或预约 UID"/><Button block style={{marginTop:8}} onClick={()=>setCalendar(true)}>{range?`${range[0].toISOString().slice(5,10)} 至 ${range[1].toISOString().slice(5,10)}`:"选择日期范围"}</Button><CalendarPicker visible={calendar} selectionMode="range" value={range} onClose={()=>setCalendar(false)} onConfirm={v=>{const next=v?.[0]&&v?.[1]?[v[0],v[1]] as [Date,Date]:null;setRange(next);setCalendar(false);emit({dateRange:next?.map(x=>x.toISOString().slice(0,10))??null})}}/></PhoneShell>}

function PhoneBookingDecisionBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"statusFieldRef"),paidRef=phoneField(props,"paidFieldRef"),rec=phoneField(props,"recurringFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[open,setOpen]=React.useState(false),[reason,setReason]=React.useState("");if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-booking-decision-bar"><MobileEmpty description="预约决策栏尚未绑定标题和状态"/></PhoneShell>;const pending=String(r.values?.[s])==="PENDING",paid=!paidRef||phoneTruthy(r.values?.[paidRef],"paid"),scope=rec&&phoneTruthy(r.values?.[rec],"recurring")?"series":"single",submit=(decision:string,extra={})=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,decision,scope,...extra,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-booking-decision-bar"><div style={{marginBottom:8}}><strong>{String(r.values?.[t]??"预约")}</strong><span style={{color:"#666"}}> · {pending?"待确认":"已处理"}</span></div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!pending} onClick={()=>setOpen(true)}>拒绝</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!pending||!paid} onClick={()=>submit("confirm")}>确认</Button></Grid.Item></Grid><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:16}}><strong>填写拒绝原因</strong><TextArea value={reason} onChange={setReason} rows={3} style={{margin:"10px 0"}}/><Button block color="danger" disabled={!reason.trim()} onClick={()=>{submit("reject",{reason:reason.trim()});setOpen(false)}}>确认拒绝</Button></Popup></PhoneShell>}

function PhoneDashboardSaveBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),dirtyRef=phoneField(props,"dirtyFieldRef"),canRef=phoneField(props,"canSaveFieldRef"),managedRef=phoneField(props,"managedFieldRef"),templateRef=phoneField(props,"templateFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[more,setMore]=React.useState(false);if(!b||!t||!dirtyRef||!r)return <PhoneShell block={props.block} testid="phone-dashboard-save-bar"><MobileEmpty description="Dashboard 保存栏尚未绑定标题和脏状态"/></PhoneShell>;const dirty=phoneTruthy(r.values?.[dirtyRef],"dirty"),can=!canRef||!([false,"false","denied"].includes(r.values?.[canRef] as never)),managed=Boolean(managedRef&&phoneTruthy(r.values?.[managedRef],"managed")),template=Boolean(templateRef&&phoneTruthy(r.values?.[templateRef],"template")),act=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-dashboard-save-bar"><div style={{marginBottom:8}}><strong>{String(r.values?.[t]??"Dashboard")}</strong><div style={{fontSize:12,color:dirty?"#ff8f1f":"#999"}}>{dirty?"有未保存修改":"所有修改已保存"}{managed?" · 受管":""}</div></div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={managed} onClick={()=>setMore(true)}>更多</Button></Grid.Item><Grid.Item><Button block color={dirty?"primary":"default"} disabled={!can||managed} onClick={()=>act("saveDashboard")}>保存</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={()=>setMore(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("saveDashboardCopy")}>另存为副本</Button><Button block disabled={!template} onClick={()=>act("saveDashboardTemplate")}>另存为模板</Button></Space></Popup></PhoneShell>}

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
    case "AttachmentPanel":
      return <PhoneAttachmentPanel {...props} />;
    case "CommentThread":
      return <PhoneCommentThread {...props} />;
    case "RecordPicker":
      return <PhoneRecordPicker {...props} />;
    case "KanbanBoard":
      return <PhoneKanbanBoard {...props} />;
    case "ScheduleCalendar":
      return <PhoneScheduleCalendar {...props} />;
    case "NotificationInbox":
      return <PhoneNotificationInbox {...props} />;
    case "TreeNavigator":
      return <PhoneTreeNavigator {...props} />;
    case "ApprovalQueue":
      return <PhoneApprovalQueue {...props} />;
    case "AuditTrail":
      return <PhoneAuditTrail {...props} />;
    case "DataImportWizard":
      return <PhoneDataImportWizard {...props} />;
    case "AsyncTaskMonitor":
      return <PhoneAsyncTaskMonitor {...props} />;
    case "PermissionMatrix":
      return <PhonePermissionMatrix {...props} />;
    case "DataExportPanel":
      return <PhoneDataExportPanel {...props} />;
    case "BulkEditPanel":
      return <PhoneBulkEditPanel {...props} />;
    case "MemberAssignment":
      return <PhoneMemberAssignment {...props} />;
    case "ContextBreadcrumb": return <PhoneContextBreadcrumb {...props} />;
    case "LiveRefreshControl": return <PhoneLiveRefreshControl {...props} />;
    case "ActiveFilterSummary": return <PhoneActiveFilterSummary {...props} />;
    case "AnalyticsDateScope": return <PhoneAnalyticsDateScope {...props} />;
    case "HeaderEntitySummary": return <PhoneHeaderEntitySummary {...props} />;
    case "HeaderProgressSummary": return <PhoneHeaderProgressSummary {...props} />;
    case "WorkspaceTabs": return <PhoneWorkspaceTabs {...props} />;
    case "SavedViewTabs": return <PhoneSavedViewTabs {...props} />;
    case "AdvancedFilterBuilder": return <PhoneAdvancedFilterBuilder {...props} />;
    case "FacetedFilterPanel": return <PhoneFacetedFilterPanel {...props} />;
    case "WizardNavigationBar": return <PhoneWizardNavigationBar {...props} />;
    case "ApprovalDecisionBar": return <PhoneApprovalDecisionBar {...props} />;
    case "CheckoutSummaryBar": return <PhoneCheckoutSummaryBar {...props} />;
    case "RecordLifecycleBar": return <PhoneRecordLifecycleBar {...props} />;
    case "WaterfallChart": return <PhoneWaterfallChart {...props} />;
    case "FunnelChart": return <PhoneFunnelChart {...props} />;
    case "DistributionHistogram": return <PhoneDistributionHistogram {...props} />;
    case "HeatmapMatrix": return <PhoneHeatmapMatrix {...props} />;
    case "TreemapBreakdown": return <PhoneTreemapBreakdown {...props} />;
    case "GaugeProgress": return <PhoneGaugeProgress {...props} />;
    case "AlertTriagePanel": return <PhoneAlertTriagePanel {...props} />;
    case "AlertSilenceForm": return <PhoneAlertSilenceForm {...props} />;
    case "AlertRoutingPolicy": return <PhoneAlertRoutingPolicy {...props} />;
    case "DeletedRecordsRecovery": return <PhoneDeletedRecordsRecovery {...props} />;
    case "RevisionHistoryPanel": return <PhoneRevisionHistoryPanel {...props} />;
    case "RecordComparePanel": return <PhoneRecordComparePanel {...props} />;
    case "GanttSchedule": return <PhoneGanttSchedule {...props} />;
    case "SankeyFlow": return <PhoneSankeyFlow {...props} />;
    case "BoxPlotDistribution": return <PhoneBoxPlotDistribution {...props} />;
    case "RadarComparison": return <PhoneRadarComparison {...props} />;
    case "AlertRuleEditor": return <PhoneAlertRuleEditor {...props} />;
    case "MuteTimingSchedule": return <PhoneMuteTimingSchedule {...props} />;
    case "ContactPointManager": return <PhoneContactPointManager {...props} />;
    case "ReferenceManyManager": return <PhoneReferenceManyManager {...props} />;
    case "GlobalSearchPalette": return <PhoneGlobalSearchPalette {...props} />;
    case "LiveChangeReview": return <PhoneLiveChangeReview {...props} />;
    case "AvailabilityPlanner": return <PhoneAvailabilityPlanner {...props} />;
    case "BookingSlotPicker": return <PhoneBookingSlotPicker {...props} />;
    case "ScheduleConflictResolver": return <PhoneScheduleConflictResolver {...props} />;
    case "StackTracePanel": return <PhoneStackTracePanel {...props} />;
    case "EventBreadcrumbTimeline": return <PhoneEventBreadcrumbTimeline {...props} />;
    case "SuspectCommitPanel": return <PhoneSuspectCommitPanel {...props} />;
    case "ConnectionTimeline": return <PhoneConnectionTimeline {...props} />;
    case "SchemaChangeReview": return <PhoneSchemaChangeReview {...props} />;
    case "StreamStatusMonitor": return <PhoneStreamStatusMonitor {...props} />;
    case "ConnectionMappingPanel": return <PhoneConnectionMappingPanel {...props} />;
    case "IssueCommandHeader": return <PhoneIssueCommandHeader {...props} />;
    case "ConnectionControlHeader": return <PhoneConnectionControlHeader {...props} />;
    case "EventUserCountMetrics": return <PhoneEventUserCountMetrics {...props} />;
    case "JobRunMetrics": return <PhoneJobRunMetrics {...props} />;
    case "OccurrenceEvidenceSummary": return <PhoneOccurrenceEvidenceSummary {...props} />;
    case "ConnectionRouteSummary": return <PhoneConnectionRouteSummary {...props} />;
    case "ResourceDetailTabs": return <PhoneResourceDetailTabs {...props} />;
    case "InspectorModeTabs": return <PhoneInspectorModeTabs {...props} />;
    case "IssueEventFilter": return <PhoneIssueEventFilter {...props} />;
    case "TimelineFilterBar": return <PhoneTimelineFilterBar {...props} />;
    case "UnsavedChangesBar": return <PhoneUnsavedChangesBar {...props} />;
    case "RunningJobControlBar": return <PhoneRunningJobControlBar {...props} />;
    case "BookingCommandHeader": return <PhoneBookingCommandHeader {...props} />;
    case "AlertRuleCommandHeader": return <PhoneAlertRuleCommandHeader {...props} />;
    case "AlertStateMetrics": return <PhoneAlertStateMetrics {...props} />;
    case "BookingCapacityMetrics": return <PhoneBookingCapacityMetrics {...props} />;
    case "BookingContextSummary": return <PhoneBookingContextSummary {...props} />;
    case "AlertInstanceSummary": return <PhoneAlertInstanceSummary {...props} />;
    case "BookingStatusTabs": return <PhoneBookingStatusTabs {...props} />;
    case "ValidatedFormTabs": return <PhoneValidatedFormTabs {...props} />;
    case "AlertMatcherFilter": return <PhoneAlertMatcherFilter {...props} />;
    case "BookingDirectoryFilter": return <PhoneBookingDirectoryFilter {...props} />;
    case "BookingDecisionBar": return <PhoneBookingDecisionBar {...props} />;
    case "DashboardSaveBar": return <PhoneDashboardSaveBar {...props} />;
    default:
      return null;
  }
}
