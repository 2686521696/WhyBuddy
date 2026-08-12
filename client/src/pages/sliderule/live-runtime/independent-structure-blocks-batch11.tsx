import React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Flex,
  Input,
  InputNumber,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Steps,
  Tag,
  Timeline,
  Tree,
  Typography,
} from "antd";
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  PlayCircleOutlined,
  QrcodeOutlined,
  RollbackOutlined,
  SendOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import type {
  ExperienceBlockRenderer,
  ExperienceBlockRendererProps,
} from "./block-registry";

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

export const rackPlacementValid = (
  items: Array<{
    id: string;
    side: string;
    position: number;
    height: number;
    lane: number;
  }>,
  units: number
) =>
  items.every(
    (item, index) =>
      item.position >= 1 &&
      item.position + item.height - 1 <= units &&
      !items.some(
        (other, j) =>
          j !== index &&
          other.side === item.side &&
          other.lane === item.lane &&
          item.position <= other.position + other.height - 1 &&
          other.position <= item.position + item.height - 1
      )
  );
export const commandDraftValid = (
  available: boolean,
  params: Array<{ required: boolean; value: string }>
) =>
  available &&
  params.every(item => !item.required || item.value.trim().length > 0);
export const phaseOverridesValid = (
  available: string[],
  overrides: Array<{ phase: string; price: number }>
) =>
  new Set(overrides.map(item => item.phase)).size === overrides.length &&
  overrides.every(item => available.includes(item.phase) && item.price >= 0);
export const documentMoveValid = (
  sourceId: string,
  destinationId: string,
  canWrite: boolean,
  descendant: boolean
) =>
  Boolean(destinationId) &&
  destinationId !== sourceId &&
  canWrite &&
  !descendant;
export const ciJobCanRun = (
  status: string,
  authorized: boolean,
  dependencies: string[]
) =>
  authorized &&
  /manual|failed|scheduled/i.test(status) &&
  dependencies.every(dep => /success|skipped/i.test(dep));
export const serialBatchAllocationValid = (
  requiredQty: number,
  entries: Array<{ serial: string; quantity: number }>
) =>
  entries.length > 0 &&
  new Set(entries.filter(item => item.serial).map(item => item.serial)).size ===
    entries.filter(item => item.serial).length &&
  entries.every(item => item.quantity > 0) &&
  Math.abs(
    entries.reduce((sum, item) => sum + item.quantity, 0) - requiredQty
  ) < 0.0001;

export const DatacenterRackUnitPlannerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p),
    nameRef = f(p, "assetNameFieldRef"),
    sideRef = f(p, "sideFieldRef"),
    positionRef = f(p, "unitPositionFieldRef"),
    heightRef = f(p, "unitHeightFieldRef"),
    laneRef = f(p, "horizontalLaneFieldRef"),
    statusRef = f(p, "placementStatusFieldRef"),
    [side, setSide] = React.useState("front"),
    [moves, setMoves] = React.useState<Record<string, number>>({}),
    units = Number(p.block.props?.units ?? 18);
  if (!b || !nameRef || !sideRef || !positionRef || !heightRef || !laneRef)
    return missing(
      p,
      "datacenter-rack-unit-planner",
      "数据中心机架 U 位规划器"
    );
  const items = b.rows.map(row => ({
      id: row.id,
      side: v(row, sideRef),
      position: moves[row.id] ?? n(row, positionRef),
      height: n(row, heightRef, 1),
      lane: n(row, laneRef),
    })),
    valid = rackPlacementValid(items, units),
    visible = b.rows.filter(row => v(row, sideRef) === side);
  return shell(
    p,
    "datacenter-rack-unit-planner",
    "数据中心机架 U 位规划器",
    <Flex vertical gap={12}>
      <Flex justify="space-between">
        <Segmented
          value={side}
          onChange={x => setSide(String(x))}
          options={[
            { label: "前视图", value: "front" },
            { label: "后视图", value: "rear" },
          ]}
        />
        <Tag>{units}U</Tag>
      </Flex>
      <div
        style={{
          position: "relative",
          minHeight: units * 22,
          border: "2px solid var(--ant-color-border)",
          background:
            "repeating-linear-gradient(to bottom,var(--ant-color-fill-quaternary) 0,var(--ant-color-fill-quaternary) 21px,var(--ant-color-border-secondary) 22px)",
        }}
      >
        {Array.from({ length: units }, (_, i) => (
          <Typography.Text
            key={i}
            type="secondary"
            style={{ position: "absolute", left: 4, top: i * 22, fontSize: 10 }}
          >
            {units - i}U
          </Typography.Text>
        ))}
        {visible.map(row => {
          const item = items.find(x => x.id === row.id)!;
          return (
            <Card
              key={row.id}
              size="small"
              styles={{ body: { padding: "3px 8px" } }}
              style={{
                position: "absolute",
                left: item.lane ? "52%" : 34,
                right: item.lane ? 8 : "50%",
                top: (units - item.position - item.height + 1) * 22,
                height: item.height * 22 - 2,
                overflow: "hidden",
                borderColor: /error|conflict/i.test(v(row, statusRef))
                  ? "var(--ant-color-error)"
                  : "var(--ant-color-primary)",
              }}
            >
              <Flex justify="space-between" align="center">
                <Typography.Text strong ellipsis>
                  {v(row, nameRef)}
                </Typography.Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={units}
                  value={item.position}
                  onChange={x =>
                    setMoves(prev => ({ ...prev, [row.id]: Number(x ?? 1) }))
                  }
                  style={{ width: 58 }}
                />
              </Flex>
            </Card>
          );
        })}
      </div>
      <Flex justify="space-between" align="center">
        <Alert
          type={valid ? "success" : "error"}
          showIcon
          message={
            valid
              ? "所有设备均在机架范围内且没有槽位冲突"
              : "存在越界或重叠，保存失败时必须回滚原位置"
          }
        />
        <Button
          type="primary"
          disabled={!valid}
          icon={<CloudServerOutlined />}
          onClick={() =>
            p.onAction?.("submitRequest", {
              entityRef: b.entityRef,
              placements: items,
              operation: "saveRackPlacements",
              targets: targets(p),
            })
          }
        >
          保存布局
        </Button>
      </Flex>
    </Flex>
  );
};

export const DeviceCommandDispatchConsoleRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      typeRef = f(p, "commandTypeFieldRef"),
      attrRef = f(p, "attributeNameFieldRef"),
      attrTypeRef = f(p, "attributeTypeFieldRef"),
      requiredRef = f(p, "requiredFieldRef"),
      valueRef = f(p, "attributeValueFieldRef"),
      availableRef = f(p, "availableFieldRef"),
      [command, setCommand] = React.useState(""),
      [drafts, setDrafts] = React.useState<Record<string, string>>({});
    if (
      !b ||
      !typeRef ||
      !attrRef ||
      !attrTypeRef ||
      !requiredRef ||
      !valueRef ||
      !availableRef
    )
      return missing(
        p,
        "device-command-dispatch-console",
        "设备命令下发控制台"
      );
    const types = [...new Set(b.rows.map(row => v(row, typeRef)))],
      active = command || types[0],
      rows = b.rows.filter(row => v(row, typeRef) === active),
      available = rows.every(row => yes(row, availableRef)),
      params = rows.map(row => ({
        required: yes(row, requiredRef),
        value: drafts[row.id] ?? v(row, valueRef),
      })),
      valid = commandDraftValid(available, params);
    return shell(
      p,
      "device-command-dispatch-console",
      "设备命令下发控制台",
      <Flex vertical gap={12}>
        <Select
          value={active}
          onChange={setCommand}
          options={types.map(type => ({ value: type, label: type }))}
          style={{ width: "100%" }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
            gap: 10,
          }}
        >
          {rows.map(row => (
            <Card
              key={row.id}
              size="small"
              title={v(row, attrRef)}
              extra={<Tag>{v(row, attrTypeRef)}</Tag>}
            >
              <Input
                value={drafts[row.id] ?? v(row, valueRef)}
                onChange={e =>
                  setDrafts(prev => ({ ...prev, [row.id]: e.target.value }))
                }
                status={
                  yes(row, requiredRef) && !(drafts[row.id] ?? v(row, valueRef))
                    ? "error"
                    : undefined
                }
              />
            </Card>
          ))}
        </div>
        <Alert
          type={available ? "info" : "warning"}
          showIcon
          message={
            available
              ? "命令类型来自当前设备能力；发送后等待设备回执"
              : "当前设备或权限不支持该命令"
          }
        />
        <Button
          type="primary"
          block
          icon={<SendOutlined />}
          disabled={!valid}
          onClick={() =>
            p.onAction?.("submitRequest", {
              entityRef: b.entityRef,
              commandType: active,
              parameters: Object.fromEntries(
                rows.map(row => [
                  v(row, attrRef),
                  drafts[row.id] ?? v(row, valueRef),
                ])
              ),
              operation: "sendDeviceCommand",
              targets: targets(p),
            })
          }
        >
          发送并等待回执
        </Button>
      </Flex>
    );
  };

export const SubscriptionPhaseOverrideComposerRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      planRef = f(p, "planNameFieldRef"),
      phaseRef = f(p, "phaseTypeFieldRef"),
      priceRef = f(p, "catalogPriceFieldRef"),
      overrideRef = f(p, "overridePriceFieldRef"),
      [plan, setPlan] = React.useState(""),
      [policy, setPolicy] = React.useState("DEFAULT"),
      [prices, setPrices] = React.useState<Record<string, number>>({});
    if (!b || !planRef || !phaseRef || !priceRef || !overrideRef)
      return missing(
        p,
        "subscription-phase-override-composer",
        "订阅阶段价格覆盖编排器"
      );
    const plans = [...new Set(b.rows.map(row => v(row, planRef)))],
      active = plan || plans[0],
      rows = b.rows.filter(row => v(row, planRef) === active),
      phases = rows.map(row => v(row, phaseRef)),
      overrides = rows.map(row => ({
        phase: v(row, phaseRef),
        price: prices[row.id] ?? n(row, overrideRef, n(row, priceRef)),
      })),
      valid = phaseOverridesValid(phases, overrides);
    return shell(
      p,
      "subscription-phase-override-composer",
      "订阅阶段价格覆盖编排器",
      <Flex vertical gap={12}>
        <Flex gap={10}>
          <Select
            value={active}
            onChange={setPlan}
            options={plans.map(x => ({ value: x, label: x }))}
            style={{ flex: 1 }}
          />
          <Segmented
            value={policy}
            onChange={x => setPolicy(String(x))}
            options={["DEFAULT", "IMMEDIATE", "END_OF_TERM", "DATE"]}
          />
        </Flex>
        <Steps
          current={Math.max(
            0,
            rows.findIndex(row => /evergreen|recurring/i.test(v(row, phaseRef)))
          )}
          items={rows.map(row => ({
            title: v(row, phaseRef),
            description: `目录价 ¥${n(row, priceRef)}`,
          }))}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 8,
          }}
        >
          {rows.map(row => (
            <Card key={row.id} size="small" title={v(row, phaseRef)}>
              <InputNumber
                min={0}
                prefix="¥"
                value={prices[row.id] ?? n(row, overrideRef, n(row, priceRef))}
                onChange={x =>
                  setPrices(prev => ({ ...prev, [row.id]: Number(x ?? 0) }))
                }
                style={{ width: "100%" }}
              />
            </Card>
          ))}
        </div>
        <Flex justify="space-between" align="center">
          <Alert
            type={valid ? "success" : "error"}
            message={
              valid
                ? `覆盖项有效，按 ${policy} 生效`
                : "阶段重复、阶段不属于当前方案或价格无效"
            }
          />
          <Button
            type="primary"
            disabled={!valid}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                plan: active,
                policy,
                overrides,
                operation: "changeSubscriptionPlan",
                targets: targets(p),
              })
            }
          >
            保存订阅变更
          </Button>
        </Flex>
      </Flex>
    );
  };

export const DocumentPermissionMovePlannerRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      collectionRef = f(p, "collectionNameFieldRef"),
      permissionRef = f(p, "permissionFieldRef"),
      parentRef = f(p, "parentCollectionFieldRef"),
      currentRef = f(p, "currentCollectionFieldRef"),
      writableRef = f(p, "writableFieldRef"),
      descendantRef = f(p, "descendantFieldRef"),
      [selected, setSelected] = React.useState(
        b?.rows.find(
          row =>
            !yes(row, currentRef) &&
            yes(row, writableRef) &&
            !yes(row, descendantRef)
        )?.id ?? ""
      );
    if (
      !b ||
      !collectionRef ||
      !permissionRef ||
      !parentRef ||
      !currentRef ||
      !writableRef ||
      !descendantRef
    )
      return missing(
        p,
        "document-permission-move-planner",
        "文档权限迁移规划器"
      );
    const current = b.rows.find(row => yes(row, currentRef)) ?? b.rows[0],
      destination = b.rows.find(row => row.id === selected),
      tree = (parent: string): any[] =>
        b.rows
          .filter(row => v(row, parentRef) === parent)
          .map(row => ({
            key: row.id,
            title: (
              <Space>
                <span>{v(row, collectionRef)}</span>
                <Tag>{v(row, permissionRef)}</Tag>
              </Space>
            ),
            children: tree(row.id),
            disabled: !yes(row, writableRef),
          })),
      valid = destination
        ? documentMoveValid(
            current.id,
            destination.id,
            yes(destination, writableRef),
            yes(destination, descendantRef)
          )
        : false;
    return shell(
      p,
      "document-permission-move-planner",
      "文档权限迁移规划器",
      <Flex vertical gap={12}>
        <Tree
          blockNode
          defaultExpandAll
          selectedKeys={selected ? [selected] : []}
          onSelect={keys => setSelected(String(keys[0] ?? ""))}
          treeData={tree("")}
        />
        {destination && (
          <Card size="small">
            <Flex align="center" justify="center" gap={14}>
              <Tag color="blue">{v(current, permissionRef)}</Tag>
              <ArrowRightOutlined />
              <Tag color={valid ? "green" : "red"}>
                {v(destination, permissionRef)}
              </Tag>
            </Flex>
            <Typography.Paragraph style={{ margin: "10px 0 0" }}>
              移动后所有工作区成员的文档权限将随目标集合变化。
            </Typography.Paragraph>
          </Card>
        )}
        <Button
          type="primary"
          block
          icon={<SwapOutlined />}
          disabled={!valid}
          onClick={() =>
            p.onAction?.("submitRequest", {
              entityRef: b.entityRef,
              sourceCollectionId: current.id,
              destinationCollectionId: destination?.id,
              operation: "moveDocument",
              targets: targets(p),
            })
          }
        >
          确认移动并变更权限
        </Button>
      </Flex>
    );
  };

export const CiStageJobGraphConsoleRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p),
    stageRef = f(p, "stageNameFieldRef"),
    jobRef = f(p, "jobNameFieldRef"),
    statusRef = f(p, "jobStatusFieldRef"),
    needsRef = f(p, "dependencyStatusFieldRef"),
    parallelRef = f(p, "parallelCountFieldRef"),
    authRef = f(p, "authorizedFieldRef"),
    [hovered, setHovered] = React.useState("");
  if (
    !b ||
    !stageRef ||
    !jobRef ||
    !statusRef ||
    !needsRef ||
    !parallelRef ||
    !authRef
  )
    return missing(p, "ci-stage-job-graph-console", "CI 阶段任务图控制台");
  const stages = [...new Set(b.rows.map(row => v(row, stageRef)))];
  return shell(
    p,
    "ci-stage-job-graph-console",
    "CI 阶段任务图控制台",
    <Flex vertical gap={12}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(stages.length, 4)},minmax(0,1fr))`,
          gap: 10,
        }}
      >
        {stages.map(stage => (
          <Card key={stage} size="small" title={stage}>
            {b.rows
              .filter(row => v(row, stageRef) === stage)
              .map(row => {
                const deps = v(row, needsRef).split(",").filter(Boolean),
                  canRun = ciJobCanRun(
                    v(row, statusRef),
                    yes(row, authRef),
                    deps
                  );
                return (
                  <Card
                    key={row.id}
                    size="small"
                    hoverable
                    onMouseEnter={() => setHovered(row.id)}
                    onMouseLeave={() => setHovered("")}
                    style={{
                      marginBottom: 8,
                      opacity: hovered && hovered !== row.id ? 0.55 : 1,
                    }}
                  >
                    <Flex justify="space-between">
                      <Space>
                        <Badge
                          status={
                            /failed/i.test(v(row, statusRef))
                              ? "error"
                              : /success/i.test(v(row, statusRef))
                                ? "success"
                                : "processing"
                          }
                        />
                        <Typography.Text strong>
                          {v(row, jobRef)}
                        </Typography.Text>
                      </Space>
                      {n(row, parallelRef) > 1 && (
                        <Tag>{n(row, parallelRef)} 并行</Tag>
                      )}
                    </Flex>
                    <Flex justify="space-between" style={{ marginTop: 8 }}>
                      <Typography.Text type="secondary">
                        {v(row, statusRef)}
                      </Typography.Text>
                      {canRun && (
                        <Button
                          size="small"
                          type="link"
                          icon={<PlayCircleOutlined />}
                          onClick={() =>
                            p.onAction?.("submitRequest", {
                              entityRef: b.entityRef,
                              jobId: row.id,
                              operation: /failed/i.test(v(row, statusRef))
                                ? "retryCiJob"
                                : "playCiJob",
                              targets: targets(p),
                            })
                          }
                        >
                          执行
                        </Button>
                      )}
                    </Flex>
                  </Card>
                );
              })}
          </Card>
        ))}
      </div>
      <Alert
        type="info"
        showIcon
        message="手动作业、失败重试和下游触发只在依赖完成且用户有更新流水线权限时开放。"
      />
    </Flex>
  );
};

export const SerialBatchAllocationScannerRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      itemRef = f(p, "itemNameFieldRef"),
      serialRef = f(p, "serialNumberFieldRef"),
      batchRef = f(p, "batchNumberFieldRef"),
      qtyRef = f(p, "quantityFieldRef"),
      requiredRef = f(p, "requiredQuantityFieldRef"),
      warehouseRef = f(p, "warehouseFieldRef"),
      [scan, setScan] = React.useState(""),
      [quantities, setQuantities] = React.useState<Record<string, number>>({});
    if (
      !b ||
      !itemRef ||
      !serialRef ||
      !batchRef ||
      !qtyRef ||
      !requiredRef ||
      !warehouseRef
    )
      return missing(
        p,
        "serial-batch-allocation-scanner",
        "序列号批次分配扫描器"
      );
    const required = n(b.rows[0], requiredRef),
      entries = b.rows.map(row => ({
        serial: v(row, serialRef),
        quantity: quantities[row.id] ?? n(row, qtyRef),
      })),
      allocated = entries.reduce((sum, x) => sum + x.quantity, 0),
      valid = serialBatchAllocationValid(required, entries);
    return shell(
      p,
      "serial-batch-allocation-scanner",
      "序列号批次分配扫描器",
      <Flex vertical gap={12}>
        <Input.Search
          value={scan}
          onChange={e => setScan(e.target.value)}
          onSearch={() => setScan("")}
          prefix={<QrcodeOutlined />}
          placeholder="扫描序列号或批次条码"
          enterButton="加入"
        />
        <Progress
          percent={required ? Math.min(100, (allocated / required) * 100) : 0}
          status={
            allocated > required ? "exception" : valid ? "success" : "active"
          }
          format={() => `${allocated}/${required}`}
        />
        <Collapse
          items={b.rows.map(row => ({
            key: row.id,
            label: (
              <Flex justify="space-between">
                <Space>
                  <Tag color={v(row, serialRef) ? "blue" : "purple"}>
                    {v(row, serialRef) || v(row, batchRef)}
                  </Tag>
                  <span>{v(row, itemRef)}</span>
                </Space>
                <span>{v(row, warehouseRef)}</span>
              </Flex>
            ),
            children: (
              <Flex gap={10} align="center">
                <Typography.Text type="secondary">
                  批次 {v(row, batchRef) || "-"}
                </Typography.Text>
                <InputNumber
                  min={0.0001}
                  value={quantities[row.id] ?? n(row, qtyRef)}
                  onChange={x =>
                    setQuantities(prev => ({
                      ...prev,
                      [row.id]: Number(x ?? 0),
                    }))
                  }
                  style={{ marginLeft: "auto" }}
                />
              </Flex>
            ),
          }))}
        />
        <Flex justify="space-between" align="center">
          <Alert
            type={valid ? "success" : "warning"}
            message={
              valid
                ? "序列号唯一且分配数量闭合"
                : "数量未闭合、存在重复序列号或无效数量"
            }
          />
          <Button
            type="primary"
            disabled={!valid}
            icon={<CheckCircleOutlined />}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                entries,
                operation: "saveSerialBatchBundle",
                targets: targets(p),
              })
            }
          >
            保存分配
          </Button>
        </Flex>
      </Flex>
    );
  };

export const INDEPENDENT_STRUCTURE_BATCH11_LABELS: Record<string, string> = {
  DatacenterRackUnitPlanner: "数据中心机架 U 位规划器",
  DeviceCommandDispatchConsole: "设备命令下发控制台",
  SubscriptionPhaseOverrideComposer: "订阅阶段价格覆盖编排器",
  DocumentPermissionMovePlanner: "文档权限迁移规划器",
  CiStageJobGraphConsole: "CI 阶段任务图控制台",
  SerialBatchAllocationScanner: "序列号批次分配扫描器",
};
