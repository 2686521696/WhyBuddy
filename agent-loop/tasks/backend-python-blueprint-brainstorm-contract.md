# 后端 NodeJS 到 Python 迁移：Blueprint brainstorm contract

## 执行状态
- 状态：待执行
- 目标：为 Blueprint brainstorm（头脑风暴）建立 Python contract，先锁推理图输入输出。
- 角色分工：worker 负责 contract 和测试；reviewer 确认不迁完整 brainstorm runtime。

### 状态清单
- [ ] Python 有 brainstorm contract。
- [ ] Node brainstorm 测试能映射 graph/input/output/error。
- [ ] reasoning graph（推理图）字段不丢。
- [ ] gate 全绿。
- [ ] Codex review 确认不改主状态机。

## 目标

Blueprint brainstorm 是主状态机前段大块。这个任务只建立 Python contract，让后续可逐步迁移。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_blueprint_brainstorm_contract.py`
- `server/routes/blueprint/brainstorm/decision-gate.ts`
- `server/routes/blueprint/brainstorm/brainstorm-event-guard.property.test.ts`
- `server/routes/__tests__/blueprint.brainstorm-python-contract.test.ts`
- `shared/blueprint/brainstorm-contracts.ts`
- `shared/blueprint/brainstorm-reasoning-graph.ts`
- `agent-loop/tasks/backend-python-blueprint-brainstorm-contract.md`

## 禁止扩大范围
- 不迁完整 brainstorm runtime。
- 不改 UI。
- 不发真实 LLM 请求。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintBrainstormContractGates`。

## 成功标准

- Python 测试覆盖 brainstorm input/output/error contract。
- Node/shared 测试验证 reasoning graph 字段兼容。
- partial/error 不能伪装完整成功。
- 所有 gate 通过。
