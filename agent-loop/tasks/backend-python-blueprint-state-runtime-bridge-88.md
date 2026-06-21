# 后端 NodeJS 到 Python 迁移：Blueprint state runtime bridge 88

## 执行状态
- 状态：待执行
- 目标：把 Blueprint main state 从 contract-only 推进到一个最小 Python runtime bridge，不迁完整 `/api/blueprint` 大路由。
- 角色分工：worker 负责 selected state read/project/update boundary 和测试；reviewer 确认 event bus/job store/ledger/prompt package 没被纳入。

### 状态清单
- [x] Python runtime 支持最小 state projection/read/update envelope。
- [x] Node bridge 测试覆盖 Python mode、fallback 和错误语义。
- [x] Node 仍拥有 route shell、event bus、job store。
- [x] gate 全绿。
- [x] Codex review 确认没有把 Blueprint 子切片写成完整迁移。

## 目标

Blueprint 是大分母，但不能一次迁完整路由。本任务只选 main state 的小边界：读状态、投影状态、返回可审计错误，不碰 job/event/ledger/preview/prompt package。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/blueprint_state_runtime.py`
- `tws-ai-slide-rule-python/models/blueprint_state.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_state_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_main_state_contract.py`
- `server/routes/blueprint/main-state-python-runtime.ts`
- `server/routes/__tests__/blueprint.state-python-runtime.test.ts`
- `server/routes/__tests__/blueprint.main-state-python-contract.test.ts`
- `agent-loop/tasks/backend-python-blueprint-state-runtime-bridge-88.md`

## 禁止扩大范围
- 不迁完整 `/api/blueprint`。
- 不改 event bus、job store、ledger、preview、prompt package、traceability。
- 不改前端 UI。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintStateRuntimeBridge88Gates`。

## 成功标准

- Python 测试覆盖 state read/projection/error。
- Node 测试覆盖 Python runtime bridge、fallback 和错误 envelope。
- 文档或 task 说明只把它计为 bounded runtime bridge。
- gate 全绿。
