# 后端 NodeJS 到 Python 迁移：session persistence contract

## 执行状态
- 状态：待执行
- 目标：为 Python SlideRule session persistence（会话持久化）建立可和 Node 对齐的 contract。
- 角色分工：worker 负责 Python persistence contract 和测试；reviewer 确认不迁真实生产数据。

### 状态清单
- [x] Python session persistence 支持 save/load/list/error contract。
- [x] Node session store 测试能映射 Python contract。
- [x] corrupt/missing session 形状稳定。
- [x] gate 全绿。
- [x] Codex review 确认不提交真实 session 数据。

## 目标

SlideRule V5 子系统接近完成，但 session persistence 仍是重要运行时边界。这个任务锁 Python/Node 会话持久化 contract。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/persistence.py`
- `tws-ai-slide-rule-python/services/slide_rule_session.py`
- `tws-ai-slide-rule-python/tests/test_session_persistence_contract.py`
- `server/routes/__tests__/sliderule.sessions-store.test.ts`
- `agent-loop/tasks/backend-python-session-persistence-contract.md`

## 禁止扩大范围
- 不提交真实 session 数据。
- 不改数据库 schema。
- 不改前端历史页。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `sessionPersistenceContractGates`。

## 成功标准

- Python 测试覆盖 save/load/list/missing/corrupt。
- Node 测试能验证 Python contract 与现有 session store 兼容。
- 不读取或提交真实用户数据。
- 所有 gate 通过。
