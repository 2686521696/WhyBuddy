# 后端 NodeJS 到 Python 迁移：LLM config parity

## 执行状态

- 状态：已实现 Python LLM 配置契约第一片，并通过 AgentLoop gate-only 复核
- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T02-51-25-969Z`
- AgentLoop 结果：`DONE_GATE_ONLY`
- AgentLoop 运行模式：`gate-only`
- Grok 已运行：`false`
- Codex 已运行：`false`
- gate 结果：baseline gate 为 green，failure count 为 0
- 注意：本任务只补 Python config/env parity，不发 live LLM，不迁 capability，不改 Node/前端。

- AgentLoop 本地时间：`2026-06-17 10:51:25 (Asia/Shanghai)`
## 任务清单

- [x] 1. 建立 config parity 任务入口
  - [x] 1.1 明确本任务来自 `backend-python-llm-infra-audit.md` 的 Phase 1 建议
  - [x] 1.2 写清 allowed files、禁止事项和 gate
  - [x] 1.3 保持任务文档中文、可读、可回写

- [x] 2. 先写 Python config 红灯测试
  - [x] 2.1 覆盖 `LLM_ROUTER_MODEL` / `OPENAI_ROUTER_MODEL`
  - [x] 2.2 覆盖 `LLM_MAX_CONTEXT`、`LLM_MAX_CONCURRENT`、`LLM_CHAT_THINKING_TYPE`
  - [x] 2.3 覆盖 `LLM_MODEL_FALLBACKS` 去重和主模型排除
  - [x] 2.4 覆盖 `FALLBACK_LLM_*`
  - [x] 2.5 覆盖 `BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API` 和 Node pool 默认值

- [x] 3. 实现 Python config parity 最小切片
  - [x] 3.1 扩展 `LlmConfig`
  - [x] 3.2 新增 `FallbackLlmConfig`
  - [x] 3.3 新增 `get_fallback_llm_config()`
  - [x] 3.4 扩展 `PoolConfig.wire_api`
  - [x] 3.5 更新 `sliderule_llm/__init__.py` 导出
  - [x] 3.6 修复 `pool.py` 的旧 `LlmConfig(...)` 构造路径，避免新增字段导致 pool 运行时报错

- [ ] 4. 验证
  - [x] 4.1 红灯：新增测试先因 `get_fallback_llm_config` 缺失失败
  - [x] 4.2 绿灯：`tests/test_config.py` 通过
  - [x] 4.3 Python config/pool/capability 相关 gate 通过
  - [x] 4.4 mojibake 检查通过
  - [x] 4.5 AgentLoop gate-only 通过并回写本段

## 目标

把 Python `sliderule_llm.config` 从“只读主 LLM 基础 env”推进到“能读懂 Node LLM 配置契约的第一层”。

这一步只做配置解析，不把 fallback/provider/pool 策略真正接入 `client.py` 或 `pool.py`。换句话说：

- 可以让 Python 看懂更多 env。
- 可以让后续 client/pool parity 有稳定配置对象可用。
- 不能宣称 Python LLM client 已经拥有 fallback、重试、熔断、并发限制。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/config.py`
- `tws-ai-slide-rule-python/sliderule_llm/__init__.py`
- `tws-ai-slide-rule-python/sliderule_llm/pool.py`
- `tws-ai-slide-rule-python/tests/test_config.py`
- `tws-ai-slide-rule-python/tests/test_pool.py`
- `agent-loop/tasks/backend-python-llm-config-parity.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`，仅限同步 LLM infra 状态摘要时使用

## 禁止事项

- 不修改 `client/`。
- 不修改 Node LLM 实现。
- 不修改 Python `client.py` / `pool.py` 的真实调用行为。
- 不修改 `.env`。
- 不打印真实 API key、数据库密码、Qdrant key、Bearer token。
- 不启动 live LLM。
- 不暂存、不提交。
- 不使用 `git add -A`。
- 不提交 `.agent-loop/`、`tmp/`、`probes/`、日志、cache、`tws-ai-slide-rule-python/data/`。

## 本轮实现内容

### `LlmConfig` 新增字段

- `router_model`
- `model_fallbacks`
- `max_context`
- `max_concurrent`
- `provider_name`
- `chat_thinking_type`

这些字段只用于配置 parity。当前 `client.py` 仍按原来的 `api_key/base_url/model/wire_api/reasoning_effort/timeout_ms/stream` 调用，不改变网络路径。

### 新增 `FallbackLlmConfig`

读取：

- `FALLBACK_LLM_API_KEY`
- `FALLBACK_LLM_BASE_URL`
- `FALLBACK_LLM_MODEL`
- `FALLBACK_LLM_WIRE_API`
- `FALLBACK_LLM_TIMEOUT_MS`
- `FALLBACK_LLM_REASONING_EFFORT`
- `FALLBACK_LLM_FORCE_MODEL`
- `FALLBACK_LLM_STREAM`
- `FALLBACK_LLM_CHAT_THINKING_TYPE`
- `FALLBACK_LLM_RETRIES`
- `FALLBACK_LLM_COOLDOWN_MS`

注意：本任务只读取配置，不启用 fallback provider 链。

### `PoolConfig` 新增字段

- `wire_api`

默认值对齐 Node：

- `BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL` 默认 `https://api.rcouyi.com/v1`
- `BLUEPRINT_SPEC_DOCS_LLM_POOL_MODEL` 默认 `ouyi-5-preview-thinking`
- `BLUEPRINT_SPEC_DOCS_LLM_POOL_TIMEOUT_MS` 默认 `300000`
- `BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API` 显式值优先
- pool model 是 `gpt-5` / `gpt5` / `5.x` 时默认 `responses`
- 其它模型默认 `chat_completions`

同时修复 `pool.py` 的 key config 构造路径：新增字段扩展后，旧的 `LlmConfig(...)` keyword 构造会缺参数；本轮已补默认值，并让 pool 实际使用 `PoolConfig.wire_api`。

## 已执行验证

红灯：

```powershell
.\tws-ai-slide-rule-python\.venv\Scripts\python.exe -m pytest tws-ai-slide-rule-python/tests/test_config.py -q --tb=short
```

结果：新增测试先失败，失败原因是 `get_fallback_llm_config` 尚未从 `sliderule_llm.config` 导出。

绿灯：

```powershell
.\tws-ai-slide-rule-python\.venv\Scripts\python.exe -m pytest tws-ai-slide-rule-python/tests/test_config.py -q --tb=short
```

结果：`12 passed in 0.03s`

兼容回归：

```powershell
.\tws-ai-slide-rule-python\.venv\Scripts\python.exe -m pytest tws-ai-slide-rule-python/tests/test_config.py tws-ai-slide-rule-python/tests/test_pool.py tws-ai-slide-rule-python/tests/test_capabilities.py -q --tb=short
```

结果：`20 passed, 1 skipped`

## AgentLoop gate-only 命令

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/backend-python-llm-config-parity.md `
  --gate ".\tws-ai-slide-rule-python\.venv\Scripts\python.exe -m pytest tws-ai-slide-rule-python/tests/test_config.py tws-ai-slide-rule-python/tests/test_pool.py tws-ai-slide-rule-python/tests/test_capabilities.py -q --tb=short" `
  --gate "node agent-loop/src/check-mojibake.js agent-loop/tasks tws-ai-slide-rule-python/sliderule_llm tws-ai-slide-rule-python/tests/test_config.py tws-ai-slide-rule-python/tests/test_pool.py" `
  --skip-review `
  --max-iterations 1 `
  --lang zh-CN
```

## 成功标准

- `tests/test_config.py` 通过。
- `tests/test_pool.py` 证明 pool key config 不因新增 dataclass 字段回归。
- 现有 `tests/test_capabilities.py` 不因 config 字段扩展回归。
- mojibake 检查通过。
- AgentLoop 以 `DONE_GATE_ONLY` 跑完。
- 本任务不会改变 live LLM 行为，不会抬高整体后端迁移百分比。

## 后续任务

下一片应继续 `backend-python-llm-client-parity.md`：

- 让 `client.py` 真正消费 fallback/model fallback 配置。
- 增加 retry/backoff。
- 增加错误分类和 usage 标准化。
- 增加 finish reason / length 处理。
