# 迁移 SlideRule 的 outcome.visualize 到 Python 真后端

## 执行状态

- 状态：已完成（人工接管实现，`deliveryGates` 已验证）
- 目标 capability：`outcome.visualize`
- 预期 provenance：`python-llm`
- 前置：batch-2 migration queue 已完成 11/11 `DONE_REVIEWED`

### 状态清单

- [x] 已执行 AgentLoop（本片由人工按任务契约接管实现）
- [x] Python native implementation（Python 原生实现）已落地
- [x] Node delegation（Node 委托）契约已验证
- [x] `deliveryGates` 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 最近执行记录

- 最近执行：2026-06-19
- 执行结果：`DONE_GATE_ONLY`
- gate 结果：Python 39 passed / Node vitest 50 passed / TypeScript OK / mojibake OK
- 说明：本片只迁 `outcome.visualize`；未迁 `ux.preview`，也未让 AgentLoop 自动改代码。

## 目标

把 `outcome.visualize` 从当前 Node 侧 visual executor（可视化执行器）/ Python 侧 `python-rag` mapped baseline，迁到 Python-owned（Python 负责）的 outcome visualization（结果可视化）路径。

这片只处理 Mermaid（图）或流程状态预览的生成，不顺手迁 `ux.preview`。

## 当前证据 / 背景

- Node 当前实现：`server/sliderule/visual-exec-map.ts` 的 `outcome.visualize` 分支，面向 spec tree 生成可视化内容，provenance 为 `ai_generated`。
- Python 当前实现：`tws-ai-slide-rule-python/services/capability_maps.py` 的 `execute_visual()`，仍走 `python-rag` mapped baseline。
- delivery chain（交付链）里 `handoff.package` 会消费 outcome visualization（结果可视化），所以本任务需要保持 artifact（产物）结构可被后续交接包引用。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/services/capability_maps.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`
- 如必须同步 Node 契约，可改：
  - `server/sliderule/visual-exec-map.ts`
  - `server/sliderule/__tests__/visual-exec-map.test.ts`
  - `shared/blueprint/__tests__/sliderule-delivery-chain.test.ts`

## 禁止扩大范围

- 不迁 `orchestrate.plan`。
- 不改 Node LLM / pool WIP，除非 gate 明确证明该 capability 的代理契约必须更新。
- 不迁 `ux.preview` 或其它 delivery capability。
- 不删除、不弱化、不跳过测试。
- 不提交运行产物、密钥或本地数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `deliveryGates`。

## 成功标准

- `deliveryGates` 全部通过。
- `outcome.visualize` 在 `SLIDERULE_V5_BACKEND=python` 时委托到 Python，并返回 `provenance="python-llm"` 或等价 Python native structured output（Python 原生结构化输出）证明。
- 输出包含 Mermaid（图）或清晰的 flow states（流程状态）/ architecture preview（架构预览），并带上 evidence/provenance（证据/来源）提示。
- Node LLM / Node pool 不参与这个 capability 的生成。
- diff 只落在本任务允许修改的文件范围内。
