# 后端 NodeJS 到 Python 迁移：orchestrate.plan runtime route

## 执行状态
- 状态：待执行
- 目标：把 `orchestrate.plan` 从 contract/golden smoke 推进到 Node -> Python runtime route（运行时路由）最小闭环。
- 角色分工：worker 负责 route 接线和测试；reviewer 确认没有吞掉 Node 侧错误恢复语义。

### 状态清单
- [x] Node Python mode 下 `orchestrate.plan` 能调用 Python endpoint。
- [x] Python route 返回 contract 兼容结构。
- [x] 错误恢复不退化。
- [x] gate 全绿。
- [x] Codex review 确认不是只测 fake JSON。

## 目标

现有 `orchestrate.plan` 已有 Python contract、golden smoke、thin planner 和 error recovery。下一步要把 Node route 在 Python mode 下真正接到 Python runtime。

## 允许修改的文件
- `server/routes/sliderule.ts`
- `server/sliderule/orchestrate-plan.ts`
- `server/sliderule/python-delegation.ts`
- `server/routes/__tests__/sliderule.orchestrate-plan-python-runtime.test.ts`
- `server/routes/__tests__/sliderule.orchestrate-plan-python-contract.test.ts`
- `tws-ai-slide-rule-python/routes/sliderule.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_runtime_route.py`
- `agent-loop/tasks/backend-python-orchestrate-plan-runtime-route.md`

## 禁止扩大范围
- 不迁整个 Blueprint/Autopilot 主状态机。
- 不删除 Node fallback 行为。
- 不改与 `orchestrate.plan` 无关的 capability。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `orchestratePlanRuntimeRouteGates`。

## 成功标准

- Node vitest 能证明 Python mode 下 `orchestrate.plan` 调 Python runtime。
- Python pytest 能证明 route 输出兼容既有 contract。
- Python 错误时 Node 仍保留明确 fallback/error 语义。
- 所有 gate 通过。
