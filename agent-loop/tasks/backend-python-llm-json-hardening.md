# 后端 NodeJS 到 Python 迁移：LLM JSON hardening

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标：加固 `call_llm_json` / JSON shape 解析，支撑 `report.write`、`structure.decompose` 等结构化能力迁移
- 前置：`backend-python-llm-client-parity.md` 应先完成或并行
- 注意：不发 live LLM；只测解析、重试、shape 校验逻辑。

### 状态清单

- [ ] 空 JSON / 缺字段 / 错 schema 时有明确 `LlmError`
- [ ] 支持 required keys 校验（如 `title`/`content`）
- [ ] 空对象重试或 shape-retry 策略（mock 级，对齐 Node `SLIDERULE_JSON_LLM_MAX_TOKENS` 精神）
- [ ] finish_reason=`length` 时有处理分支
- [ ] `tests/test_json_hardening.py` 绿灯
- [ ] 现有 `test_capabilities.py` 对话类能力无回归

## 目标

在迁 `report.write` / `structure.decompose` 之前，先把 Python JSON 输出路径从「能 parse」升级到「能守住契约」。

**不做：** 直接迁 `report.write` capability（留给下一任务）。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/__init__.py`
- `tws-ai-slide-rule-python/tests/test_json_hardening.py`
- `tws-ai-slide-rule-python/tests/test_client_parity.py`（仅当 gate 证明共享 helper）
- `agent-loop/tasks/backend-python-llm-json-hardening.md`

## 禁止事项

- 不修改 `capabilities.py` 的业务 prompt
- 不修改 Node pool / orchestrate 路径
- 不启动 live LLM

## 必跑 gate

```powershell
cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_json_hardening.py tests/test_client_parity.py tests/test_capabilities.py -q --tb=short
```

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks tws-ai-slide-rule-python/sliderule_llm/client.py tws-ai-slide-rule-python/tests/test_json_hardening.py
```

## 成功标准

- `tests/test_json_hardening.py` 全绿
- 对话类 native capability 测试仍通过