> 🔧 **V2 修订说明**：本图是详图。本系统在 V2 中为**执行点（PEP）**：`PERMISSION_RENDER/DATA_SCOPE` 改为委托 PDP；`BINDING_SCHEMA` 字段改为绑定数据模型 SSOT；本地依赖图并入全局依赖图（P0-1/P0-3/P0-2）。详见《平台架构 V2 修订版 - 公共内核与接缝治理》。

```mermaid
flowchart TB

%% =====================================================
%% 页面设计器 / Low-code Page Designer
%% ● = 当前基础能力
%% ◆ = 建议补齐或平台化能力
%% 实线 = 主执行链路
%% 虚线 = 缓存、审计、失效、异步链路
%% =====================================================

subgraph ARCH["页面设计器 / Low-code Page Designer · 完整架构"]
direction TB

%% =====================================================
%% 00 交互与接入面
%% =====================================================
subgraph SURFACE["00 交互与接入面 / Surface"]
direction LR

PORTAL["● 主门户<br/>web-main + 微前端容器"]:::surface
DESIGN_STUDIO["● 页面设计工作台<br/>画布、组件、图层、属性"]:::surface
TEMPLATE_CENTER["● 模板中心<br/>页面模板、区块模板、组件模板"]:::surface
ASSET_CENTER["● 资源中心<br/>图片、图标、文件、字体、素材"]:::surface
PREVIEW_CENTER["● 预览与调试<br/>PC、平板、手机、多分辨率"]:::surface
PAGE_CENTER["● 页面管理<br/>草稿、发布、历史版本、路由"]:::surface
APP_CENTER["● 应用中心<br/>站点、应用、菜单、导航"]:::surface
LOWCODE_USER["● 最终用户页面<br/>业务页面、表单、列表、看板"]:::surface
OPEN_API["◆ Open API / SDK<br/>外部系统、嵌入式页面"]:::surface

end

%% =====================================================
%% 01 接入、身份与协作边界
%% =====================================================
subgraph INGRESS["01 接入、身份与协作边界 / Ingress"]
direction LR

GATEWAY["◆ API Gateway / BFF<br/>TLS、CORS、限流、版本、WAF"]:::gate
ROUTER["● Backend Routes<br/>页面、组件、模板、资源、发布"]:::core
AUTH["● Auth + JWT<br/>登录态、用户状态、Token"]:::gate
TENANT_GUARD["● Tenant Isolation<br/>tenant_id、租户状态、配额"]:::gate
RBAC_GATE["● RBAC Gate<br/>页面、组件、应用、发布权限"]:::gate
DATA_SCOPE["● Data Scope<br/>数据模型、数据集、记录范围"]:::gate
COLLAB_SOCKET["◆ 协作 Socket<br/>在线用户、光标、选区、变更"]:::runtime
COLLAB_MERGE["◆ 协作合并 Gate<br/>乐观锁、冲突检测、版本合并"]:::gate
REQUEST_CONTEXT[("◆ Request Context<br/>userId、tenantId、roles、pageId<br/>traceId、device、locale")]:::state

end

%% =====================================================
%% 02 页面设计控制平面
%% =====================================================
subgraph DESIGN_CONTROL["02 设计控制平面 / Design Control Plane"]
direction TB

subgraph PAGE_ASSET["页面、应用与资产"]
direction LR

APPLICATION["● Application<br/>应用、站点、导航域"]:::policy
PAGE["● Page<br/>页面名称、路由、状态、归属应用"]:::policy
PAGE_GROUP["● Page Group<br/>页面目录、业务分组"]:::policy
MENU["● Menu Binding<br/>菜单、路由、可见性、权限码"]:::policy
PAGE_TEMPLATE["● Page Template<br/>页面级模板、初始化 Schema"]:::policy
BLOCK_TEMPLATE["● Block Template<br/>区块、布局、业务片段"]:::policy
ASSET["● Asset<br/>图片、图标、文件、字体"]:::policy
THEME["● Theme<br/>颜色、字体、间距、圆角、暗色模式"]:::policy
DESIGN_TOKEN["◆ Design Token<br/>全局变量、语义色、响应式断点"]:::policy

end

subgraph COMPONENT_SYSTEM["组件系统 / Component System"]
direction LR

COMPONENT_REGISTRY["● Component Registry<br/>组件清单、分类、版本、能力声明"]:::policy
COMPONENT_SCHEMA["● Component Schema<br/>props、events、slots、style、defaults"]:::policy
COMPONENT_LIBRARY["● Component Library<br/>基础、布局、表单、表格、图表、业务组件"]:::cap
CUSTOM_COMPONENT["◆ Custom Component<br/>自定义组件、NPM 包、远程组件"]:::cap
PLUGIN_REGISTRY["◆ Plugin Registry<br/>设计插件、动作插件、数据插件"]:::cap
ICON_LIBRARY["● Icon Library<br/>图标、插画、图形资源"]:::cap

end

subgraph PAGE_SCHEMA["页面 Schema 与布局模型"]
direction LR

PAGE_SCHEMA_DOC["● Page Schema<br/>页面 JSON、节点树、页面元数据"]:::ledger
LAYOUT_TREE["● Layout Tree<br/>容器、栅格、Flex、Tabs、区块"]:::policy
COMPONENT_TREE["● Component Tree<br/>组件实例、层级、slot、key"]:::policy
STYLE_SCHEMA["● Style Schema<br/>尺寸、位置、响应式、状态样式"]:::policy
EVENT_SCHEMA["● Event Schema<br/>点击、提交、生命周期、联动"]:::policy
ACTION_SCHEMA["● Action Schema<br/>跳转、弹窗、请求、赋值、通知"]:::policy
BINDING_SCHEMA["● Binding Schema<br/>变量、数据集、接口、表达式"]:::policy
PERMISSION_SCHEMA["● Permission Schema<br/>页面、区块、组件、字段可见性"]:::policy

end

subgraph DESIGN_STATE["设计态状态与编辑能力"]
direction LR

CANVAS_ENGINE["● Canvas Engine<br/>拖拽、缩放、吸附、对齐、选区"]:::core
LAYER_PANEL["● Layer Panel<br/>组件树、图层排序、锁定、隐藏"]:::core
PROPERTY_PANEL["● Property Panel<br/>属性、样式、事件、数据绑定"]:::core
HISTORY_ENGINE["● History Engine<br/>Undo、Redo、Patch、快照"]:::core
CLIPBOARD["● Clipboard<br/>复制、粘贴、跨页复用"]:::core
SHORTCUT["● Shortcut Manager<br/>快捷键、批量选择、对齐分布"]:::core
RESPONSIVE_ENGINE["● Responsive Engine<br/>断点、设备模式、布局适配"]:::core
FORMULA_EDITOR["◆ Formula Editor<br/>表达式、变量提示、类型校验"]:::core

end

subgraph DESIGN_VALIDATION["设计校验与版本控制"]
direction LR

SCHEMA_VALIDATOR["● Schema Validator<br/>JSON 结构、组件属性、必填项"]:::gate
REFERENCE_CHECK["◆ Reference Check<br/>组件、模板、资源、数据源、路由存在"]:::gate
LAYOUT_CHECK["◆ Layout Check<br/>重叠、溢出、断点异常、循环嵌套"]:::gate
PERMISSION_CHECK["◆ Permission Check<br/>页面访问、数据绑定、导出权限"]:::gate
SECURITY_CHECK["◆ Security Check<br/>脚本、URL、HTML、跨域、敏感字段"]:::gate
QUALITY_GATE["◆ Page Quality Gate<br/>性能、可访问性、响应式、质量评分"]:::gate
PAGE_VERSION["● Page Version<br/>草稿、发布、历史、回滚点"]:::ledger
PUBLISH_GATE["◆ Publish Gate<br/>结构、依赖、权限、资源、预览通过"]:::gate

end

end

%% =====================================================
%% 03 数据、变量与动作控制平面
%% =====================================================
subgraph DATA_CONTROL["03 数据、变量与动作控制平面 / Data & Action Control Plane"]
direction TB

subgraph DATA_ASSET["数据资产"]
direction LR

DATA_SOURCE["● Data Source<br/>数据库、API、文件、第三方服务"]:::policy
DATA_MODEL["● Data Model<br/>实体、字段、关系、权限"]:::policy
DATASET["● Dataset<br/>查询、参数、字段映射、分页"]:::policy
METRIC["◆ Metric<br/>统一指标、维度、聚合口径"]:::policy
QUERY_TEMPLATE["● Query Template<br/>SQL、筛选条件、排序、聚合"]:::policy
API_DEFINITION["● API Definition<br/>路径、方法、参数、响应映射"]:::policy

end

subgraph VARIABLE_ENGINE["变量与状态"]
direction LR

PAGE_VARIABLE[("● Page Variables<br/>页面状态、表单值、局部变量")]:::state
APP_VARIABLE[("● App Variables<br/>应用级状态、用户信息、租户信息")]:::state
GLOBAL_VARIABLE[("◆ Global Variables<br/>环境变量、全局配置、Feature Flag")]:::state
DATA_STORE[("● Runtime Data Store<br/>接口结果、缓存、加载状态、错误状态")]:::state
VARIABLE_SCOPE["● Variable Scope<br/>全局、应用、页面、组件、循环项"]:::core

end

subgraph ACTION_ENGINE["动作、事件与规则"]
direction LR

EVENT_ENGINE["● Event Engine<br/>点击、输入、提交、挂载、卸载"]:::core
ACTION_DISPATCHER["● Action Engine<br/>导航、弹窗、赋值、请求、刷新、通知"]:::core
WORKFLOW_ACTION["● Workflow Action<br/>发起流程、处理待办、读取流程状态"]:::cap
DATA_ACTION["● Data Action<br/>CRUD、查询、导入、导出、批处理"]:::cap
NAVIGATION["● Navigation Action<br/>路由跳转、参数传递、外链"]:::cap
MODAL_ACTION["● Modal Action<br/>弹窗、抽屉、确认框、提示"]:::cap
RULE_ENGINE["◆ Rule Engine<br/>条件、联动、校验、可见性、禁用态"]:::cap
SCRIPT_SANDBOX["◆ Script Sandbox<br/>受控 JS、表达式、运行时隔离"]:::trust
AIGC_ACTION["◆ AIGC Action<br/>问数、生成文案、摘要、智能表单"]:::cap

end

end

%% =====================================================
%% 04 页面渲染与运行时
%% =====================================================
subgraph PAGE_RUNTIME["04 页面渲染与运行时 / Page Runtime"]
direction TB

subgraph RENDER_PIPELINE["渲染流水线"]
direction LR

ROUTE_RESOLVER["● Route Resolver<br/>路由、页面参数、菜单上下文"]:::core
PAGE_LOADER["● Page Loader<br/>读取发布版本、Schema、主题、权限"]:::core
SCHEMA_PARSER["● Schema Parser<br/>解析页面树、组件树、绑定、动作"]:::core
COMPONENT_RESOLVER["● Component Resolver<br/>按组件类型加载渲染器"]:::core
RENDER_ENGINE["● Render Engine<br/>递归渲染、slot、条件渲染、循环渲染"]:::core
STYLE_ENGINE["● Style Engine<br/>主题、Token、响应式、状态样式"]:::core
BINDING_ENGINE["● Binding Engine<br/>变量、接口、数据集、表达式"]:::core
INTERACTION_ENGINE["● Interaction Engine<br/>事件监听、动作分发、联动"]:::core
PERMISSION_RENDER["● Permission Renderer<br/>页面、区块、组件、字段显示控制"]:::core

end

subgraph PREVIEW_RUNTIME["预览与调试"]
direction LR

PREVIEW_SANDBOX["● Preview Sandbox<br/>隔离预览、草稿 Schema、模拟数据"]:::runtime
DEVICE_SIMULATOR["● Device Simulator<br/>PC、平板、手机、断点"]:::runtime
MOCK_SERVICE["● Mock Service<br/>接口 Mock、数据 Mock、异常 Mock"]:::runtime
DEBUG_PANEL["● Debug Panel<br/>变量、请求、事件、性能、错误"]:::runtime
ERROR_BOUNDARY["◆ Error Boundary<br/>组件异常降级、错误上报、回退 UI"]:::fallback

end

subgraph CLIENT_RUNTIME["客户端运行时"]
direction LR

BROWSER["● Browser Runtime<br/>React / Umi 页面运行环境"]:::runtime
MICRO_FRONTEND["● Micro Frontend Runtime<br/>qiankun 子应用加载与隔离"]:::runtime
LOCAL_CACHE[("● Local Cache<br/>草稿、最近页面、离线变更")]:::runtime
REALTIME_STORE[("◆ Realtime Store<br/>协作状态、数据刷新、通知")]:::runtime
SOCKET_RELAY["◆ Socket Relay<br/>实时数据、协作、发布通知"]:::runtime

end

end

%% =====================================================
%% 05 发布、部署与分发
%% =====================================================
subgraph DELIVERY["05 发布、部署与分发 / Delivery"]
direction TB

BUILD_ARTIFACT["● Page Release Artifact<br/>版本化 Schema、资源清单、依赖快照"]:::ledger
RELEASE_RECORD["● Release Record<br/>发布人、时间、备注、环境、版本"]:::trust
ENVIRONMENT_CONFIG["◆ Environment Config<br/>dev、test、staging、prod"]:::policy
ROUTE_PUBLISH["● Route Publish<br/>菜单、路由、页面访问入口"]:::core
ASSET_PUBLISH["● Asset Publish<br/>上传、压缩、指纹、资源清单"]:::core
CDN["◆ CDN / Static Delivery<br/>静态资源、缓存、版本指纹"]:::runtime
CONFIG_CENTER["◆ Config Center<br/>Feature Flag、灰度、页面配置"]:::runtime
ROLLBACK["● Page Rollback<br/>回滚到历史发布版本"]:::reentry
INVALIDATION["◆ Cache Invalidation<br/>页面、组件、资源、权限、菜单刷新"]:::reentry

end

%% =====================================================
%% 06 存储与后台运行时
%% =====================================================
subgraph INFRA["06 存储、队列与基础设施 / Infrastructure"]
direction LR

MYSQL[("● MySQL / Sequelize<br/>页面、组件、模板、版本、权限、审计")]:::runtime
REDIS[("● Redis<br/>缓存、锁、限流、会话、临时协作状态")]:::runtime
OBJECT_STORAGE[("◆ Object Storage<br/>图片、附件、页面快照、导出文件")]:::runtime
SEARCH_INDEX[("◆ Search Index<br/>页面、组件、模板、资源检索")]:::runtime
QUEUE["● BullMQ / Job Queue<br/>发布、资源处理、导出、通知、扫描"]:::bus
WORKER["● Worker Process<br/>异步任务、重试、失败处理"]:::runtime
EVENT_BUS["◆ Page Event Bus<br/>page.published、asset.updated、schema.changed"]:::bus

end

%% =====================================================
%% 07 信任、审计与失效重入
%% =====================================================
subgraph TRUST["07 信任、审计与失效重入 / Trust & Re-entry"]
direction TB

OP_LOG["● Operation Log<br/>页面、组件、模板、发布、回滚操作"]:::trust
ACCESS_LOG["◆ Page Access Log<br/>访问页面、操作组件、接口调用"]:::trust
PUBLISH_AUDIT["◆ Publish Audit Ledger<br/>校验结果、依赖清单、版本差异、发布证据"]:::ledger
POLICY_LEDGER["◆ Permission Decision Ledger<br/>页面、组件、字段、数据访问策略命中"]:::ledger
MONITORING["◆ Metrics & Tracing<br/>首屏时间、渲染耗时、错误率、接口延迟"]:::trust
ALERTING["◆ Alerting<br/>发布失败、资源缺失、渲染异常、权限异常"]:::trust
DEPENDENCY_GRAPH["◆ Dependency Graph<br/>页面 → 组件 → 资源 → 数据集 → API"]:::reentry
INVALIDATION_ENGINE["◆ Invalidation Engine<br/>依赖变更后定位受影响页面与缓存"]:::reentry
REPAIR["◆ Repair / Rebuild<br/>重建资源、重新发布、恢复版本"]:::reentry

end

%% =====================================================
%% 08 输出
%% =====================================================
subgraph OUTPUT["08 输出与交付 / Output"]
direction LR

BUSINESS_PAGE["● 业务页面<br/>表单、列表、详情、看板、门户"]:::report
MOBILE_PAGE["◆ 移动端页面<br/>响应式、H5、小程序容器"]:::report
EMBED_PAGE["◆ 嵌入式页面<br/>Iframe、SDK、外部系统嵌入"]:::report
WORKFLOW_PAGE["● 工作流页面<br/>发起页、待办页、审批详情"]:::report
DATA_PAGE["● 数据中台页面<br/>模型、数据集、报表、分析页"]:::report
AIGC_PAGE["◆ AIGC 页面<br/>问数、智能生成、知识问答"]:::report

end

%% =====================================================
%% 接入链路
%% =====================================================
PORTAL --> GATEWAY
DESIGN_STUDIO --> GATEWAY
TEMPLATE_CENTER --> GATEWAY
ASSET_CENTER --> GATEWAY
PREVIEW_CENTER --> GATEWAY
PAGE_CENTER --> GATEWAY
APP_CENTER --> GATEWAY
LOWCODE_USER --> GATEWAY
OPEN_API --> GATEWAY

GATEWAY --> ROUTER
ROUTER --> AUTH
AUTH --> TENANT_GUARD
TENANT_GUARD --> RBAC_GATE
RBAC_GATE --> DATA_SCOPE
DATA_SCOPE --> REQUEST_CONTEXT

DESIGN_STUDIO <--> COLLAB_SOCKET
COLLAB_SOCKET <--> COLLAB_MERGE
COLLAB_MERGE --> HISTORY_ENGINE

%% =====================================================
%% 页面设计与 Schema 组装
%% =====================================================
APP_CENTER --> APPLICATION
PAGE_CENTER --> PAGE
PAGE_CENTER --> PAGE_GROUP
PAGE --> MENU
PAGE --> PAGE_TEMPLATE
TEMPLATE_CENTER --> PAGE_TEMPLATE
TEMPLATE_CENTER --> BLOCK_TEMPLATE
ASSET_CENTER --> ASSET
APP_CENTER --> THEME
THEME --> DESIGN_TOKEN

COMPONENT_LIBRARY --> COMPONENT_REGISTRY
COMPONENT_SCHEMA --> COMPONENT_REGISTRY
CUSTOM_COMPONENT --> COMPONENT_REGISTRY
PLUGIN_REGISTRY --> COMPONENT_REGISTRY
ICON_LIBRARY --> COMPONENT_LIBRARY

DESIGN_STUDIO --> CANVAS_ENGINE
DESIGN_STUDIO --> LAYER_PANEL
DESIGN_STUDIO --> PROPERTY_PANEL
DESIGN_STUDIO --> RESPONSIVE_ENGINE
DESIGN_STUDIO --> HISTORY_ENGINE
DESIGN_STUDIO --> CLIPBOARD
DESIGN_STUDIO --> SHORTCUT
DESIGN_STUDIO --> FORMULA_EDITOR

CANVAS_ENGINE --> LAYOUT_TREE
CANVAS_ENGINE --> COMPONENT_TREE
PROPERTY_PANEL --> STYLE_SCHEMA
PROPERTY_PANEL --> EVENT_SCHEMA
PROPERTY_PANEL --> ACTION_SCHEMA
PROPERTY_PANEL --> BINDING_SCHEMA
PROPERTY_PANEL --> PERMISSION_SCHEMA

LAYOUT_TREE --> PAGE_SCHEMA_DOC
COMPONENT_TREE --> PAGE_SCHEMA_DOC
STYLE_SCHEMA --> PAGE_SCHEMA_DOC
EVENT_SCHEMA --> PAGE_SCHEMA_DOC
ACTION_SCHEMA --> PAGE_SCHEMA_DOC
BINDING_SCHEMA --> PAGE_SCHEMA_DOC
PERMISSION_SCHEMA --> PAGE_SCHEMA_DOC

PAGE_SCHEMA_DOC --> SCHEMA_VALIDATOR
COMPONENT_REGISTRY --> SCHEMA_VALIDATOR
ASSET --> REFERENCE_CHECK
DATASET --> REFERENCE_CHECK
API_DEFINITION --> REFERENCE_CHECK
PAGE_SCHEMA_DOC --> LAYOUT_CHECK
PERMISSION_SCHEMA --> PERMISSION_CHECK
EVENT_SCHEMA --> SECURITY_CHECK
ACTION_SCHEMA --> SECURITY_CHECK

SCHEMA_VALIDATOR --> QUALITY_GATE
REFERENCE_CHECK --> QUALITY_GATE
LAYOUT_CHECK --> QUALITY_GATE
PERMISSION_CHECK --> QUALITY_GATE
SECURITY_CHECK --> QUALITY_GATE
QUALITY_GATE --> PAGE_VERSION
PAGE_VERSION --> PUBLISH_GATE

%% =====================================================
%% 数据、变量与动作
%% =====================================================
DATA_SOURCE --> DATA_MODEL
DATA_MODEL --> DATASET
DATASET --> QUERY_TEMPLATE
DATASET --> METRIC
API_DEFINITION --> DATA_SOURCE

PAGE_VARIABLE --> VARIABLE_SCOPE
APP_VARIABLE --> VARIABLE_SCOPE
GLOBAL_VARIABLE --> VARIABLE_SCOPE
DATA_STORE --> VARIABLE_SCOPE

EVENT_SCHEMA --> EVENT_ENGINE
ACTION_SCHEMA --> ACTION_DISPATCHER
BINDING_SCHEMA --> BINDING_ENGINE
EVENT_ENGINE --> ACTION_DISPATCHER

ACTION_DISPATCHER --> WORKFLOW_ACTION
ACTION_DISPATCHER --> DATA_ACTION
ACTION_DISPATCHER --> NAVIGATION
ACTION_DISPATCHER --> MODAL_ACTION
ACTION_DISPATCHER --> RULE_ENGINE
ACTION_DISPATCHER --> SCRIPT_SANDBOX
ACTION_DISPATCHER --> AIGC_ACTION

DATA_ACTION --> DATASET
DATA_ACTION --> API_DEFINITION
WORKFLOW_ACTION --> WORKFLOW_PAGE
AIGC_ACTION --> AIGC_PAGE

%% =====================================================
%% 发布与分发
%% =====================================================
PUBLISH_GATE --> BUILD_ARTIFACT
BUILD_ARTIFACT --> RELEASE_RECORD
RELEASE_RECORD --> ENVIRONMENT_CONFIG
ENVIRONMENT_CONFIG --> ROUTE_PUBLISH
ENVIRONMENT_CONFIG --> ASSET_PUBLISH
ROUTE_PUBLISH --> CDN
ASSET_PUBLISH --> CDN
RELEASE_RECORD --> CONFIG_CENTER

BUILD_ARTIFACT --> MYSQL
ASSET --> OBJECT_STORAGE
ASSET_PUBLISH --> OBJECT_STORAGE
PAGE --> MYSQL
PAGE_VERSION --> MYSQL
COMPONENT_REGISTRY --> MYSQL
PAGE_TEMPLATE --> MYSQL
BLOCK_TEMPLATE --> MYSQL

RELEASE_RECORD -.发布事件.-> EVENT_BUS
EVENT_BUS --> INVALIDATION
INVALIDATION --> REDIS
INVALIDATION --> CDN
INVALIDATION --> SEARCH_INDEX

ROLLBACK --> PAGE_VERSION
ROLLBACK --> RELEASE_RECORD
ROLLBACK --> INVALIDATION

%% =====================================================
%% 页面运行时
%% =====================================================
LOWCODE_USER --> ROUTE_RESOLVER
ROUTE_RESOLVER --> PAGE_LOADER
PAGE_LOADER --> PAGE_SCHEMA_DOC
PAGE_LOADER --> THEME
PAGE_LOADER --> PERMISSION_SCHEMA
PAGE_LOADER --> SCHEMA_PARSER

SCHEMA_PARSER --> COMPONENT_RESOLVER
COMPONENT_RESOLVER --> RENDER_ENGINE
STYLE_ENGINE --> RENDER_ENGINE
BINDING_ENGINE --> RENDER_ENGINE
INTERACTION_ENGINE --> RENDER_ENGINE
PERMISSION_RENDER --> RENDER_ENGINE

SCHEMA_PARSER --> STYLE_ENGINE
SCHEMA_PARSER --> BINDING_ENGINE
SCHEMA_PARSER --> INTERACTION_ENGINE
PERMISSION_SCHEMA --> PERMISSION_RENDER
REQUEST_CONTEXT --> PERMISSION_RENDER

PREVIEW_CENTER --> PREVIEW_SANDBOX
PREVIEW_SANDBOX --> SCHEMA_PARSER
PREVIEW_SANDBOX --> DEVICE_SIMULATOR
PREVIEW_SANDBOX --> MOCK_SERVICE
PREVIEW_SANDBOX --> DEBUG_PANEL
RENDER_ENGINE -.异常.-> ERROR_BOUNDARY

RENDER_ENGINE --> BROWSER
BROWSER --> MICRO_FRONTEND
BROWSER --> LOCAL_CACHE
BROWSER --> REALTIME_STORE
COLLAB_SOCKET --> REALTIME_STORE
REALTIME_STORE --> SOCKET_RELAY
SOCKET_RELAY --> BROWSER

%% =====================================================
%% 数据与业务系统联动
%% =====================================================
BINDING_ENGINE --> DATASET
BINDING_ENGINE --> API_DEFINITION
BINDING_ENGINE --> PAGE_VARIABLE
BINDING_ENGINE --> DATA_STORE
RULE_ENGINE --> PAGE_VARIABLE
RULE_ENGINE --> DATA_STORE
SCRIPT_SANDBOX --> PAGE_VARIABLE
SCRIPT_SANDBOX --> DATA_STORE

WORKFLOW_ACTION --> ROUTER
DATA_ACTION --> ROUTER
AIGC_ACTION --> ROUTER

%% =====================================================
%% 异步与基础设施
%% =====================================================
PUBLISH_GATE --> QUEUE
ASSET_PUBLISH --> QUEUE
QUEUE --> WORKER
WORKER --> EVENT_BUS
WORKER --> REDIS
WORKER --> OBJECT_STORAGE

PAGE_SCHEMA_DOC --> SEARCH_INDEX
COMPONENT_REGISTRY --> SEARCH_INDEX
PAGE_TEMPLATE --> SEARCH_INDEX
ASSET --> SEARCH_INDEX

%% =====================================================
%% 审计、监控、失效重入
%% =====================================================
ROUTER -.操作日志.-> OP_LOG
PAGE_LOADER -.访问日志.-> ACCESS_LOG
PUBLISH_GATE -.发布审计.-> PUBLISH_AUDIT
PERMISSION_RENDER -.权限决策.-> POLICY_LEDGER
DATA_SCOPE -.数据范围决策.-> POLICY_LEDGER

OP_LOG --> MYSQL
ACCESS_LOG --> MYSQL
PUBLISH_AUDIT --> MYSQL
POLICY_LEDGER --> MYSQL

RENDER_ENGINE --> MONITORING
PAGE_LOADER --> MONITORING
QUEUE --> MONITORING
WORKER --> MONITORING
MONITORING --> ALERTING

PAGE_SCHEMA_DOC --> DEPENDENCY_GRAPH
COMPONENT_REGISTRY --> DEPENDENCY_GRAPH
ASSET --> DEPENDENCY_GRAPH
DATASET --> DEPENDENCY_GRAPH
API_DEFINITION --> DEPENDENCY_GRAPH

DEPENDENCY_GRAPH --> INVALIDATION_ENGINE
INVALIDATION_ENGINE --> INVALIDATION
ALERTING --> REPAIR
REPAIR --> ROLLBACK
REPAIR --> BUILD_ARTIFACT

%% =====================================================
%% 输出
%% =====================================================
RENDER_ENGINE --> BUSINESS_PAGE
RESPONSIVE_ENGINE --> MOBILE_PAGE
ROUTE_PUBLISH --> EMBED_PAGE
WORKFLOW_ACTION --> WORKFLOW_PAGE
DATA_ACTION --> DATA_PAGE
AIGC_ACTION --> AIGC_PAGE

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
classDef fallback fill:#ffedd5,stroke:#f97316,color:#7c2d12,stroke-width:1.5px
classDef bus fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:1.5px
classDef report fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
```
