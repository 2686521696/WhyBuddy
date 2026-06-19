# 后端 NodeJS 到 Python 迁移：Blueprint spec-docs batch proxy

## 执行状态
- 状态：待执行
- 目标：把 Blueprint/spec-docs（蓝图规格文档）从单文档 proxy 推进到 batch proxy（批量代理）最小闭环。
- 角色分工：worker 负责 Python batch endpoint 和 Node proxy 测试；reviewer 确认没有吞掉 artifact/store 边界。

### 状态清单
- [ ] Python 支持批量 spec-docs 请求。
- [ ] Node proxy 可按开关走 Python batch endpoint。
- [ ] partial failure（部分失败）形状稳定。
- [ ] gate 全绿。
- [ ] Codex review 确认不是完整 Blueprint 状态机迁移。

## 目标

上一批已经有单文档 spec-docs proxy。现在推进 batch proxy，让一组文档可一次请求 Python，但 artifact store、review/export/UI 仍留在 Node。

## 允许修改的文件
- `tws-ai-slide-rule-python/routes/blueprint_spec_docs.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_spec_docs_batch_proxy.py`
- `server/routes/blueprint.ts`
- `server/routes/__tests__/blueprint.spec-docs-batch-python-proxy.test.ts`
- `agent-loop/tasks/backend-python-blueprint-spec-docs-batch-proxy.md`

## 禁止扩大范围
- 不迁 Blueprint 主状态机。
- 不迁 artifact store。
- 不改前端 UI。
- 不发真实 LLM 请求。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintSpecDocsBatchProxyGates`。

## 成功标准

- Python pytest 覆盖 batch success / partial failure / validation error。
- Node vitest 覆盖开关式 Python batch proxy。
- 单文档 proxy 和 smoke gate 不退化。
- 所有 gate 通过。
