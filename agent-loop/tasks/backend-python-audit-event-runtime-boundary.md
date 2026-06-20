# 后端 NodeJS 到 Python 迁移：audit event runtime boundary

## 执行状态
- 状态：待执行
- 目标：把 audit event（审计事件）从 contract 推进到 runtime boundary，锁住 redaction（脱敏）和 validation（校验）。
- 角色分工：worker 负责 runtime boundary 和测试；reviewer 确认不绕过 audit chain（审计链）。

### 状态清单
- [ ] Python runtime boundary 覆盖 valid、invalid、redacted、rejected。
- [ ] Node audit collector test 能映射 Python result。
- [ ] invalid event 不伪装成成功写入。
- [ ] gate 全绿。
- [ ] Codex review 确认没有删除或绕过现有 audit 测试。

## 目标

这个任务不迁真实 audit store。只推进事件校验、脱敏和结果语义，让后续采集/查询/导出迁移有硬边界。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_audit_event_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_audit_event_contract.py`
- `server/audit/audit-collector.ts`
- `server/tests/audit-event-python-runtime.test.ts`
- `server/tests/audit-event-python-contract.test.ts`
- `server/tests/audit-collector.test.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-audit-event-runtime-boundary.md`

## 禁止扩大范围
- 不迁真实 audit store。
- 不改审计链 hash 语义。
- 不删除现有 audit 测试。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `auditEventRuntimeBoundaryGates`。

## 成功标准

- Python 测试覆盖 valid、invalid、redacted、rejected。
- Node/shared 测试证明 Python runtime boundary 可表达现有 audit event。
- invalid event 不会伪装成成功写入。
- 所有 gate 通过。
