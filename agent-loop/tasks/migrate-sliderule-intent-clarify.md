# 迁移 SlideRule 的 intent.clarify 到 Python 真脑子

## 执行状态

- 状态：已实现并验证通过
- 最近确认：2026-06-17
- 结果：Node 在 `SLIDERULE_V5_BACKEND=python` 时委托 Python，Python 返回 `provenance="python-llm"`
- 注意：旧版任务说明曾写 `python-rag`，那是过时说法；当前真脑子路径应为 `python-llm`。
- 运行产物：详细 AgentLoop 报告在 `.agent-loop/` 或 `agent-loop/.agent-loop/` 下，运行产物不提交。

### 状态清单

- [x] Node Python mode 下调用 `callPythonSlideRule()`
- [x] 委托 endpoint 为 `/api/sliderule/execute-capability`
- [x] payload 保留 `capabilityId`、`state`、`inputArtifactIds`、`roleId`、`turnId`、`userText`
- [x] Python 侧走 `sliderule_llm` 真 LLM 执行路径
- [x] 返回 `provenance="python-llm"`
- [x] Node LLM、Node pool、legacy fallback 在 Python mode 下不被调用
- [x] legacy mode 仍保留旧路径测试覆盖

目标：把 `intent.clarify` 这一条 SlideRule V5 能力迁到 Python 后端，让 Node 在 `SLIDERULE_V5_BACKEND=python` 时只做薄代理。

这是一片窄迁移任务。不要顺手迁其它能力，不要碰无关 LLM 路由 WIP。

## 允许修改的文件

只允许修改这些文件，除非 gate 明确证明必须多改一个文件：

- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`
- `server/routes/__tests__/sliderule.live-delegation.test.ts`
- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`

不要碰这些内容：

- 无关 LLM 路由 WIP
- UI 文件
- shared blueprint 文件
- script probes
- Python runtime data
- `.agent-loop/`
- `.env`
- `tmp/`、`probes/`、日志、缓存文件

## 必须保持的行为

- `SLIDERULE_V5_BACKEND=python` 时，`intent.clarify` 必须调用 `callPythonSlideRule()`。
- 委托 endpoint 必须是 `/api/sliderule/execute-capability`。
- payload 必须保留：
  - `capabilityId`
  - `state`
  - `inputArtifactIds`
  - `roleId`
  - `turnId`
  - `userText`
- Python 返回形状必须仍然是 Node 期待的 V5 能力结果：
  - `title`
  - `summary`
  - `content`
  - `provenance`
  - 可选 `model`
  - 可选 `usage`
- `intent.clarify` 的 `provenance` 应为 `python-llm`，表示是真模型输出，不是假 RAG。
- Node LLM、Node pool、legacy fallback 在 Python mode 下不得被调用。
- `SLIDERULE_V5_BACKEND=legacy` 时，旧 Node 行为仍要可用。

## 测试要求

先写测试，再改实现：

- Node contract 测试：证明 `intent.clarify` 在 Python mode 下委托给 Python。
- Node legacy-mode 测试：证明 `SLIDERULE_V5_BACKEND=legacy` 时旧路径仍可用。
- Python contract 测试：证明 `intent.clarify` 走 Python 真脑子并返回 `python-llm`。
- live smoke 可以放在 `LIVE_NODE_TO_PYTHON_SLIDERULE=1` 后面，不能要求默认测试必须有 live LLM key。

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

如果 Python 进程没有继承根 `.env` 里的 `LLM_*`，`intent.clarify` 会返回 502。这是正确失败，不是罐头成功。live 时要确保临时 Python 进程能看到必要 LLM 环境变量，但不要把真实值写进文档或日志。

## AgentLoop 命令

从仓库根目录运行：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/migrate-sliderule-intent-clarify.md `
  --gate "cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short" `
  --gate "pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot" `
  --gate "pnpm exec tsc --noEmit --pretty false" `
  --gate "node agent-loop/src/check-mojibake.js tws-ai-slide-rule-python server/routes/__tests__/sliderule.live-delegation.test.ts server/routes/__tests__/sliderule.execute-capability.test.ts" `
  --skip-review `
  --max-iterations 1
```

## 人工复查清单

- `git diff -- server/routes/sliderule.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts tws-ai-slide-rule-python/sliderule_llm/capabilities.py tws-ai-slide-rule-python/routes/sliderule_full.py tws-ai-slide-rule-python/tests/test_capabilities.py tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `git status --short`
- 确认没有 `.agent-loop/`、`tmp/`、`probes/`、`tws-ai-slide-rule-python/data/`、`.env`、日志、缓存文件被暂存。
- 确认没有真实密钥、数据库密码、Qdrant key、Bearer token 被加入代码或测试。
