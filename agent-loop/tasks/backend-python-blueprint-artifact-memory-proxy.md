# 后端 NodeJS 到 Python 迁移：Blueprint artifact memory proxy

## 执行状态
- 状态：待执行
- 目标：为 Blueprint artifact memory（产物记忆）增加 Python proxy contract（代理契约）最小闭环。
- 角色分工：worker 负责契约和测试；reviewer 确认不迁真实 store、不破坏 Node artifact memory。

### 状态清单
- [ ] Python 侧有 artifact memory contract endpoint 或 service。
- [ ] Node 侧可通过开关调用 Python proxy。
- [ ] read/write/list/error 形状稳定。
- [ ] gate 全绿。
- [ ] Codex review 确认没有迁移真实持久化存储。

## 目标

Blueprint/spec-docs 要继续往 Python 迁，artifact memory 是重要边界。这个任务只锁 proxy contract，不迁真实 artifact store。

## 允许修改的文件
- `tws-ai-slide-rule-python/routes/blueprint_spec_docs.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_artifact_memory_proxy.py`
- `server/routes/blueprint/artifact-memory/service.ts`
- `server/routes/blueprint/artifact-memory/service.test.ts`
- `server/routes/__tests__/blueprint.artifact-memory-python-proxy.test.ts`
- `agent-loop/tasks/backend-python-blueprint-artifact-memory-proxy.md`

## 禁止扩大范围
- 不迁真实 artifact store。
- 不改数据库 schema。
- 不改 UI。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintArtifactMemoryProxyGates`。

## 成功标准

- Python 测试覆盖 read/write/list/error contract。
- Node 测试覆盖 Python proxy 开关和 fallback。
- 真实持久化仍由 Node 承担。
- 所有 gate 通过。
