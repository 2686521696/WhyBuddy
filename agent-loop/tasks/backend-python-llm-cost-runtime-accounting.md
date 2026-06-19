# 后端 NodeJS 到 Python 迁移：LLM cost runtime accounting

## 执行状态
- 状态：待执行
- 目标：把 LLM telemetry cost（遥测成本）推进到 runtime accounting（运行时计费统计）最小闭环。
- 角色分工：worker 负责 Python cost metadata 和测试；reviewer 确认不记录真实 key、不夸大真实账单准确性。

### 状态清单
- [ ] Python LLM 响应包含 token/cost metadata。
- [ ] unknown pricing（未知价格）有安全 fallback。
- [ ] pool/client telemetry 能汇总安全字段。
- [ ] gate 全绿。
- [ ] Codex review 确认不泄露 key 或真实账单数据。

## 目标

LLM infra 要继续从 55-62% 往上走，cost accounting 是必要底座。这个任务只做 runtime metadata，不接真实账单系统。

## 允许修改的文件
- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/pool.py`
- `tws-ai-slide-rule-python/tests/test_cost_runtime_accounting.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_cost.py`
- `agent-loop/tasks/backend-python-llm-cost-runtime-accounting.md`

## 禁止扩大范围
- 不调用真实 billing API。
- 不记录完整 API key。
- 不改变 provider routing。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `llmCostRuntimeAccountingGates`。

## 成功标准

- Python 测试覆盖 token metadata、known pricing、unknown pricing、pool summary。
- key 只允许脱敏 id/hash/alias。
- 现有 telemetry/client/pool 测试继续通过。
- 所有 gate 通过。
