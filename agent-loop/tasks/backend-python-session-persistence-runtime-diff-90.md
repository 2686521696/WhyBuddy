# 后端 NodeJS 到 Python 迁移：Session persistence runtime diff 90

## 执行状态
- 状态：待执行
- 目标：处理 `session-persistence-runtime-boundary` 的 `DONE_REVIEWED_NO_DIFF`（已审查但无新 diff），补齐真实 runtime diff 或写实证据。
- 角色分工：worker 负责 Python persistence boundary、Node sessions store 测试或证据收口；reviewer 确认没有扩大到 auth/session 全链路。

### 状态清单
- [ ] 判断现有 session persistence 是否已足以按 runtime boundary 计入。
- [ ] 如果不足，补 Python save/load/list/delete 或等价最小 runtime diff。
- [ ] Node sessions store 在 Python mode 下覆盖恢复和错误映射。
- [ ] gate 全绿。
- [ ] Codex review 确认 missing/corrupt/error 不伪装成空成功。

## 目标

90% 阶段不能让 `DONE_REVIEWED_NO_DIFF` 悬着。这个任务要么补一个真实 diff（差异补丁），要么用当前代码和测试证明它只是已有能力复核。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/persistence.py`
- `tws-ai-slide-rule-python/tests/test_session_persistence_contract.py`
- `server/routes/__tests__/sliderule.sessions-store.test.ts`
- `agent-loop/tasks/backend-python-session-persistence-runtime-diff-90.md`

## 禁止扩大范围
- 不改生产数据库 schema。
- 不迁 auth session 主链路。
- 不做全局 session store 替换。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `sessionPersistenceRuntimeDiff90Gates`。

## 成功标准

- 明确 `DONE_REVIEWED_NO_DIFF` 是接受为已有能力复核，还是已补真实 runtime diff。
- Python 测试覆盖 session save/load/list/delete 或等价最小接口。
- Node 测试覆盖 Python mode 的恢复与错误映射。
- 所有 gate 通过。
