# 后端 NodeJS 到 Python 迁移：LLM circuit breaker parity

## 执行状态
- 状态：待执行
- 目标：补齐 Python LLM pool 的 circuit breaker（熔断）语义，使其更接近 Node 侧。
- 角色分工：worker 负责 pool 熔断行为和测试；reviewer 确认不改变已有 penalty（惩罚）语义。

### 状态清单
- [ ] 连续失败能进入 circuit open（熔断打开）。
- [ ] cooldown（冷却）后可 half-open（半开）试探。
- [ ] 成功后可恢复。
- [ ] gate 全绿。
- [ ] Codex review 确认不泄露 key。

## 目标

上一批有 pool resilience 和 observability。下一步补更像 Node 的 circuit breaker 行为，减少后续生产接线风险。

## 允许修改的文件
- `tws-ai-slide-rule-python/sliderule_llm/pool.py`
- `tws-ai-slide-rule-python/tests/test_pool_circuit_breaker.py`
- `tws-ai-slide-rule-python/tests/test_pool_resilience.py`
- `tws-ai-slide-rule-python/tests/test_pool_observability.py`
- `agent-loop/tasks/backend-python-llm-circuit-breaker-parity.md`

## 禁止扩大范围
- 不改 provider/model 选择策略。
- 不记录真实 API key。
- 不发真实网络请求。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `llmCircuitBreakerParityGates`。

## 成功标准

- Python 测试覆盖 open、half-open、close、cooldown。
- 既有 pool resilience 和 observability 测试不退化。
- metadata 只包含脱敏 key 信息。
- 所有 gate 通过。
