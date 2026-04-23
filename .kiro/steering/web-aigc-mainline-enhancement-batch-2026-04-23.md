# Web-AIGC 主线增强批次收口纪要（2026-04-23）

## 范围

本文不是新增 `specs` 的补写说明，也不是对 58 个 `web-aigc` 节点文档重新拆分。

本轮聚焦的是主线增强缺口收口，限定在以下三条能力线：

- `dialogue`
- `mcp`
- `variable_assignment`

目标是用主仓当前真实代码、已有执行入口、运行时行为和测试证据，给出一份中文收口纪要，明确：

- 这三条线当前已经补到了什么程度
- 什么条件下可以判定“本轮主线增强已完成”
- 还有哪些风险没有被这轮彻底消掉
- 下一步建议如何验证，而不是继续扩写 specs

## 结论摘要

本轮三条线的共同特征很明确：

1. `spec` 侧最小闭环都已经具备，当前瓶颈不在“有没有文档定义”，而在“主线增强是否已经把真实入口、运行时链路、治理边界和验证证据收紧”。
2. `dialogue` 的重点不再是节点输入输出，而是主线会话闭环、检索增强和监控可消费元数据是否稳定。
3. `mcp` 的重点不再是单点 adapter 能不能调用工具，而是主线入口、权限、超时、审计、审批与内部 invoker 的最小治理闭环是否成立。
4. `variable_assignment` 的重点不再是静态图投影能不能识别该节点，而是主线运行时赋值、作用域快照、事件发射和下游条件联动是否可验证。

换句话说，这一批要收口的是“主线增强”，不是“文档补齐”。

## 本轮新增的两条主线增强

相较于上一版纪要，本轮需要明确补记两条已经落进主线的新增增强：

1. `dialogue runtime injected documentSearch`
   - 这不是单纯的聊天节点增强开关，而是运行时内建 `dialogue` adapter 已经支持从 runtime 注入 `documentSearch` 执行器
   - 它把 `dialogue` 的检索增强从“路由层可用”推进到“workflow runtime 主线内可直接执行”

2. `mcp runtime global registration`
   - 这不是单纯的 `POST /api/mcp/nodes/execute` 路由闭环，而是 `mcp` 节点已经进入共享 `web-aigc` runtime extra adapters 注册表
   - 它把 `mcp` 从“主应用路由可调用”推进到“主线运行时全局注册后可直接执行”

## 一、Dialogue 主线增强线

### 当前落点

结合当前主仓已有事实，`dialogue` 这一线已经具备以下基础：

- `POST /api/chat/nodes/execute` 已作为主线节点执行入口存在。
- `dialogue` 与 `llm` 共享统一 chat node adapter，但对 `dialogue` 保留了工作流会话、消息持久化与 session exchange 的增强路径。
- `dialogue` 节点已经可以主动触发 `document_search` 增强链路，并把结果投影到上下文、引用和工具调用元数据中。
- 监控与实例查看侧已经能消费 `thinking / citations / toolCalls` 等增强元数据。
- `workflow-runtime-engine` 已支持 runtime injected `documentSearch`，内建 `dialogue` adapter 可直接从 runtime 取回检索执行器并在运行时内发起文档检索。

### 本轮新增增强

- 已新增 `dialogue runtime injected documentSearch`
  - 落点：
    - `server/core/workflow-runtime-engine.ts`
    - `server/index.ts`
  - 直接效果：
    - `dialogue` 不再只依赖路由层外部传入的检索能力
    - 主线 workflow runtime 已可直接执行带检索增强的 `dialogue` 节点
  - 测试证据：
    - `server/tests/workflow-runtime-engine.test.ts`
    - 用例：`lets the runtime built-in dialogue adapter use an injected documentSearch executor`

### 本轮完成标准

本轮 `dialogue` 主线增强建议按以下标准判定完成：

1. 主线执行入口稳定。
   `dialogue` 节点必须继续通过主仓统一 chat 路由与 adapter 执行，而不是依赖独立分支里的临时入口。

2. 会话闭环稳定。
   至少要能确认工作流关联消息、assistant 回包和 session exchange 在主仓内已形成可追踪闭环。

3. 检索增强可消费。
   `document_search` 这类增强能力要能够进入 `dialogue` 输出，并被监控或实例查看侧识别，而不是停留在局部计算结果。

4. 元数据可观测。
   `citations / toolCalls / thinking` 等增强字段要有稳定输出，不应只在测试假数据里存在。

### 主要风险

- `dialogue` 仍然命中主仓高频文件与高频路由，后续如果继续扩线到 `knowledge_qa / web_qa / llm` 的统一治理，冲突半径会继续放大。
- 当前“对话增强已成立”和“问答体系已整体统一”不能混为一谈；后者仍需额外主线对账。
- 监控侧虽然已经能消费增强元数据，但不代表后续所有增强字段都已经形成稳定 schema。

### 验证建议

- 优先做主线入口验证：
  关注 `chat` 路由与 `chat-node-adapter` 的真实执行行为是否仍覆盖 `dialogue`。

- 优先做会话链路验证：
  检查 workflow message、assistant message、session exchange 是否都能在一次真实节点执行中落地。

- 优先做增强输出验证：
  至少验证一条带 `document_search` 的 `dialogue` 路径，确认 `citations / toolCalls / thinking` 都能被输出和消费。

## 二、MCP 主线增强线

### 当前落点

结合当前主仓已有事实，`mcp` 这一线已经不只是“节点 adapter 可调用工具”，而是已经形成了最小主线治理闭环：

- `POST /api/mcp/nodes/execute` 已接入主仓。
- `mcp` 节点输入已经能归一到统一调用结构。
- `skills / auto-agent` 已能识别并携带 `mcpBindings`。
- `McpToolAdapter` 已具备权限检查、governance、审批要求、超时控制、审计写入和 fallback 处理。
- `InternalMcpToolInvoker` 已把主仓内部几类 MCP 工具接成最小真实 invoker。
- `mcp` 已进入共享 `web-aigc` runtime extra adapters 注册表，能够直接通过主线运行时执行。

### 本轮新增增强

- 已新增 `mcp runtime global registration`
  - 落点：
    - `server/core/web-aigc-runtime-extra-adapters.ts`
    - `server/index.ts`
  - 直接效果：
    - `mcp` 不再只停留在独立路由入口
    - 通过 `registerWebAigcRuntimeExtraAdapters({ executeMcp })`，`mcp` 节点已经可以挂入共享全局 adapter registry
  - 测试证据：
    - `server/tests/workflow-runtime-engine.test.ts`
    - 用例：`can register mcp runtime execution through the shared global adapter registry`

### 本轮完成标准

本轮 `mcp` 主线增强建议按以下标准判定完成：

1. 主线入口成立。
   `mcp` 节点必须能从主仓正式路由进入，不再停留在独立 demo 或局部 adapter 试跑状态。

2. 调用契约统一。
   `serverId / toolName / arguments / metadata / timeoutMs / requireApproval` 等最小调用字段要在主线里形成统一结构。

3. 治理最小闭环成立。
   至少要覆盖权限校验、审批要求、超时控制、失败回退和审计落点。

4. 内部工具可真实调用。
   不能只有 mock 结构，至少要有一批主仓内部 MCP 工具通过真实 invoker 跑通。

### 主要风险

- `mcp` 当前更像“最小主线治理闭环已成立”，还不能直接上升为“平台级 MCP 统一编排已经完成”。
- 高风险工具的审计字段虽然已有方向，但跨更多工具类型后的字段统一仍可能继续演化。
- `skills / auto-agent / mcp / internal_api / passthrough_api` 之间后续若做统一对账，仍然会命中更大范围的主仓热区。

### 验证建议

- 优先做入口验证：
  确认 `mcp` 路由、节点 adapter、tool adapter 三段链路完整可达。

- 优先做治理验证：
  至少覆盖允许、拒绝、审批要求、超时、fallback 五类路径。

- 优先做真实 invoker 验证：
  选择一到两个主仓内部工具，确认不是只跑 mock，而是确实走到内部 tool invoker。

## 三、Variable Assignment 主线增强线

### 当前落点

结合当前主仓已有事实，`variable_assignment` 这一线已经同时落在控制流层和运行时层：

- 控制流快照与图投影已经能识别 `variable_assignment`，并输出赋值摘要与变更信息。
- `workflow-runtime-engine` 已内置 `variable_assignment` 运行时 adapter。
- 运行时已经支持 `target / scope / source / expression / value` 的最小赋值配置。
- 赋值结果可以写回实例变量，并补充作用域快照与变更记录。
- 下游 `condition` 节点已经能直接消费赋值结果。
- 运行时会发出 `variable.assigned` 事件。

### 本轮完成标准

本轮 `variable_assignment` 主线增强建议按以下标准判定完成：

1. 运行时赋值成立。
   不是只在控制流投影中“看得见”，而是主线运行时确实能执行赋值并写回变量。

2. 作用域语义成立。
   至少 `global / local / temp` 三类最小作用域要在主线中形成稳定语义和快照表达。

3. 变更记录成立。
   赋值后要能留下 `variableChanges` 或等价运行时记录，而不是只得到最终值。

4. 下游联动成立。
   `variable_assignment -> condition` 这一类最小控制链必须可验证。

### 主要风险

- 当前变量平面仍以 `instance.variables` 为中心，`local / temp` 更偏向附加快照语义，而不是完全隔离的独立变量容器。
- `variable.assigned` 事件虽然已发出，但其 `replay / audit` 镜像和更细粒度的变量治理证据仍未完全统一。
- 更复杂的表达式语言、批量赋值、嵌套路径写回等增强能力不在本轮最小主线收口范围内。

### 验证建议

- 优先做运行时验证：
  直接验证主线 runtime 中一次赋值节点执行后的变量写回结果。

- 优先做联动验证：
  验证赋值结果是否真的驱动下游 `condition` 分支，而不是只停留在快照层。

- 优先做事件验证：
  确认 `variable.assigned` 至少已经在 runtime 事件层被发出，并留待后续 observability 线继续收口。

## 四、本轮收口口径

本轮三条增强线都不建议再按“是否需要补更多 specs”来推动，而应统一按下面的口径收口：

1. `dialogue`
   已进入“主线会话与增强消费收口”阶段，不再是节点定义阶段；本轮新增重点是 runtime injected `documentSearch` 已成立。

2. `mcp`
   已进入“主线治理闭环收口”阶段，不再是单点适配器样例阶段；本轮新增重点是 runtime global registration 已成立。

3. `variable_assignment`
   已进入“主线运行时与事件联动收口”阶段，不再是静态控制流识别阶段。

## 五、建议的后续动作

本轮之后，如果继续推进，不建议先补更多 specs，建议按以下顺序做主线增强：

1. 先把 `dialogue` 的主线监控消费与会话闭环证据继续收紧。
2. 再把 `mcp` 的高风险审计字段和多入口对账继续统一。
3. 最后把 `variable_assignment` 的变量事件镜像并入更完整的 runtime observability / audit 收口。

## 结论

截至 2026-04-23，这三条线更合适的表述不是“spec 已补齐”，而是：

- `dialogue`：主线执行入口、会话闭环与增强消费能力已经成立，并且 runtime injected `documentSearch` 已补进主线，后续重点是稳定增强 schema 和跨问答链路统一。
- `mcp`：主线入口、治理、审批、超时、审计和内部 invoker 的最小闭环已经成立，并且 runtime global registration 已补进共享注册表，后续重点是扩展统一治理口径。
- `variable_assignment`：主线运行时赋值、作用域快照、变更记录和条件联动已经成立，后续重点是把变量级事件与审计观测进一步收紧。

因此，本轮建议正式按“主线增强批次收口”归档，而不是继续把工作描述成“补 specs”。
