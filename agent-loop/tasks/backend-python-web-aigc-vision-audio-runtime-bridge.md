# 后端 NodeJS 到 Python 迁移：Web AIGC vision/audio runtime bridge

## 执行状态
- 状态：待执行
- 目标：把 OCR/audio/vision/voice adapter（文字识别/音频/视觉/语音适配器）推进到 Python runtime bridge。
- 角色分工：worker 负责 fake multimodal runtime（假多模态运行时）和测试；reviewer 确认不发真实多模态请求。

### 状态清单
- [ ] Python bridge 支持 OCR、audio transcript、vision caption、voice result。
- [ ] Node 测试覆盖 success、unsupported media、provider unavailable。
- [ ] media metadata（媒体元数据）和 provenance 字段稳定。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实外部多模态服务调用。

## 目标

上一轮已经有 vision/audio contract。这个任务推进 Node 到 Python runtime bridge，但仍使用 fake provider。重点是防止 unsupported/unavailable 被伪装成成功。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_adapter_contract.py`
- `server/routes/node-adapters/*vision*.ts`
- `server/routes/node-adapters/*audio*.ts`
- `server/routes/node-adapters/*ocr*.ts`
- `server/routes/__tests__/web-aigc.vision-audio-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.vision-audio-python-contract.test.ts`
- `agent-loop/tasks/backend-python-web-aigc-vision-audio-runtime-bridge.md`

## 禁止扩大范围
- 不发真实 OCR、ASR、vision、voice 外部请求。
- 不提交真实图片、音频或用户文件。
- 不改 UI。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcVisionAudioRuntimeBridgeGates`。

## 成功标准

- Python 测试覆盖 OCR/audio/vision/voice 四类结果形状。
- Node 测试确认 unsupported/unavailable 不伪装成 success。
- media metadata 和 provenance 字段稳定。
- 所有 gate 通过。
