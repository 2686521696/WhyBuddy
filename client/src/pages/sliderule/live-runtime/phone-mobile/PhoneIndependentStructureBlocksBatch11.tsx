import React from "react";
import {
  Button,
  Card,
  Collapse,
  ErrorBlock,
  Grid,
  Input,
  List,
  ProgressBar,
  Selector,
  Space,
  Stepper,
  Steps,
  Tabs,
  Tag,
} from "antd-mobile";
import {
  CheckOutline,
  PlayOutline,
  ScanCodeOutline,
  SendOutline,
  RightOutline,
} from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<
  ExperienceBlockRendererProps["entityRows"]
>[string][number];
const f = (p: ExperienceBlockRendererProps, key: string) =>
  String(p.block.binding?.[key] ?? "").trim();
const v = (row: Row, ref: string, fallback = "") =>
  String(row.values?.[ref] ?? fallback);
const n = (row: Row, ref: string, fallback = 0) =>
  Number(row.values?.[ref] ?? fallback);
const yes = (row: Row, ref: string) =>
  /true|yes|enabled|allowed|1/i.test(v(row, ref));
const targets = (p: ExperienceBlockRendererProps) =>
  Array.isArray(p.block.binding?.targets)
    ? p.block.binding.targets.map(String)
    : [];
const bound = (p: ExperienceBlockRendererProps) => {
  const entityRef = f(p, "entityRef"),
    rows = entityRef ? p.entityRows?.[entityRef] : undefined;
  return entityRef && rows?.length ? { entityRef, rows } : undefined;
};
const shell = (
  p: ExperienceBlockRendererProps,
  id: string,
  title: string,
  children: React.ReactNode
) => (
  <Card
    data-testid={`phone-${id}`}
    title={String(p.block.props?.title ?? title)}
  >
    <div
      style={{ paddingBottom: p.block.props?.surface === "plain" ? 144 : 0 }}
    >
      {children}
    </div>
  </Card>
);
const empty = (p: ExperienceBlockRendererProps, id: string, title: string) =>
  shell(p, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);
const notice = (ok: boolean, text: string) => (
  <div
    style={{
      padding: 10,
      background: ok ? "#e7f8f2" : "#fff1f0",
      color: ok ? "#067647" : "#cf1322",
    }}
  >
    {text}
  </div>
);

function Rack(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    name = f(p, "assetNameFieldRef"),
    sideRef = f(p, "sideFieldRef"),
    pos = f(p, "unitPositionFieldRef"),
    height = f(p, "unitHeightFieldRef"),
    lane = f(p, "horizontalLaneFieldRef"),
    [side, setSide] = React.useState("front"),
    units = Number(p.block.props?.units ?? 18);
  if (!b || !name || !sideRef || !pos || !height || !lane)
    return empty(p, "datacenter-rack-unit-planner", "数据中心机架 U 位规划器");
  const rows = b.rows.filter(r => v(r, sideRef) === side);
  return shell(
    p,
    "datacenter-rack-unit-planner",
    "数据中心机架 U 位规划器",
    <Space block direction="vertical">
      <Selector
        columns={2}
        value={[side]}
        onChange={x => setSide(String(x[0]))}
        options={[
          { label: "前视图", value: "front" },
          { label: "后视图", value: "rear" },
        ]}
      />
      <div
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${units},18px)`,
          border: "1px solid #ccc",
          position: "relative",
          minHeight: units * 18,
        }}
      >
        {rows.map(r => (
          <div
            key={r.id}
            style={{
              position: "absolute",
              top: (units - n(r, pos) - n(r, height, 1) + 1) * 18,
              left: n(r, lane) ? "51%" : 28,
              right: n(r, lane) ? 4 : "50%",
              height: n(r, height, 1) * 18 - 1,
              background: "#e8f3ff",
              border: "1px solid #1677ff",
              fontSize: 11,
              overflow: "hidden",
              padding: "0 3px",
            }}
          >
            {v(r, name)} · {n(r, pos)}U
          </div>
        ))}
      </div>
      {notice(true, "触摸设备后调整 U 位；冲突时恢复原位置")}
      <Button
        block
        color="primary"
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            operation: "saveRackPlacements",
            rowIds: rows.map(row => row.id),
            targets: targets(p),
          })
        }
      >
        保存布局
      </Button>
    </Space>
  );
}

function Command(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    type = f(p, "commandTypeFieldRef"),
    attr = f(p, "attributeNameFieldRef"),
    attrType = f(p, "attributeTypeFieldRef"),
    value = f(p, "attributeValueFieldRef"),
    available = f(p, "availableFieldRef"),
    [active, setActive] = React.useState("");
  if (!b || !type || !attr || !attrType || !value || !available)
    return empty(p, "device-command-dispatch-console", "设备命令下发控制台");
  const types = [...new Set(b.rows.map(r => v(r, type)))],
    selected = active || types[0],
    rows = b.rows.filter(r => v(r, type) === selected),
    ok = rows.every(r => yes(r, available));
  return shell(
    p,
    "device-command-dispatch-console",
    "设备命令下发控制台",
    <Space block direction="vertical">
      <Selector
        value={[selected]}
        onChange={x => setActive(String(x[0]))}
        options={types.map(x => ({ label: x, value: x }))}
      />
      <List>
        {rows.map(r => (
          <List.Item
            key={r.id}
            description={v(r, attrType)}
            extra={<Input defaultValue={v(r, value)} style={{ width: 110 }} />}
          >
            {v(r, attr)}
          </List.Item>
        ))}
      </List>
      {notice(ok, ok ? "参数来自当前设备支持的命令能力" : "设备不支持该命令")}
      <Button
        block
        color="primary"
        disabled={!ok}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            operation: "sendDeviceCommand",
            commandType: selected,
            targets: targets(p),
          })
        }
      >
        <SendOutline /> 发送并等待回执
      </Button>
    </Space>
  );
}

function Subscription(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    plan = f(p, "planNameFieldRef"),
    phase = f(p, "phaseTypeFieldRef"),
    price = f(p, "catalogPriceFieldRef"),
    override = f(p, "overridePriceFieldRef"),
    [policy, setPolicy] = React.useState("DEFAULT");
  if (!b || !plan || !phase || !price || !override)
    return empty(
      p,
      "subscription-phase-override-composer",
      "订阅阶段价格覆盖编排器"
    );
  return shell(
    p,
    "subscription-phase-override-composer",
    "订阅阶段价格覆盖编排器",
    <Space block direction="vertical">
      <Selector
        columns={2}
        value={[policy]}
        onChange={x => setPolicy(String(x[0]))}
        options={["DEFAULT", "IMMEDIATE", "END_OF_TERM", "DATE"].map(x => ({
          label: x,
          value: x,
        }))}
      />
      <Steps direction="vertical">
        {b.rows.map(r => (
          <Steps.Step
            key={r.id}
            title={v(r, phase)}
            description={`${v(r, plan)} · 目录价 ¥${n(r, price)}`}
          />
        ))}
      </Steps>
      <Collapse>
        {b.rows.map(r => (
          <Collapse.Panel key={r.id} title={`${v(r, phase)} 价格覆盖`}>
            <Stepper min={0} defaultValue={n(r, override, n(r, price))} />
          </Collapse.Panel>
        ))}
      </Collapse>
      <Button
        block
        color="primary"
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            operation: "changeSubscriptionPlan",
            policy,
            targets: targets(p),
          })
        }
      >
        按 {policy} 保存变更
      </Button>
    </Space>
  );
}

function Move(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    name = f(p, "collectionNameFieldRef"),
    perm = f(p, "permissionFieldRef"),
    current = f(p, "currentCollectionFieldRef"),
    writable = f(p, "writableFieldRef"),
    desc = f(p, "descendantFieldRef"),
    [selected, setSelected] = React.useState(
      b?.rows.find(
        row => !yes(row, current) && yes(row, writable) && !yes(row, desc)
      )?.id ?? ""
    );
  if (!b || !name || !perm || !current || !writable || !desc)
    return empty(p, "document-permission-move-planner", "文档权限迁移规划器");
  const source = b.rows.find(r => yes(r, current)) ?? b.rows[0],
    dest = b.rows.find(r => r.id === selected),
    ok =
      !!dest &&
      dest.id !== source.id &&
      yes(dest, writable) &&
      !yes(dest, desc);
  return shell(
    p,
    "document-permission-move-planner",
    "文档权限迁移规划器",
    <Space block direction="vertical">
      <List>
        {b.rows.map(r => (
          <List.Item
            key={r.id}
            onClick={() => setSelected(r.id)}
            extra={
              <Tag color={yes(r, writable) ? "primary" : "default"}>
                {v(r, perm)}
              </Tag>
            }
            arrow={yes(r, writable)}
          >
            {v(r, name)}
          </List.Item>
        ))}
      </List>
      {dest &&
        notice(ok, `${v(source, perm)} → ${v(dest, perm)}，移动会改变成员权限`)}
      <Button
        block
        color="primary"
        disabled={!ok}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            operation: "moveDocument",
            sourceCollectionId: source.id,
            destinationCollectionId: dest?.id,
            targets: targets(p),
          })
        }
      >
        <RightOutline /> 确认移动
      </Button>
    </Space>
  );
}

function Pipeline(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    stage = f(p, "stageNameFieldRef"),
    job = f(p, "jobNameFieldRef"),
    status = f(p, "jobStatusFieldRef"),
    needs = f(p, "dependencyStatusFieldRef"),
    parallel = f(p, "parallelCountFieldRef"),
    auth = f(p, "authorizedFieldRef");
  if (!b || !stage || !job || !status || !needs || !parallel || !auth)
    return empty(p, "ci-stage-job-graph-console", "CI 阶段任务图控制台");
  const stages = [...new Set(b.rows.map(r => v(r, stage)))];
  return shell(
    p,
    "ci-stage-job-graph-console",
    "CI 阶段任务图控制台",
    <Tabs defaultActiveKey={stages[0]}>
      {stages.map(s => (
        <Tabs.Tab title={s} key={s}>
          <Space block direction="vertical">
            {b.rows
              .filter(r => v(r, stage) === s)
              .map(r => {
                const ok =
                  yes(r, auth) &&
                  /manual|failed|scheduled/i.test(v(r, status)) &&
                  v(r, needs)
                    .split(",")
                    .filter(Boolean)
                    .every(x => /success|skipped/i.test(x));
                return (
                  <Card
                    key={r.id}
                    title={v(r, job)}
                    extra={
                      n(r, parallel) > 1 ? (
                        <Tag>{n(r, parallel)} 并行</Tag>
                      ) : null
                    }
                  >
                    <Grid columns={2}>
                      <Grid.Item>
                        <Tag
                          color={
                            /failed/i.test(v(r, status)) ? "danger" : "success"
                          }
                        >
                          {v(r, status)}
                        </Tag>
                      </Grid.Item>
                      <Grid.Item>
                        <Button
                          block
                          size="mini"
                          disabled={!ok}
                          onClick={() =>
                            p.onAction?.("submitRequest", {
                              entityRef: b.entityRef,
                              operation: /failed/i.test(v(r, status))
                                ? "retryCiJob"
                                : "playCiJob",
                              jobId: r.id,
                              targets: targets(p),
                            })
                          }
                        >
                          <PlayOutline /> 执行
                        </Button>
                      </Grid.Item>
                    </Grid>
                  </Card>
                );
              })}
          </Space>
        </Tabs.Tab>
      ))}
    </Tabs>
  );
}

function Serial(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    item = f(p, "itemNameFieldRef"),
    serial = f(p, "serialNumberFieldRef"),
    batch = f(p, "batchNumberFieldRef"),
    qty = f(p, "quantityFieldRef"),
    required = f(p, "requiredQuantityFieldRef"),
    warehouse = f(p, "warehouseFieldRef"),
    [scan, setScan] = React.useState("");
  if (!b || !item || !serial || !batch || !qty || !required || !warehouse)
    return empty(p, "serial-batch-allocation-scanner", "序列号批次分配扫描器");
  const total = b.rows.reduce((x, r) => x + n(r, qty), 0),
    target = n(b.rows[0], required),
    unique =
      new Set(b.rows.filter(r => v(r, serial)).map(r => v(r, serial))).size ===
      b.rows.filter(r => v(r, serial)).length,
    ok = unique && Math.abs(total - target) < 0.0001;
  return shell(
    p,
    "serial-batch-allocation-scanner",
    "序列号批次分配扫描器",
    <Space block direction="vertical">
      <Input
        value={scan}
        onChange={setScan}
        placeholder="扫描序列号或批次"
        clearable
      />
      <ProgressBar
        percent={target ? Math.min(100, (total / target) * 100) : 0}
      />
      <div style={{ textAlign: "center" }}>
        {total}/{target}
      </div>
      <Collapse>
        {b.rows.map(r => (
          <Collapse.Panel
            key={r.id}
            title={`${v(r, serial) || v(r, batch)} · ${v(r, item)}`}
          >
            <List.Item
              description={`批次 ${v(r, batch) || "-"}`}
              extra={<Stepper min={0.0001} defaultValue={n(r, qty)} />}
            >
              {v(r, warehouse)}
            </List.Item>
          </Collapse.Panel>
        ))}
      </Collapse>
      {notice(ok, ok ? "序列号唯一且数量闭合" : "数量未闭合或序列号重复")}
      <Button
        block
        color="primary"
        disabled={!ok}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            operation: "saveSerialBatchBundle",
            rowIds: b.rows.map(row => row.id),
            targets: targets(p),
          })
        }
      >
        <CheckOutline /> 保存分配
      </Button>
    </Space>
  );
}

export function renderIndependentStructureBatch11PhoneBlock(
  p: ExperienceBlockRendererProps
): React.ReactNode | undefined {
  switch (p.block.type) {
    case "DatacenterRackUnitPlanner":
      return <Rack {...p} />;
    case "DeviceCommandDispatchConsole":
      return <Command {...p} />;
    case "SubscriptionPhaseOverrideComposer":
      return <Subscription {...p} />;
    case "DocumentPermissionMovePlanner":
      return <Move {...p} />;
    case "CiStageJobGraphConsole":
      return <Pipeline {...p} />;
    case "SerialBatchAllocationScanner":
      return <Serial {...p} />;
    default:
      return undefined;
  }
}
