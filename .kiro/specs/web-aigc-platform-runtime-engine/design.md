# 设计文档：Web-AIGC 平台运行时引擎

## 设计概述

Web-AIGC 运行时引擎当前的真实定位，是挂接在 Cube 主仓现有 `workflow / mission / monitoring / replay / audit` 体系之上的轻量图运行时内核，而不是另起一套独立执行平台。

当前主仓设计应按“两层结构”理解：

1. 图运行时内核
   - `server/core/workflow-runtime-engine.ts`
   - 负责 definition / instance / checkpoint / node run / edge transition / runtime control
2. 平台承接层
   - `server/routes/workflows.ts`
   - `server/routes/tasks.ts`
   - `server/core/web-aigc-runtime-observability.ts`
   - 负责外部调用、投影、回放、审计与兼容接口

## 当前真实承接面

- 运行时主内核：`server/core/workflow-runtime-engine.ts`
- 运行时入口：`server/routes/workflows.ts`
- 人工任务与会话承接：`server/routes/tasks.ts`
- 运行时事件桥接：`server/core/web-aigc-runtime-observability.ts`

需要特别说明：

- `server/core/workflow-engine.ts` 仍是主仓传统工作流底座之一，但 Web-AIGC 这一条 graph runtime 的直接实现主体已经是 `workflow-runtime-engine.ts`。
- 当前设计不应再把 Web-AIGC runtime 描述成“挂在 workflow-engine.ts 上的薄壳”，而应明确它已有独立的运行时类与路由控制面。

## 运行流程

### 1. 解析与初始化

1. 构建或读取 graph definition
2. 初始化 graph instance
3. 设定入口节点
4. 把初始状态持久化到 `workflow.results.webAigcRuntime`

### 2. 节点执行

1. 根据 `currentNodeId` 找到节点定义
2. 通过适配器执行 `execute(context)` 或 `resume(context)`
3. 接收标准结果：
   - `advance`
   - `wait`
   - `complete`
   - `error`

### 3. 状态推进

1. 更新 node run 状态
2. 更新 instance 状态
3. 必要时生成 checkpoint
4. 必要时记录 edge transition
5. 必要时推进到下一个节点

### 4. 运行时控制

当前主仓已有最小显式控制面：

- `terminate()`
- `retry()`
- `escalate()`

当前主仓也已有最小节点级自动策略：

- 自动重试
- 重试耗尽后自动升级到人工 review

但以下部分仍未形成完整设计闭环：

- 平台级统一重试队列
- 全局指数退避/预算中心
- 跨节点统一治理编排

### 5. 事件桥接

引擎会统一发射运行时事件，例如：

- `node.started`
- `node.completed`
- `node.waiting_input`
- `node.failed`
- `edge.transitioned`
- `instance.terminated`
- `instance.retry_requested`
- `instance.escalated`

这些事件当前的真实落点是：

- replay
- audit
- 平台公共事件面

而不是：

- 已完整直写 lineage
- 已有独立 telemetry backend

## 当前内置节点能力

### `selection`

当前已作为内置分支节点落地：

- 首次执行进入 `WAITING_INPUT`
- 恢复时按 `optionId / optionIds / selectedOptionIds` 决定分支
- 条件边按 `edge.label` 命中

### `confirm_judge`

当前已作为内置人工决策节点落地：

- 首次执行进入等待态
- 恢复时按 `branchKey` 或选项结果命中 `approved / rejected` 条件边

### `end`

当前已作为内置终态收敛节点落地：

- 收敛 `status / summary / artifacts / result / finalVariables`
- 生成结构化终态输出

## 当前未闭环的设计边界

### 1. 循环边

领域模型已有 `loop` 边类型，但当前主仓仍缺：

- 明确的循环推进策略
- `edge.loop_iterated` 运行时发射证据
- 对应测试闭环

因此设计上应保留“循环语义预留”，但不能写成“循环执行已完成”。

### 2. 统一治理策略中心

当前只有节点级自动策略，不是平台级统一策略中心。

因此设计文档中不应写成：

- 已有统一重试治理中台
- 已有全局失败升级编排

### 3. lineage 直写

当前 `shared/web-aigc-observability.ts` 已定义 lineage sink 与 relation index，但这不等于 runtime 事件已经由运行时桥接层直接写入 lineage。

设计上应明确区分：

- 已有：lineage 索引模型与查询维度
- 未确认完成：runtime -> lineage 直写链路

## 设计约束

- 优先保证运行时可恢复、可回放、可审计。
- 优先保持与主仓 `workflow / mission / monitoring / replay / audit` 体系对齐。
- 不把“领域语义已定义”误写成“运行时能力已闭环”。
