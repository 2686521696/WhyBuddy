# 迁移 SlideRule 的 risk.analyze 到 Python 真脑子

## 执行状态

- 状态：已完成 — 风险分析走 Python native LLM，gate 全绿
- 目标 capability：`risk.analyze`
- 预期 provenance：`python-llm`

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T14-12-10-577Z`
- AgentLoop 本地时间：`2026-06-17 22:12:10 (Asia/Shanghai)`
- AgentLoop 结果：`HALT_NO_CHANGES`
- AgentLoop 运行模式：`halt-no-changes`
- Grok 已运行：`true`
- Codex 已运行：`false`
- gate 结果：最近状态为 `HALT_NO_CHANGES`
### 状态清单

- [x] Python native 真 LLM 路径
- [x] 风险分析输出含结构语义（非 RBAC 罐头）
- [x] Node 委托跳过 LLM/pool
- [x] gate 全绿

## 目标

把 `risk.analyze` 从 `python-rag` 迁到真 LLM。分析类能力，markdown 分段输出即可，重点守住目标语境。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。