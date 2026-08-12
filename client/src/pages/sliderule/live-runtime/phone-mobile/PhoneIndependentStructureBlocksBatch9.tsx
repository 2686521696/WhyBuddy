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
  SearchBar,
  Selector,
  Space,
  Steps,
  Switch,
  Tabs,
  Tag,
} from "antd-mobile";
import {
  CheckShieldOutline,
  ClockCircleOutline,
  DeleteOutline,
  LinkOutline,
  MailOutline,
  SetOutline,
  UnorderedListOutline,
  UserOutline,
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

function PhoneFileShareAccessComposer(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    nameRef = field(p, "principalNameFieldRef"),
    kindRef = field(p, "shareKindFieldRef"),
    permissionRef = field(p, "permissionFieldRef"),
    expiryRef = field(p, "expiryFieldRef"),
    [mode, setMode] = React.useState("internal"),
    [recipient, setRecipient] = React.useState(""),
    [passwordOn, setPasswordOn] = React.useState(false),
    [password, setPassword] = React.useState("");
  if (!b || !nameRef || !kindRef || !permissionRef)
    return empty(p, "file-share-access-composer", "文件分享访问编排器");
  const ready =
    mode === "internal"
      ? Boolean(recipient)
      : !passwordOn || password.length >= 8;
  return shell(
    p,
    "file-share-access-composer",
    "文件分享访问编排器",
    <Space block direction="vertical">
      <Tabs activeKey={mode} onChange={setMode}>
        <Tabs.Tab title="人员" key="internal">
          <Form layout="horizontal">
            <Form.Item label="接收者">
              <Input
                value={recipient}
                onChange={setRecipient}
                placeholder="人员、群组或邮箱"
              />
            </Form.Item>
            <Form.Item label="权限">
              <Selector
                multiple
                columns={3}
                defaultValue={["read"]}
                options={[
                  { label: "查看", value: "read" },
                  { label: "编辑", value: "edit" },
                  { label: "转分享", value: "reshare" },
                ]}
              />
            </Form.Item>
          </Form>
        </Tabs.Tab>
        <Tabs.Tab title="公开链接" key="link">
          <List>
            <List.Item
              extra={<Switch checked={passwordOn} onChange={setPasswordOn} />}
            >
              密码保护
            </List.Item>
            {passwordOn && (
              <List.Item>
                <Input
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="至少 8 位"
                />
              </List.Item>
            )}
            <List.Item extra={<Switch />}>设置到期日</List.Item>
          </List>
        </Tabs.Tab>
      </Tabs>
      <Button
        block
        color="primary"
        disabled={!ready}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            mode,
            recipient,
            operation: "createFileShare",
            targets: targets(p),
          })
        }
      >
        <LinkOutline /> 添加分享
      </Button>
      <Collapse>
        {["internal", "link"].map(kind => (
          <Collapse.Panel
            key={kind}
            title={kind === "internal" ? "内部接收者" : "公开链接"}
          >
            {b.rows
              .filter(
                row =>
                  (kind === "link") === /link|public/i.test(value(row, kindRef))
              )
              .map(row => (
                <List.Item
                  key={row.id}
                  prefix={kind === "link" ? <LinkOutline /> : <UserOutline />}
                  description={value(row, expiryRef, "直接分享")}
                  extra={<Tag color="primary">{value(row, permissionRef)}</Tag>}
                >
                  {value(row, nameRef)}
                </List.Item>
              ))}
          </Collapse.Panel>
        ))}
      </Collapse>
    </Space>
  );
}

function PhoneIdentitySessionRevocationConsole(
  p: ExperienceBlockRendererProps
) {
  const b = bound(p),
    userRef = field(p, "userFieldRef"),
    clientRef = field(p, "clientFieldRef"),
    deviceRef = field(p, "deviceFieldRef"),
    ipRef = field(p, "ipAddressFieldRef"),
    accessRef = field(p, "lastAccessFieldRef"),
    [selected, setSelected] = React.useState<string[]>([]);
  if (!b || !userRef || !clientRef || !deviceRef || !ipRef || !accessRef)
    return empty(p, "identity-session-revocation-console", "身份会话撤销台");
  return shell(
    p,
    "identity-session-revocation-console",
    "身份会话撤销台",
    <Space block direction="vertical">
      <Tabs defaultActiveKey="sessions">
        <Tabs.Tab title={`会话 ${b.rows.length}`} key="sessions">
          <CheckList
            multiple
            value={selected}
            onChange={ids => setSelected(ids.map(String))}
          >
            {b.rows.map(row => (
              <CheckList.Item key={row.id} value={row.id}>
                <div>
                  <strong>{value(row, deviceRef)}</strong>{" "}
                  <Tag
                    color={
                      /current/i.test(value(row, deviceRef))
                        ? "success"
                        : "default"
                    }
                  >
                    {/current/i.test(value(row, deviceRef)) ? "当前" : "活动"}
                  </Tag>
                  <div style={{ color: "#666", fontSize: 12 }}>
                    {value(row, clientRef)} · {value(row, userRef)}
                  </div>
                  <div style={{ color: "#999", fontSize: 12 }}>
                    {value(row, ipRef)} · {value(row, accessRef)}
                  </div>
                </div>
              </CheckList.Item>
            ))}
          </CheckList>
        </Tabs.Tab>
        <Tabs.Tab title="风险" key="risk">
          <ErrorBlock
            status="busy"
            title="撤销后客户端必须重新认证"
            description="当前设备也可能退出登录"
          />
        </Tabs.Tab>
      </Tabs>
      <Button
        block
        color="danger"
        disabled={!selected.length}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            sessionIds: selected,
            operation: "revokeIdentitySessions",
            targets: targets(p),
          })
        }
      >
        <DeleteOutline /> 撤销所选 {selected.length || ""} 个会话
      </Button>
    </Space>
  );
}

function PhoneColumnLineageImpactExplorer(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    datasetRef = field(p, "datasetFieldRef"),
    columnRef = field(p, "columnFieldRef"),
    directionRef = field(p, "directionFieldRef"),
    depthRef = field(p, "depthFieldRef"),
    impactRef = field(p, "impactFieldRef"),
    [column, setColumn] = React.useState(""),
    [direction, setDirection] = React.useState("downstream"),
    [depth, setDepth] = React.useState("2");
  if (
    !b ||
    !datasetRef ||
    !columnRef ||
    !directionRef ||
    !depthRef ||
    !impactRef
  )
    return empty(p, "column-lineage-impact-explorer", "列级血缘影响探查器");
  const columns = [...new Set(b.rows.map(row => value(row, columnRef)))],
    selected = column || columns[0],
    visible = b.rows
      .filter(
        row =>
          value(row, columnRef) === selected ||
          value(row, directionRef) === direction
      )
      .filter(row => numeric(row, depthRef, 1) <= Number(depth));
  return shell(
    p,
    "column-lineage-impact-explorer",
    "列级血缘影响探查器",
    <Space block direction="vertical">
      <Selector
        columns={2}
        value={[direction]}
        onChange={keys => setDirection(keys[0])}
        options={[
          { label: "上游来源", value: "upstream" },
          { label: "下游影响", value: "downstream" },
        ]}
      />
      <SearchBar
        value={column}
        onChange={setColumn}
        placeholder={`当前列 ${selected}`}
      />
      <Selector
        columns={5}
        value={[depth]}
        onChange={keys => setDepth(keys[0])}
        options={[1, 2, 3, 4, 5].map(n => ({
          label: `${n} 层`,
          value: String(n),
        }))}
      />
      <Steps direction="vertical" current={visible.length - 1}>
        {visible.map(row => (
          <Steps.Step
            key={row.id}
            title={value(row, columnRef)}
            description={`${value(row, datasetRef)} · 影响 ${numeric(row, impactRef)}%`}
            icon={
              value(row, columnRef) === selected ? (
                <SetOutline />
              ) : (
                <UnorderedListOutline />
              )
            }
          />
        ))}
      </Steps>
      <Card title="影响覆盖">
        <ProgressBar
          percent={Math.min(
            100,
            visible.reduce((sum, row) => sum + numeric(row, impactRef), 0)
          )}
        />
        <small>
          {new Set(visible.map(row => value(row, datasetRef))).size} 个数据集 ·{" "}
          {visible.length} 个字段节点
        </small>
      </Card>
    </Space>
  );
}

function PhoneWorkflowCredentialBindingPanel(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    slotRef = field(p, "slotFieldRef"),
    credentialRef = field(p, "credentialFieldRef"),
    typeRef = field(p, "credentialTypeFieldRef"),
    statusRef = field(p, "testStatusFieldRef"),
    requiredRef = field(p, "requiredFieldRef"),
    [bindings, setBindings] = React.useState<Record<string, string>>({}),
    [tested, setTested] = React.useState<string[]>([]);
  if (
    !b ||
    !slotRef ||
    !credentialRef ||
    !typeRef ||
    !statusRef ||
    !requiredRef
  )
    return empty(
      p,
      "workflow-credential-binding-panel",
      "工作流节点凭据绑定面板"
    );
  const slots = [...new Set(b.rows.map(row => value(row, slotRef)))],
    ready = slots
      .filter(slot =>
        b.rows.some(
          row => value(row, slotRef) === slot && truthy(row, requiredRef)
        )
      )
      .every(
        slot =>
          Boolean(
            bindings[slot] ||
            value(
              b.rows.find(row => value(row, slotRef) === slot)!,
              credentialRef
            )
          ) &&
          (tested.includes(slot) ||
            /success/i.test(
              value(
                b.rows.find(row => value(row, slotRef) === slot)!,
                statusRef
              )
            ))
      );
  return shell(
    p,
    "workflow-credential-binding-panel",
    "工作流节点凭据绑定面板",
    <Space block direction="vertical">
      <Collapse accordion>
        {slots.map(slot => {
          const rows = b.rows.filter(row => value(row, slotRef) === slot),
            selected = bindings[slot] || value(rows[0], credentialRef),
            passed =
              tested.includes(slot) ||
              /success/i.test(value(rows[0], statusRef));
          return (
            <Collapse.Panel
              key={slot}
              title={
                <span>
                  {slot}{" "}
                  <Tag color={passed ? "success" : "warning"}>
                    {passed ? "通过" : "待测试"}
                  </Tag>
                </span>
              }
            >
              <Space block direction="vertical">
                <Selector
                  columns={1}
                  value={selected ? [selected] : []}
                  onChange={keys =>
                    setBindings(prev => ({ ...prev, [slot]: keys[0] }))
                  }
                  options={rows.map(row => ({
                    label:
                      value(row, credentialRef) ||
                      `新建 ${value(row, typeRef)}`,
                    value: value(row, credentialRef) || row.id,
                  }))}
                />
                <Button
                  block
                  fill="outline"
                  disabled={!selected}
                  onClick={() =>
                    setTested(items => [...new Set([...items, slot])])
                  }
                >
                  <CheckShieldOutline /> 测试连接
                </Button>
              </Space>
            </Collapse.Panel>
          );
        })}
      </Collapse>
      <Steps current={ready ? 2 : 1}>
        <Steps.Step title="选择" />
        <Steps.Step title="测试" />
        <Steps.Step title="绑定" />
      </Steps>
      <Button
        block
        color="primary"
        disabled={!ready}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            bindings,
            operation: "bindWorkflowCredentials",
            targets: targets(p),
          })
        }
      >
        保存节点凭据
      </Button>
    </Space>
  );
}

function PhoneMergeApprovalRuleMatrix(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    ruleRef = field(p, "ruleNameFieldRef"),
    requiredRef = field(p, "requiredCountFieldRef"),
    approvedRef = field(p, "approvedCountFieldRef"),
    approverRef = field(p, "approverFieldRef"),
    optionalRef = field(p, "optionalFieldRef"),
    invalidRef = field(p, "invalidFieldRef");
  if (!b || !ruleRef || !requiredRef || !approvedRef || !approverRef)
    return empty(p, "merge-approval-rule-matrix", "合并审批规则矩阵");
  const rules = [...new Set(b.rows.map(row => value(row, ruleRef)))].map(
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
    ready = rules.every(
      rule => rule.optional || (!rule.invalid && rule.approved >= rule.required)
    );
  return shell(
    p,
    "merge-approval-rule-matrix",
    "合并审批规则矩阵",
    <Space block direction="vertical">
      <Grid columns={2} gap={8}>
        {rules.map(rule => (
          <Grid.Item key={rule.name}>
            <Card title={rule.name}>
              <Tag
                color={
                  rule.invalid
                    ? "danger"
                    : rule.approved >= rule.required
                      ? "success"
                      : "warning"
                }
              >
                {rule.optional ? "可选" : `${rule.approved}/${rule.required}`}
              </Tag>
              <ProgressBar
                percent={
                  rule.required
                    ? Math.min(100, (rule.approved / rule.required) * 100)
                    : 100
                }
              />
            </Card>
          </Grid.Item>
        ))}
      </Grid>
      <Collapse accordion>
        {rules.map(rule => (
          <Collapse.Panel
            key={rule.name}
            title={`${rule.name} · 还需 ${Math.max(0, rule.required - rule.approved)} 人`}
          >
            <List>
              {rule.rows.map(row => (
                <List.Item
                  key={row.id}
                  prefix={<UserOutline />}
                  extra={
                    <Tag
                      color={truthy(row, approvedRef) ? "success" : "default"}
                    >
                      {truthy(row, approvedRef) ? "已批准" : "符合资格"}
                    </Tag>
                  }
                >
                  {value(row, approverRef)}
                </List.Item>
              ))}
            </List>
          </Collapse.Panel>
        ))}
      </Collapse>
      <Card>
        <div
          style={{
            padding: 10,
            color: ready ? "#1677ff" : "#ad6800",
            background: ready ? "#e6f4ff" : "#fff7e6",
            borderRadius: 4,
            textAlign: "center",
          }}
        >
          {ready ? "全部强制规则已满足" : "合并仍被规则阻塞"}
        </div>
      </Card>
      <Button
        block
        color="primary"
        disabled={ready}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            operation: "approveMergeRule",
            targets: targets(p),
          })
        }
      >
        <CheckShieldOutline /> 批准变更
      </Button>
    </Space>
  );
}

function PhoneDocumentMailRuleComposer(p: ExperienceBlockRendererProps) {
  const b = bound(p),
    accountRef = field(p, "accountFieldRef"),
    folderRef = field(p, "folderFieldRef"),
    conditionRef = field(p, "conditionFieldRef"),
    actionRef = field(p, "actionFieldRef"),
    metadataRef = field(p, "metadataFieldRef"),
    [step, setStep] = React.useState("source"),
    [account, setAccount] = React.useState(""),
    [folder, setFolder] = React.useState(""),
    [condition, setCondition] = React.useState(""),
    [action, setAction] = React.useState("mark-read"),
    [stop, setStop] = React.useState(false);
  if (
    !b ||
    !accountRef ||
    !folderRef ||
    !conditionRef ||
    !actionRef ||
    !metadataRef
  )
    return empty(p, "document-mail-rule-composer", "文档邮件规则编排器");
  const ready = Boolean(account && folder && condition && action);
  return shell(
    p,
    "document-mail-rule-composer",
    "文档邮件规则编排器",
    <Space block direction="vertical">
      <Tabs activeKey={step} onChange={setStep}>
        <Tabs.Tab title="邮件源" key="source">
          <Form>
            <Form.Item label="账户">
              <Selector
                columns={1}
                value={account ? [account] : []}
                onChange={keys => setAccount(keys[0])}
                options={[
                  ...new Set(b.rows.map(row => value(row, accountRef))),
                ].map(v => ({ label: v, value: v }))}
              />
            </Form.Item>
            <Form.Item label="文件夹">
              <Selector
                columns={2}
                value={folder ? [folder] : []}
                onChange={keys => setFolder(keys[0])}
                options={[
                  ...new Set(b.rows.map(row => value(row, folderRef))),
                ].map(v => ({ label: v, value: v }))}
              />
            </Form.Item>
          </Form>
        </Tabs.Tab>
        <Tabs.Tab title="匹配" key="match">
          <Space block direction="vertical">
            <Selector
              columns={2}
              options={[
                ...new Set(b.rows.map(row => value(row, conditionRef))),
              ].map(v => ({ label: v, value: v }))}
            />
            <Input
              value={condition}
              onChange={setCondition}
              placeholder="输入匹配内容"
            />
          </Space>
        </Tabs.Tab>
        <Tabs.Tab title="动作" key="action">
          <Space block direction="vertical">
            <Selector
              columns={2}
              value={[action]}
              onChange={keys => setAction(keys[0])}
              options={[
                { label: "标记已读", value: "mark-read" },
                { label: "移动邮件", value: "move" },
                { label: "加标签", value: "tag" },
              ]}
            />
            <List.Item extra={<Switch checked={stop} onChange={setStop} />}>
              停止后续规则
            </List.Item>
            <Space wrap>
              {b.rows.map(row => (
                <Tag key={row.id} color="primary">
                  {value(row, metadataRef)}
                </Tag>
              ))}
            </Space>
          </Space>
        </Tabs.Tab>
      </Tabs>
      <Card title="执行预览">
        <Steps direction="vertical" current={ready ? 3 : 1}>
          <Steps.Step title={account || "选择账户"} icon={<MailOutline />} />
          <Steps.Step title={condition || "设置匹配条件"} />
          <Steps.Step title={action} icon={<ClockCircleOutline />} />
          <Steps.Step title={stop ? "写入并停止" : "写入并继续"} />
        </Steps>
      </Card>
      <Button
        block
        color="primary"
        disabled={!ready}
        onClick={() =>
          p.onAction?.("submitRequest", {
            entityRef: b.entityRef,
            account,
            folder,
            condition,
            action,
            stopProcessing: stop,
            operation: "saveDocumentMailRule",
            targets: targets(p),
          })
        }
      >
        保存邮件规则
      </Button>
    </Space>
  );
}

export function renderIndependentStructureBatch9PhoneBlock(
  p: ExperienceBlockRendererProps
): React.ReactNode | undefined {
  switch (p.block.type) {
    case "FileShareAccessComposer":
      return <PhoneFileShareAccessComposer {...p} />;
    case "IdentitySessionRevocationConsole":
      return <PhoneIdentitySessionRevocationConsole {...p} />;
    case "ColumnLineageImpactExplorer":
      return <PhoneColumnLineageImpactExplorer {...p} />;
    case "WorkflowCredentialBindingPanel":
      return <PhoneWorkflowCredentialBindingPanel {...p} />;
    case "MergeApprovalRuleMatrix":
      return <PhoneMergeApprovalRuleMatrix {...p} />;
    case "DocumentMailRuleComposer":
      return <PhoneDocumentMailRuleComposer {...p} />;
    default:
      return undefined;
  }
}
