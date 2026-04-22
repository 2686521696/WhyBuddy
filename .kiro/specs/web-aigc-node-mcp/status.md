# web-aigc-node-mcp 现状说明

## 结论

当前仓库已经具备 `MCP 绑定建模 + A2A / skills 承接层 + permission/governance/audit 基础设施`，并且本轮已经补上一个最小可复用的 `MCP 显式调用资源契约`，因此 `tasks.md` 里的“定义 MCP 调用结构”“接入 A2A / skills 能力”两项都可以勾选。

这次落地的是权限/适配层可直接消费的最小 contract，而不是完整的 MCP runtime 执行器。也就是说，仓库现在已经能稳定表达“按 MCP 服务 + 工具名 + 参数”构造调用资源、解析调用资源、并在权限检查中做端点/方法/参数校验，但还没有形成真正的 `MCP 节点执行器 -> 审计/超时 -> 失败补偿` 完整闭环，所以后两项仍不建议勾选。

## 分任务判断

### 1. 定义 MCP 调用结构

结论：可以勾选。

已有证据：

- `shared/organization-schema.ts`
  - 已定义 `WorkflowMcpBinding`，包含 `id / name / server / description / connection / tools`，可表达 MCP 连接与工具清单。
- `server/core/dynamic-organization.ts`
  - 已有 `MCP_LIBRARY`、`mcpIds`、`resolveMcp(...)`，可以把组织节点模板投影成具体 `mcp` 绑定。
- `shared/skill-contracts.ts`
  - 已有 `requiredMcp`、`mcpBindings` 等字段，说明 skill 侧已经把 MCP 当成可解析依赖。
- `shared/skill/contracts.ts`
  - 旧的 skill/tool 契约里已有 `SkillToolBinding.parameters` 与 `mcpServer` 字段，说明仓库里曾经存在更细粒度的工具调用模型。
- `server/permission/checkers/mcp-checker.ts`
  - 本轮新增 `buildMcpResource(...)` / `parseMcpResource(...)`，把 MCP 调用资源规范成：
    - `mcp://server/tool?key=value`
  - 同时兼容旧格式：
    - `server:tool`
    - `tool`
  - `McpChecker` 已可基于该资源结构校验：
    - `endpoints`
    - `methods`
    - `parameterConstraints`
- `server/tests/skill-registry-version-mcp.property.test.ts`
  - 本轮新增 property test，验证 canonical MCP resource 的 build/parse 可逆，以及参数约束校验可稳定生效。

说明：

- 当前可勾选的依据，不是因为已经出现完整的 `McpInvokeRequest / McpInvokeResult` shared type，而是因为主仓已经存在一个可落到权限/适配层的显式调用资源约定：
  - 可构造
  - 可解析
  - 可校验
  - 有测试锁定

仍然存在的缺口：

- 还没有真正的 MCP runtime 执行器去消费这个 contract 并产出统一执行结果。
- 也还没有把这个资源 contract 挂接到 web-aigc 节点执行入口。

### 2. 接入 A2A / skills 能力

结论：可以勾选。

直接证据：

- `server/routes/a2a.ts`
  - 已提供 `/invoke`、`/stream`、`/cancel`、`/agents`、`/sessions`、`/auto-agent` 路由。
- `server/routes/skills.ts`
  - 已提供 skill 注册、查询、版本、启停、指标、执行路由。
- `server/core/skill-registry.ts`
  - 已实现 `resolveMcpForSkill(...)`，把 `requiredMcp` 解析成 `WorkflowMcpBinding[]`。
- `server/tool/api/auto-agent-adapter.ts`
  - skill 执行前会补齐 `mcpBindings`，并把结果带回 `metadata.mcpBindings`。
- `server/core/dynamic-organization.ts`
  - 组织模板内已经存在 `mcp_integration_specialist`、`mcpIds`、`resolveMcp(...)`，说明动态组织层已把 MCP / skills / 承接层串起来。
- `server/tests/auto-agent-adapter.test.ts`
  - 已验证 skill 执行结果会带回 `mcpBindings`。
- `server/tests/skill-registry-version-mcp.property.test.ts`
  - 已验证 `requiredMcp -> resolveMcpForSkill` 的解析正确性与优雅降级。

说明：

- 这一项成立的依据是“spec 设计里约定的承接层已经存在并且互相打通”，不是说 `mcp` 节点本身已经完整实现。

### 3. 增加审计与超时控制

结论：暂不勾选，属于“部分具备”。

已有证据：

- `shared/permission/contracts.ts`
  - 已把 `mcp_tool` 纳入资源类型，并定义了 `GovernanceDecision`、`PermissionAuditEntry`、`PermissionEscalation`。
- `server/permission/governance-policy.ts`
  - 已明确规定 `mcp_tool + call` 返回 `approval_required`，属于高风险治理。
- `server/permission/check-engine.test.ts`
  - 已验证高风险 MCP 调用会被 governance 拦截，并会写入 platform audit。
- `server/tests/permission-governance-audit-routes.test.ts`
  - 已验证审计查询路由能读到治理相关记录。
- `server/core/a2a-client.ts`
  - 已有 `defaultTimeoutMs`、`AbortController`、`terminateTimedOutSessions()`。
- `server/tests/a2a-protocol.test.ts`
  - 已验证 A2A session timeout 处理。

缺口：

- 没有看到“MCP 节点执行器 -> 权限/审计/超时控制”这一条直接 wiring。
- 当前 timeout 证据主要落在 A2A session，而不是 MCP 节点调用路径本身。
- 虽然本轮已经有显式资源 contract，但因为还缺真正的 MCP 调用执行链，所以不能把这项算作完整完成。

### 4. 验证失败回退与人工升级

结论：暂不勾选，属于“部分具备”。

已有证据：

- `server/core/skill-registry.ts`
  - 对缺失 MCP 的 skill 依赖会 `warn + skip`，具备基础降级语义。
- `server/tests/skill-registry-version-mcp.property.test.ts`
  - 已验证“部分 MCP 无效时跳过、全部无效时返回空数组、不抛异常”的优雅降级。
- `server/permission/dynamic-manager.ts`
  - 已有 `escalatePermission(...)`。
- `server/routes/permissions.ts`
  - 已暴露 `/api/permissions/escalate`。
- `server/permission/routes.test.ts`
  - 已验证 escalation 路由可创建升级请求。

缺口：

- 没有看到 “MCP 调用失败 -> fallback -> 人工升级/审批” 的端到端验证。
- 现有升级能力更像通用 permission governance，不是 MCP 节点失败后的专用补偿流程。
- 也没有看到与 `web-aigc-node-mcp` spec 直接对应的生产代码或测试闭环。

## 建议的后续补齐顺序

1. 先让 `mcp` 节点执行入口消费当前的 canonical resource contract：
   - `mcp://server/tool?key=value`
2. 再补一个最小执行器：
   - 从 `mcp` 节点输入解析出 `server/tool/parameters`，走现有 A2A 或 internal adapter 执行。
3. 把现有 governance/audit/timeout 直接挂到这条执行链上：
   - 至少补一条 `mcp_tool` 调用前权限检查和调用超时。
4. 最后补端到端失败场景测试：
   - MCP 不可用
   - 调用超时
   - governance 拦截
   - 回退到人工升级
