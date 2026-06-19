# 后端 NodeJS 到 Python 迁移：LLM telemetry / cost

## 执行状态

- 状态：已完成 — chat / JSON / pool 统一 telemetry 已用本地测试锁住
- 目标：补齐 Python LLM 调用的 usage / latency / cost telemetry（用量/耗时/费用统计）
- 前置：`backend-python-llm-client-parity.md`、`backend-python-llm-pool-parity.md` 建议先完成
- 注意：本任务只做本地可测 telemetry，不接真实计费系统。

- 最近执行：2026-06-19
- 最近确认：2026-06-19
- 执行方式：Codex 直接小切片实现，未发 live LLM
- gate 结果：`tests/test_telemetry_cost.py tests/test_client_parity.py tests/test_pool_parity.py` 全绿

### 状态清单

- [x] 已执行本地实现与验证
- [x] chat / JSON / pool 调用都能产出统一 telemetry
- [x] usage token（用量 token）标准化
- [x] latency（耗时）和 model/provider metadata（模型/供应商元数据）保留
- [x] gate 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 目标

让 Python LLM 底座能把每次调用的 model、provider、token usage、latency、fallback path、pool label 等信息以统一结构返回或记录，方便后续成本控制和运行观测。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/pool.py`
- `tws-ai-slide-rule-python/sliderule_llm/__init__.py`
- `tws-ai-slide-rule-python/tests/test_telemetry_cost.py`
- `tws-ai-slide-rule-python/tests/test_client_parity.py`
- `tws-ai-slide-rule-python/tests/test_pool_parity.py`
- `agent-loop/tasks/backend-python-llm-telemetry-cost.md`

## 禁止扩大范围

- 不接真实 billing API（计费接口）。
- 不发 live LLM。
- 不改业务 capability prompt（能力提示词）。
- 不提交真实 key、日志、`.env`。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `telemetryGates`。

## 成功标准

- `tests/test_telemetry_cost.py` 全绿。
- chat / JSON / pool 三类调用能返回一致的 telemetry 字段。
- 不破坏现有 client / pool parity 测试。
- diff 只落在允许文件范围内。
