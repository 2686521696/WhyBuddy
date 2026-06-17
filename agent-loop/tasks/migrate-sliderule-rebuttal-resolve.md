# 迁移 SlideRule 的 rebuttal.resolve 到 Python 真脑子

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标 capability：`rebuttal.resolve`
- 预期 provenance：`python-llm`

### 状态清单

- [ ] Python native 执行路径
- [ ] Node 委托 + contract 测试
- [ ] gate 全绿

## 目标

迁 `rebuttal.resolve` 到 Python 真 LLM markdown 输出（消解批评/回应分歧，非 JSON schema）。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 实现提示

prompt 三段：回应点、未消解分歧、建议验证步骤。Node 白名单加入 `rebuttal.resolve`。

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。