# 后端 NodeJS 迁 Python：Permission/Audit policy-store cutover 101

## 执行状态
- 状态：待执行
- 目标：继续压缩 Permission/Audit 里 policy management、policy enforcement、durable audit store、external audit platform 的 Node-owned gap。
- 角色分工：worker 负责 Python policy/audit runtime、Node bridge 和测试；reviewer 必须确认不会把内存审计或只写 hook 当成生产审计接管。

### 状态清单
- [ ] Python 能输出 policy-store cutover decision。
- [ ] Node bridge 能消费 decision，并保留 durable store、external audit、route auth 的边界。
- [ ] permission check、rate limit、audit event/query/retention/export 的关键测试继续通过。
- [ ] gate 全绿。
- [ ] review 确认没有绕过权限或弱化审计链。

## 背景

97/100 阶段已经补了 permission audit hooks 和 auth-audit production closure，但状态表仍然把 persistence、policy、external audit 标成 Node-owned gap。101 这一刀只补 policy store 与 audit durable boundary 的 cutover readiness，不假装替换完整企业审计平台。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/permission_audit_policy_store_cutover.py`
- `tws-ai-slide-rule-python/services/permission_audit_hooks.py`
- `tws-ai-slide-rule-python/services/permission_management.py`
- `tws-ai-slide-rule-python/services/audit_retention_export.py`
- `tws-ai-slide-rule-python/services/audit_sink.py`
- `tws-ai-slide-rule-python/tests/test_permission_audit_policy_store_cutover_101.py`
- `server/permission/check-engine.ts`
- `server/permission/audit-logger.ts`
- `server/audit/audit-hooks.ts`
- `server/routes/audit.ts`
- `server/tests/permission-audit-policy-store-cutover-101.test.ts`
- `server/tests/permission-audit-hooks-python-runtime.test.ts`
- `server/tests/permission-governance-audit-routes.test.ts`
- `server/tests/audit-retention-export-python-runtime.test.ts`
- `server/tests/audit-production-sink.test.ts`
- `shared/permission/contracts.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-permission-audit-policy-store-cutover-101.md`

## 禁止扩大范围

- 不重写完整 RBAC/ABAC policy 系统。
- 不替换真实审计数据库或外部审计平台。
- 不绕过 route auth、permission guard、rate limit。
- 不把内存 store 或测试 fixture 写成 production durable store。
- 不删除既有 permission/audit 测试。
- 不提交运行产物、日志或真实审计数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionAuditPolicyStoreCutover101Gates`。

## 成功标准

- Python 测试覆盖 policy store、audit store、external audit readiness 的 ready、blocked、degraded、unsupported 分类。
- Node 测试确认 policy/audit bridge 不会绕过现有权限判断。
- 既有 permission hooks、governance audit、retention/export、production sink 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。

## 给 worker 的大白话

权限和审计不能“看起来能跑”就算迁完。你要做的是把生产接管条件写成代码和测试：哪些已有真实存储支持，哪些还只是桥接，哪些必须继续留在 Node。
