# 后端 NodeJS 到 Python 迁移：Blueprint stage edit proxy contract

## 执行状态
- 状态：待执行
- 目标：把 Blueprint stage edit（阶段编辑）的输入校验和 patch 结果形状投影到 Python contract。
- 角色分工：worker 负责 contract；reviewer 确认不破坏 Node 的 staleness/invalidation 语义。

### 状态清单
- [x] Python 侧有 stage edit validate/preview contract。
- [x] Node 侧测试覆盖 patch accepted/rejected/conflict。
- [x] staleness/invalidation 字段不丢。
- [x] gate 全绿。
- [x] Codex review 确认没有直接改主状态机。

## 目标

`server/routes/blueprint/stage-edit` 是 Node 后端里较重的 Blueprint 主流程边界。此任务只迁最小 validate/preview contract，避免一口气改主状态机。

## 允许修改的文件
- `agent-loop/tasks/backend-python-blueprint-stage-edit-proxy-contract.md`
- `tws-ai-slide-rule-python/services/blueprint_stage_edit.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_stage_edit_proxy_contract.py`
- `server/routes/blueprint/stage-edit/**/*.ts`
- `server/routes/__tests__/blueprint.stage-edit-python-proxy.test.ts`

## 禁止扩大范围
- 不改 UI。
- 不改真实 stage persistence。
- 不把 preview 当 apply。
- 不跳过 conflict 检查。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintStageEditProxyGates`。

## 成功标准

- Python contract 能表达 accepted、rejected、conflict、noop。
- Node 测试确认 staleness/invalidation 字段保留。
- preview 不产生真实副作用。
- gate 全绿。
