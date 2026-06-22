# 后端 NodeJS 到 Python 迁移：Blueprint review/export runtime boundary 96

## 执行状态
- 状态：待执行
- 目标：把 Blueprint review/export 从 proxy shape 推进到 Python runtime boundary，覆盖 review summary/export manifest 的最小闭环。
- 角色分工：worker 负责 Python review/export service、Node bridge 映射和测试；reviewer 确认没有迁完整 UI 导出、归档系统或 Blueprint 主流程。

### 状态清单
- [x] Python runtime boundary 能生成 review summary 和 export manifest。
- [x] Node review/export bridge 能保留权限、trace、error 和 degraded 字段。
- [x] failed/denied/degraded 不伪装成 exported。
- [x] gate 全绿。
- [x] Codex review 确认没有引入真实外部归档或 UI 副作用。

## 目标

当前 review/export 主要停在 proxy 层。本任务只迁一个可测的 Python runtime boundary：根据输入的 Blueprint artifacts/review items 生成稳定 manifest、summary、warnings 和 error envelope。Node 仍然保留 route shell 和 UI 入口。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/blueprint_review_export.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_review_export_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_review_export_proxy.py`
- `server/routes/__tests__/blueprint.review-export-python-runtime.test.ts`
- `server/routes/__tests__/blueprint.review-export-python-proxy.test.ts`
- `server/routes/blueprint/review-export-python-runtime.ts`
- `server/routes/blueprint/spec-documents/export/spec-documents-export-archive.ts`
- `shared/blueprint/review-export/types.ts`
- `agent-loop/tasks/backend-python-blueprint-review-export-runtime-boundary-96.md`

## 禁止扩大范围
- 不迁完整 Blueprint review UI。
- 不迁完整 spec documents archive storage。
- 不改真实文件下载、对象存储、权限模型或路由挂载。
- 不调用外部归档、LLM、对象存储服务。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintReviewExportRuntimeBoundary96Gates`。

## 成功标准

- Python 测试覆盖 review summary、export manifest、warning/degraded、permission denied、runtime error。
- Node 测试确认 exported/failed/denied/degraded 映射稳定。
- 现有 proxy contract 继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
