# 后端 NodeJS 到 Python 迁移：LLM client parity

## 执行状态

- 状态：已实现 — client parity 代码与单测已补齐，待 AgentLoop 审查闭环
- 目标：让 Python `sliderule_llm.client` 从「能调用」升级到「可承压的后端底座切片」
- 前置：`backend-python-llm-config-parity.md` 已完成
- 注意：本任务不发 live LLM；用 mock HTTP / 纯单测锁住行为。

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T11-44-32-372Z`
- AgentLoop 本地时间：`2026-06-17 19:44:32 (Asia/Shanghai)`
- AgentLoop 结果：`DONE_REVIEWED`
- AgentLoop 运行模式：`grok-review`
- Grok 已运行：`true`
- Codex 已运行：`false`
- gate 结果：最终状态为 `DONE_REVIEWED`
### 状态清单

- [x] `classify_llm_failure_kind()` 错误分类与 Node 口径对齐
- [x] transient 错误支持 retry/backoff
- [x] usage 字段标准化（`total_tokens` / `prompt_tokens` / `completion_tokens`）
- [x] finish reason / empty content 处理
- [x] 读取 `get_fallback_llm_config()` 并接入 provider fallback 链（mock 级）
- [x] `tests/test_client_parity.py` 绿灯
- [x] 现有 `test_config.py` 无回归；`test_capabilities.py` 对已迁移能力无回归（队列中待迁能力仍预期 `UnsupportedCapability`）

## 目标

补齐 Python LLM client 的运行语义，为后续 JSON hardening 和结构化 capability 迁移打底。

**不做：** pool 504 penalty、spec-doc 形状校验（留给 pool-parity）、SlideRule capability 迁移。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/__init__.py`
- `tws-ai-slide-rule-python/tests/test_client_parity.py`
- `tws-ai-slide-rule-python/tests/test_config.py`（仅当 gate 证明必须联动）
- `tws-ai-slide-rule-python/tests/test_capabilities.py`（仅当 gate 包含该文件且需修正回归口径）
- `agent-loop/tasks/backend-python-llm-client-parity.md`

## 禁止事项

- 不修改 `pool.py`（留给 pool-parity）
- 不修改 `capabilities.py`
- 不修改 Node `server/core/llm-client.ts`
- 不启动 live LLM
- 不提交 `.agent-loop/`、`.env`、`data/`

## 必跑 gate

```powershell
cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_client_parity.py tests/test_config.py tests/test_capabilities.py -q --tb=short
```

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks tws-ai-slide-rule-python/sliderule_llm tws-ai-slide-rule-python/tests/test_client_parity.py
```

## 成功标准

- `tests/test_client_parity.py` 全绿
- 现有 capability/config 测试无回归
- diff 只在允许文件内