import React from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Popconfirm,
  Progress,
  Steps,
  Tag,
  Typography,
} from "antd";
import {
  ProForm,
  ProFormCheckbox,
  ProFormSelect,
  ProFormTextArea,
} from "@ant-design/pro-components";
import type {
  ExperienceBlockRenderer,
  ExperienceBlockRendererProps,
} from "./block-registry";

export type ConfigurationWizardPolicy = {
  title: string;
  testid: string;
  operation: string;
  confirm: string;
  draftLabel: string;
  requiresSelection?: boolean;
  requiresChoice?: boolean;
  requiresAcknowledgement?: boolean;
};

const valueText = (value: unknown, fallback = "") =>
  String(value ?? "").trim() || fallback;

const bindingRef = (props: ExperienceBlockRendererProps, key: string) =>
  valueText(props.block.binding?.[key]);

const blockedStatuses = new Set([
  "error",
  "invalid",
  "blocked",
  "failed",
  "denied",
  "conflict",
  "错误",
  "阻塞",
  "拒绝",
  "冲突",
]);

const finishedStatuses = new Set(["done", "complete", "ready", "完成"]);

function wizardRows(props: ExperienceBlockRendererProps) {
  const entityRef = bindingRef(props, "entityRef");
  return entityRef && props.entityRows && entityRef in props.entityRows
    ? { entityRef, rows: props.entityRows[entityRef] ?? [] }
    : null;
}

export function createConfigurationWizard(
  policy: ConfigurationWizardPolicy
): ExperienceBlockRenderer {
  return props => {
    const bound = wizardRows(props);
    const titleRef = bindingRef(props, "titleFieldRef");
    const statusRef = bindingRef(props, "statusFieldRef");
    const descRef = bindingRef(props, "descFieldRef");
    const [current, setCurrent] = React.useState(0);
    const [drafts, setDrafts] = React.useState<
      Record<string, Record<string, unknown>>
    >({});
    const title = valueText(props.block.props?.title, policy.title);
    const shell = (children: React.ReactNode) =>
      props.block.props?.surface === "plain" ? (
        <section data-testid={policy.testid}>{children}</section>
      ) : (
        <Card size="small" title={title} data-testid={policy.testid}>
          {children}
        </Card>
      );

    if (!bound || !titleRef || !statusRef)
      return shell(
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未绑定步骤标题和状态字段"
        />
      );
    if (!bound.rows.length)
      return shell(
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无配置步骤"
        />
      );

    const row = bound.rows[Math.min(current, bound.rows.length - 1)];
    const status = valueText(row.values?.[statusRef]);
    const blocked = blockedStatuses.has(status.toLowerCase());
    const selectedIds = props.selection?.rowIds?.[bound.entityRef] ?? [];
    const draft = drafts[row.id] ?? {};
    const choiceOptions =
      props.enumOptionsOf?.(bound.entityRef, statusRef)?.map(item => ({
        value: item.id,
        label: item.label,
      })) ?? [];
    const missingSelection =
      policy.requiresSelection === true && selectedIds.length === 0;
    const ready =
      !blocked &&
      !missingSelection &&
      (!policy.requiresChoice || Boolean(draft.choice)) &&
      (!policy.requiresAcknowledgement || draft.acknowledged === true);
    const updateDraft = (values: Record<string, unknown>) =>
      setDrafts(previous => ({
        ...previous,
        [row.id]: { ...(previous[row.id] ?? {}), ...values },
      }));
    const changeStep = (next: number) => {
      setCurrent(next);
      props.onAction?.("stepChange", {
        step: next,
        rowId: bound.rows[next]?.id,
        operation: policy.operation,
      });
    };
    const targets = Array.isArray(props.block.binding?.targets)
      ? props.block.binding.targets.map(String)
      : [];
    const submit = () =>
      props.onAction?.("submitRequest", {
        entityRef: bound.entityRef,
        operation: policy.operation,
        rowIds: policy.requiresSelection
          ? selectedIds
          : bound.rows.map(item => item.id),
        drafts,
        targets,
      });

    return shell(
      <>
        <Steps
          current={current}
          responsive
          items={bound.rows.map(item => ({
            title: valueText(item.values?.[titleRef], "未命名步骤"),
            status: finishedStatuses.has(
              valueText(item.values?.[statusRef]).toLowerCase()
            )
              ? "finish"
              : undefined,
          }))}
        />
        <Card size="small" style={{ marginTop: 16 }}>
          <Flex vertical gap={12}>
            <Flex justify="space-between" align="center" gap={8}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {valueText(row.values?.[titleRef], "未命名步骤")}
              </Typography.Title>
              <Tag color={blocked ? "error" : "processing"}>
                {status || "待配置"}
              </Tag>
            </Flex>
            {descRef && row.values?.[descRef] != null && (
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                {valueText(row.values[descRef])}
              </Typography.Paragraph>
            )}
            <ProForm
              key={row.id}
              submitter={false}
              initialValues={draft}
              onValuesChange={(_, values) => updateDraft(values)}
            >
              {policy.requiresChoice && (
                <ProFormSelect
                  name="choice"
                  label="配置选项"
                  placeholder="请选择后再继续"
                  options={choiceOptions}
                  rules={[{ required: true, message: "请选择配置项" }]}
                />
              )}
              <ProFormTextArea
                name="note"
                label={policy.draftLabel}
                placeholder="填写当前步骤的配置说明"
                fieldProps={{ autoSize: { minRows: 2, maxRows: 5 } }}
              />
              {policy.requiresAcknowledgement && (
                <ProFormCheckbox name="acknowledged">
                  我已核对当前步骤的影响范围和风险
                </ProFormCheckbox>
              )}
            </ProForm>
            {missingSelection && (
              <Alert
                type="warning"
                showIcon
                message="没有选中任何记录"
                description="请先在主体列表选择记录，再进入批量配置。"
              />
            )}
            {blocked && (
              <Alert
                type="error"
                showIcon
                message="当前步骤被阻塞"
                description="修正错误或解除冲突后才能继续。"
              />
            )}
            <Progress
              percent={Math.round(((current + 1) / bound.rows.length) * 100)}
              size="small"
            />
            <Flex justify="space-between">
              <Button
                disabled={current === 0}
                onClick={() => changeStep(Math.max(0, current - 1))}
              >
                上一步
              </Button>
              {current < bound.rows.length - 1 ? (
                <Button
                  type="primary"
                  disabled={!ready}
                  onClick={() => changeStep(current + 1)}
                >
                  下一步
                </Button>
              ) : (
                <Popconfirm
                  title={policy.confirm}
                  okText="确认提交"
                  cancelText="继续检查"
                  onConfirm={submit}
                >
                  <Button type="primary" disabled={!ready}>
                    完成配置
                  </Button>
                </Popconfirm>
              )}
            </Flex>
          </Flex>
        </Card>
      </>
    );
  };
}

export const CONFIGURATION_WIZARD_POLICIES: Record<
  string,
  ConfigurationWizardPolicy
> = {
  BulkOperationWizard: {
    title: "批量操作向导",
    testid: "bulk-operation-wizard",
    operation: "runBulkOperation",
    confirm: "确认对全部已选记录执行批量操作？",
    draftLabel: "批量变更说明",
    requiresSelection: true,
    requiresAcknowledgement: true,
  },
  DataQualityRepairWizard: {
    title: "数据质量修复向导",
    testid: "data-quality-repair-wizard",
    operation: "repairDataQuality",
    confirm: "确认提交修复计划并重新校验？",
    draftLabel: "修复规则",
    requiresChoice: true,
  },
  AccessRequestWizard: {
    title: "访问申请向导",
    testid: "access-request-wizard",
    operation: "requestAccess",
    confirm: "确认提交访问范围与有效期？",
    draftLabel: "申请理由",
    requiresAcknowledgement: true,
  },
  SurveyBuilderWizard: {
    title: "问卷构建向导",
    testid: "survey-builder-wizard",
    operation: "publishSurveyDraft",
    confirm: "确认题目、逻辑和发布范围？",
    draftLabel: "题目与逻辑草稿",
    requiresChoice: true,
  },
  CheckoutReviewWizard: {
    title: "结算复核向导",
    testid: "checkout-review-wizard",
    operation: "submitCheckout",
    confirm: "确认金额、地址和支付方式并提交？",
    draftLabel: "复核备注",
    requiresAcknowledgement: true,
  },
  WorkspaceCreationWizard: {
    title: "工作区创建向导",
    testid: "workspace-creation-wizard",
    operation: "createWorkspace",
    confirm: "确认创建工作区并邀请成员？",
    draftLabel: "工作区说明",
    requiresChoice: true,
  },
  ConnectorMigrationWizard: {
    title: "连接器迁移向导",
    testid: "connector-migration-wizard",
    operation: "migrateConnector",
    confirm: "确认版本、Schema 差异和停机窗口？",
    draftLabel: "迁移与回滚计划",
    requiresChoice: true,
    requiresAcknowledgement: true,
  },
  ApiCredentialWizard: {
    title: "API 凭据向导",
    testid: "api-credential-wizard",
    operation: "rotateApiCredential",
    confirm: "确认权限范围和凭据轮换？",
    draftLabel: "凭据用途",
    requiresAcknowledgement: true,
  },
  RoleAssignmentWizard: {
    title: "角色分配向导",
    testid: "role-assignment-wizard",
    operation: "assignRoles",
    confirm: "确认用户、角色和继承范围？",
    draftLabel: "分配依据",
    requiresChoice: true,
    requiresAcknowledgement: true,
  },
  ApprovalRoutingWizard: {
    title: "审批路由向导",
    testid: "approval-routing-wizard",
    operation: "saveApprovalRoute",
    confirm: "确认审批节点、顺序和例外条件？",
    draftLabel: "路由条件",
    requiresChoice: true,
  },
  DataRetentionWizard: {
    title: "数据保留向导",
    testid: "data-retention-wizard",
    operation: "applyRetentionPolicy",
    confirm: "确认保留周期和删除影响？",
    draftLabel: "保留与例外规则",
    requiresChoice: true,
    requiresAcknowledgement: true,
  },
  NotificationRuleWizard: {
    title: "通知规则向导",
    testid: "notification-rule-wizard",
    operation: "saveNotificationRule",
    confirm: "确认触发条件、接收人和静默窗口？",
    draftLabel: "通知条件",
    requiresChoice: true,
  },
  ReportScheduleWizard: {
    title: "报表计划向导",
    testid: "report-schedule-wizard",
    operation: "scheduleReport",
    confirm: "确认报表范围、频率和接收人？",
    draftLabel: "发送说明",
    requiresChoice: true,
  },
  LocalizationSetupWizard: {
    title: "本地化设置向导",
    testid: "localization-setup-wizard",
    operation: "saveLocalization",
    confirm: "确认语言、区域和回退策略？",
    draftLabel: "本地化说明",
    requiresChoice: true,
  },
  RecoveryPlanWizard: {
    title: "恢复计划向导",
    testid: "recovery-plan-wizard",
    operation: "activateRecoveryPlan",
    confirm: "确认恢复顺序、责任人和演练结果？",
    draftLabel: "恢复与回退步骤",
    requiresAcknowledgement: true,
  },
  ComplianceAttestationWizard: {
    title: "合规证明向导",
    testid: "compliance-attestation-wizard",
    operation: "submitAttestation",
    confirm: "确认所有证据真实完整并提交证明？",
    draftLabel: "证据说明",
    requiresAcknowledgement: true,
  },
};

export const CONFIGURATION_WIZARD_RENDERERS: Record<
  string,
  ExperienceBlockRenderer
> = Object.fromEntries(
  Object.entries(CONFIGURATION_WIZARD_POLICIES).map(([type, policy]) => [
    type,
    createConfigurationWizard(policy),
  ])
);
