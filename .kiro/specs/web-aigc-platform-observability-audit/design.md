# 设计文档：Web-AIGC 平台可观测与审计

## 设计概述

当前主仓的 Web-AIGC 可观测与审计能力，不是一个独立的全新监控平台，而是把图运行时事件、任务投影、回放、审计查询和监控兼容接口拼接成“最小可用证据链”。

需要明确三层承接关系：

1. 事件目录与索引模型
   - `shared/web-aigc-observability.ts`
2. runtime 事件桥接
   - `server/core/web-aigc-runtime-observability.ts`
3. 平台消费面
   - `server/routes/replay.ts`
   - `server/routes/audit.ts`
   - `server/routes/aigc-monitoring.ts`
   - `server/routes/lineage.ts`

## 当前真实设计口径

### 已明确成立的链路

- runtime 事件 -> replay
- runtime 事件 -> audit
- replay snapshot -> audit 补记
- mission/workflow/session/graph -> monitoring 兼容读取
- relation index -> audit 关联查询

### 不应误写成已成立的链路

- runtime 事件 -> lineage 统一直写
- 单一 telemetry 总线承接全部 Web-AIGC 观测事件
- 所有节点都已接到同一条完整 observability pipeline

## 设计要点

### 1. 事件目录层

`shared/web-aigc-observability.ts` 负责定义：

- 事件 key
- stage 分类
- sinks
- required fields
- relation indexes

当前这层已经覆盖：

- `node.started`
- `node.completed`
- `node.failed`
- `node.waiting_input`
- `edge.transitioned`
- `edge.loop_iterated`
- `human.decision_submitted`
- `human.approved`
- `human.rejected`
- `instance.terminated`
- `instance.retry_requested`
- `instance.escalated`
- `external.vector_insert`

但设计解释必须区分：

- “目录已定义”
- “运行时已有桥接实现”

两者不是同一层完成度。

### 2. runtime 事件桥接层

`server/core/web-aigc-runtime-observability.ts` 当前负责把 `web_aigc_runtime_event` 镜像到：

- replay collector
- audit collector

当前桥接层已有明确证据的事件包括：

- `node.started`
- `node.completed`
- `node.waiting_input`
- `node.failed`
- `edge.transitioned`
- `instance.terminated`
- `instance.retry_requested`
- `instance.escalated`

当前没有直接证据表明该桥接层还会：

- 直写 lineage store
- 充当独立 telemetry backend

### 3. replay / audit 消费层

#### replay

`server/routes/replay.ts` 当前提供：

- 时间轴查询
- 快照创建
- 完整性校验
- 快照列表

并且：

- 快照创建后会补写审计记录

因此 replay 与 audit 已形成最小闭环。

#### audit

`server/routes/audit.ts` 与 `server/audit/audit-query.ts` 当前提供：

- Web-AIGC relation indexes
- related entries 查询
- 多索引联合匹配

这意味着当前“跨对象关联”能力最明确的落点，是审计查询层，而不是运行时统一写库层。

#### monitoring

`server/routes/aigc-monitoring.ts` 与 `server/core/aigc-monitoring-projection.ts` 当前是兼容层：

- 基于 `workflow + mission + graph + session` 进行派生
- 不是独立的主事实源

设计文档里不应把 monitoring 描述成“另有一套原生 Web-AIGC observability store”。

### 4. lineage 的准确口径

当前主仓已经存在：

- `server/routes/lineage.ts`
- `lineageId` relation index
- 审计查询中的 `lineageId` 匹配能力
- `external.vector_insert` 这类事件在目录层声明了 `lineage` sink

但当前仍应保持谨慎：

- 这不等于 runtime bridge 已统一写入 lineage
- 这不等于所有高风险节点都已有完整 lineage 证据链

因此设计文档只能写成：

- lineage 模型与查询承接面已存在
- runtime 直写 lineage 仍属后续增强

## Cube 承接面

- `shared/web-aigc-observability.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/routes/replay.ts`
- `server/routes/audit.ts`
- `server/routes/aigc-monitoring.ts`
- `server/routes/lineage.ts`

## 设计约束

- 不把“目录已声明 sink”误写成“桥接层已打通该 sink”。
- 对外描述优先使用“最小可用闭环”口径，而不是“全链路统一完成”口径。
- 所有高风险能力的完成判断，都必须有实现或测试证据，而不是只看共享契约字段是否存在。
