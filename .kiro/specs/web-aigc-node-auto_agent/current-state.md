# 自动代理节点现状核对

## 结论

基于当前 main 工作区的 `auto-agent / a2a / skills / guest-agents` 实现，`web-aigc-node-auto_agent` 的 4 个任务里：

- 可以勾选 2 项
- 不能勾选 2 项

## 可勾选项

### 1. 定义代理选择与输入结构

可以勾选。

依据：

- `AutoAgentTargetKind` 已定义统一目标类型：`agent / guest_agent / skill / internal_api`
- `AutoAgentExecutionRequest` 已定义统一输入结构：`kind / targetId / input / context / workflowId / stage / version / delegateAgentId / maxSkills / metadata`
- 这些定义位于 `server/tool/api/auto-agent-adapter.ts`

这说明 `auto_agent` 节点最核心的“代理选择 + 输入载荷”已经有统一结构承接。

### 2. 对接 A2A 与 skills 能力

可以勾选。

依据：

- `POST /api/a2a/auto-agent` 已接入统一执行器，位于 `server/routes/a2a.ts`
- `POST /api/skills/:id/execute` 已接入统一执行器，位于 `server/routes/skills.ts`
- `POST /api/agents/guest/:id/execute` 已接入统一执行器，位于 `server/routes/guest-agents.ts`
- `server/tests/auto-agent-routes.test.ts` 已覆盖上述三类路由分发
- `server/tests/auto-agent-adapter.test.ts` 已覆盖 resident agent、skill、internal_api 三类执行路径

这说明节点设计里提到的 A2A、skills、guest agents 三条承接面已经真实打通。

## 不可勾选项

### 3. 记录代理调用审计事件

暂不能勾选。

依据：

- 当前看到的是 `SkillMonitor.recordMetrics(...)`，它更偏 metrics/monitor，不等同于 audit
- 在本次核对范围内，没有看到 `auto-agent` 调用被明确写入统一 audit 链路的证据
- 也没有看到对应的 auto-agent 审计测试

因此这一项目前最多算“部分观测”，不能保守视为“审计事件已落地”。

### 4. 增加失败回退与超时处理

暂不能勾选。

依据：

- 当前存在基础错误映射 `mapAutoAgentErrorToStatusCode(...)`
- skill 执行存在默认 delegate fallback：未指定代理时回退到 CEO
- 但没有看到明确的 timeout 处理、超时中断、超时重试或统一失败回退策略

因此只能认定“有基础错误处理”，不能认定“失败回退与超时处理”已经完成。

## 对 tasks.md 的建议回写

建议将以下任务标记为已完成：

- `定义代理选择与输入结构`
- `对接 A2A 与 skills 能力`

建议保留未完成：

- `记录代理调用审计事件`
- `增加失败回退与超时处理`
