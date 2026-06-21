# 后端 NodeJS 到 Python 迁移：Production observability rollup

## 执行状态
- 状态：已完成
- 目标：把 Python runtime 的 telemetry、cost、health、error envelope 汇总成生产观测 rollup，不做完整 APM。
- 角色分工：worker 负责 Python/Node observability contract 和测试；reviewer 确认没有伪造生产级指标或引入外部 sink。

### 状态清单
- [x] Python rollup 暴露 runtime health、error、cost/telemetry 摘要。
- [x] Node route/client 能读取 rollup 并保留 degraded 状态。
- [x] unknown/missing metric 不伪装成 healthy。
- [x] gate 全绿。
- [x] Codex review 确认没有接真实外部观测平台。

## 目标

迁移推进到 75% 候选阶段时，不能只看功能 gate。需要有一个轻量 production observability rollup，帮助后续判断 Python runtime 是否可部署、可诊断。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_production_observability_rollup.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_route_contract.py`
- `server/routes/__tests__/python-observability-rollup.test.ts`
- `server/routes/__tests__/telemetry-python-route-contract.test.ts`
- `shared/telemetry/contracts.ts`
- `agent-loop/tasks/backend-python-production-observability-rollup.md`

## 禁止扩大范围
- 不接真实 Datadog、OpenTelemetry collector 或外部 sink。
- 不做完整成本结算。
- 不把 unknown/missing 指标当作 healthy。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `productionObservabilityRollupGates`。

## 成功标准

- Python rollup 测试覆盖 health、error、telemetry/cost 摘要。
- Node 测试确认 degraded/unknown 状态不会被吞掉。
- contract 字段稳定，可供部署检查复用。
- 所有 gate 通过。
