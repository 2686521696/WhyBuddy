# 03. 后端架构

## 1. 后端定位

后端位于 `server/`，是整个系统的业务宿主与编排中心。它不只是常规 REST API 服务，还同时承担：

- 任务运行时
- 工作流编排
- 蓝图/SlideRule 规格生成
- 权限与审计
- 知识图谱与 RAG
- 回放与血缘
- Socket 实时广播
- 与执行器、A2A、Feishu、外部 AI 能力的接线

因此，`server/` 更接近“应用平台内核”，而不是简单的 CRUD 服务。

## 2. 目录结构

```text
server
├─ audit/         审计与导出
├─ auth/          鉴权、会话、邮件验证码
├─ core/          工作流、Agent、Socket、执行桥等核心能力
├─ db/            DB 访问与数据存储
├─ feishu/        飞书集成
├─ knowledge/     知识图谱与查询
├─ lineage/       血缘存储与分析
├─ memory/        多种记忆/存储能力
├─ permission/    权限策略与校验
├─ persistence/   持久化配置与基础设施
├─ rag/           检索增强生成
├─ replay/        回放与事件采集
├─ routes/        HTTP API 路由
├─ runtime/       运行时支持
├─ sliderule/     SlideRule 服务端领域逻辑
├─ startup/       启动相关逻辑
├─ tasks/         Mission 任务域
├─ tool/          工具适配
└─ web-aigc/      Web AIGC 相关能力
```

## 3. 启动与装配方式

## 3.1 `server/index.ts` 是 composition root

项目没有使用容器框架做统一依赖注入，而是直接在 `server/index.ts` 内完成手工装配。这个文件负责：

- 读取 `.env`
- 初始化 Express 与 HTTP Server
- 初始化 Socket.IO
- 初始化 Mission Runtime、Workflow Engine、知识图谱、权限系统、Lineage、Replay 等核心单元
- 构建 BlueprintServiceContext
- 创建各个业务路由
- 通过 `app.use("/api/*", router)` 将它们挂载到统一宿主

这让后端架构有一个非常鲜明的特点：看懂系统，必须先看启动装配。

## 3.2 依赖注入风格

主要是三种方式：

### 方式 A：入口手工实例化

例如在 `server/index.ts` 中直接创建：

- `GraphStore`
- `OntologyRegistry`
- `KnowledgeReviewQueue`
- `MissionRuntime`
- `SandboxRelay`
- `HeartbeatMonitor`
- `RoleStore`
- `PolicyStore`
- `TokenService`
- `ExecutorClient`

### 方式 B：路由工厂

大量路由使用 `createXRouter(deps)` 风格，例如：

- `createAuthRouter(...)`
- `createProjectsRouter(...)`
- `createTaskRouter(...)`
- `createKnowledgeRouter(...)`
- `createAdminRouter(...)`
- `createAuditRouter(...)`
- `createPermissionRouter(...)`
- `createBlueprintRouter(...)`

优点是依赖关系显式，可测试替换方便。

### 方式 C：局部领域上下文容器

Blueprint 子系统使用 `BlueprintServiceContext`，它是项目里最接近“容器”的局部实现，用于聚合：

- LLM 能力
- Event Bus
- Job Store
- Companion / Traceability / Checks Ledger / Preview Audit
- Docker capability bridge
- MCP/GitHub/http fetcher/skill registry 等运行时适配器

## 4. HTTP 路由分组

`server/index.ts` 将大量路由统一挂载到主服务。可以按业务域分组理解：

## 4.1 任务与工作流

- `/api/tasks`
- `/api/workflows`
- `/api/reports`
- `/api/replay`
- `/api/agents`

## 4.2 SlideRule / Blueprint

- `/api/blueprint`
- `/api/sliderule`
- `/api/whybuddy`

其中 `/api/whybuddy` 主要用于历史兼容。

## 4.3 鉴权与项目治理

- `/api/auth`
- `/api/projects`
- `/api/admin`
- `/api/permissions`

## 4.4 知识与治理

- `/api/knowledge`
- `/api/rag`
- `/api/audit`
- `/api/lineage`

## 4.5 工具与 AI 能力

- `/api/skills`
- `/api/web-search`
- `/api/vision`
- `/api/voice`
- `/api/nl-command`
- `/api/analytics`
- `/api/config`
- `/api/export`

## 4.6 执行器回调

- `/api/executor/events`

这是执行器把事件、日志、截图、进度回传给主服务的关键入口。

## 5. 核心子系统

## 5.1 Mission Runtime

位置：`server/tasks/mission-runtime.ts`

职责：

- 创建任务
- 更新任务执行态
- 记录阶段与日志
- 进入等待决策状态
- 完成/失败/取消任务
- 向前端广播 Socket 更新
- 挂接 Lineage 记录

它本质上是任务状态机与任务事件分发器。

### 关键类与函数

| 符号 | 类型 | 说明 |
| --- | --- | --- |
| `MissionRuntime` | 类 | Mission 生命周期核心 |
| `createTask()` | 方法 | 创建任务并广播 |
| `markMissionRunning()` | 方法 | 切换到运行态 |
| `updateMissionStage()` | 方法 | 更新阶段状态 |
| `logMission()` | 方法 | 写入任务日志 |
| `waitOnMission()` | 方法 | 进入 HITL/等待态 |
| `finishMission()` | 方法 | 完成任务并记录结果 |
| `failMission()` | 方法 | 标记失败 |

## 5.2 Workflow Engine

位置：`server/core/workflow-engine.ts`

职责：

- 创建工作流 ID
- 写入 workflow repo
- 按阶段驱动方向、规划、执行、评审、审计、修订、验证、总结与演化
- 在执行阶段后桥接 Executor
- 将失败状态与阶段错误写回结果

它描述的是一个多阶段、多角色、多策略的工作流管线。

### 关键类与函数

| 符号 | 类型 | 说明 |
| --- | --- | --- |
| `WorkflowEngine` | 类 | 工作流编排核心 |
| `startWorkflow()` | 方法 | 创建工作流并异步启动 |
| `runPipeline()` | 方法 | 串起完整阶段流 |
| `bridgeToExecutor()` | 方法 | 将阶段输出桥接到执行器 |
| `emitStageCompleted()` | 方法 | 写入阶段完成事件 |

## 5.3 Agent Registry

位置：`server/core/registry.ts`

职责：

- 从数据库加载常驻 agent
- 管理 guest agent 并限制最大并发
- 提供按角色、部门、manager 维度的 agent 查询
- 初始化 reputation profile

### 关键类与函数

| 符号 | 类型 | 说明 |
| --- | --- | --- |
| `AgentRegistry` | 类 | Agent 注册中心 |
| `init()` | 方法 | 从 DB 初始化 agent |
| `getCEO()` | 方法 | 获取 CEO agent |
| `getManagers()` | 方法 | 获取管理者 agent |
| `registerGuest()` | 方法 | 注册 guest agent，含并发限制 |
| `MAX_GUESTS` | 常量 | guest agent 上限 |

## 5.4 Socket 实时层

位置：`server/core/socket.ts`

职责：

- 初始化 Socket.IO
- 在新连接时下发 telemetry/cost 当前快照
- 广播 workflow、telemetry、cost、reputation、sandbox log 等事件
- 以节流方式控制高频广播

### 关键函数

| 符号 | 说明 |
| --- | --- |
| `initSocketIO()` | 初始化 Socket 服务 |
| `getSocketIO()` | 获取全局 Socket 实例 |
| `emitEvent()` | 广播 agent/workflow 事件 |
| `emitTelemetryUpdate()` | 节流广播 telemetry |
| `emitCostUpdate()` | 节流广播成本状态 |
| `registerSandboxRelay()` | 注册 sandbox 日志历史读取能力 |

## 5.5 Blueprint / SlideRule 子系统

位置：

- `server/routes/blueprint.ts`
- `server/routes/blueprint/context.ts`
- `server/routes/sliderule.ts`

职责：

- intake、clarification、route planning
- spec tree 与 spec documents 生成
- prompt package、engineering handoff、traceability matrix
- effect preview、preview audit、checks ledger、companion
- capability bridge 与 role container 运行时

其中 `context.ts` 是整个 blueprint 栈的统一运行时依赖容器。

### 关键类与函数

| 符号 | 类型 | 说明 |
| --- | --- | --- |
| `buildBlueprintServiceContext()` | 工厂函数 | 装配 blueprint 所需的全部依赖 |
| `createBlueprintRouter()` | 路由工厂 | 暴露 `/api/blueprint` 的主要 API |
| `rebindBlueprintServiceContextRuntimeAdapters()` | 函数 | 启动后回填运行时适配器 |

## 5.6 权限子系统

目录：`server/permission/`

典型组件：

- `RoleStore`
- `PolicyStore`
- `TokenService`
- `AuditLogger`
- `DynamicPermissionManager`
- `ConflictDetector`
- `PermissionCheckEngine`

职责：

- 角色与策略管理
- 动态权限
- 能力令牌
- 权限冲突检测
- 权限审计

## 5.7 知识/RAG/审计/血缘

### 知识图谱

目录：`server/knowledge/`

典型对象：

- `GraphStore`
- `OntologyRegistry`
- `KnowledgeReviewQueue`
- `KnowledgeGraphQuery`
- `KnowledgeService`

### RAG

目录：`server/rag/`

职责：

- 检索增强生成依赖初始化
- 暴露 `/api/rag`

### 审计

目录：`server/audit/`

职责：

- 审计事件记录
- 审计导出
- 风险与异常检测

### 血缘

目录：`server/lineage/`

典型对象：

- `JsonLineageStorage`
- `LineageQueryService`
- `LineageAuditService`
- `ChangeDetectionService`
- `LineageExportService`

## 6. 后端依赖图

```mermaid
flowchart TD
    IDX[server/index.ts] --> ROUTES[routes/*]
    IDX --> CORE[core/*]
    IDX --> TASKS[tasks/*]
    IDX --> PERM[permission/*]
    IDX --> KNOW[knowledge/*]
    IDX --> RAG[rag/*]
    IDX --> AUDIT[audit/*]
    IDX --> LINEAGE[lineage/*]
    ROUTES --> SH[@shared/*]
    CORE --> SH
    TASKS --> SH
    IDX --> EXCLIENT[ExecutorClient]
    EXCLIENT --> EXEC[services/lobster-executor]
```

## 7. 数据与事件流

## 7.1 HTTP 请求流

```text
client
  -> /api/*
  -> 对应 router
  -> 调用 service/runtime/store
  -> 写入 DB/file store/memory
  -> 返回 JSON
```

## 7.2 实时事件流

```text
Mission/Workflow/Executor 回调
  -> MissionRuntime / Replay / Blueprint
  -> socket.ts 广播
  -> client stores 更新
  -> UI 实时刷新
```

## 7.3 执行器回调流

```text
server 发任务
  -> executor 创建 job
  -> executor 执行并持续发 events
  -> /api/executor/events 校验签名与时效
  -> Mission / Blueprint / Replay 更新
  -> 前端收到实时推送
```

## 8. 后端关键符号速查

| 文件/符号 | 角色 | 说明 |
| --- | --- | --- |
| `server/index.ts` | 启动入口 | 服务端统一装配与路由挂载 |
| `MissionRuntime` | 任务状态机 | 管理 Mission 生命周期 |
| `WorkflowEngine` | 工作流引擎 | 编排多阶段工作流 |
| `AgentRegistry` | 注册中心 | 管理 resident/guest agents |
| `initSocketIO` | 实时入口 | 初始化 Socket.IO |
| `buildBlueprintServiceContext` | 局部容器工厂 | 装配 blueprint 运行期依赖 |
| `createBlueprintRouter` | 路由工厂 | 暴露 blueprint API |
| `createTaskRouter` | 路由工厂 | 暴露任务 API |
| `createPermissionRouter` | 路由工厂 | 暴露权限相关 API |
| `ExecutorClient` | 集成客户端 | 主服务到执行器的桥 |

## 9. 架构特点

### 9.1 启动文件非常重

`server/index.ts` 同时承担：

- 初始化
- 依赖接线
- 路由挂载
- 兼容逻辑
- 外部集成

所以它是理解架构的最佳入口，但也会成为复杂度聚集点。

### 9.2 Router Factory 模式广泛存在

这是一种显式依赖风格，优点是：

- 便于阅读依赖关系
- 便于测试替换
- 避免全局隐式单例污染

### 9.3 任务系统和蓝图系统并行存在

后端中至少有两条重要主线：

- Mission/Workflow 任务执行链
- Blueprint/SlideRule 规格生成链

两者共享部分能力，但不是同一个领域模型。

### 9.4 后端承担大量平台级能力

不仅有业务 API，还有：

- 安全校验
- Socket 广播
- 外部集成
- 审计
- 知识图谱
- 血缘分析

这使得它更像“智能平台后端”。

## 10. 阅读建议

建议按以下顺序阅读后端：

1. `server/index.ts`
2. `server/tasks/mission-runtime.ts`
3. `server/core/workflow-engine.ts`
4. `server/core/registry.ts`
5. `server/core/socket.ts`
6. `server/routes/tasks.ts`
7. `server/routes/blueprint/context.ts`
8. `server/routes/blueprint.ts`
9. `server/routes/sliderule.ts`
10. `server/permission/*`
11. `server/knowledge/*`
12. `server/lineage/*`
