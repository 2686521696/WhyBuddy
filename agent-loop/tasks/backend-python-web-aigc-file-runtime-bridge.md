# 后端 NodeJS 到 Python 迁移：Web AIGC file runtime bridge

## 执行状态
- 状态：待执行
- 目标：把 Web AIGC file adapter（文件适配器）从 contract-only 推进到 Python runtime bridge。
- 角色分工：worker 负责 Python bridge 和测试；reviewer 确认不读写真实用户文件。

### 状态清单
- [ ] Python file runtime bridge 支持 generation/slicing/translation/excel/long-text 结果形状。
- [ ] Node adapter 能识别 Python 成功、失败和 unavailable。
- [ ] 文件路径、artifact id、content type 字段稳定。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实文件副作用。

## 目标

这不是迁真实文件系统的任务。只建立安全 runtime bridge，让 Node 侧能调用 Python 返回稳定 envelope（信封）和 artifact metadata（产物元数据）。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_file_runtime_bridge.py`
- `tws-ai-slide-rule-python/tests/test_web_aigc_file_adapter_contract.py`
- `server/routes/node-adapters/file-*.ts`
- `server/routes/__tests__/web-aigc.file-python-runtime.test.ts`
- `server/routes/__tests__/web-aigc.file-python-contract.test.ts`
- `shared/web-aigc-file.ts`
- `agent-loop/tasks/backend-python-web-aigc-file-runtime-bridge.md`

## 禁止扩大范围
- 不读写真实用户文件。
- 不上传真实附件。
- 不改前端下载或预览 UI。
- 不提交 `.tmp/`、uploads、cache、日志或运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcFileRuntimeBridgeGates`。

## 成功标准

- Python 测试覆盖 success、validation error、runtime unavailable。
- Node 测试确认 failed/unavailable 不伪装成 generated。
- artifact metadata 字段稳定。
- 所有 gate 通过。
