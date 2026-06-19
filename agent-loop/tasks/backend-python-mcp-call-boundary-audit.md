# 后端 NodeJS 到 Python 迁移：mcp.call boundary audit

## 执行状态

- 状态：待执行
- 目标：让 Grok 先做 `mcp.call` 的边界审计，不直接迁工具运行时
- 角色分工：Grok 负责产出审计文档；Codex 负责审查是否越界、是否夸大完成度

### 状态清单

- [ ] 已执行 AgentLoop
- [ ] 已生成 `docs/backend-python-mcp-call-boundary-audit.md`
- [ ] 文档区分 real runtime（真实运行时）、fallback（回退）和 simulated/stub（模拟/桩）
- [ ] 文档明确 `mcp.call` 是否可计入 Python native LLM 完成数
- [ ] gate 全绿
- [ ] Codex review（审查）已确认 Grok 没有改业务代码、没有扩大迁移范围

## 目标

审计 `mcp.call` 当前在 Node 和 Python 两侧的真实边界。这个任务只回答“它现在到底是什么”，不要求 Grok 直接实现 MCP 工具运行时。

## 当前判断

根据 `docs/backend-python-rag-inventory.md` 的结论，`mcp.call` 目前不应直接计入 Python native LLM 完成数。Grok 本轮要用代码证据确认或修正这个判断。

## 允许修改的文件

- `docs/backend-python-mcp-call-boundary-audit.md`
- `agent-loop/tasks/backend-python-mcp-call-boundary-audit.md`

## 禁止扩大范围

- 不改 `server/sliderule/orchestrate-plan.ts`。
- 不改 `server/sliderule/pool-json-llm.ts`。
- 不改 `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`。
- 不新增真实 MCP 调用实现。
- 不把 fallback / simulated / stub 说成真实 runtime。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `mcpBoundaryAuditGates`。

## 成功标准

- `docs/backend-python-mcp-call-boundary-audit.md` 存在。
- 文档列出 Node 路径、Python 路径、当前 provenance（来源）和风险。
- 文档明确哪些是已完成、哪些只是 fallback 或待迁。
- 文档给出下一步建议，但不直接宣布 `mcp.call` 已迁移完成。
- mojibake（乱码）检查通过。
