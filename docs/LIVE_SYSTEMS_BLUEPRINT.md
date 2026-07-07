# 活系统蓝图：把右栏从"示意图"升级为"真实可操作的六系统"

> 状态：方案定稿，待启动 M0。
> 来源：对用户上传的 `beae028b-web.zip`（63MB，五个 UmiJS/qiankun 微前端）的全量摸底（2026-07-07）。

## 愿景（用户原话）

> 右侧的画面是固定形式的……能不能做到这种系统的实时画面并且可用操作的，全部打通，
> 最后导出的时候是目前这种固定格式的内容。

即：推演闭环产出五系统模型后，右栏不再渲染示意卡片，而是**打开真实的
权限 / 工作流 / 数据中台 / 页面设计器+应用中心 / AIGC 中台界面**，
里面装着**这个话题生成的真实数据**，可以点、可以改；导出物保持现有固定格式不变。

## 一、zip 摸底结论（五应用）

| 应用 | 技术栈 | 核心能力 | 关键数据契约 | 独立可跑？ |
|---|---|---|---|---|
| web-main | Umi Max + qiankun **主应用**, React 19, antd 5 | RBAC 全套（用户/角色/权限/菜单/租户/数据权限）+ 门户 | `/api/auth/*` `/api/roles` `/api/permissions` `/api/menus/tree`（cookie 会话） | ❌ mock 是脚手架遗留，业务全靠 :3001 后端 |
| web-workflow | Umi + **X6 v2** 设计器 + Formily | 流程模板设计器、审批工单 | `/api/workflow/flow-templates`（flow_schema = X6 `graph.toJSON()` cells）、`/api/workflow/process-configs`；审批人 `assigneeType`、`approval_mode: sequential/countersign/or_sign` | ❌ 同上（端口 8200） |
| web-dataplatform | Umi Max + X6 ER 图 | 数据模型中台：实体/字段/关系/行列权限/动态数据 CRUD/ER 图 | `/api/data-platform/models`、`…/models/:id/fields`、`…/relations`；`/api/data/{modelName}` 动态 CRUD | ❌ 无 mock 目录（端口 8300） |
| web-designer | Umi + 自研页面引擎 + Designable 表单 + **应用中心** | 页面设计器（自研 PageSchema）、Formily 表单设计器、应用装配/发布/版本快照 | `/api/designer/pages/:id/schema`；`/api/applications`（pageIds/workflowIds/dataModelIds/menuConfig/roleIds 绑定） | ❌（端口 8400） |
| web-aigc | Umi Max + xyflow/X6 编排画布 | Agent 编排设计器、Prompt 模板库、知识库、~60 种节点 | `/api/v1/{tenantId}/…`；能力=NodeDefinition + FlowInput/OutputVariable + PromptTemplate | ❌（端口 8500） |

**共同点**：全部是 qiankun slave（也支持 standalone，判 `__POWERED_BY_QIANKUN__`）；
全部 `mock:false`，API 统一代理到 `http://localhost:3001`。

## 二、关键缺口：后端不在 zip 里，也不（完整）在本仓库

- 本仓库 `server/` 有同名概念但**契约不同**（角色在 `/api/permissions/roles` 而非 `/api/roles`；
  auth 是 `/login /me` 而非 `/api/auth/login /profile`；无 `/api/workflow/*`、`/api/data-platform/*`、
  `/api/designer/*`、`/api/applications`）。
- 这套前端的原始后端（mysql `rbac_multitenant`）不在手上。

**这反而是机会**：SlideRule 的核心资产——五系统模型——正好就是这些契约需要的数据。
我们不需要还原一个企业后端，只需要一个**"推演租户"桥接层**：
用每个会话的五系统模型作为唯一数据源，实现各前端"打开首屏 + 核心操作"所需的契约子集。

## 三、目标架构

```
SlideRule 左栏（推演）── 五系统模型（gate 通过）
                             │  写入
                             ▼
        slide-rule-python  /api/live/*  「推演租户」桥接层
        （会话级内存/JSON 存储，模型 → 各系统契约的双向转换器）
                             ▲  /api 代理
   ┌───────────┬───────────┼───────────┬───────────┐
 web-main:8100  workflow:8200  dataplatform:8300  designer:8400  aigc:8500
   （standalone 模式，右栏 iframe 按需嵌入，postMessage 联动）
                             │  操作回写模型（M2）
                             ▼
        导出管线不变：closure 证据 + 交付包仍是现有固定格式
```

模型 → 契约转换器（桥接层的核心，双向）：

| 模型段 | 目标系统 | 转换 |
|---|---|---|
| datamodel.entities | 数据中台 | entity→DataModel，fields→DataModelField，`ref` 字段→DataModelRelation |
| rbac.roles/permissions/menus | web-main 权限 | roles→`/api/roles`，menus→`/api/menus/tree`，permissions→权限树 |
| workflow.nodes/transitions | 工作流设计器 | nodes→X6 `editor-node`（assigneeRole→审批节点 data），transitions→`edge` cells → `flow_schema` |
| page.pages | 页面设计器 | fieldBindings→PageSchema components（M1 先只读渲染） |
| aigc.capabilities | AIGC 中台 | capability→NodeDefinition + PromptTemplate 骨架 |
| appbundle | 应用中心 | pageBindings/roleRefs/dataModelRefs→Application 资源绑定 + menuConfig |

鉴权策略：桥接层的 `/api/auth/profile`、`/api/menus/tree` 无条件返回"推演租户"演示用户
（各前端 401 才跳登录；永远 200 就永远不跳）。

## 四、分阶段路线

- **M0 · 工作流先活**（1 个系统端到端，验证全链路）
  vendor zip 入仓（`web/` 目录）→ web-workflow standalone 跑通（proxy 改 :9700）→
  桥接层实现 `flow-templates` GET + 模型→X6 转换器 → 右栏 Workflow 缩略图切到 iframe →
  推演闭环后设计器里出现**可拖拽编辑的真实流程图**。
- **M1 · 六系统全打通（只读→可操作）**
  数据中台（实体/字段/ER 图）→ 权限（角色/菜单）→ AIGC（能力/Prompt）→
  页面设计器与应用中心（PageSchema 生成 + Application 绑定）。逐个系统给"打开即见本话题数据"。
- **M2 · 双向：操作回写模型**
  设计器保存（PUT flow_schema / fields / schema）→ 桥接层反向转换回模型段 →
  经结构闸重新验证 → 更新闭环证据（改坏了如实 blocked，防伪语义不变）。
- **M3 · 导出收口**
  导出物格式不变；增量：把各系统的"当前真实配置"作为附件挂进交付包。

## 五、风险与代价（诚实账）

1. **机器负载**：5 个 umi dev server ≈ 每个 1-2GB 内存。M0 只起 workflow 一个；
   全量跑建议 `max build` 出静态产物由桥接层托管（去掉 dev server）。
2. **依赖安装**：五应用 node_modules 各 ~1GB+，首次安装很慢；vendor 入仓只收源码（63MB）。
3. **React 18/19、antd 4/5 混版**：iframe 隔离天然免疫（不走 qiankun 深度融合，主应用 web-main
   仅作为独立门户可选启动）。
4. **契约兜底**：各前端还会打一些我们不实现的接口（通知、日志、监控）；桥接层需要一个
   catch-all 返回空成功，避免首屏报错雪崩。
5. **登录态**：standalone 模式依赖 localStorage token——跨源 iframe 注入不进去，
   靠桥接层"永远 200"策略绕开，需逐应用实测首屏守卫。

## 六、M0 验收标准

发送新颖意图 → 闭环 → 右栏点 Workflow → iframe 打开工作流设计器 →
画布上是**本话题生成的审批流**（节点/连线/审批人角色与模型一致）→ 可拖动节点、改审批人 →
点导出，交付包与现在逐字节同构。
