# 后端 NodeJS 迁 Python：Permission Audit durable store boundary 103

## 执行状态

- 状态：待执行
- 目标：处理 Permission/Audit 的 policy store、durable audit store、retention、external audit platform 边界。优先补可测试 Python-owned durable/decision slice；不能迁的明确 Node-retained、external-owned 或 out-of-scope。
- 角色分工：worker 负责 Python boundary service、Node permission/audit bridge 和测试；reviewer 必须确认没有把 hook、sink、export readiness 算成 durable store 接管。

### 状态清单

- [ ] 读取 88/89/96/97/100/101/102 Permission/Audit 证据。
- [ ] 明确 policy store、enforcement、audit durable store、retention、anomaly、external audit platform 归属。
- [ ] 补最小 Python-owned durable decision/runtime slice，或明确 retained/external/out-of-scope。
- [ ] Node 测试覆盖 permission check 和 audit durable boundary。
- [ ] gate 全绿。
- [ ] review 确认没有虚写 Permission/Audit 100%。

## 背景

102 明确 Permission/Audit 核心生产面仍多为 retained 或 external-required。103 要把“外部审计平台”和“Node durable store”从迁移分母里拆出来，或者真正补 Python 接管的小闭环。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/permission_audit_durable_store_boundary.py`
- `tws-ai-slide-rule-python/services/permission_audit_production_ownership_closure.py`
- `tws-ai-slide-rule-python/services/permission_audit_policy_store_cutover.py`
- `tws-ai-slide-rule-python/services/permission_audit_hooks.py`
- `tws-ai-slide-rule-python/services/audit_retention_export.py`
- `tws-ai-slide-rule-python/tests/test_permission_audit_durable_store_boundary_103.py`
- `tws-ai-slide-rule-python/tests/test_permission_audit_production_ownership_closure_102.py`
- `server/permission/check-engine.ts`
- `server/permission/policy-store.ts`
- `server/permission/audit-logger.ts`
- `server/audit/audit-store.ts`
- `server/audit/audit-retention.ts`
- `server/audit/audit-hooks.ts`
- `server/routes/audit.ts`
- `server/tests/permission-audit-durable-store-boundary-103.test.ts`
- `server/tests/permission-audit-production-ownership-closure-102.test.ts`
- `server/tests/permission-audit-policy-store-cutover-101.test.ts`
- `server/tests/audit-production-sink.test.ts`
- `shared/permission/contracts.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-permission-audit-durable-store-boundary-103.md`

## 禁止扩大范围

- 不重写权限系统或审计平台。
- 不迁移真实生产审计存储，除非 gate 证明 Python 接管最小闭环。
- 不把 hooks/export/sink 当成 durable audit store 接管。
- 不把 external audit platform 算作 Python-owned。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionAuditDurableStoreBoundary103Gates`。

## 成功标准

- Python service 返回 permission/audit durable boundary decision。
- Node bridge 能消费 decision，并区分 `python-owned`、`node-retained`、`external-owned`、`out-of-scope`。
- 测试覆盖 policy store 和 audit durable store 至少一个真实边界。
- 产生真实代码 diff；如果最终只有文档变化，任务应失败。
- 所有 gate 通过。

## 给 worker 的大白话

这块最容易把“有审计 hook”误当成“审计存储迁完”。别这么算。你要么让 Python 真接一段 durable 边界，要么把 Node/external 留守写成机器能读的决策。
