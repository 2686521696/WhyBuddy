# 后端 NodeJS 到 Python 迁移：mcp.call real runtime

## 执行状态
- 状态：待执行
- 目标：把 `mcp.call` 从 fake runtime smoke（假运行时冒烟）推进到可插拔 real runtime（真实运行时）边界。
- 角色分工：worker 负责 Python runtime adapter（运行时适配器）和测试；reviewer 确认没有真实外部 MCP 调用和权限绕过。

### 状态清单
- [ ] Python 有 `mcp.call` runtime adapter 接口。
- [ ] fake adapter（假适配器）只用于测试，生产入口可替换。
- [ ] 权限/失败/provenance 形状清楚。
- [ ] gate 全绿。
- [ ] Codex review 确认没有把 fake adapter 宣传成真实 MCP。

## 目标

上一批只锁住了 `mcp.call` runtime smoke。现在要补真正的 adapter 边界：调用参数、结果、错误、权限拒绝和来源标记都要有稳定形状。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/capability_maps.py`
- `tws-ai-slide-rule-python/services/slide_rule_executor.py`
- `tws-ai-slide-rule-python/services/mcp_runtime.py`
- `tws-ai-slide-rule-python/tests/test_mcp_call_real_runtime.py`
- `tws-ai-slide-rule-python/tests/test_mcp_call_runtime_smoke.py`
- `agent-loop/tasks/backend-python-mcp-call-real-runtime.md`

## 禁止扩大范围
- 不连接真实外部 MCP server。
- 不绕过 permission（权限）检查。
- 不改 Node MCP 实现。
- 不提交密钥、token 或运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `mcpCallRealRuntimeGates`。

## 成功标准

- Python 测试能注入 fake MCP adapter 并验证 success / denied / error 三条路径。
- runtime response 明确区分 `runtime="python"`、`provenance` 和错误类型。
- 旧 contract/smoke 测试继续通过。
- 所有 gate 通过。
