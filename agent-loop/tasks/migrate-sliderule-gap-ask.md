# 迁移 SlideRule 的 gap.ask 到 Python 真脑子

## 执行状态

- 状态：已实现并验证通过
- 最近执行：2026-06-17
- 执行方式：AgentLoop gate-only + 手工隔离端口 live 验证
- AgentLoop run id：`2026-06-16T17-00-02-496Z`
- AgentLoop 报告：`.agent-loop/latest/final-report.md`
- AgentLoop 结果：`DONE_GATE_ONLY`
- gate 结果：baseline gate 为 green，failure count 为 0
- 注意：`.agent-loop/` 是运行产物，不提交；任务文档只记录人看的摘要状态。

### 状态清单

- [x] Python `gap.ask` 走 `sliderule_llm.capabilities.execute_capability()`
- [x] Python 返回 `provenance="python-llm"`
- [x] Python LLM 失败时返回 502，不返回旧罐头
- [x] Node 在 `SLIDERULE_V5_BACKEND=python` 时委托给 Python
- [x] Node contract 测试覆盖 `gap.ask`
- [x] live smoke 支持 `PYTHON_SLIDE_RULE_BASE_URL`，可用隔离端口验证
- [x] Python pytest gate 通过
- [x] Node vitest gate 通过
- [x] TypeScript gate 通过
- [x] mojibake 扫描通过
- [x] 未提交 `.agent-loop/`、`tmp/`、`probes/`、`.env`、`tws-ai-slide-rule-python/data/`

目标：把 `gap.ask` 这一个 SlideRule V5 能力迁到 Python 后端的真 LLM 执行路径，并确认 Node 在 `SLIDERULE_V5_BACKEND=python` 时只做薄代理，不再调用 Node LLM 或 Node pool。

这是一片很小的迁移任务。不要扩大范围，不要顺手迁其它能力。

## 当前背景

- `intent.clarify` 已经开始走 Python `sliderule_llm` 真脑子，返回 `provenance="python-llm"`。
- `gap.ask` 和 `intent.clarify` 同属对话类能力，适合用 markdown 文本输出，不强迫模型返回 JSON。
- Python 旧的 `capability_maps` / `rag_service` 仍然存在，未迁能力暂时继续走旧路径。
- `app.py` 实际挂载的是 `routes/sliderule_full.py`，所以真脑子必须接到这个主路由，不能只改 `routes/sliderule.py`。

## 允许修改的文件

只允许修改这些文件，除非 gate 明确证明必须多改一个文件：

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`
- `server/routes/__tests__/sliderule.live-delegation.test.ts`

不要碰这些内容：

- LLM 路由 WIP 相关的 `client/`、`server/core/`、`shared/blueprint/`、`scripts/`
- `tws-ai-slide-rule-python/data/`
- `.agent-loop/`
- `.env`
- `tmp/`、`probes/`、日志、缓存文件

## 必须保持的行为

- Python 的 `gap.ask` 必须走 `sliderule_llm.capabilities.execute_capability()`。
- Python 返回形状必须仍然是 Node 期待的 V5 能力结果：
  - `title`
  - `summary`
  - `content`
  - `provenance`
  - 可选 `model`
  - 可选 `usage`
- `gap.ask` 的 `provenance` 应为 `python-llm`，表示是真模型输出，不是假 RAG。
- 如果 Python LLM 失败，Python 路由要返回 502，不能假装成功返回罐头。
- Node 在 `SLIDERULE_V5_BACKEND=python` 时必须调用 `callPythonSlideRule()`。
- Node 不得调用 `callLLMJsonWithUsage()`。
- Node 不得调用 `callPoolJsonLlm()`。
- 未迁移能力继续走旧 Python mapped/RAG 路径。

## 测试要求

先写测试，再改实现：

- Python 离线测试：注入 fake caller，证明 `gap.ask` 返回 `python-llm` 形状。
- Python 主路由测试：通过 `/api/sliderule/execute-capability` 证明 `gap.ask` 走真脑子，不走旧 RAG 罐头。
- Node contract 测试：证明 `gap.ask` 在 python mode 下委托给 Python。
- Node live smoke：在 `LIVE_NODE_TO_PYTHON_SLIDERULE=1` 时，真实 Node route 能打到真实 Python 服务。

live 测试要支持 `PYTHON_SLIDE_RULE_BASE_URL`，不要写死 9700。这样可以用隔离端口避开旧服务。

## 必跑 gate

从仓库根目录运行：

```powershell
cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short
```

```powershell
pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot
```

```powershell
pnpm exec tsc --noEmit --pretty false
```

```powershell
node agent-loop/src/check-mojibake.js tws-ai-slide-rule-python server/routes/__tests__/sliderule.live-delegation.test.ts server/routes/__tests__/sliderule.execute-capability.test.ts
```

## live 验证建议

不要直接复用 9700，因为本机可能已经有旧 uvicorn 在跑。

建议临时启动隔离端口，例如 9711：

```powershell
cd tws-ai-slide-rule-python
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 9711 --log-level warning
```

另一个终端运行：

```powershell
$env:LIVE_NODE_TO_PYTHON_SLIDERULE="1"
$env:PYTHON_SLIDE_RULE_BASE_URL="http://127.0.0.1:9711"
pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot
Remove-Item Env:\LIVE_NODE_TO_PYTHON_SLIDERULE
Remove-Item Env:\PYTHON_SLIDE_RULE_BASE_URL
```

如果 Python 进程没有继承根 `.env` 里的 `LLM_*`，`intent.clarify` / `gap.ask` 会返回 502。这是正确失败，不是罐头成功。live 时要确保临时 Python 进程能看到 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_WIRE_API` 等必要变量。

## AgentLoop gate-only 命令

这个命令只做 gate 审计，不自动改代码：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/migrate-sliderule-gap-ask.md `
  --gate "cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short" `
  --gate "pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot" `
  --gate "pnpm exec tsc --noEmit --pretty false" `
  --gate "node agent-loop/src/check-mojibake.js tws-ai-slide-rule-python server/routes/__tests__/sliderule.live-delegation.test.ts server/routes/__tests__/sliderule.execute-capability.test.ts" `
  --skip-review `
  --max-iterations 1
```

执行结果不会写进 `agent-loop/tasks/`。AgentLoop 的运行报告会写到：

- `.agent-loop/latest/final-report.md`
- `.agent-loop/runs/<run-id>/`

这些是运行产物，默认不提交。

## 人工复查清单

- `git status --short`
- `git diff -- tws-ai-slide-rule-python/sliderule_llm/capabilities.py tws-ai-slide-rule-python/routes/sliderule_full.py tws-ai-slide-rule-python/tests/test_capabilities.py tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py server/routes/sliderule.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts`
- 确认没有 `.agent-loop/`、`tmp/`、`probes/`、`tws-ai-slide-rule-python/data/` 被暂存。
- 确认没有 `.env` 被暂存。
- 确认没有真实密钥、数据库密码、Qdrant key、Bearer token 被加入代码或测试。

## 成功标准

- Python 默认 gate 通过。
- Node 默认 gate 通过。
- TypeScript 通过。
- mojibake 扫描通过。
- 隔离端口 live smoke 通过。
- `gap.ask` 返回 `python-llm`。
- `gap.ask` 输出不含旧罐头特征，例如 `RBAC` / `data scoping`。
- Node LLM 和 Node pool 在 `gap.ask` python mode 下没有被调用。
