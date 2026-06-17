# 迁移 SlideRule 的 question.expand 到 Python 真脑子

## 执行状态

- 状态：已实现并通过 AgentLoop gate-only 验证
- 最近执行：2026-06-17
- 执行方式：先 TDD，再 AgentLoop gate-only 验证
- AgentLoop run id：`2026-06-17T02-07-11-436Z`
- AgentLoop 结果：`DONE_GATE_ONLY`
- gate 结果：baseline gate 为 green，failure count 为 0
- 注意：`.agent-loop/` 是运行产物，不提交；任务文档只记录人看的摘要状态。

- 最近确认：2026-06-17
- AgentLoop 本地时间：`2026-06-17 10:07:11 (Asia/Shanghai)`
- AgentLoop 运行模式：`gate-only`
- Grok 已运行：`false`
- Codex 已运行：`false`

### 状态清单

- [x] Python `question.expand` 走 `sliderule_llm.capabilities.execute_capability()`
- [x] Python 返回 `provenance="python-llm"`
- [x] Python LLM 失败时返回 502，不返回旧罐头
- [x] Node 在 `SLIDERULE_V5_BACKEND=python` 时委托给 Python
- [x] Node contract 测试覆盖 `question.expand`
- [x] Python pytest gate 通过
- [x] Node vitest gate 通过
- [x] TypeScript gate 通过
- [x] mojibake 扫描通过
- [x] 未提交 `.agent-loop/`、`tmp/`、`probes/`、`.env`、`tws-ai-slide-rule-python/data/`

目标：把 `question.expand` 这一个 SlideRule V5 对话类能力迁到 Python 后端的真 LLM 执行路径，并确认 Node 在 `SLIDERULE_V5_BACKEND=python` 时只做薄代理，不再调用 Node LLM 或 Node pool。

这是一片很小的迁移任务。不要扩大范围，不要顺手迁结构化 JSON 类能力。

## 当前背景

- `intent.clarify` 和 `gap.ask` 已经走 Python `sliderule_llm` 真脑子，返回 `provenance="python-llm"`。
- `question.expand` 和它们同属对话类能力，适合用 markdown 文本输出，不强迫模型返回 JSON。
- Python 旧的 `capability_maps` / `rag_service` 仍然存在，未迁能力暂时继续走旧路径。
- `app.py` 实际挂载的是 `routes/sliderule_full.py`，所以真脑子必须接到这个主路由。

## 允许修改的文件

只允许修改这些文件，除非 gate 明确证明必须多改一个文件：

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`
- `server/routes/__tests__/sliderule.live-delegation.test.ts`
- `agent-loop/tasks/migrate-sliderule-question-expand.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`

## 禁止事项

- 不修改 `client/`。
- 不改 `shared/blueprint/`。
- 不改 LLM infra WIP。
- 不迁移 `report.write`、`structure.decompose` 等结构化能力。
- 不提交 `.agent-loop/`、`tmp/`、`probes/`、`.env`、日志、cache、`tws-ai-slide-rule-python/data/`。
- 不加入或打印真实密钥、数据库密码、Qdrant key、Bearer token。

## 必须保持的行为

- Python 的 `question.expand` 必须走 `sliderule_llm.capabilities.execute_capability()`。
- Python 返回形状必须仍然是 Node 期待的 V5 能力结果：
  - `title`
  - `summary`
  - `content`
  - `provenance`
  - 可选 `model`
  - 可选 `usage`
- `question.expand` 的 `provenance` 应为 `python-llm`，表示是真模型输出，不是假 RAG。
- 如果 Python LLM 失败，Python 路由要返回 502，不能假装成功返回罐头。
- Node 在 `SLIDERULE_V5_BACKEND=python` 时必须调用 `callPythonSlideRule()`。
- Node 不得调用 `callLLMJsonWithUsage()`。
- Node 不得调用 `callPoolJsonLlm()`。
- 未迁移能力继续走旧 Python mapped/RAG 路径。

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
node agent-loop/src/check-mojibake.js agent-loop/tasks tws-ai-slide-rule-python server/routes/__tests__/sliderule.live-delegation.test.ts server/routes/__tests__/sliderule.execute-capability.test.ts
```

## AgentLoop gate-only 命令

这个命令只做 gate 审计，不自动改代码：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/migrate-sliderule-question-expand.md `
  --gate "cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short" `
  --gate "pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot" `
  --gate "pnpm exec tsc --noEmit --pretty false" `
  --gate "node agent-loop/src/check-mojibake.js agent-loop/tasks tws-ai-slide-rule-python server/routes/__tests__/sliderule.live-delegation.test.ts server/routes/__tests__/sliderule.execute-capability.test.ts" `
  --skip-review `
  --max-iterations 1 `
  --lang zh-CN
```

## 成功标准

- Python 默认 gate 通过。
- Node 默认 gate 通过。
- TypeScript 通过。
- mojibake 扫描通过。
- `question.expand` 返回 `python-llm`。
- Node LLM 和 Node pool 在 `question.expand` python mode 下没有被调用。
