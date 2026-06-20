# 后端 NodeJS 到 Python 迁移：Blueprint agent crew proxy contract

## 执行状态
- 状态：待执行
- 目标：为 Blueprint agent crew（代理团队）建立 Python proxy contract。
- 角色分工：worker 负责契约和测试；reviewer 确认不迁完整 Agent Crew runtime。

### 状态清单
- [x] Python 有 agent crew contract。
- [x] Node service 测试能映射 plan/assign/result/error。
- [x] budget（预算）和 role（角色）字段不丢。
- [x] gate 全绿。
- [x] Codex review 确认不改真实 agent 调度。

## 目标

Blueprint/Autopilot 大块仍在 Node。agent crew 是重要边界，先建立 Python proxy contract。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_blueprint_agent_crew_proxy_contract.py`
- `server/routes/blueprint/agent-crew/service.ts`
- `server/routes/blueprint/agent-crew/service.test.ts`
- `server/routes/__tests__/blueprint.agent-crew-python-proxy.test.ts`
- `shared/blueprint/agent-crew/types.ts`
- `agent-loop/tasks/backend-python-blueprint-agent-crew-proxy-contract.md`

## 禁止扩大范围
- 不迁完整 Agent Crew runtime。
- 不发真实 LLM 请求。
- 不改 UI。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintAgentCrewProxyContractGates`。

## 成功标准

- Python 测试覆盖 plan/assign/result/error contract。
- Node/shared 测试验证 contract 与 agent crew service 兼容。
- role/budget/error 字段不丢失。
- 所有 gate 通过。
