# 后端 NodeJS 到 Python 迁移：Web AIGC runtime evidence reconcile 88

## 执行状态
- 状态：待执行
- 目标：复核 Web AIGC file、vision/audio、telemetry sink 的 runtime/production 证据路径，修正文件名漂移和缺口口径。
- 角色分工：worker 负责盘点当前 HEAD 的服务/测试路径并生成报告；reviewer 确认没有把 contract 当 runtime。

### 状态清单
- [x] 对照 Web AIGC route inventory 与当前 HEAD 文件。
- [x] 识别 file runtime、vision/audio runtime、telemetry sink 的真实服务/测试路径。
- [x] 生成 Web AIGC runtime 证据对齐报告。
- [x] 修正状态文档中的路径漂移和缺口描述。
- [x] gate 全绿。
- [x] Codex review 确认不调用真实外部服务。

## 目标

90 阶段曾发现 Web AIGC 相关 gate 指向缺失或漂移路径，例如 vision/audio 服务文件名和 runtime 测试路径不一致。本任务先把证据表整理准，再决定后续是否补 runtime bridge。

## 允许修改的文件
- `docs/backend-python-web-aigc-runtime-evidence-reconcile-88.md`
- `agent-loop/tasks/backend-python-web-aigc-runtime-evidence-reconcile-88.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `agent-loop/tasks/backend-python-production-wiring-smoke-90.md`
- `docs/backend-python-node-route-inventory-90.md`

## 禁止扩大范围
- 不改 Web AIGC 业务代码。
- 不新增外部 search、OCR、vision、audio、PPT、chart 调用。
- 不把 adapter contract 计成 runtime bridge。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `webAigcRuntimeEvidenceReconcile88Gates`。

## 成功标准

- 报告列出 Web AIGC search/file/vision/audio/telemetry sink 的 current HEAD 路径和缺口。
- 明确哪些是 `runtime`、哪些只是 `contract`、哪些是 `node-only`。
- 状态文档缺口描述与当前 HEAD 一致。
- mojibake 扫描通过。
