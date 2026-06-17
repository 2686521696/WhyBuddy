# 迁移 SlideRule 的 report.write 到 Python 真脑子

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标 capability：`report.write`
- 预期 provenance：`python-llm`
- 前置：`backend-python-llm-json-hardening.md` 应先完成

### 状态清单

- [ ] Python `report.write` 走 native 真 LLM（非 mapped RAG 罐头）
- [ ] 输出满足 V5 报告契约（title/summary/content，可 markdown 九段精神）
- [ ] Node 委托不变，provenance 升为 `python-llm`
- [ ] gate 全绿

## 目标

把 `report.write` 从 `python-rag` baseline 迁到真 LLM。这是结构化输出能力，**不要**套用 dialogue 散文模板；使用 JSON hardening 后的 `call_llm_json` 或等价 guarded 解析。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/routes/sliderule_full.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 禁止扩大范围

- 不迁 `handoff.package` / `traceability.matrix`
- 不碰 Node orchestrate / pool WIP

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。