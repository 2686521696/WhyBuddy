import React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Flex,
  Input,
  InputNumber,
  List,
  Progress,
  Radio,
  Result,
  Segmented,
  Select,
  Space,
  Splitter,
  Steps,
  Switch,
  Tag,
  Timeline,
  Tree,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type {
  ExperienceBlockRenderer,
  ExperienceBlockRendererProps,
} from "./block-registry";

type Row = NonNullable<
  ExperienceBlockRendererProps["entityRows"]
>[string][number];
const field = (p: ExperienceBlockRendererProps, key: string) =>
  String(p.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") =>
  String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) =>
  Number(row.values?.[ref] ?? fallback);
const truthy = (row: Row, ref: string) =>
  /true|yes|enabled|active|approved|valid|success|healthy|synced|1/i.test(
    value(row, ref)
  );
const targets = (p: ExperienceBlockRendererProps) =>
  Array.isArray(p.block.binding?.targets)
    ? p.block.binding.targets.map(String)
    : [];
const bound = (p: ExperienceBlockRendererProps) => {
  const entityRef = field(p, "entityRef"),
    rows = entityRef ? p.entityRows?.[entityRef] : undefined;
  return entityRef && rows?.length ? { entityRef, rows } : undefined;
};
const shell = (
  p: ExperienceBlockRendererProps,
  id: string,
  title: string,
  children: React.ReactNode
) =>
  p.block.props?.surface === "plain" ? (
    <section data-testid={id} style={{ paddingBottom: 120 }}>
      {children}
    </section>
  ) : (
    <Card
      size="small"
      title={String(p.block.props?.title ?? title)}
      data-testid={id}
    >
      {children}
    </Card>
  );
const missing = (p: ExperienceBlockRendererProps, id: string, title: string) =>
  shell(
    p,
    id,
    title,
    <Alert type="info" showIcon message="区块尚未绑定所需数据" />
  );

export const authenticationFlowCanSave = (
  executions: Array<{ parent: string; priority: number; requirement: string }>
) =>
  executions.length > 0 &&
  executions.some(item => !/disabled/i.test(item.requirement)) &&
  executions.every(
    (item, index) =>
      Number.isInteger(item.priority) &&
      !executions.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.parent === item.parent &&
          other.priority === item.priority
      )
  );
export const filterScopesValid = (
  selectedFilterIds: string[],
  scopes: Record<string, string[]>
) =>
  selectedFilterIds.length > 0 &&
  selectedFilterIds.every(id =>
    (scopes[id] ?? []).some(target => target !== id)
  );
export const fulfillmentAllocationValid = (
  lines: Array<{
    lineId: string;
    ordered: number;
    allocations: Array<{ warehouseId: string; quantity: number }>;
  }>,
  allowExceed = false
) =>
  lines.length > 0 &&
  lines.some(line => line.allocations.some(a => a.quantity > 0)) &&
  lines.every(line => {
    const active = line.allocations.filter(a => a.quantity > 0),
      total = active.reduce((sum, a) => sum + a.quantity, 0);
    return (
      new Set(active.map(a => a.warehouseId)).size === active.length &&
      (allowExceed || total <= line.ordered)
    );
  });
export const alertExpressionPipelineValid = (
  nodes: Array<{
    refId: string;
    inputRef: string;
    condition: boolean;
    error?: boolean;
  }>
) =>
  nodes.length > 0 &&
  new Set(nodes.map(n => n.refId)).size === nodes.length &&
  nodes.filter(n => n.condition).length === 1 &&
  nodes.every(
    (node, index) =>
      !node.error &&
      node.inputRef !== node.refId &&
      (!node.inputRef ||
        nodes.slice(0, index).some(prev => prev.refId === node.inputRef))
  );
export const syncWaveCanAdvance = (
  waves: Array<{ phase: string; wave: number; status: string }>,
  targetWave: number
) =>
  waves
    .filter(item => item.wave < targetWave)
    .every(item => /synced|healthy|success|skipped/i.test(item.status)) &&
  !waves.some(
    item =>
      item.wave <= targetWave && /failed|degraded|unhealthy/i.test(item.status)
  );
export const scaffolderTaskActions = (status: string) => ({
  canCancel: !/completed|cancelled|failed/i.test(status),
  canRetry: /failed/i.test(status),
  showLogs: /completed|failed/i.test(status),
});
export const scaffolderTaskStatus = (statuses: string[]) => {
  if (statuses.some(status => /failed|error/i.test(status))) return "failed";
  if (statuses.some(status => /cancelled/i.test(status))) return "cancelled";
  if (statuses.some(status => /processing|running|open/i.test(status)))
    return "running";
  if (
    statuses.length > 0 &&
    statuses.every(status => /completed|success|skipped/i.test(status))
  )
    return "completed";
  return "pending";
};

export const AuthenticationFlowExecutionTreeRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      nameRef = field(p, "executionNameFieldRef"),
      parentRef = field(p, "parentExecutionFieldRef"),
      requirementRef = field(p, "requirementFieldRef"),
      priorityRef = field(p, "priorityFieldRef"),
      configurableRef = field(p, "configurableFieldRef"),
      [requirements, setRequirements] = React.useState<Record<string, string>>(
        {}
      ),
      [priorities, setPriorities] = React.useState<Record<string, number>>({});
    if (!b || !nameRef || !parentRef || !requirementRef || !priorityRef)
      return missing(p, "authentication-flow-execution-tree", "认证流程执行树");
    const execution = (row: Row) => ({
        parent: value(row, parentRef),
        priority: priorities[row.id] ?? numeric(row, priorityRef),
        requirement: requirements[row.id] ?? value(row, requirementRef),
      }),
      draft = b.rows.map(execution),
      valid = authenticationFlowCanSave(draft),
      children = (parent: string): any[] =>
        b.rows
          .filter(row => value(row, parentRef) === parent)
          .sort((a, c) => execution(a).priority - execution(c).priority)
          .map(row => ({
            key: row.id,
            title: (
              <Flex
                align="center"
                justify="space-between"
                gap={8}
                style={{ width: "100%" }}
              >
                <Space>
                  <Badge
                    status={
                      /disabled/i.test(execution(row).requirement)
                        ? "default"
                        : "processing"
                    }
                  />
                  <Typography.Text strong>
                    {value(row, nameRef)}
                  </Typography.Text>
                  {truthy(row, configurableRef) && (
                    <Tag color="blue">可配置</Tag>
                  )}
                </Space>
                <Space>
                  <InputNumber
                    size="small"
                    min={0}
                    value={execution(row).priority}
                    onChange={n =>
                      setPriorities(prev => ({
                        ...prev,
                        [row.id]: Number(n ?? 0),
                      }))
                    }
                    style={{ width: 64 }}
                  />
                  <Select
                    size="small"
                    value={execution(row).requirement}
                    onChange={v =>
                      setRequirements(prev => ({ ...prev, [row.id]: v }))
                    }
                    style={{ width: 118 }}
                    options={[
                      "REQUIRED",
                      "ALTERNATIVE",
                      "CONDITIONAL",
                      "DISABLED",
                    ].map(v => ({ value: v, label: v }))}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Space>
              </Flex>
            ),
            children: children(row.id),
          }));
    return shell(
      p,
      "authentication-flow-execution-tree",
      "认证流程执行树",
      <Flex vertical gap={12}>
        <Flex justify="space-between" align="center">
          <Segmented options={["流程图", "执行列表"]} />
          <Space>
            <Button icon={<PlusOutlined />}>添加步骤</Button>
            <Button icon={<ApartmentOutlined />}>添加子流程</Button>
          </Space>
        </Flex>
        <Card size="small">
          <Tree blockNode showLine defaultExpandAll treeData={children("")} />
        </Card>
        <Alert
          type={valid ? "success" : "error"}
          showIcon
          message={
            valid
              ? "执行优先级和要求配置有效"
              : "同级执行优先级重复，或全部执行均被禁用"
          }
        />
        <Button
          type="primary"
          disabled={!valid}
          onClick={() =>
            p.onAction?.("submitRequest", {
              entityRef: b.entityRef,
              executions: draft,
              operation: "saveAuthenticationFlow",
              targets: targets(p),
            })
          }
        >
          保存认证流程
        </Button>
      </Flex>
    );
  };

export const DashboardFilterScopeMapperRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      kindRef = field(p, "nodeKindFieldRef"),
      labelRef = field(p, "nodeLabelFieldRef"),
      parentRef = field(p, "parentNodeFieldRef"),
      filterRef = field(p, "filterFieldRef"),
      [selectedFilters, setSelectedFilters] = React.useState<string[]>([]),
      [activeFilter, setActiveFilter] = React.useState(""),
      [scopes, setScopes] = React.useState<Record<string, string[]>>({});
    if (!b || !kindRef || !labelRef || !parentRef || !filterRef)
      return missing(
        p,
        "dashboard-filter-scope-mapper",
        "仪表盘筛选作用域映射器"
      );
    const filters = b.rows.filter(row => /filter/i.test(value(row, kindRef))),
      charts = b.rows.filter(row => /chart|panel/i.test(value(row, kindRef))),
      active = activeFilter || filters[0]?.id || "",
      selected = selectedFilters.length
        ? selectedFilters
        : active
          ? [active]
          : [],
      checked =
        scopes[active] ??
        charts
          .filter(
            row => value(row, filterRef) === active || truthy(row, filterRef)
          )
          .map(row => row.id),
      tree = (parent: string): any[] =>
        b.rows
          .filter(
            row =>
              value(row, parentRef) === parent &&
              !/filter/i.test(value(row, kindRef))
          )
          .map(row => ({
            key: row.id,
            title: (
              <Space>
                <DeploymentUnitOutlined />
                <span>{value(row, labelRef)}</span>
                <Tag>{value(row, kindRef)}</Tag>
              </Space>
            ),
            children: tree(row.id),
            disableCheckbox: row.id === active,
          })),
      valid = filterScopesValid(
        selected,
        Object.fromEntries(selected.map(id => [id, scopes[id] ?? checked]))
      );
    return shell(
      p,
      "dashboard-filter-scope-mapper",
      "仪表盘筛选作用域映射器",
      <>
        <Splitter>
          <Splitter.Panel defaultSize="38%" min="28%">
            <Card
              size="small"
              title="筛选字段"
              extra={<Badge count={selected.length} showZero />}
            >
              <Checkbox.Group
                value={selected}
                onChange={ids => {
                  const next = ids.map(String);
                  setSelectedFilters(next);
                  if (!next.includes(active)) setActiveFilter(next[0] ?? "");
                }}
                style={{ width: "100%" }}
              >
                <Flex vertical gap={8}>
                  {filters.map(row => (
                    <Card
                      key={row.id}
                      size="small"
                      onClick={() => setActiveFilter(row.id)}
                      styles={{
                        body: {
                          padding: 8,
                          background:
                            row.id === active
                              ? "var(--ant-color-primary-bg)"
                              : undefined,
                        },
                      }}
                    >
                      <Checkbox value={row.id}>{value(row, labelRef)}</Checkbox>
                      <Typography.Text
                        type="secondary"
                        style={{ float: "right" }}
                      >
                        {(scopes[row.id] ?? []).length || "默认"}
                      </Typography.Text>
                    </Card>
                  ))}
                </Flex>
              </Checkbox.Group>
            </Card>
          </Splitter.Panel>
          <Splitter.Panel>
            <Card
              size="small"
              title={`作用范围 · ${value(filters.find(row => row.id === active) ?? filters[0], labelRef)}`}
            >
              <Input.Search
                placeholder="搜索页面、标签页或图表"
                style={{ marginBottom: 10 }}
              />
              <Tree
                checkable
                blockNode
                defaultExpandAll
                checkedKeys={checked}
                onCheck={keys =>
                  setScopes(prev => ({
                    ...prev,
                    [active]: (Array.isArray(keys) ? keys : keys.checked).map(
                      String
                    ),
                  }))
                }
                treeData={tree("")}
              />
            </Card>
          </Splitter.Panel>
        </Splitter>
        <Flex justify="space-between" align="center" style={{ marginTop: 12 }}>
          <Alert
            type={valid ? "info" : "warning"}
            showIcon
            message={
              valid
                ? "每个已选筛选器都有至少一个图表作用目标"
                : "存在没有作用目标的筛选器"
            }
          />
          <Button
            type="primary"
            disabled={!valid}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                scopes,
                operation: "saveDashboardFilterScopes",
                targets: targets(p),
              })
            }
          >
            保存作用域
          </Button>
        </Flex>
      </>
    );
  };

export const OrderFulfillmentAllocationComposerRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      lineRef = field(p, "orderLineFieldRef"),
      productRef = field(p, "productFieldRef"),
      orderedRef = field(p, "orderedQuantityFieldRef"),
      warehouseRef = field(p, "warehouseFieldRef"),
      availableRef = field(p, "availableQuantityFieldRef"),
      preorderRef = field(p, "preorderFieldRef"),
      [drafts, setDrafts] = React.useState<Record<string, number>>({}),
      [allowExceed, setAllowExceed] = React.useState(false),
      [notify, setNotify] = React.useState(true),
      [tracking, setTracking] = React.useState("");
    if (
      !b ||
      !lineRef ||
      !productRef ||
      !orderedRef ||
      !warehouseRef ||
      !availableRef
    )
      return missing(
        p,
        "order-fulfillment-allocation-composer",
        "订单履约拆分编排器"
      );
    const lineIds = [...new Set(b.rows.map(row => value(row, lineRef)))],
      lines = lineIds.map(lineId => {
        const rows = b.rows.filter(row => value(row, lineRef) === lineId),
          ordered = numeric(rows[0], orderedRef),
          allocations = rows.map(row => ({
            warehouseId: value(row, warehouseRef),
            quantity: drafts[row.id] ?? 0,
          }));
        return { lineId, rows, ordered, allocations };
      }),
      valid =
        fulfillmentAllocationValid(lines, allowExceed) &&
        !b.rows.some(
          row => truthy(row, preorderRef) && (drafts[row.id] ?? 0) > 0
        );
    return shell(
      p,
      "order-fulfillment-allocation-composer",
      "订单履约拆分编排器",
      <Flex vertical gap={12}>
        {lines.map(line => {
          const allocated = line.allocations.reduce(
            (sum, item) => sum + item.quantity,
            0
          );
          return (
            <Card
              key={line.lineId}
              size="small"
              title={value(line.rows[0], productRef)}
              extra={
                <Typography.Text>
                  {allocated}/{line.ordered}
                </Typography.Text>
              }
            >
              <Progress
                percent={
                  line.ordered
                    ? Math.min(100, (allocated / line.ordered) * 100)
                    : 0
                }
                status={allocated > line.ordered ? "exception" : undefined}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                  gap: 8,
                }}
              >
                {line.rows.map(row => (
                  <Card
                    key={row.id}
                    size="small"
                    styles={{ body: { padding: 9 } }}
                  >
                    <Flex justify="space-between">
                      <Typography.Text strong>
                        {value(row, warehouseRef)}
                      </Typography.Text>
                      <Tag
                        color={
                          numeric(row, availableRef) > 0 ? "success" : "default"
                        }
                      >
                        可用 {numeric(row, availableRef)}
                      </Tag>
                    </Flex>
                    <InputNumber
                      min={0}
                      max={allowExceed ? undefined : numeric(row, availableRef)}
                      value={drafts[row.id] ?? 0}
                      onChange={n =>
                        setDrafts(prev => ({
                          ...prev,
                          [row.id]: Number(n ?? 0),
                        }))
                      }
                      style={{ width: "100%", marginTop: 8 }}
                      disabled={truthy(row, preorderRef)}
                    />
                  </Card>
                ))}
              </div>
            </Card>
          );
        })}
        <Card size="small" title="发货设置">
          <Flex gap={12} wrap align="center">
            <Input
              value={tracking}
              onChange={e => setTracking(e.target.value)}
              placeholder="物流追踪号（可选）"
              style={{ flex: 1, minWidth: 180 }}
            />
            <Checkbox
              checked={notify}
              onChange={e => setNotify(e.target.checked)}
            >
              通知客户
            </Checkbox>
            <Space>
              <Switch checked={allowExceed} onChange={setAllowExceed} />
              <Typography.Text>允许超库存</Typography.Text>
            </Space>
          </Flex>
        </Card>
        <Flex justify="space-between" align="center">
          <Alert
            type={valid ? "success" : "warning"}
            showIcon
            message={
              valid
                ? "履约分配有效"
                : "数量为零、超过订单数量、仓库重复或包含预售商品"
            }
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!valid}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                lines,
                notifyCustomer: notify,
                trackingNumber: tracking,
                allowStockToBeExceeded: allowExceed,
                operation: "createOrderFulfillments",
                targets: targets(p),
              })
            }
          >
            创建履约单
          </Button>
        </Flex>
      </Flex>
    );
  };

export const AlertExpressionPipelineBuilderRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      refRef = field(p, "refIdFieldRef"),
      kindRef = field(p, "expressionKindFieldRef"),
      inputRef = field(p, "inputRefFieldRef"),
      formulaRef = field(p, "formulaFieldRef"),
      statusRef = field(p, "previewStatusFieldRef"),
      [condition, setCondition] = React.useState(""),
      [formulas, setFormulas] = React.useState<Record<string, string>>({});
    if (!b || !refRef || !kindRef || !inputRef || !formulaRef || !statusRef)
      return missing(
        p,
        "alert-expression-pipeline-builder",
        "告警表达式流水线构建器"
      );
    const nodes = b.rows.map(row => ({
        refId: value(row, refRef),
        inputRef: value(row, inputRef),
        condition: (condition || b.rows[b.rows.length - 1].id) === row.id,
        error: /error|failed/i.test(value(row, statusRef)),
      })),
      valid = alertExpressionPipelineValid(nodes);
    return shell(
      p,
      "alert-expression-pipeline-builder",
      "告警表达式流水线构建器",
      <Flex vertical gap={12}>
        <Flex gap={8} align="stretch" wrap>
          {b.rows.map((row, index) => (
            <React.Fragment key={row.id}>
              <Card
                size="small"
                style={{
                  flex: "1 1 170px",
                  borderTop: `3px solid ${nodes[index].error ? "var(--ant-color-error)" : nodes[index].condition ? "var(--ant-color-primary)" : "var(--ant-color-success)"}`,
                }}
                title={
                  <Space>
                    <Tag color="blue">{value(row, refRef)}</Tag>
                    <span>{value(row, kindRef)}</span>
                  </Space>
                }
                extra={
                  <Radio
                    checked={nodes[index].condition}
                    onChange={() => setCondition(row.id)}
                  >
                    条件
                  </Radio>
                }
              >
                <Select
                  size="small"
                  value={value(row, inputRef) || undefined}
                  placeholder="输入引用"
                  style={{ width: "100%" }}
                  options={b.rows.slice(0, index).map(prev => ({
                    value: value(prev, refRef),
                    label: value(prev, refRef),
                  }))}
                />
                <Input
                  value={formulas[row.id] ?? value(row, formulaRef)}
                  onChange={e =>
                    setFormulas(prev => ({ ...prev, [row.id]: e.target.value }))
                  }
                  prefix={<CodeOutlined />}
                  style={{ marginTop: 8 }}
                />
                <Flex justify="space-between" style={{ marginTop: 8 }}>
                  <Badge
                    status={nodes[index].error ? "error" : "success"}
                    text={value(row, statusRef)}
                  />
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                  />
                </Flex>
              </Card>
              {index < b.rows.length - 1 && (
                <ArrowRightOutlined
                  style={{
                    alignSelf: "center",
                    color: "var(--ant-color-text-tertiary)",
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </Flex>
        <Button type="dashed" block icon={<PlusOutlined />}>
          添加表达式
        </Button>
        <Flex justify="space-between" align="center">
          <Alert
            type={valid ? "success" : "error"}
            showIcon
            message={
              valid
                ? "引用链完整，且唯一告警条件预览通过"
                : "存在重复引用、自引用、前向引用、多个条件或预览错误"
            }
          />
          <Button
            type="primary"
            disabled={!valid}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                formulas,
                conditionRefId: nodes.find(n => n.condition)?.refId,
                operation: "saveAlertExpressionPipeline",
                targets: targets(p),
              })
            }
          >
            保存表达式链
          </Button>
        </Flex>
      </Flex>
    );
  };

export const SyncWaveResourceSequencerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p),
    resourceRef = field(p, "resourceNameFieldRef"),
    phaseRef = field(p, "phaseFieldRef"),
    waveRef = field(p, "waveFieldRef"),
    kindRef = field(p, "resourceKindFieldRef"),
    statusRef = field(p, "syncStatusFieldRef"),
    [mode, setMode] = React.useState("apply"),
    [selectedWave, setSelectedWave] = React.useState(0);
  if (!b || !resourceRef || !phaseRef || !waveRef || !kindRef || !statusRef)
    return missing(p, "sync-wave-resource-sequencer", "同步波次资源编排器");
  const phases = ["PreSync", "Sync", "PostSync"],
    waves = [...new Set(b.rows.map(row => numeric(row, waveRef)))].sort(
      (a, c) => (mode === "apply" ? a - c : c - a)
    ),
    states = b.rows.map(row => ({
      phase: value(row, phaseRef),
      wave: numeric(row, waveRef),
      status: value(row, statusRef),
    })),
    canAdvance = syncWaveCanAdvance(states, selectedWave);
  return shell(
    p,
    "sync-wave-resource-sequencer",
    "同步波次资源编排器",
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center">
        <Segmented
          value={mode}
          onChange={v => setMode(String(v))}
          options={[
            { label: "应用顺序", value: "apply", icon: <CloudSyncOutlined /> },
            { label: "删除顺序", value: "prune", icon: <DeleteOutlined /> },
          ]}
        />
        <Typography.Text type="secondary">
          {mode === "apply" ? "低波次优先" : "高波次优先"}
        </Typography.Text>
      </Flex>
      <Steps
        current={Math.max(0, waves.indexOf(selectedWave))}
        onChange={index => setSelectedWave(waves[index])}
        items={waves.map(wave => ({
          title: `Wave ${wave}`,
          status: syncWaveCanAdvance(states, wave)
            ? "finish"
            : wave === selectedWave
              ? "process"
              : "wait",
        }))}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 10,
        }}
      >
        {phases.map(phase => (
          <Card key={phase} size="small" title={phase}>
            <Timeline
              items={waves.flatMap(wave =>
                b.rows
                  .filter(
                    row =>
                      value(row, phaseRef) === phase &&
                      numeric(row, waveRef) === wave
                  )
                  .map(row => ({
                    color: /failed|degraded/i.test(value(row, statusRef))
                      ? "red"
                      : truthy(row, statusRef)
                        ? "green"
                        : "blue",
                    children: (
                      <div>
                        <Flex justify="space-between">
                          <Typography.Text strong ellipsis>
                            {value(row, resourceRef)}
                          </Typography.Text>
                          <Tag>{value(row, kindRef)}</Tag>
                        </Flex>
                        <Typography.Text type="secondary">
                          Wave {wave} · {value(row, statusRef)}
                        </Typography.Text>
                      </div>
                    ),
                  }))
              )}
            />
          </Card>
        ))}
      </div>
      <Flex justify="space-between" align="center">
        <Alert
          type={canAdvance ? "success" : "warning"}
          showIcon
          message={
            canAdvance
              ? `Wave ${selectedWave} 的前置波次已健康`
              : "前置波次未同步或存在失败资源，后续波次被阻塞"
          }
        />
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          disabled={!canAdvance}
          onClick={() =>
            p.onAction?.("submitRequest", {
              entityRef: b.entityRef,
              wave: selectedWave,
              mode,
              operation: "runSyncWave",
              targets: targets(p),
            })
          }
        >
          执行当前波次
        </Button>
      </Flex>
    </Flex>
  );
};

export const ScaffolderTaskExecutionConsoleRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      stepRef = field(p, "stepNameFieldRef"),
      statusRef = field(p, "stepStatusFieldRef"),
      logRef = field(p, "logFieldRef"),
      outputRef = field(p, "outputFieldRef"),
      durationRef = field(p, "durationFieldRef"),
      taskStatus = scaffolderTaskStatus(
        b?.rows.map(row => value(row, statusRef)) ?? []
      ),
      [logsVisible, setLogsVisible] = React.useState(
        /completed|failed/i.test(taskStatus)
      ),
      [activeId, setActiveId] = React.useState(
        b?.rows.find(row => /failed|error/i.test(value(row, statusRef)))?.id ??
          b?.rows[0]?.id ??
          ""
      );
    if (!b || !stepRef || !statusRef || !logRef || !outputRef)
      return missing(
        p,
        "scaffolder-task-execution-console",
        "软件模板任务执行台"
      );
    const actions = scaffolderTaskActions(taskStatus),
      active = b.rows.find(row => row.id === activeId) ?? b.rows[0],
      outputs = b.rows.filter(row => value(row, outputRef));
    return shell(
      p,
      "scaffolder-task-execution-console",
      "软件模板任务执行台",
      <Flex vertical gap={12}>
        <Flex justify="space-between" align="center">
          <Space>
            <Badge
              status={
                /failed/i.test(taskStatus)
                  ? "error"
                  : /completed/i.test(taskStatus)
                    ? "success"
                    : "processing"
              }
            />
            <Typography.Text strong>任务状态：{taskStatus}</Typography.Text>
          </Space>
          <Space>
            <Button
              icon={<CodeOutlined />}
              onClick={() => setLogsVisible(v => !v)}
            >
              {logsVisible ? "隐藏日志" : "显示日志"}
            </Button>
            <Button
              danger
              icon={<StopOutlined />}
              disabled={!actions.canCancel}
              onClick={() =>
                p.onAction?.("submitRequest", {
                  entityRef: b.entityRef,
                  operation: "cancelScaffolderTask",
                  targets: targets(p),
                })
              }
            >
              取消
            </Button>
            <Button
              icon={<ReloadOutlined />}
              disabled={!actions.canRetry}
              onClick={() =>
                p.onAction?.("submitRequest", {
                  entityRef: b.entityRef,
                  operation: "retryScaffolderTask",
                  failedStepId: active.id,
                  targets: targets(p),
                })
              }
            >
              重试
            </Button>
          </Space>
        </Flex>
        <Splitter>
          <Splitter.Panel defaultSize="36%" min="28%">
            <Card size="small" title="执行步骤">
              <Steps
                direction="vertical"
                current={Math.max(
                  0,
                  b.rows.findIndex(row => row.id === active.id)
                )}
                items={b.rows.map(row => ({
                  title: value(row, stepRef),
                  description: `${value(row, statusRef)}${durationRef ? ` · ${numeric(row, durationRef)}s` : ""}`,
                  status: /failed/i.test(value(row, statusRef))
                    ? "error"
                    : /completed|success/i.test(value(row, statusRef))
                      ? "finish"
                      : /processing|open/i.test(value(row, statusRef))
                        ? "process"
                        : "wait",
                  onClick: () => setActiveId(row.id),
                }))}
              />
            </Card>
          </Splitter.Panel>
          <Splitter.Panel>
            <Card
              size="small"
              title={
                logsVisible
                  ? `步骤日志 · ${value(active, stepRef)}`
                  : "任务输出"
              }
            >
              {logsVisible ? (
                <div
                  style={{
                    minHeight: 230,
                    maxHeight: 330,
                    overflow: "auto",
                    padding: 12,
                    background: "var(--ant-color-fill-quaternary)",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {value(active, logRef, "等待日志输出…")}
                </div>
              ) : outputs.length ? (
                <List
                  dataSource={outputs}
                  renderItem={row => (
                    <List.Item
                      actions={[
                        <Button key="open" type="link">
                          打开
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={
                          <CheckCircleOutlined
                            style={{ color: "var(--ant-color-success)" }}
                          />
                        }
                        title={value(row, stepRef)}
                        description={value(row, outputRef)}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Result
                  icon={<PauseCircleOutlined />}
                  title="任务尚未产生输出"
                />
              )}
            </Card>
          </Splitter.Panel>
        </Splitter>
        {/failed/i.test(taskStatus) && (
          <Alert
            type="error"
            showIcon
            message="任务失败后自动展开错误步骤日志；修复输入后可以重试。"
          />
        )}
      </Flex>
    );
  };

export const INDEPENDENT_STRUCTURE_BATCH10_LABELS: Record<string, string> = {
  AuthenticationFlowExecutionTree: "认证流程执行树",
  DashboardFilterScopeMapper: "仪表盘筛选作用域映射器",
  OrderFulfillmentAllocationComposer: "订单履约拆分编排器",
  AlertExpressionPipelineBuilder: "告警表达式流水线构建器",
  SyncWaveResourceSequencer: "同步波次资源编排器",
  ScaffolderTaskExecutionConsole: "软件模板任务执行台",
};
