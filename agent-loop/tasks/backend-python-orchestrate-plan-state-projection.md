# 后端 NodeJS 到 Python 迁移：orchestrate.plan state projection

## 执行状态
- 状态：待执行
- 目标：为 `orchestrate.plan` 补 Python state projection（状态投影）最小语义。
- 角色分工：worker 负责 Python 投影结构和测试；reviewer 确认不篡改 Node 主状态机边界。

### 状态清单
- [x] Python 输出包含稳定 plan state projection。
- [x] Node contract 测试能读懂 projection。
- [x] 错误和 partial plan（部分计划）有明确形状。
- [x] gate 全绿。
- [x] Codex review 确认没有把 projection 当成完整主状态机迁移。

## 目标

`orchestrate.plan` 迁移不能只返回文本或一次性 JSON。它需要能表达计划阶段、步骤、风险和恢复点的 state projection，供 Node 继续承载主状态机。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/slide_rule_orchestrator.py`
- `tws-ai-slide-rule-python/models/v5_state.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_state_projection.py`
- `server/routes/__tests__/sliderule.orchestrate-plan-state-projection.test.ts`
- `shared/blueprint/sliderule-plan-validation.ts`
- `agent-loop/tasks/backend-python-orchestrate-plan-state-projection.md`

## 禁止扩大范围
- 不迁 Blueprint/Autopilot 主状态机。
- 不改 UI。
- 不删除 Node 既有 plan validation。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `orchestratePlanStateProjectionGates`。

## 成功标准

- Python 测试验证 projection 包含阶段、步骤、风险、恢复点。
- Node/shared 测试验证 projection 与现有 plan validation 兼容。
- partial/error projection 不伪装成完整成功。
- 所有 gate 通过。
