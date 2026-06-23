# 后端 NodeJS 到 Python 迁移：Web AIGC OCR/static runtime 97

## 执行状态

- 状态：待执行
- 目标：把 OCR recognition 和 static webpage read 从 Node-only 长尾推进到 Python runtime bridge，并保留 provider safe-failure 语义。
- 角色分工：worker 负责 Python OCR/static adapter、Node route adapter 和测试；reviewer 确认没有调用真实 OCR、browser、crawler 或外部网页服务。

### 状态清单

- [ ] Python runtime 支持 OCR text extraction success/degraded/error envelope。
- [ ] Python runtime 支持 static webpage read success/degraded/error envelope。
- [ ] Node route/adapter 能映射 Python result，并保留 permission/audit/provenance metadata。
- [ ] degraded/error 不伪装成 success。
- [ ] gate 全绿。
- [ ] Codex review 确认没有接真实外部 provider。

## 目标

Web AIGC 长尾里 dynamic chart 和 transaction-flow 已经落地，OCR 和 static webpage 仍是整体 95 的明显缺口。这个任务只做 bounded fake-provider runtime 和 safe failure，不做真实 OCR/browser 抓取。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/web_aigc_ocr_static_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_media_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_ocr_static_runtime.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_runtime_bridge.py`
- `server/routes/ocr-recognition.ts`
- `server/routes/static-webpage-read.ts`
- `server/routes/node-adapters/ocr-recognition-node-adapter.ts`
- `server/routes/node-adapters/static-webpage-read-node-adapter.ts`
- `server/tests/ocr-static-python-runtime.test.ts`
- `server/tests/ocr-recognition-routes.test.ts`
- `server/tests/static-webpage-read-routes.test.ts`
- `server/tests/ocr-recognition-node-adapter.test.ts`
- `server/tests/static-webpage-read-node-adapter.test.ts`
- `shared/web-aigc-ocr-recognition.ts`
- `shared/static-webpage-read.ts`
- `agent-loop/tasks/backend-python-web-aigc-ocr-static-runtime-97.md`

## 禁止扩大范围

- 不调用真实 OCR、vision、browser、crawler、search、network fetch 或外部 webpage provider。
- 不迁 image/graph search、AI PPT、dynamic chart、transaction-flow 或其它 Web AIGC route。
- 不降低 permission/audit/provenance 语义。
- 不提交真实网页内容、截图、图片或用户文件。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcOcrStaticRuntime97Gates`。

## 成功标准

- Python 测试覆盖 OCR/static success、degraded、provider_missing、error。
- Node 测试确认 OCR/static routes 和 node adapters 能稳定映射 Python result。
- 现有 OCR/static route/adapter 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
