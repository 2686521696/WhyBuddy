# SlideRule Python Native Capability Audit

## 结论

这份审计按当前代码事实统计，不把“Node 已委托 Python”直接等同于“Python native LLM 已完成”。

- Python native LLM（Python 原生大模型）能力：18 个。
- Node Python-mode delegation（Node 的 Python 模式委托）白名单：21 个。
- 白名单里有 3 个不属于当前 Python native LLM 能力：`mcp.call`、`skill.invoke`、`orchestrate.plan`。
- `ux.preview` 已在 2026-06-19 迁入 Python native LLM，并通过 Python/Node gate。
- 旧 Node visual executor（可视化执行器）仍存在于 legacy/mapped 路径里，用于 `SLIDERULE_V5_BACKEND=legacy` 或非 Python-mode 场景，不应误判成当前 Python-mode 主路径。

## Python Native LLM 能力矩阵

| capabilityId | Python native | provenance | Python 覆盖 | Node Python-mode 覆盖 | 备注 |
|---|---|---|---|---|---|
| `intent.clarify` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 对话类 markdown 输出 |
| `gap.ask` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 对话类 markdown 输出 |
| `question.expand` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 对话类 markdown 输出 |
| `critique.generate` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 审议类 markdown 输出 |
| `synthesis.merge` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 审议类 markdown 输出 |
| `rebuttal.resolve` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 审议类 markdown 输出 |
| `counter.argue` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 审议类 markdown 输出 |
| `structure.decompose` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 结构拆解 markdown 输出 |
| `document.draft` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | delivery chain |
| `traceability.matrix` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | delivery chain |
| `task.write` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | delivery chain |
| `instruction.package` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | delivery chain |
| `outcome.visualize` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | visual/output preview |
| `ux.preview` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | UX screen/state preview |
| `handoff.package` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | delivery chain 收束 |
| `risk.analyze` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 风险分析 |
| `evidence.search` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 保留 `sources` 形状 |
| `report.write` | yes | `python-llm` | `test_capabilities.py`, `test_v5_contract_expansion.py` | `sliderule.execute-capability.test.ts` | 结构化 JSON LLM 路径 |

## 已委托 Python 但不是当前 native LLM 闭环的能力

| capabilityId | Node Python-mode 状态 | Python native LLM 状态 | 风险 |
|---|---|---|---|
| `mcp.call` | Node 白名单会委托 Python | 不在 `CAPABILITY_PROMPTS` / `STRUCTURED_JSON_CAPABILITIES` | 需要单独审计 Python 路由是否有真实实现，不能按 `python-llm` 完成计数 |
| `skill.invoke` | Node 白名单会委托 Python | 不在 `CAPABILITY_PROMPTS` / `STRUCTURED_JSON_CAPABILITIES` | 同上 |
| `orchestrate.plan` | Node 白名单会委托 `/api/sliderule/orchestrate-plan` | 不走 `execute_capability()` native LLM 列表 | 属于编排接口，不应混入 capability native LLM 完成数 |

## 仍需单独审计的边界

- live deployment（真实部署）和 `PYTHON_SLIDE_RULE_BASE_URL` / internal key（内部密钥）配置。
- `mcp.call`、`skill.invoke`、`orchestrate.plan` 的 Python 路由真实行为。
- RAG/vector（检索/向量库）是否仍是关键词或 stub 式实现。
- legacy visual executor（旧可视化执行器）路径是否还需要保留、降级或删除。
- TypeScript 和 Python 两边的 capability registry（能力注册表）仍是手写列表，后续最好抽成单一事实源或增加一致性测试。

## 本次验证

- Python gate：`tests/test_capabilities.py tests/test_v5_contract_expansion.py`
- Node gate：`server/routes/__tests__/sliderule.execute-capability.test.ts`
- 文档 gate：`node agent-loop/src/check-mojibake.js ...`

这份报告只证明当前列出的 Python native LLM 能力和 Node Python-mode 委托契约一致；不代表整个 NodeJS 后端迁移完成。
