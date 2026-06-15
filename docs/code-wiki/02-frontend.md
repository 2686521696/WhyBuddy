# 02. 前端架构

## 1. 前端定位

前端位于 `client/`，是整个系统的统一操作面。它既承载传统工作台，也承载实时任务中心、Autopilot 工作流页面、SlideRule V5 沉浸式页面，以及管理后台和调试页。

这个前端不是“纯 UI 壳”，而是一个包含以下能力的富客户端：

- 路由编排
- 多 store 状态协同
- REST + Socket 混合数据流
- 本地持久化与恢复
- 3D/图谱/图表可视化
- 多业务域并行存在

## 2. 目录结构

```text
client/src
├─ components/     业务组件与基础 UI
├─ contexts/       上下文提供器
├─ dev-harness/    开发调试挂件
├─ hooks/          复用逻辑
├─ i18n/           国际化资源
├─ lib/            store、API client、运行时与业务模型
├─ pages/          页面级入口
├─ runtime/        前端运行时支持
├─ styles/         样式 token 与层
└─ workers/        Web Worker
```

## 3. 启动链路

### 3.1 `main.tsx`

职责：

- 引入全局样式
- 执行 `migrateLegacyStorage()`，处理 WhyBuddy -> SlideRule 的本地数据迁移
- 创建 React Root 并渲染 `App`
- 根据环境变量注入前端分析脚本

这是“真正意义上的浏览器启动入口”。

### 3.2 `App.tsx`

职责：

- 注册 Wouter 路由
- 组织 `ThemeProvider`、`TooltipProvider`、`Toaster`
- 装配 `AppSidebar`、`ConfigPanel`、`MobileTabBar`
- 对项目工作区路由执行鉴权与恢复逻辑
- 对 `SlideRule` 路径采用 chrome-free 独立工作区策略

`App.tsx` 决定了这个项目前端并不是单页单场景应用，而是多个业务入口的统一容器。

## 4. 页面地图

### 4.1 主路由

| 路径 | 页面 | 作用 |
| --- | --- | --- |
| `/` | 重定向到 `SLIDERULE_PATH` | 默认进入 SlideRule |
| `/projects` | `ProjectCockpitHome` | 项目工作台首页 |
| `/autopilot` | `AutopilotRoutePage` | Autopilot 主页面 |
| `/projects/:projectId/tasks` | `TasksPage` | 项目任务列表 |
| `/projects/:projectId/tasks/:taskId` | `TaskDetailPage` | 项目任务详情 |
| `/tasks` | `TasksPage` | 全局任务中心 |
| `/tasks/:taskId` | `TaskDetailPage` | 单任务详情 |
| `/specs` | `SpecCenterPage` | Spec 中心 |
| `/sliderule` | `SlideRulePage` | SlideRule V5 页面 |
| `/sliderule/dev` | `SlideRuleDevPage` | SlideRule 调试页 |
| `/admin/*` | `AdminLayout` 系列页面 | 管理后台 |
| `/debug` | `DebugPage` | 调试入口 |
| `/lineage` | `LineagePage` | 血缘分析页面 |
| `/replay/:missionId` | `ReplayPage` | 任务回放 |

### 4.2 关键页面职责

#### `pages/autopilot/AutopilotRoutePage.tsx`

负责：

- 接收输入与澄清信息
- 展示 route/spec/effect preview 等阶段性输出
- 承接右侧工作台
- 连接 blueprint 相关 API 与实时状态

#### `pages/tasks/TasksPage.tsx`

负责：

- 展示任务队列
- 组织任务详情、事件、证据、接管动作
- 与 `tasks-store` 共同驱动任务中心

#### `pages/specs/SpecCenterPage.tsx`

负责：

- 展示 Spec 文档、版本、证据、产物完成度
- 充当项目规格资产中心

#### `pages/SlideRule.tsx`

负责：

- SlideRule V5 的沉浸式工作流
- 承载画布、HUD、输入区、交付物和运行态
- 走独立会话存储逻辑，避免被旧工作台状态污染

## 5. 组件层分工

### 5.1 `components/ui/`

基础 UI 组件层，主要是通用视觉与交互组件。

### 5.2 `components/tasks/`

任务中心相关组件，负责：

- 任务列表
- 任务详情面板
- 证据与日志呈现
- 接管与操作按钮

### 5.3 `components/autopilot/`

Autopilot 与 blueprint 相关组件，负责：

- 规划路径
- 文档/规格展示
- 生成状态与阶段反馈

### 5.4 `components/three/`

Three.js 相关可视化层，负责：

- 3D 场景
- 沉浸式视觉表达
- 与 SlideRule 页面的复杂渲染配合

### 5.5 `components/replay/`

回放相关组件，负责：

- 任务历史还原
- 事件流浏览
- 与 Mission/Replay 数据配合显示

## 6. 状态管理设计

项目大量使用 Zustand，将状态按业务域拆分，而不是单一大 store。

## 6.1 全局公共 store

### `lib/store.ts`

主要职责：

- 全局 UI 状态
- 语言与运行模式
- AI 配置
- 聊天/PDF/语音等全局能力状态

适合承载“跨业务域共享但不属于单个页面”的状态。

### `lib/auth-store.ts`

主要职责：

- 登录态
- 当前用户
- 认证流程
- `/api/auth/*` 调用封装

### `lib/project-store.ts`

主要职责：

- 项目列表与当前项目选择
- 项目级 spec、路线、证据、资产与草稿
- 页面切换时的项目上下文恢复

这是项目工作区的核心 store。

## 6.2 工作流/任务相关 store

### `lib/workflow-store.ts`

主要职责：

- 工作流运行态
- 组织结构、心跳、阶段进度
- 与 `socket.io-client` 连接的实时更新

### `lib/tasks-store.ts`

主要职责：

- 任务摘要与详情
- Mission 状态同步
- 事件日志
- 操作员动作与实时事件

这是任务中心最核心的 store。

### `lib/blueprint-realtime-store.ts`

主要职责：

- blueprint/Autopilot 相关的实时状态
- 生成过程中的阶段事件
- 右侧工作台与生成结果同步

## 6.3 专项 store

仓库还按垂直域拆分了大量 store，例如：

- `admin-store.ts`
- `knowledge-store.ts`
- `rag-store.ts`
- `lineage-store.ts`
- `permission-store.ts`
- `sandbox-store.ts`
- `telemetry-store.ts`
- `swarm-store.ts`
- `a2a-store.ts`

这说明前端采用的是“按业务域分治”的 store 组织方式。

## 7. API 接入层

## 7.1 通用请求封装

### `lib/api-client.ts`

其中的 `fetchJsonSafe` 是通用基础能力，负责：

- 请求发起
- HTTP 错误处理
- 非 JSON 返回兜底
- HTML fallback 识别
- 统一错误格式输出

它是前端访问后端的基础设施函数。

## 7.2 业务 API 客户端

### `lib/blueprint-api.ts`

主要职责：

- 封装 `/api/blueprint/*`
- 组织 intake、clarification、jobs、spec documents、capabilities 等调用

### `lib/mission-client.ts`

主要职责：

- 封装 Mission/任务相关接口
- 供 `tasks-store.ts` 消费

### `lib/scene-command-client.ts`

主要职责：

- 场景命令类接口调用
- 与场景/阶段流相关能力联动

### `lib/nl-command-client.ts`

主要职责：

- 自然语言命令相关接口访问

## 8. 实时通信

前端不是只靠轮询更新，而是大量依赖 Socket.IO。

主要接入位置：

- `workflow-store.ts`
- `tasks-store.ts`
- `blueprint-realtime-store.ts`

实时事件承担的职责包括：

- 任务状态推进
- 执行器日志回放
- telemetry/cost 等系统级状态广播
- 工作流与蓝图生成过程反馈

## 9. 前端依赖关系

```mermaid
flowchart TD
    A[pages] --> B[components]
    A --> C[lib stores]
    B --> C
    C --> D[api-client]
    C --> E[socket.io-client]
    D --> F[/api server]
    C --> G[@shared contracts/types]
```

可以简化为：

- `pages/` 组织页面级流程
- `components/` 负责业务组件
- `lib/` 负责状态、接口、模型和前端运行时
- `shared/` 负责类型对齐

## 10. 前端核心符号速查

| 文件/符号 | 角色 | 说明 |
| --- | --- | --- |
| `main.tsx` | 启动入口 | 根节点挂载与存储迁移 |
| `App.tsx` | 应用壳 | 路由与全局布局装配 |
| `fetchJsonSafe` | 通用函数 | 统一 HTTP/JSON 错误处理 |
| `useAppStore` | 全局 store | UI 和运行时公共状态 |
| `useAuthStore` | 认证 store | 登录态与用户状态 |
| `useProjectStore` | 项目 store | 项目工作区核心状态 |
| `useWorkflowStore` | 工作流 store | 工作流执行态与实时同步 |
| `useTasksStore` | 任务 store | Mission/任务中心状态 |
| `blueprint-api.ts` | API SDK | blueprint 相关调用入口 |
| `sliderule-runtime.ts` | 运行时模型 | SlideRule 页面内部运行逻辑 |

## 11. 典型数据流

### 11.1 任务中心

```text
TasksPage
  -> tasks-store
  -> mission-client
  -> server /api/tasks
  -> Socket 更新
  -> tasks-store 回写
  -> UI 重渲染
```

### 11.2 Autopilot / Blueprint

```text
AutopilotRoutePage
  -> blueprint-api
  -> server /api/blueprint/*
  -> blueprint-realtime-store
  -> 右侧工作台 / 文档视图 / effect preview
```

### 11.3 SlideRule V5

```text
SlideRulePage
  -> sliderule-runtime
  -> sliderule-http-store / browser-llm / byok 配置
  -> server /api/sliderule
  -> 会话存储与交付物更新
```

## 12. 前端设计特点

### 12.1 多工作区并存

前端同时维护：

- 传统项目工作区
- Autopilot 工作区
- SlideRule 独立工作区
- Admin/Debug 工具型工作区

这导致路由和 store 设计都明显偏“多中心”。

### 12.2 状态强于组件

复杂度主要沉淀在 `lib/` 的 store 和运行时模型，而不是单纯组件树。阅读前端时应优先看：

- `App.tsx`
- `lib/*.ts`
- 页面文件
- 再看复杂组件

### 12.3 前端承担了明显的运行时职责

例如：

- 本地恢复
- 会话迁移
- 路由协调
- Socket 订阅
- 交付物状态整合

它更像“浏览器端控制台”，而不只是展示层。

## 13. 阅读建议

建议按以下顺序阅读前端源码：

1. `client/src/main.tsx`
2. `client/src/App.tsx`
3. `client/src/lib/api-client.ts`
4. `client/src/lib/store.ts`
5. `client/src/lib/project-store.ts`
6. `client/src/lib/tasks-store.ts`
7. `client/src/lib/workflow-store.ts`
8. `client/src/lib/blueprint-api.ts`
9. `client/src/pages/autopilot/AutopilotRoutePage.tsx`
10. `client/src/pages/tasks/TasksPage.tsx`
11. `client/src/pages/SlideRule.tsx`
