# 后端 NodeJS 迁 Python：Web AIGC real provider readiness 101

## 执行状态
- 状态：待执行
- 目标：继续压缩 Web AIGC 长尾能力里真实 provider readiness、skipped-live 分类、provider matrix 和 observability 的 Node-owned gap。
- 角色分工：worker 负责 Python readiness runtime、Node bridge 和测试；reviewer 必须确认 synthetic provider、mock smoke、skipped live 不会被写成真实生产接管。

### 状态清单
- [ ] Python 能输出 search/file/vision/audio/OCR/static/AI PPT/chart/transaction 等 provider readiness matrix。
- [ ] Node bridge 能消费 matrix，并清楚区分 ready、skipped-live、blocked、degraded。
- [ ] Web AIGC 既有 runtime adapter 测试继续通过。
- [ ] gate 全绿。
- [ ] review 确认进度文案不会虚高。

## 背景

Web AIGC 在 96/97/100 阶段补了多个 runtime adapter 和 provider closure，但状态表仍然写着长尾大部分和 real external providers 仍是 Node-owned gap。101 这一刀不接真实供应商密钥，只把 readiness matrix、跳过原因、生产观测字段补实。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/web_aigc_real_provider_readiness.py`
- `tws-ai-slide-rule-python/services/web_aigc_provider_closure.py`
- `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_ocr_static_adapter.py`
- `tws-ai-slide-rule-python/services/web_aigc_ai_ppt_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_real_provider_readiness_101.py`
- `server/core/web-aigc-runtime-extra-adapters.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `server/tests/web-aigc-real-provider-readiness-101.test.ts`
- `server/tests/web-aigc-provider-closure-100.test.ts`
- `server/routes/__tests__/web-aigc.search-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.file-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.vision-audio-python-runtime.test.ts`
- `server/tests/ocr-static-python-runtime.test.ts`
- `server/tests/ai-ppt-python-runtime.test.ts`
- `shared/telemetry/contracts.ts`
- `agent-loop/tasks/backend-python-web-aigc-real-provider-readiness-101.md`

## 禁止扩大范围

- 不引入真实 provider 密钥。
- 不发起不可控的外部付费调用。
- 不把 skipped-live、mock、fixture 写成 real provider ready。
- 不重写 Web AIGC 全部长尾 route。
- 不删除既有 adapter/runtime 测试。
- 不提交运行产物、缓存、日志或真实外部响应。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcRealProviderReadiness101Gates`。

## 成功标准

- Python 测试覆盖 provider matrix 的 ready、skipped-live、blocked、degraded、unsupported 分类。
- Node 测试确认 matrix 会进入 observability，并且 skipped-live 不计作 real takeover。
- 既有 Web AIGC runtime adapter 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。

## 给 worker 的大白话

这次不是去接一堆真实供应商账号。要把“哪些 provider 真准备好了，哪些只是跳过 live，哪些还缺配置”说清楚，让状态数字以后别靠感觉。
