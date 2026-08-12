import React from "react";
import {
  Button,
  Card,
  CheckList,
  Collapse,
  ErrorBlock,
  Form,
  Grid,
  Input,
  List,
  ProgressBar,
  Selector,
  Space,
  Stepper,
  Steps,
  Switch,
  Tabs,
  Tag,
} from "antd-mobile";
import {
  CheckShieldOutline,
  DeleteOutline,
  DownlandOutline,
  ExclamationTriangleOutline,
  PlayOutline,
  RedoOutline,
  StopOutline,
} from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

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
const taskStatusFromSteps = (statuses: string[]) => {
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
const shell = (
  p: ExperienceBlockRendererProps,
  id: string,
  title: string,
  content: React.ReactNode
) => (
  <Card
    data-testid={`phone-${id}`}
    title={String(p.block.props?.title ?? title)}
  >
    <div
      style={{ paddingBottom: p.block.props?.surface === "plain" ? 144 : 0 }}
    >
      {content}
    </div>
  </Card>
);
const empty = (p: ExperienceBlockRendererProps, id: string, title: string) =>
  shell(p, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);

function PhoneAuthenticationFlowExecutionTree(p: ExperienceBlockRendererProps) {
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
    return empty(p, "authentication-flow-execution-tree", "认证流程执行树");
  const roots = b.rows.filter(row => !value(row, parentRef)),
    children = (id: string) =>
      b.rows.filter(row => value(row, parentRef) === id),
    draft = b.rows.map(row => ({
      rowId: row.id,
      parent: value(row, parentRef),
      priority: priorities[row.id] ?? numeric(row, priorityRef),
      requirement: requirements[row.id] ?? value(row, requirementRef),
    })),
    valid =
      draft.some(item => item.requirement !== "DISABLED") &&
      draft.every(
        (item, i) =>
          !draft.some(
            (other, j) =>
              i !== j &&
              item.parent === other.parent &&
              item.priority === other.priority
          )
      );
  const panel = (row: Row, depth = 0): React.ReactNode => (
    <Collapse.Panel
      key={row.id}
      title={
        <span style={{ paddingLeft: depth * 8 }}>
          {value(row, nameRef)}{" "}
          {truthy(row, configurableRef) && <Tag color="primary">可配置</Tag>}
        </span>
      }
    >
      <Space block direction="vertical">
        <Selector
          columns={2}
          value={[requirements[row.id] ?? value(row, requirementRef)]}
          onChange={keys =>
            setRequirements(prev => ({ ...prev, [row.id]: keys[0] }))
          }
          options={["REQUIRED", "ALTERNATIVE", "CONDITIONAL", "DISABLED"].map(
            v => ({ label: v, value: v })
          )}
        />
        <Form layout="horizontal">
          <Form.Item label="优先级">
            <Stepper
              min={0}
              value={priorities[row.id] ?? numeric(row, priorityRef)}
              onChange={n => setPriorities(prev => ({ ...prev, [row.id]: n }))}
            />
          </Form.Item>
        </Form>
        {children(row.id).length > 0 && (
          <Collapse accordion>
            {children(row.id).map(child => panel(child, depth + 1))}
          </Collapse>
        )}
        <Button block color="danger" fill="outline">
          <DeleteOutline /> 删除执行
        </Button>
      </Space>
    </Collapse.Panel>
  );
  return shell(
    p,
    "authentication-flow-execution-tree",
    "认证流程执行树",
    <Space block direction="vertical">
      <Collapse accordion>{roots.map(row => panel(row))}</Collapse>
      <Grid columns={2} gap={8}>
        <Grid.Item>
          <Button block fill="outline">
            添加步骤
          </Button>
        </Grid.Item>
        <Grid.Item>
          <Button block fill="outline">
            添加子流程
          </Button>
        </Grid.Item>
      </Grid>
      <div
        style={{
          padding: 10,
          background: valid ? "#e7f8f2" : "#fff1f0",
          color: valid ? "#067647" : "#cf1322",
        }}
      >
        {valid ? "优先级和要求配置有效" : "同级优先级重复或全部禁用"}
      </div>
      <Button
        block
        color="primary"
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
    </Space>
  );
}

function PhoneDashboardFilterScopeMapper(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    kindRef = field(p, "nodeKindFieldRef"),
    labelRef = field(p, "nodeLabelFieldRef"),
    parentRef = field(p, "parentNodeFieldRef"),
    filterRef = field(p, "filterFieldRef"),
    filters = b?.rows.filter(row => /filter/i.test(value(row, kindRef))) ?? [],
    charts =
      b?.rows.filter(row => /chart|panel/i.test(value(row, kindRef))) ?? [],
    [active, setActive] = React.useState(filters[0]?.id ?? ""),
    [selectedFilters, setSelectedFilters] = React.useState<string[]>(
      filters[0] ? [filters[0].id] : []
    ),
    [scopes, setScopes] = React.useState<Record<string, string[]>>({});
  if (
    !b ||
    !kindRef ||
    !labelRef ||
    !parentRef ||
    !filterRef ||
    !filters.length
  )
    return empty(p, "dashboard-filter-scope-mapper", "仪表盘筛选作用域映射器");
  const checked =
      scopes[active] ??
      charts
        .filter(
          row => value(row, filterRef) === active || truthy(row, filterRef)
        )
        .map(row => row.id),
    valid = selectedFilters.every(
      id => (scopes[id] ?? (id === active ? checked : [])).length > 0
    );
  return shell(
    p,
    "dashboard-filter-scope-mapper",
    "仪表盘筛选作用域映射器",
    <Space block direction="vertical">
      <Tabs defaultActiveKey="filters">
        <Tabs.Tab title="筛选器" key="filters">
          <CheckList
            multiple
            value={selectedFilters}
            onChange={ids => {
              const values = ids.map(String);
              setSelectedFilters(values);
              setActive(values[0] ?? "");
            }}
          >
            {filters.map(row => (
              <CheckList.Item
                key={row.id}
                value={row.id}
                onClick={() => setActive(row.id)}
              >
                {value(row, labelRef)}
              </CheckList.Item>
            ))}
          </CheckList>
        </Tabs.Tab>
        <Tabs.Tab title="作用目标" key="targets">
          <div style={{ marginBottom: 8 }}>
            当前：
            <strong>
              {value(
                filters.find(row => row.id === active) ?? filters[0],
                labelRef
              )}
            </strong>
          </div>
          <CheckList
            multiple
            value={checked}
            onChange={ids =>
              setScopes(prev => ({ ...prev, [active]: ids.map(String) }))
            }
          >
            {charts.map(row => (
              <CheckList.Item
                key={row.id}
                value={row.id}
                description={value(row, parentRef) || "仪表盘"}
              >
                {value(row, labelRef)}
              </CheckList.Item>
            ))}
          </CheckList>
        </Tabs.Tab>
        <Tabs.Tab title="摘要" key="summary">
          <List>
            {selectedFilters.map(id => (
              <List.Item
                key={id}
                extra={
                  <Tag
                    color={(scopes[id] ?? []).length ? "success" : "warning"}
                  >
                    {(scopes[id] ?? []).length || "默认"} 个目标
                  </Tag>
                }
              >
                {value(
                  filters.find(row => row.id === id)!,
                  labelRef
                )}
              </List.Item>
            ))}
          </List>
        </Tabs.Tab>
      </Tabs>
      <Button
        block
        color="primary"
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
    </Space>
  );
}

function PhoneOrderFulfillmentAllocationComposer(
  p: ExperienceBlockRendererProps
) {
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
    return empty(
      p,
      "order-fulfillment-allocation-composer",
      "订单履约拆分编排器"
    );
  const lines = [...new Set(b.rows.map(row => value(row, lineRef)))].map(id => {
      const rows = b.rows.filter(row => value(row, lineRef) === id),
        ordered = numeric(rows[0], orderedRef),
        total = rows.reduce((sum, row) => sum + (drafts[row.id] ?? 0), 0);
      return { id, rows, ordered, total };
    }),
    valid =
      lines.some(line => line.total > 0) &&
      lines.every(line => allowExceed || line.total <= line.ordered) &&
      !b.rows.some(
        row => truthy(row, preorderRef) && (drafts[row.id] ?? 0) > 0
      );
  return shell(
    p,
    "order-fulfillment-allocation-composer",
    "订单履约拆分编排器",
    <Space block direction="vertical">
      <Collapse accordion>
        {lines.map(line => (
          <Collapse.Panel
            key={line.id}
            title={`${value(line.rows[0], productRef)} · ${line.total}/${line.ordered}`}
          >
            <Space block direction="vertical">
              <ProgressBar
                percent={
                  line.ordered
                    ? Math.min(100, (line.total / line.ordered) * 100)
                    : 0
                }
              />
              {line.rows.map(row => (
                <Card key={row.id} title={value(row, warehouseRef)}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>可用 {numeric(row, availableRef)}</span>
                    <Stepper
                      min={0}
                      max={allowExceed ? undefined : numeric(row, availableRef)}
                      value={drafts[row.id] ?? 0}
                      onChange={n =>
                        setDrafts(prev => ({ ...prev, [row.id]: n }))
                      }
                      disabled={truthy(row, preorderRef)}
                    />
                  </div>
                </Card>
              ))}
            </Space>
          </Collapse.Panel>
        ))}
      </Collapse>
      <Form>
        <Form.Item label="追踪号">
          <Input value={tracking} onChange={setTracking} placeholder="可选" />
        </Form.Item>
        <Form.Item label="通知客户" childElementPosition="right">
          <Switch checked={notify} onChange={setNotify} />
        </Form.Item>
        <Form.Item label="允许超库存" childElementPosition="right">
          <Switch checked={allowExceed} onChange={setAllowExceed} />
        </Form.Item>
      </Form>
      <Button
        block
        color="primary"
        disabled={!valid}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            allocations: drafts,
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
    </Space>
  );
}

function PhoneAlertExpressionPipelineBuilder(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    refRef = field(p, "refIdFieldRef"),
    kindRef = field(p, "expressionKindFieldRef"),
    inputRef = field(p, "inputRefFieldRef"),
    formulaRef = field(p, "formulaFieldRef"),
    statusRef = field(p, "previewStatusFieldRef"),
    [condition, setCondition] = React.useState(
      b?.rows[b.rows.length - 1]?.id ?? ""
    ),
    [formulas, setFormulas] = React.useState<Record<string, string>>({});
  if (!b || !refRef || !kindRef || !inputRef || !formulaRef || !statusRef)
    return empty(
      p,
      "alert-expression-pipeline-builder",
      "告警表达式流水线构建器"
    );
  const valid =
    new Set(b.rows.map(row => value(row, refRef))).size === b.rows.length &&
    !b.rows.some(
      (row, index) =>
        /error|failed/i.test(value(row, statusRef)) ||
        value(row, inputRef) === value(row, refRef) ||
        (value(row, inputRef) &&
          !b.rows
            .slice(0, index)
            .some(prev => value(prev, refRef) === value(row, inputRef)))
    );
  return shell(
    p,
    "alert-expression-pipeline-builder",
    "告警表达式流水线构建器",
    <Space block direction="vertical">
      <Steps
        direction="vertical"
        current={b.rows.findIndex(row => row.id === condition)}
      >
        {b.rows.map((row, index) => (
          <Steps.Step
            key={row.id}
            title={`${value(row, refRef)} · ${value(row, kindRef)}`}
            description={`${value(row, inputRef) ? `输入 ${value(row, inputRef)} · ` : ""}${value(row, statusRef)}`}
            status={
              /error/i.test(value(row, statusRef))
                ? "error"
                : condition === row.id
                  ? "process"
                  : "finish"
            }
          />
        ))}
      </Steps>
      <Collapse accordion>
        {b.rows.map((row, index) => (
          <Collapse.Panel key={row.id} title={`${value(row, refRef)} 表达式`}>
            <Space block direction="vertical">
              <Selector
                columns={Math.max(1, index)}
                value={value(row, inputRef) ? [value(row, inputRef)] : []}
                options={b.rows.slice(0, index).map(prev => ({
                  label: value(prev, refRef),
                  value: value(prev, refRef),
                }))}
              />
              <Input
                value={formulas[row.id] ?? value(row, formulaRef)}
                onChange={v => setFormulas(prev => ({ ...prev, [row.id]: v }))}
              />
              <Button
                block
                fill={condition === row.id ? "solid" : "outline"}
                color="primary"
                onClick={() => setCondition(row.id)}
              >
                设为告警条件
              </Button>
            </Space>
          </Collapse.Panel>
        ))}
      </Collapse>
      <Button
        block
        color="primary"
        disabled={!valid}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            formulas,
            conditionRefId: value(
              b.rows.find(row => row.id === condition)!,
              refRef
            ),
            operation: "saveAlertExpressionPipeline",
            targets: targets(p),
          })
        }
      >
        保存表达式链
      </Button>
    </Space>
  );
}

function PhoneSyncWaveResourceSequencer(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    resourceRef = field(p, "resourceNameFieldRef"),
    phaseRef = field(p, "phaseFieldRef"),
    waveRef = field(p, "waveFieldRef"),
    kindRef = field(p, "resourceKindFieldRef"),
    statusRef = field(p, "syncStatusFieldRef"),
    [phase, setPhase] = React.useState("Sync"),
    [mode, setMode] = React.useState("apply"),
    [wave, setWave] = React.useState(0);
  if (!b || !resourceRef || !phaseRef || !waveRef || !kindRef || !statusRef)
    return empty(p, "sync-wave-resource-sequencer", "同步波次资源编排器");
  const waves = [...new Set(b.rows.map(row => numeric(row, waveRef)))].sort(
      (a, c) => (mode === "apply" ? a - c : c - a)
    ),
    shown = b.rows.filter(row => value(row, phaseRef) === phase),
    canRun =
      !b.rows.some(
        row =>
          numeric(row, waveRef) <= wave &&
          /failed|degraded|unhealthy/i.test(value(row, statusRef))
      ) &&
      b.rows
        .filter(row => numeric(row, waveRef) < wave)
        .every(row => truthy(row, statusRef));
  return shell(
    p,
    "sync-wave-resource-sequencer",
    "同步波次资源编排器",
    <Space block direction="vertical">
      <Selector
        columns={2}
        value={[mode]}
        onChange={keys => setMode(keys[0])}
        options={[
          { label: "应用：低到高", value: "apply" },
          { label: "删除：高到低", value: "prune" },
        ]}
      />
      <Tabs activeKey={phase} onChange={setPhase}>
        {["PreSync", "Sync", "PostSync"].map(item => (
          <Tabs.Tab key={item} title={item}>
            <Steps
              direction="vertical"
              current={Math.max(0, waves.indexOf(wave))}
            >
              {shown.map(row => (
                <Steps.Step
                  key={row.id}
                  title={
                    <span onClick={() => setWave(numeric(row, waveRef))}>
                      {value(row, resourceRef)}
                    </span>
                  }
                  description={`Wave ${numeric(row, waveRef)} · ${value(row, kindRef)} · ${value(row, statusRef)}`}
                  status={
                    /failed/i.test(value(row, statusRef))
                      ? "error"
                      : truthy(row, statusRef)
                        ? "finish"
                        : "process"
                  }
                />
              ))}
            </Steps>
          </Tabs.Tab>
        ))}
      </Tabs>
      <div style={{ padding: 10, background: canRun ? "#e7f8f2" : "#fff7e6" }}>
        {canRun
          ? `Wave ${wave} 前置资源已健康`
          : "前置波次未完成或存在失败资源"}
      </div>
      <Button
        block
        color="primary"
        disabled={!canRun}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            wave,
            mode,
            operation: "runSyncWave",
            targets: targets(p),
          })
        }
      >
        <PlayOutline /> 执行当前波次
      </Button>
    </Space>
  );
}

function PhoneScaffolderTaskExecutionConsole(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    stepRef = field(p, "stepNameFieldRef"),
    statusRef = field(p, "stepStatusFieldRef"),
    logRef = field(p, "logFieldRef"),
    outputRef = field(p, "outputFieldRef"),
    durationRef = field(p, "durationFieldRef"),
    [active, setActive] = React.useState(
      b?.rows.find(row => /failed|error/i.test(value(row, statusRef)))?.id ??
        b?.rows[0]?.id ??
        ""
    ),
    taskStatus = taskStatusFromSteps(
      b?.rows.map(row => value(row, statusRef)) ?? []
    );
  if (!b || !stepRef || !statusRef || !logRef || !outputRef)
    return empty(p, "scaffolder-task-execution-console", "软件模板任务执行台");
  const current = b.rows.find(row => row.id === active) ?? b.rows[0],
    canCancel = !/completed|cancelled|failed/i.test(taskStatus),
    canRetry = /failed/i.test(taskStatus);
  return shell(
    p,
    "scaffolder-task-execution-console",
    "软件模板任务执行台",
    <Space block direction="vertical">
      <Tag
        color={
          canRetry
            ? "danger"
            : /completed/i.test(taskStatus)
              ? "success"
              : "primary"
        }
      >
        任务状态：{taskStatus}
      </Tag>
      <Tabs defaultActiveKey={canRetry ? "logs" : "steps"}>
        <Tabs.Tab title="步骤" key="steps">
          <Steps
            direction="vertical"
            current={Math.max(
              0,
              b.rows.findIndex(row => row.id === active)
            )}
          >
            {b.rows.map(row => (
              <Steps.Step
                key={row.id}
                title={
                  <span onClick={() => setActive(row.id)}>
                    {value(row, stepRef)}
                  </span>
                }
                description={`${value(row, statusRef)}${durationRef ? ` · ${numeric(row, durationRef)}s` : ""}`}
                status={
                  /failed/i.test(value(row, statusRef))
                    ? "error"
                    : /completed|success/i.test(value(row, statusRef))
                      ? "finish"
                      : "process"
                }
              />
            ))}
          </Steps>
        </Tabs.Tab>
        <Tabs.Tab title="日志" key="logs">
          <Card title={value(current, stepRef)}>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
              }}
            >
              {value(current, logRef, "等待日志输出…")}
            </pre>
          </Card>
        </Tabs.Tab>
        <Tabs.Tab title="输出" key="outputs">
          <List>
            {b.rows
              .filter(row => value(row, outputRef))
              .map(row => (
                <List.Item key={row.id} prefix={<DownlandOutline />} arrow>
                  {value(row, outputRef)}
                </List.Item>
              ))}
          </List>
        </Tabs.Tab>
      </Tabs>
      {canRetry && (
        <div style={{ padding: 10, background: "#fff1f0", color: "#cf1322" }}>
          <ExclamationTriangleOutline /> 失败任务已自动打开日志，可修复后重试
        </div>
      )}
      <Grid columns={2} gap={8}>
        <Grid.Item>
          <Button
            block
            color="danger"
            fill="outline"
            disabled={!canCancel}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                operation: "cancelScaffolderTask",
                targets: targets(p),
              })
            }
          >
            <StopOutline /> 取消
          </Button>
        </Grid.Item>
        <Grid.Item>
          <Button
            block
            color="primary"
            disabled={!canRetry}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                operation: "retryScaffolderTask",
                failedStepId: current.id,
                targets: targets(p),
              })
            }
          >
            <RedoOutline /> 重试
          </Button>
        </Grid.Item>
      </Grid>
    </Space>
  );
}

export function renderIndependentStructureBatch10PhoneBlock(
  p: ExperienceBlockRendererProps
): React.ReactNode | undefined {
  switch (p.block.type) {
    case "AuthenticationFlowExecutionTree":
      return <PhoneAuthenticationFlowExecutionTree {...p} />;
    case "DashboardFilterScopeMapper":
      return <PhoneDashboardFilterScopeMapper {...p} />;
    case "OrderFulfillmentAllocationComposer":
      return <PhoneOrderFulfillmentAllocationComposer {...p} />;
    case "AlertExpressionPipelineBuilder":
      return <PhoneAlertExpressionPipelineBuilder {...p} />;
    case "SyncWaveResourceSequencer":
      return <PhoneSyncWaveResourceSequencer {...p} />;
    case "ScaffolderTaskExecutionConsole":
      return <PhoneScaffolderTaskExecutionConsole {...p} />;
    default:
      return undefined;
  }
}
