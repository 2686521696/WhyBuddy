# 迁移 SlideRule 的 critique.generate 到 Python 真脑子

## 执行状态

- 状态：已完成 — markdown 审议走 Python native LLM，gate 全绿
- 目标 capability：`critique.generate`
- 预期 provenance：`python-llm`
- 注意：`.agent-loop/` 是运行产物，不提交；任务文档只记录人看的摘要状态。

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`baseline-green-2026-06-17`
- AgentLoop 本地时间：`2026-06-17 23:26 (Asia/Shanghai)`
- AgentLoop 结果：`DONE_GATE_ONLY`（代码已 native，队列曾 disabled）
- gate 结果：pytest 34 passed, vitest 28 passed, tsc OK, mojibake OK

### 状态清单

- [x] Python `critique.generate` 走 `sliderule_llm.capabilities.execute_capability()`
- [x] Python 返回 `provenance="python-llm"`
- [x] Python LLM 失败时返回 502，不返回旧罐头
- [x] Node 在 `SLIDERULE_V5_BACKEND=python` 时委托给 Python
- [x] Node contract 测试覆盖 `critique.generate`
- [x] Python pytest gate 通过
- [x] Node vitest gate 通过
- [x] TypeScript gate 通过
- [x] mojibake 扫描通过

目标：把 `critique.generate` 这一条 SlideRule V5 审议类能力迁到 Python 后端的真 LLM 执行路径，并确认 Node 在 `SLIDERULE_V5_BACKEND=python` 时只做薄代理，不再调用 Node LLM 或 Node pool。

这是一片很小的迁移任务。不要扩大范围，不要顺手迁 `synthesis.merge` 或其它能力。

## 当前背景

- `intent.clarify`、`gap.ask`、`question.expand` 已走 Python `sliderule_llm` 真脑子，返回 `provenance="python-llm"`。
- `critique.generate` 同属 markdown 审议/挑刺类输出，**不要**强迫模型返回严格 JSON schema；沿用散文 markdown 策略。
- Python 旧的 `capability_maps` / `rag_service` 仍然存在；`critique.generate` 已走 native path，返回 `python-llm`。
- `app.py` 实际挂载的是 `routes/sliderule_full.py`，真脑子必须接到这个主路由。

## 允许修改的文件

只允许修改这些文件，除非 gate 明确证明必须多改一个文件：

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`（仅当 gate 证明路由未优先走 native path）
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

不要碰这些内容：

- `client/`、`server/core/`、`shared/blueprint/`、`scripts/`
- `server/sliderule/orchestrate-plan.ts`、`server/sliderule/pool-json-llm.ts`
- `tws-ai-slide-rule-python/data/`
- `.agent-loop/`、`.env`、`tmp/`、`probes/`

## 必须保持的行为

- Python 的 `critique.generate` 必须走 `sliderule_llm.capabilities.execute_capability()`。
- Python 返回形状必须仍然是 Node 期待的 V5 能力结果：`title`、`summary`、`content`、`provenance`、可选 `model`/`usage`。
- `critique.generate` 的 `provenance` 应为 `python-llm`。
- Python LLM 失败时路由返回 502，不能假装成功返回罐头。
- Node 在 `SLIDERULE_V5_BACKEND=python` 时必须调用 `callPythonSlideRule()`。
- Node 不得调用 `callLLMJsonWithUsage()` 或 `callPoolJsonLlm()` 处理 `critique.generate`。
- 未迁移能力继续走旧 Python mapped/RAG 路径。

## 实现提示

1. 在 `CAPABILITY_PROMPTS` / `CAPABILITY_TITLES` 增加 `critique.generate`，prompt 要求 markdown 三段：挑刺点、风险、最小验证步骤。
2. 把 `critique.generate` 从 `test_v5_contract_expansion.py` 的 RAG 矩阵移到 native dialogue/deliberation 测试组。
3. 在 `server/routes/sliderule.ts` 的 `isPythonV5Cap` 白名单加入 `critique.generate`（若尚未包含委托逻辑则补上）。

## 必跑 gate

```powershell
cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short
```

```powershell
pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts --reporter=dot
```

```powershell
pnpm exec tsc --noEmit --pretty false
```

```powershell
node agent-loop/src/check-mojibake.js tws-ai-slide-rule-python server/routes/__tests__/sliderule.execute-capability.test.ts
```

## 成功标准

- 上述 gate 全绿。
- `critique.generate` 返回 `python-llm`。
- 输出不含旧罐头特征（如泛化 `RBAC` / `data scoping` 签名）。
- Node LLM 和 Node pool 在 python mode 下没有被调用。
- diff 只包含允许文件。