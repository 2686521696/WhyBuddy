# 后端 NodeJS 到 Python 迁移：Blueprint review/export proxy

## 执行状态
- 状态：待执行
- 目标：为 Blueprint review/export（审查/导出）补 Python proxy contract，继续扩大 Python 可承接范围。
- 角色分工：worker 负责最小契约和测试；reviewer 确认不迁 UI、不改变导出权限。

### 状态清单
- [ ] Python 有 review/export contract。
- [ ] Node 侧有开关式 proxy 测试。
- [ ] 权限、错误、空结果形状稳定。
- [ ] gate 全绿。
- [ ] Codex review 确认没有越权导出。

## 目标

Blueprint/spec-docs 迁移不只生成文档，还需要审查和导出边界。这个任务只做 proxy contract，为后续真正 runtime 迁移铺路。

## 允许修改的文件
- `tws-ai-slide-rule-python/routes/blueprint_spec_docs.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_review_export_proxy.py`
- `server/routes/blueprint.ts`
- `server/routes/__tests__/blueprint.review-export-python-proxy.test.ts`
- `agent-loop/tasks/backend-python-blueprint-review-export-proxy.md`

## 禁止扩大范围
- 不改前端 UI。
- 不改权限策略。
- 不迁完整 export pipeline。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintReviewExportProxyGates`。

## 成功标准

- Python 测试覆盖 review/export success、empty、permission/error。
- Node 测试覆盖 Python proxy 开关和 fallback。
- 权限失败不能伪装成导出成功。
- 所有 gate 通过。
