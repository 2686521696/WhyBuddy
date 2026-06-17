# 迁移 SlideRule 的 structure.decompose 到 Python 真脑子

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标 capability：`structure.decompose`
- 预期 provenance：`python-llm`
- 前置：`backend-python-llm-json-hardening.md` 应先完成

### 状态清单

- [ ] Python native 真 LLM 路径
- [ ] contract 矩阵语义检查仍通过
- [ ] Node 委托 provenance 为 `python-llm`
- [ ] gate 全绿

## 目标

把 `structure.decompose` 从 RAG/mapped 路径迁到真 LLM，输出需保留树状/分解结构语义（非 dialogue 三段模板）。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。