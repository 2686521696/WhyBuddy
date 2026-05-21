---
inclusion: manual
---

# Web-AIGC 平台任务投影：节点事件映射与回放完整性验证

## 目的

本文用于沉淀 `web-aigc-platform-mission-projection` 规格中的两类关键内容：

1. 节点事件到任务事件的映射规则
2. 回放链路完整性验证的已落地依据

本文只基于当前主仓内已经存在的契约、路由、存储与测试证据整理，不额外假设未落库的实现。

## 对账结论摘要

1. `mission-projection` 主链已经形成可验证闭环：`workflow / mission / session / replayId` 关联、`/api/tasks/:id/projection`、`/api/tasks/:id/session`、`projection.replayId -> replay` 都有实现与测试依据。
2. `monitoring` 当前是兼容投影层，而不是新的平台事实源。`MissionProjectionView.monitoring` 只提供摘要字段，`/api/v1/:tenantId/aigc-monitoring/*` 则是在 `workflow + mission + graph` 之上派生的兼容接口。
3. 节点输出接入任务产物链路已经有真实实现与测试；报告能力目前主要通过 `mission.summary` 与 `workflow.results.final_report` 兼容透出，还不是 `MissionProjectionView` 的独立报告模型。
4. replay 路由路径参数名仍沿用 `missionId`，但在本切片的真实链路里，消费的是 `projection.replayId` 对应的 timeline key；文档说明必须按这个口径理解。

## 现有依据

当前可以直接作为依据的实现与测试主要包括：

- `shared/web-aigc-observability.ts`
  - 定义了 `node.started`、`node.completed`、`node.failed`、`node.waiting_input`、`human.decision_submitted` 等事件，以及它们应进入的 sink。
- `shared/mission/projection.ts`
  - 定义了 `workflowId / instanceId / sessionId / replayId / sourceApp` 的统一解析与合并规则。
- `server/tasks/mission-projection.ts`
  - 把 mission、workflow、session、graph、monitoring 汇总成 `MissionProjectionView`。
- `server/routes/tasks.ts`
  - 提供 `GET /api/tasks/:id/projection`、`GET /api/tasks/:id/session`、`POST /api/tasks/:id/decision`。
- `server/routes/replay.ts`
  - 提供 `GET /api/replay/:missionId`、`POST /api/replay/:missionId/verify` 等 replay 查询与完整性验证能力。
  - 这里的路径参数名沿用 `missionId`，但在任务投影闭环里实际承接的是 replay timeline key。
- `server/replay/replay-store.ts`
  - 以 `events.jsonl + timeline.json(checksum)` 的方式持久化并校验 replay 数据。
- `server/replay/interceptors.ts`
  - 已把 mission 更新事件与 executor 回调事件统一归档到 `projection.replayId` 对应的 replay timeline。
- `server/core/aigc-monitoring-projection.ts`
  - 基于 `workflow + mission + graph` 派生监控实例列表、详情、会话详情与终止结果。
- `server/routes/aigc-monitoring.ts`
  - 提供 `GET /api/v1/:tenantId/aigc-monitoring/instances*` 与终止接口，作为 web-aigc 监控兼容层。
- 已纳入版本控制的测试证据
  - `server/tests/workflows-routes.test.ts`
  - `server/tests/mission-store.test.ts`
  - `server/tests/mission-routes.test.ts`
  - `server/tests/task-artifact-routes.test.ts`
  - `server/tests/replay-store.test.ts`
  - `server/tests/replay-interceptors.test.ts`
  - `server/tests/replay-routes.test.ts`
  - `server/tests/aigc-monitoring-routes.test.ts`

## 节点事件到任务事件的映射规则

### 规则目标

映射规则的目标不是为图运行时再造一套前台模型，而是把节点级执行语义稳定投影到 Cube 现有的 `mission / task / event / decision / artifact / replay` 结构中。

### 统一约束

所有节点事件在投影到任务侧时，应至少满足以下约束：

1. 必须保留 `workflowId / instanceId / replayId` 与 `missionId` 的关联。
2. 任务侧只保留用户可理解的状态与证据，不在任务模型内复刻全部图内部细节。
3. 需要人工介入的节点，必须优先落到 `waiting + decision + decisionHistory` 这一套现有 HITL 结构。
4. 边与循环等细粒度执行轨迹，默认优先进入 replay，不强制逐条投影为 mission event。

### 映射表

| Web-AIGC 事件 | 任务侧主要承接 | 任务状态/事件建议 | 说明 |
| --- | --- | --- | --- |
| `node.started` | `MissionRuntime.markMissionRunning()` 或 `updateMissionStage(..., status=running)` | `status=running`，追加 `progress` 事件 | 表示节点已进入执行。若节点对应已有 stage，可更新该 stage；若只是细粒度子节点，可记录为 progress/log，而不新增 task stage。 |
| `node.completed` | `logMission()`、`patchMissionExecution()`、必要时 `finishMission()` | 追加 `progress` 或 `log` 事件；若产生文件/报告则挂到 `artifacts` | 节点完成默认不直接意味着 mission 完成。只有在图整体完成时才应投影为 `done`。 |
| `node.failed` | 可恢复失败用 `logMission(..., level=error)`；终态失败用 `failMission()` | 可恢复：`log/error`；不可恢复：`status=failed` + `failed` 事件 | 需要区分“单节点失败但流程可继续”和“图执行终止”。 |
| `node.waiting_input` | `waitOnMission()` + `decision` 载荷 | `status=waiting`，追加 `waiting` 事件 | 适用于 `user_input / selection / confirm_judge / param_collection` 等需要人工输入的节点。 |
| `human.decision_submitted` | `submitMissionDecision()` + `decisionHistory` | 任务从 `waiting` 恢复到 `running`，并在 `decisionHistory` 中留下记录 | 它不是 node 事件本身，但与 `node.waiting_input` 配对，构成可审计的人机闭环。 |
| `edge.transitioned` | replay 为主，任务侧不要求单独映射 | 可选 `log`，默认不单独投影 | 分支选择、普通边跳转应进入 replay 轨迹，不建议污染 mission 事件流。 |
| `edge.loop_iterated` | replay 为主，任务侧可聚合到进度消息 | 可选 `progress` 或 `log` | 循环细节通常不适合逐条展示给任务用户，建议按批次聚合。 |

### 任务视图层面的承接原则

#### 1. 任务事件流

任务事件流只承接“用户能理解的关键里程碑”：

- 开始执行
- 节点完成并产出结果
- 进入等待输入
- 提交人工决策
- 失败/终止

不要求把每条内部边转换成 task event。

#### 2. 任务决策链

当节点属于 HITL 类型时，推荐统一映射为：

1. `node.waiting_input`
   - 进入 `MissionRuntime.waitOnMission()`
   - 任务变为 `waiting`
   - 决策载荷进入 `task.decision`
2. `human.decision_submitted`
   - 进入 `submitMissionDecision()`
   - 决策结果进入 `decisionHistory`
   - 任务恢复为 `running`

#### 3. 任务产物与报告

节点输出如果具备用户消费价值，应该进入以下二选一或同时进入：

- `artifacts`
  - 文件、报告、链接、日志
- mission 总结/报告
  - 用于汇总关键节点路径、输入输出和异常点

#### 4. 回放轨迹

以下内容优先进入 replay，而不是 task event：

- 边跳转
- 循环迭代
- 节点细粒度内部事件
- 资源访问的时间序列

这与 spec 的设计约束一致：任务系统是用户主界面，replay 是执行证据面。

## 回放链路完整性验证

### 当前已经有证据的部分

#### 1. 投影 ID 链接已形成统一解析规则

`shared/mission/projection.ts` 中的 `resolveMissionProjectionLinks()` 已经统一处理：

- `workflowId`
- `instanceId`
- `sessionId`
- `replayId`
- `sourceApp`

这说明 mission 视图与 replay 视图共享同一套链接语义，而不是临时拼接。

#### 2. workflow -> mission projection links 有测试覆盖

现有测试已经覆盖：

- `server/tests/workflows-routes.test.ts`
  - `stores workflow projection input and creates mission with projection links`
- `server/tests/mission-store.test.ts`
  - `persists mission projection links across snapshot reloads`
- `server/tests/mission-routes.test.ts`
  - `GET /api/tasks/:id/projection`
  - `GET /api/tasks/:id/session`

这部分可以证明 mission projection links 的建立、持久化与读取已经具备稳定依据。

#### 3. replay 数据完整性校验机制已经存在

`server/replay/replay-store.ts` 目前采用：

- `events.jsonl` 存事件流
- `timeline.json` 存元数据与 `checksum`
- `verifyIntegrity()` 通过重新计算 `events.jsonl` 的 SHA-256 与 `timeline.json.checksum` 对比来验证完整性

`server/routes/replay.ts` 还提供了：

- `POST /api/replay/:missionId/verify`

这意味着 replay 完整性验证不只是设计上的要求，而是已有后端能力。需要额外说明的是，虽然路由参数名写作 `missionId`，但在任务投影链路中实际复用的是 `projection.replayId`。

#### 4. replay 完整性已有存储级测试

`server/tests/replay-store.test.ts` 已覆盖至少两类关键验证：

- `untampered data passes integrity verification`
- `tampered event data fails integrity verification`

这两项足以说明“checksum 校验是否有效”已经有直接测试证据。

### 当前已经补齐的关键闭环证据

在本轮主线补强后，`mission-projection` 维度的 replay 链路已经具备以下端到端证据：

#### 1. mission 更新事件已统一写入 `projection.replayId`

- `server/tasks/mission-runtime.ts`
  - `MissionRuntime` 现在暴露 `hooks.onMissionUpdated`
  - mission 更新时会触发 replay 拦截链路
- `server/replay/interceptors.ts`
  - `installMissionInterceptor()` 会优先把事件写入 `mission.projection.replayId`
  - `installExecutorInterceptor()` 也会把 executor 事件归档到同一 replay timeline
- `server/index.ts`
  - 已把 mission runtime 与 replay interceptor 真正接线

这意味着 mission 侧事件与 executor 侧事件不再各自漂移，而是按同一 `replayId` 收拢。

#### 2. projection -> replay route 已有闭环测试

新增并通过的测试包括：

- `server/tests/replay-interceptors.test.ts`
  - `prefers mission projection replayId when emitting mission replay events`
  - 证明 mission 更新事件会优先落到 `projection.replayId`
- `server/tests/replay-routes.test.ts`
  - `reuses mission projection replayId to resolve replay timeline metadata`
  - 证明：
    1. mission 通过 `projection.replayId` 建立投影链接
    2. mission 更新事件经 replay 拦截器写入 replay store
    3. `GET /api/tasks/:id/projection` 返回同一 `replayId`
    4. `GET /api/replay/:replayId` 能读到对应 timeline 元数据

这条测试链已经把“任务投影链接”和“回放读取入口”真正串起来。

### 3. replay route 已补齐 relation index 摘要与过滤核验

截至 2026-04-23，`server/routes/replay.ts` 在不改 replay store 契约的前提下，已经能够稳定承接 mission projection 与 web-aigc relation index 的最小闭环：

- `GET /api/replay/:missionId/events`
  - 保留原有 `agentId / eventType / startTime / endTime / limit / offset`
  - 额外支持 `traceId / decisionId / nodeId / stage / eventKey`
  - relation 维度过滤在 route 层完成，随后再执行 `limit / offset`，避免先分页后过滤导致漏数
- `GET /api/replay/:missionId`
  - 继续返回 timeline metadata，而不是原始 `events`
  - 额外补出 `replayId`
  - 额外补出 `relationIndex` 摘要，当前至少包含：
    - `traceIds`
    - `decisionIds`
    - `nodeIds`
    - `stages`
    - `eventKeys`

当前与此对应的测试依据已经在 `server/tests/replay-routes.test.ts` 中补齐：

- `GET /api/replay/:missionId/events supports relation index filters without breaking pagination`
  - 验证 `traceId / decisionId / nodeId / stage / eventKey` 过滤
  - 验证 relation 过滤后分页仍稳定
- `GET /api/replay/:missionId returns relation index summary metadata`
  - 验证 metadata 中存在 `replayId`
  - 验证 `relationIndex` 五组摘要字段
- `reuses mission projection replayId to resolve replay timeline metadata`
  - 除验证 `projection.replayId -> replay route` 的主链闭环外，也额外锁定了 `relationIndex` 摘要结构不会在后续回归中丢失

因此当前更准确的主线结论是：

1. `projection.replayId` 已经不只是“能打开 replay 页面”的链接字段，而是 mission / executor 事件归档与 replay metadata 查询的共同主键。
2. replay route 已经具备 relation index 级别的最小查询面，足以支撑 web-aigc 的对账与排障视角。
3. 这套能力当前以 route 层聚合与过滤为主，后续若出现大规模数据量场景，再评估是否下沉到 replay store 原生索引。

## monitoring 对账结论

### 已验证的部分

- `server/tasks/mission-projection.ts`
  - `MissionProjectionView.monitoring` 已经可以返回 `instanceUuid / status / lastUpdateTime / executor` 这一组监控摘要。
- `server/tests/mission-routes.test.ts`
  - 证明 `GET /api/tasks/:id/projection` 能返回带 links 的任务投影视图。
- `server/tests/aigc-monitoring-routes.test.ts`
  - 已验证监控兼容接口的实例列表、实例详情、控制流边保留、会话详情、终止动作复用 mission terminate 流程。
  - 已验证会优先使用 `projection.sessionId / projection.sourceApp` 生成监控会话详情。

### 兼容映射而非原生闭环的部分

- `MissionProjectionView.monitoring`
  - 当前只暴露监控摘要，不承载节点明细、边明细、会话消息或审计链。
- `/api/v1/:tenantId/aigc-monitoring/instances*`
  - 当前本质上是兼容接口，通过 `workflow + mission + graph` 现有数据结构临时投影得到。
  - 它已经可用且有测试，但不应被表述为“Cube 内部另有一套原生监控数据模型”。
- 监控详情中的 `outputVariables.summary / outputVariables.report`
  - 目前主要来自 `mission.summary` 与 `workflow.results.final_report` 的兼容透出。
  - 这能支撑前台查看，但还不是 `MissionProjectionView` 统一报告模型。

## 任务产物与报告链路对账

### 已验证的部分

- `server/tasks/mission-runtime.ts`
  - `patchMissionExecution()` 可以把执行产物挂到 mission 的 `artifacts`。
- `server/routes/tasks.ts`
  - 提供 `/api/tasks/:id/artifacts`、下载与预览接口。
- `server/tests/task-artifact-routes.test.ts`
  - 已验证文件、URL、日志产物的列举、下载、预览与回退日志读取链路。

### 当前仍需谨慎表述的部分

- “报告” 在当前实现中更多是复用已有 `mission.summary` 与 `workflow.results.final_report`。
- `MissionProjectionView` 还没有独立的 `report` 字段，也没有把“节点执行路径 + 输入输出 + 异常点”收敛成单独任务报告对象。
- 因此当前更准确的说法是：
  - 任务产物挂接链路已验证。
  - 任务报告链路已有兼容透出，但尚未独立建模。

### 对 task 回写的判断

| task | 状态 | 对账结论 |
| --- | --- | --- |
| `定义 workflowId / missionId / instanceId 关联结构` | 已完成 | `resolveMissionProjectionLinks()`、mission snapshot 持久化与 `projection links` 读取均有实现和测试。 |
| `定义节点事件到任务事件的映射规则` | 已完成 | 本文已把 `node / edge / human` 事件如何落到 `mission / decision / artifact / replay` 的规则收紧为中文口径，并与现有 observability 契约对齐。 |
| `将节点输出挂接到任务产物与报告` | 已完成 | 产物链路已通过任务接口与测试验证；报告当前按“兼容透出”口径完成，不表述为独立 `MissionProjectionView.report` 能力。 |
| `定义图执行失败、终止、等待输入的投影规则` | 已完成 | `waiting / decision / cancel / terminate` 的任务侧入口和兼容监控终止链路都已有实现与测试支撑。 |
| `验证回放链路是否完整` | 已完成 | replay 完整性校验、`projection.replayId` 复用、mission 与 executor 事件共用 timeline、route 读取闭环均已验证。 |

## 后续增强建议

虽然当前 task 已可回写为完成，但后续仍建议继续补强以下高价值场景：

1. `waiting_input / decision_submitted` 的 replay 对齐验证
2. `failed / cancelled / completed` 终态在 mission 投影与 replay timeline 中的逐一对齐验证
3. `MissionProjectionView` 独立 `report / artifacts summary` 字段的统一建模，避免报告能力长期停留在兼容透出层
4. 更细粒度的 web-aigc runtime 节点事件直接进入 replay 的专项集成测试
