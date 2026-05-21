---
inclusion: manual
---

# Web-AIGC 高风险节点审计要求矩阵

## 1. 文档目的

本文档用于为 Web-AIGC 平台中的高风险节点补齐统一审计要求，确保以下目标可以落地：

- 高风险动作在执行前、执行中、执行后均可追踪
- 审批、二次确认、人工覆盖、驳回、终止等动作具备责任归属
- 关键节点调用可回放、可核验、可追责
- 后续落地到 `permissions`、`audit`、`tasks`、`replay` 时具备统一字段基线

本文档是 `.kiro/specs/web-aigc-platform-security-governance` 中“为高风险节点补齐审计要求”的治理产物，面向后续实现、联调、验收使用。

## 2. 适用范围

本要求适用于具备以下任一特征的节点：

- 对外调用第三方服务或外部工具
- 对内部系统、数据库、向量库、事务系统产生写操作
- 向用户、IM、邮件、Webhook 等通道发送通知或触达
- 可能产生数据出站、权限提升、资金/流程提交、不可逆变更
- 需要人工审批、人工确认、人工驳回、人工覆盖

## 3. 高风险节点类别

### 3.1 一级高风险：必须审批或二次确认

- `mcp`
- `internal_api`
- `passthrough_api`
- `message_notification`
- `transaction_flow`
- `vector_insert`
- `vector_update`
- `vector_delete`

### 3.2 二级高风险：按场景触发审批

- `open_page`
- `open_report`
- `open_dashboard`
- `file_generation`
- `file_translation`
- `document_search`
- `web_search`

说明：

- 若二级节点涉及敏感数据、跨租户访问、批量操作、对外发送、自动发布，则按一级高风险处理。
- 若节点最终只读、无数据出站、无副作用，可仅要求完整审计，不强制审批。

## 4. 审计字段总要求

所有高风险节点，无论是否最终执行成功，至少必须写入以下审计字段。

| 字段 | 说明 |
| --- | --- |
| `auditId` | 审计记录唯一标识 |
| `traceId` | 跨服务链路追踪标识 |
| `workflowId` | 所属工作流实例 ID |
| `taskId` | 所属任务/任务片段 ID |
| `nodeId` | 当前节点 ID |
| `nodeType` | 当前节点类型 |
| `riskLevel` | 风险等级，如 `high` / `critical` |
| `tenantId` | 租户标识，若系统支持多租户则必填 |
| `operatorType` | 触发主体类型，如 `agent` / `user` / `system` |
| `operatorId` | 执行主体 ID |
| `actingAgentId` | 代表执行的 agent ID，适用于 agent 代办 |
| `requestSource` | 调用来源，如 UI、workflow engine、A2A、API |
| `permissionContext` | 权限上下文摘要，如 token、role、policy 快照引用 |
| `approvalStatus` | `not_required` / `pending` / `approved` / `rejected` / `expired` |
| `confirmationMode` | `none` / `second_confirm` / `human_approval` |
| `targetSummary` | 调用目标摘要，如服务名、工具名、目标资源 |
| `inputSummary` | 输入摘要，需脱敏，不得原样泄露敏感内容 |
| `sensitiveFlags` | 敏感标签，如 PII、财务、密钥、跨租户 |
| `startedAt` | 开始时间 |
| `completedAt` | 完成时间 |
| `resultStatus` | `succeeded` / `failed` / `cancelled` / `blocked` |
| `resultCode` | 结果码或错误码 |
| `resultSummary` | 结果摘要，需脱敏 |
| `sideEffectLevel` | 副作用级别，如 `read` / `write` / `external_send` / `irreversible` |
| `replayRef` | 回放引用，如事件流、请求快照、工件地址 |
| `retentionClass` | 留存等级，如 `short` / `default` / `extended` |

## 5. 节点级治理矩阵

| 节点类别 | 典型节点 | 必须审计字段补充 | 审批/二次确认要求 | 回放/追责要求 |
| --- | --- | --- | --- | --- |
| 外部工具调用 | `mcp` | `serverName`、`toolName`、`toolArgsSummary`、`timeoutMs`、`fallbackPolicy` | 默认二次确认；若涉及写操作、外部出站、不可逆动作则必须人工审批 | 保留请求参数摘要、标准化结果、失败原因、调用时序、审批链 |
| 内部接口调用 | `internal_api` | `serviceName`、`apiPath`、`method`、`requestTemplateId`、`changeScope` | 只读接口可免审批但必须审计；写接口、批量接口、敏感接口必须审批 | 保留请求模板版本、目标服务、返回码、变更范围、责任人 |
| 透传接口调用 | `passthrough_api` | `targetEndpoint`、`httpMethod`、`allowlistMatch`、`payloadSummary`、`egressDomain` | 默认必须人工审批；若目标不在白名单内必须阻断 | 保留完整脱敏快照、域名/IP、审批意见、阻断原因、回放链路 |
| 消息与通知发送 | `message_notification` | `channelType`、`recipientScope`、`templateId`、`messageDigest`、`deliveryMode` | 站内低风险通知可仅二次确认；外发 IM/邮件/Webhook 必须审批 | 保留收件范围、模板变量摘要、发送结果、重试记录、责任主体 |
| 事务与流程提交 | `transaction_flow` | `transactionType`、`businessObjectId`、`submitAction`、`rollbackCapability` | 必须人工审批，且审批人与发起 agent 不得为同一主体 | 保留审批前后状态、提交结果、回滚记录、人工覆盖记录 |
| 向量写操作 | `vector_insert`、`vector_update`、`vector_delete` | `collectionId`、`documentScope`、`recordCount`、`embeddingModel`、`dataLineageRef` | 批量写入、批量删除、跨知识域变更必须审批；小规模写入至少二次确认 | 保留变更前后计数、批次摘要、来源文档、删除范围、恢复策略 |
| 文件生成与外部落地 | `file_generation` | `artifactType`、`outputPath`、`distributionScope`、`containsSensitiveData` | 若仅本地临时产物可免审批；若会下载、分享、外发则至少二次确认 | 保留文件摘要、产物地址、下载/分享记录、来源节点链路 |
| 页面/看板/报表打开 | `open_page`、`open_dashboard`、`open_report` | `targetUrl`、`resourceId`、`accessScope` | 只读场景可无审批；若涉及敏感页面或代操作跳转则二次确认 | 保留资源标识、触达对象、打开时点、授权上下文 |

## 6. 审批与二次确认要求

### 6.1 需要人工审批的场景

以下任一情况成立时，必须进入人工审批：

- 涉及数据写入、删除、提交、发布、发送、透传外部请求
- 涉及财务、合同、权限、身份、组织结构、跨租户数据
- 涉及批量操作、不可逆操作、自动触达外部用户
- 透传接口调用、外部工具调用未命中白名单或风险策略命中
- agent 尝试绕过默认确认链路，或存在前置审批失效

### 6.2 可以使用二次确认的场景

以下场景可采用二次确认替代完整审批：

- 低风险但有副作用的单步操作
- 已命中允许策略、且影响范围可控的内部写操作
- 小范围向量写入、文件生成、本地可回收产物
- 站内消息、仅内部可见通知

### 6.3 审批记录要求

审批动作必须记录：

- `approvalId`
- `approvalStatus`
- `approverId`
- `approverType`
- `approvalAt`
- `approvalReason`
- `approvalScope`
- `approvalSnapshotRef`

若发生二次确认，必须记录：

- `confirmedBy`
- `confirmedAt`
- `confirmationPrompt`
- `confirmationInputSummary`

## 7. 回放与追责要求

### 7.1 回放最小要求

所有高风险节点必须具备最小回放能力，至少要能还原：

- 谁在什么上下文发起了该动作
- 该动作调用了哪个节点、哪个目标系统或工具
- 审批是否经过、由谁批准、批准依据是什么
- 输入摘要、输出摘要、错误信息、最终状态
- 对外发送或对内写入是否真的发生

### 7.2 回放工件要求

应至少保留以下一种或多种引用：

- 审计事件流引用
- 请求/响应脱敏快照引用
- 任务事件回放引用
- 生成工件或输出文件地址
- 审批记录快照引用

### 7.3 追责链要求

追责链必须能够从结果反查到：

1. 最终执行主体
2. 代表执行的 agent
3. 触发来源
4. 审批人或确认人
5. 原始任务和节点
6. 关联的策略版本或权限快照

## 8. 审计留存与脱敏要求

### 8.1 留存等级

- `short`：仅短期保留，适用于低敏但高频的确认事件
- `default`：默认留存，适用于一般高风险节点
- `extended`：延长留存，适用于事务提交、数据删除、外发通知、跨系统透传

### 8.2 脱敏原则

- 审计中优先保存摘要，不原样保存密钥、令牌、密码、完整身份证号、完整邮箱、完整手机号
- 请求体、响应体、通知内容应提供脱敏版本和引用版本，不应在普通审计查询中直接暴露原文
- 回放时如果涉及敏感原文，必须再次经过权限校验

## 9. 与现有能力的对接边界

### 9.1 `permissions`

- 负责判断节点是否允许执行
- 提供角色、策略、token、限制条件等上下文
- 不替代审计存证

### 9.2 `audit`

- 负责落地统一审计事件和审批事件
- 提供查询、导出、追责、异常检索能力
- 必须支持节点级、任务级、工作流级串联

### 9.3 `tasks`

- 负责把高风险节点的执行状态、审批状态、阻断状态体现在任务流转中
- 必须能标记 `blocked / waiting_approval / rejected / cancelled`

### 9.4 `replay`

- 负责提供事件回放与时间线视图
- 高风险节点必须能从审计记录跳转到回放记录，从回放记录反查审计记录

## 10. 实施优先级建议

建议按以下优先级推进：

1. 先为 `mcp`、`internal_api`、`passthrough_api`、`message_notification` 建立统一审计字段模型
2. 再补审批/二次确认状态机
3. 最后对接任务回放、审计查询和追责视图

最低可接受交付标准：

- 高风险节点有统一 `auditId / traceId / nodeType / approvalStatus / resultStatus`
- 外部调用、数据写入、通知发送具备审批或二次确认
- 至少能从任务记录回放到高风险节点审计记录
