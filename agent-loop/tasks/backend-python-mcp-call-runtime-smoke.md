# 后端 NodeJS 到 Python 迁移：mcp.call runtime smoke

## 执行状态

- 状态：待执行
- 目标：在 mcp.call contract（契约）之后补一个 fake adapter runtime smoke（假适配器运行时冒烟）
- 角色分工：Grok 负责补最小 fake adapter 和测试；Codex 负责审查是否误称为真实 MCP server

### 状态清单

- [x] 已执行 AgentLoop
- [x] Python test 覆盖 fake MCP adapter 成功调用
- [x] Python test 覆盖 adapter 不可用和 tool 不存在
- [x] Node test 确认 runtime smoke 不会伪装成生产 MCP
- [x] gate 全绿
- [x] Codex review（审查）确认没有接生产 MCP server

## 目标

上一片已经锁住 `mcp.call` 当前不是 real MCP runtime（真实 MCP 运行时）。这一片只补一个可注入 fake adapter 的 runtime smoke：证明 Python 侧可以按稳定接口调用工具适配器，同时仍然清楚标记这是 fake/test runtime。

这个任务为后续真正桥接 Node `McpToolAdapter` 或 Python MCP client 做准备。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/slide_rule_executor.py`
- `tws-ai-slide-rule-python/services/capability_maps.py`
- `tws-ai-slide-rule-python/tests/test_mcp_call_runtime_smoke.py`
- `tws-ai-slide-rule-python/tests/test_mcp_call_contract.py`
- `server/routes/__tests__/sliderule.mcp-call-contract.test.ts`
- `agent-loop/tasks/backend-python-mcp-call-runtime-smoke.md`

## 禁止扩大范围

- 不接真实 MCP server。
- 不改权限系统。
- 不改 `server/tool/api/mcp-tool-adapter.ts` 的生产行为，除非测试暴露明确契约 bug。
- 不把 fake adapter provenance 写成真实 `mcp:*` production runtime。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `mcpCallRuntimeSmokeGates`。

## 成功标准

- Python runtime smoke 能通过 fake adapter 返回明确的 tool result。
- adapter unavailable 和 unknown tool 有稳定 degraded/error shape。
- Node contract test 确认 fallback、fake runtime、real MCP provenance 不混淆。
- 所有 gate 通过。
