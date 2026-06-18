# 迁移 SlideRule 的 structure.decompose 到 Python 真脑子

## 执行状态

- 状态：已完成 — SPEC-tree 分解走 Python native LLM，gate 全绿
- 目标 capability：`structure.decompose`
- 预期 provenance：`python-llm`
- 前置：`backend-python-llm-json-hardening.md` 应先完成

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T14-11-25-977Z`
- AgentLoop 本地时间：`2026-06-17 22:11:25 (Asia/Shanghai)`
- AgentLoop 结果：`HALT_NO_CHANGES`
- AgentLoop 运行模式：`halt-no-changes`
- Grok 已运行：`true`
- Codex 已运行：`false`
- gate 结果：最近状态为 `HALT_NO_CHANGES`
### 状态清单

- [x] Python native 真 LLM 路径
- [x] contract 矩阵语义检查仍通过
- [x] Node 委托 provenance 为 `python-llm`
- [x] gate 全绿

## 目标

把 `structure.decompose` 从 RAG/mapped 路径迁到真 LLM，输出需保留树状/分解结构语义（非 dialogue 三段模板）。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。

## 成功标准

- All four required gates from `migrate-sliderule-synthesis-merge.md` pass.
- `structure.decompose` runs through the Python native LLM path and returns `provenance="python-llm"`.
- The output preserves the expected tree/decomposition semantics instead of using the dialogue markdown template.
- Node delegates `structure.decompose` to Python when `SLIDERULE_V5_BACKEND=python`; Node LLM and Node pool are not called for this capability.
- The diff stays within the allowed files listed in this task.
