> 🔧 **V2 修订说明**：本图是详图。本系统在 V2 中是**组装根**：把空泛的 `PERMISSION_VALIDATE/DEPENDENCY_VALIDATE` 坐实为「跨系统引用闭包校验」（调全局依赖图）；明确「发布即钉死各子产物版本」，运行时按快照解析（P1-5/P1-6）。详见《平台架构 V2 修订版 - 公共内核与接缝治理》。

```mermaid
flowchart TB

%% =====================================================
%% 应用中心 / App Center · 完整架构图
%% ● = 已有基础能力
%% ◆ = 建议补齐或平台化能力
%% 实线 = 主装配、发布与运行链路
%% 虚线 = 缓存、审计、失效、异步或回滚链路
%% =====================================================

subgraph ARCH["应用中心 / App Center · 完整架构"]
direction TB

%% =====================================================
%% 00 交互与入口
%% =====================================================
subgraph SURFACE["00 交互与入口 / Surface"]
direction LR

PORTAL["● 主门户<br/>web-main + 微前端容器"]:::surface
APP_CENTER_UI["● 应用中心控制台<br/>应用列表、配置、发布、版本"]:::surface
APP_MARKET["● 应用市场<br/>模板浏览、安装、收藏、评分"]:::surface
APP_CREATOR["● 应用创建向导<br/>空白创建、模板创建、导入创建"]:::surface
APP_RUNTIME_UI["● 应用运行门户<br/>菜单、页面、工作流、数据视图"]:::surface
APP_ADMIN_UI["● 应用管理员控制台<br/>成员、角色、功能权限、运行配置"]:::surface
AIGC_WORKBENCH["● AIGC 工作台<br/>智能应用、会话、任务、主页"]:::surface
EXTERNAL_CLIENT["◆ 外部应用 / SDK<br/>嵌入式应用、移动端、第三方系统"]:::surface

end

%% =====================================================
%% 01 接入与身份边界
%% =====================================================
subgraph INGRESS["01 接入与身份边界 / Ingress"]
direction LR

GATEWAY{"◆ API Gateway<br/>TLS、CORS、限流、WAF、API 版本"}:::gate
ROUTER["● Backend Routes<br/>应用、版本、模板、运行时、市场"]:::core
AUTH{"● Auth + JWT<br/>登录态、Token、用户状态"}:::gate
TENANT_GUARD{"● Tenant Isolation<br/>tenant_id、租户状态、资源配额"}:::gate
RBAC_GATE{"● RBAC Gate<br/>应用管理、发布、安装、运行权限"}:::gate
APP_ACCESS{"◆ App Access Guard<br/>app_key、app_secret、IP 白名单、调用配额"}:::trust
REQUEST_CONTEXT[("◆ Request Context<br/>userId、tenantId、appId、roles<br/>traceId、client、locale、device")]:::state

end

%% =====================================================
%% 02 应用装配控制平面
%% =====================================================
subgraph APP_CONTROL["02 应用装配控制平面 / App Composition Control Plane"]
direction TB

subgraph APP_DEFINITION["应用定义与生命周期"]
direction LR

APPLICATION["● Application<br/>应用编码、名称、类型、分类、图标、描述"]:::policy
APP_STATUS["● App Status<br/>draft、published、modified、archived、disabled"]:::state
APP_OWNER["◆ App Owner<br/>负责人、维护团队、业务域、成本归属"]:::policy
APP_TAG["◆ App Tag<br/>行业、业务域、能力标签、敏感等级"]:::policy
APP_HOME["● App Home Config<br/>主页风格、横幅、精选应用、欢迎语"]:::policy
APP_RUNTIME_CONFIG["● App Runtime Config<br/>主题、入口、语言、环境、Feature Flag"]:::policy
APP_DEPENDENCY["◆ App Dependency Graph<br/>页面、流程、模型、组件、AI 能力依赖"]:::reentry

end

subgraph APP_COMPOSITION["应用组合资产"]
direction LR

APP_PAGE["● App Page<br/>引用页面设计器页面、路由、首页标识"]:::policy
APP_WORKFLOW["● App Workflow<br/>引用流程模板、发起入口、待办入口"]:::policy
APP_DATA_MODEL["● App Data Model<br/>引用数据模型、数据集、业务对象"]:::policy
APP_MENU["● App Menu Config<br/>菜单树、路由、图标、排序、权限码"]:::policy
APP_ROLE["● App Role<br/>应用角色、成员绑定、角色继承"]:::policy
APP_FEATURE["● App Feature Permission<br/>页面、按钮、模块、操作开关"]:::policy
APP_THEME["◆ App Theme Binding<br/>主题、设计 Token、品牌配置"]:::policy
APP_ASSET["◆ App Asset Binding<br/>图标、图片、附件、静态资源"]:::policy
APP_INTEGRATION["◆ App Integration Binding<br/>Webhook、外部 API、数据集成、消息渠道"]:::policy
APP_AIGC["◆ App AIGC Binding<br/>Agent、知识库、模型、会话、定时任务"]:::policy

end

subgraph APP_TEMPLATE_GROUP["模板与市场资产"]
direction LR

APP_TEMPLATE["● App Template<br/>行业模板、场景模板、基础模板"]:::policy
TEMPLATE_VERSION["● Template Version<br/>模板版本、依赖快照、变更记录"]:::ledger
TEMPLATE_PACKAGE["◆ Template Package<br/>页面、流程、数据模型、菜单、角色、资源"]:::ledger
TEMPLATE_RATING["◆ Template Rating<br/>评分、评论、安装量、收藏量"]:::trust
TEMPLATE_REVIEW{"◆ Template Review Gate<br/>安全、质量、版权、依赖检查"}:::gate
TEMPLATE_PUBLISH["◆ Marketplace Publish<br/>上架、下架、灰度、推荐位"]:::done

end

subgraph APP_VERSIONING["应用版本与发布"]
direction LR

APP_DRAFT["● App Draft<br/>当前编辑态应用配置"]:::ledger
APP_VERSION["● App Version<br/>版本号、配置快照、发布说明"]:::ledger
VERSION_DIFF["◆ Version Diff<br/>页面、流程、菜单、权限、模型差异"]:::ledger
APP_VALIDATE["◆ App Validator<br/>资产存在、路由唯一、依赖完整、配置合法"]:::gate
PERMISSION_VALIDATE["◆ Permission Validator<br/>应用角色、菜单、功能、数据权限一致性"]:::gate
DEPENDENCY_VALIDATE["◆ Dependency Validator<br/>页面、流程、模型、组件、外部连接可用"]:::gate
SECURITY_VALIDATE["◆ Security Validator<br/>敏感数据、脚本、URL、接口、跨租户检查"]:::gate
PUBLISH_GATE{"◆ App Publish Gate<br/>校验通过、版本冻结、审批完成"}:::gate
RELEASE_ARTIFACT["◆ App Release Artifact<br/>版本化应用包、依赖清单、运行配置快照"]:::ledger
RELEASE_STRATEGY["◆ Release Strategy<br/>全量、灰度、白名单、环境分发"]:::policy
ACTIVE_VERSION["● Active App Version<br/>当前运行版本"]:::done

end

end

%% =====================================================
%% 03 被组装的能力中心
%% =====================================================
subgraph CAPABILITY_POOL["03 被组装的能力中心 / Capability Pool"]
direction TB

subgraph PAGE_CAP["页面设计能力"]
direction LR

PAGE_DESIGNER["● 页面设计器<br/>页面 Schema、组件、布局、事件、数据绑定"]:::cap
PAGE_VERSION["● 页面版本<br/>草稿、发布、回滚"]:::ledger
COMPONENT_LIBRARY["● 组件库<br/>基础组件、表单、表格、图表、业务组件"]:::cap
PAGE_RUNTIME["● 页面运行时<br/>Schema 解析、动态渲染、权限投影"]:::cap

end

subgraph WORKFLOW_CAP["工作流能力"]
direction LR

WORKFLOW_CENTER["● 工作流中心<br/>流程模板、节点配置、版本、审批规则"]:::cap
WORKFLOW_VERSION["● 流程版本<br/>已发布版本、实例冻结版本"]:::ledger
WORKFLOW_RUNTIME["● 工作流运行时<br/>实例、任务、审批、超时、委托"]:::cap
WORKFLOW_ACTION["● 工作流动作<br/>发起流程、查看待办、审批处理"]:::cap

end

subgraph DATA_CAP["数据能力"]
direction LR

DATA_PLATFORM["● 数据中台<br/>数据模型、字段、关系、动态数据 API"]:::cap
DATASET["● 数据集与查询<br/>筛选、分页、聚合、导出"]:::cap
DATA_POLICY["● 数据权限<br/>模型、行、字段、脱敏、导出控制"]:::cap
DATA_RUNTIME["● 数据运行时<br/>CRUD、查询、缓存、数据绑定"]:::cap

end

subgraph AIGC_CAP["智能能力"]
direction LR

AIGC_APP_DEF["● AIGC App Definition<br/>单智能体、多智能体、知识助手、创作助手"]:::cap
MODEL_CONFIG["● Model Config<br/>模型组合、参数、Token、FIM、Embedding"]:::cap
KNOWLEDGE_CONFIG["● Knowledge Config<br/>知识库、检索、RAG、引用配置"]:::cap
AGENT_ORCHESTRATION["● Agent Orchestration<br/>Flow、节点、工具、执行策略"]:::cap
SESSION_RUNTIME["● Session Runtime<br/>会话、消息、上下文、历史记录"]:::cap
SCHEDULED_TASK["● Scheduled Task<br/>定时任务、周期任务、异步执行"]:::cap

end

subgraph INTEGRATION_CAP["集成与通知能力"]
direction LR

API_INTEGRATION["● API Integration<br/>外部 API、数据库 API、认证配置"]:::cap
WEBHOOK["◆ Webhook<br/>事件回调、签名校验、幂等处理"]:::cap
NOTIFICATION["● Notification Service<br/>站内信、邮件、短信、企业 IM"]:::cap
FILE_SERVICE["◆ File Service<br/>附件、导入导出、对象存储、预览"]:::cap

end

end

%% =====================================================
%% 04 应用运行控制平面
%% =====================================================
subgraph APP_RUNTIME_CONTROL["04 应用运行控制平面 / App Runtime Control Plane"]
direction TB

APP_RESOLVER["● App Resolver<br/>按 appCode、域名、菜单入口定位应用"]:::core
VERSION_RESOLVER["● Version Resolver<br/>加载当前 Active Version 或灰度版本"]:::core
CONFIG_LOADER["● Config Loader<br/>加载应用配置、主页、主题、Feature Flag"]:::core
MENU_RESOLVER["● Menu Resolver<br/>菜单树、路由、角色菜单、隐藏规则"]:::core
FEATURE_GATE{"● Feature Gate<br/>按 AppRole、用户、组织、岗位控制功能"}:::gate
PAGE_RESOLVER["● Page Resolver<br/>定位页面版本、页面 Schema、组件依赖"]:::core
WORKFLOW_RESOLVER["● Workflow Resolver<br/>定位流程入口、实例、待办、权限"]:::core
DATA_RESOLVER["● Data Resolver<br/>定位模型、数据集、查询条件、数据权限"]:::core
AIGC_RESOLVER["● AIGC Resolver<br/>定位应用模型、知识库、Agent、会话策略"]:::core
RUNTIME_CONTEXT[("◆ App Runtime Context<br/>appVersion、user、tenant、roles<br/>menu、featureFlags、locale、variables")]:::state
RUNTIME_GATE{"◆ Runtime Guard<br/>应用状态、版本健康、配额、依赖、降级策略"}:::gate
APP_SHELL["● App Shell<br/>导航、菜单、布局、主题、页面容器"]:::runtime
APP_EVENT_BUS["◆ App Event Bus<br/>app.started、page.opened、workflow.created<br/>data.changed、feature.denied、release.switched"]:::bus
APP_STATE[("◆ App State Store<br/>当前应用、页面状态、会话、缓存、错误状态")]:::state

end

%% =====================================================
%% 05 基础设施与分发
%% =====================================================
subgraph INFRA["05 存储、队列与基础设施 / Infrastructure"]
direction LR

MYSQL[("● MySQL / Sequelize<br/>applications、app_versions、app_pages<br/>app_workflows、app_data_models、app_menu_configs<br/>app_roles、app_templates、app_runtime_configs<br/>app_feature_permissions")]:::runtime

REDIS[("● Redis<br/>会话、缓存、分布式锁、版本指针、限流")]:::runtime

OBJECT_STORAGE[("◆ Object Storage<br/>应用包、资源、导入导出、发布快照")]:::runtime

SEARCH_INDEX[("◆ Search Index<br/>应用市场、模板、页面、能力搜索")]:::runtime

QUEUE["● BullMQ / Job Queue<br/>发布、安装、导入导出、通知、健康检查"]:::bus

WORKER["● Worker Process<br/>异步任务、重试、失败处理、任务归档"]:::runtime

CDN["◆ CDN / Static Delivery<br/>静态资源、应用包、版本指纹"]:::runtime

CONFIG_CENTER["◆ Config Center<br/>环境变量、灰度、Feature Flag、运行时开关"]:::runtime

end

%% =====================================================
%% 06 信任、审计与失效重入
%% =====================================================
subgraph TRUST["06 信任、审计与失效重入 / Trust & Re-entry"]
direction TB

OP_LOG["● Operation Log<br/>创建、修改、安装、发布、回滚、权限调整"]:::trust
ACCESS_LOG["◆ App Access Log<br/>应用访问、页面打开、功能使用、接口调用"]:::trust
PUBLISH_LEDGER["◆ Publish Ledger<br/>校验结果、版本差异、依赖清单、审批记录"]:::ledger
DECISION_LEDGER["◆ Runtime Decision Ledger<br/>菜单命中、权限拒绝、功能开关、版本选择"]:::ledger
HEALTH_MONITOR["◆ App Health Monitor<br/>版本健康、接口失败、页面异常、任务积压"]:::trust
METRICS["◆ App Metrics<br/>访问量、活跃用户、留存、转化、耗时、成本"]:::trust
ALERTING["◆ Alerting<br/>发布失败、依赖失效、权限异常、调用超额"]:::trust
INVALIDATION["◆ Invalidation Engine<br/>应用、版本、菜单、权限、资源、模板缓存失效"]:::reentry
ROLLBACK["● App Rollback<br/>版本回滚、应用下线、紧急禁用"]:::reentry
MIGRATION["◆ App Migration<br/>模板升级、配置迁移、依赖替换、兼容检查"]:::reentry

end

%% =====================================================
%% 07 输出
%% =====================================================
subgraph OUTPUT["07 输出与交付 / Output"]
direction LR

BUSINESS_APP["● 业务应用<br/>门户、表单、列表、详情、看板"]:::report
WORKFLOW_APP["● 流程应用<br/>发起、待办、审批、抄送、统计"]:::report
DATA_APP["● 数据应用<br/>数据录入、查询、报表、分析"]:::report
AIGC_APP["● 智能应用<br/>聊天、RAG、Agent、创作、代码助手"]:::report
EMBED_APP["◆ 嵌入式应用<br/>SDK、Iframe、移动端、第三方门户"]:::report
APP_REPORT["◆ 应用运营报告<br/>活跃度、健康度、质量、成本、使用分析"]:::report

end

%% =====================================================
%% 入口链路
%% =====================================================
PORTAL --> GATEWAY
APP_CENTER_UI --> GATEWAY
APP_MARKET --> GATEWAY
APP_CREATOR --> GATEWAY
APP_RUNTIME_UI --> GATEWAY
APP_ADMIN_UI --> GATEWAY
AIGC_WORKBENCH --> GATEWAY
EXTERNAL_CLIENT --> GATEWAY

GATEWAY --> ROUTER
ROUTER --> AUTH
AUTH --> TENANT_GUARD
TENANT_GUARD --> RBAC_GATE
RBAC_GATE --> REQUEST_CONTEXT
EXTERNAL_CLIENT --> APP_ACCESS
APP_ACCESS --> REQUEST_CONTEXT

%% =====================================================
%% 应用创建与资产装配
%% =====================================================
APP_CREATOR --> APPLICATION
APP_CREATOR --> APP_TEMPLATE
APP_MARKET --> APP_TEMPLATE
APP_CENTER_UI --> APPLICATION
APP_ADMIN_UI --> APP_RUNTIME_CONFIG
APP_ADMIN_UI --> APP_ROLE
APP_ADMIN_UI --> APP_FEATURE
APP_CENTER_UI --> APP_PAGE
APP_CENTER_UI --> APP_WORKFLOW
APP_CENTER_UI --> APP_DATA_MODEL
APP_CENTER_UI --> APP_MENU
APP_CENTER_UI --> APP_AIGC
APP_CENTER_UI --> APP_INTEGRATION

APPLICATION --> APP_STATUS
APPLICATION --> APP_OWNER
APPLICATION --> APP_TAG
APPLICATION --> APP_HOME
APPLICATION --> APP_RUNTIME_CONFIG
APPLICATION --> APP_DRAFT

APP_TEMPLATE --> TEMPLATE_VERSION
TEMPLATE_VERSION --> TEMPLATE_PACKAGE
TEMPLATE_PACKAGE --> TEMPLATE_REVIEW
TEMPLATE_REVIEW --> TEMPLATE_PUBLISH
TEMPLATE_PUBLISH --> APP_MARKET
TEMPLATE_RATING --> APP_MARKET
APP_TEMPLATE --> APP_DRAFT

APP_PAGE --> APP_DRAFT
APP_WORKFLOW --> APP_DRAFT
APP_DATA_MODEL --> APP_DRAFT
APP_MENU --> APP_DRAFT
APP_ROLE --> APP_DRAFT
APP_FEATURE --> APP_DRAFT
APP_THEME --> APP_DRAFT
APP_ASSET --> APP_DRAFT
APP_INTEGRATION --> APP_DRAFT
APP_AIGC --> APP_DRAFT
APP_RUNTIME_CONFIG --> APP_DRAFT

%% =====================================================
%% 引用底层能力
%% =====================================================
APP_PAGE --> PAGE_DESIGNER
PAGE_DESIGNER --> PAGE_VERSION
PAGE_DESIGNER --> COMPONENT_LIBRARY
PAGE_DESIGNER --> PAGE_RUNTIME

APP_WORKFLOW --> WORKFLOW_CENTER
WORKFLOW_CENTER --> WORKFLOW_VERSION
WORKFLOW_CENTER --> WORKFLOW_RUNTIME
WORKFLOW_CENTER --> WORKFLOW_ACTION

APP_DATA_MODEL --> DATA_PLATFORM
DATA_PLATFORM --> DATASET
DATA_PLATFORM --> DATA_POLICY
DATA_PLATFORM --> DATA_RUNTIME

APP_AIGC --> AIGC_APP_DEF
AIGC_APP_DEF --> MODEL_CONFIG
AIGC_APP_DEF --> KNOWLEDGE_CONFIG
AIGC_APP_DEF --> AGENT_ORCHESTRATION
AIGC_APP_DEF --> SESSION_RUNTIME
AIGC_APP_DEF --> SCHEDULED_TASK

APP_INTEGRATION --> API_INTEGRATION
APP_INTEGRATION --> WEBHOOK
APP_INTEGRATION --> NOTIFICATION
APP_INTEGRATION --> FILE_SERVICE

%% =====================================================
%% 校验、版本、发布
%% =====================================================
APP_DRAFT --> APP_VALIDATE
APP_DRAFT --> PERMISSION_VALIDATE
APP_DRAFT --> DEPENDENCY_VALIDATE
APP_DRAFT --> SECURITY_VALIDATE

APP_VALIDATE --> APP_VERSION
PERMISSION_VALIDATE --> APP_VERSION
DEPENDENCY_VALIDATE --> APP_VERSION
SECURITY_VALIDATE --> APP_VERSION

APP_VERSION --> VERSION_DIFF
VERSION_DIFF --> PUBLISH_GATE
APP_VERSION --> PUBLISH_GATE
PUBLISH_GATE --> RELEASE_ARTIFACT
RELEASE_ARTIFACT --> RELEASE_STRATEGY
RELEASE_STRATEGY --> ACTIVE_VERSION

ACTIVE_VERSION --> APP_STATUS
ACTIVE_VERSION -.发布事件.-> APP_EVENT_BUS
PUBLISH_GATE -.发布审计.-> PUBLISH_LEDGER

%% =====================================================
%% 运行时装载与执行
%% =====================================================
APP_RUNTIME_UI --> APP_RESOLVER
EXTERNAL_CLIENT --> APP_RESOLVER
APP_RESOLVER --> VERSION_RESOLVER
VERSION_RESOLVER --> ACTIVE_VERSION
VERSION_RESOLVER --> CONFIG_LOADER
CONFIG_LOADER --> APP_RUNTIME_CONFIG
CONFIG_LOADER --> RUNTIME_CONTEXT

REQUEST_CONTEXT --> MENU_RESOLVER
REQUEST_CONTEXT --> FEATURE_GATE
REQUEST_CONTEXT --> RUNTIME_GATE
RUNTIME_CONTEXT --> MENU_RESOLVER
RUNTIME_CONTEXT --> FEATURE_GATE
RUNTIME_CONTEXT --> PAGE_RESOLVER
RUNTIME_CONTEXT --> WORKFLOW_RESOLVER
RUNTIME_CONTEXT --> DATA_RESOLVER
RUNTIME_CONTEXT --> AIGC_RESOLVER

MENU_RESOLVER --> APP_MENU
FEATURE_GATE --> APP_ROLE
FEATURE_GATE --> APP_FEATURE
PAGE_RESOLVER --> APP_PAGE
WORKFLOW_RESOLVER --> APP_WORKFLOW
DATA_RESOLVER --> APP_DATA_MODEL
AIGC_RESOLVER --> APP_AIGC

RUNTIME_GATE --> APP_SHELL
MENU_RESOLVER --> APP_SHELL
FEATURE_GATE --> APP_SHELL
PAGE_RESOLVER --> APP_SHELL
WORKFLOW_RESOLVER --> APP_SHELL
DATA_RESOLVER --> APP_SHELL
AIGC_RESOLVER --> APP_SHELL

APP_SHELL --> PAGE_RUNTIME
APP_SHELL --> WORKFLOW_RUNTIME
APP_SHELL --> DATA_RUNTIME
APP_SHELL --> SESSION_RUNTIME
APP_SHELL --> APP_STATE

PAGE_RUNTIME --> BUSINESS_APP
WORKFLOW_RUNTIME --> WORKFLOW_APP
DATA_RUNTIME --> DATA_APP
SESSION_RUNTIME --> AIGC_APP
APP_SHELL --> EMBED_APP

%% =====================================================
%% 运行事件、异步与基础设施
%% =====================================================
APPLICATION --> MYSQL
APP_DRAFT --> MYSQL
APP_VERSION --> MYSQL
APP_PAGE --> MYSQL
APP_WORKFLOW --> MYSQL
APP_DATA_MODEL --> MYSQL
APP_MENU --> MYSQL
APP_ROLE --> MYSQL
APP_FEATURE --> MYSQL
APP_TEMPLATE --> MYSQL
APP_RUNTIME_CONFIG --> MYSQL

RELEASE_ARTIFACT --> OBJECT_STORAGE
APP_ASSET --> OBJECT_STORAGE
TEMPLATE_PACKAGE --> OBJECT_STORAGE

APP_RESOLVER --> REDIS
VERSION_RESOLVER --> REDIS
MENU_RESOLVER --> REDIS
FEATURE_GATE --> REDIS
APP_STATE --> REDIS

PUBLISH_GATE --> QUEUE
TEMPLATE_REVIEW --> QUEUE
ROLLBACK --> QUEUE
MIGRATION --> QUEUE
QUEUE --> WORKER
WORKER --> APP_EVENT_BUS
WORKER --> REDIS
WORKER --> OBJECT_STORAGE

RELEASE_ARTIFACT --> CDN
RELEASE_STRATEGY --> CONFIG_CENTER
CONFIG_CENTER --> APP_SHELL

APP_EVENT_BUS --> APP_STATE
APP_EVENT_BUS --> NOTIFICATION
APP_EVENT_BUS --> HEALTH_MONITOR

APPLICATION --> SEARCH_INDEX
APP_TEMPLATE --> SEARCH_INDEX
APP_TAG --> SEARCH_INDEX
TEMPLATE_RATING --> SEARCH_INDEX

%% =====================================================
%% 治理、审计、失效与回滚
%% =====================================================
ROUTER -.管理操作.-> OP_LOG
APP_SHELL -.应用访问.-> ACCESS_LOG
MENU_RESOLVER -.菜单决策.-> DECISION_LEDGER
FEATURE_GATE -.功能决策.-> DECISION_LEDGER
VERSION_RESOLVER -.版本选择.-> DECISION_LEDGER

OP_LOG --> MYSQL
ACCESS_LOG --> MYSQL
PUBLISH_LEDGER --> MYSQL
DECISION_LEDGER --> MYSQL

APP_SHELL --> METRICS
PAGE_RUNTIME --> METRICS
WORKFLOW_RUNTIME --> METRICS
DATA_RUNTIME --> METRICS
SESSION_RUNTIME --> METRICS
QUEUE --> METRICS

METRICS --> HEALTH_MONITOR
HEALTH_MONITOR --> ALERTING

APP_VERSION -.版本切换.-> INVALIDATION
APP_TEMPLATE -.模板更新.-> INVALIDATION
APP_FEATURE -.权限变更.-> INVALIDATION
APP_MENU -.菜单变更.-> INVALIDATION
APP_RUNTIME_CONFIG -.配置变更.-> INVALIDATION

INVALIDATION --> REDIS
INVALIDATION --> CDN
INVALIDATION --> SEARCH_INDEX
INVALIDATION --> APP_STATE

ALERTING --> ROLLBACK
ROLLBACK --> ACTIVE_VERSION
ROLLBACK --> INVALIDATION
MIGRATION --> APP_DRAFT
MIGRATION --> DEPENDENCY_VALIDATE
APP_DEPENDENCY --> MIGRATION

%% =====================================================
%% 运营输出
%% =====================================================
METRICS --> APP_REPORT
HEALTH_MONITOR --> APP_REPORT
PUBLISH_LEDGER --> APP_REPORT

end

%% =====================================================
%% Styles
%% =====================================================
classDef surface fill:#dbeafe,stroke:#2563eb,color:#172554,stroke-width:1.5px
classDef core fill:#e0e7ff,stroke:#4f46e5,color:#312e81,stroke-width:1.5px
classDef cap fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:1.5px
classDef policy fill:#fae8ff,stroke:#c026d3,color:#701a75,stroke-width:1.5px
classDef gate fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:1.5px
classDef trust fill:#cffafe,stroke:#0891b2,color:#164e63,stroke-width:1.5px
classDef ledger fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:1.5px
classDef runtime fill:#f5f5f4,stroke:#78716c,color:#292524,stroke-width:1.5px
classDef state fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-width:1.5px
classDef reentry fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:1.5px
classDef bus fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:1.5px
classDef report fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
```
