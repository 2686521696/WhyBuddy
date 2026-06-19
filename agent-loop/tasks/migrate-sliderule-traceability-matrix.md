# 迁移 SlideRule 的 traceability.matrix 到 Python 真后端

## 执行状态

- 状态：已完成（AgentLoop 假完成后由人工接管补实现）
- 目标 capability：`traceability.matrix`
- 预期 provenance：`python-llm`
- 前置：batch-2 migration queue 已完成 11/11 `DONE_REVIEWED`

### 状态清单

- [x] 已执行 AgentLoop（真实运行得到 `DONE_REVIEWED`，但人工复核发现是 baseline gate 假完成）
- [x] Python native implementation（Python 原生实现）已落地
- [x] Node delegation（Node 委托）契约已验证
- [x] `deliveryGates` 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 最近执行记录

- 最近执行：2026-06-19
- AgentLoop run id：`2026-06-19T04-46-23-210Z`
- AgentLoop 结果：`DONE_REVIEWED`（baseline gate 已绿、diff 为空；人工复核发现是假完成）
- 人工补充结果：`DONE_GATE_ONLY`
- gate 结果：Python 36 passed / Node vitest 47 passed / TypeScript OK / mojibake OK

## 目标

把 `traceability.matrix` 从当前 Node 侧 `ai_generated` / Python 侧 `python-rag` mapped baseline，迁到 Python-owned（Python 负责）的追溯矩阵生成路径。

这片只处理需求、证据、风险、决策、下一步之间的 traceability（追溯）关系，不顺手迁 handoff bundle（交接包）或其它 delivery capability（交付能力）。

## 当前证据 / 背景

- Node 当前实现：`server/sliderule/delivery-exec-map.ts` 的 `traceability.matrix` 分支，生成 markdown table，provenance 为 `ai_generated`。
- Python 当前实现：`tws-ai-slide-rule-python/services/capability_maps.py` 的 `execute_traceability()`，仍走 `python-rag` mapped baseline。
- Python contract（契约）当前只要求 matrix-like keywords，需要升级为更明确的结构检查。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/services/capability_maps.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`
- 如必须同步 Node 契约，可改：
  - `server/sliderule/delivery-exec-map.ts`
  - `server/sliderule/__tests__/delivery-exec-map.test.ts`
  - `shared/blueprint/__tests__/sliderule-delivery-chain.test.ts`

## 禁止扩大范围

- 不迁 `orchestrate.plan`。
- 不改 Node LLM / pool WIP，除非 gate 明确证明该 capability 的代理契约必须更新。
- 不迁其它 delivery / visual capability。
- 不删除、不弱化、不跳过测试。
- 不提交运行产物、密钥或本地数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `deliveryGates`。

## 成功标准

- `deliveryGates` 全部通过。
- `traceability.matrix` 在 `SLIDERULE_V5_BACKEND=python` 时委托到 Python，并返回 `provenance="python-llm"` 或等价 Python native structured output（Python 原生结构化输出）证明。
- 输出有明确矩阵结构，至少覆盖 requirement（需求）、evidence（证据）、risk（风险）、decision（决策）、next action（下一步）这类列或字段。
- Node LLM / Node pool 不参与这个 capability 的生成。
- diff 只落在本任务允许修改的文件范围内。
