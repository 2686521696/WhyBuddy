# 后端 NodeJS 到 Python 迁移：Blueprint main state runtime boundary

## 执行状态
- 状态：待执行
- 目标：明确 Blueprint 主状态机的 Python runtime 边界，把可迁的状态读写/投影契约先固定，不直接重写完整 Autopilot。
- 角色分工：worker 负责 Python contract/runtime boundary 和 Node contract 测试；reviewer 确认没有把完整主状态机一次性迁走。

### 状态清单
- [x] Python 侧定义 main state 输入输出 contract。
- [x] Node 侧测试 Python mode 下的状态投影/错误恢复边界。
- [x] legacy Node owner 与 Python owner 分界写清楚。
- [x] gate 全绿。
- [x] Codex review 确认没有扩大到完整 Blueprint 编排。

## 目标

Blueprint/Autopilot 主状态机仍是整体迁移的大分母。这个任务只做 runtime boundary，不直接迁复杂编排，避免把状态机、job、stage edit、artifact memory 混成一团。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_blueprint_main_state_contract.py`
- `server/routes/__tests__/blueprint.main-state-python-contract.test.ts`
- `shared/blueprint/__tests__/index-barrel.test.ts`
- `shared/blueprint/*`
- `agent-loop/tasks/backend-python-blueprint-main-state-runtime-boundary.md`

## 禁止扩大范围
- 不重写完整 Blueprint/Autopilot 主状态机。
- 不迁 stage execution 长链路。
- 不改现有 job 持久化策略。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintMainStateContractGates`。

## 成功标准

- Python contract 明确 main state 输入输出和错误 envelope。
- Node contract 明确哪些状态仍由 Node owner 承担，哪些可以投影到 Python。
- 测试覆盖状态投影和错误恢复边界。
- 所有 gate 通过。
