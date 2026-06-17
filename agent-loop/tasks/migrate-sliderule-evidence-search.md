# 迁移 SlideRule 的 evidence.search 到 Python 真脑子

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标 capability：`evidence.search`
- 预期 provenance：`python-llm`（或诚实标注 `python-llm` + sources；不得假 RAG 罐头）

### 状态清单

- [ ] Python native 路径替代 mapped RAG 罐头
- [ ] 返回形状仍含 `sources` 或等价证据字段（按 V5 契约）
- [ ] Node 委托跳过 LLM/pool
- [ ] gate 全绿

## 目标

把 `evidence.search` 从模板 RAG 路径迁到真 LLM 生成；若短期仍无真实检索，也必须诚实 provenance，禁止 RBAC 签名罐头。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。