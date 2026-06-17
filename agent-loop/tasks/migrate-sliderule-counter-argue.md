# 迁移 SlideRule 的 counter.argue 到 Python 真脑子

## 执行状态

- 状态：进行中 — 红灯测试已落地，等待 AgentLoop + Grok 修复
- 目标 capability：`counter.argue`
- 预期 provenance：`python-llm`

### 状态清单

- [ ] Python native 执行路径
- [ ] Node 委托 + contract 测试
- [ ] gate 全绿

## 目标

迁 `counter.argue` 到 Python 真 LLM markdown 输出（反方论点/挑刺扩展，非 JSON schema）。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `server/routes/sliderule.ts`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 实现提示

Node 当前可能未把 `counter.argue` 列入 python delegation 白名单，需补上。prompt 三段：反方论点、证据缺口、可验证反驳路径。

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。