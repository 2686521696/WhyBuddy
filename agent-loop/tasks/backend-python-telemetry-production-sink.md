# 后端 NodeJS 到 Python 迁移：telemetry production sink

## 执行状态
- 状态：待执行
- 目标：把 telemetry（观测）从 contract 推进到 production sink（生产落点）最小边界。
- 角色分工：worker 负责 sink adapter 和测试；reviewer 确认不伪造 actual cost（真实成本）。

### 状态清单
- [x] Python telemetry sink 支持 synthetic、estimated、actual 三类来源。
- [x] actual 只能由明确 actual source 写入。
- [x] Node route test 覆盖 sink unavailable 和 estimated fallback。
- [x] gate 全绿。
- [x] Codex review 确认没有把 estimated 伪装成 actual。

## 目标

上一轮 telemetry route 已经区分 synthetic/estimated/actual。这个任务推进到 sink adapter，但仍不接真实生产监控系统。重点是数据来源不能乱。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/telemetry.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_production_sink.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_route_contract.py`
- `server/routes/telemetry.ts`
- `server/routes/__tests__/telemetry-python-production-sink.test.ts`
- `server/routes/__tests__/telemetry-python-route-contract.test.ts`
- `agent-loop/tasks/backend-python-telemetry-production-sink.md`

## 禁止扩大范围
- 不接真实计费系统。
- 不写真实监控库。
- 不把 estimated 标成 actual。
- 不提交监控日志或密钥。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `telemetryProductionSinkGates`。

## 成功标准

- Python 测试覆盖 synthetic、estimated、actual、sink unavailable。
- Node 测试确认 actual 来源规则不退化。
- sink unavailable 有稳定失败或 fallback，不伪装成功。
- 所有 gate 通过。
