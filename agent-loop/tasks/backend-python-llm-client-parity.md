# 后端 NodeJS 到 Python 迁移：LLM client parity

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标：让 Python `sliderule_llm.client` 从「能调用」升级到「可承压的后端底座切片」
- 前置：`backend-python-llm-config-parity.md` 已完成
- 注意：本任务不发 live LLM；用 mock HTTP / 纯单测锁住行为。

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T06-18-55-042Z`
- AgentLoop 本地时间：`2026-06-17 14:18:55 (Asia/Shanghai)`
- AgentLoop 结果：`HALT_HUMAN`
- AgentLoop 运行模式：`halt-human-after-review`
- Grok 已运行：`false`
- Codex 已运行：`true`
- gate 结果：最近状态为 `HALT_HUMAN`
### 状态清单

- [ ] `classify_llm_failure_kind()` 错误分类与 Node 口径对齐
- [ ] transient 错误支持 retry/backoff
- [ ] usage 字段标准化（`total_tokens` / `prompt_tokens` / `completion_tokens`）
- [ ] finish reason / empty content 处理
- [ ] 读取 `get_fallback_llm_config()` 并接入 provider fallback 链（mock 级）
- [ ] `tests/test_client_parity.py` 绿灯
- [ ] 现有 `test_config.py` / `test_capabilities.py` 无回归

## 目标

补齐 Python LLM client 的运行语义，为后续 JSON hardening 和结构化 capability 迁移打底。

**不做：** pool 504 penalty、spec-doc 形状校验（留给 pool-parity）、SlideRule capability 迁移。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/__init__.py`
- `tws-ai-slide-rule-python/tests/test_client_parity.py`
- `tws-ai-slide-rule-python/tests/test_config.py`（仅当 gate 证明必须联动）
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