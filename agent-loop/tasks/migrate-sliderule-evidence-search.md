# 迁移 SlideRule 的 evidence.search 到 Python 真脑子

## 执行状态

- 状态：已完成 — 证据检索走 Python native LLM + 诚实 sources，gate 全绿
- 目标 capability：`evidence.search`
- 预期 provenance：`python-llm`（或诚实标注 `python-llm` + sources；不得假 RAG 罐头）

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T14-12-50-128Z`
- AgentLoop 本地时间：`2026-06-17 22:12:50 (Asia/Shanghai)`
- AgentLoop 结果：`HALT_NO_CHANGES`
- AgentLoop 运行模式：`halt-no-changes`
- Grok 已运行：`true`
- Codex 已运行：`false`
- gate 结果：最近状态为 `HALT_NO_CHANGES`
### 状态清单

- [x] Python native 路径替代 mapped RAG 罐头
- [x] 返回形状仍含 `sources` 或等价证据字段（按 V5 契约）
- [x] Node 委托跳过 LLM/pool
- [x] gate 全绿

## 目标

把 `evidence.search` 从模板 RAG 路径迁到真 LLM 生成；若短期仍无真实检索，也必须诚实 provenance，禁止 RBAC 签名罐头。

## 允许修改的文件

- `tws-ai-slide-rule-python/sliderule_llm/capabilities.py`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`
- `tws-ai-slide-rule-python/tests/test_v5_contract_expansion.py`
- `server/routes/__tests__/sliderule.execute-capability.test.ts`

## 必跑 gate

同 `migrate-sliderule-synthesis-merge.md` 四个 gate。