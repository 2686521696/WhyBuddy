# 后端 NodeJS 到 Python 迁移：Web AIGC provider closure 100

## 执行状态

- 状态：已完成（人工 rescue 后门禁已绿）
- 目标：把 Web AIGC 长尾 provider（提供方）剩余闭环补成 Python provider closure runtime，覆盖 search/file/vision/audio/OCR/static/AI PPT/dynamic/transaction/image/graph 等路线的统一生产姿态。
- 角色分工：worker 负责 Python provider closure、Node adapter bridge 和测试；reviewer 确认没有调用真实外部 provider、没有提交用户文件、没有把 fake runtime 写成真实生产接管。

### 状态清单

- [x] Python closure runtime 覆盖 Web AIGC provider readiness、capability map、degraded/error、config_missing。
- [x] Node adapters 能消费 Python provider closure summary，并保留 provenance、permission、audit、usage metadata。
- [x] image/graph/web-qa 等未完全接管的路线必须给出明确 node-owned 或 config_missing，不得假绿。
- [x] gate 全绿。
- [x] Codex review 确认 Web AIGC 100% 候选口径没有虚高。

### 救回验证

- 原队列结果：`HALT_NO_PROGRESS` / rescue patch。
- 人工修复：Python provider closure 从 `permission.auditId` 保留审计号；Node image/graph/web-qa adapters 保留 provider closure 姿态，不把 node-owned/config_missing 假写成 ready。
- Python gate：`66 passed`。
- Node/Vitest gate：`8 passed` test files / `40 passed` tests。

## 目标

96/97 阶段已经补了 dynamic chart、transaction flow、OCR/static、AI PPT，以及更早的 search/file/vision/audio fake runtime bridge。但 Web AIGC 仍有 image search、graph search、web QA、file translation/slicing/generation、excel read、intent/location/device 等长尾 provider。这个任务补统一 provider closure runtime，让 Python 输出每条路线的生产姿态，Node adapter 按姿态处理。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/web_aigc_provider_closure.py`
- `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_ocr_static_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_ai_ppt_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_dynamic_chart_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_transaction_flow_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_provider_closure_100.py`
- `server/tests/web-aigc-provider-closure-100.test.ts`
- `server/core/web-aigc-runtime-extra-adapters.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/routes/node-adapters/image-search-node-adapter.ts`
- `server/routes/node-adapters/graph-search-node-adapter.ts`
- `server/routes/node-adapters/web-qa-node-adapter.ts`
- `server/routes/node-adapters/file-translation-node-adapter.ts`
- `server/routes/node-adapters/file-slicing-node-adapter.ts`
- `server/routes/node-adapters/file-generation-node-adapter.ts`
- `shared/web-aigc-image-search.ts`
- `shared/web-aigc-graph-search.ts`
- `shared/web-aigc-governance.ts`
- `shared/web-aigc-observability.ts`
- `agent-loop/tasks/backend-python-web-aigc-provider-closure-100.md`

## 禁止扩大范围

- 不调用真实 OCR、vision、audio、LLM、browser、office/PPT、image 或 graph 外部 provider。
- 不提交真实用户文件、下载文件、图片、PPT、截图或缓存数据。
- 不把 provider_missing、config_missing、skipped 写成 healthy。
- 不降低 permission、audit、provenance、usage metadata。
- 不在本任务直接刷新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcProviderClosure100Gates`。

## 成功标准

- Python 测试覆盖每类 provider 的 ready、node_owned、config_missing、degraded、failed。
- Node 测试确认 long-tail adapters 能消费 Python provider closure summary。
- 既有 Web AIGC search/file/vision/audio/dynamic/transaction/OCR/static/AI PPT 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
