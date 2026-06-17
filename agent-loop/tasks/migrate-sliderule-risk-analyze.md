# 迁移 SlideRule 的 risk.analyze 到 Python 真脑子

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标 capability：`risk.analyze`
- 预期 provenance：`python-llm`

### 状态清单

- [ ] Python native 真 LLM 路径
- [ ] 风险分析输出含结构语义（非 RBAC 罐头）
- [ ] Node 委托跳过 LLM/pool
- [ ] gate 全绿

## 目标

把 `risk.analyze` 从 `python-rag` 迁到真 LLM。分析类能力，markdown 分段输出即可，重点守住目标语境。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。