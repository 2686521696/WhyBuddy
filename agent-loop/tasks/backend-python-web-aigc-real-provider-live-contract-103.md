# 后端 NodeJS 迁 Python：Web AIGC real provider live contract 103

## 执行状态

- 状态：待执行
- 目标：把 Web AIGC 的 real external provider 从 skipped-live / synthetic facade 里拆出来。能做的补可配置 live contract；不能由 Python 拥有的外部供应商能力，明确 external-owned 或 out-of-scope，不再拖累迁移分母。
- 角色分工：worker 负责 Python live contract/decision、Node adapter 消费和测试；reviewer 必须确认没有把 synthetic、skipped-live 或 mock provider 算成真实生产接管。

### 状态清单

- [ ] 读取 96/97/100/101/102 Web AIGC 证据。
- [ ] 明确 web_search、vision、audio、ocr、web-qa、page_fetch、ai-ppt、chart、transaction 的归属。
- [ ] 补可配置 live provider contract，或明确 external-owned/out-of-scope。
- [ ] Node 测试覆盖 live/skipped/synthetic 的区分。
- [ ] gate 全绿。
- [ ] review 确认没有虚写 Web AIGC provider 100%。

## 背景

102 已经确认 Web AIGC 里很多真实 provider 仍是 skipped-live 或 external-required。103 的目的不是“再写一个 readiness”，而是让系统知道哪些是真 live contract，哪些只是 synthetic facade，哪些属于外部依赖。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/web_aigc_real_provider_live_contract.py`
- `tws-ai-slide-rule-python/services/web_aigc_external_provider_ownership_closure.py`
- `tws-ai-slide-rule-python/services/web_aigc_real_provider_readiness.py`
- `tws-ai-slide-rule-python/services/web_aigc_provider_closure.py`
- `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_ocr_static_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_real_provider_live_contract_103.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_external_provider_ownership_closure_102.py`
- `server/core/web-aigc-runtime-extra-adapters.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/rag/web-aigc-search-adapter.ts`
- `server/routes/ocr-recognition.ts`
- `server/routes/static-webpage-read.ts`
- `server/tests/web-aigc-real-provider-live-contract-103.test.ts`
- `server/tests/web-aigc-external-provider-ownership-closure-102.test.ts`
- `server/tests/web-aigc-real-provider-readiness-101.test.ts`
- `server/tests/ocr-static-python-runtime.test.ts`
- `shared/rag/web-aigc-search.ts`
- `shared/web-qa/contracts.ts`
- `shared/telemetry/contracts.ts`
- `agent-loop/tasks/backend-python-web-aigc-real-provider-live-contract-103.md`

## 禁止扩大范围

- 不调用真实外部供应商，除非测试明确使用可控 fake/live flag 且不会泄露密钥。
- 不把 synthetic facade、mock、skipped-live 当成真实 provider 接管。
- 不重写 Web AIGC 全部 adapter。
- 不把 external-owned 写成 Python-owned。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcRealProviderLiveContract103Gates`。

## 成功标准

- Python service 明确 real provider live contract 的 required env、skip reason、ownership 和 productionTakeover。
- Node adapter 能消费该 contract，并区分 live-ready、skipped-live、synthetic、external-owned。
- 测试证明 skipped-live/synthetic 不会被计入真实迁移完成。
- 产生真实代码 diff；如果最终只有文档变化，任务应失败。
- 所有 gate 通过。

## 给 worker 的大白话

Web AIGC 这块水分最大：mock、静态、跳过 live 都不能算真接管。你要把真 provider 的 live contract 写出来；接不了的就明确是外部依赖，不要让它继续拖着 100%。
