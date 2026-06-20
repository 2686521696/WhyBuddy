# 后端 NodeJS 到 Python 迁移：knowledge admin proxy contract

## 执行状态
- 状态：待执行
- 目标：为 knowledge admin（知识库管理）建立 Python proxy contract，不迁真实管理后台。
- 角色分工：worker 负责 contract 和测试；reviewer 确认不改真实权限和数据存储。

### 状态清单
- [x] Python 有 knowledge admin contract。
- [x] Node route 测试覆盖 list/upsert/delete/error。
- [x] permission failure（权限失败）形状稳定。
- [x] gate 全绿。
- [x] Codex review 确认不改真实知识库数据。

## 目标

RAG/vector 继续推进时，knowledge admin 是大边界。这个任务只锁 proxy contract，不迁真实存储。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/rag_service.py`
- `tws-ai-slide-rule-python/tests/test_knowledge_admin_proxy_contract.py`
- `server/routes/knowledge-admin.ts`
- `server/routes/__tests__/knowledge-admin-python-proxy.test.ts`
- `agent-loop/tasks/backend-python-knowledge-admin-proxy-contract.md`

## 禁止扩大范围
- 不迁真实知识库后台。
- 不改权限策略。
- 不提交真实数据。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `knowledgeAdminProxyContractGates`。

## 成功标准

- Python 测试覆盖 list/upsert/delete/error contract。
- Node 测试覆盖 Python proxy 开关和 fallback。
- 权限失败不能伪装成功。
- 所有 gate 通过。
