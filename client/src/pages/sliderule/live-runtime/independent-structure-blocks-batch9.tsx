import React from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  DatePicker,
  Descriptions,
  Divider,
  Flex,
  Input,
  List,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Slider,
  Space,
  Steps,
  Switch,
  Tag,
  Timeline,
  Typography,
} from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  LinkOutlined,
  MailOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  ShareAltOutlined,
  StopOutlined,
  UserOutlined,
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
  /true|yes|enabled|active|approved|valid|success|1/i.test(value(row, ref));
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

export const shareDraftValid = (
  kind: string,
  recipient: string,
  passwordRequired: boolean,
  password: string,
  expiryRequired: boolean,
  expiry: string
) =>
  kind === "internal"
    ? Boolean(recipient)
    : (!passwordRequired || password.trim().length >= 8) &&
      (!expiryRequired || Boolean(expiry));
export const sessionSelectionCanRevoke = (selectedIds: string[]) =>
  selectedIds.length > 0 && new Set(selectedIds).size === selectedIds.length;
export const lineageDepthValid = (depth: number) =>
  Number.isInteger(depth) && depth >= 1 && depth <= 5;
export const credentialSlotsReady = (
  requiredSlots: string[],
  boundSlots: Record<string, string>,
  testStates: Record<string, string>
) =>
  requiredSlots.length > 0 &&
  requiredSlots.every(
    slot => Boolean(boundSlots[slot]) && testStates[slot] === "success"
  );
export const approvalRulesSatisfied = (
  rules: Array<{
    required: number;
    approved: number;
    optional?: boolean;
    invalid?: boolean;
  }>
) =>
  rules.every(
    rule => rule.optional || (!rule.invalid && rule.approved >= rule.required)
  );
export const mailRuleDraftValid = (
  account: string,
  folder: string,
  conditions: string[],
  action: string,
  actionParameter = ""
) =>
  Boolean(
    account &&
    folder &&
    conditions.some(Boolean) &&
    action &&
    (!/move|tag/i.test(action) || actionParameter)
  );

export const FileShareAccessComposerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p),
    nameRef = field(p, "principalNameFieldRef"),
    kindRef = field(p, "shareKindFieldRef"),
    permissionRef = field(p, "permissionFieldRef"),
    expiryRef = field(p, "expiryFieldRef"),
    statusRef = field(p, "statusFieldRef");
  const [mode, setMode] = React.useState<"internal" | "link">("internal"),
    [recipient, setRecipient] = React.useState(""),
    [passwordOn, setPasswordOn] = React.useState(false),
    [password, setPassword] = React.useState(""),
    [expiryOn, setExpiryOn] = React.useState(false),
    [expiry, setExpiry] = React.useState("");
  if (!b || !nameRef || !kindRef || !permissionRef)
    return missing(p, "file-share-access-composer", "文件分享访问编排器");
  const internal = b.rows.filter(
      row => !/link|public/i.test(value(row, kindRef))
    ),
    links = b.rows.filter(row => /link|public/i.test(value(row, kindRef))),
    ready = shareDraftValid(
      mode,
      recipient,
      passwordOn,
      password,
      expiryOn,
      expiry
    );
  return shell(
    p,
    "file-share-access-composer",
    "文件分享访问编排器",
    <Flex vertical gap={14}>
      <Segmented
        value={mode}
        onChange={v => setMode(v as "internal" | "link")}
        options={[
          { label: "人员与群组", value: "internal", icon: <UserOutlined /> },
          { label: "公开链接", value: "link", icon: <LinkOutlined /> },
        ]}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.15fr) minmax(280px,.85fr)",
          gap: 14,
        }}
      >
        <Card
          size="small"
          title={mode === "internal" ? "添加接收者" : "创建分享链接"}
        >
          {mode === "internal" ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input
                prefix={<UserOutlined />}
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                placeholder="输入人员、群组或邮箱"
              />
              <Select
                mode="multiple"
                style={{ width: "100%" }}
                defaultValue={["read"]}
                options={[
                  { value: "read", label: "查看" },
                  { value: "edit", label: "编辑" },
                  { value: "reshare", label: "再次分享" },
                ]}
              />
            </Space>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Flex justify="space-between">
                <Typography.Text>密码保护</Typography.Text>
                <Switch checked={passwordOn} onChange={setPasswordOn} />
              </Flex>
              {passwordOn && (
                <Input.Password
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="至少 8 位密码"
                />
              )}
              <Flex justify="space-between">
                <Typography.Text>链接到期</Typography.Text>
                <Switch checked={expiryOn} onChange={setExpiryOn} />
              </Flex>
              {expiryOn && (
                <DatePicker
                  style={{ width: "100%" }}
                  onChange={(_, text) => setExpiry(String(text))}
                />
              )}
            </Space>
          )}
          <Button
            type="primary"
            block
            icon={<PlusOutlined />}
            disabled={!ready}
            style={{ marginTop: 14 }}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                mode,
                recipient,
                passwordProtected: passwordOn,
                expiry,
                operation: "createFileShare",
                targets: targets(p),
              })
            }
          >
            添加分享
          </Button>
        </Card>
        <Card
          size="small"
          title="访问边界"
          extra={<Badge count={internal.length + links.length} showZero />}
        >
          <Alert
            type="info"
            showIcon
            message="继承权限只读展示，直接分享可单独修改或撤销。"
          />
          <Descriptions
            size="small"
            column={1}
            style={{ marginTop: 10 }}
            items={[
              { key: "permission", label: "默认权限", children: "查看与下载" },
              {
                key: "expiry",
                label: "链接策略",
                children: expiryOn ? `到期 ${expiry}` : "不过期",
              },
            ]}
          />
        </Card>
      </div>
      <Collapse
        items={[
          {
            key: "internal",
            label: `内部接收者 (${internal.length})`,
            children: (
              <List
                dataSource={internal}
                renderItem={row => (
                  <List.Item
                    actions={[
                      <Button
                        key="revoke"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<Avatar icon={<UserOutlined />} />}
                      title={value(row, nameRef)}
                      description={value(row, statusRef, "直接分享")}
                    />
                    <Tag color="blue">{value(row, permissionRef)}</Tag>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: "links",
            label: `公开链接 (${links.length})`,
            children: (
              <List
                dataSource={links}
                renderItem={row => (
                  <List.Item
                    actions={[
                      <Button key="copy" type="text" icon={<CopyOutlined />} />,
                      <Button
                        key="revoke"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<Avatar icon={<LinkOutlined />} />}
                      title={value(row, nameRef, "公开链接")}
                      description={value(row, expiryRef, "永久有效")}
                    />
                    <Tag color="processing">{value(row, permissionRef)}</Tag>
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />
    </Flex>
  );
};

export const IdentitySessionRevocationConsoleRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      userRef = field(p, "userFieldRef"),
      clientRef = field(p, "clientFieldRef"),
      deviceRef = field(p, "deviceFieldRef"),
      ipRef = field(p, "ipAddressFieldRef"),
      accessRef = field(p, "lastAccessFieldRef"),
      [scope, setScope] = React.useState("active"),
      [selected, setSelected] = React.useState<string[]>([]);
    if (!b || !userRef || !clientRef || !deviceRef || !ipRef || !accessRef)
      return missing(
        p,
        "identity-session-revocation-console",
        "身份会话撤销台"
      );
    const rows =
      scope === "active"
        ? b.rows
        : b.rows.filter(row => /current/i.test(value(row, deviceRef)));
    return shell(
      p,
      "identity-session-revocation-console",
      "身份会话撤销台",
      <Flex vertical gap={12}>
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Segmented
            value={scope}
            onChange={v => setScope(String(v))}
            options={[
              { label: `全部活动 ${b.rows.length}`, value: "active" },
              { label: "当前设备", value: "current" },
            ]}
          />
          <Space>
            <Button
              disabled={!sessionSelectionCanRevoke(selected)}
              icon={<DisconnectOutlined />}
            >
              撤销所选
            </Button>
            <Popconfirm
              title="撤销全部会话？"
              description="当前登录会话也会失效。"
              okText="确认撤销"
              cancelText="取消"
              onConfirm={() =>
                p.onAction?.("submitRequest", {
                  entityRef: b.entityRef,
                  sessionIds: b.rows.map(row => row.id),
                  operation: "revokeIdentitySessions",
                  targets: targets(p),
                })
              }
            >
              <Button danger icon={<StopOutlined />}>
                撤销全部
              </Button>
            </Popconfirm>
          </Space>
        </Flex>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2,minmax(0,1fr))",
            gap: 10,
          }}
        >
          {rows.map(row => {
            const checked = selected.includes(row.id);
            return (
              <Card
                key={row.id}
                size="small"
                styles={{
                  body: {
                    padding: 12,
                    outline: checked ? "2px solid #1677ff" : undefined,
                  },
                }}
              >
                <Flex align="start" gap={10}>
                  <Checkbox
                    checked={checked}
                    onChange={e =>
                      setSelected(ids =>
                        e.target.checked
                          ? [...ids, row.id]
                          : ids.filter(id => id !== row.id)
                      )
                    }
                  />
                  <Avatar icon={<ApiOutlined />} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Flex justify="space-between" gap={6}>
                      <Typography.Text strong ellipsis>
                        {value(row, deviceRef)}
                      </Typography.Text>
                      <Tag
                        color={
                          /current/i.test(value(row, deviceRef))
                            ? "success"
                            : "default"
                        }
                      >
                        {/current/i.test(value(row, deviceRef))
                          ? "当前"
                          : "活动"}
                      </Tag>
                    </Flex>
                    <Typography.Text type="secondary">
                      {value(row, clientRef)} · {value(row, userRef)}
                    </Typography.Text>
                    <Descriptions
                      size="small"
                      column={1}
                      style={{ marginTop: 8 }}
                      items={[
                        { key: "ip", label: "IP", children: value(row, ipRef) },
                        {
                          key: "access",
                          label: "最近访问",
                          children: value(row, accessRef),
                        },
                      ]}
                    />
                  </div>
                </Flex>
              </Card>
            );
          })}
        </div>
        <Alert
          type={selected.length ? "warning" : "info"}
          showIcon
          message={
            selected.length
              ? `将使 ${selected.length} 个客户端立即重新登录`
              : "选择具体会话可精确撤销；撤销全部需要二次确认。"
          }
        />
      </Flex>
    );
  };

export const ColumnLineageImpactExplorerRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      datasetRef = field(p, "datasetFieldRef"),
      columnRef = field(p, "columnFieldRef"),
      directionRef = field(p, "directionFieldRef"),
      depthRef = field(p, "depthFieldRef"),
      impactRef = field(p, "impactFieldRef"),
      [column, setColumn] = React.useState(""),
      [direction, setDirection] = React.useState("downstream"),
      [depth, setDepth] = React.useState(2);
    if (
      !b ||
      !datasetRef ||
      !columnRef ||
      !directionRef ||
      !depthRef ||
      !impactRef
    )
      return missing(p, "column-lineage-impact-explorer", "列级血缘影响探查器");
    const columns = [...new Set(b.rows.map(row => value(row, columnRef)))],
      selected = column || columns[0],
      visible = b.rows
        .filter(
          row =>
            value(row, columnRef) === selected ||
            value(row, directionRef) === direction
        )
        .filter(row => numeric(row, depthRef, 1) <= depth),
      impacted = visible.filter(row => value(row, columnRef) !== selected);
    return shell(
      p,
      "column-lineage-impact-explorer",
      "列级血缘影响探查器",
      <Flex vertical gap={14}>
        <Flex align="center" gap={12} wrap>
          <Select
            value={selected}
            onChange={setColumn}
            style={{ minWidth: 220 }}
            options={columns.map(item => ({ value: item, label: item }))}
          />
          <Segmented
            value={direction}
            onChange={v => setDirection(String(v))}
            options={[
              { label: "上游来源", value: "upstream" },
              { label: "下游影响", value: "downstream" },
            ]}
          />
          <div style={{ width: 220 }}>
            <Typography.Text type="secondary">深度 {depth}</Typography.Text>
            <Slider min={1} max={5} value={depth} onChange={setDepth} />
          </div>
        </Flex>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 260px",
            gap: 14,
          }}
        >
          <Card size="small" title={`路径高亮 · ${selected}`}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${Math.max(1, depth + 1)},minmax(0,1fr))`,
                gap: 8,
                alignItems: "center",
                minHeight: 210,
              }}
            >
              {Array.from({ length: depth + 1 }, (_, lane) => (
                <Flex key={lane} vertical gap={9}>
                  {visible
                    .filter(
                      row =>
                        Math.min(depth, numeric(row, depthRef)) === lane ||
                        (lane === 0 && value(row, columnRef) === selected)
                    )
                    .map(row => (
                      <div
                        key={row.id}
                        style={{
                          padding: 10,
                          border:
                            value(row, columnRef) === selected
                              ? "2px solid #1677ff"
                              : "1px solid #d9d9d9",
                          borderRadius: 6,
                          background:
                            value(row, columnRef) === selected
                              ? "#e6f4ff"
                              : "#fff",
                        }}
                      >
                        <Typography.Text strong ellipsis>
                          {value(row, columnRef)}
                        </Typography.Text>
                        <br />
                        <Typography.Text type="secondary" ellipsis>
                          {value(row, datasetRef)}
                        </Typography.Text>
                      </div>
                    ))}
                </Flex>
              ))}
            </div>
          </Card>
          <Flex vertical gap={10}>
            <Card size="small" title="影响摘要">
              <Progress
                type="circle"
                percent={Math.min(
                  100,
                  impacted.reduce((n, row) => n + numeric(row, impactRef), 0)
                )}
                size={120}
              />
              <Divider />
              <Space wrap>
                <Tag color="blue">{impacted.length} 列</Tag>
                <Tag color="purple">
                  {new Set(impacted.map(row => value(row, datasetRef))).size}{" "}
                  数据集
                </Tag>
              </Space>
            </Card>
            {!lineageDepthValid(depth) && (
              <Alert type="error" message="影响深度超出 1-5 层" />
            )}
          </Flex>
        </div>
      </Flex>
    );
  };

export const WorkflowCredentialBindingPanelRenderer: ExperienceBlockRenderer =
  p => {
    const b = bound(p),
      slotRef = field(p, "slotFieldRef"),
      credentialRef = field(p, "credentialFieldRef"),
      typeRef = field(p, "credentialTypeFieldRef"),
      statusRef = field(p, "testStatusFieldRef"),
      requiredRef = field(p, "requiredFieldRef"),
      [bindings, setBindings] = React.useState<Record<string, string>>({}),
      [tests, setTests] = React.useState<Record<string, string>>({});
    if (
      !b ||
      !slotRef ||
      !credentialRef ||
      !typeRef ||
      !statusRef ||
      !requiredRef
    )
      return missing(
        p,
        "workflow-credential-binding-panel",
        "工作流节点凭据绑定面板"
      );
    const slots = [...new Set(b.rows.map(row => value(row, slotRef)))],
      required = slots.filter(slot =>
        b.rows.some(
          row => value(row, slotRef) === slot && truthy(row, requiredRef)
        )
      ),
      initial = Object.fromEntries(
        slots.map(slot => [
          slot,
          value(
            b.rows.find(row => value(row, slotRef) === slot)!,
            credentialRef
          ),
        ])
      ),
      effective = { ...initial, ...bindings },
      effectiveTests = Object.fromEntries(
        slots.map(slot => [
          slot,
          tests[slot] ??
            value(
              b.rows.find(row => value(row, slotRef) === slot)!,
              statusRef
            ),
        ])
      ),
      ready = credentialSlotsReady(required, effective, effectiveTests);
    return shell(
      p,
      "workflow-credential-binding-panel",
      "工作流节点凭据绑定面板",
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 250px",
          gap: 14,
        }}
      >
        <Flex vertical gap={10}>
          {slots.map((slot, index) => {
            const candidates = b.rows.filter(
                row => value(row, slotRef) === slot
              ),
              selected = effective[slot],
              state = effectiveTests[slot];
            return (
              <Card
                key={slot}
                size="small"
                title={
                  <Space>
                    <Badge
                      status={
                        state === "success"
                          ? "success"
                          : state === "testing"
                            ? "processing"
                            : state === "error"
                              ? "error"
                              : "default"
                      }
                    />
                    <span>{slot}</span>
                    {required.includes(slot) && <Tag color="red">必填</Tag>}
                  </Space>
                }
                extra={
                  <Button type="link" size="small">
                    编辑
                  </Button>
                }
              >
                <Flex gap={8} align="center">
                  <Select
                    value={selected || undefined}
                    placeholder={`选择 ${value(candidates[0], typeRef)}`}
                    style={{ flex: 1 }}
                    onChange={v => {
                      setBindings(prev => ({ ...prev, [slot]: v }));
                      setTests(prev => ({ ...prev, [slot]: "idle" }));
                    }}
                    options={candidates.map(row => ({
                      value: value(row, credentialRef),
                      label:
                        value(row, credentialRef) ||
                        `新建 ${value(row, typeRef)}`,
                    }))}
                  />
                  <Button
                    icon={<SafetyCertificateOutlined />}
                    disabled={!selected}
                    loading={state === "testing"}
                    onClick={() => {
                      setTests(prev => ({ ...prev, [slot]: "testing" }));
                      setTimeout(
                        () =>
                          setTests(prev => ({ ...prev, [slot]: "success" })),
                        300
                      );
                    }}
                  >
                    测试
                  </Button>
                </Flex>
                {state === "error" && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type="error"
                    showIcon
                    message="连接测试失败，请编辑凭据后重试。"
                  />
                )}
              </Card>
            );
          })}
        </Flex>
        <Card size="small" title="节点就绪度">
          <Steps
            direction="vertical"
            size="small"
            current={ready ? 3 : 1}
            items={[
              { title: "选择凭据" },
              { title: "后台连接测试" },
              { title: "绑定节点" },
            ]}
          />
          <Progress
            percent={Math.round(
              (slots.filter(slot => effectiveTests[slot] === "success").length /
                slots.length) *
                100
            )}
          />
          <Button
            type="primary"
            block
            icon={<CheckCircleOutlined />}
            disabled={!ready}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                bindings: effective,
                operation: "bindWorkflowCredentials",
                targets: targets(p),
              })
            }
          >
            保存节点凭据
          </Button>
        </Card>
      </div>
    );
  };

export const MergeApprovalRuleMatrixRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p),
    ruleRef = field(p, "ruleNameFieldRef"),
    requiredRef = field(p, "requiredCountFieldRef"),
    approvedRef = field(p, "approvedCountFieldRef"),
    approverRef = field(p, "approverFieldRef"),
    optionalRef = field(p, "optionalFieldRef"),
    invalidRef = field(p, "invalidFieldRef"),
    [expanded, setExpanded] = React.useState<string[]>([]);
  if (!b || !ruleRef || !requiredRef || !approvedRef || !approverRef)
    return missing(p, "merge-approval-rule-matrix", "合并审批规则矩阵");
  const grouped = [...new Set(b.rows.map(row => value(row, ruleRef)))].map(
      name => {
        const rows = b.rows.filter(row => value(row, ruleRef) === name),
          first = rows[0];
        return {
          name,
          rows,
          required: numeric(first, requiredRef),
          approved: numeric(first, approvedRef),
          optional: truthy(first, optionalRef),
          invalid: truthy(first, invalidRef),
        };
      }
    ),
    satisfied = approvalRulesSatisfied(grouped);
  return shell(
    p,
    "merge-approval-rule-matrix",
    "合并审批规则矩阵",
    <Flex vertical gap={12}>
      <Flex gap={12} wrap>
        {grouped.map(rule => (
          <Card
            key={rule.name}
            size="small"
            style={{
              flex: "1 1 190px",
              borderTop: `3px solid ${rule.invalid ? "#ff4d4f" : rule.approved >= rule.required ? "#52c41a" : "#faad14"}`,
            }}
          >
            <Typography.Text type="secondary">
              {rule.optional ? "可选规则" : "必需规则"}
            </Typography.Text>
            <Typography.Title level={5} ellipsis style={{ margin: "3px 0" }}>
              {rule.name}
            </Typography.Title>
            <Progress
              percent={
                rule.optional
                  ? 100
                  : rule.required
                    ? Math.min(100, (rule.approved / rule.required) * 100)
                    : 100
              }
              format={() =>
                rule.optional ? "可选" : `${rule.approved}/${rule.required}`
              }
              status={rule.invalid ? "exception" : undefined}
            />
          </Card>
        ))}
      </Flex>
      <Collapse
        activeKey={expanded}
        onChange={keys => setExpanded(keys as string[])}
        items={grouped.map(rule => ({
          key: rule.name,
          label: (
            <Flex justify="space-between" style={{ width: "100%" }}>
              <Space>
                <Badge
                  status={
                    rule.invalid
                      ? "error"
                      : rule.approved >= rule.required
                        ? "success"
                        : "warning"
                  }
                />
                <Typography.Text strong>{rule.name}</Typography.Text>
              </Space>
              <Typography.Text type="secondary">
                还需 {Math.max(0, rule.required - rule.approved)} 人
              </Typography.Text>
            </Flex>
          ),
          children: (
            <Flex justify="space-between" align="center" wrap gap={8}>
              <Avatar.Group max={{ count: 4 }}>
                {rule.rows.map(row => (
                  <Avatar key={row.id}>
                    {value(row, approverRef).slice(0, 1)}
                  </Avatar>
                ))}
              </Avatar.Group>
              <Space wrap>
                {rule.rows.map(row => (
                  <Tag
                    key={row.id}
                    color={truthy(row, approvedRef) ? "success" : "default"}
                  >
                    {value(row, approverRef)}
                  </Tag>
                ))}
              </Space>
            </Flex>
          ),
        }))}
      />
      {grouped.some(rule => rule.invalid) && (
        <Alert
          type="error"
          showIcon
          message="存在无法满足的审批规则，禁止合并。"
        />
      )}
      <Flex justify="space-between" align="center">
        <Typography.Text>
          {satisfied ? "所有强制规则已达到法定人数" : "合并仍被审批规则阻塞"}
        </Typography.Text>
        <Button
          type="primary"
          icon={<SafetyCertificateOutlined />}
          disabled={satisfied}
          onClick={() =>
            p.onAction?.("submitRequest", {
              entityRef: b.entityRef,
              operation: "approveMergeRule",
              targets: targets(p),
            })
          }
        >
          批准变更
        </Button>
      </Flex>
    </Flex>
  );
};

export const DocumentMailRuleComposerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p),
    accountRef = field(p, "accountFieldRef"),
    folderRef = field(p, "folderFieldRef"),
    conditionRef = field(p, "conditionFieldRef"),
    actionRef = field(p, "actionFieldRef"),
    parameterRef = field(p, "actionParameterFieldRef"),
    metadataRef = field(p, "metadataFieldRef"),
    [account, setAccount] = React.useState(""),
    [folder, setFolder] = React.useState("INBOX"),
    [conditions, setConditions] = React.useState<Record<string, string>>({}),
    [action, setAction] = React.useState("mark-read"),
    [parameter, setParameter] = React.useState(""),
    [stop, setStop] = React.useState(false);
  if (
    !b ||
    !accountRef ||
    !folderRef ||
    !conditionRef ||
    !actionRef ||
    !metadataRef
  )
    return missing(p, "document-mail-rule-composer", "文档邮件规则编排器");
  const accounts = [...new Set(b.rows.map(row => value(row, accountRef)))],
    folders = [...new Set(b.rows.map(row => value(row, folderRef)))],
    conditionKeys = [...new Set(b.rows.map(row => value(row, conditionRef)))],
    ready = mailRuleDraftValid(
      account,
      folder,
      Object.values(conditions),
      action,
      parameter
    );
  return shell(
    p,
    "document-mail-rule-composer",
    "文档邮件规则编排器",
    <Flex vertical gap={14}>
      <Steps
        size="small"
        current={2}
        items={[
          { title: "邮件源" },
          { title: "匹配条件" },
          { title: "文档动作" },
        ]}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.25fr) minmax(280px,.75fr)",
          gap: 14,
        }}
      >
        <Flex vertical gap={10}>
          <Card size="small" title="1. 邮件源">
            <Flex gap={8}>
              <Select
                placeholder="邮件账户"
                value={account || undefined}
                onChange={setAccount}
                style={{ flex: 1 }}
                options={accounts.map(v => ({ value: v, label: v }))}
              />
              <Select
                value={folder}
                onChange={setFolder}
                style={{ flex: 1 }}
                options={folders.map(v => ({ value: v, label: v }))}
              />
            </Flex>
          </Card>
          <Card size="small" title="2. 至少一个匹配条件">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                gap: 8,
              }}
            >
              {conditionKeys.map(key => (
                <Space.Compact key={key} block>
                  <Typography.Text
                    style={{
                      width: 70,
                      flex: "0 0 70px",
                      padding: "5px 8px",
                      textAlign: "center",
                      background: "#fafafa",
                      border: "1px solid #d9d9d9",
                      borderInlineEnd: 0,
                      borderRadius: "6px 0 0 6px",
                    }}
                  >
                    {key}
                  </Typography.Text>
                  <Input
                    value={conditions[key] ?? ""}
                    onChange={e =>
                      setConditions(prev => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                  />
                </Space.Compact>
              ))}
            </div>
          </Card>
          <Card size="small" title="3. 消费与文档动作">
            <Flex gap={8} wrap>
              <Select
                value={action}
                onChange={setAction}
                style={{ minWidth: 190 }}
                options={[
                  { value: "mark-read", label: "标记已读" },
                  { value: "move", label: "移动邮件" },
                  { value: "tag", label: "标记邮件" },
                ]}
              />
              {/move|tag/.test(action) && (
                <Input
                  value={parameter}
                  onChange={e => setParameter(e.target.value)}
                  placeholder={action === "move" ? "目标文件夹" : "邮件标签"}
                  style={{ flex: 1, minWidth: 180 }}
                />
              )}
            </Flex>
            <Divider />
            <Space wrap>
              {b.rows.map(row => (
                <Tag key={row.id} color="blue">
                  {value(row, metadataRef)}
                </Tag>
              ))}
            </Space>
            <Flex justify="space-between" style={{ marginTop: 12 }}>
              <Typography.Text>匹配后停止后续规则</Typography.Text>
              <Switch checked={stop} onChange={setStop} />
            </Flex>
          </Card>
        </Flex>
        <Card size="small" title="规则预览">
          <Timeline
            items={[
              {
                dot: <MailOutlined />,
                children: account ? `${account} / ${folder}` : "选择邮件源",
              },
              {
                color: Object.values(conditions).some(Boolean)
                  ? "green"
                  : "gray",
                children:
                  Object.entries(conditions)
                    .filter(([, v]) => v)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("；") || "等待匹配条件",
              },
              {
                dot: <ShareAltOutlined />,
                children: `邮件动作：${action}${parameter ? ` → ${parameter}` : ""}`,
              },
              {
                dot: <SendOutlined />,
                color: ready ? "green" : "gray",
                children: stop
                  ? "写入文档并停止后续规则"
                  : "写入文档后继续匹配",
              },
            ]}
          />
          {!ready && (
            <Alert
              type="warning"
              showIcon
              message="邮件源、条件或动作参数尚不完整。"
            />
          )}
          <Button
            type="primary"
            block
            icon={<SendOutlined />}
            disabled={!ready}
            onClick={() =>
              p.onAction?.("submitRequest", {
                entityRef: b.entityRef,
                account,
                folder,
                conditions,
                action,
                parameter,
                stopProcessing: stop,
                operation: "saveDocumentMailRule",
                targets: targets(p),
              })
            }
          >
            保存邮件规则
          </Button>
        </Card>
      </div>
    </Flex>
  );
};

export const INDEPENDENT_STRUCTURE_BATCH9_LABELS: Record<string, string> = {
  FileShareAccessComposer: "文件分享访问编排器",
  IdentitySessionRevocationConsole: "身份会话撤销台",
  ColumnLineageImpactExplorer: "列级血缘影响探查器",
  WorkflowCredentialBindingPanel: "工作流节点凭据绑定面板",
  MergeApprovalRuleMatrix: "合并审批规则矩阵",
  DocumentMailRuleComposer: "文档邮件规则编排器",
};
