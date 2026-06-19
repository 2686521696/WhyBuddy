# 后端 NodeJS 到 Python 迁移：audit event contract

## 执行状态
- 状态：待执行
- 目标：为 audit event（审计事件）建立 Python contract，锁住记录形状和校验语义。
- 角色分工：worker 负责契约和测试；reviewer 确认不迁真实 audit store，不破坏审计链。

### 状态清单
- [ ] Python 有 audit event schema/validator。
- [ ] Node audit 测试能映射 event、actor、resource、result。
- [ ] invalid event 不会被写成成功审计。
- [ ] gate 全绿。
- [ ] Codex review 确认没有绕过 audit chain。

## 目标

audit 是大后端的重要分母。这个任务先锁 Python audit event contract，为后续采集/查询/导出迁移铺路。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_audit_event_contract.py`
- `server/audit/audit-collector.ts`
- `server/tests/audit-collector.test.ts`
- `server/tests/audit-event-python-contract.test.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-audit-event-contract.md`

## 禁止扩大范围
- 不迁真实 audit store。
- 不改审计链 hash 语义。
- 不删除现有 audit 测试。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `auditEventContractGates`。

## 成功标准

- Python 测试覆盖 audit event valid/invalid。
- Node/shared 测试证明 Python contract 可表达现有 audit event。
- invalid event 不会伪装成成功写入。
- 所有 gate 通过。
